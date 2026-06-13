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
];

const buildArchitectAgentRequest = ({ prompt, attachment, skillsBlock, model, correctionNote = '' }) => {
  const userSections = [];

  if (prompt) {
    userSections.push(`User brief:\n${prompt}`);
  }

  if (attachment?.text) {
    userSections.push(`Attached source content:\n${attachment.text}`);
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
