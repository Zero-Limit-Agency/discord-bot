const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');

const scope = process.env.COMMAND_SCOPE || 'guild';
if (!['guild', 'global'].includes(scope)) throw new Error('COMMAND_SCOPE must be guild or global.');
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
const commands = commandFiles.map((file) => {
  const command = require(path.join(commandsPath, file));
  return command.data.toJSON();
});

const validateRequiredConfig = () => {
  const missing = [];

  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (scope === 'guild' && !config.guildId) missing.push('GUILD_ID');

  if (missing.length) {
    throw new Error(`Missing required environment variables for command registration: ${missing.join(', ')}`);
  }
};

const registerCommands = async () => {
  validateRequiredConfig();

  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const route = scope === 'global' ? Routes.applicationCommands(config.clientId) : Routes.applicationGuildCommands(config.clientId, config.guildId);
  // Upsert this bot's known commands without deleting unrelated or historical entries.
  for (const body of commands) await rest.post(route, { body });

  logger.info('Slash commands registered', { count: commands.length, scope, guildId: scope === 'guild' ? config.guildId : null });
};

registerCommands().catch((error) => {
  logger.error('Failed to register slash commands', { error: error.message });
  process.exitCode = 1;
});