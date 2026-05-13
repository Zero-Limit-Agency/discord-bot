const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const createBaseEmbed = (title, description) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(title)
  .setDescription(description)
  .setFooter({ text: config.branding.name });

const createLinksEmbeds = () => [
  createBaseEmbed(
    'OFFICIAL LINKS',
    [
      'Use this channel to find the main Zero Limit Agency links, official platforms and community access points.',
      '',
      'Everything important is listed below so you can quickly access the website, socials and official pages.',
    ].join('\n'),
  ).addFields(
    { name: '\u{1F310} Website', value: '[zerolimit.agency](https://zerolimit.agency)' },
    { name: '\u{1F517} Konect', value: '[konect.gg/zerolimit](https://konect.gg/zerolimit)' },
  ),
  createBaseEmbed(
    'SOCIALS',
    [
      'Follow Zero Limit Agency across our public platforms to stay updated with content, announcements and new releases.',
    ].join('\n'),
  ).addFields(
    { name: '\u{1D54F} X / Twitter', value: '[@z0agency](https://x.com/z0agency)' },
    { name: '\u{1F3B5} TikTok', value: '[@z0agency](https://tiktok.com/@z0agency)' },
  ),
  createBaseEmbed(
    'DISCORD',
    [
      'Join the official Zero Limit Agency community server and stay connected with announcements, support and discussions.',
    ].join('\n'),
  ).addFields(
    { name: '\u{1F4AC} Discord Invite', value: '[Join the Discord](https://discord.gg/bHyFWm6tnt)' },
  ),
];

module.exports = createLinksEmbeds;
