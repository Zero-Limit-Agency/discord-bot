const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');
const { reconcileInterruptedBuildJobs } = require('./services/buildJobService');

const validateStartupConfig = () => {
  if (!config.discordToken) {
    throw new Error('Missing DISCORD_TOKEN in environment variables.');
  }
};

const loadCommands = (client) => {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

  client.commands = new Collection();

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
  }

  logger.info('Commands loaded', { count: client.commands.size });
};

const loadEvents = (client) => {
  const eventsPath = path.join(__dirname, 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    const handler = (...args) => event.execute(...args, client);

    if (event.once) {
      client.once(event.name, handler);
      continue;
    }

    client.on(event.name, handler);
  }

  logger.info('Events loaded', { count: eventFiles.length });
};

const start = async () => {
  validateStartupConfig();

  const interruptedJobs = reconcileInterruptedBuildJobs();

  if (interruptedJobs.length) {
    logger.warn('Interrupted build jobs reconciled after restart', {
      count: interruptedJobs.length,
      runIds: interruptedJobs.map((job) => job.runId).join(','),
    });
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  loadCommands(client);
  loadEvents(client);

  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection', { error: error.message });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
  });

  await client.login(config.discordToken);
};

start().catch((error) => {
  logger.error('Bot failed to start', { error: error.message });
  process.exitCode = 1;
});
