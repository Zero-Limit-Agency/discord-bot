const fs = require('node:fs');
const path = require('node:path');

const defaultJobsDirectoryPath = path.join(process.cwd(), '.data', 'build-jobs');
const terminalStatuses = new Set(['completed', 'failed']);
const allowedStatuses = new Set(['queued', 'running', 'completed', 'failed']);

const safeRunId = (value) => {
  const normalized = String(value || '').trim();

  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error('A safe build runId is required.');
  }

  return normalized;
};

const cleanString = (value, fallback = null, maxLength = 1000) => {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  return value.trim().slice(0, maxLength);
};

const cleanStringArray = (values, maxItems = 50) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => cleanString(value, null, 500))
    .filter(Boolean),
)).slice(0, maxItems);

const cleanRetries = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value)
    .map(([agent, count]) => [
      cleanString(agent, null, 50),
      Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0,
    ])
    .filter(([agent]) => Boolean(agent)));
};

const cleanNumberMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value)
    .map(([key, number]) => [
      cleanString(key, null, 50),
      Number.isFinite(Number(number)) ? Math.max(0, Math.trunc(Number(number))) : null,
    ])
    .filter(([key, number]) => Boolean(key) && number !== null));
};

const createBuildJobStore = ({ jobsDirectoryPath = defaultJobsDirectoryPath } = {}) => {
  const ensureDirectory = () => {
    fs.mkdirSync(jobsDirectoryPath, { recursive: true });
  };

  const getJobPath = (runId) => path.join(jobsDirectoryPath, `${safeRunId(runId)}.json`);

  const readJob = (runId) => {
    const filePath = getJobPath(runId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      return null;
    }
  };

  const writeJob = (job) => {
    ensureDirectory();
    const filePath = getJobPath(job.runId);
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
    return filePath;
  };

  const normalizeJob = (job) => {
    const now = new Date().toISOString();
    const status = allowedStatuses.has(job.status) ? job.status : 'queued';

    return {
      runId: safeRunId(job.runId),
      userId: cleanString(job.userId, null, 100),
      guildId: cleanString(job.guildId, null, 100),
      mode: cleanString(job.mode, 'single', 20),
      briefMode: cleanString(job.briefMode, null, 30),
      serverType: cleanString(job.serverType, null, 100),
      status,
      currentAgent: cleanString(job.currentAgent, null, 50),
      completedAgents: cleanStringArray(job.completedAgents, 10),
      retries: cleanRetries(job.retries),
      agentDurationsMs: cleanNumberMap(job.agentDurationsMs),
      agentTimeoutsMs: cleanNumberMap(job.agentTimeoutsMs),
      warnings: cleanStringArray(job.warnings, 25),
      mainError: cleanString(job.mainError, null, 1000),
      debugFolder: cleanString(job.debugFolder, null, 1000),
      templateSlug: cleanString(job.templateSlug, null, 150),
      templateStatus: cleanString(job.templateStatus, null, 30),
      createdAt: cleanString(job.createdAt, now, 50),
      startedAt: cleanString(job.startedAt, status === 'running' ? now : null, 50),
      updatedAt: now,
      finishedAt: terminalStatuses.has(status) ? cleanString(job.finishedAt, now, 50) : null,
    };
  };

  const createJob = (input) => {
    const runId = safeRunId(input?.runId);

    if (readJob(runId)) {
      throw new Error(`Build job "${runId}" already exists.`);
    }

    const job = normalizeJob({
      ...input,
      runId,
      status: input?.status || 'queued',
    });
    const filePath = writeJob(job);

    return { job, filePath };
  };

  const updateJob = (runId, patch) => {
    const current = readJob(runId);

    if (!current) {
      throw new Error(`Build job "${safeRunId(runId)}" was not found.`);
    }

    const nextStatus = allowedStatuses.has(patch?.status) ? patch.status : current.status;
    const next = normalizeJob({
      ...current,
      ...patch,
      runId: current.runId,
      status: nextStatus,
      completedAgents: patch?.completedAgents ?? current.completedAgents,
      retries: patch?.retries ?? current.retries,
      agentDurationsMs: patch?.agentDurationsMs ?? current.agentDurationsMs,
      agentTimeoutsMs: patch?.agentTimeoutsMs ?? current.agentTimeoutsMs,
      warnings: patch?.warnings ?? current.warnings,
      startedAt: current.startedAt || (nextStatus === 'running' ? new Date().toISOString() : null),
      finishedAt: terminalStatuses.has(nextStatus) ? (patch?.finishedAt || new Date().toISOString()) : null,
    });
    const filePath = writeJob(next);

    return { job: next, filePath };
  };

  const recordProgress = (runId, event = {}) => {
    const current = readJob(runId);

    if (!current || terminalStatuses.has(current.status)) {
      return current ? { job: current, filePath: getJobPath(runId) } : null;
    }

    const agent = cleanString(event.agent, null, 50);
    const completedAgents = [...current.completedAgents];
    const retries = { ...current.retries };
    const agentDurationsMs = { ...current.agentDurationsMs };
    const agentTimeoutsMs = { ...current.agentTimeoutsMs };

    if (agent && event.status === 'completed' && !completedAgents.includes(agent)) {
      completedAgents.push(agent);
    }

    if (agent && Number.isFinite(Number(event.retriesUsed))) {
      retries[agent] = Math.max(retries[agent] || 0, Math.trunc(Number(event.retriesUsed)));
    }

    if (agent && Number.isFinite(Number(event.durationMs))) {
      agentDurationsMs[agent] = Math.max(0, Math.trunc(Number(event.durationMs)));
    }

    if (agent && Number.isFinite(Number(event.timeoutMs))) {
      agentTimeoutsMs[agent] = Math.max(0, Math.trunc(Number(event.timeoutMs)));
    }

    return updateJob(runId, {
      status: event.status === 'failed' || event.status === 'timeout' ? 'failed' : 'running',
      currentAgent: ['completed', 'failed', 'timeout'].includes(event.status) ? null : agent,
      completedAgents,
      retries,
      agentDurationsMs,
      agentTimeoutsMs,
      warnings: [...current.warnings, ...cleanStringArray(event.warnings, 10)],
      mainError: ['failed', 'timeout'].includes(event.status)
        ? cleanString(event.error, 'Build agent failed.', 1000)
        : current.mainError,
      debugFolder: cleanString(event.debugFolder, current.debugFolder, 1000),
    });
  };

  const reconcileInterruptedJobs = () => {
    ensureDirectory();
    const reconciled = [];

    for (const entry of fs.readdirSync(jobsDirectoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const runId = entry.name.slice(0, -5);
      const job = readJob(runId);

      if (!job || !['queued', 'running'].includes(job.status)) {
        continue;
      }

      const result = updateJob(runId, {
        status: 'failed',
        currentAgent: null,
        mainError: 'Build interrupted because the bot process restarted.',
        warnings: [...(job.warnings || []), 'The build did not resume automatically after restart.'],
      });
      reconciled.push(result.job);
    }

    return reconciled;
  };

  return {
    jobsDirectoryPath,
    createJob,
    readJob,
    updateJob,
    recordProgress,
    reconcileInterruptedJobs,
  };
};

const defaultStore = createBuildJobStore();

module.exports = {
  createBuildJobStore,
  createBuildJob: defaultStore.createJob,
  getBuildJob: defaultStore.readJob,
  updateBuildJob: defaultStore.updateJob,
  recordBuildProgress: defaultStore.recordProgress,
  reconcileInterruptedBuildJobs: defaultStore.reconcileInterruptedJobs,
};
