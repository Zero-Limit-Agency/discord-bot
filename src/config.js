const dotenv = require('dotenv');

dotenv.config();

const parseSocialFeeds = () => {
  if (!process.env.SOCIAL_FEEDS_JSON) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env.SOCIAL_FEEDS_JSON);

    if (!Array.isArray(parsed)) {
      console.error('[CONFIG] SOCIAL_FEEDS_JSON must be a JSON array. Falling back to [].');
      return [];
    }

    return parsed
      .filter((feed) => feed && typeof feed === 'object')
      .map((feed) => ({
        platform: String(feed.platform || '').trim(),
        name: String(feed.name || '').trim(),
        username: String(feed.username || '').trim(),
        url: String(feed.url || '').trim(),
      }))
      .filter((feed) => feed.platform && feed.name && feed.username && feed.url);
  } catch (error) {
    console.error(`[CONFIG] Failed to parse SOCIAL_FEEDS_JSON: ${error.message}. Falling back to [].`);
    return [];
  }
};

const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || '',
  statusChannelId: process.env.STATUS_CHANNEL_ID || '',
  socialsChannelId: process.env.SOCIALS_CHANNEL_ID || '',
  siteStatusUrl: process.env.SITE_STATUS_URL || '',
  rulesBannerUrl: process.env.RULES_BANNER_URL || '',
  staffRoleIds: (process.env.STAFF_ROLE_IDS || '')
    .split(',')
    .map((roleId) => roleId.trim())
    .filter(Boolean),
  statusCheckIntervalMs: Number.parseInt(process.env.STATUS_CHECK_INTERVAL_MS || '60000', 10),
  socialCheckIntervalMs: Number.parseInt(process.env.SOCIAL_CHECK_INTERVAL_MS || '300000', 10),
  socialFeeds: parseSocialFeeds(),
  branding: {
    name: 'Zero Limit Agency',
    color: 0x7a1632,
  },
};

if (!Number.isFinite(config.statusCheckIntervalMs) || config.statusCheckIntervalMs <= 0) {
  config.statusCheckIntervalMs = 60000;
}

if (!Number.isFinite(config.socialCheckIntervalMs) || config.socialCheckIntervalMs <= 0) {
  config.socialCheckIntervalMs = 300000;
}

module.exports = config;
