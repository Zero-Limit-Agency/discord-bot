const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');
const logger = require('../../utils/logger');
const { callLmStudio } = require('../lmStudioClient');
const { loadAiSkillsBlock } = require('../aiSkillLoader');
const { buildArchitectAgentRequest } = require('./architectAgent');
const { buildPermissionsAgentRequest } = require('./permissionsAgent');
const { buildContentAgentRequest } = require('./contentAgent');
const { assembleTemplateLocally } = require('./assemblerAgent');
const {
  guardArchitectOutput,
  guardPermissionsOutput,
  guardContentOutput,
  guardFinalTemplate,
} = require('./schemaGuards');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'build-agents');
let hasLoggedBuildRuntimeDiagnostics = false;

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const createRunId = () => new Date().toISOString().replace(/[:.]/g, '-');

const ensureRunDirectory = (runId) => {
  const runDirectoryPath = path.join(debugDirectoryPath, runId);
  fs.mkdirSync(runDirectoryPath, { recursive: true });
  return runDirectoryPath;
};

const writeDebugTextFile = (runDirectoryPath, agent, suffix, content) => {
  if (isProduction() || !runDirectoryPath) {
    return null;
  }

  const filePath = path.join(runDirectoryPath, `${agent}-${suffix}`);
  fs.writeFileSync(filePath, String(content || ''), 'utf8');
  return filePath;
};

const writeDebugJsonFile = (runDirectoryPath, agent, suffix, payload) => {
  if (isProduction() || !runDirectoryPath) {
    return null;
  }

  const filePath = path.join(runDirectoryPath, `${agent}-${suffix}`);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
};

const tryParseJsonObject = (content) => {
  try {
    const parsed = JSON.parse(content);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
};

const extractBalancedJsonSlice = (content) => {
  const startIndex = content.indexOf('{');

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return content.slice(startIndex, index + 1);
      }
    }
  }

  return null;
};

const extractAgentJson = (rawText) => {
  const trimmed = String(rawText || '').trim();

  if (!trimmed) {
    return {
      ok: false,
      mode: 'empty',
      message: 'The agent returned an empty response.',
    };
  }

  const directJson = tryParseJsonObject(trimmed);

  if (directJson) {
    return {
      ok: true,
      mode: 'direct',
      raw: trimmed,
      json: directJson,
    };
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)
    || trimmed.match(/```\s*([\s\S]*?)\s*```/i);

  if (fencedMatch) {
    const fencedContent = fencedMatch[1].trim();
    const fencedJson = tryParseJsonObject(fencedContent);

    if (fencedJson) {
      return {
        ok: true,
        mode: 'fenced',
        raw: fencedContent,
        json: fencedJson,
      };
    }
  }

  const balancedSlice = extractBalancedJsonSlice(trimmed);

  if (balancedSlice) {
    const balancedJson = tryParseJsonObject(balancedSlice);
    const remainder = trimmed.replace(balancedSlice, '').trim();

    if (balancedJson && !remainder.includes('{')) {
      return {
        ok: true,
        mode: 'balanced',
        raw: balancedSlice,
        json: balancedJson,
      };
    }
  }

  return {
    ok: false,
    mode: 'failed',
    message: 'The agent did not return a valid JSON object.',
  };
};

const summarizeError = (error, fallback) => {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
};

const createAgentFailureResult = ({
  agent,
  durationMs,
  timeoutMs = null,
  retriesUsed = 0,
  rawResponsePath = null,
  parsedJsonPath = null,
  errorPath = null,
  extractionPath = null,
  error,
  timeout = false,
  extractionMode = null,
  ...extra
}) => ({
  success: false,
  status: timeout ? 'timeout' : 'failed',
  agent,
  durationMs,
  timeoutMs,
  retriesUsed,
  rawResponsePath,
  parsedJsonPath,
  errorPath,
  extractionPath,
  error,
  timeout,
  extractionMode,
  output: null,
  ...extra,
});

