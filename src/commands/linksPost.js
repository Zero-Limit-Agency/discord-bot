const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const createLinksEmbeds = require('../embeds/linksEmbed');
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
    .setName('links-post')
    .setDescription('Post the official Zero Limit Agency links in a selected channel.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('The channel where the links will be posted.')
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
      const embeds = createLinksEmbeds();
      const chunks = chunkEmbeds(embeds);

      for (const embedChunk of chunks) {
        await channel.send({ embeds: embedChunk });
      }

      await interaction.reply({
        content: 'Links posted.',
        ephemeral: true,
      });

      logger.info('Links guide posted', {
        userId: interaction.user.id,
        channelId: channel.id,
        embedCount: embeds.length,
      });
    } catch (error) {
      logger.error('Failed to post links guide', {
        userId: interaction.user.id,
        channelId: channel.id,
        error: error.message,
      });

      await interaction.reply({
        content: 'I could not post the links in that channel.',
        ephemeral: true,
      });
    }
  },
};
