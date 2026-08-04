const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, PermissionsBitField } = require('discord.js');
const { prepareTemplate } = require('../src/services/discordTemplateService');
const { buildDiscordPayloadsFromLoaded } = require('../src/services/discordPayloadBuilder');
const { buildExecutionPlanFromPayloadResult } = require('../src/services/discordServerOrchestrator');
const { executeTemplateRunFromPlan } = require('../src/services/discordTemplateRunner');
const mockAdapter = require('../src/services/executionAdapters/mockDiscordExecutionAdapter');
const {
  createLiveDiscordExecutionAdapter,
  validateLiveExecutionPreflight,
} = require('../src/services/executionAdapters/discordLiveExecutionAdapter');

const fixturesDirectoryPath = path.join(process.cwd(), 'templates', 'execution-fixtures');
process.env.NODE_ENV = 'production';

const uniqueValues = (values) => Array.from(new Set(values.map((value) => String(value))));

const collectAllWarnings = (loadResult, payloadResult, planResult, dryRunResult) => uniqueValues([
  ...(loadResult?.normalizationWarnings || []),
  ...(loadResult?.repairWarnings || []),
  ...(loadResult?.validation?.warnings || []),
  ...(payloadResult?.buildWarnings || []),
  ...(planResult?.plan?.warnings || []),
  ...(dryRunResult?.dryRun?.warnings || []),
]);

const collectAllErrors = (loadResult, payloadResult, planResult, dryRunResult) => {
  if (!loadResult?.ok) {
    return uniqueValues(loadResult?.errors || [loadResult?.message || 'Unknown load error.']);
  }

  if (!payloadResult?.ok) {
    return uniqueValues(payloadResult?.errors || [payloadResult?.message || 'Unknown payload error.']);
  }

  if (!planResult?.ok) {
    return uniqueValues(planResult?.errors || [planResult?.message || 'Unknown plan error.']);
  }

  if (!dryRunResult?.ok) {
    return uniqueValues(dryRunResult?.errors || [dryRunResult?.message || 'Unknown dry-run error.']);
  }

  return uniqueValues(dryRunResult?.dryRun?.blockingErrors || []);
};

const formatSummaryLine = (label, values) => {
  if (!values.length) {
    return `${label}: none`;
  }

  return `${label}: ${values.slice(0, 3).join(' | ')}`;
};

const assertIncludes = (haystack, expectedEntries, label, failures) => {
  expectedEntries.forEach((entry) => {
    const found = haystack.some((value) => String(value).includes(entry));

    if (!found) {
      failures.push(`${label} missing "${entry}".`);
    }
  });
};

const evaluateFixture = async (fileName) => {
  const filePath = path.join(fixturesDirectoryPath, fileName);
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const expected = parsed.__expected || {};
  const { __expected, ...template } = parsed;
  const failures = [];
  const slug = `fixture-${path.basename(fileName, '.json')}`;
  const loadResult = prepareTemplate(template, {
    slug,
    source: 'execution-fixture',
    path: filePath,
  });
  const payloadResult = loadResult.ok ? buildDiscordPayloadsFromLoaded(loadResult) : null;
  const planResult = payloadResult?.ok ? buildExecutionPlanFromPayloadResult(payloadResult) : null;
  const dryRunRunResult = planResult?.ok
    ? await executeTemplateRunFromPlan(planResult, mockAdapter, {
      mode: 'verify-template-execution',
      debugDirectoryPath: path.join(process.cwd(), 'debug', 'dry-runs'),
    })
    : null;
  const dryRunResult = dryRunRunResult?.ok
    ? {
      ...dryRunRunResult,
      dryRun: dryRunRunResult.run,
    }
    : dryRunRunResult;
  const warnings = collectAllWarnings(loadResult, payloadResult, planResult, dryRunResult);
  const errors = collectAllErrors(loadResult, payloadResult, planResult, dryRunResult);
  const repaired = Boolean((loadResult?.normalizationWarnings || []).length || (loadResult?.repairWarnings || []).length);
  const finalStatus = !loadResult.ok
    ? 'blocked'
    : (!payloadResult?.ok || !planResult?.ok || !dryRunResult?.ok || dryRunResult.dryRun.finalStatus !== 'success')
      ? 'blocked'
      : 'success';

  if (expected.status && expected.status !== finalStatus) {
    failures.push(`Expected status "${expected.status}" but got "${finalStatus}".`);
  }

  if (typeof expected.repaired === 'boolean' && expected.repaired !== repaired) {
    failures.push(`Expected repaired=${expected.repaired} but got ${repaired}.`);
  }

  assertIncludes(warnings, expected.warningIncludes || [], 'Warning', failures);
  assertIncludes(errors, expected.errorIncludes || [], 'Error', failures);

  if (typeof expected.overwriteStepCount === 'number') {
    const overwriteStepCount = planResult?.plan?.phases?.[3]?.steps?.length || 0;

    if (overwriteStepCount !== expected.overwriteStepCount) {
      failures.push(`Expected overwrite step count ${expected.overwriteStepCount} but got ${overwriteStepCount}.`);
    }
  }

  if (typeof expected.embedCount === 'number') {
    const embedCount = payloadResult?.payloads?.embeds?.length || 0;

    if (embedCount !== expected.embedCount) {
      failures.push(`Expected embed count ${expected.embedCount} but got ${embedCount}.`);
    }
  }

  if (expected.onboardingTarget) {
    const onboardingTarget = planResult?.plan?.phases?.[4]?.steps?.[0]?.targetChannelRef || null;

    if (onboardingTarget !== expected.onboardingTarget) {
      failures.push(`Expected onboarding target "${expected.onboardingTarget}" but got "${onboardingTarget}".`);
    }
  }

  Object.entries(expected.channelCategoryRefs || {}).forEach(([channelRef, categoryRef]) => {
    const payloadChannel = payloadResult?.payloads?.channels?.find((channel) => channel.templateChannelId === channelRef);
    const actualCategoryRef = payloadChannel?.parentRef || null;

    if (actualCategoryRef !== categoryRef) {
      failures.push(`Expected channel "${channelRef}" to use category "${categoryRef}" but got "${actualCategoryRef}".`);
    }
  });

  Object.entries(expected.overwriteRoleRefs || {}).forEach(([channelRef, roleRefs]) => {
    const payloadChannel = payloadResult?.payloads?.channels?.find((channel) => channel.templateChannelId === channelRef);
    const actualRoleRefs = (payloadChannel?.discordPayload?.permissionOverwrites || []).map((overwrite) => overwrite.roleRef);

    roleRefs.forEach((roleRef) => {
      if (!actualRoleRefs.includes(roleRef)) {
        failures.push(`Expected channel "${channelRef}" overwrite to reference role "${roleRef}".`);
      }
    });
  });

  return {
    fileName,
    failures,
    warnings,
    errors,
    finalStatus,
    repaired,
  };
};

