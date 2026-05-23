const config = require('../config');
const logger = require('../utils/logger');

const getRequestDurationMs = (startedAt) => Date.now() - startedAt;

const extractContentFromResponse = (payload) => {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
};

const callLmStudio = async (requestPayload) => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.lmStudioTimeoutMs);

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
    };
  } catch (error) {
    const durationMs = getRequestDurationMs(startedAt);
    const isTimeout = error?.name === 'AbortError';

    logger.warn('LM Studio request error', {
      code: error?.name || 'UNKNOWN_ERROR',
      durationMs,
    });

    return {
      ok: false,
      code: isTimeout ? 'TIMEOUT' : 'REQUEST_FAILED',
      durationMs,
      message: isTimeout
        ? 'LM Studio a mis trop de temps a repondre. Reessaie avec un prompt plus court ou augmente LMSTUDIO_TIMEOUT_MS.'
        : 'LM Studio request failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  callLmStudio,
};
