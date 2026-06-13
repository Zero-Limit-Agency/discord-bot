const buildPermissionsAgentRequest = ({ architecture, normalizedBrief, model, correctionNote = '' }) => ({
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
        'Use only these supported permissions: view_channel, send_messages, manage_messages, manage_channels, connect, speak, read_message_history, mention_everyone, attach_files, embed_links.',
        'Use the principle of least privilege.',
        'Keep @everyone limited by default.',
        'Every channelOverwrites entry must point to a real channel reference.',
        'Prefer semantic role ids like staff, admin, premium, member.',
        'Never use unsupported permissions like administrator, ban_members, kick_members, manage_roles, manage_server, manage_guild_expressions, add_reactions, use_application_commands, or view_audit_log.',
        'Use the normalized brief when it clarifies audience, required areas, permission hints, onboarding, support, or constraints.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Architecture JSON:',
        JSON.stringify(architecture, null, 2),
        normalizedBrief ? '\nNormalized brief JSON:' : '',
        normalizedBrief ? JSON.stringify(normalizedBrief, null, 2) : '',
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