const verifyPayloadPermissionSafety = () => {
  const loaded = prepareTemplate({
    name: 'Payload Safety Fixture',
    description: '',
    roles: [{ id: 'staff', key: 'staff', name: 'Staff', permissions: ['view_channel', 'connect', 'speak'] }],
    categories: [{ id: 'info', key: 'info', name: 'Info' }],
    channels: [{
      id: 'chat', key: 'chat', name: 'chat', type: 'text', categoryId: 'info',
      permissions: [
        { target: 'staff', allow: ['view_channel', 'connect', 'speak'], deny: [] },
        { target: 'ghost', allow: ['view_channel'], deny: [] },
      ],
    }],
    welcomeEmbeds: [{ title: 'Welcome' }],
  }, { slug: 'payload-safety', source: 'inline-fixture', path: 'inline' });
  const payloadResult = buildDiscordPayloadsFromLoaded(loaded);

  if (!payloadResult.ok) {
    throw new Error(`Payload safety fixture failed: ${(payloadResult.errors || []).join(' | ')}`);
  }

  const rolePermissions = new PermissionsBitField(BigInt(payloadResult.payloads.roles[0].discordPayload.permissions));
  const overwrites = payloadResult.payloads.channels[0].discordPayload.permissionOverwrites;
  const staffOverwrite = overwrites.find((overwrite) => overwrite.roleRef === 'staff');
  const overwritePermissions = new PermissionsBitField(BigInt(staffOverwrite.allow));

  if (rolePermissions.has(PermissionsBitField.Flags.Connect)
    || rolePermissions.has(PermissionsBitField.Flags.Speak)
    || overwritePermissions.has(PermissionsBitField.Flags.Connect)
    || overwritePermissions.has(PermissionsBitField.Flags.Speak)) {
    throw new Error('Payload builder retained misplaced voice permissions.');
  }

  if (overwrites.some((overwrite) => overwrite.roleRef === 'ghost')) {
    throw new Error('Payload builder retained an orphan role overwrite.');
  }

  console.log('[PASS] payload builder drops incompatible and orphan permissions');
};

const verifyLivePreflight = async () => {
  const planResult = {
    plan: {
      status: 'ready',
      phases: [
        { steps: [{ action: 'create_role', payload: { name: 'Staff' } }] },
        { steps: [{ action: 'create_category', payload: { name: 'Operations' } }] },
        { steps: [{ action: 'create_channel', payload: { name: 'staff-chat' } }] },
      ],
    },
  };
  const cleanGuild = {
    roles: { cache: new Map([['everyone', { name: '@everyone' }]]), fetch: async () => null },
    channels: { cache: new Map(), fetch: async () => null },
  };
  const conflictingGuild = {
    roles: { cache: new Map([['existing', { name: 'Staff' }]]), fetch: async () => null },
    channels: { cache: new Map([
      ['category', { name: 'Operations', type: ChannelType.GuildCategory }],
      ['channel', { name: 'staff-chat', type: ChannelType.GuildText }],
    ]), fetch: async () => null },
  };
  const cleanResult = await validateLiveExecutionPreflight(cleanGuild, planResult);
  const conflictResult = await validateLiveExecutionPreflight(conflictingGuild, planResult);

  if (!cleanResult.ok || conflictResult.ok || conflictResult.errors.length !== 3) {
    throw new Error('Live preflight did not reliably detect existing Discord objects.');
  }

  console.log('[PASS] live preflight blocks role, category and channel collisions');
};

