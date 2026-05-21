const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const { buildExecutionPlan } = require('./discordServerOrchestrator');
const mockAdapter = require('./executionAdapters/mockDiscordExecutionAdapter');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'dry-runs');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const writeDebugDryRun = (slug, dryRun) => {
  if (isProduction()) {
    return null;
  }

  ensureDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(debugDirectoryPath, `${slug}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(dryRun, null, 2));
  return filePath;
};

const resolveDependencies = (dependsOn, runtimeRefs) => {
  const resolved = [];
  const missing = [];

  (dependsOn || []).forEach((dependency) => {
    if (runtimeRefs[dependency]) {
      resolved.push({
        placeholder: dependency,
        runtimeId: runtimeRefs[dependency],
      });
    } else {
      missing.push(dependency);
    }
  });

  return {
    resolved,
    missing,
  };
};

const executeStepWithAdapter = async (step, adapter, runtimeRefs) => {
  switch (step.action) {
    case 'create_role':
      return adapter.createRole({
        templateRef: step.templateRef,
        payload: step.payload,
      });
    case 'create_category':
      return adapter.createCategory({
        templateRef: step.templateRef,
        payload: step.payload,
      });
    case 'create_channel':
      return adapter.createChannel({
        templateRef: step.templateRef,
        payload: step.payload,
      });
    case 'apply_channel_overwrite':
      return adapter.applyPermissionOverwrite({
        targetChannelRef: step.targetChannelRef,
        roleRef: step.roleRef,
        payload: step.payload,
        resolvedChannelId: runtimeRefs[`FUTURE_CHANNEL_${step.targetChannelRef}`] || null,
        resolvedRoleId: step.roleRef && step.roleRef !== '@everyone'
          ? runtimeRefs[`FUTURE_ROLE_${step.roleRef}`] || null
          : null,
      });
    case 'publish_onboarding_embed':
      return adapter.postOnboardingEmbed({
        targetChannelRef: step.targetChannelRef,
        payload: step.payload,
        resolvedChannelId: step.targetChannelRef
          ? runtimeRefs[`FUTURE_CHANNEL_${step.targetChannelRef}`] || null
          : null,
      });
    default:
      return {
        ok: false,
        error: `Unsupported action "${step.action}".`,
      };
  }
};

const registerRuntimeOutput = (step, adapterResult, runtimeRefs) => {
  if (step.outputPlaceholder && adapterResult.simulatedId) {
    runtimeRefs[step.outputPlaceholder] = adapterResult.simulatedId;
  }
};

const executeDryRun = async (slug, adapter = mockAdapter) => {
  const executionPlanResult = buildExecutionPlan(slug);

  if (!executionPlanResult.ok) {
    return executionPlanResult;
  }

  const runtimeRefs = {};
  const phaseLogs = [];
  const allStepLogs = [];

  for (const phase of executionPlanResult.plan.phases) {
    const stepLogs = [];

    for (const step of phase.steps) {
      const dependencyCheck = resolveDependencies(step.dependsOn, runtimeRefs);

      if (dependencyCheck.missing.length) {
        stepLogs.push({
          phase: phase.name,
          phaseLabel: phase.label,
          stepId: step.stepId,
          action: step.action,
          status: 'blocked',
          resolvedDependencies: dependencyCheck.resolved,
          missingDependencies: dependencyCheck.missing,
          errors: [`Missing dependencies: ${dependencyCheck.missing.join(', ')}`],
          warnings: [],
          payload: step.payload,
        });
        continue;
      }

      try {
        const adapterResult = await executeStepWithAdapter(step, adapter, runtimeRefs);

        if (!adapterResult || adapterResult.ok !== true) {
          stepLogs.push({
            phase: phase.name,
            phaseLabel: phase.label,
            stepId: step.stepId,
            action: step.action,
            status: 'failed',
            resolvedDependencies: dependencyCheck.resolved,
            missingDependencies: [],
            errors: [adapterResult?.error || 'Unknown adapter failure.'],
            warnings: [],
            payload: step.payload,
          });
          continue;
        }

        registerRuntimeOutput(step, adapterResult, runtimeRefs);

        stepLogs.push({
          phase: phase.name,
          phaseLabel: phase.label,
          stepId: step.stepId,
          action: step.action,
          status: 'success',
          resolvedDependencies: dependencyCheck.resolved,
          missingDependencies: [],
          errors: [],
          warnings: [],
          payload: step.payload,
          adapterResult,
        });
      } catch (error) {
        stepLogs.push({
          phase: phase.name,
          phaseLabel: phase.label,
          stepId: step.stepId,
          action: step.action,
          status: 'failed',
          resolvedDependencies: dependencyCheck.resolved,
          missingDependencies: [],
          errors: [error.message],
          warnings: [],
          payload: step.payload,
        });
      }
    }

    phaseLogs.push({
      name: phase.name,
      label: phase.label,
      steps: stepLogs,
    });
    allStepLogs.push(...stepLogs);
  }

  const successCount = allStepLogs.filter((step) => step.status === 'success').length;
  const skippedCount = allStepLogs.filter((step) => step.status === 'skipped').length;
  const blockedCount = allStepLogs.filter((step) => step.status === 'blocked').length;
  const failedCount = allStepLogs.filter((step) => step.status === 'failed').length;

  let finalStatus = 'success';

  if (failedCount > 0 || blockedCount > 0) {
    finalStatus = successCount > 0 ? 'partial' : 'blocked';
  }

  const dryRun = {
    templateName: executionPlanResult.template.name,
    slug: executionPlanResult.slug,
    finalStatus,
    summary: {
      totalSteps: allStepLogs.length,
      successCount,
      skippedCount,
      blockedCount,
      failedCount,
      phaseCount: phaseLogs.length,
    },
    runtimeRefs,
    phases: phaseLogs,
    blockingErrors: executionPlanResult.plan.blockingErrors,
    warnings: executionPlanResult.plan.warnings,
  };

  const debugFilePath = writeDebugDryRun(executionPlanResult.slug, dryRun);

  logger.info('Discord template dry run completed', {
    template: executionPlanResult.slug,
    finalStatus,
    totalSteps: dryRun.summary.totalSteps,
    success: successCount,
    blocked: blockedCount,
    failed: failedCount,
    debugFile: Boolean(debugFilePath),
  });

  return {
    ok: true,
    slug: executionPlanResult.slug,
    template: executionPlanResult.template,
    plan: executionPlanResult.plan,
    dryRun,
    debugFilePath,
  };
};

module.exports = {
  executeDryRun,
};
