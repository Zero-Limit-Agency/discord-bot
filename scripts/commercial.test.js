const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const project = path.resolve(__dirname, '..');
const originalCwd = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zla-commercial-'));
process.chdir(temporary);
const originalOwner = process.env.ZERO_LIMIT_OWNER_IDS;
const originalFetch = global.fetch;
const ids = { guild: '111111111111111111', other: '222222222222222222', owner: '333333333333333333', staff: '444444444444444444', user: '555555555555555555', bot: '666666666666666666', role: '777777777777777777', staffRole: '888888888888888888' };
const { store, createStore, serial } = require('../src/repositories/commercialStore');
const access = require('../src/services/managed/access');
const { message } = require('../src/services/managed/messages');
let sequence = 900000000000000000n;
const nextId = () => String(++sequence);
const license = (guildId = ids.guild, patch = {}) => store.update(guildId, (s) => { s.license = { active: true, expiresAt: new Date(Date.now() + 86400000).toISOString(), features: [...access.FEATURES], ...patch }; });
const fakeGuild = () => {
  const members = new Collection();
  const roles = new Collection();
  const channels = new Collection();
  const sent = [];
  const guild = { id: ids.guild, name: 'Acme Esport', memberCount: 4, features: ['COMMUNITY'], sent };
  guild.roles = { cache: roles, everyone: { id: ids.guild }, fetch: async (id) => id ? roles.get(id) || null : roles, create: async (options) => { const role = { ...options, id: nextId(), position: 1, permissions: new PermissionsBitField(options.permissions), editable: true, managed: false, comparePositionTo: () => -1 }; roles.set(role.id, role); return role; } };
  guild.roles.setPositions = async (positions) => { for (const item of positions) roles.get(item.role).position = item.position; return roles; };
  const createChannel = async (options) => {
    const channel = { ...options, id: nextId(), guildId: guild.id, guild, type: options.type ?? 0, members: new Collection(), deleted: false, messages: {} };
    const overwrites = new Collection((options.permissionOverwrites || []).map((o) => [o.id, { ...o, allow: new PermissionsBitField(o.allow || 0n), deny: new PermissionsBitField(o.deny || 0n) }]));
    channel.permissionOverwrites = { cache: overwrites, create: async (id, changes) => channel.permissionOverwrites.edit(id, changes), edit: async (id, changes) => {
      const ow = overwrites.get(id) || { id, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
      for (const [key, value] of Object.entries(changes)) { if (value === true) { ow.allow.add(P[key]); ow.deny.remove(P[key]); } if (value === false) { ow.deny.add(P[key]); ow.allow.remove(P[key]); } }
      overwrites.set(id, ow); return ow;
    }, delete: async (id) => overwrites.delete(id) };
    const messages = new Collection();
    channel.send = async (payload) => {
      const msg = { id: nextId(), author: { id: ids.bot }, content: payload.content || '', embeds: payload.embeds || [], components: payload.components || [], attachments: new Collection(), createdAt: new Date(), payload, webhookId: null };
      msg.fetch = async () => msg;
      msg.edit = async (p) => { Object.assign(msg, p); return msg; };
      messages.set(msg.id, msg); sent.push(msg); return msg;
    };
    channel.messages.fetch = async (query) => typeof query === 'string' ? messages.get(query) : new Collection([...messages].filter(([id]) => !query.before || BigInt(id) < BigInt(query.before)).slice(-query.limit).reverse());
    channel.isTextBased = () => [0, 5].includes(channel.type);
    channel.isThread = () => false;
    channel.permissionsFor = () => new PermissionsBitField(P.Administrator);
    channel.delete = async () => { channel.deleted = true; channels.delete(channel.id); };
    channel.setName = async (name) => { channel.name = name; };
    channel.setUserLimit = async (count) => { channel.userLimit = count; };
    channels.set(channel.id, channel);
    return channel;
  };
  guild.channels = { cache: channels, fetch: async (id) => id ? channels.get(id) || null : channels, create: createChannel };
  const addMember = (id, admin = false, assigned = []) => {
    const member = { id, guild, user: { id, username: `member-${id.slice(-3)}`, bot: id === ids.bot }, permissions: new PermissionsBitField(admin ? P.Administrator : 0n), roles: { cache: new Collection(assigned.map((id) => [id, { id }])) }, voice: { channelId: null, channel: null } };
    member.roles.highest = { position: admin ? 100 : 1 };
    member.roles.add = async (roleId) => { member.roles.cache.set(roleId, roles.get(roleId)); };
    member.roles.remove = async (roleId) => { member.roles.cache.delete(roleId); };
    member.voice.setChannel = async (channel) => {
      member.voice.channel?.members.delete(member.id);
      member.voice.channelId = channel.id; member.voice.channel = channel; channel.members.set(member.id, member);
    };
    members.set(id, member); return member;
  };
  guild.members = { cache: members, fetch: async (id) => id ? members.get(id) : members, fetchMe: async () => members.get(ids.bot) };
  guild.members.me = addMember(ids.bot, true);
  addMember(ids.owner, true); addMember(ids.user); addMember(ids.staff, false, [ids.staffRole]);
  for (const id of [ids.role, ids.staffRole]) roles.set(id, { id, name: id === ids.role ? 'Member' : 'Staff', editable: true, managed: false, position: 2, comparePositionTo: () => -1, permissions: new PermissionsBitField() });
  return guild;
};
const interaction = (guild, customId, userId = ids.owner, values = {}) => {
  const replies = [];
  const i = { guildId: guild.id, guild, customId, user: guild.members.cache.get(userId).user, member: guild.members.cache.get(userId), client: { user: { id: ids.bot } }, channelId: values.channelId, channel: guild.channels.cache.get(values.channelId), message: values.message, values: values.values || [], replies, deferred: false,
    fields: { getTextInputValue: (key) => values[key] || '' },
    options: { getSubcommand: () => values.action, getString: (key) => values[key] ?? null, getInteger: (key) => values[key], getUser: (key) => values[key], getAttachment: () => null },
    reply: async (payload) => { replies.push(payload); i.replied = true; }, editReply: async (payload) => { replies.push(payload); }, deferReply: async () => { i.deferred = true; }, showModal: async (modal) => { replies.push(modal); },
  };
  return i;
};
after(() => { global.fetch = originalFetch; if (originalOwner === undefined) delete process.env.ZERO_LIMIT_OWNER_IDS; else process.env.ZERO_LIMIT_OWNER_IDS = originalOwner; process.chdir(originalCwd); fs.rmSync(temporary, { recursive: true, force: true }); });

test('owner checks fail closed; guild admins cannot build or license', async () => {
  const { isOwner } = require('../src/utils/permissions');
  delete process.env.ZERO_LIMIT_OWNER_IDS;
  assert.equal(isOwner(ids.owner), false);
  process.env.ZERO_LIMIT_OWNER_IDS = ids.owner;
  assert.equal(isOwner(ids.owner), true);
  const guild = fakeGuild();
  const i = interaction(guild, null, ids.user);
  await require('../src/commands/build').execute(i);
  assert.match(i.replies[0].content, /permission/);
  assert.throws(() => access.requireOwner(interaction(guild, null, ids.staff)), /réservée/);
});
test('atomic repositories isolate guilds, survive reload, and fail closed on corruption', () => {
  license(); license(ids.other, { features: [] });
  assert.equal(access.enabled(ids.guild, 'tickets'), true);
  assert.equal(access.enabled(ids.other, 'tickets'), false);
  const fresh = createStore();
  assert.equal(fresh.read(ids.guild).guildId, ids.guild);
  assert.throws(() => fresh.read('../escape'), /Invalid/);
  const corrupt = '999999999999999999';
  fs.writeFileSync(path.join(temporary, '.data/commercial', `${corrupt}.json`), '{');
  assert.throws(() => fresh.read(corrupt));
  assert.throws(() => fresh.update(corrupt, () => {}));
  assert.equal(fs.statSync(path.join(temporary, '.data/commercial', `${ids.guild}.json`)).mode & 0o777, 0o600);
});
test('concurrent guild operations retain all changes', async () => {
  await Promise.all(Array.from({ length: 12 }, (_, n) => serial(ids.guild, async () => {
    await Promise.resolve(); store.update(ids.guild, (s) => { s.presets[`p${n}`] = { content: String(n) }; });
  })));
  assert.equal(Object.keys(store.read(ids.guild).presets).length, 12);
});
test('license lifecycle preserves resources and configs across expiry/disable/reactivation', async () => {
  const guild = fakeGuild();
  const command = require('../src/commands/license');
  store.update(ids.guild, (s) => { s.features.welcome = { enabled: true, channelId: 'kept' }; });
  await command.execute(interaction(guild, null, ids.owner, { action: 'activate', days: 2, features: 'panel,tickets' }));
  assert.equal(access.enabled(ids.guild, 'tickets'), true);
  await command.execute(interaction(guild, null, ids.owner, { action: 'disable' }));
  assert.equal(access.enabled(ids.guild, 'tickets'), false);
  assert.equal(store.read(ids.guild).features.welcome.channelId, 'kept');
  await command.execute(interaction(guild, null, ids.owner, { action: 'extend', days: 1 }));
  assert.equal(access.enabled(ids.guild, 'tickets'), true);
  await command.execute(interaction(guild, null, ids.owner, { action: 'features', features: 'panel' }));
  assert.equal(access.enabled(ids.guild, 'tickets'), false);
  license(ids.guild, { expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.equal(access.enabled(ids.guild, 'panel'), false);
  license();
});
test('embeds accept embed-only content, placeholders, fields/assets/footer and enforce limits', () => {
  const p = message({ content: '', embed: { title: '{server}', description: 'Hello {username}', fields: [{ name: 'A', value: 'B' }], color: '#112233', image: 'https://example.com/a.png', thumbnail: 'https://example.com/b.png', footer: { text: 'Footer' } } }, { server: 'Acme', username: '@everyone' });
  assert.equal(p.embeds[0].title, 'Acme'); assert.deepEqual(p.allowedMentions.parse, []);
  assert.throws(() => message({ content: '' }), /vide/);
  assert.throws(() => message({ embed: { title: 'x', image: 'http://127.0.0.1' } }), /HTTPS/);
  assert.throws(() => message({ embed: { description: 'a'.repeat(4096), fields: Array.from({ length: 3 }, () => ({ name: 'A', value: 'b'.repeat(1024) })) } }), /6000/);
});
test('admin panel rejects nonadmins, expired licenses and unlicensed module modals', async () => {
  const { handleAdmin } = require('../src/services/managed/adminPanel');
  const guild = fakeGuild();
  await assert.rejects(handleAdmin(interaction(guild, 'zl:admin:config:tickets', ids.user)), /Administrateur/);
  license(ids.guild, { features: ['panel'] });
  await assert.rejects(handleAdmin(interaction(guild, 'zl:admin:save:tickets', ids.owner, { json: '{"enabled":false}' })), /Licence/);
  license();
  const i = interaction(guild, 'zl:admin:config:tickets'); await handleAdmin(i);
  assert.equal(i.replies[0].data.custom_id, 'zl:admin:save:tickets');
});
test('ticket flow: concurrent limits, private creation, claim/unclaim, close/reopen/transcript, restart', async () => {
  const { configure } = require('../src/services/managed/configuration');
  const { handleTicket, reconcileTickets } = require('../src/services/managed/tickets');
  const guild = fakeGuild();
  const category = await guild.channels.create({ name: 'Support', type: 4 });
  const panel = await guild.channels.create({ name: 'Support panel', type: 0 });
  await configure(interaction(guild), 'tickets', { enabled: true, categoryId: category.id, channelId: panel.id, staffRoleIds: [ids.staffRole], maxOpen: 1, types: [{ id: 'help', label: 'Aide' }, { id: 'sales', label: 'Devis' }] });
  const outcomes = await Promise.allSettled([1, 2].map(() => handleTicket(interaction(guild, 'zl:ticket:submit:help', ids.user, { subject: 'Private request' }))));
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  const ticket = Object.values(store.read(ids.guild).tickets).find((t) => t.status === 'open');
  const channel = guild.channels.cache.get(ticket.channelId);
  assert.equal(channel.permissionOverwrites.cache.get(ids.guild).deny.has(P.ViewChannel), true);
  assert.equal(channel.permissionOverwrites.cache.get(ids.user).allow.has(P.ViewChannel), true);
  assert.equal(channel.permissionOverwrites.cache.get(ids.staffRole).allow.has(P.ViewChannel), true);
  const act = (action, user = ids.staff) => handleTicket(interaction(guild, `zl:ticket:${action}:${ticket.id}`, user, { channelId: channel.id }));
  await assert.rejects(act('claim', ids.user), /staff/);
  await act('claim'); assert.equal(store.read(ids.guild).tickets[ticket.id].claimedBy, ids.staff);
  await act('unclaim'); assert.equal(store.read(ids.guild).tickets[ticket.id].claimedBy, null);
  await act('close', ids.user); assert.equal(store.read(ids.guild).tickets[ticket.id].status, 'closed');
  await act('reopen'); assert.equal(store.read(ids.guild).tickets[ticket.id].status, 'open');
  const exportInteraction = interaction(guild, `zl:ticket:transcript:${ticket.id}`, ids.staff, { channelId: channel.id });
  await handleTicket(exportInteraction); assert.equal(exportInteraction.replies.at(-1).files.length, 1);
  assert.equal(fs.statSync(path.join(temporary, '.data/commercial/transcripts', ids.guild, `${ticket.id}.json`)).mode & 0o777, 0o600);
  assert.equal(createStore().read(ids.guild).tickets[ticket.id].ownerId, ids.user);
  license(ids.guild, { active: false });
  await assert.rejects(act('close', ids.user), /Licence/);
  assert.equal(guild.channels.cache.has(channel.id), true);
  license();
  await channel.delete(); await reconcileTickets(guild);
  assert.equal(store.read(ids.guild).tickets[ticket.id].status, 'missing');
});
test('welcome/goodbye are guild scoped, use fallback, skip expired automation, autoroles recheck hierarchy', async () => {
  const { configure } = require('../src/services/managed/configuration');
  const { memberEvent } = require('../src/services/managed/memberEvents');
  const guild = fakeGuild(); const primary = await guild.channels.create({ type: 0 }); const fallback = await guild.channels.create({ type: 0 });
  const admin = interaction(guild);
  await configure(admin, 'welcome', { enabled: true, channelId: primary.id, fallbackChannelId: fallback.id, message: { embed: { title: 'Bienvenue {username} — {server}' } } });
  await configure(admin, 'goodbye', { enabled: true, channelId: fallback.id, message: { content: 'Au revoir {username}' } });
  await configure(admin, 'autoroles', { enabled: true, roleIds: [ids.role] });
  const member = guild.members.cache.get(ids.user); await primary.delete();
  await memberEvent(member, 'welcome'); assert.match(guild.sent.at(-1).embeds[0].title, /Acme Esport/); assert.equal(member.roles.cache.has(ids.role), true);
  await memberEvent(member, 'goodbye'); assert.match(guild.sent.at(-1).content, /Au revoir/);
  const before = guild.sent.length; license(ids.guild, { active: false }); await memberEvent(member, 'welcome'); assert.equal(guild.sent.length, before); license();
  guild.roles.cache.get(ids.role).permissions.add(P.Administrator);
  await assert.rejects(configure(admin, 'autoroles', { enabled: true, roleIds: [ids.role] }), /Rôle/);
});
test('role buttons and select menus persist, preserve unrelated roles and reject privileged roles', async () => {
  const { configure } = require('../src/services/managed/configuration');
  const { handleRoles } = require('../src/services/managed/roles');
  const guild = fakeGuild(); const channel = await guild.channels.create({ type: 0 });
  const settings = { enabled: true, channelId: channel.id, mode: 'buttons', roles: [{ roleId: ids.role, label: 'Membre' }] };
  await configure(interaction(guild), 'rolemenu', settings);
  const click = (customId, values = []) => interaction(guild, customId, ids.user, { channelId: channel.id, message: { id: store.read(ids.guild).features.rolemenu.panelMessageId }, values });
  await handleRoles(click(`zl:roles:toggle:${ids.role}`)); assert.equal(guild.members.cache.get(ids.user).roles.cache.has(ids.role), true);
  await handleRoles(click(`zl:roles:toggle:${ids.role}`)); assert.equal(guild.members.cache.get(ids.user).roles.cache.has(ids.role), false);
  await configure(interaction(guild), 'rolemenu', { ...settings, mode: 'select' });
  await handleRoles(click('zl:roles:select', [ids.role])); assert.equal(guild.members.cache.get(ids.user).roles.cache.has(ids.role), true);
  await handleRoles(click('zl:roles:select', [])); assert.equal(guild.members.cache.get(ids.user).roles.cache.has(ids.role), false);
  guild.roles.cache.get(ids.role).permissions.add(P.ManageRoles);
  await assert.rejects(handleRoles(click('zl:roles:select', [ids.role])), /Rôle/);
  license(ids.guild, { active: false }); await assert.rejects(handleRoles(click('zl:roles:select', [])), /Licence/); license();
});
test('tempvoice: create, rename, limit, lock/unlock, transfer, expiry preservation and restart cleanup', async () => {
  const { configure } = require('../src/services/managed/configuration');
  const { voiceUpdate, controlVoice, reconcileVoice } = require('../src/services/managed/voice');
  const guild = fakeGuild(); const parent = await guild.channels.create({ type: 4 }); const join = await guild.channels.create({ type: 2 });
  await configure(interaction(guild), 'tempvoice', { enabled: true, categoryId: parent.id, joinChannelId: join.id, userLimit: 3 });
  const member = guild.members.cache.get(ids.user); await member.voice.setChannel(join);
  await voiceUpdate({ channelId: null }, { guild, channelId: join.id, member, id: member.id });
  const created = member.voice.channel; assert.notEqual(created.id, join.id); assert.equal(created.userLimit, 3);
  for (const values of [{ action: 'rename', name: 'Mon vocal' }, { action: 'limit', count: 5 }, { action: 'lock' }, { action: 'unlock' }]) await controlVoice(interaction(guild, null, ids.user, values));
  assert.equal(created.name, 'Mon vocal'); assert.equal(created.userLimit, 5);
  const next = guild.members.cache.get(ids.staff); await next.voice.setChannel(created);
  await controlVoice(interaction(guild, null, ids.user, { action: 'transfer', member: next.user }));
  assert.equal(store.read(ids.guild).voices[created.id].ownerId, next.id);
  created.members.clear(); license(ids.guild, { active: false }); await reconcileVoice(guild); assert.equal(created.deleted, false);
  license(); await reconcileVoice(guild); assert.equal(created.deleted, true); assert.equal(store.read(ids.guild).voices[created.id], undefined);
});
test('embed presets save/preview/send/edit persist and accept embed-only messages', async () => {
  const { handleAdmin } = require('../src/services/managed/adminPanel');
  const guild = fakeGuild(); const channel = await guild.channels.create({ type: 0 });
  const act = async (action, values = {}) => { const i = interaction(guild, `zl:admin:embedsubmit:${action}`, ids.owner, { name: 'welcome', channel: channel.id, ...values }); await handleAdmin(i); return i; };
  await act('save', { json: JSON.stringify({ content: '', embed: { title: 'Acme {server}' } }) });
  assert.ok(createStore().read(ids.guild).presets.welcome);
  const preview = await act('preview'); assert.match(preview.replies.at(-1).embeds[0].title, /Acme/);
  await act('send'); const sent = guild.sent.at(-1);
  await act('save', { json: JSON.stringify({ embed: { description: 'Changed' } }) });
  await act('edit', { message: sent.id }); assert.equal(sent.embeds[0].description, 'Changed');
});
test('logs record only metadata, honor per-guild channels and fail safely on unavailable network', async () => {
  const { audit } = require('../src/services/managed/audit');
  const guild = fakeGuild(); const channel = await guild.channels.create({ type: 0 });
  store.update(guild.id, (s) => { s.features.logs = { enabled: true, channelId: channel.id }; });
  await audit(guild, 'test.action', ids.owner, ids.user);
  assert.match(guild.sent.at(-1).content, /test.action/);
  assert.deepEqual(Object.keys(store.read(guild.id).audit.at(-1)).sort(), ['action', 'actorId', 'at', 'targetId']);
  channel.send = async () => { throw Object.assign(new Error('offline'), { code: 'ECONNRESET' }); };
  await audit(guild, 'test.network', ids.owner);
  assert.equal(store.read(ids.guild).audit.at(-1).action, 'test.network');
});
test('features planner separates configuration proposals, resolves mapped refs and obeys exclusions', () => {
  const { planFeatures, resolveFeatureConfig } = require('../src/services/featuresPlanner');
  const plan = planFeatures('welcome tickets sans tempvoice', { name: 'Acme', channels: [{ id: 'welcome', name: 'Bienvenue' }, { id: 'tickets', name: 'support' }], categories: [{ id: 'support', name: 'support' }], roles: [{ id: 'staff', name: 'Staff', color: '#123456' }] });
  assert.equal(plan.welcome.config.message.embed.color, '#123456'); assert.ok(plan.tickets.config); assert.equal(plan.tempvoice, undefined);
  assert.deepEqual(resolveFeatureConfig({ channelId: 'welcome' }, { FUTURE_CHANNEL_welcome: '123' }), { channelId: '123' });
  assert.throws(() => resolveFeatureConfig({ channelId: 'missing' }, {}), /Missing/);
  assert.equal(planFeatures('sans tickets', {}).tickets, undefined);
});
test('AI provider selection, network failure and malformed responses are deterministic and free', async () => {
  const { getProvider } = require('../src/services/aiProvider');
  const { callLmStudio } = require('../src/services/lmStudioClient');
  for (const [name, modelKey] of [['ollama', 'OLLAMA_MODEL'], ['nvidia', 'NVIDIA_MODEL'], ['lmstudio', 'LMSTUDIO_MODEL']]) {
    process.env.AI_PROVIDER = name;
    if (name === 'lmstudio') require('../src/config').lmStudioModel = 'test-model'; else process.env[modelKey] = 'test-model';
    if (name === 'nvidia') process.env.NVIDIA_API_KEY = 'test-not-a-secret';
    assert.equal(getProvider().name, name);
    global.fetch = async (_, options) => { assert.equal(JSON.parse(options.body).model, 'test-model'); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { headers: { 'content-type': 'application/json' } }); };
    assert.equal((await callLmStudio({ messages: [] })).ok, true);
  }
  global.fetch = async () => { throw new TypeError('simulated network error'); };
  assert.equal((await callLmStudio({})).code, 'REQUEST_FAILED');
  global.fetch = async () => new Response('{}');
  assert.equal((await callLmStudio({})).code, 'INVALID_RESPONSE');
  global.fetch = originalFetch; delete process.env.AI_PROVIDER; delete process.env.NVIDIA_API_KEY; delete process.env.NVIDIA_MODEL; delete process.env.OLLAMA_MODEL;
});
test('live adapter creates private channels with overwrites in the creation request', async () => {
  const { createLiveDiscordExecutionAdapter } = require('../src/services/executionAdapters/discordLiveExecutionAdapter');
  const guild = fakeGuild(); const adapter = createLiveDiscordExecutionAdapter(guild);
  const result = await adapter.createChannel({ templateRef: 'staff', payload: { name: 'staff', type: 0, permissionOverwrites: [{ roleRef: '@everyone', allow: '0', deny: String(P.ViewChannel) }, { roleRef: 'staff', allow: String(P.ViewChannel), deny: '0' }] }, resolvedRoleRefs: { FUTURE_ROLE_staff: ids.staffRole } });
  assert.equal(result.ok, true); assert.equal(guild.channels.cache.get(result.runtimeId).permissionOverwrites.cache.get(ids.guild).deny.has(P.ViewChannel), true);
});
test('full deterministic build: normalize, repair, validate, dry-run, execute, verify, persist mapping', async () => {
  const build = require('../src/commands/build');
  const fixture = JSON.parse(fs.readFileSync(path.join(project, 'templates/fixtures/esport-simple.json'), 'utf8'));
  const processed = await build._test.processTemplateCandidate(fixture, JSON.stringify(fixture), null, 'commercial-safe');
  assert.equal(processed.generatedTemplate.valid, true); assert.equal(processed.buildReport.ok, true);
  const { createBuildJob } = require('../src/services/buildJobService');
  createBuildJob({ runId: 'commercial-safe', guildId: ids.guild });
  const { deliverBuild } = require('../src/services/buildDelivery');
  process.env.DISCORD_TEMPLATE_EXECUTION_ENABLED = 'true';
  const guild = fakeGuild(); guild.roles.cache.get(ids.staffRole).name = 'Existing operations';
  const record = await deliverBuild(guild, processed.buildReport, 'commercial-safe');
  const newRoles = record.resources.filter((resource) => resource.action === 'createRole');
  if (newRoles.length > 1) assert.ok(guild.roles.cache.get(newRoles[0].id).position > guild.roles.cache.get(newRoles[1].id).position);
  assert.equal(record.status, 'success'); assert.ok(record.resources.length > 0); assert.ok(store.read(ids.guild).lastBuild.verifiedAt);
  const protectedRole = { id: '1534218992619753622', name: 'all', position: 1, color: 123, permissions: new PermissionsBitField() };
  const protectedGuild = fakeGuild(); protectedGuild.roles.cache.get(ids.staffRole).name = 'Existing operations'; protectedGuild.roles.cache.set(protectedRole.id, protectedRole);
  await assert.rejects(deliverBuild(protectedGuild, processed.buildReport, 'commercial-safe'), /Protected role position/);
  assert.equal(protectedRole.position, 1);
  assert.equal(protectedGuild.channels.cache.size, 0);
  delete process.env.DISCORD_TEMPLATE_EXECUTION_ENABLED;
});
test('startup loads every command/event without login and all command schemas serialize', () => {
  const { Client } = require('discord.js'); const client = new Client({ intents: [] });
  const { loadCommands, loadEvents } = require('../src/index');
  loadCommands(client); loadEvents(client);
  for (const command of client.commands.values()) assert.ok(command.data.toJSON().name);
  assert.ok(client.commands.has('license')); assert.ok(client.commands.has('panel')); assert.ok(client.commands.has('voice')); client.destroy();
});
test('protected roles cannot be assigned by autoroles or menus', async () => {
  const guild = fakeGuild();
  const protectedId = '1534218992619753622';
  guild.roles.cache.set(protectedId, { id: protectedId, editable: true, managed: false, comparePositionTo: () => -1, permissions: new PermissionsBitField() });
  await assert.rejects(access.safeRole(guild, protectedId), /protégé/);
});
test('attachment reader blocks non-CDN URLs, redirects and oversized responses before mutation', async () => {
  const { readAttachmentText } = require('../src/services/attachmentTextReader');
  assert.equal((await readAttachmentText({ name: 'brief.txt', url: 'http://127.0.0.1/private' })).code, 'UNSAFE_ATTACHMENT_URL');
  global.fetch = async (_, options) => { assert.equal(options.redirect, 'error'); return new Response('x', { headers: { 'content-length': '2000000' } }); };
  const response = await readAttachmentText({ name: 'brief.txt', url: 'https://cdn.discordapp.com/attachments/brief.txt' });
  assert.equal(response.ok, false);
  global.fetch = originalFetch;
});
test('stream limits, timeout, HTTP error and zero configured retries fail safely', async () => {
  const { readStreamingContent, callLmStudio } = require('../src/services/lmStudioClient');
  process.env.AI_PROVIDER = 'ollama'; process.env.OLLAMA_MODEL = 'test';
  global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); };
  assert.equal((await callLmStudio({})).code, 'TIMEOUT');
  global.fetch = async () => new Response('unavailable', { status: 503 });
  assert.equal((await callLmStudio({})).code, 'HTTP_ERROR');
  const valid = new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  assert.equal(await readStreamingContent(valid), '{}');
  await assert.rejects(readStreamingContent(new Response('x'.repeat(2 * 1024 * 1024 + 1))), /large/);
  process.env.BUILD_AGENT_MAX_RETRIES = '0'; assert.equal(require('../src/config').getRuntimeTimeoutConfig().buildAgentMaxRetries, 0);
  delete process.env.BUILD_AGENT_MAX_RETRIES; delete process.env.AI_PROVIDER; delete process.env.OLLAMA_MODEL; global.fetch = originalFetch;
});
test('single process storage lock rejects a second writer and recovers a stale PID', () => {
  const { acquireRuntimeLock } = require('../src/services/runtimeLock');
  const root = path.join(temporary, 'runtime-lock'); const release = acquireRuntimeLock(root);
  assert.throws(() => acquireRuntimeLock(root), /Another/); release();
  fs.writeFileSync(path.join(root, 'bot.lock'), '2147483646');
  const recovered = acquireRuntimeLock(root); recovered();
});
test('proxy integration routes websocket upgrades through inherited HTTPS proxy', () => {
  const https = require('node:https'); const previous = https.request; const proxy = process.env.HTTPS_PROXY;
  let actual;
  https.request = (options) => { actual = options; return 'mock-request'; };
  process.env.HTTPS_PROXY = 'http://127.0.0.1:8080';
  try {
    const { configureNetworkProxy } = require('../src/services/networkProxy'); configureNetworkProxy();
    assert.equal(https.request({ host: 'gateway.discord.gg', headers: { Upgrade: 'websocket' } }), 'mock-request');
    assert.equal(actual.agent.constructor.name, 'HttpsProxyAgent');
  } finally { https.request = previous; if (proxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = proxy; }
});
test('local reference retrieval is bounded, optional and subordinate to client brief', () => {
  const { retrieveReferences, referenceContext } = require('../src/services/referenceRetriever');
  assert.equal(retrieveReferences('esport scrims roster')[0].id, 'esport');
  assert.deepEqual(retrieveReferences('esport', path.join(temporary, 'missing.json')), []);
  assert.match(referenceContext('premium'), /explicit brief takes precedence/);
});
test('legacy announcement cannot bypass the embeds subscription', async () => {
  const guild = fakeGuild(); license(ids.guild, { features: ['panel'] });
  await assert.rejects(require('../src/commands/announce').execute(interaction(guild)), /Licence/);
  license();
});
