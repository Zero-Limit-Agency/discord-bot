const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { listTemplates } = require('../services/discordTemplateService');
const { buildServerPlan } = require('../services/serverGenerator');
const {
  createTemplatePreviewEmbed,
  createTemplateListEmbed,
} = require('../embeds/templatePreviewEmbed');
const { formatFailureMessage } = require('../utils/templateDiagnostics');

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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const templateSlug = interaction.options.getString('template');

    if (!templateSlug) {
      const templates = listTemplates();

      await interaction.reply({
        embeds: [createTemplateListEmbed(templates)],
        flags: MessageFlags.Ephemeral,
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
        content: formatFailureMessage('The template could not be previewed.', {
          errors: result.errors,
          warnings: result.warnings,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplatePreviewEmbed(result.slug, result.plan)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
