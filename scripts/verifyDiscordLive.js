// Explicitly scoped integration smoke. Never logs tokens, calls AI, or touches another guild.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client, ClientUser, Routes, PermissionFlagsBits: P } = require('discord.js');
const TEST_GUILD = '1519795418429390908';
if (process.env.ZLA_LIVE_TEST_GUILD_ID !== TEST_GUILD) throw new Error(`Set ZLA_LIVE_TEST_GUILD_ID=${TEST_GUILD} to run this integration smoke.`);
if (!process.env.DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN.');
const project = process.cwd();
const runId = `live-${randomUUID()}`;
const runRoot = path.join(project, '.data', 'live-smoke', runId);
fs.mkdirSync(runRoot, { recursive: true, mode: 0o700 });
process.chdir(runRoot); // Isolated test entitlements; never modify the operational license repository.
const { store } = require('../src/repositories/commercialStore');
const { FEATURES } = require('../src/services/managed/access');
const { configure } = require('../src/services/managed/configuration');
const { handleTicket } = require('../src/services/managed/tickets');
const { memberEvent } = require('../src/services/managed/memberEvents');
const { message, sendVerified, contextFor } = require('../src/services/managed/messages');
const { panelPayload } = require('../src/services/managed/adminPanel');
const resources = [];
const results = [];
const client = new Client({ intents: [], rest: { timeout: 15000, retries: 1 } });
const journal = () => fs.writeFileSync(path.join(runRoot, 'mapping.json'), JSON.stringify({ runId, guildId: TEST_GUILD, resources, results }, null, 2), { mode: 0o600 });
const snapshotRole = async (guild) => {
  await guild.roles.fetch();
  const role = guild.roles.cache.get('1534218992619753622');
  assert.ok(role, 'Protected role is missing.');
  // REST pagination; no Gateway member chunk requests.
  const assigned = [];
  let after;
  for (;;) {
    const batch = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
    for (const member of batch.values()) if (member.roles.cache.has(role.id)) assigned.push(member.id);
    if (batch.size < 1000) break;
    after = batch.last().id;
  }
  return { name: role.name, color: role.color, permissions: role.permissions.bitfield.toString(), position: role.position, members: assigned.sort() };
};
const run = async () => {
  client.rest.setToken(process.env.DISCORD_TOKEN);
  client.user = new ClientUser(client, await client.rest.get(Routes.user('@me')));
  const guild = await client.guilds.fetch(TEST_GUILD);
  await guild.roles.fetch(); await guild.channels.fetch();
  const me = await guild.members.fetchMe();
  assert.ok(me.permissions.has([P.ManageChannels, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.AttachFiles]), 'Missing native smoke test permissions.');
  const protectedBefore = await snapshotRole(guild);
  const owner = await guild.members.fetch(guild.ownerId);
  const create = async (options) => {
    const channel = await guild.channels.create({ ...options, reason: `Zero Limit integration smoke ${runId}` });
    resources.push({ id: channel.id, type: 'channel', cleaned: false }); journal(); return channel;
  };
  const category = await create({ name: `zla-smoke-${runId.slice(-8)}`, type: 4, permissionOverwrites: [{ id: guild.id, deny: [P.ViewChannel] }, { id: client.user.id, allow: [P.ViewChannel, P.ManageChannels, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] }] });
  const text = await create({ name: 'zla-smoke-panel', type: 0, parent: category.id });
  store.update(TEST_GUILD, (s) => { s.license = { active: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), features: FEATURES }; });
  const interaction = (customId, extra = {}) => ({ guild, guildId: TEST_GUILD, user: owner.user, member: owner, client, customId, channelId: extra.channelId || text.id, channel: guild.channels.cache.get(extra.channelId || text.id), fields: { getTextInputValue: () => 'Integration smoke — no private client content.' }, reply: async () => {}, deferReply: async () => {}, editReply: async () => {}, ...extra });
  const embed = await sendVerified(text, message({ content: '', embed: { title: 'Zero Limit — Live smoke', description: 'Embed-only message validated.' } }));
  await embed.edit(message({ embed: { title: 'Zero Limit — Live smoke', description: 'Updated and verified.' } }));
  assert.equal((await embed.fetch()).embeds[0].description, 'Updated and verified.');
  results.push('embed.send-edit-refetch: PASS');
  await sendVerified(text, panelPayload(TEST_GUILD)); results.push('admin-panel.native-components: PASS');
  await configure(interaction(), 'welcome', { enabled: true, channelId: text.id, message: { embed: { title: 'Bienvenue {username} sur {server}' } } });
  await configure(interaction(), 'goodbye', { enabled: true, channelId: text.id, message: { content: 'Au revoir {username} sur {server}' } });
  await memberEvent(owner, 'welcome'); await memberEvent(owner, 'goodbye'); results.push('welcome-goodbye.real-message-delivery: PASS (events invoked by smoke)');
  await configure(interaction(), 'logs', { enabled: true, channelId: text.id });
  const botRole = me.roles.highest.id;
  assert.notEqual(botRole, guild.id);
  await configure(interaction(), 'tickets', { enabled: true, channelId: text.id, categoryId: category.id, staffRoleIds: [botRole], maxOpen: 1, types: [{ id: 'smoke', label: 'Integration smoke' }] });
  await handleTicket(interaction('zl:ticket:submit:smoke'));
  const ticket = Object.values(store.read(TEST_GUILD).tickets)[0];
  resources.push({ id: ticket.channelId, type: 'channel', cleaned: false }); journal();
  const ticketChannel = await guild.channels.fetch(ticket.channelId);
  assert.ok(ticketChannel.permissionOverwrites.cache.get(guild.id).deny.has(P.ViewChannel));
  for (const action of ['claim', 'unclaim', 'close', 'reopen', 'transcript']) await handleTicket(interaction(`zl:ticket:${action}:${ticket.id}`, { channelId: ticketChannel.id, channel: ticketChannel }));
  results.push('ticket.private-create-claim-unclaim-close-reopen-transcript: PASS (backend real API; synthetic interactions)');
  store.update(TEST_GUILD, (s) => { s.license.active = false; });
  await assert.rejects(handleTicket(interaction(`zl:ticket:close:${ticket.id}`, { channelId: ticketChannel.id, channel: ticketChannel })), /Licence/);
  assert.ok(await guild.channels.fetch(ticketChannel.id));
  store.update(TEST_GUILD, (s) => { s.license.active = true; });
  await handleTicket(interaction(`zl:ticket:close:${ticket.id}`, { channelId: ticketChannel.id, channel: ticketChannel }));
  results.push('license.disable-preserve-reactivate: PASS (isolated test license)');
  const voice = await create({ name: 'zla-smoke-voice', type: 2, parent: category.id, userLimit: 3 });
  await voice.setName('zla-smoke-voice-renamed'); await voice.setUserLimit(2);
  results.push('voice.native-create-rename-limit: PASS; member join/transfer flow: NOT TESTED');
  assert.deepEqual(await snapshotRole(guild), protectedBefore);
  results.push('protected-role.full-snapshot: PASS');
  results.push('AI-build, actual slash/button/modal clicks, join/leave/voice events, role grants: NOT TESTED');
  journal();
};
run().catch((error) => { results.push(`FAILED: ${error.name} code=${error.code || 'VALIDATION'} ${require('../src/utils/logger').redact(error.message).slice(0, 700)}`); process.exitCode = 1; }).finally(async () => {
  // Only IDs returned by this run's creation calls may be removed.
  for (const resource of [...resources].reverse()) {
    try { await client.rest.delete(Routes.channel(resource.id), { reason: `Cleanup known smoke resource ${runId}` }); resource.cleaned = true; }
    catch (error) { results.push(`Cleanup failed for known object ${resource.id}: ${error.code || error.name}`); process.exitCode = 1; }
  }
  journal(); console.log(JSON.stringify({ runId, guildId: TEST_GUILD, results, created: resources.length, cleaned: resources.filter((r) => r.cleaned).length }, null, 2));
  await client.destroy(); process.chdir(project);
});
