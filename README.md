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
- `SOCIALS_CHANNEL_ID`: Channel where new social posts should be posted automatically.
- `SITE_STATUS_URL`: URL checked by the site status service.
- `RULES_BANNER_URL`: Optional banner image shown at the top of the `/rules` introduction embed.
- `STAFF_ROLE_IDS`: Comma-separated role IDs allowed to use staff-only commands.
- `STATUS_CHECK_INTERVAL_MS`: Interval between automatic status checks. Default: `60000`.
- `SOCIAL_CHECK_INTERVAL_MS`: Interval between social feed checks. Default: `300000`.
- `SOCIAL_FEEDS_JSON`: JSON array of RSS or Atom feed sources to watch.

Example `SOCIAL_FEEDS_JSON`:

```json
[
  {
    "platform": "X",
    "name": "Zero Limit Agency",
    "username": "@Z0Agency",
    "url": "URL_FEED_X_A_COMPLETER"
  },
  {
    "platform": "TikTok",
    "name": "Zero Limit Agency",
    "username": "@z0agency",
    "url": "URL_FEED_TIKTOK_A_COMPLETER"
  }
]
```

The bot does not use official X or TikTok APIs. Feed URLs must be provided through `.env`, and they can come from a free RSS or Atom source such as RSSHub or another external feed tool if the platform does not expose a native feed directly.

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

This registers the slash commands available in the guild defined by `GUILD_ID`, including `/status`, `/announce`, `/rules-post`, and `/how-to-use-post`.

## Social Auto-Post
- Set `SOCIALS_CHANNEL_ID` to the Discord channel where new posts should appear.
- Set `SOCIAL_CHECK_INTERVAL_MS` to control how often feeds are checked.
- Set `SOCIAL_FEEDS_JSON` to a valid JSON array of feed definitions.
- The watcher supports standard RSS and Atom feeds.
- If a feed is invalid or unavailable, the bot logs the error and continues running.
- On first successful startup, the watcher records current feed items as already seen to avoid reposting older content.

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
