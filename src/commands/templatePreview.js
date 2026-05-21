const { SlashCommandBuilder } = require('discord.js');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { listTemplates } = require('../services/discordTemplateService');
const { buildServerPlan } = require('../services/serverGenerator');
const {
  createTemplatePreviewEmbed,
  createTemplateListEmbed,
} = require('../embeds/templatePreviewEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-preview')
    .setDescription('Preview a local Discord server template.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to preview, for example esport-team.')
      .setRequired(false)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true,
      });
      return;
    }

    const templateSlug = interaction.options.getString('template');

    if (!templateSlug) {
      const templates = listTemplates();

      await interaction.reply({
        embeds: [createTemplateListEmbed(templates)],
        ephemeral: true,
      });
      return;
    }

    const result = buildServerPlan(templateSlug);

    if (!result.ok) {
      logger.warn('Template preview failed', {
        template: templateSlug,
        code: result.code,
      });

      await interaction.reply({
        content: 'The template could not be loaded or is invalid.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplatePreviewEmbed(result.slug, result.plan)],
      ephemeral: true,
    });
  },
};