const createAgentSuccessResult = ({
  agent,
  durationMs,
  timeoutMs = null,
  retriesUsed = 0,
  rawResponsePath = null,
  parsedJsonPath = null,
  extractionPath = null,
  extractionMode,
  output,
  rawResponse,
  ...extra
}) => ({
  success: true,
  status: 'success',
  agent,
  durationMs,
  timeoutMs,
  retriesUsed,
  rawResponsePath,
  parsedJsonPath,
  errorPath: null,
  extractionPath,
  error: null,
  timeout: false,
  extractionMode,
  output,
  rawResponse,
  ...extra,
});

const runAgent = async ({
  agent,
  requestPayload,
  runDirectoryPath,
  timeoutMs,
  attemptNumber = 1,
  retriesUsed = 0,
}) => {
  logger.info('Build agent started', {
    agent,
    timeoutMs,
    attemptNumber,
    retriesUsed,
  });

  try {
    const response = await callLmStudio(requestPayload, {
      timeoutMs,
    });

    const rawResponsePath = response.ok
      ? writeDebugTextFile(runDirectoryPath, agent, 'raw.txt', response.content)
      : null;

    if (!response.ok) {
      const errorMessage = summarizeError(response.message, 'The agent request failed.');
      const errorPath = writeDebugTextFile(runDirectoryPath, agent, 'error.txt', errorMessage);
      const extractionPath = writeDebugJsonFile(runDirectoryPath, agent, 'extraction.json', {
        ok: false,
        mode: response.code === 'TIMEOUT' ? 'timeout' : 'request-error',
        message: errorMessage,
      });

      logger.error('Build agent failed', {
        agent,
        error: errorMessage,
        durationMs: response.durationMs,
        timeoutMs,
        attemptNumber,
      });

      return createAgentFailureResult({
        agent,
        durationMs: response.durationMs,
        timeoutMs,
        retriesUsed,
        rawResponsePath,
        parsedJsonPath: null,
        errorPath,
        extractionPath,
        error: errorMessage,
        timeout: response.code === 'TIMEOUT',
        extractionMode: response.code === 'TIMEOUT' ? 'timeout' : 'request-error',
      });
    }

    const extraction = extractAgentJson(response.content);
    const extractionPath = writeDebugJsonFile(runDirectoryPath, agent, 'extraction.json', {
      ok: extraction.ok,
      mode: extraction.mode,
      message: extraction.message || null,
    });

    if (!extraction.ok) {
      const errorMessage = summarizeError(extraction.message, 'The agent returned invalid JSON.');
      const errorPath = writeDebugTextFile(runDirectoryPath, agent, 'error.txt', errorMessage);

      logger.error('Build agent failed', {
        agent,
        error: errorMessage,
        durationMs: response.durationMs,
        timeoutMs,
        attemptNumber,
      });

      return createAgentFailureResult({
        agent,
        durationMs: response.durationMs,
        timeoutMs,
        retriesUsed,
        rawResponsePath,
        parsedJsonPath: null,
        errorPath,
        extractionPath,
        error: errorMessage,
        timeout: false,
        extractionMode: extraction.mode,
      });
    }

    const parsedJsonPath = writeDebugJsonFile(runDirectoryPath, agent, 'parsed.json', extraction.json);

    logger.info('Build agent completed', {
      agent,
      durationMs: response.durationMs,
      timeoutMs,
      extractionMode: extraction.mode,
      attemptNumber,
    });

    return createAgentSuccessResult({
      agent,
      durationMs: response.durationMs,
      timeoutMs,
      retriesUsed,
      rawResponsePath,
      parsedJsonPath,
      extractionPath,
      extractionMode: extraction.mode,
      output: extraction.json,
      rawResponse: extraction.raw,
    });
  } catch (error) {
    const errorMessage = summarizeError(error, 'The agent execution crashed unexpectedly.');
    const errorPath = writeDebugTextFile(runDirectoryPath, agent, 'error.txt', errorMessage);
    const extractionPath = writeDebugJsonFile(runDirectoryPath, agent, 'extraction.json', {
      ok: false,
      mode: 'exception',
      message: errorMessage,
    });

    logger.error('Build agent failed', {
      agent,
      error: errorMessage,
      timeoutMs,
      attemptNumber,
    });

    return createAgentFailureResult({
      agent,
      durationMs: null,
      timeoutMs,
      retriesUsed,
      errorPath,
      extractionPath,
      error: errorMessage,
      timeout: false,
      extractionMode: 'exception',
    });
  }
};

