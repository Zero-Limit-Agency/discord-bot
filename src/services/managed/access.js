const { PermissionFlagsBits: P } = require('discord.js');
const { isOwner } = require('../../utils/permissions');
const { store } = require('../../repositories/commercialStore');
const FEATURES = ['tickets', 'welcome', 'goodbye', 'embeds', 'tempvoice', 'autoroles', 'rolemenu', 'logs', 'panel'];
const enabled = (guildId, feature, now = Date.now()) => {
  const license = store.read(guildId).license;
  return Boolean(license?.active && Number.isFinite(Date.parse(license.expiresAt)) && Date.parse(license.expiresAt) > now && license.features?.includes(feature));
};
const requireFeature = (guildId, feature) => {
  if (!enabled(guildId, feature)) throw new Error(`Licence inactive, expirée ou fonctionnalité non incluse : ${feature}.`);
};
const requireAdmin = async (interaction) => {
  if (!interaction.guildId || !interaction.guild) throw new Error('Cette action nécessite un serveur.');
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(P.Administrator)) throw new Error('Administrateur Discord requis.');
  return member;
};
const requireOwner = (interaction) => {
  if (!interaction.guildId || !isOwner(interaction.user.id)) throw new Error('Action réservée aux propriétaires Zero Limit.');
};
const safeRole = async (guild, roleId) => {
  const role = await guild.roles.fetch(roleId);
  const me = guild.members.me || await guild.members.fetchMe();
  if (['1534218992619753622', ...(process.env.PROTECTED_ROLE_IDS || '').split(',')].includes(roleId)) throw new Error('Rôle protégé : attribution automatique interdite.');
  const dangerous = [P.ManageMessages, P.ViewAuditLog, P.ManageThreads, P.ManageEvents, P.MoveMembers, P.MuteMembers, P.DeafenMembers, P.ManageNicknames, P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageWebhooks, P.KickMembers, P.BanMembers, P.MentionEveryone, P.ModerateMembers];
  if (!role || role.id === guild.id || role.managed || !role.editable || role.comparePositionTo(me.roles.highest) >= 0 || dangerous.some((p) => role.permissions.has(p))) {
    throw new Error('Rôle absent, privilégié ou hors de la hiérarchie du bot.');
  }
  return role;
};
module.exports = { FEATURES, enabled, requireFeature, requireAdmin, requireOwner, safeRole };
