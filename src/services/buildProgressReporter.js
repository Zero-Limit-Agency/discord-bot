const logger = require('../utils/logger');

const MAX_PROGRESS_CONTENT_LENGTH = 1900;

const safeText = (value, fallback = 'N/A', maxLength = 500) => {
  const normalized = String(value ?? '').trim();
  return (normalized || fallback).slice(0, maxLength);
};

const formatElapsed = (startedAt, now = Date.now()) => {
  const startedMs = new Date(startedAt).getTime();

  if (!Number.isFinite(startedMs)) {
    return 'N/A';
  }

  const totalSeconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const formatRetries = (retries = {}) => {
  const entries = Object.entries(retries)
    .filter(([, count]) => Number(count) > 0)
    .map(([agent, count]) => `${agent}:${Math.trunc(Number(count))}`);

  return entries.length ? entries.join(', ') : '0';
};

const formatBuildProgressContent = (job, now = Date.now()) => {
  const completed = Array.isArray(job?.completedAgents) && job.completedAgents.length
    ? job.completedAgents.join(', ')
    : 'none';
  const lines = [
    `BUILD ${safeText(job?.status, 'running').toUpperCase()}`,
    `Run: ${safeText(job?.runId)}`,
    `Mode: ${safeText(job?.mode, 'single')}`,
    `Current: ${safeText(job?.currentAgent, job?.status === 'queued' ? 'queued' : 'finalizing')}`,
    `Completed: ${safeText(completed, 'none')}`,
    `Retries: ${formatRetries(job?.retries)}`,
    `Elapsed: ${formatElapsed(job?.startedAt || job?.createdAt, now)}`,
    `Debug: ${safeText(job?.debugFolder, 'pending')}`,
  ];

  if (job?.mainError) {
    lines.push(`Main cause: ${safeText(job.mainError, 'Unknown error', 350)}`);
  }

  return lines.join('\n').slice(0, MAX_PROGRESS_CONTENT_LENGTH);
};

const withoutInteractionFlags = (payload = {}) => {
  const { flags, ...safePayload } = payload;
  return safePayload;
};

const createBuildProgressReporter = ({
  interaction,
  getJob,
  heartbeatMs = 60000,
}) => {
  let heartbeat = null;
  let interactionAvailable = true;
  let lastInteractionError = null;

  const tryEdit = async (payload, phase) => {
    if (!interactionAvailable) {
      return false;
    }

    try {
      await interaction.editReply(payload);
      return true;
    } catch (error) {
      interactionAvailable = false;
      lastInteractionError = error;
      logger.warn('Build interaction update unavailable', {
        runId: getJob()?.runId,
        phase,
        error: safeText(error?.message, 'Unknown Discord response error.'),
      });
      return false;
    }
  };

  const update = async (phase = 'progress') => {
    const job = getJob();

    if (!job) {
      return false;
    }

    return tryEdit({
      content: formatBuildProgressContent(job),
      embeds: [],
    }, phase);
  };

  const start = () => {
    if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0 || heartbeat) {
      return;
    }

    heartbeat = setInterval(() => {
      update('heartbeat').catch((error) => {
        logger.warn('Build progress heartbeat failed', {
          runId: getJob()?.runId,
          error: safeText(error?.message, 'Unknown heartbeat error.'),
        });
      });
    }, heartbeatMs);
    heartbeat.unref?.();
  };

  const stop = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const sendFinal = async (payload, fallbackContent) => {
    stop();
    const interactionPayload = Object.prototype.hasOwnProperty.call(payload || {}, 'content')
      ? payload
      : { ...payload, content: null };

    if (await tryEdit(interactionPayload, 'final')) {
      return { delivered: true, method: 'interaction' };
    }

    if (!interaction?.user || typeof interaction.user.send !== 'function') {
      return { delivered: false, method: 'none', error: lastInteractionError };
    }

    try {
      const dmPayload = withoutInteractionFlags(payload);

      if (fallbackContent) {
        dmPayload.content = safeText(fallbackContent, 'Build finished. See bot logs for details.', 1900);
      }

      await interaction.user.send(dmPayload);
      logger.info('Build final response delivered by DM fallback', { runId: getJob()?.runId });
      return { delivered: true, method: 'dm' };
    } catch (error) {
      logger.error('Failed to deliver build final response', {
        runId: getJob()?.runId,
        interactionError: safeText(lastInteractionError?.message, 'None'),
        dmError: safeText(error?.message, 'Unknown DM error.'),
      });
      return { delivered: false, method: 'none', error };
    }
  };

  return {
    start,
    stop,
    update,
    sendFinal,
    isInteractionAvailable: () => interactionAvailable,
  };
};

module.exports = {
  createBuildProgressReporter,
  formatBuildProgressContent,
  formatElapsed,
};
