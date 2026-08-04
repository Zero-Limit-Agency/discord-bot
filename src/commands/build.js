const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('../config');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { buildLmStudioRequest } = require('../services/lmStudioRequestBuilder');
const { readAttachmentText } = require('../services/attachmentTextReader');
const { callLmStudio } = require('../services/lmStudioClient');
const { validateTemplate } = require('../services/discordTemplateService');
const { saveDraftTemplate } = require('../services/draftTemplateStore');
const { normalizeTemplate } = require('../services/templateNormalizer');
const { repairTemplate } = require('../services/templateRepairService');
const {
  runBuildAgentPipeline,
  logBuildRuntimeDiagnosticsOnce,
} = require('../services/buildAgents/buildAgentPipeline');
const { buildServerPlan } = require('../services/serverGenerator');
const { buildDiscordPayloads } = require('../services/discordPayloadBuilder');
const { buildExecutionPlan } = require('../services/discordServerOrchestrator');
const { executeDryRun } = require('../services/discordTemplateRunner');
const {
  createTemplatePreviewEmbed,
  createTemplateExecutionPlanEmbed,
  createTemplateDryRunEmbed,
} = require('../embeds/templatePreviewEmbed');
const {
  countDiagnostics,
  getPrimaryIssue,
  inferTemplateStatus,
  summarizeDiagnostics,
  uniqueDiagnostics,
} = require('../utils/templateDiagnostics');
const {
  normalizeBuildBrief,
  writeNormalizedBriefDebugFile,
} = require('../services/buildBriefNormalizer');
const {
  createBuildJob,
  getBuildJob,
  recordBuildProgress,
  updateBuildJob,
} = require('../services/buildJobService');
const { createBuildProgressReporter } = require('../services/buildProgressReporter');
const fs = require('node:fs');
const path = require('node:path');

const generatedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-generated-templates');
const lmStudioRawResponseDebugDirectoryPath = path.join(process.cwd(), 'debug', 'lmstudio-raw-responses');
const normalizedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-normalized-templates');
const repairedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-repaired-templates');
const buildReportDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-reports');
const buildCrashDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-crashes');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureGeneratedTemplateDebugDirectory = () => {
  fs.mkdirSync(generatedTemplateDebugDirectoryPath, { recursive: true });
};

const ensureLmStudioRawResponseDebugDirectory = () => {
  fs.mkdirSync(lmStudioRawResponseDebugDirectoryPath, { recursive: true });
};

const ensureNormalizedTemplateDebugDirectory = () => {
  fs.mkdirSync(normalizedTemplateDebugDirectoryPath, { recursive: true });
};

const ensureRepairedTemplateDebugDirectory = () => {
  fs.mkdirSync(repairedTemplateDebugDirectoryPath, { recursive: true });
};

const ensureBuildReportDebugDirectory = () => {
  fs.mkdirSync(buildReportDebugDirectoryPath, { recursive: true });
};

