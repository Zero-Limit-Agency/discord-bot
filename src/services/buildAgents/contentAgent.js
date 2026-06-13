const buildContentAgentRequest = ({ architecture, model, correctionNote = '' }) => ({
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
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Architecture JSON:',
        JSON.stringify(architecture, null, 2),
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
        correctionNote ? `\nCorrection note:\n${correctionNote}` : '',
      ].join('\n'),
    },
  ],
});

module.exports = {
  buildContentAgentRequest,
};
