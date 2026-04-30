const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const createHowToUseEmbeds = require('../embeds/howToUseEmbed');
const logger = require('../utils/logger');
const { isStaffMember } = require('../utils/permissions');

const PERMISSION_ERROR = 'You do not have permission to use this command.';
const CHANNEL_ERROR = 'I cannot send embeds in that channel.';

const chunkEmbeds = (embeds, size = 10) => {
  const chunks = [];

  for (let index = 0; index < embeds.length; index += size) {
    chunks.push(embeds.slice(index, index + size));
  }

  return chunks;
};

const canSendEmbedsToChannel = (channel, botMember) => {
  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const permissions = channel.permissionsFor(botMember);

  if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel)) {
    return false;
  }

  const canSendMessages = channel.isThread()
    ? permissions.has(PermissionFlagsBits.SendMessagesInThreads)
    : permissions.has(PermissionFlagsBits.SendMessages);

  return canSendMessages && permissions.has(PermissionFlagsBits.EmbedLinks);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('how-to-use-post')
    .setDescription('Post the public server usage guide in a selected channel.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('The channel where the guide will be posted.')
      .setRequired(true)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: PERMISSION_ERROR,
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const botMember = interaction.guild.members.me;

    if (!canSendEmbedsToChannel(channel, botMember)) {
      await interaction.reply({
        content: CHANNEL_ERROR,
        ephemeral: true,
      });
      return;
    }

    try {
      const embeds = createHowToUseEmbeds();
      const chunks = chunkEmbeds(embeds);

      for (const embedChunk of chunks) {
        await channel.send({ embeds: embedChunk });
      }

      await interaction.reply({
        content: 'How to use posted.',
        ephemeral: true,
      });

      logger.info('How to use guide posted', {
        userId: interaction.user.id,
        channelId: channel.id,
        embedCount: embeds.length,
      });
    } catch (error) {
      logger.error('Failed to post how to use guide', {
        userId: interaction.user.id,
        channelId: channel.id,
        error: error.message,
      });

      await interaction.reply({
        content: 'I could not post the guide in that channel.',
        ephemeral: true,
      });
    }
  },
};
