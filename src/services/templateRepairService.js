const { slugifyTemplateName } = require('./draftTemplateStore');

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

  if (!repairedRole.permissions) {
    return repairedRole;
  }

  if (typeof repairedRole.permissions === 'string') {
    repairedRole.permissions = [repairedRole.permissions.trim()].filter(Boolean);
    repairWarnings.push(`roles[${index}].permissions was converted from string to array.`);
  }

  if (!repairedRole.id && !repairedRole.key) {
    const generatedKey = createGeneratedKey('role', repairedRole.name, index);
    repairedRole.id = generatedKey;
    repairedRole.key = generatedKey;
    repairWarnings.push(`Generated missing role key from role name for roles[${index}].`);
  } else if (!repairedRole.id && repairedRole.key) {
    repairedRole.id = repairedRole.key;
    repairWarnings.push(`roles[${index}] copied key into missing id.`);
  } else if (!repairedRole.key && repairedRole.id) {
    repairedRole.key = repairedRole.id;
    repairWarnings.push(`roles[${index}] copied id into missing key.`);
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
  } else if (!repairedCategory.key && repairedCategory.id) {
    repairedCategory.key = repairedCategory.id;
    repairWarnings.push(`categories[${index}] copied id into missing key.`);
  }

  return repairedCategory;
};

const repairChannelPermissions = (permissions, index, repairWarnings) => {
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
  } else if (!repairedChannel.key && repairedChannel.id) {
    repairedChannel.key = repairedChannel.id;
    repairWarnings.push(`channels[${index}] copied id into missing key.`);
  }

  if (!repairedChannel.categoryId && repairedChannel.category) {
    repairedChannel.categoryId = repairedChannel.category;
    repairWarnings.push(`channels[${index}] converted category to categoryId.`);
  }

  if (!repairedChannel.type) {
    repairedChannel.type = 'text';
    repairWarnings.push(`channels[${index}] defaulted missing type to "text".`);
  }

  if (repairedChannel.permissions !== undefined) {
    repairedChannel.permissions = repairChannelPermissions(repairedChannel.permissions, index, repairWarnings);
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

    return embed;
  });
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
    const repairedTemplate = {
      ...template,
      roles: Array.isArray(template.roles)
        ? template.roles.map((role, index) => repairRole(role, index, repairWarnings))
        : template.roles,
      categories: Array.isArray(template.categories)
        ? template.categories.map((category, index) => repairCategory(category, index, repairWarnings))
        : template.categories,
      channels: Array.isArray(template.channels)
        ? template.channels.map((channel, index) => repairChannel(channel, index, repairWarnings))
        : template.channels,
      welcomeEmbeds: repairWelcomeEmbeds(template.welcomeEmbeds, repairWarnings),
    };

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
