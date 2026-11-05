const { SlashCommandBuilder } = require('discord.js');
const { isOwner } = require('../utils/permissions');
const logger = require('../utils/logger');
const { buildExecutionPlan } = require('../services/discordServerOrchestrator');
const { createTemplateExecutionPlanEmbed } = require('../embeds/templatePreviewEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-execution-plan')
    .setDescription('Prepare a phased execution plan from a local Discord template.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to orchestrate, for example esport-team.')
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
    const result = buildExecutionPlan(templateSlug);

    if (!result.ok) {
      logger.warn('Template execution plan failed', {
        template: templateSlug,
        code: result.code,
      });

      await interaction.reply({
        content: 'The template could not be converted into an execution plan.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplateExecutionPlanEmbed(result.slug, result)],
      ephemeral: true,
    });
  },
};