const runLocalAssembler = ({
  architecture,
  permissions,
  content,
  runDirectoryPath,
  timeoutMs,
}) => {
  const startedAt = Date.now();

  logger.info('Build agent started', {
    agent: 'assembler',
    timeoutMs,
  });

  try {
    const assembly = assembleTemplateLocally({
      architecture,
      permissions,
      content,
    });
    const finalGuard = guardFinalTemplate(assembly.template);
    const durationMs = Date.now() - startedAt;
    const parsedJsonPath = writeDebugJsonFile(runDirectoryPath, 'assembler', 'merged.json', assembly.template);
    const guardedJsonPath = writeDebugJsonFile(runDirectoryPath, 'assembler', 'guarded.json', {
      ok: finalGuard.ok,
      errors: finalGuard.errors,
      warnings: [...assembly.warnings, ...finalGuard.warnings],
    });
    const extractionPath = writeDebugJsonFile(runDirectoryPath, 'assembler', 'extraction.json', {
      ok: finalGuard.ok,
      mode: 'local-merge',
      message: finalGuard.ok ? null : finalGuard.errors.join(' | '),
    });
    const warningsPath = writeDebugJsonFile(runDirectoryPath, 'assembler', 'warnings.json', {
      assemblyWarnings: assembly.warnings,
      finalWarnings: finalGuard.warnings,
    });

    if (!finalGuard.ok) {
      logger.error('Build agent failed', {
        agent: 'assembler',
        error: finalGuard.errors.join(' | '),
        durationMs,
        timeoutMs,
      });

      return createAgentFailureResult({
        agent: 'assembler',
        durationMs,
        timeoutMs,
        parsedJsonPath: guardedJsonPath || parsedJsonPath,
        extractionPath,
        error: finalGuard.errors.join(' | '),
        timeout: false,
        extractionMode: 'local-merge',
      });
    }

    logger.info('Build agent completed', {
      agent: 'assembler',
      durationMs,
      timeoutMs,
      extractionMode: 'local-merge',
    });

    return createAgentSuccessResult({
      agent: 'assembler',
      durationMs,
      timeoutMs,
      rawResponsePath: null,
      parsedJsonPath: guardedJsonPath || parsedJsonPath,
      extractionPath,
      extractionMode: 'local-merge',
      output: finalGuard.output,
      rawResponse: JSON.stringify(finalGuard.output, null, 2),
      warningsPath,
      agentWarnings: [...assembly.warnings, ...finalGuard.warnings],
    });
  } catch (error) {
    const errorMessage = summarizeError(error, 'The local assembler failed unexpectedly.');
    const durationMs = Date.now() - startedAt;
    const errorPath = writeDebugTextFile(runDirectoryPath, 'assembler', 'error.txt', errorMessage);
    const extractionPath = writeDebugJsonFile(runDirectoryPath, 'assembler', 'extraction.json', {
      ok: false,
      mode: 'local-merge',
      message: errorMessage,
    });

    logger.error('Build agent failed', {
      agent: 'assembler',
      error: errorMessage,
      durationMs,
      timeoutMs,
    });

    return createAgentFailureResult({
      agent: 'assembler',
      durationMs,
      timeoutMs,
      errorPath,
      extractionPath,
      error: errorMessage,
      timeout: false,
      extractionMode: 'local-merge',
    });
  }
};

