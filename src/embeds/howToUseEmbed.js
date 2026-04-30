const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const createBaseEmbed = (title, description) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(title)
  .setDescription(description);

const createHowToUseEmbeds = () => [
  createBaseEmbed(
    'HOW TO USE',
    [
      'Welcome to **Zero Limit Agency**.',
      '',
      'This Discord is built to keep everything clear, organized and professional.',
      'Use this guide to understand where to go, what each category is for, and how to interact with the agency.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '01 - Status',
    [
      'The **STATUS** category shows the current state of the Zero Limit Agency website.',
      '',
      '- `\u{1F7E2} \u30FBsite-online` means the website is available.',
      '- `\u{1F7E0} \u30FBsite-maintenance` means the website is temporarily under maintenance.',
      '- `\u{1F534} \u30FBsite-offline` means the bot cannot currently read the website status or there may be an issue.',
      '',
      'This channel is updated automatically by the Zero Limit Agency bot.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '02 - Start',
    [
      'The **START** category contains the first channels you should check when joining.',
      '',
      '- `\u{1F4DC}\u30FBrules` - read the server rules before interacting.',
      '- `\u{1F4D6}\u30FBhow-to-use` - explains how to use the server.',
      '- `\u{1F517}\u30FBlinks` - official links, website and social media.',
      '- `\u{1F44B}\u30FBjoins` - member join messages.',
      '',
      'Start here before posting elsewhere.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '03 - News',
    [
      'The **NEWS** category is used for updates and social activity.',
      '',
      '- `\u{1F4E2}\u30FBannouncements` - important agency announcements.',
      '- `\u{1F4F1}\u30FBsocials` - social media alerts, such as new TikToks, posts or updates.',
      '',
      'Check these channels to stay updated with Zero Limit Agency.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '04 - Community',
    [
      'The **COMMUNITY** category is open for public interaction.',
      '',
      '- `\u{1F4AC}\u30FBgeneral-fr` - French discussion.',
      '- `\u{1F30D}\u30FBenglish` - English discussion.',
      '- `\u{1F5BC}\u30FBportfolios` - share your portfolio, work or references.',
      '- `\u{1F4F7}\u30FBmedia` - share general media, visuals or content.',
      '- `\u{1F50A}\u30FBcommunity-voice` - public voice channel.',
      '- `\u{1F50A}\u30FBlounge` - casual voice channel.',
      '',
      'Keep discussions respectful, useful and in the right channel.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '05 - Support',
    [
      'The **SUPPORT** category is here when you need help.',
      '',
      '- `\u{1F3AB}\u30FBtickets` - open a ticket if you need private help or staff support.',
      '- `\u{2753}\u30FBfaq` - ask common questions or check useful answers.',
      '',
      'When asking for help, be clear. Explain your issue, your context and what you need.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '06 - Voice System',
    [
      'The **VOCAL** category is used for calls and private discussions.',
      '',
      '- `\u{1F558}\u30FBwaiting-room` - join this room when you are waiting for staff.',
      '- `\u{1F50A}\u30FBoffice-1` to `\u{1F50A}\u30FBoffice-4` - private office rooms used by staff.',
      '',
      'If a private discussion is needed, wait in the waiting room and a staff member may move you into an office.',
    ].join('\n'),
  ),
  createBaseEmbed(
    '07 - Good Practices',
    [
      'To keep the server clean and professional:',
      '',
      '- Use the correct channel.',
      '- Avoid spam, flood and unnecessary mentions.',
      '- Do not post private information publicly.',
      '- Keep project, support and agency-related discussions serious.',
      '- If you are unsure where to post, ask staff instead of posting everywhere.',
      '',
      'The goal is to keep the server useful, clear and efficient for everyone.',
    ].join('\n'),
  ),
];

module.exports = createHowToUseEmbeds;
