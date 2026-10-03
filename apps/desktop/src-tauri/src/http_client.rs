//! Shared construction of `reqwest` clients.
//!
//! Every outbound HTTPS request (WebDAV sync proxy, OAuth token exchange) must
//! use a client from [`client_builder`], which pins the TLS trust policy:
//!
//! * Crypto: rustls with the `ring` provider — the same backend reqwest 0.12's
//!   `rustls-tls` feature used — instead of reqwest 0.13's default `aws-lc-rs`.
//! * Trust anchors: **only** the Mozilla root set bundled in `webpki-roots`.
//!   The OS trust store is deliberately *not* consulted, so user-installed,
//!   MDM-pushed or corporate TLS-interception CAs cannot vouch for sync or
//!   OAuth servers. This preserves the reqwest 0.12 (`rustls-tls` =
//!   `rustls-tls-webpki-roots`) behaviour; reqwest 0.13 would otherwise use
//!   `rustls-platform-verifier` (the OS store).
//!
//! reqwest is built with `rustls-no-provider`, so building a client without a
//! preconfigured TLS config would panic — never call `reqwest::Client::new()`.

use std::sync::Arc;

use rustls::{ClientConfig, RootCertStore};

/// Root store containing exactly the `webpki-roots` (Mozilla) trust anchors.
fn webpki_root_store() -> RootCertStore {
    RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    }
}

/// rustls client config: ring provider, TLS 1.2/1.3, webpki roots only.
fn tls_config(roots: RootCertStore) -> ClientConfig {
    let mut config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .expect("ring provider supports the default TLS versions")
            .with_root_certificates(roots)
            .with_no_client_auth();
    // reqwest uses a preconfigured config verbatim. Only HTTP/1.1 is compiled
    // in (no `http2` feature), so advertise exactly that, as reqwest itself
    // does for HTTP/1-only clients.
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    config
}

/// A `reqwest::ClientBuilder` preloaded with the pinned TLS configuration.
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().tls_backend_preconfigured(tls_config(webpki_root_store()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_store_is_exactly_webpki_roots() {
        let roots = webpki_root_store();
        assert!(!roots.is_empty());
        assert_eq!(roots.len(), webpki_roots::TLS_SERVER_ROOTS.len());
        assert_eq!(roots.roots, webpki_roots::TLS_SERVER_ROOTS.to_vec());
    }

    #[test]
    fn tls_config_uses_ring_and_http1_alpn() {
        let config = tls_config(webpki_root_store());
        assert_eq!(config.alpn_protocols, vec![b"http/1.1".to_vec()]);
        let ring = rustls::crypto::ring::default_provider();
        assert_eq!(
            config.crypto_provider().cipher_suites.len(),
            ring.cipher_suites.len()
        );
    }

    #[test]
    fn builds_client_without_global_crypto_provider() {
        // Must not depend on a process-wide rustls default provider; reqwest
        // with `rustls-no-provider` would panic if it fell back to one.
        let client = client_builder()
            .redirect(reqwest::redirect::Policy::none())
            .build();
        assert!(client.is_ok());
    }

    /// Live TLS handshake against a public host (needs network, so ignored by
    /// default): `cargo test -- --ignored live_https`.
    #[test]
    #[ignore]
    fn live_https_handshake_with_webpki_roots() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let status = rt.block_on(async {
            client_builder()
                .build()
                .unwrap()
                .get("https://www.rust-lang.org/")
                .send()
                .await
                .map(|r| r.status())
        });
        assert!(status.expect("TLS request failed").is_success());
    }
}