const buildPromptContext = ({ prompt, attachment }) => [
  typeof prompt === 'string' ? prompt.trim() : '',
  attachment?.filename || '',
  attachment?.text || '',
].filter(Boolean).join('\n\n');

const buildSkillsMeta = (skillsBlock) => ({
  skillsEnabled: config.aiSkillsEnabled && skillsBlock.enabled,
  skillsMode: skillsBlock.mode,
  skillsLoaded: skillsBlock.skillFiles.length,
  skillsChars: skillsBlock.chars,
  selectedSkills: skillsBlock.selectedSkills,
  truncated: skillsBlock.truncated,
  maxChars: skillsBlock.maxChars,
});

const logBuildRuntimeDiagnosticsOnce = () => {
  if (hasLoggedBuildRuntimeDiagnostics) {
    return;
  }

  hasLoggedBuildRuntimeDiagnostics = true;
  const diagnostics = typeof config.getBuildRuntimeDiagnostics === 'function'
    ? config.getBuildRuntimeDiagnostics()
    : {
      pipelineMode: config.buildPipelineMode,
      agentDefaultTimeoutMs: config.buildAgentTimeoutMs,
      architectTimeoutMs: config.buildArchitectTimeoutMs,
      permissionsTimeoutMs: config.buildPermissionsTimeoutMs,
      contentTimeoutMs: config.buildContentTimeoutMs,
      assemblerTimeoutMs: config.buildAssemblerTimeoutMs,
      lmStudioTimeoutMs: config.lmStudioTimeoutMs,
      maxRetries: config.buildAgentMaxRetries,
      timeoutMismatch: false,
    };

  logger.info('Build runtime diagnostics', diagnostics);
};

const getAgentTimeoutMs = (agent) => {
  const runtimeTimeouts = typeof config.getRuntimeTimeoutConfig === 'function'
    ? config.getRuntimeTimeoutConfig()
    : {
      buildAgentTimeoutMs: config.buildAgentTimeoutMs,
      buildArchitectTimeoutMs: config.buildArchitectTimeoutMs,
      buildPermissionsTimeoutMs: config.buildPermissionsTimeoutMs,
      buildContentTimeoutMs: config.buildContentTimeoutMs,
      buildAssemblerTimeoutMs: config.buildAssemblerTimeoutMs,
    };

  switch (agent) {
    case 'architect':
      return runtimeTimeouts.buildArchitectTimeoutMs || runtimeTimeouts.buildAgentTimeoutMs;
    case 'permissions':
      return runtimeTimeouts.buildPermissionsTimeoutMs || runtimeTimeouts.buildAgentTimeoutMs;
    case 'content':
      return runtimeTimeouts.buildContentTimeoutMs || runtimeTimeouts.buildAgentTimeoutMs;
    case 'assembler':
      return runtimeTimeouts.buildAssemblerTimeoutMs || runtimeTimeouts.buildAgentTimeoutMs;
    default:
      return runtimeTimeouts.buildAgentTimeoutMs;
  }
};

const createCorrectionNote = (agent, failedResult, guardResult = null) => {
  const issues = [];

  if (failedResult?.error) {
    issues.push(failedResult.error);
  }

  if (guardResult?.errors?.length) {
    issues.push(...guardResult.errors.slice(0, 3));
  }

  return [
    `Retry ${agent} output.`,
    'Return only one strict JSON object.',
    'Do not add markdown or commentary.',
    issues.length ? `Fix these issues:\n- ${issues.join('\n- ')}` : 'Fix the previous schema issues.',
  ].join('\n');
};

