const logger = require('../utils/logger');
const { startSiteStatusMonitor } = require('../services/siteStatus');
const { startSocialWatcher } = require('../services/socialWatcher');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info('Bot connected to Discord', {
      tag: client.user.tag,
      guilds: client.guilds.cache.size,
    });

    await startSiteStatusMonitor(client).catch((error) => {
      logger.error('Failed to start site status monitor', { error: error.message });
    });

    await startSocialWatcher(client).catch((error) => {
      logger.error('Failed to start social watcher', { error: error.message });
    });
  },
};
