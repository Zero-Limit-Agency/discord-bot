const config = require('../config');
const logger = require('../utils/logger');

const getRequestDurationMs = (startedAt) => Date.now() - startedAt;

const extractContentFromResponse = (payload) => {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
};

const callLmStudio = async (requestPayload, options = {}) => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const runtimeTimeouts = typeof config.getRuntimeTimeoutConfig === 'function'
    ? config.getRuntimeTimeoutConfig()
    : { lmStudioTimeoutMs: config.lmStudioTimeoutMs };
  const requestedTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : null;
  const timeoutMs = typeof config.getEffectiveLmStudioTimeoutMs === 'function'
    ? config.getEffectiveLmStudioTimeoutMs(requestedTimeoutMs)
    : (requestedTimeoutMs || runtimeTimeouts.lmStudioTimeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.lmStudioBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const durationMs = getRequestDurationMs(startedAt);

    if (!response.ok) {
      logger.warn('LM Studio request failed', {
        status: response.status,
        durationMs,
      });

      return {
        ok: false,
        code: 'HTTP_ERROR',
        status: response.status,
        durationMs,
        timeoutMs,
        message: 'LM Studio returned an HTTP error.',
      };
    }

    const payload = await response.json();
    const content = extractContentFromResponse(payload);

    if (!content) {
      logger.warn('LM Studio response content missing', {
        durationMs,
      });

      return {
        ok: false,
        code: 'INVALID_RESPONSE',
        durationMs,
        timeoutMs,
        message: 'LM Studio returned an invalid response.',
      };
    }

    logger.info('LM Studio request completed', {
      durationMs,
    });

    return {
      ok: true,
      content,
      durationMs,
      timeoutMs,
    };
  } catch (error) {
    const durationMs = getRequestDurationMs(startedAt);
    const isTimeout = error?.name === 'AbortError';
    const hasTimeoutMismatch = Number.isFinite(requestedTimeoutMs)
      && requestedTimeoutMs > 0
      && runtimeTimeouts.lmStudioTimeoutMs < requestedTimeoutMs;

    logger.warn('LM Studio request error', {
      code: error?.name || 'UNKNOWN_ERROR',
      durationMs,
      timeoutMs,
      requestedTimeoutMs,
      configuredTimeoutMs: runtimeTimeouts.lmStudioTimeoutMs,
    });

    return {
      ok: false,
      code: isTimeout ? 'TIMEOUT' : 'REQUEST_FAILED',
      durationMs,
      timeoutMs,
      requestedTimeoutMs,
      configuredTimeoutMs: runtimeTimeouts.lmStudioTimeoutMs,
      hasTimeoutMismatch,
      message: isTimeout
        ? (hasTimeoutMismatch
          ? `LM Studio a atteint ${timeoutMs} ms apres alignement avec le timeout agent. Verifie la coherence entre LMSTUDIO_TIMEOUT_MS (${runtimeTimeouts.lmStudioTimeoutMs}) et le timeout agent demande (${requestedTimeoutMs}).`
          : 'LM Studio a mis trop de temps a repondre. Reessaie avec un prompt plus court ou augmente LMSTUDIO_TIMEOUT_MS.')
        : 'LM Studio request failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  callLmStudio,
};
