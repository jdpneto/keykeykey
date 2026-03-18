//! HTTP proxy commands for WebDAV sync.
//!
//! Tauri's webview runs in a browser context where cross-origin fetch() calls
//! are subject to CORS. WebDAV servers typically don't support CORS preflight,
//! so we proxy HTTP requests through Rust where there are no CORS restrictions.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

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
    pub body_b64: String,
    pub body_text: String,
}

#[tauri::command]
pub async fn http_proxy(req: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    let client = reqwest::Client::new();

    let mut builder = client.request(
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
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    let body_text = String::from_utf8_lossy(&bytes).to_string();
    let body_b64 = STANDARD.encode(&bytes);

    Ok(HttpProxyResponse {
        status,
        body_b64,
        body_text,
    })
}
