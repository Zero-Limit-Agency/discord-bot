const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const logger = require('../utils/logger');
const discordTemplateSystemPrompt = require('../prompts/discordTemplateSystemPrompt');
const { loadAiSkillsBlock } = require('./aiSkillLoader');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'build-requests');
const finalPromptDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-final-prompts');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const ensureFinalPromptDebugDirectory = () => {
  fs.mkdirSync(finalPromptDebugDirectoryPath, { recursive: true });
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

const writeFinalPromptDebugFile = (messages, metadata) => {
  if (isProduction()) {
    return null;
  }

  ensureFinalPromptDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(finalPromptDebugDirectoryPath, `build-final-prompt-${timestamp}.txt`);
  const content = [
    '[METADATA]',
    JSON.stringify(metadata, null, 2),
    '',
    ...messages.map((message) => `[${message.role.toUpperCase()}]\n${message.content}`),
  ].join('\n\n');
  fs.writeFileSync(filePath, content, 'utf8');
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

const formatNormalizedBriefSection = (normalizedBrief) => {
  if (!normalizedBrief) {
    return '';
  }

  return [
    'Normalized brief:',
    `Summary: ${normalizedBrief.summary || 'N/A'}`,
    `Server Type: ${normalizedBrief.serverType || 'general'}`,
    `Tone: ${normalizedBrief.tone || 'professional'}`,
    `Audience: ${(normalizedBrief.audience || []).join(', ') || 'N/A'}`,
    `Goals: ${(normalizedBrief.goals || []).join(', ') || 'N/A'}`,
    `Required Areas: ${(normalizedBrief.requiredAreas || []).join(', ') || 'N/A'}`,
    `Roles Mentioned: ${(normalizedBrief.rolesMentioned || []).join(', ') || 'N/A'}`,
    `Channels Mentioned: ${(normalizedBrief.channelsMentioned || []).join(', ') || 'N/A'}`,
    `Permission Hints: ${(normalizedBrief.permissionHints || []).join(', ') || 'N/A'}`,
    `Onboarding Hints: ${(normalizedBrief.onboardingHints || []).join(', ') || 'N/A'}`,
    `Support Hints: ${(normalizedBrief.supportHints || []).join(', ') || 'N/A'}`,
    `Constraints: ${(normalizedBrief.constraints || []).join(' | ') || 'N/A'}`,
    `Assumptions: ${(normalizedBrief.assumptions || []).join(' | ') || 'N/A'}`,
  ].join('\n');
};

const buildLmStudioRequest = ({ prompt, attachment, requestedBy, normalizedBrief = null }) => {
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
  const promptContext = [
    normalizedPrompt,
    normalizedAttachment?.filename || '',
    normalizedAttachment?.text || '',
  ].filter(Boolean).join('\n\n');
  const skillsBlock = loadAiSkillsBlock({
    promptContext,
  });

  if (normalizedPrompt) {
    userContent.push(`Prompt:\n${normalizedPrompt}`);
  }

  if (normalizedBrief) {
    userContent.push(formatNormalizedBriefSection(normalizedBrief));
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

  const messages = [
    {
      role: 'system',
      content: discordTemplateSystemPrompt,
    },
  ];

  if (config.aiSkillsEnabled && skillsBlock.enabled && skillsBlock.content) {
    messages.push({
      role: 'system',
      content: [
        'Use the following local Discord architecture skills and doctrine as contextual guidance.',
        'Apply them intelligently to incomplete briefs.',
        'Prefer coherent, professional, modern Discord structures.',
        skillsBlock.content,
      ].join('\n\n'),
    });
  }

  messages.push({
    role: 'user',
    content: userContent.join('\n\n'),
  });

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
      normalizedBrief,
    },
    requestPayload: {
      model: config.lmStudioModel || 'MODEL_NOT_CONFIGURED',
      messages,
      temperature: 0.2,
    },
  };

  const debugFilePath = writeDebugRequest(request);
  const finalPromptDebugFilePath = writeFinalPromptDebugFile(messages, {
    skillsEnabled: config.aiSkillsEnabled && skillsBlock.enabled,
    skillsMode: skillsBlock.mode,
    skillsLoaded: skillsBlock.skillFiles.length,
    skillsChars: skillsBlock.chars,
    selectedSkills: skillsBlock.selectedSkills,
    truncated: skillsBlock.truncated,
    maxChars: skillsBlock.maxChars,
  });

  logger.info('LM Studio build request prepared', {
    hasPrompt: Boolean(normalizedPrompt),
    hasAttachment: Boolean(normalizedAttachment),
    modelConfigured: Boolean(config.lmStudioModel),
    debugFile: Boolean(debugFilePath),
    skillsLoaded: skillsBlock.skillFiles.length,
    skillsChars: skillsBlock.chars,
    skillsMode: skillsBlock.mode,
    finalPromptDebugFile: Boolean(finalPromptDebugFilePath),
  });

  return {
    ok: true,
    request,
    attachmentWarnings: normalizedAttachment ? normalizedAttachment.warnings : [],
    debugFilePath,
    finalPromptDebugFilePath,
    skillsMeta: {
      skillsEnabled: config.aiSkillsEnabled && skillsBlock.enabled,
      skillsMode: skillsBlock.mode,
      skillsLoaded: skillsBlock.skillFiles.length,
      skillsChars: skillsBlock.chars,
      selectedSkills: skillsBlock.selectedSkills,
      truncated: skillsBlock.truncated,
    },
    normalizedBrief,
  };
};

module.exports = {
  buildLmStudioRequest,
};
