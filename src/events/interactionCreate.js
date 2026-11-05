const fs = require('node:fs');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

const globalCrashDebugDirectoryPath = path.join(process.cwd(), 'debug', 'global-command-crashes');

const ensureGlobalCrashDebugDirectory = () => {
  fs.mkdirSync(globalCrashDebugDirectoryPath, { recursive: true });
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

const writeGlobalCommandCrashFile = (interaction, error) => {
  ensureGlobalCrashDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(globalCrashDebugDirectoryPath, `global-command-crash-${timestamp}.txt`);
  const content = [
    `command: ${safeString(interaction?.commandName, 'unknown')}`,
    `userId: ${safeString(interaction?.user?.id, 'unknown')}`,
    `deferred: ${interaction?.deferred ? 'true' : 'false'}`,
    `replied: ${interaction?.replied ? 'true' : 'false'}`,
    `name: ${safeString(error?.name, 'UnknownError')}`,
    `message: ${safeString(error?.message, 'No error message')}`,
    `cause: ${safeString(error?.cause?.message || error?.cause, 'None')}`,
    '',
    '[STACK]',
    logger.redact(safeString(error?.stack, 'No stack available.')),
  ].join('\n');

  fs.writeFileSync(filePath, `${logger.redact(content)}\n`, { encoding: 'utf8', mode: 0o600 });
  return filePath;
};

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.customId?.startsWith('zl:')) {
      try { await require('../services/managed/interactions').handleManaged(interaction); }
      catch (error) {
        logger.warn('Managed interaction failed', { guildId: interaction.guildId, code: error.code || 'VALIDATION_FAILED' });
        const payload = { content: require('../utils/logger').redact(String(error.message)).slice(0, 1800), allowedMentions: { parse: [] } };
        try { if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }); } catch { /* Expired interaction cannot be answered. */ }
      }
      return;
    }
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      logger.warn('Received unknown command interaction', { command: interaction.commandName });
      return;
    }

    try {
      await command.execute(interaction);
      logger.info('Slash command executed', {
        command: interaction.commandName,
        userId: interaction.user.id,
      });
    } catch (error) {
      const crashFilePath = writeGlobalCommandCrashFile(interaction, error);

      logger.error('Global command crash', {
        command: interaction.commandName,
        error: safeString(error?.message, 'No error message'),
        name: safeString(error?.name, 'UnknownError'),
        cause: safeString(error?.cause?.message || error?.cause, 'None'),
        deferred: interaction.deferred ? 'true' : 'false',
        replied: interaction.replied ? 'true' : 'false',
        stack: logger.redact(safeString(error?.stack, 'No stack available.')),
        crashFilePath,
      });

      const payload = {
        content: logger.redact(`Action impossible : ${safeString(error?.message, 'Unknown error.')}`).slice(0, 1800),
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      };

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
          return;
        }

        await interaction.reply(payload);
      } catch (responseError) {
        logger.error('Failed to send Discord response', {
          command: interaction.commandName,
          error: safeString(responseError?.message, 'No error message'),
          name: safeString(responseError?.name, 'UnknownError'),
          stack: safeString(responseError?.stack, 'No stack available.'),
          deferred: interaction.deferred ? 'true' : 'false',
          replied: interaction.replied ? 'true' : 'false',
        });
      }
    }
  },
};
