const fs = require('node:fs');
const path = require('node:path');
const Parser = require('rss-parser');
const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const { createSocialPostEmbed, createSocialPostMessage } = require('../embeds/socialPostEmbed');

const parser = new Parser();
const dataDirectoryPath = path.join(process.cwd(), '.data');
const storeFilePath = path.join(dataDirectoryPath, 'social-posts.json');
const MAX_STORED_IDS = 500;
const FEED_BOOTSTRAP_LIMIT = 10;

const ensureDataDirectory = () => {
  fs.mkdirSync(dataDirectoryPath, { recursive: true });
};

const readStore = () => {
  ensureDataDirectory();

  if (!fs.existsSync(storeFilePath)) {
    return { postedIds: [] };
  }

  try {
    const raw = fs.readFileSync(storeFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.postedIds)) {
      return { postedIds: [] };
    }

    return {
      postedIds: parsed.postedIds.filter((id) => typeof id === 'string' && id.trim()),
    };
  } catch (error) {
    logger.error('Failed to read social watcher store', { error: error.message });
    return { postedIds: [] };
  }
};

const writeStore = (store) => {
  ensureDataDirectory();

  const trimmedStore = {
    postedIds: store.postedIds.slice(-MAX_STORED_IDS),
  };

  fs.writeFileSync(storeFilePath, JSON.stringify(trimmedStore, null, 2));
};

const getPostId = (item) => {
  const candidates = [
    item.guid,
    item.id,
    item.link,
    item.url,
    item.isoDate,
    item.pubDate && `${item.pubDate}:${item.link || item.title || ''}`,
    item.title,
  ];

  const match = candidates.find((value) => typeof value === 'string' && value.trim());
  return match ? match.trim() : null;
};

const getPostImage = (item) => {
  if (item.enclosure && typeof item.enclosure.url === 'string' && item.enclosure.url.trim()) {
    return item.enclosure.url.trim();
  }

  if (Array.isArray(item.enclosure) && item.enclosure[0] && typeof item.enclosure[0].url === 'string') {
    return item.enclosure[0].url.trim();
  }

  if (item.image && typeof item.image.url === 'string' && item.image.url.trim()) {
    return item.image.url.trim();
  }

  if (typeof item.thumbnail === 'string' && item.thumbnail.trim()) {
    return item.thumbnail.trim();
  }

  if (Array.isArray(item['media:content']) && item['media:content'][0] && item['media:content'][0].$.url) {
    return item['media:content'][0].$.url.trim();
  }

  return null;
};

const decodeHtmlEntities = (value) => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, '\'')
  .replace(/&nbsp;/g, ' ');

const cleanPreviewText = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

  return normalized || null;
};

const getFeedIcon = (parsedFeed) => {
  if (parsedFeed.image && typeof parsedFeed.image.url === 'string' && parsedFeed.image.url.trim()) {
    return parsedFeed.image.url.trim();
  }

  if (typeof parsedFeed.image === 'string' && parsedFeed.image.trim()) {
    return parsedFeed.image.trim();
  }

  if (typeof parsedFeed.icon === 'string' && parsedFeed.icon.trim()) {
    return parsedFeed.icon.trim();
  }

  if (typeof parsedFeed.favicon === 'string' && parsedFeed.favicon.trim()) {
    return parsedFeed.favicon.trim();
  }

  return null;
};

const normalizePost = (feed, parsedFeed, item) => {
  const id = getPostId(item);
  const url = typeof item.link === 'string' && item.link.trim()
    ? item.link.trim()
    : (typeof item.url === 'string' ? item.url.trim() : '');

  if (!id || !url) {
    return null;
  }

  return {
    id,
    platform: feed.platform,
    sourceName: feed.name,
    username: feed.username,
    title: typeof item.title === 'string' && item.title.trim()
      ? item.title.trim()
      : `${feed.name} published a new post.`,
    previewText: cleanPreviewText(item.contentSnippet)
      || cleanPreviewText(item.content)
      || cleanPreviewText(item.summary)
      || cleanPreviewText(item.title),
    url,
    publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
    image: getPostImage(item),
    sourceIcon: getFeedIcon(parsedFeed),
  };
};

