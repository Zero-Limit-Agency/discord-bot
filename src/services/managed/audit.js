const { store } = require('../../repositories/commercialStore');
const logger = require('../../utils/logger');
const audit = async (guild, action, actorId, targetId = null) => {
  const state = store.update(guild.id, (data) => {
    data.audit.push({ at: new Date().toISOString(), action, actorId, targetId });
    data.audit = data.audit.slice(-1000);
  });
  if (!state.features.logs?.enabled) return;
  const { enabled } = require('./access');
  if (!enabled(guild.id, 'logs')) return;
  const channel = await guild.channels.fetch(state.features.logs.channelId).catch(() => null);
  if (!channel || ![0, 5].includes(channel.type)) return;
  await channel.send({ content: `${action} | acteur: ${actorId || 'bot'} | cible: ${targetId || '—'}`.slice(0, 1900), allowedMentions: { parse: [] } }).catch((error) => logger.warn('Guild audit delivery failed', { guildId: guild.id, code: error.code }));
};
module.exports = { audit };
