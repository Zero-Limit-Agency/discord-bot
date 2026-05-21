const { SlashCommandBuilder } = require('discord.js');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { buildDiscordPayloads } = require('../services/discordPayloadBuilder');
const { createTemplatePayloadEmbed } = require('../embeds/templatePreviewEmbed');

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
        ephemeral: true,
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
        content: 'The template could not be loaded or converted into payloads.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [createTemplatePayloadEmbed(result.slug, result)],
      ephemeral: true,
    });
  },
};
