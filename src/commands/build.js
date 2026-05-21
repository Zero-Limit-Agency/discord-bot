const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { buildLmStudioRequest } = require('../services/lmStudioRequestBuilder');
const { readAttachmentText } = require('../services/attachmentTextReader');
const { callLmStudio } = require('../services/lmStudioClient');
const { validateTemplate } = require('../services/discordTemplateService');
const { saveDraftTemplate } = require('../services/draftTemplateStore');
const fs = require('node:fs');
const path = require('node:path');

const generatedTemplateDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-generated-templates');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureGeneratedTemplateDebugDirectory = () => {
  fs.mkdirSync(generatedTemplateDebugDirectoryPath, { recursive: true });
};

const extractStrictJson = (content) => {
  const trimmed = String(content || '').trim();

  if (!trimmed) {
    return {
      ok: false,
      code: 'EMPTY_RESPONSE',
      message: 'LM Studio returned an empty response.',
    };
  }

  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return {
      ok: false,
      code: 'NON_STRICT_JSON',
      message: 'LM Studio did not return strict JSON.',
    };
  }

  try {
    return {
      ok: true,
      json: JSON.parse(trimmed),
      raw: trimmed,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: 'LM Studio returned invalid JSON.',
    };
  }
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

const createBuildEmbed = (result) => {
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
  const validationWarnings = generatedTemplate?.warnings || [];
  const draftSaved = generatedTemplate?.saved ? 'Yes' : 'No';
  const draftPath = generatedTemplate?.savedPath || 'Not saved';

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('BUILD REQUEST PREPARED')
    .setDescription(
      lmStudio.enabled
        ? 'The LM Studio local request was prepared and executed. The generated JSON was checked before any future build step.'
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
      { name: 'JSON Valid', value: generatedTemplate ? (generatedTemplate.valid ? 'Yes' : 'No') : 'Not checked', inline: true },
      { name: 'Generated Template', value: generatedTemplate?.name || 'Not available', inline: true },
      { name: 'Draft Saved', value: draftSaved, inline: true },
      { name: 'Draft Path', value: draftPath, inline: false },
      { name: 'Roles / Categories / Channels / Embeds', value: templateSummary ? `${templateSummary.roles}/${templateSummary.categories}/${templateSummary.channels}/${templateSummary.embeds}` : 'Not available', inline: false },
      { name: 'Errors', value: validationErrors.length ? validationErrors.slice(0, 6).join('\n') : (lmStudio.errorMessage || 'None'), inline: false },
      { name: 'Warnings', value: attachmentWarnings.length ? attachmentWarnings.join('\n') : 'None', inline: false },
      { name: 'Validation Warnings', value: validationWarnings.length ? validationWarnings.slice(0, 6).join('\n') : 'None', inline: false },
      { name: 'Debug Request', value: debugFilePath || 'Not written (production mode)', inline: false },
      { name: 'Debug Generated Template', value: generatedTemplate?.debugFilePath || 'Not written (production mode)', inline: false },
    );
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
        ephemeral: true,
      });
      return;
    }

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

        await interaction.reply({
          content: 'The attached file could not be read. Use a supported text file under the size limit.',
          ephemeral: true,
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

      await interaction.reply({
        content: 'A prompt or a file is required to prepare the build request.',
        ephemeral: true,
        });
        return;
      }

    let lmStudio = {
      enabled: config.lmStudioEnabled,
      called: false,
      success: false,
      errorMessage: null,
    };
    let generatedTemplate = null;

    if (config.lmStudioEnabled) {
      lmStudio.called = true;

      const lmStudioResult = await callLmStudio(result.request.requestPayload);

      if (!lmStudioResult.ok) {
        lmStudio.success = false;
        lmStudio.errorMessage = 'LM Studio call failed.';
      } else {
        lmStudio.success = true;

        const extracted = extractStrictJson(lmStudioResult.content);

        if (!extracted.ok) {
          lmStudio.success = false;
          lmStudio.errorMessage = 'LM Studio did not return strict JSON.';
        } else {
          const validation = validateTemplate(extracted.json);
          const debugGeneratedTemplatePath = writeGeneratedTemplateDebugFile(extracted.json.name || 'generated-template', extracted.raw);
          let draftSave = null;

          if (validation.isValid) {
            draftSave = saveDraftTemplate(extracted.json);

            if (!draftSave.ok) {
              logger.error('Generated template draft could not be saved', {
                code: draftSave.code,
                templateName: extracted.json.name || 'Unnamed Template',
              });
            }
          }

          generatedTemplate = {
            valid: validation.isValid,
            name: extracted.json.name || 'Unnamed Template',
            summary: {
              roles: Array.isArray(extracted.json.roles) ? extracted.json.roles.length : 0,
              categories: Array.isArray(extracted.json.categories) ? extracted.json.categories.length : 0,
              channels: Array.isArray(extracted.json.channels) ? extracted.json.channels.length : 0,
              embeds: Array.isArray(extracted.json.welcomeEmbeds) ? extracted.json.welcomeEmbeds.length : 0,
            },
            errors: validation.errors,
            warnings: validation.warnings,
            draft: extracted.json,
            debugFilePath: debugGeneratedTemplatePath,
            saved: Boolean(draftSave?.ok),
            savedPath: draftSave?.relativePath || null,
            storeError: draftSave && !draftSave.ok ? 'Valid JSON was generated, but the draft could not be saved.' : null,
          };
        }
      }
    }

    await interaction.reply({
      embeds: [createBuildEmbed({
        ...result,
        lmStudio,
        generatedTemplate,
      })],
      ephemeral: true,
    });
  },
};