const runGuardedAgent = async ({
  agent,
  buildRequestPayload,
  guardOutput,
  guardContext = {},
  runDirectoryPath,
  timeoutMs,
  maxRetries,
}) => {
  let retriesUsed = 0;
  let correctionNote = '';
  let lastRawResponse = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const requestPayload = buildRequestPayload(correctionNote);
    const result = await runAgent({
      agent,
      requestPayload,
      runDirectoryPath,
      timeoutMs,
      attemptNumber: attempt + 1,
      retriesUsed,
    });

    if (!result.success) {
      lastRawResponse = result.rawResponse || null;

      if (result.timeout || attempt === maxRetries) {
        return result;
      }

      retriesUsed += 1;
      correctionNote = createCorrectionNote(agent, result);
      continue;
    }

    const guardResult = guardOutput(result.output, guardContext);
    const guardDebugPath = writeDebugJsonFile(runDirectoryPath, `${agent}-attempt-${attempt + 1}`, 'guard.json', {
      ok: guardResult.ok,
      errors: guardResult.errors,
      warnings: guardResult.warnings,
    });

    if (guardResult.ok) {
      return {
        ...result,
        output: guardResult.output,
        retriesUsed,
        guardWarnings: guardResult.warnings,
        parsedJsonPath: guardDebugPath || result.parsedJsonPath,
      };
    }

    logger.warn('Build agent schema guard failed', {
      agent,
      attemptNumber: attempt + 1,
      retriesUsed,
      errors: guardResult.errors.length,
    });

    if (attempt === maxRetries) {
      return createAgentFailureResult({
        agent,
        durationMs: result.durationMs,
        timeoutMs,
        retriesUsed,
        rawResponsePath: result.rawResponsePath,
        parsedJsonPath: guardDebugPath || result.parsedJsonPath,
        extractionPath: result.extractionPath,
        error: guardResult.errors.join(' | '),
        timeout: false,
        extractionMode: result.extractionMode,
      });
    }

    retriesUsed += 1;
    lastRawResponse = result.rawResponse || lastRawResponse;
    correctionNote = [
      createCorrectionNote(agent, { error: guardResult.errors.join(' | ') }, guardResult),
      lastRawResponse ? `Previous response:\n${String(lastRawResponse).slice(0, 2500)}` : '',
    ].filter(Boolean).join('\n\n');
  }

  return createAgentFailureResult({
    agent,
    durationMs: null,
    timeoutMs,
    retriesUsed,
    error: `${agent} exhausted retries unexpectedly.`,
    timeout: false,
    extractionMode: 'retry-exhausted',
  });
};

const stopWithFailure = ({
  runId,
  runDirectoryPath,
  agentRuns,
  failedAgentRun,
  skillsMeta,
}) => ({
  ok: false,
  mode: 'multi',
  runId,
  runDirectoryPath,
  failedAgent: failedAgentRun.agent,
  error: failedAgentRun.error,
  timeout: Boolean(failedAgentRun.timeout),
  agentRuns,
  skillsMeta,
});

