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
  welcomeBannerUrl: process.env.WELCOME_BANNER_URL || '',
  welcomeLogoUrl: process.env.WELCOME_LOGO_URL || '',
  statusChannelId: process.env.STATUS_CHANNEL_ID || '',
  socialsChannelId: process.env.SOCIALS_CHANNEL_ID || '',
  siteStatusUrl: process.env.SITE_STATUS_URL || '',
  rulesBannerUrl: process.env.RULES_BANNER_URL || '',
  lmStudioBaseUrl: process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234',
  lmStudioModel: process.env.LMSTUDIO_MODEL || '',
  lmStudioEnabled: String(process.env.LMSTUDIO_ENABLED || 'false').toLowerCase() === 'true',
  lmStudioTimeoutMs: Number.parseInt(process.env.LMSTUDIO_TIMEOUT_MS || '180000', 10),
  buildPipelineMode: String(process.env.BUILD_PIPELINE_MODE || 'single').trim().toLowerCase(),
  buildAgentTimeoutMs: Number.parseInt(process.env.BUILD_AGENT_TIMEOUT_MS || '900000', 10),
  buildArchitectTimeoutMs: Number.parseInt(process.env.BUILD_ARCHITECT_TIMEOUT_MS || '', 10),
  buildPermissionsTimeoutMs: Number.parseInt(process.env.BUILD_PERMISSIONS_TIMEOUT_MS || '', 10),
  buildContentTimeoutMs: Number.parseInt(process.env.BUILD_CONTENT_TIMEOUT_MS || '', 10),
  buildAssemblerTimeoutMs: Number.parseInt(process.env.BUILD_ASSEMBLER_TIMEOUT_MS || '', 10),
  buildAgentMaxRetries: Number.parseInt(process.env.BUILD_AGENT_MAX_RETRIES || '1', 10),
  aiSkillsEnabled: String(process.env.AI_SKILLS_ENABLED || 'true').toLowerCase() === 'true',
  aiSkillsMaxChars: Number.parseInt(process.env.AI_SKILLS_MAX_CHARS || '12000', 10),
  aiSkillsMode: String(process.env.AI_SKILLS_MODE || 'compact').trim().toLowerCase(),
  discordTemplateExecutionEnabled: String(process.env.DISCORD_TEMPLATE_EXECUTION_ENABLED || 'false').toLowerCase() === 'true',
  attachmentTextMaxBytes: Number.parseInt(process.env.ATTACHMENT_TEXT_MAX_BYTES || '1048576', 10),
  attachmentFetchTimeoutMs: Number.parseInt(process.env.ATTACHMENT_FETCH_TIMEOUT_MS || '10000', 10),
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

if (!Number.isFinite(config.attachmentTextMaxBytes) || config.attachmentTextMaxBytes <= 0) {
  config.attachmentTextMaxBytes = 1048576;
}

if (!Number.isFinite(config.lmStudioTimeoutMs) || config.lmStudioTimeoutMs <= 0) {
  config.lmStudioTimeoutMs = 180000;
}

if (!['single', 'multi'].includes(config.buildPipelineMode)) {
  config.buildPipelineMode = 'single';
}

if (!Number.isFinite(config.buildAgentTimeoutMs) || config.buildAgentTimeoutMs <= 0) {
  config.buildAgentTimeoutMs = 900000;
}

if (!Number.isFinite(config.buildArchitectTimeoutMs) || config.buildArchitectTimeoutMs <= 0) {
  config.buildArchitectTimeoutMs = config.buildAgentTimeoutMs;
}

if (!Number.isFinite(config.buildPermissionsTimeoutMs) || config.buildPermissionsTimeoutMs <= 0) {
  config.buildPermissionsTimeoutMs = config.buildAgentTimeoutMs;
}

if (!Number.isFinite(config.buildContentTimeoutMs) || config.buildContentTimeoutMs <= 0) {
  config.buildContentTimeoutMs = config.buildAgentTimeoutMs;
}

if (!Number.isFinite(config.buildAssemblerTimeoutMs) || config.buildAssemblerTimeoutMs <= 0) {
  config.buildAssemblerTimeoutMs = config.buildAgentTimeoutMs;
}

if (!Number.isFinite(config.buildAgentMaxRetries) || config.buildAgentMaxRetries < 0) {
  config.buildAgentMaxRetries = 1;
}

if (!Number.isFinite(config.aiSkillsMaxChars) || config.aiSkillsMaxChars <= 0) {
  config.aiSkillsMaxChars = 12000;
}

if (!['off', 'minimal', 'compact', 'full'].includes(config.aiSkillsMode)) {
  config.aiSkillsMode = 'compact';
}

if (!Number.isFinite(config.attachmentFetchTimeoutMs) || config.attachmentFetchTimeoutMs <= 0) {
  config.attachmentFetchTimeoutMs = 10000;
}

module.exports = config;
