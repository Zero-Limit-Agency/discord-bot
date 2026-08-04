const { createAgentBrief } = require('../buildBriefNormalizer');

const BASE_SYSTEM_LINES = [
  'You are the Architect Agent for Discord server generation.',
  'Return exactly one valid JSON object.',
  'Do not use markdown.',
  'Do not add prose before or after the JSON.',
  'Keep the structure high-level but complete enough to be usable.',
  'Do not generate detailed permission overwrites yet.',
  'Use supported channel types only: text, voice, announcement, forum.',
  'Use stable ids/keys in kebab-case.',
  'Never use placeholders like role-1, channel-1, category-1 when a real semantic id is possible.',
  'Every role, category, and channel must have a stable id and key.',
  'If details are missing, make reasonable professional choices.',
  'Respect explicit areas, channels, roles, support needs, onboarding needs, and premium/private constraints from the user brief.',
  'If the brief mentions scrims, tournaments, tryouts, premium/VIP areas, creator spaces, support, or staff areas, include them in the architecture.',
  'For content creator teams, prefer at least creator and staff/moderation roles when the brief implies managed community spaces.',
  'For premium/private communities, make the public area minimal and keep staff/premium zones distinct.',
];

const buildArchitectAgentRequest = ({
  prompt,
  attachment,
  normalizedBrief,
  skillsBlock,
  model,
  correctionNote = '',
  preparedBriefText = null,
}) => {
  const userSections = [];

  if (preparedBriefText) {
    userSections.push(`User brief:\n${preparedBriefText}`);
  } else if (prompt) {
    userSections.push(`User brief:\n${prompt}`);
  }

  if (attachment?.text && !preparedBriefText) {
    userSections.push(`Attached source content:\n${attachment.text}`);
  }

  if (normalizedBrief) {
    userSections.push([
      'Normalized brief JSON:',
      JSON.stringify(createAgentBrief(normalizedBrief), null, 2),
      '',
      'Use this structured brief to understand audience, goals, roles, areas, constraints, and assumptions.',
      'Respect explicit user constraints and only make reasonable assumptions when required.',
    ].join('\n'));
  }

  userSections.push([
    'Return this exact JSON shape:',
    '{',
    '  "name": "string",',
    '  "description": "string",',
    '  "purpose": "string",',
    '  "roles": [],',
    '  "categories": [],',
    '  "channels": [],',
    '  "notes": []',
    '}',
  ].join('\n'));

  userSections.push([
    'Minimal example:',
    '{',
    '  "name": "Zero Limit Hub",',
    '  "description": "Competitive community and staff operations server.",',
    '  "purpose": "Esports team coordination and community growth.",',
    '  "roles": [{"id":"staff","key":"staff","name":"Staff"}],',
    '  "categories": [{"id":"information","key":"information","name":"Information"}],',
    '  "channels": [{"id":"welcome","key":"welcome","name":"welcome","type":"text","categoryId":"information"}],',
    '  "notes": []',
    '}',
  ].join('\n'));

  if (correctionNote) {
    userSections.push(`Correction note:\n${correctionNote}`);
  }

  const messages = [
    {
      role: 'system',
      content: BASE_SYSTEM_LINES.join('\n'),
    },
  ];

  if (skillsBlock?.content) {
    messages.push({
      role: 'system',
      content: `Use these compact Discord architecture skills:\n\n${skillsBlock.content}`,
    });
  }

  messages.push({
    role: 'user',
    content: userSections.join('\n\n'),
  });

  return {
    model,
    temperature: 0.1,
    messages,
  };
};

module.exports = {
  buildArchitectAgentRequest,
};
