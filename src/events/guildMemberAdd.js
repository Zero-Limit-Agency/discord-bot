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

    await channel.send({ embeds: [createWelcomeEmbed(member)] });
    logger.info('Welcome message sent', { userId: member.id, channelId: channel.id });
  },
};