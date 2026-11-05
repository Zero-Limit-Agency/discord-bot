const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { store } = require('../repositories/commercialStore');
const { FEATURES, requireOwner } = require('../services/managed/access');
const { audit } = require('../services/managed/audit');
const data = new SlashCommandBuilder().setName('license').setDescription('Licences Zero Limit (propriétaires uniquement).').setDMPermission(false);
for (const name of ['activate', 'extend', 'disable', 'status', 'features']) {
  data.addSubcommand((sub) => {
    sub.setName(name).setDescription(`${name} la licence du serveur courant`);
    if (['activate', 'extend'].includes(name)) sub.addIntegerOption((o) => o.setName('days').setDescription('Durée en jours').setMinValue(1).setMaxValue(3650).setRequired(true));
    if (['activate', 'features'].includes(name)) sub.addStringOption((o) => o.setName('features').setDescription(FEATURES.join(', ')).setRequired(true));
    return sub;
  });
}
module.exports = {
  data,
  async execute(interaction) {
    requireOwner(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = interaction.options.getSubcommand();
    const requested = interaction.options.getString('features');
    const features = requested?.split(',').map((x) => x.trim());
    if (features?.some((f) => !FEATURES.includes(f))) throw new Error(`Fonctionnalités autorisées : ${FEATURES.join(', ')}`);
    const state = action === 'status' ? store.read(interaction.guildId) : store.update(interaction.guildId, (state) => {
      if (action === 'activate') state.license = { active: true, expiresAt: new Date(Date.now() + interaction.options.getInteger('days') * 86400000).toISOString(), features: [...new Set(features)] };
      else {
        if (!state.license) throw new Error('Aucune licence existante.');
        if (action === 'disable') state.license.active = false;
        if (action === 'features') state.license.features = [...new Set(features)];
        if (action === 'extend') { state.license.expiresAt = new Date(Math.max(Date.now(), Date.parse(state.license.expiresAt)) + interaction.options.getInteger('days') * 86400000).toISOString(); state.license.active = true; }
      }
    });
    if (action !== 'status') await audit(interaction.guild, `license.${action}`, interaction.user.id);
    const license = state.license;
    await interaction.editReply({ content: license ? `Licence ${license.active && Date.parse(license.expiresAt) > Date.now() ? 'active' : 'inactive'}\nExpiration : ${license.expiresAt}\nModules : ${license.features.join(', ')}` : 'Aucune licence.' });
  },
};
