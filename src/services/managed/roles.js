const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { store, serial } = require('../../repositories/commercialStore');
const { requireFeature, safeRole } = require('./access');
const { audit } = require('./audit');
const rolePanel = (settings) => {
  if (settings.mode === 'select') return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('zl:roles:select').setPlaceholder('Choisir vos rôles').setMinValues(0).setMaxValues(settings.roles.length).addOptions(settings.roles.map((r) => ({ label: r.label, value: r.roleId }))))];
  return [new ActionRowBuilder().addComponents(settings.roles.map((r) => new ButtonBuilder().setCustomId(`zl:roles:toggle:${r.roleId}`).setLabel(r.label).setStyle(ButtonStyle.Secondary)))];
};
const handleRoles = async (i) => {
  requireFeature(i.guildId, 'rolemenu');
  await i.deferReply({ flags: 64 });
  await serial(`${i.guildId}:roles:${i.user.id}`, async () => {
    requireFeature(i.guildId, 'rolemenu');
    const state = store.read(i.guildId);
    const settings = state.features.rolemenu;
    if (!settings?.enabled || settings.panelMessageId !== i.message?.id || settings.channelId !== i.channelId) throw new Error('Panel de rôles inactif ou remplacé.');
    const member = await i.guild.members.fetch(i.user.id);
    const allowed = settings.roles.map((r) => r.roleId);
    const [, , action, roleId] = i.customId.split(':');
    if (action === 'toggle') {
      if (!allowed.includes(roleId)) throw new Error('Rôle non autorisé.');
      await safeRole(i.guild, roleId);
      requireFeature(i.guildId, 'rolemenu');
      if (member.roles.cache.has(roleId)) await member.roles.remove(roleId); else await member.roles.add(roleId);
    } else {
      if (action !== 'select' || settings.mode !== 'select' || i.values.some((id) => !allowed.includes(id))) throw new Error('Sélection invalide.');
      // Validate all roles before making changes. Use incremental operations so unrelated roles survive.
      for (const id of allowed) await safeRole(i.guild, id);
      for (const id of allowed) {
        requireFeature(i.guildId, 'rolemenu');
        if (i.values.includes(id) && !member.roles.cache.has(id)) await member.roles.add(id);
        if (!i.values.includes(id) && member.roles.cache.has(id)) await member.roles.remove(id);
      }
    }
    await audit(i.guild, 'roles.select', i.user.id);
    await i.editReply({ content: 'Vos rôles ont été mis à jour.' });
  });
};
module.exports = { rolePanel, handleRoles };
