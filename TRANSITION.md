# Discord Bot Transition Audit

Last updated: 2026-05-13

## Goal

Move the Zero Limit Agency Discord bot from a local-PC-dependent workflow to a GitHub-first, cloud-ready workflow without losing local-only code, configuration, or operational state.

## Current Reality

- The repository exists locally and has a GitHub remote.
- GitHub is not yet the full source of truth.
- The local working tree contains uncommitted tracked changes.
- The local working tree contains untracked source files.
- Runtime secrets still live in a local `.env`.
- Social watcher state still lives in local `.data/social-posts.json`.
- There are no GitHub Actions or deployment manifests yet.
- The bot is still started manually from a local machine.

## Preserve Before Any Transition

### Local-only secrets and configuration

Never commit these values to GitHub:

- `DISCORD_TOKEN`
- local `.env` values

Important environment configuration that must be backed up outside Git:

- `CLIENT_ID`
- `GUILD_ID`
- `WELCOME_CHANNEL_ID`
- `STATUS_CHANNEL_ID`
- `SOCIALS_CHANNEL_ID`
- `SITE_STATUS_URL`
- `STATUS_CHECK_INTERVAL_MS`
- `RULES_BANNER_URL`
- `STAFF_ROLE_IDS`
- `SOCIAL_CHECK_INTERVAL_MS`
- `SOCIAL_FEEDS_JSON`

### Local operational state

Preserve before migration:

- `.data/social-posts.json`

This file prevents duplicate reposting by the social watcher.

### Local source changes not yet on GitHub

Tracked but modified:

- `.env.example`
- `src/config.js`
- `src/embeds/socialPostEmbed.js`
- `src/embeds/welcomeEmbed.js`
- `src/events/guildMemberAdd.js`
- `src/services/socialWatcher.js`

Untracked source files:

- `src/commands/linksPost.js`
- `src/embeds/linksEmbed.js`

## What Can Go To GitHub

Safe to version:

- source code under `src/`
- `README.md`
- `AGENTS.md`
- `TRANSITION.md`
- `.env.example`
- `package.json`
- `package-lock.json`
- `.gitignore`

Must stay out of GitHub:

- `.env`
- `.data/`
- `node_modules/`
- any exported secret dumps or token files

## GitHub-First Preparation Order

1. Preserve local secrets outside the repo.
2. Preserve `.data/social-posts.json` outside the repo.
3. Review every modified and untracked source file.
4. Decide what code belongs in the main branch.
5. Commit wanted code to Git locally.
6. Push only reviewed, secret-free code to GitHub.
7. Keep `.env` and `.data/` local or move them to secure runtime storage later.

## Cloud Readiness Gaps

The bot is not yet cloud-ready because it still needs:

- managed secrets outside the local PC
- a deployment target
- a restart/supervision strategy
- a persistence plan for `.data/social-posts.json`
- deployment documentation
- optionally CI/CD

## Next Safe Actions

1. Reconcile local code so GitHub matches the intended source tree.
2. Refresh `.env.example` so it matches required runtime variables without exposing values.
3. Create a deployment checklist before choosing a host.
4. Choose how to preserve social watcher state in cloud.
