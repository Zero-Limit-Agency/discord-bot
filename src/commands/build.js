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
const { buildServerPlan } = require('../services/serverGenerator');
const { buildDiscordPayloads } = require('../services/discordPayloadBuilder');
const { buildExecutionPlan } = require('../services/discordServerOrchestrator');
const { executeDryRun } = require('../services/discordTemplateRunner');
const {
  createTemplatePreviewEmbed,
  createTemplateExecutionPlanEmbed,
  createTemplateDryRunEmbed,
} = require('../embeds/templatePreviewEmbed');
const fs = require('node:fs');
const path = require('node:path');

const generatedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-generated-templates');
const lmStudioRawResponseDebugDirectoryPath = path.join(process.cwd(), 'debug', 'lmstudio-raw-responses');
const normalizedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-normalized-templates');
const repairedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-repaired-templates');
const buildReportDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-reports');

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
    .setTitle('PERMISSION OVERVIEW')
    .setDescription(`Permission summary for \`${slug}\`.`);

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

    embed.addFields({
      name: `${originalChannel?.name || channelPayload.templateChannelId} (${categoryLabel})`,
      value: truncatedValue.value,
      inline: false,
    });
  });

  if (payloadResult.payloads.channels.length > 6) {
    truncated = true;
  }

  if (truncated) {
    embed.addFields({
      name: 'Details',
      value: reportDebugFilePath
        ? `The permission overview was summarized. Full report written to ${reportDebugFilePath}.`
        : 'The permission overview was summarized to stay within Discord limits.',
      inline: false,
    });
  }

  return embed;
};

const createPostBuildPreviewEmbed = (slug, plan) => createTemplatePreviewEmbed(slug, plan)
  .setTitle('BUILD PREVIEW');

const createPostBuildExecutionPlanEmbed = (slug, executionPlanResult, payloadResult) => createTemplateExecutionPlanEmbed(slug, executionPlanResult)
  .setTitle('BUILD EXECUTION PLAN')
  .spliceFields(1, 0, {
    name: 'Payload Summary',
    value: [
      `Role payloads: ${payloadResult.summary.rolePayloadCount}`,
      `Category payloads: ${payloadResult.summary.categoryPayloadCount}`,
      `Channel payloads: ${payloadResult.summary.channelPayloadCount}`,
      `Embed payloads: ${payloadResult.summary.embedPayloadCount}`,
    ].join('\n'),
    inline: false,
  });

const createPostBuildDryRunEmbed = (slug, dryRunResult) => createTemplateDryRunEmbed(slug, dryRunResult)
  .setTitle('BUILD DRY RUN');

const createProcessingFallbackEmbed = (title, description, details = []) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle(title)
  .setDescription(description)
  .addFields({
    name: 'Details',
    value: asBulletList(details, 'No additional details.'),
    inline: false,
  });

const createBuildEmbed = (result, report = null) => {
  const {
    request,
    debugFilePath,
    attachmentWarnings,
    lmStudio,
    generatedTemplate,
  } = result;
  const extractedCharacters = request.source.attachment ? String(request.source.attachment.text.length) : '0';
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

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('BUILD PREPARED')
    .setDescription(
      lmStudio.enabled
        ? 'The LM Studio local request was prepared and executed. The generated template was analyzed through the local preview, plan, payload and dry-run pipeline.'
        : 'The LM Studio local request was prepared successfully. LM Studio is currently disabled, so no generation was executed.',
    )
    .addFields(
      { name: 'Provider', value: request.target.provider, inline: true },
      { name: 'Base URL', value: request.target.baseUrl, inline: true },
      { name: 'Model', value: request.target.model || 'Not configured', inline: true },
      { name: 'Prompt', value: request.source.prompt ? 'Provided' : 'Not provided', inline: true },
      { name: 'File', value: request.source.attachment ? request.source.attachment.filename : 'Not provided', inline: true },
      { name: 'Extracted Characters', value: extractedCharacters, inline: true },
      { name: 'LM Studio Enabled', value: lmStudio.enabled ? 'Yes' : 'No', inline: true },
      { name: 'LM Studio Call', value: lmStudio.called ? (lmStudio.success ? 'Success' : 'Failed') : 'Not attempted', inline: true },
      { name: 'LM Studio Duration', value: lmStudio.called ? `${lmStudio.durationMs || 0} ms` : 'Not attempted', inline: true },
      { name: 'JSON Extraction', value: lmStudio.jsonExtraction || 'Not attempted', inline: true },
      { name: 'Normalization', value: generatedTemplate?.normalizationStatus || 'Not attempted', inline: true },
      { name: 'Repair Applied', value: generatedTemplate?.repairStatus || 'Not attempted', inline: true },
      { name: 'Repair Warnings Count', value: String(repairWarnings.length), inline: true },
      { name: 'JSON Valid', value: generatedTemplate ? (generatedTemplate.valid ? 'Yes' : 'No') : 'Not checked', inline: true },
      { name: 'Generated Template', value: generatedTemplate?.name || 'Not available', inline: true },
      { name: 'Draft Saved', value: draftSaved, inline: true },
      { name: 'Draft Path', value: draftPath, inline: false },
      { name: 'Roles / Categories / Channels / Embeds', value: templateSummary ? `${templateSummary.roles}/${templateSummary.categories}/${templateSummary.channels}/${templateSummary.embeds}` : 'Not available', inline: false },
      {
        name: 'Payload Summary',
        value: payloadSummary
          ? `${payloadSummary.rolePayloadCount}/${payloadSummary.categoryPayloadCount}/${payloadSummary.channelPayloadCount}/${payloadSummary.embedPayloadCount}`
          : 'Not available',
        inline: false,
      },
      { name: 'Errors', value: validationErrors.length ? validationErrors.slice(0, 6).join('\n') : (lmStudio.errorMessage || 'None'), inline: false },
      { name: 'Warnings', value: attachmentWarnings.length ? attachmentWarnings.join('\n') : 'None', inline: false },
      { name: 'Normalization Warnings', value: normalizationWarnings.length ? normalizationWarnings.slice(0, 6).join('\n') : 'None', inline: false },
      { name: 'Repair Warnings', value: repairWarnings.length ? repairWarnings.slice(0, 6).join('\n') : 'None', inline: false },
      { name: 'Validation Warnings', value: validationWarnings.length ? validationWarnings.slice(0, 6).join('\n') : 'None', inline: false },
      { name: 'Debug Request', value: debugFilePath || 'Not written (production mode)', inline: false },
      { name: 'Debug Raw Response', value: lmStudio.rawResponseDebugFilePath || 'Not written (production mode)', inline: false },
      { name: 'Debug Normalized Template', value: generatedTemplate?.normalizedDebugFilePath || 'Not written (production mode)', inline: false },
      { name: 'Debug Repaired Template', value: generatedTemplate?.repairedDebugFilePath || 'Not written (production mode)', inline: false },
      { name: 'Debug Generated Template', value: generatedTemplate?.debugFilePath || 'Not written (production mode)', inline: false },
    );
};

