const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const APP_GROUP = 'group.com.keykeykey.shared';
const KEYCHAIN_GROUP = '$(AppIdentifierPrefix)com.keykeykey.shared';

// App Group, Associated Domains, and the AutoFill Credential Provider
// capability all require a paid Apple Developer Program membership.
// Personal (free) teams cannot provision them, so device builds fail at
// profile generation. Gate them behind APPLE_PAID_TEAM=true so the same
// tree builds on both tiers; when the user enrolls, flip the env var
// and re-run prebuild to restore full fidelity.
const PAID_TEAM = process.env.APPLE_PAID_TEAM === 'true';

function withCredentialProvider(config) {
  if (!PAID_TEAM) return config;

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [APP_GROUP];
    mod.modResults['keychain-access-groups'] = [
      '$(AppIdentifierPrefix)$(CFBundleIdentifier)',
      KEYCHAIN_GROUP,
    ];
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    mod.modResults['KeychainAccessGroup'] = KEYCHAIN_GROUP;
    return mod;
  });

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.associated-domains'] = ['webcredentials:keykeykey.com'];
    return mod;
  });

  return config;
}

module.exports = withCredentialProvider;
