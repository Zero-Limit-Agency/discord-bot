const createSimulatedId = (prefix, value) => `MOCK_${prefix}_${String(value).replace(/[^A-Za-z0-9_]/g, '_')}`;

const createRole = async ({ templateRef, payload }) => ({
  ok: true,
  action: 'createRole',
  templateRef,
  simulatedId: createSimulatedId('ROLE', templateRef),
  payload,
});

const createCategory = async ({ templateRef, payload }) => ({
  ok: true,
  action: 'createCategory',
  templateRef,
  simulatedId: createSimulatedId('CATEGORY', templateRef),
  payload,
});

const createChannel = async ({ templateRef, payload }) => ({
  ok: true,
  action: 'createChannel',
  templateRef,
  simulatedId: createSimulatedId('CHANNEL', templateRef),
  payload,
});

const applyPermissionOverwrite = async ({ targetChannelRef, roleRef, payload }) => ({
  ok: true,
  action: 'applyPermissionOverwrite',
  targetChannelRef,
  roleRef,
  simulatedId: createSimulatedId('OVERWRITE', `${targetChannelRef}_${roleRef || 'everyone'}`),
  payload,
});

const postOnboardingEmbed = async ({ targetChannelRef, payload }) => ({
  ok: true,
  action: 'postOnboardingEmbed',
  targetChannelRef,
  simulatedId: createSimulatedId('EMBED', targetChannelRef || 'broadcast'),
  payload,
});

module.exports = {
  createRole,
  createCategory,
  createChannel,
  applyPermissionOverwrite,
  postOnboardingEmbed,
};
