const { createAgentBrief } = require('../buildBriefNormalizer');

const buildContentAgentRequest = ({ architecture, normalizedBrief, model, correctionNote = '' }) => ({
  model,
  temperature: 0.2,
  messages: [
    {
      role: 'system',
      content: [
        'You are the Content Agent for Discord server generation.',
        'Return exactly one valid JSON object.',
        'Do not use markdown.',
        'Do not add prose before or after the JSON.',
        'Keep onboarding clear, concise, and professional.',
        'welcomeEmbeds must be an array of embed objects, not plain paragraphs.',
        'Do not invent new roles, categories, or channels.',
        'If you reference a channel or role in notes, use only ids already present in the architecture JSON.',
        'Keep embed text short, clean, and valid for Discord.',
        'Do not return filler like "read the rules and use the right channels" unless you also reference the actual useful channels for this server.',
        'Adapt the content to the server type, tone, audience, onboarding hints, support hints, and explicit constraints from the normalized brief.',
        'If the architecture includes support or ticket channels, add practical support guidance.',
        'If the architecture includes onboarding or information channels, add actionable onboarding notes.',
        'If the architecture is esports, mention announcements, team/player areas, scrims, tournaments, support, or premium areas when they exist.',
        'If the architecture is content creator oriented, mention media, announcements, partnerships, support, and community flow when they exist.',
        'If the architecture is premium/private, keep the tone polished and mention access flow, support path, and private member spaces when they exist.',
        'If no rule/support/ticket guidance is needed, return empty arrays instead of filler text.',
        'Use the normalized brief to respect tone, goals, onboarding hints, support hints, and explicit constraints.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Architecture JSON:',
        JSON.stringify(architecture, null, 2),
        normalizedBrief ? '\nNormalized brief JSON:' : '',
        normalizedBrief ? JSON.stringify(createAgentBrief(normalizedBrief), null, 2) : '',
        '',
        'Return this exact JSON shape:',
        '{',
        '  "welcomeEmbeds": [],',
        '  "rules": [],',
        '  "onboardingNotes": [],',
        '  "ticketGuidance": []',
        '}',
        '',
        'Minimal welcome embed example:',
        '{"title":"Welcome","description":"Read the rules and start in welcome."}',
        '',
        'Minimal onboarding note example:',
        '{"channelId":"welcome-message","text":"Start in welcome-message and read the rules."}',
        '',
        'When relevant, prefer 2 useful welcome embeds over 1 generic embed.',
        'Example useful support guidance:',
        '{"channelId":"support-chat","text":"Use support-chat for member help and keep issue reports clear and concise."}',
        correctionNote ? `\nCorrection note:\n${correctionNote}` : '',
      ].join('\n'),
    },
  ],
});

module.exports = {
  buildContentAgentRequest,
};
