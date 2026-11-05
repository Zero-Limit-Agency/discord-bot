const { ChannelType } = require('discord.js');
const { safeRole, requireFeature, FEATURES } = require('./access');
const { message, contextFor, sendVerified } = require('./messages');
const { store, serial } = require('../../repositories/commercialStore');
const { panel: ticketPanel } = require('./tickets');
const { rolePanel } = require('./roles');
const { audit } = require('./audit');
const id = (value) => { if (!/^\d{17,20}$/.test(value)) throw new Error('ID Discord invalide.'); return value; };
const channel = async (guild, value, types) => {
  const result = await guild.channels.fetch(id(value));
  if (!result || !types.includes(result.type) || result.guildId !== guild.id) throw new Error('Salon introuvable ou type incompatible.');
  return result;
};
const string = (value, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Texte absent ou trop long.'); return value.trim(); };
const validateConfig = async (guild, feature, input) => {
  if (!FEATURES.includes(feature) || feature === 'panel' || feature === 'embeds') throw new Error('Module non configurable par ce formulaire.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.enabled !== 'boolean') throw new Error('enabled doit être true ou false.');
  if (!input.enabled) return { enabled: false };
  const result = { enabled: true };
  if (['welcome', 'goodbye'].includes(feature)) {
    result.channelId = (await channel(guild, input.channelId, [0, 5])).id;
    if (input.fallbackChannelId) result.fallbackChannelId = (await channel(guild, input.fallbackChannelId, [0, 5])).id;
    message(input.message, { user: '<@123>', username: 'Preview', server: guild.name, memberCount: guild.memberCount });
    result.message = input.message;
  } else if (feature === 'logs') {
    result.channelId = (await channel(guild, input.channelId, [0, 5])).id;
  } else if (feature === 'tempvoice') {
    result.joinChannelId = (await channel(guild, input.joinChannelId, [ChannelType.GuildVoice])).id;
    result.categoryId = (await channel(guild, input.categoryId, [ChannelType.GuildCategory])).id;
    if (!Number.isInteger(input.userLimit) || input.userLimit < 0 || input.userLimit > 99) throw new Error('userLimit : entier de 0 à 99.');
    result.userLimit = input.userLimit;
  } else if (feature === 'autoroles') {
    if (!Array.isArray(input.roleIds) || !input.roleIds.length || input.roleIds.length > 10) throw new Error('Un à dix rôles requis.');
    for (const roleId of input.roleIds) await safeRole(guild, id(roleId));
    result.roleIds = [...new Set(input.roleIds)];
  } else if (feature === 'rolemenu') {
    result.channelId = (await channel(guild, input.channelId, [0, 5])).id;
    if (!['buttons', 'select'].includes(input.mode)) throw new Error('mode : buttons ou select.');
    if (!Array.isArray(input.roles) || !input.roles.length || input.roles.length > 5) throw new Error('Un à cinq rôles requis.');
    result.mode = input.mode;
    result.roles = [];
    for (const role of input.roles) { await safeRole(guild, id(role.roleId)); result.roles.push({ roleId: role.roleId, label: string(role.label, 80) }); }
    if (new Set(result.roles.map((r) => r.roleId)).size !== result.roles.length) throw new Error('Rôles dupliqués.');
  } else if (feature === 'tickets') {
    result.channelId = (await channel(guild, input.channelId, [0, 5])).id;
    result.categoryId = (await channel(guild, input.categoryId, [ChannelType.GuildCategory])).id;
    if (!Array.isArray(input.staffRoleIds) || !input.staffRoleIds.length || input.staffRoleIds.length > 10) throw new Error('Un à dix rôles staff requis.');
    result.staffRoleIds = [...new Set(input.staffRoleIds)];
    for (const roleId of result.staffRoleIds) {
      const role = await guild.roles.fetch(id(roleId));
      if (!role || role.id === guild.id) throw new Error('Rôle staff invalide.');
    }
    if (!Number.isInteger(input.maxOpen) || input.maxOpen < 1 || input.maxOpen > 10) throw new Error('maxOpen : entier de 1 à 10.');
    result.maxOpen = input.maxOpen;
    if (!Array.isArray(input.types) || !input.types.length || input.types.length > 5) throw new Error('Un à cinq types de ticket requis.');
    result.types = [];
    for (const type of input.types) {
      if (!/^[a-z0-9_-]{1,32}$/.test(type.id)) throw new Error('Type ID : lettres minuscules, chiffres, tiret, underscore.');
      result.types.push({ id: type.id, label: string(type.label, 80), ...(type.categoryId ? { categoryId: (await channel(guild, type.categoryId, [ChannelType.GuildCategory])).id } : {}) });
    }
    if (new Set(result.types.map((t) => t.id)).size !== result.types.length) throw new Error('Types de ticket dupliqués.');
  }
  return result;
};
const configure = async (i, feature, input) => serial(`${i.guildId}:config`, async () => {
  requireFeature(i.guildId, feature);
  const next = await validateConfig(i.guild, feature, input);
  requireFeature(i.guildId, feature);
  if (!next.enabled) {
    // Keep settings and resources so reactivation can recover the previous configuration.
    store.update(i.guildId, (s) => { s.features[feature] = { ...s.features[feature], enabled: false }; });
  } else {
    if (['tickets', 'rolemenu'].includes(feature)) {
      const target = await i.guild.channels.fetch(next.channelId);
      const components = feature === 'tickets' ? ticketPanel(next) : rolePanel(next);
      const sent = await sendVerified(target, { content: feature === 'tickets' ? 'Support — ouvrir un ticket' : 'Choisissez vos rôles', components, allowedMentions: { parse: [] } });
      next.panelMessageId = sent.id;
    }
    store.update(i.guildId, (s) => { s.features[feature] = next; });
  }
  await audit(i.guild, `config.${feature}`, i.user.id);
});
const samples = {
  tickets: { enabled: true, channelId: 'ID_SALON_PANEL', categoryId: 'ID_CATEGORIE', staffRoleIds: ['ID_ROLE_STAFF'], maxOpen: 2, types: [{ id: 'support', label: 'Support' }, { id: 'sales', label: 'Devis' }] },
  welcome: { enabled: true, channelId: 'ID_SALON', message: { content: 'Bienvenue {user} sur {server} !', embed: { title: 'Bienvenue {username}', description: 'Nous sommes {memberCount} membres.', color: '#7A1632' } } },
  goodbye: { enabled: true, channelId: 'ID_SALON', message: { content: '{username} a quitté {server}.' } },
  tempvoice: { enabled: true, joinChannelId: 'ID_VOCAL_ENTREE', categoryId: 'ID_CATEGORIE', userLimit: 0 },
  autoroles: { enabled: true, roleIds: ['ID_ROLE_MEMBRE'] },
  rolemenu: { enabled: true, channelId: 'ID_SALON', mode: 'buttons', roles: [{ roleId: 'ID_ROLE_MEMBRE', label: 'Membre' }] },
  logs: { enabled: true, channelId: 'ID_SALON_PRIVE_STAFF' },
};
module.exports = { validateConfig, configure, samples, channel };
