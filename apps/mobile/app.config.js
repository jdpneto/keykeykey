const config = require('./app.json');

// Apply runtime config from environment variables
config.expo.ios = {
  ...config.expo.ios,
  appleTeamId: process.env.APPLE_TEAM_ID || 'XXXXXXXXXX',
};

module.exports = config;
