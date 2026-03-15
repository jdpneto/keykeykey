const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const APP_GROUP = 'group.com.keykeykey.shared';
const KEYCHAIN_GROUP = '$(AppIdentifierPrefix)com.keykeykey.shared';

function withCredentialProvider(config) {
  // Add App Group entitlement to main app
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [APP_GROUP];
    mod.modResults['keychain-access-groups'] = [
      '$(AppIdentifierPrefix)$(CFBundleIdentifier)',
      KEYCHAIN_GROUP,
    ];
    return mod;
  });

  // Write KeychainAccessGroup to Info.plist for Swift runtime access
  config = withInfoPlist(config, (mod) => {
    mod.modResults['KeychainAccessGroup'] = KEYCHAIN_GROUP;
    return mod;
  });

  // Add Associated Domains
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.associated-domains'] = ['webcredentials:keykeykey.com'];
    return mod;
  });

  // NOTE: Swift file copying and Xcode extension target creation are handled by
  // @bacons/apple-targets via targets/credential-provider/expo-target.config.js.
  // The SPM dependency on swift-sodium (https://github.com/jedisct1/swift-sodium.git)
  // must be added manually in Xcode or via a separate config plugin, as
  // @bacons/apple-targets does not support SPM package dependencies.

  return config;
}

module.exports = withCredentialProvider;
