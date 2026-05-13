const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const MAX_PREVIEW_LENGTH = 350;

const truncateText = (value) => {
  if (!value) {
    return null;
  }

  if (value.length <= MAX_PREVIEW_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_PREVIEW_LENGTH - 3).trim()}...`;
};

const createSocialPostMessage = (post) => {
  if (post.platform.toLowerCase() === 'x' || post.platform.toLowerCase() === 'twitter') {
    return `${post.sourceName} just posted a new tweet. [Click here to view it](${post.url}).`;
  }

  if (post.platform.toLowerCase() === 'tiktok') {
    return `${post.sourceName} just posted a new TikTok. [Click here to view it](${post.url}).`;
  }

  return `${post.sourceName} just posted new content. [Click here to view it](${post.url}).`;
};

const createSocialPostEmbed = (post) => {
  const previewText = truncateText(post.previewText || post.title);

  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setAuthor({
      name: `${post.sourceName} ${post.username}`,
      iconURL: post.sourceIcon || undefined,
      url: post.url,
    })
    .setDescription(previewText || 'Open the post to view the latest update.')
    .setTimestamp(post.publishedAt ? new Date(post.publishedAt) : new Date());

  if (post.image) {
    embed.setImage(post.image);
  }

  if (post.platform) {
    embed.setFooter({ text: post.platform });
  }

  return embed;
};

module.exports = {
  createSocialPostMessage,
  createSocialPostEmbed,
};
