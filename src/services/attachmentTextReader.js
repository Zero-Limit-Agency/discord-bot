const path = require('node:path');
const config = require('../config');
const logger = require('../utils/logger');

const supportedExtensions = new Set(['.txt', '.md', '.json']);

const getExtension = (fileName) => path.extname(String(fileName || '')).toLowerCase();

const readAttachmentText = async (attachment) => {
  if (!attachment) {
    return {
      ok: false,
      code: 'ATTACHMENT_MISSING',
      message: 'Attachment is required.',
    };
  }

  const extension = getExtension(attachment.name);

  if (!supportedExtensions.has(extension)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_ATTACHMENT_TYPE',
      message: 'Unsupported attachment type.',
    };
  }

  if ((attachment.size || 0) > config.attachmentTextMaxBytes) {
    return {
      ok: false,
      code: 'ATTACHMENT_TOO_LARGE',
      message: 'Attachment exceeds the maximum allowed size.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.attachmentFetchTimeoutMs);

  try {
    const response = await fetch(attachment.url, {
      signal: controller.signal,
      headers: {
        accept: 'text/plain, application/json, text/markdown;q=0.9, */*;q=0.1',
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        code: 'ATTACHMENT_DOWNLOAD_FAILED',
        message: 'Attachment download failed.',
      };
    }

    const text = await response.text();
    const warnings = [];

    if (!text.trim()) {
      warnings.push('Attachment text content is empty.');
    }

    return {
      ok: true,
      filename: attachment.name || 'unknown-file',
      contentType: attachment.contentType || response.headers.get('content-type') || null,
      size: attachment.size || Buffer.byteLength(text, 'utf8'),
      text,
      warnings,
    };
  } catch (error) {
    logger.warn('Attachment text read failed', {
      filename: attachment.name || 'unknown-file',
      code: error.name || 'READ_ERROR',
    });

    return {
      ok: false,
      code: error.name === 'AbortError' ? 'ATTACHMENT_TIMEOUT' : 'ATTACHMENT_READ_ERROR',
      message: 'Attachment could not be read.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  readAttachmentText,
  supportedAttachmentExtensions: Array.from(supportedExtensions),
};
