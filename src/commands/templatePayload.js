const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { buildDiscordPayloads } = require('../services/discordPayloadBuilder');
const { createTemplatePayloadEmbed } = require('../embeds/templatePreviewEmbed');
const { formatFailureMessage } = require('../utils/templateDiagnostics');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-payload')
    .setDescription('Build future Discord.js payloads from a local Discord template.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to build, for example esport-team.')
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
    const result = buildDiscordPayloads(templateSlug);

    if (!result.ok) {
      logger.warn('Template payload build failed', {
        template: templateSlug,
        code: result.code,
      });

      await interaction.reply({
        content: formatFailureMessage('The template could not be converted into payloads.', {
          errors: result.errors || result.buildErrors,
          warnings: result.warnings || result.buildWarnings,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplatePayloadEmbed(result.slug, result)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
