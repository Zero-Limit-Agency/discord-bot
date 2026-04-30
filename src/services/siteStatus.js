const config = require('../config');
const logger = require('../utils/logger');

const STATUS_CHANNEL_NAMES = {
  online: '\u{1F7E2} \u30FBsite-online',
  maintenance: '\u{1F7E0} \u30FBsite-maintenance',
  offline: '\u{1F534} \u30FBsite-offline',
};

const normalizeStatus = (value) => {
  if (!value) {
    return 'offline';
  }

  const normalized = String(value).trim().toLowerCase();

  if (normalized === 'online') {
    return 'online';
  }

  if (normalized === 'maintenance') {
    return 'maintenance';
  }

  return 'offline';
};

const getStatusFromResponse = async (response) => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => ({}));
    if (data && typeof data.status === 'string') {
      return normalizeStatus(data.status);
    }
  }

  if (response.status === 503) {
    return 'maintenance';
  }

  return response.ok ? 'online' : 'offline';
};

const fetchSiteStatus = async () => {
  if (!config.siteStatusUrl) {
    return null;
  }

  const response = await fetch(config.siteStatusUrl, {
    headers: {
      'user-agent': 'zero-limit-agency-discord-bot',
      accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  return getStatusFromResponse(response);
};

const renameStatusChannel = async (client, status) => {
  if (!config.statusChannelId) {
    logger.warn('Skipping site status channel update because STATUS_CHANNEL_ID is missing');
    return;
  }

  const channel = await client.channels.fetch(config.statusChannelId).catch(() => null);

  if (!channel || !channel.manageable) {
    logger.warn('Status channel not found or not manageable', { channelId: config.statusChannelId });
    return;
  }

  const nextName = STATUS_CHANNEL_NAMES[status] || STATUS_CHANNEL_NAMES.offline;

  if (channel.name === nextName) {
    logger.info('Status channel already up to date', { status, channelId: channel.id });
    return;
  }

  await channel.setName(nextName, 'Zero Limit Agency site status update');
  logger.info('Status channel renamed', { channelId: channel.id, status, nextName });
};

const runSiteStatusCheck = async (client) => {
  if (!config.siteStatusUrl) {
    logger.warn('Skipping site status check because SITE_STATUS_URL is missing');
    return;
  }

  try {
    const status = await fetchSiteStatus();
    await renameStatusChannel(client, status);
    logger.info('Site status check completed', { status });
  } catch (error) {
    logger.error('Site status check failed', { error: error.message });
  }
};

const startSiteStatusMonitor = async (client) => {
  if (!config.siteStatusUrl || !config.statusChannelId) {
    logger.warn('Site status monitor started in safe mode', {
      hasUrl: Boolean(config.siteStatusUrl),
      hasChannelId: Boolean(config.statusChannelId),
    });
  }

  await runSiteStatusCheck(client);

  setInterval(() => {
    runSiteStatusCheck(client).catch((error) => {
      logger.error('Unexpected site status interval error', { error: error.message });
    });
  }, config.statusCheckIntervalMs);
};

module.exports = {
  normalizeStatus,
  fetchSiteStatus,
  runSiteStatusCheck,
  startSiteStatusMonitor,
};