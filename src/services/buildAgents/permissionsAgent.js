const buildPermissionsAgentRequest = ({ architecture, model, correctionNote = '' }) => ({
  model,
  temperature: 0.1,
  messages: [
    {
      role: 'system',
      content: [
        'You are the Permissions Agent for Discord server generation.',
        'Return exactly one valid JSON object.',
        'Do not use markdown.',
        'Do not add prose before or after the JSON.',
        'Use supported permissions only.',
        'Use the principle of least privilege.',
        'Keep @everyone limited by default.',
        'Every channelOverwrites entry must point to a real channel reference.',
        'Prefer semantic role ids like staff, admin, premium, member.',
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
        '  "rolePermissions": [],',
        '  "channelOverwrites": [],',
        '  "permissionNotes": []',
        '}',
        '',
        'Minimal overwrite example:',
        '{',
        '  "channelId": "welcome",',
        '  "permissions": [{ "target": "@everyone", "allow": ["view_channel"], "deny": ["send_messages"] }]',
        '}',
        correctionNote ? `\nCorrection note:\n${correctionNote}` : '',
      ].join('\n'),
    },
  ],
});

module.exports = {
  buildPermissionsAgentRequest,
};
