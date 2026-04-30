const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const createSocialPostEmbed = (post) => {
  const descriptionLines = [];

  if (post.title) {
    descriptionLines.push(`**${post.title}**`);
    descriptionLines.push('');
  }

  descriptionLines.push(`[Open post](${post.url})`);

  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(`New ${post.platform} post`)
    .setDescription(descriptionLines.join('\n'))
    .addFields(
      { name: 'Source', value: post.sourceName, inline: true },
      { name: 'Username', value: post.username, inline: true },
    )
    .setTimestamp(post.publishedAt ? new Date(post.publishedAt) : new Date());

  if (post.image) {
    embed.setImage(post.image);
  }

  return embed;
};

module.exports = {
  createSocialPostEmbed,
};
