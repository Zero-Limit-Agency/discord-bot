const { SlashCommandBuilder } = require('discord.js');
const createRulesEmbeds = require('../embeds/rulesEmbed');
const { isStaffMember } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Display the Zero Limit Agency server rules.'),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true,
      });
      return;
    }

    const embeds = createRulesEmbeds();
    await interaction.reply({ embeds: embeds.slice(0, 10) });
  },
};
