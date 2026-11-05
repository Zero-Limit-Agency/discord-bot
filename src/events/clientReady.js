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

    const { reconcileTickets } = require('../services/managed/tickets');
    const { reconcileVoice } = require('../services/managed/voice');
    for (const guild of client.guilds.cache.values()) {
      const allowed = (process.env.ALLOWED_GUILD_IDS || '').split(',').filter(Boolean);
      if (allowed.length && !allowed.includes(guild.id)) continue;
      try { await require('../repositories/commercialStore').serial(`${guild.id}:tickets`, () => reconcileTickets(guild)); await require('../repositories/commercialStore').serial(`${guild.id}:voice`, () => reconcileVoice(guild)); }
      catch (error) { logger.error('Guild reconciliation failed', { guildId: guild.id, code: error.code || error.name }); }
    }
    if (process.env.LEGACY_MONITORS_ENABLED !== 'true') return;
    await startSiteStatusMonitor(client).catch((error) => {
      logger.error('Failed to start site status monitor', { error: error.message });
    });

    await startSocialWatcher(client).catch((error) => {
      logger.error('Failed to start social watcher', { error: error.message });
    });
  },
};
