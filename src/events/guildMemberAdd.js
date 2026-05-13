const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const createWelcomeEmbed = require('../embeds/welcomeEmbed');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    if (!config.welcomeChannelId) {
      logger.warn('Skipping welcome message because WELCOME_CHANNEL_ID is missing');
      return;
    }

    const channel = member.guild.channels.cache.get(config.welcomeChannelId)
      || await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      logger.warn('Welcome channel not found or not text-based', { channelId: config.welcomeChannelId });
      return;
    }

    const permissions = channel.permissionsFor(member.guild.members.me);
    const canSendMessages = channel.isThread()
      ? permissions?.has(PermissionFlagsBits.SendMessagesInThreads)
      : permissions?.has(PermissionFlagsBits.SendMessages);

    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !canSendMessages || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      logger.warn('Missing permissions for welcome message', {
        channelId: channel.id,
        userId: member.id,
      });
      return;
    }

    try {
      await channel.send({
        content: `${member}`,
        embeds: [createWelcomeEmbed(member)],
      });
      logger.info('Welcome message sent', { userId: member.id, channelId: channel.id });
    } catch (error) {
      logger.error('Failed to send welcome message', {
        userId: member.id,
        channelId: channel.id,
        error: error.message,
      });
    }
  },
};
