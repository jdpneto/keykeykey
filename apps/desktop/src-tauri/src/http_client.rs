//! Shared construction of `reqwest` clients.
//!
//! reqwest 0.13 is built with `rustls-no-provider` so we keep the same `ring`
//! crypto backend the app used under reqwest 0.12 (`rustls-tls`) instead of
//! pulling in `aws-lc-sys` and its C/NASM toolchain requirements. With that
//! feature reqwest *panics* when a client is built before a rustls
//! `CryptoProvider` is installed, so every client must come from here.

use std::sync::Once;

/// Install `ring` as the process-wide rustls crypto provider (idempotent).
fn ensure_crypto_provider() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // Err means another provider was installed first; reqwest will then use
        // that one, which is equally valid, so the result is intentionally ignored.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// A `reqwest::ClientBuilder` that is safe to `build()` (TLS provider installed).
pub fn client_builder() -> reqwest::ClientBuilder {
    ensure_crypto_provider();
    reqwest::Client::builder()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_client_with_ring_provider() {
        let client = client_builder()
            .redirect(reqwest::redirect::Policy::none())
            .build();
        assert!(client.is_ok());
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
}
