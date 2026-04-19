const config = require('./app.json');

// Apply runtime config from environment variables
config.expo.ios = {
  ...config.expo.ios,
  appleTeamId: process.env.APPLE_TEAM_ID || 'XXXXXXXXXX',
};

// The CredentialProvider extension uses AutoFill Credential Provider +
// App Groups + Associated Domains — all paid-only capabilities. Strip
// @bacons/apple-targets (which creates the Xcode target from
// targets/credential-provider/) unless APPLE_PAID_TEAM=true so device
// builds on a Personal Team succeed. plugins/credential-provider gates
// its entitlements on the same env var.
if (process.env.APPLE_PAID_TEAM !== 'true') {
  config.expo.plugins = config.expo.plugins.filter((p) => p !== '@bacons/apple-targets');
}

module.exports = config;
