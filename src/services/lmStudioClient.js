const config = require('../config');
const logger = require('../utils/logger');

const previewText = (value, limit = 120) => {
  if (!value) {
    return '';
  }

  return value.length > limit ? `${value.slice(0, limit)}...` : value;
};

const callLmStudio = async (requestPayload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.lmStudioTimeoutMs);

  try {
    const response = await fetch(`${config.lmStudioBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn('LM Studio request failed', {
        status: response.status,
      });

      return {
        ok: false,
        code: 'LMSTUDIO_HTTP_ERROR',
        message: 'LM Studio returned an HTTP error.',
      };
    }

    const data = await response.json().catch(() => null);

    if (!data || !Array.isArray(data.choices) || !data.choices[0]?.message?.content) {
      logger.warn('LM Studio response format invalid');
      return {
        ok: false,
        code: 'LMSTUDIO_INVALID_RESPONSE',
        message: 'LM Studio returned an invalid response.',
      };
    }

    const content = String(data.choices[0].message.content);

    logger.info('LM Studio response received', {
      contentPreview: previewText(content),
    });

    return {
      ok: true,
      content,
      raw: data,
    };
  } catch (error) {
    logger.warn('LM Studio request error', {
      code: error.name || 'REQUEST_ERROR',
    });

    return {
      ok: false,
      code: error.name === 'AbortError' ? 'LMSTUDIO_TIMEOUT' : 'LMSTUDIO_NETWORK_ERROR',
      message: 'LM Studio request failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  callLmStudio,
};
