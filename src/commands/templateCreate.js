const {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('../config');
const { isStaffMember } = require('../utils/permissions');
const logger = require('../utils/logger');
const { executeDryRun, executeLiveRun } = require('../services/discordTemplateRunner');
const { createLiveDiscordExecutionAdapter } = require('../services/executionAdapters/discordLiveExecutionAdapter');
const {
  countDiagnostics,
  formatFailureMessage,
  inferTemplateStatus,
  summarizeDiagnostics,
  uniqueDiagnostics,
} = require('../utils/templateDiagnostics');

const requiredPermissions = [
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
];

const hasRequiredPermissions = (memberPermissions) => requiredPermissions.every((permission) => (
  memberPermissions.has(permission)
));

const formatMissingPermissions = (memberPermissions) => requiredPermissions
  .filter((permission) => !memberPermissions.has(permission))
  .map((permission) => PermissionsBitField.Flags[Object.keys(PermissionsBitField.Flags).find((key) => PermissionsBitField.Flags[key] === permission)] || String(permission));

const createTemplateCreateEmbed = (slug, result, diagnostics = {}) => {
  const warnings = uniqueDiagnostics([
    ...(diagnostics.normalizationWarnings || []),
    ...(diagnostics.repairWarnings || []),
    ...(diagnostics.validationWarnings || []),
    ...(result.plan?.warnings || []),
    ...(result.liveRun?.warnings || []),
  ]);

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('TEMPLATE CREATE RESULT')
    .setDescription(`Live template creation finished for \`${slug}\`.`)
    .addFields(
      { name: 'Template', value: result.template.name, inline: false },
      {
        name: 'Status',
        value: inferTemplateStatus(diagnostics, {
          blocked: result.liveRun.finalStatus !== 'success',
          failed: result.liveRun.summary.failedCount > 0,
        }),
        inline: true,
      },
      { name: 'Run Result', value: result.liveRun.finalStatus, inline: true },
      { name: 'Warnings', value: String(countDiagnostics(warnings)), inline: true },
      {
        name: 'Run Summary',
        value: [
          `Created: ${result.liveRun.summary.successCount}`,
          `Blocked: ${result.liveRun.summary.blockedCount}`,
          `Failed: ${result.liveRun.summary.failedCount}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Top Diagnostics',
        value: summarizeDiagnostics(warnings, {
          fallback: 'None detected.',
          limit: 4,
        }),
        inline: false,
      },
      {
        name: 'Debug File',
        value: result.debugFilePath || 'Not written (production mode).',
        inline: false,
      },
    );
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-create')
    .setDescription('Create Discord roles, categories, channels and onboarding embeds from a validated template.')
    .addStringOption((option) => option
      .setName('template')
      .setDescription('Template slug to create, for example esport-team.')
      .setRequired(true))
    .addBooleanOption((option) => option
      .setName('confirm')
      .setDescription('Must be true to allow live creation.')
      .setRequired(true)),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const templateSlug = interaction.options.getString('template', true);
    const confirm = interaction.options.getBoolean('confirm', true);

    if (confirm !== true) {
      await interaction.reply({
        content: 'Template creation requires confirm:true.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!config.discordTemplateExecutionEnabled) {
      await interaction.reply({
        content: 'Live template execution is disabled. Enable DISCORD_TEMPLATE_EXECUTION_ENABLED=true to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      const botMember = interaction.guild?.members?.me || await interaction.guild?.members.fetchMe();

      if (!botMember) {
        await interaction.editReply({
          content: 'The bot member could not be resolved in this server.',
        });
        return;
      }

      if (!hasRequiredPermissions(botMember.permissions)) {
        const missingPermissions = formatMissingPermissions(botMember.permissions);

        await interaction.editReply({
          content: `The bot is missing required permissions: ${missingPermissions.join(', ')}.`,
        });
        return;
      }

      const dryRunResult = await executeDryRun(templateSlug);

      if (!dryRunResult.ok) {
        logger.warn('Template create dry run failed', {
          template: templateSlug,
          code: dryRunResult.code,
        });

        await interaction.editReply({
          content: formatFailureMessage('The template could not pass the required dry-run checks.', {
            errors: dryRunResult.errors,
            warnings: dryRunResult.warnings,
          }),
        });
        return;
      }

      if (dryRunResult.dryRun.finalStatus !== 'success') {
        await interaction.editReply({
          content: 'The template dry-run did not complete successfully. Live creation was blocked.',
        });
        return;
      }

      const liveAdapter = createLiveDiscordExecutionAdapter(interaction.guild);
      const liveRunResult = await executeLiveRun(templateSlug, liveAdapter);

      if (!liveRunResult.ok) {
        logger.warn('Template live run failed', {
          template: templateSlug,
          code: liveRunResult.code,
        });

        await interaction.editReply({
          content: formatFailureMessage('The template could not be executed live.', {
            errors: liveRunResult.errors,
            warnings: liveRunResult.warnings,
          }),
        });
        return;
      }

      await interaction.editReply({
        embeds: [createTemplateCreateEmbed(templateSlug, liveRunResult, liveRunResult.templateDiagnostics || {})],
      });
    } catch (error) {
      logger.error('Template create command failed', {
        template: templateSlug,
        error: error.message,
      });

      await interaction.editReply({
        content: 'The live template creation failed unexpectedly.',
      });
    }
  },
};
