const fs = require('node:fs');
const path = require('node:path');
const { normalizeBuildBrief } = require('../src/services/buildBriefNormalizer');
const { evaluateBuildTemplateQuality } = require('../src/services/buildTemplateQualityEvaluator');
const { guardPermissionsOutput } = require('../src/services/buildAgents/schemaGuards');
const { assembleTemplateLocally } = require('../src/services/buildAgents/assemblerAgent');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const fixture = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'templates', 'brief-fixtures', 'brief-premium-private.json'),
  'utf8',
));
const normalizedBrief = normalizeBuildBrief({ prompt: fixture.prompt, attachment: null }).normalizedBrief;

const protectedOverwrites = (roleId) => [
  { target: '@everyone', allow: [], deny: ['view_channel'] },
  { target: roleId, allow: ['view_channel', 'send_messages'], deny: [] },
];

const matchingTemplate = {
  name: 'Premium Private Community',
  description: 'A private premium community for VIP clients.',
  roles: [
    { id: 'staff', key: 'staff', name: 'Staff', permissions: ['view_channel', 'send_messages'] },
    { id: 'vip', key: 'vip', name: 'VIP Premium Member', permissions: ['view_channel', 'send_messages'] },
  ],
  categories: [
    { id: 'public', key: 'public', name: 'Public Welcome' },
    { id: 'support', key: 'support', name: 'Private Support' },
    { id: 'staff', key: 'staff', name: 'Staff Operations' },
    { id: 'vip', key: 'vip', name: 'VIP Private' },
  ],
  channels: [
    {
      id: 'welcome', key: 'welcome', name: 'welcome', type: 'text', categoryId: 'public',
      permissions: [{ target: '@everyone', allow: ['view_channel'], deny: ['send_messages'] }],
    },
    {
      id: 'support', key: 'support', name: 'support-tickets', type: 'text', categoryId: 'support',
      permissions: protectedOverwrites('vip'),
    },
    {
      id: 'staff-chat', key: 'staff-chat', name: 'staff-chat', type: 'text', categoryId: 'staff',
      permissions: protectedOverwrites('staff'),
    },
    {
      id: 'vip-lounge', key: 'vip-lounge', name: 'vip-lounge', type: 'text', categoryId: 'vip',
      permissions: protectedOverwrites('vip'),
    },
  ],
  welcomeEmbeds: [{
    title: 'Bienvenue dans votre espace VIP',
    description: 'Commencez par les informations publiques, utilisez les tickets pour un support prive et rejoignez le salon VIP apres verification de votre acces premium.',
  }],
};

const poorTemplate = {
  ...matchingTemplate,
  roles: [
    { id: 'staff', key: 'staff', name: 'Staff', permissions: ['connect', 'speak'] },
    { id: 'staff-copy', key: 'staff-copy', name: 'Staff', permissions: [] },
  ],
  categories: [{ id: 'public', key: 'public', name: 'Public' }],
  channels: [{
    id: 'general',
    key: 'general',
    name: 'general',
    type: 'text',
    categoryId: 'missing-category',
    permissions: [{ target: 'ghost-role', allow: ['connect'], deny: [] }],
  }],
  welcomeEmbeds: [{ title: 'Welcome', description: 'Read the rules.' }],
};

const goodEvaluation = evaluateBuildTemplateQuality({ normalizedBrief, template: matchingTemplate });
const poorEvaluation = evaluateBuildTemplateQuality({ normalizedBrief, template: poorTemplate });

assert(goodEvaluation.status === 'good', `Expected good fidelity, got ${goodEvaluation.status} (${goodEvaluation.score}).`);
assert(goodEvaluation.score >= 90, `Expected good fidelity score >= 90, got ${goodEvaluation.score}.`);
assert(poorEvaluation.status === 'poor', `Expected poor fidelity, got ${poorEvaluation.status} (${poorEvaluation.score}).`);
assert(poorEvaluation.missingSignals.includes('support'), 'Expected missing support signal.');
assert(poorEvaluation.contradictions.some((item) => item.includes('channel-only voice permission')), 'Expected misplaced role voice permission contradiction.');
assert(poorEvaluation.warnings.some((item) => item.includes('duplicate name')), 'Expected duplicate role warning.');

const guardedPermissions = guardPermissionsOutput({
  rolePermissions: [{ roleId: 'staff', permissions: ['view_channel', 'connect', 'speak'] }],
  channelOverwrites: [{
    channelId: 'staff-chat',
    permissions: [{ target: 'staff', allow: ['view_channel', 'connect', 'speak'], deny: [] }],
  }],
}, {
  architecture: {
    roles: [{ id: 'staff', key: 'staff', name: 'Staff' }],
    categories: [{ id: 'staff', key: 'staff', name: 'Staff Operations' }],
    channels: [{ id: 'staff-chat', key: 'staff-chat', name: 'staff-chat', type: 'text', categoryId: 'staff' }],
  },
});
const guardedRolePermissions = guardedPermissions.output.rolePermissions[0].permissions;
const guardedChannelAllow = guardedPermissions.output.channelOverwrites[0].permissions[0].allow;

assert(!guardedRolePermissions.includes('connect') && !guardedRolePermissions.includes('speak'), 'Expected role voice permissions to be removed.');
assert(!guardedChannelAllow.includes('connect') && !guardedChannelAllow.includes('speak'), 'Expected text-channel voice permissions to be removed.');

const privateAssembly = assembleTemplateLocally({
  architecture: {
    name: 'Protected Staff Hub',
    description: 'Fixture',
    roles: [{ id: 'staff', key: 'staff', name: 'Staff' }],
    categories: [{ id: 'staff', key: 'staff', name: 'Staff Operations' }],
    channels: [{ id: 'staff-chat', key: 'staff-chat', name: 'staff-chat', type: 'text', categoryId: 'staff' }],
  },
  permissions: { rolePermissions: [], channelOverwrites: [] },
  content: { welcomeEmbeds: [], rules: [], onboardingNotes: [], ticketGuidance: [] },
});
const privatePermissions = privateAssembly.template.channels[0].permissions;

assert(privatePermissions.some((entry) => entry.target === '@everyone' && entry.deny.includes('view_channel')), 'Expected inferred private @everyone deny.');
assert(privatePermissions.some((entry) => entry.target === 'staff' && entry.allow.includes('view_channel')), 'Expected inferred staff access.');

console.log(`[PASS] matching template -> ${goodEvaluation.status} (${goodEvaluation.score}/100)`);
console.log(`[PASS] contradictory template -> ${poorEvaluation.status} (${poorEvaluation.score}/100)`);
console.log('[PASS] voice permissions are scoped to voice channels');
console.log('[PASS] inferred staff channel is protected deterministically');
