/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'credentials-provider',
  name: 'CredentialProvider',
  bundleIdentifier: '.credential-provider',
  deploymentTarget: '17.0',
  frameworks: ['AuthenticationServices', 'Security', 'LocalAuthentication', 'SQLite3'],
  entitlements: {
    'com.apple.security.application-groups': ['group.com.keykeykey.shared'],
    'com.apple.developer.authentication-services.autofill-credential-provider': true,
  },
};
