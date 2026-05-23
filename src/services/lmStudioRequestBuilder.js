const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const logger = require('../utils/logger');
const discordTemplateSystemPrompt = require('../prompts/discordTemplateSystemPrompt');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'build-requests');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const writeDebugRequest = (request) => {
  if (isProduction()) {
    return null;
  }

  ensureDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(debugDirectoryPath, `build-request-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(request, null, 2));
  return filePath;
};

const sanitizePrompt = (prompt) => {
  if (typeof prompt !== 'string') {
    return '';
  }

  return prompt.trim();
};

const normalizeAttachment = (attachment) => {
  if (!attachment) {
    return null;
  }

  return {
    filename: attachment.filename || attachment.name || 'unknown-file',
    contentType: attachment.contentType || null,
    size: attachment.size || 0,
    text: attachment.text || '',
    warnings: Array.isArray(attachment.warnings) ? attachment.warnings : [],
  };
};

const buildLmStudioRequest = ({ prompt, attachment, requestedBy }) => {
  const normalizedPrompt = sanitizePrompt(prompt);
  const normalizedAttachment = normalizeAttachment(attachment);

  if (!normalizedPrompt && !normalizedAttachment) {
    return {
      ok: false,
      code: 'MISSING_INPUT',
      message: 'A prompt or a file is required.',
    };
  }

  const userContent = [];

  if (normalizedPrompt) {
    userContent.push(`Prompt:\n${normalizedPrompt}`);
  }

  if (normalizedAttachment) {
    userContent.push([
      'Attached file metadata:',
      `- name: ${normalizedAttachment.filename}`,
      `- contentType: ${normalizedAttachment.contentType || 'unknown'}`,
      `- size: ${normalizedAttachment.size} bytes`,
      `- extractedCharacters: ${normalizedAttachment.text.length}`,
    ].join('\n'));

    if (normalizedAttachment.text) {
      userContent.push(`Attached file content:\n${normalizedAttachment.text}`);
    }
  }

  const request = {
    target: {
      provider: 'lm-studio',
      baseUrl: config.lmStudioBaseUrl,
      endpoint: '/v1/chat/completions',
      model: config.lmStudioModel || null,
    },
    requestedBy: {
      userId: requestedBy?.id || null,
      username: requestedBy?.username || null,
    },
    source: {
      prompt: normalizedPrompt || null,
      attachment: normalizedAttachment,
    },
    requestPayload: {
      model: config.lmStudioModel || 'MODEL_NOT_CONFIGURED',
      messages: [
        {
          role: 'system',
          content: discordTemplateSystemPrompt,
        },
        {
          role: 'user',
          content: userContent.join('\n\n'),
        },
      ],
      temperature: 0.2,
    },
  };

  const debugFilePath = writeDebugRequest(request);

  logger.info('LM Studio build request prepared', {
    hasPrompt: Boolean(normalizedPrompt),
    hasAttachment: Boolean(normalizedAttachment),
    modelConfigured: Boolean(config.lmStudioModel),
    debugFile: Boolean(debugFilePath),
  });

  return {
    ok: true,
    request,
    attachmentWarnings: normalizedAttachment ? normalizedAttachment.warnings : [],
    debugFilePath,
  };
};

module.exports = {
  buildLmStudioRequest,
};
