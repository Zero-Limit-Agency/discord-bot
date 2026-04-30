const { SlashCommandBuilder } = require('discord.js');
const createRulesEmbed = require('../embeds/rulesEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Display the Zero Limit Agency server rules.'),
  async execute(interaction) {
    await interaction.reply({ embeds: [createRulesEmbed()] });
  },
};