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
    const handler = (...args) => {
      const allowedGuilds = (process.env.ALLOWED_GUILD_IDS || '').split(',').filter(Boolean);
      const guildId = args[0]?.guildId || args[0]?.guild?.id;
      if (allowedGuilds.length && guildId && !allowedGuilds.includes(guildId)) return;
      Promise.resolve().then(() => event.execute(...args, client)).catch((error) => {
        logger.error('Event failed', { event: event.name, guildId, code: error.code || error.name, error: error.message });
      });
    };

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
  require('./services/networkProxy').configureNetworkProxy();
  require('./services/runtimeLock').acquireRuntimeLock();

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
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      ...(process.env.MESSAGE_CONTENT_ENABLED === 'true' ? [GatewayIntentBits.MessageContent] : []),
    ],
  });

  loadCommands(client);
  loadEvents(client);

  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection', { error: error.message });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
  });

  client.on('shardError', (error) => logger.error('Discord gateway error', { code: error.code || error.name }));
  const shutdown = async () => { await client.destroy(); process.exit(0); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  const startupTimer = setTimeout(() => { logger.error('Discord gateway did not become ready within 60 seconds'); client.destroy(); process.exitCode = 1; }, 60000);
  startupTimer.unref();
  client.once('clientReady', () => clearTimeout(startupTimer));
  try { await client.login(config.discordToken); } catch (error) { clearTimeout(startupTimer); throw error; }
};

module.exports = { start, loadCommands, loadEvents, validateStartupConfig };
if (require.main === module) start().catch((error) => {
  logger.error('Bot failed to start', { error: error.message });
  process.exitCode = 1;
});
