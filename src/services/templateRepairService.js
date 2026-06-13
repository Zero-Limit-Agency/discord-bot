const { slugifyTemplateName } = require('./draftTemplateStore');

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const EMBED_TITLE_MAX_LENGTH = 256;
const EMBED_DESCRIPTION_MAX_LENGTH = 4096;

const toStringArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const toCleanString = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
};

const truncateString = (value, maxLength) => {
  const normalized = toCleanString(value);

  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
};

const createLookupMaps = (items = []) => {
  const byId = new Map();
  const byName = new Map();

  items.forEach((item) => {
    if (!isPlainObject(item)) {
      return;
    }

    const internalId = toCleanString(item.id || item.key);
    const name = toCleanString(item.name);

    if (internalId) {
      byId.set(internalId.toLowerCase(), internalId);
    }

    if (name && internalId && !byName.has(name.toLowerCase())) {
      byName.set(name.toLowerCase(), internalId);
    }
  });

  return {
    byId,
    byName,
  };
};

const resolveReference = (value, lookup) => {
  const normalized = toCleanString(value);

  if (!normalized) {
    return null;
  }

  return lookup.byId.get(normalized.toLowerCase())
    || lookup.byName.get(normalized.toLowerCase())
    || null;
};

const createGeneratedKey = (prefix, fallbackSource, index) => {
  const slug = slugifyTemplateName(fallbackSource || `${prefix}-${index + 1}`);
  return slug || `${prefix}-${index + 1}`;
};

const createEveryoneOverwrite = (permissions) => ({
  target: '@everyone',
  allow: toStringArray(permissions),
  deny: [],
});

const repairRole = (role, index, repairWarnings) => {
  if (!isPlainObject(role)) {
    return role;
  }

  const repairedRole = { ...role };

  if (!repairedRole.id && !repairedRole.key) {
    const generatedKey = createGeneratedKey('role', repairedRole.name, index);
    repairedRole.id = generatedKey;
    repairedRole.key = generatedKey;
    repairWarnings.push(`Generated missing role key from role name for roles[${index}].`);
  } else if (!repairedRole.id && repairedRole.key) {
    repairedRole.id = repairedRole.key;
    repairWarnings.push(`roles[${index}] copied key into missing id.`);
  }

  if (typeof repairedRole.permissions === 'string') {
    repairedRole.permissions = [repairedRole.permissions.trim()].filter(Boolean);
    repairWarnings.push(`roles[${index}].permissions was converted from string to array.`);
  }

  return repairedRole;
};

const repairCategory = (category, index, repairWarnings) => {
  if (!isPlainObject(category)) {
    return category;
  }

  const repairedCategory = { ...category };

  if (!repairedCategory.id && !repairedCategory.key) {
    const generatedKey = createGeneratedKey('category', repairedCategory.name, index);
    repairedCategory.id = generatedKey;
    repairedCategory.key = generatedKey;
    repairWarnings.push(`Generated missing category key from category name for categories[${index}].`);
  } else if (!repairedCategory.id && repairedCategory.key) {
    repairedCategory.id = repairedCategory.key;
    repairWarnings.push(`categories[${index}] copied key into missing id.`);
  }

  return repairedCategory;
};

