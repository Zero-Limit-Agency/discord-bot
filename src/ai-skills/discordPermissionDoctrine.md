# Discord Permission Doctrine

Apply least privilege by default.

- @everyone should be limited and safe by default.
- Sensitive categories must be protected explicitly.
- Staff powers should be separated from community powers.
- Do not grant moderation permissions casually.
- Do not grant management permissions to roles that only need access.
- Use explicit overwrites where confidentiality matters.
- Keep announcement channels controlled.
- Keep media and showcase channels more restrictive than general chat when appropriate.
- Support and ticket areas should expose only the right people.
- Premium and partner areas should be intentionally restricted, never globally open by mistake.
- Voice permissions should be adapted to voice roles, not copied from text channels.
- Read-only channels should deny sending, not just rely on convention.

Reason role by role and channel by channel.
Do not assume one global permission posture is enough.

Supported permissions in this system are only:
- view_channel
- send_messages
- manage_messages
- manage_channels
- connect
- speak
- read_message_history
- mention_everyone
- attach_files
- embed_links