const verifyLiveFailFast = async () => {
  const calls = [];
  const adapter = {
    createRole: async () => { calls.push('role'); return { ok: false, error: 'Synthetic role failure.' }; },
    createCategory: async () => { calls.push('category'); return { ok: true, runtimeId: 'category' }; },
    createChannel: async () => { calls.push('channel'); return { ok: true, runtimeId: 'channel' }; },
    applyPermissionOverwrite: async () => { calls.push('overwrite'); return { ok: true, runtimeId: 'overwrite' }; },
    postOnboardingEmbed: async () => { calls.push('embed'); return { ok: true, runtimeId: 'embed' }; },
  };
  const result = await executeTemplateRunFromPlan({
    slug: 'fail-fast',
    template: { name: 'Fail Fast Fixture' },
    plan: {
      status: 'ready',
      blockingErrors: [],
      warnings: [],
      phases: [
        { name: 'Phase 1', label: 'Roles', steps: [{ stepId: 'role-1', action: 'create_role', templateRef: 'staff', payload: {}, dependsOn: [], outputPlaceholder: 'FUTURE_ROLE_staff' }] },
        { name: 'Phase 2', label: 'Categories', steps: [{ stepId: 'category-1', action: 'create_category', templateRef: 'staff', payload: {}, dependsOn: [], outputPlaceholder: 'FUTURE_CATEGORY_staff' }] },
      ],
    },
  }, adapter, {
    mode: 'live-run-fixture',
    debugDirectoryPath: path.join(process.cwd(), 'debug', 'live-runs'),
    stopOnFailure: true,
  });

  if (!result.ok || calls.join(',') !== 'role' || result.run.summary.failedCount !== 1 || result.run.summary.skippedCount !== 1) {
    throw new Error('Live fail-fast did not halt subsequent adapter actions.');
  }

  console.log('[PASS] live runner halts adapter actions after the first failure');
};

const verifyLiveOverwriteShape = async () => {
  let captured = null;
  const channel = {
    permissionOverwrites: {
      create: async (target, options, metadata) => {
        captured = { target, options, metadata };
      },
    },
  };
  const guild = {
    roles: { everyone: { id: 'everyone-id' } },
    channels: {
      cache: new Map([['channel-id', channel]]),
      fetch: async () => null,
    },
  };
  const adapter = createLiveDiscordExecutionAdapter(guild);
  const allow = new PermissionsBitField([PermissionsBitField.Flags.ViewChannel]).bitfield.toString();
  const deny = new PermissionsBitField([PermissionsBitField.Flags.SendMessages]).bitfield.toString();
  const result = await adapter.applyPermissionOverwrite({
    targetChannelRef: 'staff-chat',
    roleRef: '@everyone',
    payload: { allow, deny },
    resolvedChannelId: 'channel-id',
    resolvedRoleId: null,
  });

  if (!result.ok
    || captured?.target !== 'everyone-id'
    || captured?.options?.ViewChannel !== true
    || captured?.options?.SendMessages !== false
    || Object.prototype.hasOwnProperty.call(captured?.options || {}, 'allow')
    || Object.prototype.hasOwnProperty.call(captured?.options || {}, 'deny')) {
    throw new Error('Live adapter did not convert overwrite bitfields to Discord.js permission options.');
  }

  console.log('[PASS] live adapter converts overwrite bitfields to Discord.js options');
};

const main = async () => {
  const fixtureFiles = fs.readdirSync(fixturesDirectoryPath)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort();

  let hasFailure = false;

  for (const fileName of fixtureFiles) {
    const result = await evaluateFixture(fileName);

    if (result.failures.length) {
      hasFailure = true;
      console.error(`[FAIL] ${result.fileName} -> ${result.finalStatus}${result.repaired ? ' repaired' : ''}`);
      result.failures.forEach((failure) => console.error(`  - ${failure}`));
      console.error(`  ${formatSummaryLine('Warnings', result.warnings)}`);
      console.error(`  ${formatSummaryLine('Errors', result.errors)}`);
      continue;
    }

    console.log(`[PASS] ${result.fileName} -> ${result.finalStatus}${result.repaired ? ' repaired' : ' valid'}`);
    console.log(`  ${formatSummaryLine('Warnings', result.warnings)}`);
    console.log(`  ${formatSummaryLine('Errors', result.errors)}`);
  }

  try {
    verifyPayloadPermissionSafety();
    await verifyLivePreflight();
    await verifyLiveFailFast();
    await verifyLiveOverwriteShape();
  } catch (error) {
    hasFailure = true;
    console.error(`[FAIL] execution safety checks: ${error.message}`);
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`[FAIL] verify-template-execution: ${error.message}`);
  process.exitCode = 1;
});