const editDeferredReply = async (interaction, payload) => {
  await interaction.editReply(payload);
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

    try {
      const prompt = interaction.options.getString('prompt');
      const file = interaction.options.getAttachment('file');
      let attachmentContent = null;

      if (file) {
        const attachmentResult = await readAttachmentText(file);

        if (!attachmentResult.ok) {
          logger.warn('Build attachment read failed', {
            code: attachmentResult.code,
            userId: interaction.user.id,
          });

          await editDeferredReply(interaction, {
            content: 'The attached file could not be read. Use a supported text file under the size limit.',
          });
          return;
        }

        attachmentContent = attachmentResult;
      }

      const result = buildLmStudioRequest({
        prompt,
        attachment: attachmentContent,
        requestedBy: interaction.user,
      });

      if (!result.ok) {
        logger.warn('Build request preparation failed', {
          code: result.code,
          userId: interaction.user.id,
        });

        await editDeferredReply(interaction, {
          content: 'A prompt or a file is required to prepare the build request.',
        });
        return;
      }

      let lmStudio = {
        enabled: config.lmStudioEnabled,
        called: false,
        success: false,
        errorMessage: null,
        durationMs: null,
        jsonExtraction: 'Not attempted',
        rawResponseDebugFilePath: null,
      };
      let generatedTemplate = null;
      let buildReport = null;

      if (config.lmStudioEnabled) {
        lmStudio.called = true;

        const lmStudioResult = await callLmStudio(result.request.requestPayload);
        lmStudio.durationMs = lmStudioResult.durationMs || 0;

        if (!lmStudioResult.ok) {
          lmStudio.success = false;
          lmStudio.errorMessage = lmStudioResult.message;
        } else {
          lmStudio.success = true;
          lmStudio.rawResponseDebugFilePath = writeLmStudioRawResponseDebugFile(lmStudioResult.content);

          const extracted = extractStrictJsonObject(lmStudioResult.content);

          if (!extracted.ok) {
            lmStudio.jsonExtraction = 'Failed';
            lmStudio.errorMessage = 'LM Studio did not return usable JSON.';
          } else {
            lmStudio.jsonExtraction = 'Success';
            const normalizedResult = normalizeTemplate(extracted.json);

            if (!normalizedResult.ok) {
              generatedTemplate = {
                valid: false,
                name: extracted.json?.name || 'Unnamed Template',
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
              };
            } else {
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

              if (validation.isValid) {
                draftSave = saveDraftTemplate(repairedTemplate);

                if (!draftSave.ok) {
                  logger.error('Generated template draft could not be saved', {
                    code: draftSave.code,
                    templateName: repairedTemplate.name || 'Unnamed Template',
                  });
                }
              }

              generatedTemplate = {
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
            }
          }
        }
      }

      const embeds = [
        createBuildEmbed({
          ...result,
          lmStudio,
          generatedTemplate,
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

      await editDeferredReply(interaction, {
        embeds: embeds.slice(0, 5),
      });
    } catch (error) {
      logger.error('Failed to execute slash command', {
        command: 'build',
        error: error.message,
      });

      const message = 'The build request could not be completed.';

      if (interaction.deferred || interaction.replied) {
        await editDeferredReply(interaction, {
          content: message,
          embeds: [],
        });
        return;
      }

      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
