const dotenv = require('dotenv');

dotenv.config();

const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || '',
  statusChannelId: process.env.STATUS_CHANNEL_ID || '',
  siteStatusUrl: process.env.SITE_STATUS_URL || '',
  rulesBannerUrl: process.env.RULES_BANNER_URL || '',
  staffRoleIds: (process.env.STAFF_ROLE_IDS || '')
    .split(',')
    .map((roleId) => roleId.trim())
    .filter(Boolean),
  statusCheckIntervalMs: Number.parseInt(process.env.STATUS_CHECK_INTERVAL_MS || '60000', 10),
  branding: {
    name: 'Zero Limit Agency',
    color: 0x7a1632,
  },
};

if (!Number.isFinite(config.statusCheckIntervalMs) || config.statusCheckIntervalMs <= 0) {
  config.statusCheckIntervalMs = 60000;
}

module.exports = config;
