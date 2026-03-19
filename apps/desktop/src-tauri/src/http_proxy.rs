//! HTTP proxy commands for WebDAV sync.
//!
//! Tauri's webview runs in a browser context where cross-origin fetch() calls
//! are subject to CORS. WebDAV servers typically don't support CORS preflight,
//! so we proxy HTTP requests through Rust where there are no CORS restrictions.
//!
//! Security: All requests are validated against a configured URL prefix (set when
//! sync is configured). RFC 1918 / link-local / cloud metadata addresses are
//! blocked to prevent SSRF attacks.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::Mutex;
use tauri::State;
use url::Url;

/// Shared state for the HTTP proxy — holds a reusable reqwest client
/// and the allowed URL prefix for SSRF protection.
pub struct ProxyState {
    pub client: reqwest::Client,
    pub allowed_url_prefix: Mutex<Option<String>>,
}

#[derive(Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: std::collections::HashMap<String, String>,
    /// Base64-encoded body (for PUT requests with binary data)
    pub body_b64: Option<String>,
    /// Plain text body (for PUT requests with JSON)
    pub body_text: Option<String>,
}

#[derive(Serialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub body_b64: String,
    pub body_text: String,
}

/// Returns true if the IP address is in a blocked range (RFC 1918, link-local,
/// cloud metadata). Localhost (127.0.0.0/8, ::1) is allowed for development.
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            // Allow localhost (127.0.0.0/8) for development
            if octets[0] == 127 {
                return false;
            }
            // Block RFC 1918 private ranges
            if octets[0] == 10 {
                return true;
            }
            if octets[0] == 172 && (16..=31).contains(&octets[1]) {
                return true;
            }
            if octets[0] == 192 && octets[1] == 168 {
                return true;
            }
            // Block link-local (169.254.0.0/16) — includes cloud metadata 169.254.169.254
            if octets[0] == 169 && octets[1] == 254 {
                return true;
            }
            false
        }
        IpAddr::V6(v6) => {
            // Allow ::1 (localhost)
            if v6.is_loopback() {
                return false;
            }
            // Block unique-local (fc00::/7) and link-local (fe80::/10)
            let segments = v6.segments();
            if segments[0] & 0xfe00 == 0xfc00 {
                return true;
            }
            if segments[0] & 0xffc0 == 0xfe80 {
                return true;
            }
            // Block IPv4-mapped addresses (::ffff:x.x.x.x) that map to blocked ranges
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            false
        }
    }
}

/// Validate a URL against the allowed prefix and blocked IP ranges.
fn validate_url(url_str: &str, allowed_prefix: &Option<String>) -> Result<(), String> {
    // Must have an allowed prefix configured
    let prefix = allowed_prefix
        .as_ref()
        .ok_or("HTTP proxy not configured — set a sync URL first")?;

    if !url_str.starts_with(prefix.as_str()) {
        return Err(format!(
            "URL not allowed: must start with {}",
            prefix
        ));
    }

    // Parse URL and check host
    let parsed = Url::parse(url_str).map_err(|e| format!("Invalid URL: {e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;

    // Allow "localhost" explicitly
    if host == "localhost" {
        return Ok(());
    }

    // Check if host is a raw IP address
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err(format!("Blocked address: {host}"));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn http_proxy(
    state: State<'_, ProxyState>,
    req: HttpProxyRequest,
) -> Result<HttpProxyResponse, String> {
    // Validate URL against allowlist and blocked ranges
    {
        let prefix = state.allowed_url_prefix.lock().unwrap();
        validate_url(&req.url, &prefix)?;
    }

    let mut builder = state.client.request(
        req.method
            .parse::<reqwest::Method>()
            .map_err(|e| format!("Invalid method: {e}"))?,
        &req.url,
    );

    for (key, value) in &req.headers {
        builder = builder.header(key.as_str(), value.as_str());
    }

    if let Some(b64) = &req.body_b64 {
        let bytes = STANDARD
            .decode(b64)
            .map_err(|e| format!("Invalid base64 body: {e}"))?;
        builder = builder.body(bytes);
    } else if let Some(text) = &req.body_text {
        builder = builder.body(text.clone());
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = response.status().as_u16();

    // Collect response headers
    let mut resp_headers = std::collections::HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(name.as_str().to_string(), v.to_string());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    let body_text = match String::from_utf8(bytes.to_vec()) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).to_string(),
    };
    let body_b64 = STANDARD.encode(&bytes);

    Ok(HttpProxyResponse {
        status,
        headers: resp_headers,
        body_b64,
        body_text,
    })
}

/// Set the allowed URL prefix for the HTTP proxy.
/// Call this when sync is configured to restrict which URLs the proxy can reach.
/// Pass None to block all requests.
#[tauri::command]
pub fn set_sync_url_prefix(
    state: State<'_, ProxyState>,
    prefix: Option<String>,
) -> Result<(), String> {
    *state.allowed_url_prefix.lock().unwrap() = prefix;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_rfc1918_10() {
        assert!(is_blocked_ip("10.0.0.1".parse().unwrap()));
        assert!(is_blocked_ip("10.255.255.255".parse().unwrap()));
    }

    #[test]
    fn blocks_rfc1918_172() {
        assert!(is_blocked_ip("172.16.0.1".parse().unwrap()));
        assert!(is_blocked_ip("172.31.255.255".parse().unwrap()));
        assert!(!is_blocked_ip("172.15.0.1".parse().unwrap()));
        assert!(!is_blocked_ip("172.32.0.1".parse().unwrap()));
    }

    #[test]
    fn blocks_rfc1918_192() {
        assert!(is_blocked_ip("192.168.0.1".parse().unwrap()));
        assert!(is_blocked_ip("192.168.255.255".parse().unwrap()));
    }

    #[test]
    fn blocks_link_local() {
        assert!(is_blocked_ip("169.254.0.1".parse().unwrap()));
        assert!(is_blocked_ip("169.254.169.254".parse().unwrap()));
    }

    #[test]
    fn allows_localhost() {
        assert!(!is_blocked_ip("127.0.0.1".parse().unwrap()));
        assert!(!is_blocked_ip("127.0.0.2".parse().unwrap()));
    }

    #[test]
    fn allows_public_ips() {
        assert!(!is_blocked_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_blocked_ip("93.184.216.34".parse().unwrap()));
    }

    #[test]
    fn validate_url_requires_prefix() {
        let result = validate_url("https://example.com", &None);
        assert!(result.is_err());
    }

    #[test]
    fn validate_url_enforces_prefix() {
        let prefix = Some("https://dav.example.com/vault".to_string());
        assert!(validate_url("https://dav.example.com/vault/file", &prefix).is_ok());
        assert!(validate_url("https://evil.com/vault", &prefix).is_err());
    }

    #[test]
    fn validate_url_blocks_metadata() {
        let prefix = Some("http://169.254.169.254".to_string());
        let result = validate_url("http://169.254.169.254/latest/meta-data", &prefix);
        assert!(result.is_err());
    }

    #[test]
    fn validate_url_allows_localhost() {
        let prefix = Some("http://localhost:8080".to_string());
        assert!(validate_url("http://localhost:8080/dav", &prefix).is_ok());
    }
}
