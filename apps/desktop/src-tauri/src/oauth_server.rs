/// Loopback OAuth server for OAuth provider sign-in.
///
/// Binds a one-shot HTTP server on `127.0.0.1:<random-port>`, waits for
/// the OAuth provider's redirect, extracts the authorization code, and forwards
/// it to the frontend through a `tokio::sync::oneshot` channel.
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::State;
use tokio::sync::Mutex;

/// Shared state that carries the oneshot receiver between the two Tauri commands.
pub struct OAuthState {
    receiver: Mutex<Option<tokio::sync::oneshot::Receiver<String>>>,
    port: Mutex<Option<u16>>,
}

impl OAuthState {
    pub fn new() -> Self {
        Self {
            receiver: Mutex::new(None),
            port: Mutex::new(None),
        }
    }
}

/// Start the loopback OAuth server.
///
/// Returns the port number so the frontend can construct the redirect URI
/// (`http://127.0.0.1:<port>`) before opening the browser.
#[tauri::command]
pub async fn start_oauth(
    expected_state: String,
    bind_port: Option<u16>,
    oauth: State<'_, std::sync::Arc<OAuthState>>,
) -> Result<u16, String> {
    let addr = format!("127.0.0.1:{}", bind_port.unwrap_or(0));
    let listener =
        TcpListener::bind(&addr).map_err(|e| format!("Failed to bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();

    // Store the receiver and port so `await_oauth_code` can retrieve them.
    {
        let mut guard = oauth.receiver.lock().await;
        *guard = Some(rx);
    }
    {
        let mut guard = oauth.port.lock().await;
        *guard = Some(port);
    }

    // Spawn a blocking thread that waits for exactly one connection.
    std::thread::spawn(move || {
        // Ensure we always send *something* so the receiver never hangs.
        let send = |code: String| {
            let _ = tx.send(code);
        };

        let stream = match listener.accept() {
            Ok((stream, _addr)) => stream,
            Err(_) => {
                send(String::new());
                return;
            }
        };

        handle_connection(stream, &expected_state, send);
    });

    Ok(port)
}

/// Wait (up to 120 s) for the OAuth authorization code.
#[tauri::command]
pub async fn await_oauth_code(
    oauth: State<'_, std::sync::Arc<OAuthState>>,
) -> Result<String, String> {
    let rx = {
        let mut guard = oauth.receiver.lock().await;
        guard.take().ok_or_else(|| "No pending OAuth flow".to_string())?
    };

    let timeout_result =
        tokio::time::timeout(std::time::Duration::from_secs(120), rx).await;

    let code = match timeout_result {
        Err(_) => {
            // Timeout — send dummy connection to unblock the accept() thread
            if let Some(p) = oauth.port.lock().await.take() {
                let _ = std::net::TcpStream::connect(format!("127.0.0.1:{p}"));
            }
            return Err("OAuth timed out after 120 seconds".to_string());
        }
        Ok(Err(_)) => return Err("OAuth channel closed unexpectedly".to_string()),
        Ok(Ok(c)) => c,
    };

    if code.is_empty() {
        return Err("OAuth failed: no authorization code received".to_string());
    }

    Ok(code)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn handle_connection(
    mut stream: std::net::TcpStream,
    expected_state: &str,
    send: impl FnOnce(String),
) {
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => {
            send(String::new());
            return;
        }
    };
    let request = String::from_utf8_lossy(&buf[..n]);

    let (code, state) = parse_oauth_redirect(&request);

    let (status, body) = if code.is_some() && state.as_deref() == Some(expected_state) {
        send(code.unwrap());
        (
            "200 OK",
            "<html><body><h1>Sign-in complete! You can close this tab.</h1></body></html>",
        )
    } else {
        send(String::new());
        (
            "400 Bad Request",
            "<html><body><h1>Sign-in failed. Please try again.</h1></body></html>",
        )
    };

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

/// Extract `code` and `state` query parameters from the first line of an HTTP
/// GET request (e.g. `GET /?code=abc&state=xyz HTTP/1.1`).
fn parse_oauth_redirect(request: &str) -> (Option<String>, Option<String>) {
    let first_line = match request.lines().next() {
        Some(l) => l,
        None => return (None, None),
    };

    // Expected format: "GET /path?query HTTP/1.1"
    let path = match first_line.split_whitespace().nth(1) {
        Some(p) => p,
        None => return (None, None),
    };

    let query = match path.split_once('?') {
        Some((_, q)) => q,
        None => return (None, None),
    };

    let mut code = None;
    let mut state = None;

    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            match key {
                "code" => code = Some(urldecode(value)),
                "state" => state = Some(urldecode(value)),
                _ => {}
            }
        }
    }

    (code, state)
}

/// Minimal percent-decoding (covers the characters Google may encode in the
/// authorization code / state values).
fn urldecode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        match b {
            b'%' => {
                let hi = chars.next().unwrap_or(b'0');
                let lo = chars.next().unwrap_or(b'0');
                let byte = hex_val(hi) << 4 | hex_val(lo);
                result.push(byte as char);
            }
            b'+' => result.push(' '),
            _ => result.push(b as char),
        }
    }
    result
}

