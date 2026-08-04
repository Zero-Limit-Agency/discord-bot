const fs = require('node:fs');
const path = require('node:path');
const {
  createBuildJobStore,
} = require('../src/services/buildJobService');
const {
  createBuildProgressReporter,
  formatBuildProgressContent,
} = require('../src/services/buildProgressReporter');

const verificationDirectoryPath = path.join(process.cwd(), '.data', 'verify-build-resilience');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const resetVerificationDirectory = () => {
  const resolved = path.resolve(verificationDirectoryPath);
  const allowedRoot = path.resolve(process.cwd(), '.data');

  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error('Refusing to reset a verification directory outside .data.');
  }

  fs.rmSync(resolved, { recursive: true, force: true });
};

const verifyJobLifecycle = () => {
  const store = createBuildJobStore({ jobsDirectoryPath: verificationDirectoryPath });
  const runId = 'verify-job-lifecycle';

  store.createJob({
    runId,
    userId: 'user-1',
    guildId: 'guild-1',
    mode: 'multi',
    status: 'queued',
  });
  store.recordProgress(runId, {
    agent: 'architect',
    status: 'running',
    retriesUsed: 0,
    debugFolder: 'debug/build-agents/verify-job-lifecycle',
  });
  store.recordProgress(runId, {
    agent: 'architect',
    status: 'completed',
    retriesUsed: 1,
    durationMs: 1234,
    timeoutMs: 900000,
    warnings: ['Architect output was repaired locally.'],
  });
  store.updateJob(runId, {
    status: 'completed',
    templateSlug: 'verified-template',
    templateStatus: 'valid',
  });

  const job = store.readJob(runId);
  assert(job.status === 'completed', 'Expected completed build job status.');
  assert(job.completedAgents.includes('architect'), 'Expected completed architect agent.');
  assert(job.retries.architect === 1, 'Expected persisted architect retry count.');
  assert(job.agentDurationsMs.architect === 1234, 'Expected persisted architect duration.');
  assert(job.agentTimeoutsMs.architect === 900000, 'Expected persisted architect timeout.');
  assert(job.warnings.includes('Architect output was repaired locally.'), 'Expected persisted agent warning.');
  assert(job.templateSlug === 'verified-template', 'Expected persisted template slug.');
  assert(!JSON.stringify(job).includes('DISCORD_TOKEN'), 'Job data must not contain secret names.');
};

const verifyRestartRecovery = () => {
  const store = createBuildJobStore({ jobsDirectoryPath: verificationDirectoryPath });
  const runId = 'verify-restart-recovery';

  store.createJob({ runId, mode: 'multi', status: 'running', currentAgent: 'content' });
  const reconciled = store.reconcileInterruptedJobs();
  const job = store.readJob(runId);

  assert(reconciled.some((entry) => entry.runId === runId), 'Expected interrupted job reconciliation.');
  assert(job.status === 'failed', 'Expected interrupted job to become failed.');
  assert(job.mainError.includes('restarted'), 'Expected a useful restart failure reason.');
};

const verifyDiscordFallback = async () => {
  const store = createBuildJobStore({ jobsDirectoryPath: verificationDirectoryPath });
  const runId = 'verify-discord-fallback';
  const edits = [];
  const directMessages = [];
  let editAttempts = 0;

  store.createJob({ runId, mode: 'multi', status: 'running', currentAgent: 'permissions' });

  const interaction = {
    editReply: async (payload) => {
      editAttempts += 1;

      if (editAttempts > 1) {
        throw new Error('Unknown Webhook');
      }

      edits.push(payload);
    },
    user: {
      send: async (payload) => {
        directMessages.push(payload);
      },
    },
  };
  const reporter = createBuildProgressReporter({
    interaction,
    getJob: () => store.readJob(runId),
    heartbeatMs: 0,
  });

  const progressDelivered = await reporter.update('agent-start');
  store.updateJob(runId, { status: 'completed', currentAgent: null, templateStatus: 'valid' });
  const finalDelivery = await reporter.sendFinal(
    { content: 'Rich final response', embeds: [] },
    `BUILD COMPLETED\nRun: ${runId}`,
  );

  assert(progressDelivered, 'Expected initial interaction progress update.');
  assert(edits.length === 1, 'Expected exactly one successful interaction edit.');
  assert(finalDelivery.delivered && finalDelivery.method === 'dm', 'Expected DM fallback delivery.');
  assert(directMessages.length === 1, 'Expected exactly one final DM.');
  assert(directMessages[0].content.includes(runId), 'Expected runId in fallback content.');

  const progressContent = formatBuildProgressContent(store.readJob(runId));
  assert(progressContent.length <= 1900, 'Progress content must stay below Discord limits.');
};

const main = async () => {
  resetVerificationDirectory();

  try {
    verifyJobLifecycle();
    verifyRestartRecovery();
    await verifyDiscordFallback();
    console.log('[PASS] build job lifecycle, restart recovery and Discord fallback');
  } finally {
    resetVerificationDirectory();
  }
};

main().catch((error) => {
  console.error(`[FAIL] verify-build-resilience: ${error.message}`);
  process.exitCode = 1;
});
