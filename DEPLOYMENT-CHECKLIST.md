# Discord Bot Deployment Checklist

This checklist is intentionally pre-deployment only. It does not assume the bot is already cloud-ready.

## Before GitHub Becomes The Main Source

- Confirm local code changes that must be kept.
- Confirm untracked source files that must be added.
- Confirm `.env` has been backed up outside the repository.
- Confirm `.data/social-posts.json` has been backed up if duplicate protection state matters.
- Confirm `.gitignore` still excludes `.env`, `.data/`, and `node_modules/`.

## Before Cloud Deployment

- Choose a host platform.
- Decide where secrets will be stored.
- Decide how `.data/social-posts.json` will persist.
- Confirm `npm install` and `npm start` work from a clean checkout.
- Confirm `npm run register-commands` can be run from a non-local environment when needed.
- Confirm the bot has all required Discord permissions.

## After Hosting Is Chosen

- Create runtime environment variables on the host.
- Deploy from GitHub, not from a local copy.
- Start the bot with `npm start`.
- Validate slash commands.
- Validate welcome flow.
- Validate `siteStatus`.
- Validate social watcher duplicate protection.
