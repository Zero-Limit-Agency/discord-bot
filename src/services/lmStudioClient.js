const config = require('../config');
const logger = require('../utils/logger');
const { getProvider } = require('./aiProvider');
const { readBoundedText } = require('../utils/boundedResponse');
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const getRequestDurationMs = (startedAt) => Date.now() - startedAt;

const extractContentFromResponse = (payload) => {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
};

const extractContentFromStreamPayload = (payload) => {
  const content = payload?.choices?.[0]?.delta?.content
    ?? payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
};

const readStreamingContent = async (response) => {
  if (!response.body || typeof response.body.getReader !== 'function') {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let received = 0;

  const consumeLine = (line) => {
    const trimmed = line.trim();

    if (!trimmed.startsWith('data:')) {
      return;
    }

    const data = trimmed.slice(5).trim();

    if (!data || data === '[DONE]') {
      return;
    }

    try {
      content += extractContentFromStreamPayload(JSON.parse(data));
    } catch (error) {
      // Ignore malformed event lines; final empty-content validation still fails safely.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    received += value?.byteLength || 0;
    if (received > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('AI response too large.'); }
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    consumeLine(buffer);
  }

  return content;
};

const readResponseContent = async (response, streamingRequested) => {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();

  if (streamingRequested && contentType.includes('text/event-stream')) {
    return readStreamingContent(response);
  }

  const body = await readBoundedText(response, MAX_RESPONSE_BYTES);
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('AI response too large.');
  return extractContentFromResponse(JSON.parse(body));
};

const callLmStudio = async (requestPayload, options = {}) => {
  const provider = getProvider();
  if (!provider?.model || (provider.name === 'nvidia' && !provider.key)) return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', message: 'AI provider/model not configured.' };
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
  const streamingRequested = requestPayload?.stream !== false;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}),
      },
      body: JSON.stringify({
        ...requestPayload,
        model: provider.model,
        stream: streamingRequested,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const durationMs = getRequestDurationMs(startedAt);

      logger.warn('AI provider request failed', {
        status: response.status,
        durationMs,
      });

      return {
        ok: false,
        code: 'HTTP_ERROR',
        status: response.status,
        durationMs,
        timeoutMs,
        message: `AI provider ${provider.name} returned an HTTP error.`,
      };
    }

    const content = await readResponseContent(response, streamingRequested);
    const durationMs = getRequestDurationMs(startedAt);

    if (!content) {
      logger.warn('AI provider response content missing', {
        durationMs,
      });

      return {
        ok: false,
        code: 'INVALID_RESPONSE',
        durationMs,
        timeoutMs,
        message: `AI provider ${provider.name} returned an invalid response.`,
      };
    }

    logger.info('AI provider request completed', {
      durationMs,
      streaming: streamingRequested,
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

    logger.warn('AI provider request error', {
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
        : `AI provider ${provider.name} request failed.`,
    };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  callLmStudio,
  readStreamingContent,
};