const ensureBuildCrashDebugDirectory = () => {
  fs.mkdirSync(buildCrashDebugDirectoryPath, { recursive: true });
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

const writeLmStudioRawResponseDebugFile = (rawText) => {
  if (isProduction()) {
    return null;
  }

  ensureLmStudioRawResponseDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(lmStudioRawResponseDebugDirectoryPath, `lmstudio-raw-response-${timestamp}.txt`);
  fs.writeFileSync(filePath, String(rawText || ''), 'utf8');
  return filePath;
};

const extractFirstJsonObjectSlice = (content) => {
  const startIndex = content.indexOf('{');

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
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

const extractStrictJsonObject = (content) => {
  const trimmed = String(content || '').trim();

  if (!trimmed) {
    return {
      ok: false,
      code: 'EMPTY_RESPONSE',
      message: 'LM Studio returned an empty response.',
    };
  }

  const directJson = tryParseJsonObject(trimmed);

  if (directJson) {
    return {
      ok: true,
      json: directJson,
      raw: trimmed,
      extractionMode: 'direct',
    };
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/```\s*([\s\S]*?)\s*```/i);

  if (fencedMatch) {
    const fencedContent = fencedMatch[1].trim();
    const fencedJson = tryParseJsonObject(fencedContent);

    if (fencedJson) {
      return {
        ok: true,
        json: fencedJson,
        raw: fencedContent,
        extractionMode: 'fenced',
      };
    }
  }

  const objectSlice = extractFirstJsonObjectSlice(trimmed);

  if (objectSlice) {
    const parsedSlice = tryParseJsonObject(objectSlice);
    const remainder = trimmed.replace(objectSlice, '').trim();

    if (parsedSlice && !remainder.includes('{')) {
      return {
        ok: true,
        json: parsedSlice,
        raw: objectSlice,
        extractionMode: 'slice',
      };
    }
  }

  return {
    ok: false,
    code: 'INVALID_JSON',
    message: 'LM Studio returned invalid or ambiguous JSON.',
  };
};

const writeGeneratedTemplateDebugFile = (slugHint, jsonText) => {
  if (isProduction()) {
    return null;
  }

  ensureGeneratedTemplateDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const normalizedSlug = String(slugHint || 'generated-template').replace(/[^A-Za-z0-9_-]/g, '-');
  const filePath = path.join(generatedTemplateDebugDirectoryPath, `${normalizedSlug}-${timestamp}.json`);
  fs.writeFileSync(filePath, jsonText);
  return filePath;
};

const writeNormalizedTemplateDebugFile = (slugHint, template) => {
  if (isProduction()) {
    return null;
  }

  ensureNormalizedTemplateDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const normalizedSlug = String(slugHint || 'normalized-template').replace(/[^A-Za-z0-9_-]/g, '-');
  const filePath = path.join(normalizedTemplateDebugDirectoryPath, `${normalizedSlug}-${timestamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return filePath;
};

const writeRepairedTemplateDebugFile = (slugHint, template) => {
  if (isProduction()) {
    return null;
  }

  ensureRepairedTemplateDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const normalizedSlug = String(slugHint || 'repaired-template').replace(/[^A-Za-z0-9_-]/g, '-');
  const filePath = path.join(repairedTemplateDebugDirectoryPath, `${normalizedSlug}-${timestamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return filePath;
};

const writeBuildReportDebugFile = (slugHint, report) => {
  if (isProduction()) {
    return null;
  }

  ensureBuildReportDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const normalizedSlug = String(slugHint || 'build-report').replace(/[^A-Za-z0-9_-]/g, '-');
  const filePath = path.join(buildReportDebugDirectoryPath, `${normalizedSlug}-${timestamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
};

const writeBuildCrashDebugFile = (error) => {
  if (isProduction()) {
    return null;
  }

  ensureBuildCrashDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(buildCrashDebugDirectoryPath, `build-crash-${timestamp}.txt`);
  const crashContent = [
    `name: ${safeString(error?.name, 'UnknownError')}`,
    `message: ${safeString(error?.message, 'No error message')}`,
    `cause: ${safeString(error?.cause?.message || error?.cause, 'None')}`,
    '',
    '[STACK]',
    safeString(error?.stack, 'No stack available.'),
  ].join('\n');

  fs.writeFileSync(filePath, `${crashContent}\n`, 'utf8');
  return filePath;
};

const createBuildRunId = () => new Date().toISOString().replace(/[:.]/g, '-');

const safeCount = (value, fallback = 0) => {
  if (Number.isFinite(value)) {
    return value;
  }

  return fallback;
};

const safeNumberLabel = (value, fallback = 'N/A') => {
  if (Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
};

const safeString = (value, fallback = 'N/A') => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return fallback;
};

const safeFieldValue = (value, fallback = 'N/A') => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => safeString(item, ''))
      .filter(Boolean)
      .join('\n')
      .trim();

    return normalized || fallback;
  }

  return safeString(value, fallback);
};

const safeEmbedTitle = (value, fallback = 'BUILD REPORT') => safeString(value, fallback);

const safeEmbedDescription = (value, fallback = 'No description available.') => safeString(value, fallback);

const safeEmbedField = (name, value, inline = false) => ({
  name: safeString(name, 'Details'),
  value: safeFieldValue(value, 'N/A'),
  inline: Boolean(inline),
});

const safeLimitedEmbedField = (name, value, inline = false, maxLength = 700) => {
  const normalizedValue = safeFieldValue(value, 'N/A');
  const truncated = truncateFieldValue(normalizedValue, maxLength);

  return safeEmbedField(name, truncated.value, inline);
};

const asBulletList = (items, fallback, limit = 6) => {
  if (!items.length) {
    return fallback;
  }

  const visibleItems = items.slice(0, limit).map((item) => `- ${item}`);

  if (items.length > limit) {
    visibleItems.push(`- ...and ${items.length - limit} more`);
  }

  return visibleItems.join('\n');
};

const truncateFieldValue = (value, maxLength = 1024) => {
  if (value.length <= maxLength) {
    return {
      value,
      truncated: false,
    };
  }

  return {
    value: `${value.slice(0, Math.max(0, maxLength - 20))}\n- ...truncated`,
    truncated: true,
  };
};

const summarizePermissionList = (permissionBits) => {
  const normalized = typeof permissionBits === 'string' ? permissionBits : String(permissionBits || '');
  return normalized === '0' ? 'none' : normalized;
};

const createPermissionOverviewEmbed = (slug, template, payloadResult, reportDebugFilePath) => {
  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(safeEmbedTitle('PERMISSION OVERVIEW'))
    .setDescription(safeEmbedDescription(`Permission summary for \`${slug}\`.`));

  const channels = Array.isArray(template.channels) ? template.channels : [];
  const categoryNames = Object.fromEntries(
    (Array.isArray(template.categories) ? template.categories : [])
      .map((category) => [category.id || category.key, category.name]),
  );

  let truncated = false;

  payloadResult.payloads.channels.slice(0, 6).forEach((channelPayload, index) => {
    const originalChannel = channels.find((channel) => (channel.id || channel.key) === channelPayload.templateChannelId);
    const overwriteLines = (channelPayload.discordPayload.permissionOverwrites || []).map((overwrite) => {
      const targetLabel = overwrite.roleRef || '@everyone';
      return `${targetLabel}: allow=${summarizePermissionList(overwrite.allow)} | deny=${summarizePermissionList(overwrite.deny)}`;
    });

    const categoryLabel = originalChannel?.categoryId
      ? categoryNames[originalChannel.categoryId] || originalChannel.categoryId
      : 'No category';

    const rawValue = overwriteLines.length
      ? overwriteLines.join('\n')
      : 'No explicit overwrites.';
    const truncatedValue = truncateFieldValue(rawValue, 900);

    truncated = truncated || truncatedValue.truncated;

    embed.addFields(safeEmbedField(
      `${originalChannel?.name || channelPayload.templateChannelId} (${categoryLabel})`,
      truncatedValue.value,
      false,
    ));
  });

  if (payloadResult.payloads.channels.length > 6) {
    truncated = true;
  }

  if (truncated) {
    embed.addFields(safeEmbedField(
      'Details',
      reportDebugFilePath
        ? `The permission overview was summarized. Full report written to ${reportDebugFilePath}.`
        : 'The permission overview was summarized to stay within Discord limits.',
      false,
    ));
  }

  return embed;
};

const createPostBuildPreviewEmbed = (slug, plan) => createTemplatePreviewEmbed(slug, plan)
  .setTitle('BUILD PREVIEW');

const createPostBuildExecutionPlanEmbed = (slug, executionPlanResult, payloadResult) => createTemplateExecutionPlanEmbed(slug, executionPlanResult)
  .setTitle('BUILD EXECUTION PLAN')
  .spliceFields(1, 0, safeEmbedField(
    'Payload Summary',
    [
      `Role payloads: ${payloadResult.summary.rolePayloadCount}`,
      `Category payloads: ${payloadResult.summary.categoryPayloadCount}`,
      `Channel payloads: ${payloadResult.summary.channelPayloadCount}`,
      `Embed payloads: ${payloadResult.summary.embedPayloadCount}`,
    ].join('\n'),
    false,
  ));

const createPostBuildDryRunEmbed = (slug, dryRunResult) => createTemplateDryRunEmbed(slug, dryRunResult)
  .setTitle('BUILD DRY RUN');

const createProcessingFallbackEmbed = (title, description, details = []) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(safeEmbedTitle(title))
  .setDescription(safeEmbedDescription(description))
  .addFields(safeEmbedField(
    'Details',
    asBulletList(details, 'No additional details.'),
    false,
  ));

const createReportErrorEmbed = ({ pipelineMode, generatedTemplate, errorMessage }) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(safeEmbedTitle('BUILD COMPLETED WITH REPORT ERROR'))
  .setDescription(safeEmbedDescription('The template build completed, but the extended report could not be rendered safely.'))
  .addFields(
    safeEmbedField('Pipeline Mode', pipelineMode || 'single', true),
    safeEmbedField('Draft Saved', generatedTemplate?.saved ? 'Yes' : 'No', true),
    safeEmbedField('JSON Valid', generatedTemplate?.valid ? 'Yes' : 'No', true),
    safeEmbedField('Error', errorMessage || 'Report generation failed.', false),
  );

const createTimeoutEmbed = (result, lmStudio) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(safeEmbedTitle('BUILD TIMEOUT'))
  .setDescription(safeEmbedDescription('LM Studio a mis trop de temps a repondre.'))
  .addFields(
    safeEmbedField('Provider', result?.request?.target?.provider || 'lm-studio', true),
    safeEmbedField('LM Studio Call', 'Timeout', true),
    safeEmbedField('Duration', `${safeNumberLabel(lmStudio?.durationMs, 'N/A')} ms`, true),
    safeEmbedField('Advice', 'Reduce the prompt, use AI_SKILLS_MODE=minimal/off, or increase LMSTUDIO_TIMEOUT_MS.', false),
  );

const summarizeAgentStatuses = (agentRuns) => {
  if (!Array.isArray(agentRuns) || !agentRuns.length) {
    return 'N/A';
  }

  return agentRuns
    .slice(0, 4)
    .map((agentRun) => `${agentRun.agent || agentRun.agentName || 'unknown'}:${agentRun.status || 'unknown'}`)
    .join(' | ');
};

const summarizeAgentRetries = (agentRuns) => {
  if (!Array.isArray(agentRuns) || !agentRuns.length) {
    return 'None';
  }

  const retriedAgents = agentRuns
    .filter((agentRun) => safeCount(agentRun.retriesUsed, 0) > 0)
    .slice(0, 4)
    .map((agentRun) => `${agentRun.agent || agentRun.agentName || 'unknown'}:${safeNumberLabel(agentRun.retriesUsed, '0')}`);

  return retriedAgents.length ? retriedAgents.join(' | ') : 'None';
};

const summarizeAgentRepairs = (agentRuns) => {
  if (!Array.isArray(agentRuns) || !agentRuns.length) {
    return 'None';
  }

  const repairedAgents = agentRuns
    .filter((agentRun) => (agentRun.retriesUsed || 0) > 0 || (agentRun.agentWarnings || []).length > 0 || (agentRun.guardWarnings || []).length > 0)
    .slice(0, 4)
    .map((agentRun) => {
      const warningCount = (agentRun.agentWarnings || []).length + (agentRun.guardWarnings || []).length;
      return `${agentRun.agent || agentRun.agentName || 'unknown'}: retries=${safeNumberLabel(agentRun.retriesUsed, '0')}, warnings=${warningCount}`;
    });

  return repairedAgents.length ? repairedAgents.join(' | ') : 'None';
};

const summarizeImportantAgentWarnings = (agentRuns) => {
  if (!Array.isArray(agentRuns) || !agentRuns.length) {
    return 'None';
  }

  const collected = [];

  agentRuns.forEach((agentRun) => {
    const agentName = agentRun.agent || agentRun.agentName || 'unknown';
    const warnings = [...(agentRun.agentWarnings || []), ...(agentRun.guardWarnings || [])];
    warnings.slice(0, 2).forEach((warning) => {
      collected.push(`${agentName}: ${warning}`);
    });
  });

  return collected.length ? collected.slice(0, 6).join('\n') : 'None';
};

const summarizeDebugAssets = ({ debugFilePath, finalPromptDebugFilePath, pipelineMeta, generatedTemplate }) => {
  const debugEntries = [
    debugFilePath ? 'request' : null,
    finalPromptDebugFilePath ? 'prompt' : null,
    generatedTemplate?.debugFilePath ? 'template' : null,
    pipelineMeta?.debugFolderPath ? 'agents' : null,
  ].filter(Boolean);

  return debugEntries.length ? debugEntries.join(', ') : 'None';
};

const trimEmbedFields = (embed, maxFields = 25) => {
  if (!embed?.data?.fields || embed.data.fields.length <= maxFields) {
    return embed;
  }

  const keptFields = embed.data.fields.slice(0, maxFields - 1);
  const removedCount = embed.data.fields.length - keptFields.length;
  embed.data.fields = [
    ...keptFields,
    safeEmbedField('More Details', `+ ${removedCount} more fields were omitted. See the debug folder for full details.`, false),
  ];
  return embed;
};

const resolveBuildDebugFolder = ({ pipelineMeta, generatedTemplate, buildReport }) => {
  const candidatePath = pipelineMeta?.debugFolderPath
    || buildReport?.debugReportFilePath
    || generatedTemplate?.debugFilePath
    || generatedTemplate?.repairedDebugFilePath
    || generatedTemplate?.normalizedDebugFilePath
    || null;

  return candidatePath ? path.dirname(candidatePath) : null;
};

const createMultiAgentFailureEmbed = ({ failedAgent, pipelineMeta, lmStudio }) => {
  const completedAgents = (pipelineMeta?.agentRuns || [])
    .filter((agentRun) => agentRun.success)
    .map((agentRun) => agentRun.agent || agentRun.agentName || 'unknown');
  const failedRun = (pipelineMeta?.agentRuns || [])
    .find((agentRun) => (agentRun.agent || agentRun.agentName) === failedAgent);

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(safeEmbedTitle('BUILD PIPELINE FAILED'))
    .setDescription(safeEmbedDescription('The multi-agent build pipeline stopped before the final template could be assembled.'))
    .addFields(
      safeEmbedField('Pipeline Mode', pipelineMeta?.mode || 'multi', true),
      safeEmbedField('Failed Agent', failedAgent || 'Unknown', true),
      safeEmbedField('Timeout', failedRun?.timeout ? 'Yes' : 'No', true),
      safeEmbedField('Completed Agents', asBulletList(completedAgents, 'None'), false),
      safeEmbedField('Agent Statuses', summarizeAgentStatuses(pipelineMeta?.agentRuns), false),
      safeEmbedField('Agent Retries', summarizeAgentRetries(pipelineMeta?.agentRuns), false),
      safeEmbedField('Agent Repairs', summarizeAgentRepairs(pipelineMeta?.agentRuns), false),
      safeEmbedField('Error', failedRun?.error || lmStudio?.errorMessage || 'Unknown error', false),
      safeEmbedField('Duration', `${safeNumberLabel(failedRun?.durationMs, 'N/A')} ms`, true),
      safeEmbedField('Raw Response', failedRun?.rawResponsePath || 'Not written (production mode)', false),
      safeEmbedField('Parsed JSON', failedRun?.parsedJsonPath || 'Not available', false),
      safeEmbedField('Extraction Debug', failedRun?.extractionPath || 'Not written (production mode)', false),
      safeEmbedField('Error Debug', failedRun?.errorPath || 'Not written (production mode)', false),
    );
};

const createBuildEmbed = (result, report = null) => {
  const {
    request,
    debugFilePath,
    finalPromptDebugFilePath,
    attachmentWarnings,
    skillsMeta,
    lmStudio,
    generatedTemplate,
    pipelineMeta,
    briefMeta,
  } = result;
  const extractedCharacters = request.source.attachment
    ? safeNumberLabel(safeCount(request.source.attachment.text?.length, 0), '0')
    : '0';
  const templateSummary = generatedTemplate?.summary;
  const validationErrors = [
    ...(generatedTemplate?.errors || []),
    ...(generatedTemplate?.storeError ? [generatedTemplate.storeError] : []),
  ];
  const normalizationWarnings = generatedTemplate?.normalizationWarnings || [];
  const repairWarnings = generatedTemplate?.repairWarnings || [];
  const validationWarnings = generatedTemplate?.warnings || [];
  const draftSaved = generatedTemplate?.saved ? 'Yes' : 'No';
  const draftPath = generatedTemplate?.savedPath || 'Not saved';
  const payloadSummary = report?.payloadResult?.summary;
  const dryRunStatus = report?.dryRunResult?.dryRun?.finalStatus || 'Not run';
  const importantWarnings = uniqueDiagnostics([
    ...attachmentWarnings,
    ...(briefMeta?.warning ? [briefMeta.warning] : []),
    ...normalizationWarnings,
    ...repairWarnings,
    ...validationWarnings,
    ...(report?.executionPlanResult?.plan?.warnings || []),
    ...(report?.dryRunResult?.dryRun?.warnings || []),
  ]);
  const importantErrors = uniqueDiagnostics([
    ...validationErrors,
    ...(report?.executionPlanResult?.plan?.blockingErrors || []),
    ...(report?.dryRunResult?.dryRun?.blockingErrors || []),
    ...(lmStudio.errorMessage ? [lmStudio.errorMessage] : []),
  ]);
  const templateStatus = generatedTemplate
    ? inferTemplateStatus({
      normalizationWarnings,
      repairWarnings,
    }, {
      blocked: generatedTemplate.valid === false || dryRunStatus === 'blocked',
      failed: dryRunStatus === 'partial' || dryRunStatus === 'failed',
    })
    : (lmStudio.called && !lmStudio.success ? 'failed' : 'valid');
  const totalActions = templateSummary
    ? safeCount(templateSummary.roles)
      + safeCount(templateSummary.categories)
      + safeCount(templateSummary.channels)
      + safeCount(templateSummary.embeds)
    : 0;
  const totalPayloads = payloadSummary
    ? safeCount(payloadSummary.rolePayloadCount)
      + safeCount(payloadSummary.categoryPayloadCount)
      + safeCount(payloadSummary.channelPayloadCount)
      + safeCount(payloadSummary.embedPayloadCount)
    : 0;
  const debugFolder = resolveBuildDebugFolder({
    pipelineMeta,
    generatedTemplate,
    buildReport: report,
  });

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(safeEmbedTitle('BUILD PREPARED'))
    .setDescription(safeEmbedDescription(
      lmStudio.enabled
        ? 'The LM Studio local request was prepared and executed. The generated template was analyzed through the local preview, plan, payload and dry-run pipeline.'
        : 'The LM Studio local request was prepared successfully. LM Studio is currently disabled, so no generation was executed.',
    ))
    .addFields(
      safeEmbedField('Pipeline Mode', pipelineMeta?.mode || 'single', true),
      safeEmbedField('Template Status', templateStatus, true),
      safeEmbedField('Dry Run Status', dryRunStatus || 'Not run', true),
      safeEmbedField('Brief', briefMeta?.mode === 'normalized' ? 'normalized' : 'fallback', true),
      safeEmbedField('Server Type', briefMeta?.serverType || 'general', true),
      safeEmbedField('Assumptions', safeNumberLabel(briefMeta?.assumptionsCount, '0'), true),
      safeEmbedField('Warnings', String(countDiagnostics(importantWarnings)), true),
      safeEmbedField('Actions Planned', totalActions ? String(totalActions) : 'Not available', true),
      safeEmbedField('Payload Count', totalPayloads ? String(totalPayloads) : 'Not available', true),
      safeEmbedField('Draft Saved', draftSaved, true),
      safeEmbedField('JSON Valid', generatedTemplate ? (generatedTemplate.valid ? 'Yes' : 'No') : 'Not checked', true),
      safeEmbedField(
        'Request',
        [
          `Provider: ${request.target.provider || 'lm-studio'}`,
          `Model: ${request.target.model || 'Not configured'}`,
          `Prompt: ${request.source.prompt ? 'Provided' : 'Not provided'}`,
          `File: ${request.source.attachment ? request.source.attachment.filename : 'Not provided'}`,
          `Chars: ${extractedCharacters}`,
        ].join('\n'),
        false,
      ),
      safeEmbedField(
        'LM Studio',
        [
          `Enabled: ${lmStudio.enabled ? 'Yes' : 'No'}`,
          `Call: ${lmStudio.called ? (lmStudio.success ? 'Success' : 'Failed') : 'Not attempted'}`,
          `Duration: ${lmStudio.called ? `${safeNumberLabel(lmStudio.durationMs, 'N/A')} ms` : 'Not attempted'}`,
          `JSON Extraction: ${lmStudio.jsonExtraction || 'Not attempted'}`,
        ].join('\n'),
        false,
      ),
      safeEmbedField(
        'Skills',
        [
          `Enabled: ${skillsMeta?.skillsEnabled ? 'Yes' : 'No'}`,
          `Mode: ${skillsMeta?.skillsMode || 'N/A'}`,
          `Loaded: ${safeNumberLabel(skillsMeta?.skillsLoaded, '0')}`,
        ].join('\n'),
        false,
      ),
      safeEmbedField(
        'Agents',
        [
          `Statuses: ${summarizeAgentStatuses(pipelineMeta?.agentRuns)}`,
          `Retries: ${summarizeAgentRetries(pipelineMeta?.agentRuns)}`,
          `Repairs: ${summarizeAgentRepairs(pipelineMeta?.agentRuns)}`,
        ].join('\n'),
        false,
      ),
      safeLimitedEmbedField(
        'Template Summary',
        templateSummary
          ? [
            `Roles: ${safeCount(templateSummary.roles)}`,
            `Categories: ${safeCount(templateSummary.categories)}`,
            `Channels: ${safeCount(templateSummary.channels)}`,
            `Embeds: ${safeCount(templateSummary.embeds)}`,
          ].join('\n')
          : 'Not available',
        false,
        320,
      ),
      safeLimitedEmbedField(
        'Payload Summary',
        payloadSummary
          ? [
            `Roles: ${safeCount(payloadSummary.rolePayloadCount)}`,
            `Categories: ${safeCount(payloadSummary.categoryPayloadCount)}`,
            `Channels: ${safeCount(payloadSummary.channelPayloadCount)}`,
            `Embeds: ${safeCount(payloadSummary.embedPayloadCount)}`,
          ].join('\n')
          : 'Not available',
        false,
        320,
      ),
      safeLimitedEmbedField('Main Cause', getPrimaryIssue(importantErrors, importantWarnings) || 'None detected.', false, 320),
      safeLimitedEmbedField(
        'Top Diagnostics',
        summarizeDiagnostics(
          [...importantErrors, ...importantWarnings],
          { fallback: 'None detected.', limit: 3 },
        ),
        false,
        520,
      ),
      safeLimitedEmbedField('Agent Warnings', summarizeImportantAgentWarnings(pipelineMeta?.agentRuns), false, 420),
      safeEmbedField(
        'Debug',
        [
          `Folder: ${debugFolder || 'Not written (production mode)'}`,
          `Assets: ${summarizeDebugAssets({ debugFilePath, finalPromptDebugFilePath, pipelineMeta, generatedTemplate })}`,
          `Brief: ${briefMeta?.debugFilePath || 'Not written (production mode)'}`,
          `Draft: ${draftPath || 'Not saved'}`,
        ].join('\n'),
        false,
      ),
    );
};

const logEmbedsBeforeReply = (embeds) => {
  logger.info('Build embed payload prepared', {
    embedCount: Array.isArray(embeds) ? embeds.length : 0,
    embedFieldNames: Array.isArray(embeds)
      ? embeds.map((embed, index) => ({
        index,
        title: embed?.data?.title || 'Untitled',
        fields: Array.isArray(embed?.data?.fields)
          ? embed.data.fields.map((field) => field?.name || 'Unnamed field')
          : [],
      }))
      : [],
  });
};

const normalizeEmbedsForDiscord = (embeds) => (Array.isArray(embeds) ? embeds.map((embed) => trimEmbedFields(embed)) : embeds);

const summarizeFatalError = (error) => ({
  name: safeString(error?.name, 'UnknownError'),
  message: safeString(error?.message, 'No error message'),
  cause: safeString(error?.cause?.message || error?.cause, 'None'),
  stack: safeString(error?.stack, 'No stack available.'),
});

const processTemplateCandidate = async (templateObject, rawText) => {
  const normalizedResult = normalizeTemplate(templateObject);

  if (!normalizedResult.ok) {
    return {
      generatedTemplate: {
        valid: false,
        name: templateObject?.name || 'Unnamed Template',
        summary: {
          roles: 0,
          categories: 0,
          channels: 0,
          embeds: 0,
        },
        errors: [normalizedResult.message],
        warnings: [],
        normalizationWarnings: normalizedResult.normalizationWarnings,
        normalizationStatus: 'Failed',
        repairWarnings: [],
        repairStatus: 'Not attempted',
        draft: null,
        debugFilePath: null,
        normalizedDebugFilePath: null,
        repairedDebugFilePath: null,
        saved: false,
        savedPath: null,
        storeError: null,
      },
      buildReport: null,
    };
  }

  const normalizedTemplate = normalizedResult.normalizedTemplate;
  const repairResult = repairTemplate(normalizedTemplate);
  const repairedTemplate = repairResult.ok ? repairResult.repairedTemplate : normalizedTemplate;
  const validation = validateTemplate(repairedTemplate);
  const debugGeneratedTemplatePath = writeGeneratedTemplateDebugFile(
    repairedTemplate.name || 'generated-template',
    `${JSON.stringify(repairedTemplate, null, 2)}\n`,
  );
  const normalizedDebugFilePath = writeNormalizedTemplateDebugFile(
    normalizedTemplate.name || 'normalized-template',
    normalizedTemplate,
  );
  const repairedDebugFilePath = writeRepairedTemplateDebugFile(
    repairedTemplate.name || 'repaired-template',
    repairedTemplate,
  );
  let draftSave = null;
  let buildReport = null;

  if (validation.isValid) {
    draftSave = saveDraftTemplate(repairedTemplate);

    if (!draftSave.ok) {
      logger.error('Generated template draft could not be saved', {
        code: draftSave.code,
        templateName: repairedTemplate.name || 'Unnamed Template',
      });
    }
  }

  const generatedTemplate = {
    valid: validation.isValid,
    name: repairedTemplate.name || 'Unnamed Template',
    summary: {
      roles: Array.isArray(repairedTemplate.roles) ? repairedTemplate.roles.length : 0,
      categories: Array.isArray(repairedTemplate.categories) ? repairedTemplate.categories.length : 0,
      channels: Array.isArray(repairedTemplate.channels) ? repairedTemplate.channels.length : 0,
      embeds: Array.isArray(repairedTemplate.welcomeEmbeds) ? repairedTemplate.welcomeEmbeds.length : 0,
    },
    errors: validation.errors,
    warnings: validation.warnings,
    normalizationWarnings: normalizedResult.normalizationWarnings,
    normalizationStatus: normalizedResult.normalizationWarnings.length ? 'Applied' : 'Not needed',
    repairWarnings: repairResult.repairWarnings || [],
    repairStatus: repairResult.ok
      ? (repairResult.repairWarnings.length ? 'Applied' : 'Not needed')
      : 'Failed',
    draft: repairedTemplate,
    raw: rawText,
    debugFilePath: debugGeneratedTemplatePath,
    normalizedDebugFilePath,
    repairedDebugFilePath,
    saved: Boolean(draftSave?.ok),
    savedPath: draftSave?.relativePath || null,
    storeError: draftSave && !draftSave.ok ? 'Valid JSON was generated, but the draft could not be saved.' : null,
  };

  if (validation.isValid && draftSave?.ok) {
    buildReport = await buildPostGenerationReport(draftSave.slug);
  }

  return {
    generatedTemplate,
    buildReport,
  };
};

const buildPostGenerationReport = async (slug) => {
  const previewResult = buildServerPlan(slug);

  if (!previewResult.ok) {
    return {
      ok: false,
      code: previewResult.code,
      step: 'preview',
      details: previewResult.errors || ['Preview could not be built.'],
    };
  }

  const payloadResult = buildDiscordPayloads(slug);

  if (!payloadResult.ok) {
    return {
      ok: false,
      code: payloadResult.code,
      step: 'payload',
      details: payloadResult.errors || ['Payload summary could not be built.'],
      previewResult,
    };
  }

  const executionPlanResult = buildExecutionPlan(slug);

  if (!executionPlanResult.ok) {
    return {
      ok: false,
      code: executionPlanResult.code,
      step: 'execution-plan',
      details: executionPlanResult.errors || ['Execution plan could not be built.'],
      previewResult,
      payloadResult,
    };
  }

  const dryRunResult = await executeDryRun(slug);

  if (!dryRunResult.ok) {
    return {
      ok: false,
      code: dryRunResult.code,
      step: 'dry-run',
      details: dryRunResult.errors || ['Dry-run could not be executed.'],
      previewResult,
      payloadResult,
      executionPlanResult,
    };
  }

  const debugReportFilePath = writeBuildReportDebugFile(slug, {
    preview: previewResult.plan,
    payloadSummary: payloadResult.summary,
    executionPlan: executionPlanResult.plan,
    dryRun: dryRunResult.dryRun,
  });

  return {
    ok: true,
    previewResult,
    payloadResult,
    executionPlanResult,
    dryRunResult,
    debugReportFilePath,
  };
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription('Prepare a local LM Studio build request from a prompt and optional file.')
    .addStringOption((option) => option
      .setName('prompt')
      .setDescription('Build prompt for the future LM Studio generation.')
      .setRequired(false))
    .addAttachmentOption((option) => option
      .setName('file')
      .setDescription('Optional file used as source material.')
      .setRequired(false)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const buildRunId = createBuildRunId();
    let buildJobCreated = false;
    let progressReporter = null;

    try {
      logBuildRuntimeDiagnosticsOnce();
      const runtimeTimeouts = typeof config.getRuntimeTimeoutConfig === 'function'
        ? config.getRuntimeTimeoutConfig()
        : {
          buildPipelineMode: config.buildPipelineMode,
          buildAgentTimeoutMs: config.buildAgentTimeoutMs,
          lmStudioTimeoutMs: config.lmStudioTimeoutMs,
          buildAgentMaxRetries: config.buildAgentMaxRetries,
        };
      const lmStudioEnabled = config.lmStudioEnabled;
      const buildPipelineMode = runtimeTimeouts.buildPipelineMode || config.buildPipelineMode;
      const prompt = interaction.options.getString('prompt');
      const file = interaction.options.getAttachment('file');
      let attachmentContent = null;

      createBuildJob({
        runId: buildRunId,
        userId: interaction.user.id,
        guildId: interaction.guildId || null,
        mode: buildPipelineMode,
        status: 'queued',
      });
      buildJobCreated = true;
      progressReporter = createBuildProgressReporter({
        interaction,
        getJob: () => getBuildJob(buildRunId),
      });
      await progressReporter.update('queued');
      progressReporter.start();

      if (file) {
        const attachmentResult = await readAttachmentText(file);

        if (!attachmentResult.ok) {
          logger.warn('Build attachment read failed', {
            code: attachmentResult.code,
            userId: interaction.user.id,
          });

          updateBuildJob(buildRunId, {
            status: 'failed',
            mainError: 'The attached file could not be read.',
          });
          await progressReporter.sendFinal({
            content: 'The attached file could not be read. Use a supported text file under the size limit.',
          }, `BUILD FAILED\nRun: ${buildRunId}\nThe attached file could not be read.`);
          return;
        }

        attachmentContent = attachmentResult;
      }

      const briefNormalizationResult = normalizeBuildBrief({
        prompt,
        attachment: attachmentContent,
      });
      const normalizedBrief = briefNormalizationResult.normalizedBrief || null;
      const briefDebugFilePath = writeNormalizedBriefDebugFile({
        runId: buildRunId,
        normalizedBrief,
        metadata: {
          mode: briefNormalizationResult.mode,
          warning: briefNormalizationResult.warning || null,
          attachmentPresent: Boolean(attachmentContent),
        },
      });
      const briefMeta = {
        mode: briefNormalizationResult.mode || 'fallback',
        warning: briefNormalizationResult.warning || null,
        serverType: normalizedBrief?.serverType || 'general',
        assumptionsCount: Array.isArray(normalizedBrief?.assumptions) ? normalizedBrief.assumptions.length : 0,
        debugFilePath: briefDebugFilePath,
      };
      updateBuildJob(buildRunId, {
        status: 'running',
        briefMode: briefMeta.mode,
        serverType: briefMeta.serverType,
        warnings: briefMeta.warning ? [briefMeta.warning] : [],
        debugFolder: briefDebugFilePath ? path.dirname(briefDebugFilePath) : null,
      });
      await progressReporter.update('brief-normalized');

      const result = buildLmStudioRequest({
        prompt,
        attachment: attachmentContent,
        requestedBy: interaction.user,
        normalizedBrief,
      });

      if (!result.ok) {
        logger.warn('Build request preparation failed', {
          code: result.code,
          userId: interaction.user.id,
        });

        updateBuildJob(buildRunId, {
          status: 'failed',
          mainError: 'A prompt or a file is required.',
        });
        await progressReporter.sendFinal({
          content: 'A prompt or a file is required to prepare the build request.',
        }, `BUILD FAILED\nRun: ${buildRunId}\nA prompt or a file is required.`);
        return;
      }

      let lmStudio = {
        enabled: lmStudioEnabled,
        called: false,
        success: false,
        errorMessage: null,
        durationMs: null,
        jsonExtraction: 'Not attempted',
        rawResponseDebugFilePath: null,
      };
      let generatedTemplate = null;
      let buildReport = null;
      let pipelineMeta = {
        mode: buildPipelineMode,
        agentRuns: [],
      };

      if (lmStudioEnabled) {
        if (buildPipelineMode === 'multi') {
          const pipelineResult = await runBuildAgentPipeline({
            prompt,
            attachment: attachmentContent,
            normalizedBrief,
            runId: buildRunId,
            onProgress: async (event) => {
              recordBuildProgress(buildRunId, {
                ...event,
                debugFolder: event.runDirectoryPath || null,
              });
              await progressReporter.update(event.type || 'agent-progress');
            },
          });

          pipelineMeta = {
            mode: 'multi',
            agentRuns: pipelineResult.agentRuns || [],
            debugFolderPath: pipelineResult.runDirectoryPath || null,
          };
          lmStudio.called = true;
          lmStudio.durationMs = safeCount(
            (pipelineResult.agentRuns || []).reduce((total, agentRun) => total + safeCount(agentRun.durationMs, 0), 0),
            0,
          );

          if (!pipelineResult.ok) {
            lmStudio.success = false;
            lmStudio.errorMessage = `Agent "${pipelineResult.failedAgent}" failed: ${pipelineResult.error || 'Unknown error'}`;
            lmStudio.jsonExtraction = 'Not attempted';

            updateBuildJob(buildRunId, {
              status: 'failed',
              currentAgent: null,
              mainError: lmStudio.errorMessage,
              debugFolder: pipelineResult.runDirectoryPath || null,
            });
            await progressReporter.sendFinal({
              embeds: [createMultiAgentFailureEmbed({
                failedAgent: pipelineResult.failedAgent,
                pipelineMeta,
                lmStudio,
              })],
            }, [
              'BUILD FAILED',
              `Run: ${buildRunId}`,
              `Agent: ${pipelineResult.failedAgent || 'unknown'}`,
              `Cause: ${pipelineResult.error || 'Unknown error'}`,
              `Debug: ${pipelineResult.runDirectoryPath || 'not available'}`,
            ].join('\n'));
            return;
          } else {
            lmStudio.success = true;
            lmStudio.jsonExtraction = 'Success';
            const processed = await processTemplateCandidate(pipelineResult.finalJson, pipelineResult.finalRaw);
            generatedTemplate = processed.generatedTemplate;
            buildReport = processed.buildReport;
            result.skillsMeta = pipelineResult.skillsMeta || result.skillsMeta;
          }
        } else {
          pipelineMeta = {
            mode: 'single',
            agentRuns: [],
          };
          lmStudio.called = true;

          recordBuildProgress(buildRunId, {
            agent: 'lm-studio',
            status: 'running',
            retriesUsed: 0,
          });
          await progressReporter.update('lm-studio-start');

          const lmStudioResult = await callLmStudio(result.request.requestPayload);
          lmStudio.durationMs = lmStudioResult.durationMs || 0;

          if (!lmStudioResult.ok) {
            lmStudio.success = false;
            lmStudio.errorMessage = lmStudioResult.code === 'TIMEOUT'
              ? (lmStudioResult.hasTimeoutMismatch
                ? `LM Studio timeout mismatch detected. Effective request timeout=${safeNumberLabel(lmStudioResult.timeoutMs, 'N/A')} ms, configured LMSTUDIO_TIMEOUT_MS=${safeNumberLabel(lmStudioResult.configuredTimeoutMs, 'N/A')} ms.`
                : 'LM Studio a mis trop de temps. Essaie un prompt plus court ou passe AI_SKILLS_MODE=minimal/off.')
              : lmStudioResult.message;

            if (lmStudioResult.code === 'TIMEOUT') {
              updateBuildJob(buildRunId, {
                status: 'failed',
                currentAgent: null,
                mainError: lmStudio.errorMessage,
              });
              await progressReporter.sendFinal({
                embeds: [createTimeoutEmbed(result, lmStudio)],
              }, `BUILD FAILED\nRun: ${buildRunId}\n${lmStudio.errorMessage}`);
              return;
            }
          } else {
            recordBuildProgress(buildRunId, {
              agent: 'lm-studio',
              status: 'completed',
              retriesUsed: 0,
            });
            lmStudio.success = true;
            lmStudio.rawResponseDebugFilePath = writeLmStudioRawResponseDebugFile(lmStudioResult.content);

            const extracted = extractStrictJsonObject(lmStudioResult.content);

            if (!extracted.ok) {
              lmStudio.jsonExtraction = 'Failed';
              lmStudio.errorMessage = 'LM Studio did not return usable JSON.';
            } else {
              lmStudio.jsonExtraction = 'Success';
              const processed = await processTemplateCandidate(extracted.json, extracted.raw);
              generatedTemplate = processed.generatedTemplate;
              buildReport = processed.buildReport;
            }
          }
        }
      }

      let embeds;

      try {
        embeds = [
          createBuildEmbed({
            ...result,
            lmStudio,
            generatedTemplate,
            pipelineMeta,
            briefMeta,
          }, buildReport?.ok ? buildReport : null),
        ];

        if (buildReport?.ok) {
          embeds.push(
            createPostBuildPreviewEmbed(buildReport.previewResult.slug, buildReport.previewResult.plan),
            createPostBuildExecutionPlanEmbed(
              buildReport.executionPlanResult.slug,
              buildReport.executionPlanResult,
              buildReport.payloadResult,
            ),
            createPermissionOverviewEmbed(
              buildReport.payloadResult.slug,
              buildReport.payloadResult.template,
              buildReport.payloadResult,
              buildReport.debugReportFilePath,
            ),
            createPostBuildDryRunEmbed(buildReport.dryRunResult.slug, buildReport.dryRunResult),
          );
        } else if (generatedTemplate?.valid && generatedTemplate?.saved) {
          embeds.push(createProcessingFallbackEmbed(
            'POST-BUILD REPORT',
            'The draft was saved, but at least one internal analysis step could not be completed.',
            buildReport?.details || ['The post-build analysis pipeline did not finish.'],
          ));
        }
      } catch (reportError) {
        logger.error('Build report embed generation failed', {
          command: 'build',
          error: reportError.message,
          stack: reportError.stack,
        });

        try {
          embeds = [
            createBuildEmbed({
              ...result,
              lmStudio,
              generatedTemplate,
              pipelineMeta,
              briefMeta,
            }, null),
            createReportErrorEmbed({
              pipelineMode: pipelineMeta?.mode,
              generatedTemplate,
              errorMessage: reportError.message,
            }),
          ];
        } catch (fallbackReportError) {
          logger.error('Build fallback report generation failed', {
            command: 'build',
            error: fallbackReportError.message,
            stack: fallbackReportError.stack,
          });

          embeds = [
            createReportErrorEmbed({
              pipelineMode: pipelineMeta?.mode,
              generatedTemplate,
              errorMessage: fallbackReportError.message,
            }),
          ];
        }
      }

      const normalizedEmbeds = normalizeEmbedsForDiscord(embeds);

      logEmbedsBeforeReply(normalizedEmbeds);

      const finalTemplateStatus = generatedTemplate
        ? inferTemplateStatus({
          normalizationWarnings: generatedTemplate.normalizationWarnings || [],
          repairWarnings: generatedTemplate.repairWarnings || [],
        }, {
          blocked: generatedTemplate.valid === false,
          failed: false,
        })
        : (lmStudio.called && !lmStudio.success ? 'failed' : 'valid');
      const finalDebugFolder = resolveBuildDebugFolder({
        pipelineMeta,
        generatedTemplate,
        buildReport,
      });
      updateBuildJob(buildRunId, {
        status: lmStudio.called && !lmStudio.success ? 'failed' : 'completed',
        currentAgent: null,
        mainError: lmStudio.called && !lmStudio.success ? lmStudio.errorMessage : null,
        debugFolder: finalDebugFolder,
        templateSlug: buildReport?.previewResult?.slug
          || (generatedTemplate?.savedPath ? path.basename(generatedTemplate.savedPath, '.json') : null),
        templateStatus: finalTemplateStatus,
        warnings: uniqueDiagnostics([
          ...(generatedTemplate?.normalizationWarnings || []),
          ...(generatedTemplate?.repairWarnings || []),
          ...(generatedTemplate?.warnings || []),
        ]),
      });

      try {
        const delivery = await progressReporter.sendFinal({
          embeds: normalizedEmbeds.slice(0, 5),
        }, [
          'BUILD COMPLETED',
          `Run: ${buildRunId}`,
          `Template: ${generatedTemplate?.name || 'not generated'}`,
          `Status: ${finalTemplateStatus}`,
          `Debug: ${finalDebugFolder || 'not available'}`,
        ].join('\n'));

        if (!delivery.delivered) {
          logger.error('Build completed but final response was not delivered', {
            runId: buildRunId,
            debugFolder: finalDebugFolder,
          });
        }
      } catch (replyError) {
        logger.error('Failed to send Discord response', {
          command: 'build',
          error: replyError.message,
          stack: replyError.stack,
        });

        await progressReporter.sendFinal({
          content: `BUILD CRASH\n${safeString(replyError.message, 'Unknown Discord response error.')}`,
          embeds: [],
        }, `BUILD CRASH\nRun: ${buildRunId}\n${safeString(replyError.message, 'Unknown Discord response error.')}`);
      }
    } catch (error) {
      const fatalError = summarizeFatalError(error);
      const crashDebugFilePath = writeBuildCrashDebugFile(error);

      logger.error('Build fatal crash', {
        command: 'build',
        error: fatalError.message,
        name: fatalError.name,
        cause: fatalError.cause,
        stack: fatalError.stack,
        debugFilePath: crashDebugFilePath,
      });

      const crashMessage = `BUILD CRASH\n${fatalError.message}`;

      if (buildJobCreated) {
        try {
          updateBuildJob(buildRunId, {
            status: 'failed',
            currentAgent: null,
            mainError: fatalError.message,
            debugFolder: crashDebugFilePath ? path.dirname(crashDebugFilePath) : null,
          });
        } catch (jobError) {
          logger.error('Failed to persist build crash state', {
            runId: buildRunId,
            error: jobError.message,
          });
        }
      }

      try {
        if (progressReporter) {
          await progressReporter.sendFinal({
            content: crashMessage,
            embeds: [],
          }, `${crashMessage}\nRun: ${buildRunId}\nDebug: ${crashDebugFilePath || 'not available'}`);
          return;
        }

        await interaction.reply({
          content: crashMessage,
          flags: MessageFlags.Ephemeral,
        });
      } catch (responseError) {
        logger.error('Failed to send Discord response', {
          command: 'build',
          error: responseError.message,
          stack: responseError.stack,
        });
      }
    } finally {
      progressReporter?.stop();
    }
  },
};
