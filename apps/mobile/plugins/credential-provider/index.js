const { withXcodeProject, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

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

  // Copy Swift files to iOS project
  config = withXcodeProject(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const extensionDir = path.join(projectRoot, 'ios', 'CredentialProvider');

    if (!fs.existsSync(extensionDir)) {
      fs.mkdirSync(extensionDir, { recursive: true });
    }

    const swiftSrcDir = path.join(__dirname, 'swift');
    if (fs.existsSync(swiftSrcDir)) {
      for (const file of fs.readdirSync(swiftSrcDir)) {
        fs.copyFileSync(path.join(swiftSrcDir, file), path.join(extensionDir, file));
      }
    }

    return mod;
  });

  return config;
}

module.exports = withCredentialProvider;
