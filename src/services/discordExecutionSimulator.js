const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const { buildExecutionPlan } = require('./discordServerOrchestrator');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'simulations');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const writeDebugSimulation = (slug, simulation) => {
  if (isProduction()) {
    return null;
  }

  ensureDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(debugDirectoryPath, `${slug}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(simulation, null, 2));
  return filePath;
};

const createSimulatedId = (prefix, value) => `SIM_${prefix}_${String(value).replace(/[^A-Za-z0-9_]/g, '_')}`;

const resolveDependencies = (dependsOn, placeholderState) => {
  const resolved = [];
  const missing = [];

  dependsOn.forEach((dependency) => {
    if (placeholderState[dependency]) {
      resolved.push({
        placeholder: dependency,
        simulatedId: placeholderState[dependency],
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

const registerStepOutputs = (step, placeholderState) => {
  if (step.outputPlaceholder) {
    if (step.outputPlaceholder.startsWith('FUTURE_ROLE_')) {
      placeholderState[step.outputPlaceholder] = createSimulatedId('ROLE', step.templateRef || step.outputPlaceholder);
      return;
    }

    if (step.outputPlaceholder.startsWith('FUTURE_CATEGORY_')) {
      placeholderState[step.outputPlaceholder] = createSimulatedId('CATEGORY', step.templateRef || step.outputPlaceholder);
      return;
    }

    if (step.outputPlaceholder.startsWith('FUTURE_CHANNEL_')) {
      placeholderState[step.outputPlaceholder] = createSimulatedId('CHANNEL', step.templateRef || step.outputPlaceholder);
    }
  }
};

const simulateStep = (phase, step, placeholderState) => {
  const dependencyCheck = resolveDependencies(step.dependsOn || [], placeholderState);
  const stepWarnings = [];
  const stepErrors = [];

  if (dependencyCheck.missing.length) {
    return {
      phase: phase.name,
      phaseLabel: phase.label,
      stepId: step.stepId,
      action: step.action,
      status: 'blocked',
      resolvedDependencies: dependencyCheck.resolved,
      missingDependencies: dependencyCheck.missing,
      errors: [`Missing dependencies: ${dependencyCheck.missing.join(', ')}`],
      warnings: stepWarnings,
      payload: step.payload,
    };
  }

  registerStepOutputs(step, placeholderState);

  return {
    phase: phase.name,
    phaseLabel: phase.label,
    stepId: step.stepId,
    action: step.action,
    status: 'success',
    resolvedDependencies: dependencyCheck.resolved,
    missingDependencies: [],
    errors: stepErrors,
    warnings: stepWarnings,
    payload: step.payload,
    producedPlaceholder: step.outputPlaceholder || null,
    simulatedOutputId: step.outputPlaceholder ? placeholderState[step.outputPlaceholder] : null,
  };
};

const simulateExecutionPlan = (slug) => {
  const executionPlanResult = buildExecutionPlan(slug);

  if (!executionPlanResult.ok) {
    return executionPlanResult;
  }

  const placeholderState = {};
  const phaseLogs = [];
  const allStepLogs = [];

  executionPlanResult.plan.phases.forEach((phase) => {
    const steps = phase.steps.map((step) => simulateStep(phase, step, placeholderState));
    phaseLogs.push({
      name: phase.name,
      label: phase.label,
      steps,
    });
    allStepLogs.push(...steps);
  });

  const successCount = allStepLogs.filter((step) => step.status === 'success').length;
  const skippedCount = allStepLogs.filter((step) => step.status === 'skipped').length;
  const blockedCount = allStepLogs.filter((step) => step.status === 'blocked').length;

  let finalStatus = 'success';

  if (blockedCount > 0 && successCount === 0) {
    finalStatus = 'blocked';
  } else if (blockedCount > 0) {
    finalStatus = 'partial';
  }

  const simulation = {
    templateName: executionPlanResult.template.name,
    slug: executionPlanResult.slug,
    finalStatus,
    summary: {
      totalSteps: allStepLogs.length,
      successCount,
      skippedCount,
      blockedCount,
      phaseCount: phaseLogs.length,
    },
    placeholders: placeholderState,
    phases: phaseLogs,
    blockingErrors: executionPlanResult.plan.blockingErrors,
    warnings: executionPlanResult.plan.warnings,
  };

  const debugFilePath = writeDebugSimulation(executionPlanResult.slug, simulation);

  logger.info('Discord execution simulation completed', {
    template: executionPlanResult.slug,
    finalStatus,
    totalSteps: simulation.summary.totalSteps,
    success: successCount,
    skipped: skippedCount,
    blocked: blockedCount,
    debugFile: Boolean(debugFilePath),
  });

  return {
    ok: true,
    slug: executionPlanResult.slug,
    template: executionPlanResult.template,
    plan: executionPlanResult.plan,
    simulation,
    debugFilePath,
  };
};

module.exports = {
  simulateExecutionPlan,
};