const runBuildAgentPipeline = async ({ prompt, attachment, normalizedBrief = null }) => {
  logBuildRuntimeDiagnosticsOnce();
  const runId = createRunId();
  const runDirectoryPath = isProduction()
    ? null
    : (ensureDebugDirectory(), ensureRunDirectory(runId));
  const agentRuns = [];

  try {
    const skillsBlock = loadAiSkillsBlock({
      promptContext: buildPromptContext({ prompt, attachment }),
      mode: 'minimal',
      maxCharacters: Math.min(config.aiSkillsMaxChars, 2000),
    });
    const skillsMeta = buildSkillsMeta(skillsBlock);
    const model = config.lmStudioModel || 'MODEL_NOT_CONFIGURED';
    const maxRetries = typeof config.getRuntimeTimeoutConfig === 'function'
      ? config.getRuntimeTimeoutConfig().buildAgentMaxRetries
      : config.buildAgentMaxRetries;

    const architectRun = await runGuardedAgent({
      agent: 'architect',
      buildRequestPayload: (correctionNote) => buildArchitectAgentRequest({
        prompt,
        attachment,
        normalizedBrief,
        skillsBlock,
        model,
        correctionNote,
      }),
      guardOutput: guardArchitectOutput,
      guardContext: {
        normalizedBrief,
      },
      runDirectoryPath,
      timeoutMs: getAgentTimeoutMs('architect'),
      maxRetries,
    });
    agentRuns.push(architectRun);

    if (!architectRun.success) {
      return stopWithFailure({
        runId,
        runDirectoryPath,
        agentRuns,
        failedAgentRun: architectRun,
        skillsMeta,
      });
    }

    const permissionsRun = await runGuardedAgent({
      agent: 'permissions',
      buildRequestPayload: (correctionNote) => buildPermissionsAgentRequest({
        architecture: architectRun.output,
        normalizedBrief,
        model,
        correctionNote,
      }),
      guardOutput: guardPermissionsOutput,
      guardContext: {
        architecture: architectRun.output,
      },
      runDirectoryPath,
      timeoutMs: getAgentTimeoutMs('permissions'),
      maxRetries,
    });
    agentRuns.push(permissionsRun);

    if (!permissionsRun.success) {
      return stopWithFailure({
        runId,
        runDirectoryPath,
        agentRuns,
        failedAgentRun: permissionsRun,
        skillsMeta,
      });
    }

    const contentRun = await runGuardedAgent({
      agent: 'content',
      buildRequestPayload: (correctionNote) => buildContentAgentRequest({
        architecture: architectRun.output,
        normalizedBrief,
        model,
        correctionNote,
      }),
      guardOutput: guardContentOutput,
      guardContext: {
        architecture: architectRun.output,
        normalizedBrief,
      },
      runDirectoryPath,
      timeoutMs: getAgentTimeoutMs('content'),
      maxRetries,
    });
    agentRuns.push(contentRun);

    if (!contentRun.success) {
      return stopWithFailure({
        runId,
        runDirectoryPath,
        agentRuns,
        failedAgentRun: contentRun,
        skillsMeta,
      });
    }

    const assemblerRun = runLocalAssembler({
      architecture: architectRun.output,
      permissions: permissionsRun.output,
      content: contentRun.output,
      runDirectoryPath,
      timeoutMs: getAgentTimeoutMs('assembler'),
    });
    agentRuns.push(assemblerRun);

    if (!assemblerRun.success) {
      return stopWithFailure({
        runId,
        runDirectoryPath,
        agentRuns,
        failedAgentRun: assemblerRun,
        skillsMeta,
      });
    }

    return {
      ok: true,
      mode: 'multi',
      runId,
      runDirectoryPath,
      finalJson: assemblerRun.output,
      finalRaw: assemblerRun.rawResponse,
      normalizedBrief,
      agentRuns,
      skillsMeta,
    };
  } catch (error) {
    const errorMessage = summarizeError(error, 'The multi-agent pipeline crashed unexpectedly.');
    const errorPath = writeDebugTextFile(runDirectoryPath, 'pipeline', 'error.txt', errorMessage);
    const pipelineFailure = {
      success: false,
      status: 'failed',
      agent: 'pipeline',
      durationMs: null,
      timeoutMs: null,
      rawResponsePath: null,
      parsedJsonPath: null,
      errorPath,
      extractionPath: null,
      error: errorMessage,
      timeout: false,
      extractionMode: 'exception',
      output: null,
    };

    agentRuns.push(pipelineFailure);
    logger.error('Build agent failed', {
      agent: 'pipeline',
      error: errorMessage,
    });

    return stopWithFailure({
      runId,
      runDirectoryPath,
      agentRuns,
      failedAgentRun: pipelineFailure,
      skillsMeta: {
        skillsEnabled: false,
        skillsMode: 'minimal',
        skillsLoaded: 0,
        skillsChars: 0,
        selectedSkills: [],
        truncated: false,
        maxChars: Math.min(config.aiSkillsMaxChars, 2000),
      },
    });
  }
};

module.exports = {
  runBuildAgentPipeline,
  logBuildRuntimeDiagnosticsOnce,
};
