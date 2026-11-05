const { store } = require('../../repositories/commercialStore');
const { enabled, safeRole } = require('./access');
const { message, contextFor, sendVerified } = require('./messages');
const { audit } = require('./audit');
const logger = require('../../utils/logger');
const memberEvent = async (member, kind) => {
  const state = store.read(member.guild.id);
  if (kind === 'welcome' && enabled(member.guild.id, 'autoroles') && state.features.autoroles?.enabled && !member.user.bot) {
    for (const id of state.features.autoroles.roleIds) {
      try { await safeRole(member.guild, id); if (!enabled(member.guild.id, 'autoroles')) break; await member.roles.add(id, 'Zero Limit autorole'); }
      catch (error) { logger.warn('Autorole failed', { guildId: member.guild.id, roleId: id, code: error.code || 'ROLE_UNAVAILABLE' }); }
    }
  }
  const config = state.features[kind];
  if (enabled(member.guild.id, kind) && config?.enabled) {
    const channel = await member.guild.channels.fetch(config.channelId).catch(() => null)
      || (config.fallbackChannelId ? await member.guild.channels.fetch(config.fallbackChannelId).catch(() => null) : null);
    if (channel && enabled(member.guild.id, kind)) await sendVerified(channel, message(config.message, contextFor(member)));
    else logger.warn('Member message channel deleted; skipped', { guildId: member.guild.id, kind });
  }
  await audit(member.guild, `member.${kind === 'welcome' ? 'join' : 'leave'}`, member.id);
};
module.exports = { memberEvent };
