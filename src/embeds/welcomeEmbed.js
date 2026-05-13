const { EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = (member) => {
  const botAvatarUrl = member.client.user
    ? member.client.user.displayAvatarURL({ extension: 'png', size: 512 })
    : null;
  const thumbnailUrl = config.welcomeLogoUrl || botAvatarUrl;

  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('Welcome to Zero Limit Agency')
    .setDescription('Welcome to the official Zero Limit Agency Discord server. Start by checking the key links below and make sure to read the rules before interacting.')
    .addFields(
      { name: '\u{1F310} Website', value: '[Visit our website](https://zerolimit.agency)' },
      { name: '\u{1D54F} Follow on X', value: '[Follow @Z0Agency](https://x.com/Z0Agency)' },
      { name: '\u{1F3B5} TikTok', value: '[Follow @z0agency](https://www.tiktok.com/@z0agency)' },
      { name: '\u{1F4DC} Start here', value: 'Read the rules, check how to use the server, and explore the official links.' },
      { name: '\u{1F3AB} Need help?', value: 'Open a ticket or contact the staff if you need support.' },
    )
    .setFooter({ text: config.branding.name })
    .setTimestamp();

  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  if (config.welcomeBannerUrl) {
    embed.setImage(config.welcomeBannerUrl);
  }

  return embed;
};
