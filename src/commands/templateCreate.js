const {
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('../config');
const { randomUUID } = require('node:crypto');
const { deliverBuild } = require('../services/buildDelivery');
const { createBuildJob, updateBuildJob } = require('../services/buildJobService');
const activeGuilds = require('../services/guildBuildLock');
const { isOwner } = require('../utils/permissions');
const logger = require('../utils/logger');
const { executeDryRun } = require('../services/discordTemplateRunner');
const { formatFailureMessage } = require('../utils/templateDiagnostics');

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
    if (!interaction.guildId || !isOwner(interaction.user.id)) {
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

    if (activeGuilds.has(interaction.guildId)) { await interaction.reply({ content: 'Un build est déjà actif sur ce serveur.', flags: MessageFlags.Ephemeral }); return; }
    activeGuilds.add(interaction.guildId);
    const runId = `template-${randomUUID()}`;
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); }
    catch (error) { activeGuilds.delete(interaction.guildId); throw error; }

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

      createBuildJob({ runId, guildId: interaction.guildId, userId: interaction.user.id, status: 'running', templateSlug });
      const record = await deliverBuild(interaction.guild, { dryRunResult }, runId);
      updateBuildJob(runId, { status: 'completed', currentAgent: null });
      await interaction.editReply({ content: `Création vérifiée. Run : ${runId}. Ressources : ${record.resources.length}.` });
    } catch (error) {
      logger.error('Template create command failed', {
        template: templateSlug,
        error: error.message,
      });

      try { updateBuildJob(runId, { status: 'failed', mainError: error.message }); } catch {}
      await interaction.editReply({ content: logger.redact(error.message).slice(0, 1800) });
    } finally { activeGuilds.delete(interaction.guildId); }
  },
};
