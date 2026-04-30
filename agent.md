# AGENTS.md — Z0 Discord Bot

This repository contains only the Discord bot for Zero Limit Agency.

Do not modify the website repository from here.
Do not add website code in this repository.
Do not hardcode secrets, tokens, API keys, Discord tokens, or Supabase service keys.

## Project goals

The bot should handle:
- Discord embeds
- Rules embed
- Welcome messages
- Website status channel updates
- Future social media auto-posting
- Future server utilities

## Tech stack

- Node.js
- discord.js
- dotenv

## Expected structure

src/
  index.js
  config.js
  commands/
  events/
  embeds/
  services/
  utils/

## Environment variables

Use `.env` locally.
Keep `.env.example` updated.
Never commit real secrets.

## Quality rules

- Keep code simple and readable.
- Avoid putting all logic in `index.js`.
- Separate commands, events, embeds and services.
- The bot must not crash if optional variables are missing.
- Log useful information in the console.

## Verification

Before finishing, make sure:
- dependencies are listed in package.json
- npm scripts are clear
- README explains setup
- .gitignore includes `.env` and `node_modules`