const repairChannelPermissions = (permissions, index, repairWarnings, roleLookup) => {
  if (typeof permissions === 'string' && permissions.trim()) {
    repairWarnings.push(`channels[${index}].permissions string was converted to an @everyone overwrite object.`);
    return [createEveryoneOverwrite(permissions)];
  }

  if (!Array.isArray(permissions)) {
    return permissions;
  }

  if (!permissions.length) {
    return permissions;
  }

  const allStrings = permissions.every((entry) => typeof entry === 'string');

  if (allStrings) {
    repairWarnings.push(`Converted simple permission array to @everyone overwrite objects for channels[${index}].`);
    return [createEveryoneOverwrite(permissions)];
  }

  return permissions.map((entry, permissionIndex) => {
    if (typeof entry === 'string' && entry.trim()) {
      repairWarnings.push(`channels[${index}].permissions[${permissionIndex}] string was converted to an @everyone overwrite object.`);
      return createEveryoneOverwrite(entry);
    }

    if (!isPlainObject(entry)) {
      return entry;
    }

    const repairedEntry = { ...entry };

    if (!repairedEntry.target && repairedEntry.roleId) {
      repairedEntry.target = repairedEntry.roleId;
      repairWarnings.push(`channels[${index}].permissions[${permissionIndex}] converted roleId to target.`);
    }

    if (repairedEntry.target) {
      const resolvedRoleRef = resolveReference(repairedEntry.target, roleLookup);

      if (resolvedRoleRef && resolvedRoleRef !== repairedEntry.target) {
        repairedEntry.target = resolvedRoleRef;
        repairWarnings.push(`channels[${index}].permissions[${permissionIndex}] resolved role reference "${entry.target}" to "${resolvedRoleRef}".`);
      }
    }

    if (!Array.isArray(repairedEntry.allow)) {
      repairedEntry.allow = toStringArray(repairedEntry.allow);
      if (repairedEntry.allow.length || repairedEntry.allow === []) {
        repairWarnings.push(`channels[${index}].permissions[${permissionIndex}].allow was normalized to an array.`);
      }
    }

    if (!Array.isArray(repairedEntry.deny)) {
      repairedEntry.deny = toStringArray(repairedEntry.deny);
      if (repairedEntry.deny.length || repairedEntry.deny === []) {
        repairWarnings.push(`channels[${index}].permissions[${permissionIndex}].deny was normalized to an array.`);
      }
    }

    return repairedEntry;
  });
};

const repairChannel = (channel, index, repairWarnings) => {
  if (!isPlainObject(channel)) {
    return channel;
  }

  const repairedChannel = { ...channel };

  if (!repairedChannel.id && !repairedChannel.key) {
    const generatedKey = createGeneratedKey('channel', repairedChannel.name, index);
    repairedChannel.id = generatedKey;
    repairedChannel.key = generatedKey;
    repairWarnings.push(`Generated missing channel key from channel name for channels[${index}].`);
  } else if (!repairedChannel.id && repairedChannel.key) {
    repairedChannel.id = repairedChannel.key;
    repairWarnings.push(`channels[${index}] copied key into missing id.`);
  }

  if (!repairedChannel.categoryId && repairedChannel.category) {
    repairedChannel.categoryId = repairedChannel.category;
    repairWarnings.push(`channels[${index}] converted category to categoryId.`);
  }

  if (!repairedChannel.type) {
    repairedChannel.type = 'text';
    repairWarnings.push(`channels[${index}] defaulted missing type to "text".`);
  }

  return repairedChannel;
};

const repairChannelWithLookups = (channel, index, repairWarnings, roleLookup, categoryLookup) => {
  const repairedChannel = repairChannel(channel, index, repairWarnings);

  if (!isPlainObject(repairedChannel)) {
    return repairedChannel;
  }

  if (repairedChannel.categoryId) {
    const resolvedCategoryRef = resolveReference(repairedChannel.categoryId, categoryLookup);

    if (resolvedCategoryRef && resolvedCategoryRef !== repairedChannel.categoryId) {
      repairWarnings.push(`channels[${index}].categoryId resolved category reference "${repairedChannel.categoryId}" to "${resolvedCategoryRef}".`);
      repairedChannel.categoryId = resolvedCategoryRef;
    }
  }

  if (repairedChannel.permissions !== undefined) {
    repairedChannel.permissions = repairChannelPermissions(
      repairedChannel.permissions,
      index,
      repairWarnings,
      roleLookup,
    );
  }

  return repairedChannel;
};

