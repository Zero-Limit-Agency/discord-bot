const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits: P } = require('discord.js');
const { executeLiveRunFromPlan } = require('./discordTemplateRunner');
const { createLiveDiscordExecutionAdapter, validateLiveExecutionPreflight } = require('./executionAdapters/discordLiveExecutionAdapter');
const { store } = require('../repositories/commercialStore');
const { updateBuildJob } = require('./buildJobService');
const protectedIds = new Set(['1534218992619753622', ...(process.env.PROTECTED_ROLE_IDS || '').split(',').filter(Boolean)]);
const protectedSnapshot = async (guild) => {
  await guild.roles.fetch();
  const roles = [];
  for (const role of guild.roles.cache.values()) if (protectedIds.has(role.id)) {
    let members;
    if (typeof guild.members.list === 'function') {
      members = new Map(); let after;
      for (;;) {
        const batch = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
        for (const [id, member] of batch) members.set(id, member);
        if (batch.size < 1000) break;
        after = batch.last().id;
      }
    } else members = await guild.members.fetch();
    roles.push({ id: role.id, name: role.name, color: role.color, permissions: role.permissions.bitfield.toString(), position: role.position, members: [...members.values()].filter((m) => m.roles.cache.has(role.id)).map((m) => m.id).sort() });
  }
  return roles;
};
const deliverBuild = async (guild, report, runId, botFeatures = {}) => {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('Invalid build run ID.');
  if (process.env.DISCORD_TEMPLATE_EXECUTION_ENABLED !== 'true') throw new Error('Live execution disabled: set DISCORD_TEMPLATE_EXECUTION_ENABLED=true.');
  const dry = report?.dryRunResult;
  if (!dry?.ok || dry.dryRun.finalStatus !== 'success') throw new Error('Dry-run did not succeed.');
  const preflight = await validateLiveExecutionPreflight(guild, dry);
  if (!preflight.ok) throw new Error(preflight.errors.join(' | ').slice(0, 1500));
  const me = guild.members.me || await guild.members.fetchMe();
  const diagnostics = dry.templateDiagnostics || {};
  if ([...(diagnostics.normalizationWarnings || []), ...(diagnostics.repairWarnings || [])].some((warning) => /dropped overwrite|missing role/i.test(warning))) throw new Error('Permission references were lost during repair. Review the template before live execution.');
  if (![P.ManageRoles, P.ManageChannels, P.ViewChannel, P.SendMessages, P.EmbedLinks].every((p) => me.permissions.has(p))) throw new Error('Missing bot permissions.');
  const before = await protectedSnapshot(guild);
  const roles = dry.plan.phases.flatMap((p) => p.steps).filter((s) => s.action === 'create_role');
  // New roles shift existing absolute Discord positions. Never move a protected role to compensate.
  if (before.some((r) => r.position > 0) && roles.length) throw new Error('Protected role position would change when Discord inserts new roles. Build blocked; no protected role was moved.');
  const dangerous = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageWebhooks;
  if (roles.some((s) => (BigInt(s.payload.permissions || 0) & dangerous) !== 0n)) throw new Error('Build policy forbids privileged generated roles.');
  const journal = path.join(process.cwd(), '.data', 'build-jobs', `${runId}-resources.json`);
  const record = { runId, guildId: guild.id, staticServer: {}, botFeatures, before, resources: [] };
  const persist = () => {
    const tmp = `${journal}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(tmp, journal);
  };
  persist();
  const base = createLiveDiscordExecutionAdapter(guild);
  const adapter = Object.fromEntries(Object.entries(base).map(([name, action]) => [name, async (args) => {
    const result = await action(args);
    if (result.ok) {
      record.resources.push({ action: name, ref: args.templateRef || args.targetChannelRef, id: result.runtimeId }); persist();
      const createdRoles = record.resources.filter((resource) => resource.action === 'createRole');
      if (name === 'createRole' && createdRoles.length === roles.length) {
        await guild.roles.setPositions(createdRoles.map((resource, index) => ({ role: resource.id, position: createdRoles.length - index })));
      }
    }
    return result;
  }]));
  updateBuildJob(runId, { currentAgent: 'discord-execution' });
  const live = await executeLiveRunFromPlan(dry, adapter);
  record.staticServer = live.liveRun?.runtimeRefs || {};
  record.executionStatus = live.liveRun?.finalStatus || 'failed';
  record.status = record.executionStatus === 'success' ? 'verifying' : record.executionStatus;
  persist();
  if (!live.ok || live.liveRun.finalStatus !== 'success') throw new Error(`Partial Discord execution; inspect private mapping for ${runId}. No automatic deletion.`);
  await guild.channels.fetch();
  await guild.roles.fetch();
  for (const resource of record.resources) {
    if (resource.action === 'createRole' && !guild.roles.cache.has(resource.id)) throw new Error('Post-build role missing.');
    if (['createCategory', 'createChannel'].includes(resource.action) && !guild.channels.cache.has(resource.id)) throw new Error('Post-build channel missing.');
  }
  for (const step of dry.plan.phases.flatMap((phase) => phase.steps)) {
    if (step.action !== 'apply_channel_overwrite') continue;
    const target = guild.channels.cache.get(record.staticServer[`FUTURE_CHANNEL_${step.targetChannelRef}`]);
    const roleId = step.roleRef === '@everyone' ? guild.id : record.staticServer[`FUTURE_ROLE_${step.roleRef}`];
    const overwrite = target?.permissionOverwrites.cache.get(roleId);
    if (!overwrite || overwrite.allow.bitfield !== BigInt(step.payload.allow) || overwrite.deny.bitfield !== BigInt(step.payload.deny)) throw new Error('Post-build permission verification failed.');
  }
  if (JSON.stringify(before) !== JSON.stringify(await protectedSnapshot(guild))) throw new Error('Protected role verification failed.');
  const { enabled } = require('./managed/access');
  const { validateConfig } = require('./managed/configuration');
  const { resolveFeatureConfig } = require('./featuresPlanner');
  for (const [feature, proposal] of Object.entries(botFeatures)) {
    if (!enabled(guild.id, feature)) { proposal.status = 'license-required'; continue; }
    if (!proposal.config) continue;
    try {
      const config = await validateConfig(guild, feature, resolveFeatureConfig(proposal.config, record.staticServer));
      if (feature === 'tickets') {
        const sent = await guild.channels.cache.get(config.channelId).send({ content: 'Support — ouvrir un ticket', components: require('./managed/tickets').panel(config), allowedMentions: { parse: [] } });
        config.panelMessageId = sent.id;
      }
      if (!enabled(guild.id, feature)) throw new Error('Licence expired during configuration.');
      store.update(guild.id, (state) => { state.features[feature] = config; });
      proposal.status = 'configured';
    } catch { proposal.status = 'needs-configuration'; }
  }
  record.status = 'success';
  persist();
  store.update(guild.id, (state) => { state.lastBuild = { runId, staticServer: record.staticServer, botFeatures, verifiedAt: new Date().toISOString() }; });
  return record;
};
module.exports = { deliverBuild, protectedSnapshot };
