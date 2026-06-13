const fs = require('node:fs');
const path = require('node:path');
const { prepareTemplate } = require('../src/services/discordTemplateService');
const { buildDiscordPayloadsFromLoaded } = require('../src/services/discordPayloadBuilder');
const { buildExecutionPlanFromPayloadResult } = require('../src/services/discordServerOrchestrator');
const { executeTemplateRunFromPlan } = require('../src/services/discordTemplateRunner');
const mockAdapter = require('../src/services/executionAdapters/mockDiscordExecutionAdapter');

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

  if (hasFailure) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`[FAIL] verify-template-execution: ${error.message}`);
  process.exitCode = 1;
});
