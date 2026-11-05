const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { controlVoice } = require('../services/managed/voice');
const data = new SlashCommandBuilder().setName('voice').setDescription('Gérer votre vocal temporaire.').setDMPermission(false)
  .addSubcommand((s) => s.setName('rename').setDescription('Renommer').addStringOption((o) => o.setName('name').setDescription('Nom').setMaxLength(100).setRequired(true)))
  .addSubcommand((s) => s.setName('limit').setDescription('Limite de membres').addIntegerOption((o) => o.setName('count').setDescription('0 pour illimité').setMinValue(0).setMaxValue(99).setRequired(true)))
  .addSubcommand((s) => s.setName('lock').setDescription('Verrouiller'))
  .addSubcommand((s) => s.setName('unlock').setDescription('Déverrouiller'))
  .addSubcommand((s) => s.setName('transfer').setDescription('Transférer').addUserOption((o) => o.setName('member').setDescription('Membre présent dans le vocal').setRequired(true)));
module.exports = { data, async execute(i) { await i.deferReply({ flags: MessageFlags.Ephemeral }); await i.editReply({ content: await controlVoice(i) }); } };
