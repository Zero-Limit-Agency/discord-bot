# Zero Limit Agency Discord Bot

A clean first version of the Zero Limit Agency Discord bot built with Node.js, `discord.js`, and `dotenv`.

## Installation
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env`.
3. Fill in the required environment variables.

## Configuration
Required for startup:
- `DISCORD_TOKEN`: Discord bot token.

Needed to register slash commands:
- `CLIENT_ID`: Application ID from the Discord Developer Portal.
- `GUILD_ID`: Server ID for guild-scoped slash commands.

Optional features:
- `WELCOME_CHANNEL_ID`: Channel where the welcome embed is posted.
- `STATUS_CHANNEL_ID`: Channel to rename with the site status.
- `SITE_STATUS_URL`: URL checked by the site status service.
- `STATUS_CHECK_INTERVAL_MS`: Interval between automatic status checks. Default: `60000`.

## Run The Bot
```bash
npm start
```

For development with automatic restart:
```bash
npm run dev
```

## Register Slash Commands
```bash
npm run register-commands
```

This registers `/rules` and `/status` in the guild defined by `GUILD_ID`.

## Invite The Bot
1. Open the Discord Developer Portal.
2. Go to your application.
3. Open `OAuth2` > `URL Generator`.
4. Select scopes:
   - `bot`
   - `applications.commands`
5. Select permissions:
   - `View Channels`
   - `Send Messages`
   - `Embed Links`
   - `Manage Channels`
   - `Read Message History`
   - `Use Slash Commands`
6. Open the generated URL and invite the bot to your server.