fn hex_val(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// Token exchange proxy (bypasses CORS for OAuth token endpoints)
// ---------------------------------------------------------------------------

/// Allowed OAuth token endpoint prefixes. Only these hosts are reachable.
const ALLOWED_TOKEN_HOSTS: &[&str] = &[
    "https://oauth2.googleapis.com/",
    "https://api.dropboxapi.com/",
    "https://login.microsoftonline.com/",
];

/// Proxy a POST request to an OAuth token endpoint from Rust, bypassing browser
/// CORS restrictions. Only allows requests to known OAuth provider hosts.
#[tauri::command]
pub async fn oauth_token_exchange(
    url: String,
    body: String,
    origin: Option<String>,
) -> Result<OAuthTokenResponse, String> {
    // Validate the URL is an allowed OAuth endpoint
    if !ALLOWED_TOKEN_HOSTS.iter().any(|prefix| url.starts_with(prefix)) {
        return Err(format!("URL not allowed for OAuth token exchange: {url}"));
    }

    let client = reqwest::Client::new();
    let mut builder = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded");

    // Microsoft SPA type requires an Origin header for token redemption.
    // Only allow http://localhost:<port> origins to prevent arbitrary header injection.
    if let Some(origin_val) = &origin {
        if !origin_val.starts_with("http://localhost:") {
            return Err(format!("Invalid origin for OAuth token exchange: {origin_val}"));
        }
        builder = builder.header("Origin", origin_val.as_str());
    }

    let res = builder
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    let status = res.status().as_u16();
    let response_body = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    Ok(OAuthTokenResponse {
        status,
        body: response_body,
    })
}

#[derive(serde::Serialize)]
pub struct OAuthTokenResponse {
    pub status: u16,
    pub body: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_redirect() {
        let req = "GET /?code=4%2FABC&state=xyz123 HTTP/1.1\r\nHost: 127.0.0.1\r\n";
        let (code, state) = parse_oauth_redirect(req);
        assert_eq!(code.as_deref(), Some("4/ABC"));
        assert_eq!(state.as_deref(), Some("xyz123"));
    }

    #[test]
    fn parse_missing_params() {
        let req = "GET / HTTP/1.1\r\n";
        let (code, state) = parse_oauth_redirect(req);
        assert!(code.is_none());
        assert!(state.is_none());
    }

    #[test]
    fn urldecode_basic() {
        assert_eq!(urldecode("hello+world"), "hello world");
        assert_eq!(urldecode("4%2Fabc"), "4/abc");
        assert_eq!(urldecode("no%20spaces"), "no spaces");
    }
}
