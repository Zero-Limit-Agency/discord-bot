// Deterministic proposals: never execute an AI-produced feature configuration directly.
const planFeatures = (brief, template) => {
  const source = String(brief || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const requested = {};
  const signals = { tickets: /\b(tickets?|support)\b/, welcome: /\b(welcome|bienvenue|accueil)\b/, goodbye: /\b(goodbye|depart)\b/, tempvoice: /temporary voice|temp.?voice|vocaux temporaires|join.to.create/, autoroles: /auto.?roles?/, rolemenu: /role.?menus?|button roles|select menus|boutons de roles/, logs: /\blogs\b/ };
  const pick = (list, regex) => list.find((item) => regex.test(`${item.id} ${item.name}`.toLowerCase()));
  const channels = template.channels || [];
  const roles = template.roles || [];
  const categories = template.categories || [];
  for (const [feature, regex] of Object.entries(signals)) {
    if (!regex.test(source)) continue;
    if (new RegExp(`(?:sans|pas de|no|without)\\s+(?:systeme de\\s+)?${feature === 'tickets' ? 'tickets?' : feature}`).test(source)) continue;
    requested[feature] = { status: 'needs-configuration' };
  }
  const refs = {
    welcome: pick(channels, /welcome|bienvenue|accueil/), goodbye: pick(channels, /goodbye|depart/), logs: pick(channels, /logs|journal/),
    tickets: pick(channels, /ticket|support/), category: pick(categories, /ticket|support/), staff: pick(roles, /staff|support|moder/),
    join: pick(channels.filter((c) => c.type === 'voice'), /create|creer|join/), voiceCategory: pick(categories, /voca|voice/),
  };
  if (requested.welcome && refs.welcome) requested.welcome.config = { enabled: true, channelId: refs.welcome.id, message: { content: 'Bienvenue {user} sur {server} !', embed: { title: `Bienvenue — ${template.name}`.slice(0, 256), description: 'Consultez les règles et présentez-vous à la communauté.', color: roles.find((r) => r.color)?.color || '#7A1632' } } };
  if (requested.goodbye && refs.goodbye) requested.goodbye.config = { enabled: true, channelId: refs.goodbye.id, message: { content: '{username} a quitté {server}.' } };
  if (requested.logs && refs.logs) requested.logs.config = { enabled: true, channelId: refs.logs.id };
  if (requested.tickets && refs.tickets && refs.category && refs.staff) requested.tickets.config = { enabled: true, channelId: refs.tickets.id, categoryId: refs.category.id, staffRoleIds: [refs.staff.id], maxOpen: 2, types: [{ id: 'support', label: 'Support' }] };
  if (requested.tempvoice && refs.join && refs.voiceCategory) requested.tempvoice.config = { enabled: true, joinChannelId: refs.join.id, categoryId: refs.voiceCategory.id, userLimit: 0 };
  return requested;
};
const resolveFeatureConfig = (config, mapping) => {
  const output = structuredClone(config);
  const resolve = (ref, kind) => {
    const value = mapping[`FUTURE_${kind}_${ref}`];
    if (!value) throw new Error(`Missing feature reference: ${kind}/${ref}`);
    return value;
  };
  for (const key of ['channelId', 'joinChannelId', 'fallbackChannelId']) if (output[key]) output[key] = resolve(output[key], 'CHANNEL');
  if (output.categoryId) output.categoryId = resolve(output.categoryId, 'CATEGORY');
  for (const key of ['staffRoleIds', 'roleIds']) if (output[key]) output[key] = output[key].map((ref) => resolve(ref, 'ROLE'));
  return output;
};
module.exports = { planFeatures, resolveFeatureConfig };
