const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const createRulesEmbeds = require('../embeds/rulesEmbed');
const logger = require('../utils/logger');
const { isStaffMember } = require('../utils/permissions');

const RULES_PERMISSION_ERROR = 'You do not have permission to use this command.';
const RULES_CHANNEL_ERROR = 'I cannot send embeds in that channel.';

const chunkEmbeds = (embeds, size = 10) => {
  const chunks = [];

  for (let index = 0; index < embeds.length; index += size) {
    chunks.push(embeds.slice(index, index + size));
  }

  return chunks;
};

const canSendRulesToChannel = (channel, botMember) => {
  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const permissions = channel.permissionsFor(botMember);

  if (!permissions) {
    return false;
  }

  if (!permissions.has(PermissionFlagsBits.ViewChannel)) {
    return false;
  }

  const canSendMessages = channel.isThread()
    ? permissions.has(PermissionFlagsBits.SendMessagesInThreads)
    : permissions.has(PermissionFlagsBits.SendMessages);

  return canSendMessages && permissions.has(PermissionFlagsBits.EmbedLinks);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules-post')
    .setDescription('Post the full Zero Limit Agency rules in a selected channel.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('The channel where the rules will be posted.')
      .setRequired(true)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: RULES_PERMISSION_ERROR,
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const botMember = interaction.guild.members.me;

    if (!canSendRulesToChannel(channel, botMember)) {
      await interaction.reply({
        content: RULES_CHANNEL_ERROR,
        ephemeral: true,
      });
      return;
    }

    try {
      const embeds = createRulesEmbeds();
      const chunks = chunkEmbeds(embeds);

      for (const embedChunk of chunks) {
        await channel.send({ embeds: embedChunk });
      }

      await interaction.reply({
        content: 'Rules posted.',
        ephemeral: true,
      });

      logger.info('Rules posted to channel', {
        userId: interaction.user.id,
        channelId: channel.id,
        embedCount: embeds.length,
      });
    } catch (error) {
      logger.error('Failed to post rules', {
        userId: interaction.user.id,
        channelId: channel.id,
        error: error.message,
      });

      await interaction.reply({
        content: 'I could not post the rules in that channel.',
        ephemeral: true,
      });
    }
  },
};
