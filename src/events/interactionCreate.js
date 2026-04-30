const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
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
      logger.error('Failed to execute slash command', {
        command: interaction.commandName,
        error: error.message,
      });

      const payload = { content: 'An error occurred while running this command.', ephemeral: true };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
        return;
      }

      await interaction.reply(payload).catch(() => null);
    }
  },
};