const repairWelcomeEmbeds = (welcomeEmbeds, repairWarnings) => {
  if (welcomeEmbeds === undefined || welcomeEmbeds === null) {
    repairWarnings.push('welcomeEmbeds was missing and defaulted to an empty array during repair.');
    return [];
  }

  if (!Array.isArray(welcomeEmbeds)) {
    return welcomeEmbeds;
  }

  return welcomeEmbeds.map((embed, index) => {
    if (typeof embed === 'string' && embed.trim()) {
      repairWarnings.push(`welcomeEmbeds[${index}] string was converted to an embed object.`);
      return {
        title: embed.trim(),
      };
    }

    if (!isPlainObject(embed)) {
      repairWarnings.push(`welcomeEmbeds[${index}] was removed because it is not a valid object.`);
      return null;
    }

    const repairedEmbed = { ...embed };

    if (!repairedEmbed.title && repairedEmbed.content) {
      repairedEmbed.description = repairedEmbed.description || repairedEmbed.content;
      repairWarnings.push(`welcomeEmbeds[${index}] moved content into description.`);
    }

    if (!repairedEmbed.description && repairedEmbed.text) {
      repairedEmbed.description = repairedEmbed.text;
      repairWarnings.push(`welcomeEmbeds[${index}] moved text into description.`);
    }

    if (repairedEmbed.title !== undefined) {
      const truncatedTitle = truncateString(repairedEmbed.title, EMBED_TITLE_MAX_LENGTH);

      if (truncatedTitle !== toCleanString(repairedEmbed.title)) {
        repairWarnings.push(`welcomeEmbeds[${index}].title was truncated to ${EMBED_TITLE_MAX_LENGTH} characters.`);
      }

      repairedEmbed.title = truncatedTitle;
    }

    if (repairedEmbed.description !== undefined) {
      const truncatedDescription = truncateString(repairedEmbed.description, EMBED_DESCRIPTION_MAX_LENGTH);

      if (truncatedDescription !== toCleanString(repairedEmbed.description)) {
        repairWarnings.push(`welcomeEmbeds[${index}].description was truncated to ${EMBED_DESCRIPTION_MAX_LENGTH} characters.`);
      }

      repairedEmbed.description = truncatedDescription;
    }

    if (!toCleanString(repairedEmbed.title) && !toCleanString(repairedEmbed.description)) {
      repairWarnings.push(`welcomeEmbeds[${index}] was removed because it has no usable title or description.`);
      return null;
    }

    return repairedEmbed;
  }).filter(Boolean);
};

const repairTemplate = (template) => {
  const repairWarnings = [];

  if (!isPlainObject(template)) {
    return {
      ok: false,
      repairedTemplate: template,
      repairWarnings,
      code: 'INVALID_TEMPLATE_ROOT',
      message: 'Template root is not an object and could not be repaired.',
    };
  }

  try {
    const repairedRoles = Array.isArray(template.roles)
      ? template.roles.map((role, index) => repairRole(role, index, repairWarnings))
      : template.roles;
    const repairedCategories = Array.isArray(template.categories)
      ? template.categories.map((category, index) => repairCategory(category, index, repairWarnings))
      : template.categories;
    const roleLookup = createLookupMaps(repairedRoles);
    const categoryLookup = createLookupMaps(repairedCategories);
    const repairedChannels = Array.isArray(template.channels)
      ? template.channels.map((channel, index) => repairChannelWithLookups(
        channel,
        index,
        repairWarnings,
        roleLookup,
        categoryLookup,
      ))
      : template.channels;
    const channelLookup = createLookupMaps(repairedChannels);

    const repairedTemplate = {
      ...template,
      roles: repairedRoles,
      categories: repairedCategories,
      channels: repairedChannels,
      welcomeEmbeds: repairWelcomeEmbeds(template.welcomeEmbeds, repairWarnings),
    };

    if (repairedTemplate.onboardingChannelId) {
      const resolvedChannelRef = resolveReference(repairedTemplate.onboardingChannelId, channelLookup);

      if (resolvedChannelRef && resolvedChannelRef !== repairedTemplate.onboardingChannelId) {
        repairWarnings.push(`onboardingChannelId resolved channel reference "${repairedTemplate.onboardingChannelId}" to "${resolvedChannelRef}".`);
        repairedTemplate.onboardingChannelId = resolvedChannelRef;
      }
    }

    return {
      ok: true,
      repairedTemplate,
      repairWarnings,
    };
  } catch (error) {
    return {
      ok: false,
      repairedTemplate: template,
      repairWarnings,
      code: 'REPAIR_FAILED',
      message: 'Template repair failed unexpectedly.',
    };
  }
};

module.exports = {
  repairTemplate,
};
