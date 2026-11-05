const { SlashCommandBuilder } = require('discord.js');
const { isOwner } = require('../utils/permissions');
const logger = require('../utils/logger');
const { simulateExecutionPlan } = require('../services/discordExecutionSimulator');
const { createTemplateSimulationEmbed } = require('../embeds/templatePreviewEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-simulate')
    .setDescription('Simulate the full execution of a Discord template without calling the API.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to simulate, for example esport-team.')
      .setRequired(true)),
  async execute(interaction) {
    if (!interaction.guildId || !isOwner(interaction.user.id)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true,
      });
      return;
    }

    const templateSlug = interaction.options.getString('template', true);
    const result = simulateExecutionPlan(templateSlug);

    if (!result.ok) {
      logger.warn('Template simulation failed', {
        template: templateSlug,
        code: result.code,
      });

      await interaction.reply({
        content: 'The template could not be simulated.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplateSimulationEmbed(result.slug, result)],
      ephemeral: true,
    });
  },
};