const canPostInChannel = (channel, botMember) => {
  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const permissions = channel.permissionsFor(botMember);

  if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel)) {
    return false;
  }

  const canSendMessages = channel.isThread()
    ? permissions.has(PermissionFlagsBits.SendMessagesInThreads)
    : permissions.has(PermissionFlagsBits.SendMessages);

  return canSendMessages && permissions.has(PermissionFlagsBits.EmbedLinks);
};

const rememberIds = (store, ids) => {
  const nextIds = [...store.postedIds];

  for (const id of ids) {
    if (!nextIds.includes(id)) {
      nextIds.push(id);
    }
  }

  store.postedIds = nextIds.slice(-MAX_STORED_IDS);
  writeStore(store);
};

const fetchFeedItems = async (feed) => {
  const parsedFeed = await parser.parseURL(feed.url);
  return {
    parsedFeed,
    items: Array.isArray(parsedFeed.items) ? parsedFeed.items : [],
  };
};

const processFeed = async (feed, channel, store, isFirstRun) => {
  try {
    const { parsedFeed, items } = await fetchFeedItems(feed);
    const posts = items
      .map((item) => normalizePost(feed, parsedFeed, item))
      .filter(Boolean);

    if (!posts.length) {
      logger.warn('Social feed returned no valid posts', {
        platform: feed.platform,
        url: feed.url,
      });
      return;
    }

    const unseenPosts = posts.filter((post) => !store.postedIds.includes(post.id));

    if (!unseenPosts.length) {
      logger.info('No new social posts detected', {
        platform: feed.platform,
        username: feed.username,
      });
      return;
    }

    if (isFirstRun && store.postedIds.length === 0) {
      const bootstrapIds = posts
        .slice(0, FEED_BOOTSTRAP_LIMIT)
        .map((post) => post.id);

      rememberIds(store, bootstrapIds);
      logger.info('Social feed bootstrapped without reposting old items', {
        platform: feed.platform,
        username: feed.username,
        remembered: bootstrapIds.length,
      });
      return;
    }

    const postsToSend = unseenPosts
      .slice(0, 5)
      .reverse();

    for (const post of postsToSend) {
      await channel.send({
        content: createSocialPostMessage(post),
        embeds: [createSocialPostEmbed(post)],
      });
      rememberIds(store, [post.id]);
      logger.info('Social post published to Discord', {
        platform: post.platform,
        username: post.username,
        url: post.url,
      });
    }
  } catch (error) {
    logger.error('Failed to process social feed', {
      platform: feed.platform,
      username: feed.username,
      url: feed.url,
      error: error.message,
    });
  }
};

const runSocialCheck = async (client, isFirstRun = false) => {
  if (!config.socialsChannelId) {
    logger.warn('Skipping social watcher because SOCIALS_CHANNEL_ID is missing');
    return;
  }

  if (!config.socialFeeds.length) {
    logger.warn('Skipping social watcher because SOCIAL_FEEDS_JSON is empty');
    return;
  }

  const channel = await client.channels.fetch(config.socialsChannelId).catch(() => null);
  const botMember = channel && channel.guild ? channel.guild.members.me : null;

  if (!canPostInChannel(channel, botMember)) {
    logger.warn('Social watcher cannot access the socials channel', {
      channelId: config.socialsChannelId,
    });
    return;
  }

  const store = readStore();
  const shouldBootstrap = isFirstRun && store.postedIds.length === 0;

  for (const feed of config.socialFeeds) {
    await processFeed(feed, channel, store, shouldBootstrap);
  }
};

const startSocialWatcher = async (client) => {
  if (!config.socialsChannelId) {
    logger.warn('Social watcher disabled because SOCIALS_CHANNEL_ID is missing');
    return;
  }

  if (!config.socialFeeds.length) {
    logger.warn('Social watcher disabled because SOCIAL_FEEDS_JSON is empty');
    return;
  }

  await runSocialCheck(client, true);

  setInterval(() => {
    runSocialCheck(client).catch((error) => {
      logger.error('Unexpected social watcher interval error', { error: error.message });
    });
  }, config.socialCheckIntervalMs);

  logger.info('Social watcher started', {
    channelId: config.socialsChannelId,
    feedCount: config.socialFeeds.length,
    intervalMs: config.socialCheckIntervalMs,
  });
};

module.exports = {
  startSocialWatcher,
};
