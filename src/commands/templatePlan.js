const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { buildServerPlan } = require('../services/serverGenerator');
const { createTemplatePlanEmbed } = require('../embeds/templatePreviewEmbed');
const { formatFailureMessage } = require('../utils/templateDiagnostics');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-plan')
    .setDescription('Prepare a detailed creation plan from a local Discord template.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to prepare, for example esport-team.')
      .setRequired(true)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const templateSlug = interaction.options.getString('template', true);
    const result = buildServerPlan(templateSlug);

    if (!result.ok) {
      logger.warn('Template plan failed', {
        template: templateSlug,
        code: result.code,
      });

      await interaction.reply({
        content: formatFailureMessage('The template could not be loaded or planned.', {
          errors: result.errors,
          warnings: result.warnings,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplatePlanEmbed(result.slug, result.plan)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
