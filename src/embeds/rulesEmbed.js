const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const createBaseEmbed = (title, description) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(title)
  .setDescription(description);

const createRulesEmbeds = () => {
  const embeds = [
    createBaseEmbed(
      'RULES',
      [
        'Welcome to **Zero Limit Agency**.',
        '',
        'This server is a professional space dedicated to the agency, projects, collaborations, training, opportunities and community updates.',
        '',
        'By staying on this server, you agree to respect the rules below, the members, the staff, and the image of Zero Limit Agency.',
        '',
        'Please also respect Discord’s Terms of Service and Community Guidelines.',
      ].join('\n'),
    ),
    createBaseEmbed(
      '01 — Server Behavior',
      [
        'Use each channel correctly and keep discussions where they belong.',
        '',
        'Keep conversations clean, readable and useful for the people who need to follow them later.',
        '',
        'Avoid spam, flood, useless mentions, repeated messages, unnecessary caps, or behavior that creates noise for no reason.',
        '',
        'Stay on topic in project, client, training, announcement and support channels.',
        '',
        'Off-topic or low-effort messages may be removed to keep the server organized.',
      ].join('\n'),
    ),
    createBaseEmbed(
      '02 — Respect & Safety',
      [
        'Respect is mandatory in every part of this server.',
        '',
        'Harassment, threats, insults, discrimination, racism, sexism, hate speech and personal attacks are not tolerated.',
        '',
        'Do not post NSFW, shocking, violent, illegal, scam, phishing or dangerous content.',
        '',
        'Impersonation, fake accounts, suspicious behavior or misleading identities are prohibited.',
        '',
        'If you see something suspicious, report it to the staff instead of escalating it publicly.',
      ].join('\n'),
    ),
    createBaseEmbed(
      '03 — Confidentiality & Professionalism',
      [
        'Internal information must stay private.',
        '',
        'Do not share screenshots, conversations, documents, strategies, client information, project details, private announcements or internal content without permission.',
        '',
        'Information related to clients, players, managers, partners, staff and agency projects must be treated seriously.',
        '',
        'This server represents Zero Limit Agency, and members are expected to behave professionally in important channels.',
      ].join('\n'),
    ),
    createBaseEmbed(
      '04 — Promotion & External Links',
      [
        'Advertising, self-promotion, recruitment, server invites, product or service promotion, and external links are not allowed without staff approval.',
        '',
        'Do not use this server to redirect members to personal projects, offers, teams, agencies or communities without permission.',
        '',
        'Useful links may be shared only when they are clearly relevant to the conversation and allowed by the staff.',
      ].join('\n'),
    ),
    createBaseEmbed(
      '05 — Staff & Sanctions',
      [
        'Staff decisions must be respected.',
        '',
        'If there is an issue, contact the staff calmly instead of creating public drama inside the server.',
        '',
        'Do not bypass rules, sanctions, permissions or moderation decisions.',
        '',
        'Breaking the rules may result in a reminder, warning, mute, kick, temporary ban or permanent ban depending on the situation.',
        '',
        'The staff may intervene if a behavior harms the server, even if it is not listed word for word in the rules.',
      ].join('\n'),
    ),
    createBaseEmbed(
      'Final Words',
      [
        'Zero Limit Agency is built around ambition, structure, trust and progression.',
        '',
        'Respect the server, respect the people, protect internal information, and help us keep this place clean, serious and useful.',
      ].join('\n'),
    ),
  ];

  if (config.rulesBannerUrl) {
    embeds[0].setImage(config.rulesBannerUrl);
  }

  return embeds;
};

module.exports = createRulesEmbeds;
