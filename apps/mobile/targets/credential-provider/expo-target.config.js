/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'credentials-provider',
  name: 'CredentialProvider',
  bundleIdentifier: '.credential-provider',
  deploymentTarget: '18.0',
  frameworks: ['AuthenticationServices', 'Security', 'LocalAuthentication'],
  entitlements: {
    'com.apple.security.application-groups': ['group.com.keykeykey.shared'],
    'com.apple.developer.authentication-services.autofill-credential-provider': true,
    // Without this, the appex's keychain queries against the shared group
    // fail with errSecMissingEntitlement — biometric_dek/pin_data/vault_header
    // all look missing, and the extension falls through to master-password.
    'keychain-access-groups': ['$(AppIdentifierPrefix)com.keykeykey.shared'],
  },
};
