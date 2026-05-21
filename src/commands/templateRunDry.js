const { SlashCommandBuilder } = require('discord.js');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { executeDryRun } = require('../services/discordTemplateRunner');
const { createTemplateDryRunEmbed } = require('../embeds/templatePreviewEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-run-dry')
    .setDescription('Run a mock execution of a Discord template without calling the Discord API.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to run, for example esport-team.')
      .setRequired(true)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true,
      });
      return;
    }

    const templateSlug = interaction.options.getString('template', true);
    const result = await executeDryRun(templateSlug);

    if (!result.ok) {
      logger.warn('Template dry run failed', {
        template: templateSlug,
        code: result.code,
      });

      await interaction.reply({
        content: 'The template could not be executed in dry-run mode.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplateDryRunEmbed(result.slug, result)],
      ephemeral: true,
    });
  },
};
