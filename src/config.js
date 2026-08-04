const dotenv = require('dotenv');

dotenv.config();

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePipelineMode = (value) => {
  const normalized = String(value || 'single').trim().toLowerCase();
  return ['single', 'multi'].includes(normalized) ? normalized : 'single';
};

const normalizeAiSkillsMode = (value) => {
  const normalized = String(value || 'compact').trim().toLowerCase();
  return ['off', 'minimal', 'compact', 'full'].includes(normalized) ? normalized : 'compact';
};

const getRuntimeTimeoutConfig = () => {
  const buildAgentTimeoutMs = parsePositiveInt(process.env.BUILD_AGENT_TIMEOUT_MS, 900000);
  const lmStudioTimeoutMs = parsePositiveInt(process.env.LMSTUDIO_TIMEOUT_MS, 180000);

  return {
    buildPipelineMode: normalizePipelineMode(process.env.BUILD_PIPELINE_MODE),
    buildAgentTimeoutMs,
    buildArchitectTimeoutMs: parsePositiveInt(process.env.BUILD_ARCHITECT_TIMEOUT_MS, buildAgentTimeoutMs),
    buildPermissionsTimeoutMs: parsePositiveInt(process.env.BUILD_PERMISSIONS_TIMEOUT_MS, buildAgentTimeoutMs),
    buildContentTimeoutMs: parsePositiveInt(process.env.BUILD_CONTENT_TIMEOUT_MS, buildAgentTimeoutMs),
    buildAssemblerTimeoutMs: parsePositiveInt(process.env.BUILD_ASSEMBLER_TIMEOUT_MS, buildAgentTimeoutMs),
    buildAgentMaxRetries: Math.max(0, Number.parseInt(process.env.BUILD_AGENT_MAX_RETRIES || '1', 10) || 1),
    lmStudioTimeoutMs,
  };
};

const getEffectiveLmStudioTimeoutMs = (agentTimeoutMs = null) => {
  const runtimeTimeouts = getRuntimeTimeoutConfig();
  const minimumTimeoutMs = Number.isFinite(agentTimeoutMs) && agentTimeoutMs > 0 ? agentTimeoutMs : 0;
  return Math.max(runtimeTimeouts.lmStudioTimeoutMs, minimumTimeoutMs);
};

const getBuildRuntimeDiagnostics = () => {
  const runtimeTimeouts = getRuntimeTimeoutConfig();

  return {
    pipelineMode: runtimeTimeouts.buildPipelineMode,
    agentDefaultTimeoutMs: runtimeTimeouts.buildAgentTimeoutMs,
    architectTimeoutMs: runtimeTimeouts.buildArchitectTimeoutMs,
    permissionsTimeoutMs: runtimeTimeouts.buildPermissionsTimeoutMs,
    contentTimeoutMs: runtimeTimeouts.buildContentTimeoutMs,
    assemblerTimeoutMs: runtimeTimeouts.buildAssemblerTimeoutMs,
    lmStudioTimeoutMs: runtimeTimeouts.lmStudioTimeoutMs,
    maxRetries: runtimeTimeouts.buildAgentMaxRetries,
    timeoutMismatch: runtimeTimeouts.lmStudioTimeoutMs < Math.max(
      runtimeTimeouts.buildArchitectTimeoutMs,
      runtimeTimeouts.buildPermissionsTimeoutMs,
      runtimeTimeouts.buildContentTimeoutMs,
      runtimeTimeouts.buildAssemblerTimeoutMs,
    ),
  };
};

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
  lmStudioTimeoutMs: getRuntimeTimeoutConfig().lmStudioTimeoutMs,
  buildPipelineMode: getRuntimeTimeoutConfig().buildPipelineMode,
  buildAgentTimeoutMs: getRuntimeTimeoutConfig().buildAgentTimeoutMs,
  buildArchitectTimeoutMs: getRuntimeTimeoutConfig().buildArchitectTimeoutMs,
  buildPermissionsTimeoutMs: getRuntimeTimeoutConfig().buildPermissionsTimeoutMs,
  buildContentTimeoutMs: getRuntimeTimeoutConfig().buildContentTimeoutMs,
  buildAssemblerTimeoutMs: getRuntimeTimeoutConfig().buildAssemblerTimeoutMs,
  buildAgentMaxRetries: getRuntimeTimeoutConfig().buildAgentMaxRetries,
  aiSkillsEnabled: String(process.env.AI_SKILLS_ENABLED || 'true').toLowerCase() === 'true',
  aiSkillsMaxChars: Number.parseInt(process.env.AI_SKILLS_MAX_CHARS || '12000', 10),
  aiSkillsMode: normalizeAiSkillsMode(process.env.AI_SKILLS_MODE),
  discordTemplateExecutionEnabled: String(process.env.DISCORD_TEMPLATE_EXECUTION_ENABLED || 'false').toLowerCase() === 'true',
  attachmentTextMaxBytes: Number.parseInt(process.env.ATTACHMENT_TEXT_MAX_BYTES || '1048576', 10),
  attachmentFetchTimeoutMs: Number.parseInt(process.env.ATTACHMENT_FETCH_TIMEOUT_MS || '10000', 10),
  buildBriefMaxChars: Number.parseInt(process.env.BUILD_BRIEF_MAX_CHARS || '60000', 10),
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

if (!Number.isFinite(config.aiSkillsMaxChars) || config.aiSkillsMaxChars <= 0) {
  config.aiSkillsMaxChars = 12000;
}

if (!Number.isFinite(config.attachmentFetchTimeoutMs) || config.attachmentFetchTimeoutMs <= 0) {
  config.attachmentFetchTimeoutMs = 10000;
}

if (!Number.isFinite(config.buildBriefMaxChars) || config.buildBriefMaxChars < 2000) {
  config.buildBriefMaxChars = 60000;
}

config.getRuntimeTimeoutConfig = getRuntimeTimeoutConfig;
config.getEffectiveLmStudioTimeoutMs = getEffectiveLmStudioTimeoutMs;
config.getBuildRuntimeDiagnostics = getBuildRuntimeDiagnostics;

module.exports = config;
