const fs = require('node:fs');
const path = require('node:path');
const { normalizeBuildBrief } = require('../src/services/buildBriefNormalizer');
const { runBuildAgentPipeline } = require('../src/services/buildAgents/buildAgentPipeline');
const { prepareTemplate } = require('../src/services/discordTemplateService');
const { buildDiscordPayloadsFromLoaded } = require('../src/services/discordPayloadBuilder');
const { buildExecutionPlanFromPayloadResult } = require('../src/services/discordServerOrchestrator');
const { executeTemplateRunFromPlan } = require('../src/services/discordTemplateRunner');
const mockAdapter = require('../src/services/executionAdapters/mockDiscordExecutionAdapter');
const {
  evaluateBuildTemplateQuality,
  writeBuildTemplateQualityDebugFile,
} = require('../src/services/buildTemplateQualityEvaluator');

const fixturesDirectoryPath = path.join(process.cwd(), 'templates', 'brief-fixtures');
const dryRunDebugDirectoryPath = path.join(process.cwd(), 'debug', 'dry-runs');

const fixtureChecks = {
  'brief-long-esport-messy.json': {
    roles: ['staff', 'player'],
    channels: ['announcement', 'support', 'scrim'],
    categories: ['public', 'staff', 'player'],
    requireOnboarding: true,
    requireSupport: true,
    privateRoles: ['staff', 'player'],
  },
  'brief-content-creator.json': {
    roles: ['creator', 'staff'],
    channels: ['announcement', 'media', 'support'],
    categories: ['content', 'community'],
    requireOnboarding: false,
    requireSupport: true,
    privateRoles: ['staff', 'mod'],
  },
  'brief-premium-private.json': {
    roles: ['premium', 'vip', 'staff'],
    channels: ['support', 'ticket', 'vip'],
    categories: ['premium', 'staff', 'support'],
    requireOnboarding: true,
    requireSupport: true,
    privateRoles: ['staff', 'premium', 'vip'],
  },
};

const uniqueValues = (values) => Array.from(new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean),
));

const toHaystack = (values) => uniqueValues(values).join(' ').toLowerCase();

const includesKeyword = (value, keyword) => String(value || '').toLowerCase().includes(String(keyword || '').toLowerCase());

