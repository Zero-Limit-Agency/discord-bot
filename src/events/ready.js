const logger = require('../utils/logger');
const { startSiteStatusMonitor } = require('../services/siteStatus');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info('Bot connected to Discord', {
      tag: client.user.tag,
      guilds: client.guilds.cache.size,
    });

    await startSiteStatusMonitor(client);
  },
};