const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const { buildExecutionPlan } = require('./discordServerOrchestrator');
const mockAdapter = require('./executionAdapters/mockDiscordExecutionAdapter');

const dryRunDebugDirectoryPath = path.join(process.cwd(), 'debug', 'dry-runs');
const liveRunDebugDirectoryPath = path.join(process.cwd(), 'debug', 'live-runs');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = (directoryPath) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const writeDebugRun = (directoryPath, slug, runLog) => {
  if (isProduction()) {
    return null;
  }

  ensureDebugDirectory(directoryPath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(directoryPath, `${slug}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(runLog, null, 2));
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
        resolvedParentId: step.payload.parent
          ? runtimeRefs[`FUTURE_CATEGORY_${step.payload.parent}`] || null
          : null,
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
  const outputId = adapterResult.runtimeId || adapterResult.simulatedId || null;

  if (step.outputPlaceholder && outputId) {
    runtimeRefs[step.outputPlaceholder] = outputId;
  }
};

const createRunLog = (executionPlanResult, phaseLogs, runtimeRefs) => {
  const allStepLogs = phaseLogs.flatMap((phase) => phase.steps);
  const successCount = allStepLogs.filter((step) => step.status === 'success').length;
  const skippedCount = allStepLogs.filter((step) => step.status === 'skipped').length;
  const blockedCount = allStepLogs.filter((step) => step.status === 'blocked').length;
  const failedCount = allStepLogs.filter((step) => step.status === 'failed').length;

  let finalStatus = 'success';

  if (failedCount > 0 || blockedCount > 0) {
    finalStatus = successCount > 0 ? 'partial' : 'blocked';
  }

  return {
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
};

const executeTemplateRunFromPlan = async (executionPlanResult, adapter, options = {}) => {
  if (executionPlanResult.plan.status !== 'ready') {
    logger.warn('Discord template run blocked before execution', {
      template: executionPlanResult.slug,
      blockingErrors: executionPlanResult.plan.blockingErrors.length,
      warnings: executionPlanResult.plan.warnings.length,
      mode: options.mode || 'unknown',
    });

    return {
      ok: false,
      code: 'EXECUTION_PLAN_BLOCKED',
      message: 'Execution plan is blocked.',
      errors: executionPlanResult.plan.blockingErrors,
      warnings: executionPlanResult.plan.warnings,
      slug: executionPlanResult.slug,
      template: executionPlanResult.template,
      plan: executionPlanResult.plan,
      debugFilePath: executionPlanResult.debugFilePath || null,
    };
  }

  const runtimeRefs = {};
  const phaseLogs = [];

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
  }

  const runLog = createRunLog(executionPlanResult, phaseLogs, runtimeRefs);
  const debugFilePath = writeDebugRun(options.debugDirectoryPath, executionPlanResult.slug, runLog);

  logger.info('Discord template run completed', {
    template: executionPlanResult.slug,
    mode: options.mode || 'unknown',
    finalStatus: runLog.finalStatus,
    totalSteps: runLog.summary.totalSteps,
    success: runLog.summary.successCount,
    blocked: runLog.summary.blockedCount,
    failed: runLog.summary.failedCount,
    debugFile: Boolean(debugFilePath),
  });

  return {
    ok: true,
    slug: executionPlanResult.slug,
    template: executionPlanResult.template,
    templateDiagnostics: executionPlanResult.templateDiagnostics || executionPlanResult.plan.templateDiagnostics,
    plan: executionPlanResult.plan,
    run: runLog,
    debugFilePath,
  };
};

const executeTemplateRun = async (slug, adapter, options = {}) => {
  const executionPlanResult = buildExecutionPlan(slug);

  if (!executionPlanResult.ok) {
    return executionPlanResult;
  }

  return executeTemplateRunFromPlan(executionPlanResult, adapter, options);
};

const executeDryRun = async (slug, adapter = mockAdapter) => {
  const result = await executeTemplateRun(slug, adapter, {
    mode: 'dry-run',
    debugDirectoryPath: dryRunDebugDirectoryPath,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    slug: result.slug,
    template: result.template,
    templateDiagnostics: result.templateDiagnostics,
    plan: result.plan,
    dryRun: result.run,
    debugFilePath: result.debugFilePath,
  };
};

const executeLiveRun = async (slug, adapter) => {
  const result = await executeTemplateRun(slug, adapter, {
    mode: 'live-run',
    debugDirectoryPath: liveRunDebugDirectoryPath,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    slug: result.slug,
    template: result.template,
    templateDiagnostics: result.templateDiagnostics,
    plan: result.plan,
    liveRun: result.run,
    debugFilePath: result.debugFilePath,
  };
};

module.exports = {
  executeDryRun,
  executeLiveRun,
  executeTemplateRunFromPlan,
};