const entityMatchesKeyword = (entity, keyword) => {
  const candidates = [
    entity?.id,
    entity?.key,
    entity?.name,
    entity?.description,
    entity?.topic,
    entity?.title,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return candidates.some((candidate) => candidate.includes(String(keyword || '').toLowerCase()));
};

const collectTemplateWarnings = (loadResult, payloadResult, planResult, dryRunResult) => uniqueValues([
  ...(loadResult?.normalizationWarnings || []),
  ...(loadResult?.repairWarnings || []),
  ...(loadResult?.validation?.warnings || []),
  ...(payloadResult?.buildWarnings || []),
  ...(planResult?.plan?.warnings || []),
  ...(dryRunResult?.run?.warnings || []),
]);

const collectTemplateErrors = (loadResult, payloadResult, planResult, dryRunResult) => {
  if (!loadResult?.ok) {
    return uniqueValues(loadResult?.errors || [loadResult?.message || 'Unknown template load error.']);
  }

  if (!payloadResult?.ok) {
    return uniqueValues(payloadResult?.errors || [payloadResult?.message || 'Unknown payload error.']);
  }

  if (!planResult?.ok) {
    return uniqueValues(planResult?.errors || [planResult?.message || 'Unknown execution plan error.']);
  }

  if (!dryRunResult?.ok) {
    return uniqueValues(dryRunResult?.errors || [dryRunResult?.message || 'Unknown dry-run error.']);
  }

  return uniqueValues(dryRunResult?.run?.blockingErrors || []);
};

const summarizeValues = (values, limit = 3) => {
  if (!values.length) {
    return 'none';
  }

  const shown = values.slice(0, limit).join(' | ');
  const remaining = values.length - Math.min(values.length, limit);
  return remaining > 0 ? `${shown} | +${remaining} more` : shown;
};

const getTemplateStatus = (loadResult, payloadResult, planResult, dryRunResult) => {
  if (!loadResult?.ok) {
    return 'blocked';
  }

  if (!payloadResult?.ok || !planResult?.ok || !dryRunResult?.ok) {
    return 'failed';
  }

  if (dryRunResult.run?.finalStatus === 'success') {
    const repaired = Boolean(
      (loadResult.normalizationWarnings || []).length
      || (loadResult.repairWarnings || []).length
      || (loadResult.validation?.warnings || []).length,
    );
    return repaired ? 'repaired' : 'valid';
  }

  return dryRunResult.run?.finalStatus === 'partial' ? 'blocked' : 'failed';
};

const buildDryRunResult = async (planResult) => executeTemplateRunFromPlan(planResult, mockAdapter, {
  mode: 'verify-build-multi-briefs',
  debugDirectoryPath: dryRunDebugDirectoryPath,
});

const evaluateQualitativeIssues = ({ fixtureName, normalizedBrief, finalTemplate, payloadResult, planResult }) => {
  const expectations = fixtureChecks[fixtureName] || {};
  const issues = [];
  const roles = Array.isArray(finalTemplate?.roles) ? finalTemplate.roles : [];
  const categories = Array.isArray(finalTemplate?.categories) ? finalTemplate.categories : [];
  const channels = Array.isArray(finalTemplate?.channels) ? finalTemplate.channels : [];
  const welcomeEmbeds = Array.isArray(finalTemplate?.welcomeEmbeds) ? finalTemplate.welcomeEmbeds : [];

  (expectations.roles || []).forEach((keyword) => {
    if (!roles.some((role) => entityMatchesKeyword(role, keyword))) {
      issues.push(`Missing expected role signal "${keyword}".`);
    }
  });

  (expectations.categories || []).forEach((keyword) => {
    if (!categories.some((category) => entityMatchesKeyword(category, keyword))) {
      issues.push(`Missing expected category signal "${keyword}".`);
    }
  });

  (expectations.channels || []).forEach((keyword) => {
    if (!channels.some((channel) => entityMatchesKeyword(channel, keyword))) {
      issues.push(`Missing expected channel signal "${keyword}".`);
    }
  });

  if (expectations.requireOnboarding && welcomeEmbeds.length === 0) {
    issues.push('Missing onboarding/welcome embeds.');
  }

  if (expectations.requireSupport) {
    const supportPresent = channels.some((channel) => entityMatchesKeyword(channel, 'support') || entityMatchesKeyword(channel, 'ticket'));

    if (!supportPresent) {
      issues.push('Missing support or ticket channel.');
    }
  }

  const briefAreas = toHaystack(normalizedBrief?.requiredAreas || []);
  const expectsPrivateSpaces = ['staff-operations', 'team-operations', 'premium-zones']
    .some((keyword) => briefAreas.includes(keyword));

  if (expectsPrivateSpaces) {
    const privateChannelCount = channels.filter((channel) => {
      const permissionEntries = Array.isArray(channel?.permissions) ? channel.permissions : [];
      return permissionEntries.some((entry) => {
        const target = String(entry?.roleId || entry?.target || '').toLowerCase();
        return (expectations.privateRoles || []).some((keyword) => target.includes(keyword));
      });
    }).length;

    if (privateChannelCount === 0) {
      issues.push('Private areas were not clearly separated by channel permissions.');
    }
  }

  const orphanChannels = channels.filter((channel) => !channel.categoryId);

  if (categories.length && orphanChannels.length) {
    issues.push(`Found ${orphanChannels.length} channel(s) without categoryId after assembly.`);
  }

  const payloadChannelCount = payloadResult?.payloads?.channels?.length || 0;
  const planStepCount = planResult?.plan?.summary?.totalSteps || 0;

  if (payloadChannelCount === 0 || planStepCount === 0) {
    issues.push('Payload or execution plan is unexpectedly empty.');
  }

  return uniqueValues(issues);
};

const evaluateBriefFixture = async (fileName) => {
  const filePath = path.join(fixturesDirectoryPath, fileName);
  const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const normalization = normalizeBuildBrief({
    prompt: fixture.prompt,
    attachment: null,
  });
  const normalizedBrief = normalization.normalizedBrief || null;
  const failures = [];

  if (!normalizedBrief) {
    return {
      fileName,
      fixtureName: fixture.name || fileName,
      status: 'failed',
      failures: ['Brief normalization returned no normalized brief.'],
      warnings: normalization.warning ? [normalization.warning] : [],
      errors: ['Brief normalization failed.'],
      runDirectoryPath: null,
      qualitativeIssues: ['Pipeline not executed because normalized brief was unavailable.'],
    };
  }

  const pipelineResult = await runBuildAgentPipeline({
    prompt: fixture.prompt,
    attachment: null,
    normalizedBrief,
  });

  if (!pipelineResult.ok) {
    failures.push(`Pipeline failed at agent "${pipelineResult.failedAgent}"${pipelineResult.timeout ? ' (timeout).' : '.'}`);

    return {
      fileName,
      fixtureName: fixture.name || fileName,
      status: 'failed',
      failures,
      warnings: [],
      errors: [pipelineResult.error || 'Unknown pipeline error.'],
      runDirectoryPath: pipelineResult.runDirectoryPath,
      qualitativeIssues: ['Pipeline stopped before final template assembly.'],
      agentRuns: pipelineResult.agentRuns || [],
    };
  }

  const loadResult = prepareTemplate(pipelineResult.finalJson, {
    slug: fixture.name || path.basename(fileName, '.json'),
    source: 'build-multi-brief-fixture',
    path: filePath,
  });
  const payloadResult = loadResult.ok ? buildDiscordPayloadsFromLoaded(loadResult) : null;
  const planResult = payloadResult?.ok ? buildExecutionPlanFromPayloadResult(payloadResult) : null;
  const dryRunResult = planResult?.ok ? await buildDryRunResult(planResult) : null;

  const status = getTemplateStatus(loadResult, payloadResult, planResult, dryRunResult);
  const warnings = collectTemplateWarnings(loadResult, payloadResult, planResult, dryRunResult);
  const errors = collectTemplateErrors(loadResult, payloadResult, planResult, dryRunResult);
  const qualitativeIssues = loadResult.ok && payloadResult?.ok && planResult?.ok
    ? evaluateQualitativeIssues({
      fixtureName: fileName,
      normalizedBrief,
      finalTemplate: loadResult.template,
      payloadResult,
      planResult,
    })
    : ['Final template could not be fully audited because one pipeline stage failed.'];
  const qualityEvaluation = loadResult.ok
    ? evaluateBuildTemplateQuality({
      normalizedBrief,
      template: loadResult.template,
    })
    : null;

  if (qualityEvaluation) {
    writeBuildTemplateQualityDebugFile({
      runId: pipelineResult.runId,
      evaluation: qualityEvaluation,
    });
    qualitativeIssues.push(
      ...qualityEvaluation.warnings,
      ...qualityEvaluation.missingSignals.map((signal) => `Missing brief signal: ${signal}.`),
      ...qualityEvaluation.contradictions,
    );
  }

  if (!['valid', 'repaired'].includes(status)) {
    failures.push(`Expected final status valid/repaired but got "${status}".`);
  }

  if (qualityEvaluation?.status === 'poor') {
    failures.push(`Deterministic brief fidelity is poor (${qualityEvaluation.score}/100).`);
  }

  return {
    fileName,
    fixtureName: fixture.name || fileName,
    status,
    failures,
    warnings,
    errors,
    qualitativeIssues,
    runDirectoryPath: pipelineResult.runDirectoryPath,
    agentRuns: pipelineResult.agentRuns || [],
    qualityEvaluation,
  };
};

const main = async () => {
  const fixtureFiles = [
    'brief-long-esport-messy.json',
    'brief-content-creator.json',
    'brief-premium-private.json',
  ];
  let hasFailure = false;

  for (const fileName of fixtureFiles) {
    const result = await evaluateBriefFixture(fileName);
    const runSummary = result.runDirectoryPath ? ` debug=${result.runDirectoryPath}` : '';

    if (result.failures.length) {
      hasFailure = true;
      console.error(`[FAIL] ${result.fileName} -> ${result.status}${runSummary}`);
      result.failures.forEach((failure) => console.error(`  - ${failure}`));
      console.error(`  Warnings: ${summarizeValues(result.warnings)}`);
      console.error(`  Errors: ${summarizeValues(result.errors)}`);
      console.error(`  Quality: ${summarizeValues(result.qualitativeIssues)}`);
      if (result.qualityEvaluation) {
        console.error(`  Fidelity: ${result.qualityEvaluation.status} (${result.qualityEvaluation.score}/100)`);
      }
      continue;
    }

    console.log(`[PASS] ${result.fileName} -> ${result.status}${runSummary}`);
    console.log(`  Warnings: ${summarizeValues(result.warnings)}`);
    console.log(`  Errors: ${summarizeValues(result.errors)}`);
    console.log(`  Quality: ${summarizeValues(result.qualitativeIssues)}`);
    if (result.qualityEvaluation) {
      console.log(`  Fidelity: ${result.qualityEvaluation.status} (${result.qualityEvaluation.score}/100)`);
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`[FAIL] verify-build-multi-briefs: ${error.message}`);
  process.exitCode = 1;
});
