const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toCleanString = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
};

const normalizeRole = (role, index, warnings) => {
  if (!isPlainObject(role)) {
    warnings.push(`roles[${index}] could not be normalized because it is not an object.`);
    return role;
  }

  const normalizedRole = { ...role };
  const normalizedId = toCleanString(normalizedRole.id);
  const normalizedKey = toCleanString(normalizedRole.key);
  const normalizedName = toCleanString(normalizedRole.name);

  if (!normalizedRole.id && normalizedKey) {
    normalizedRole.id = normalizedKey;
    warnings.push(`roles[${index}] used key as id.`);
  } else if (normalizedId) {
    normalizedRole.id = normalizedId;
  }

  if (!normalizedRole.key && normalizedId) {
    normalizedRole.key = normalizedId;
    warnings.push(`roles[${index}] used id as key.`);
  } else if (normalizedKey) {
    normalizedRole.key = normalizedKey;
  }

  if (normalizedName) {
    normalizedRole.name = normalizedName;
  }

  return normalizedRole;
};

const normalizeCategory = (category, index, warnings) => {
  if (!isPlainObject(category)) {
    warnings.push(`categories[${index}] could not be normalized because it is not an object.`);
    return category;
  }

  const normalizedCategory = { ...category };
  const normalizedId = toCleanString(normalizedCategory.id);
  const normalizedKey = toCleanString(normalizedCategory.key);
  const normalizedName = toCleanString(normalizedCategory.name);

  if (!normalizedCategory.id && normalizedKey) {
    normalizedCategory.id = normalizedKey;
    warnings.push(`categories[${index}] used key as id.`);
  } else if (normalizedId) {
    normalizedCategory.id = normalizedId;
  }

  if (!normalizedCategory.key && normalizedId) {
    normalizedCategory.key = normalizedId;
    warnings.push(`categories[${index}] used id as key.`);
  } else if (normalizedKey) {
    normalizedCategory.key = normalizedKey;
  }

  if (normalizedName) {
    normalizedCategory.name = normalizedName;
  }

  return normalizedCategory;
};

const normalizeChannel = (channel, index, categoryIds, warnings) => {
  if (!isPlainObject(channel)) {
    warnings.push(`channels[${index}] could not be normalized because it is not an object.`);
    return channel;
  }

  const normalizedChannel = { ...channel };
  const normalizedId = toCleanString(normalizedChannel.id);
  const normalizedKey = toCleanString(normalizedChannel.key);
  const normalizedName = toCleanString(normalizedChannel.name);

  if (!normalizedChannel.id && normalizedKey) {
    normalizedChannel.id = normalizedKey;
    warnings.push(`channels[${index}] used key as id.`);
  } else if (normalizedId) {
    normalizedChannel.id = normalizedId;
  }

  if (!normalizedChannel.key && normalizedId) {
    normalizedChannel.key = normalizedId;
    warnings.push(`channels[${index}] used id as key.`);
  } else if (normalizedKey) {
    normalizedChannel.key = normalizedKey;
  }

  if (normalizedName) {
    normalizedChannel.name = normalizedName;
  }

  if (!normalizedChannel.categoryId && normalizedChannel.category) {
    normalizedChannel.categoryId = toCleanString(normalizedChannel.category);
    warnings.push(`channels[${index}] used category as categoryId.`);
  }

  if (!normalizedChannel.categoryId && categoryIds.length > 0) {
    normalizedChannel.categoryId = categoryIds[0];
    warnings.push(`channels[${index}] was assigned to default category "${categoryIds[0]}".`);
  } else if (normalizedChannel.categoryId) {
    normalizedChannel.categoryId = toCleanString(normalizedChannel.categoryId);
  }

  return normalizedChannel;
};

const normalizeTemplate = (template) => {
  if (!isPlainObject(template)) {
    return {
      ok: false,
      normalizedTemplate: null,
      normalizationWarnings: [],
      code: 'INVALID_TEMPLATE_ROOT',
      message: 'Template root must be an object.',
    };
  }

  const normalizationWarnings = [];
  const normalizedTemplate = { ...template };

  if (normalizedTemplate.description === undefined || normalizedTemplate.description === null) {
    normalizedTemplate.description = '';
    normalizationWarnings.push('description was missing and defaulted to an empty string.');
  } else if (typeof normalizedTemplate.description !== 'string') {
    normalizedTemplate.description = toCleanString(normalizedTemplate.description);
    normalizationWarnings.push('description was converted to a string.');
  }

  if (!Array.isArray(normalizedTemplate.roles)) {
    if (normalizedTemplate.roles === undefined || normalizedTemplate.roles === null) {
      normalizedTemplate.roles = [];
      normalizationWarnings.push('roles was missing and defaulted to an empty array.');
    } else {
      return {
        ok: false,
        normalizedTemplate: null,
        normalizationWarnings,
        code: 'INVALID_ROLES',
        message: 'roles could not be normalized.',
      };
    }
  }

  if (!Array.isArray(normalizedTemplate.categories)) {
    if (normalizedTemplate.categories === undefined || normalizedTemplate.categories === null) {
      normalizedTemplate.categories = [];
      normalizationWarnings.push('categories was missing and defaulted to an empty array.');
    } else {
      return {
        ok: false,
        normalizedTemplate: null,
        normalizationWarnings,
        code: 'INVALID_CATEGORIES',
        message: 'categories could not be normalized.',
      };
    }
  }

  if (!Array.isArray(normalizedTemplate.channels)) {
    if (normalizedTemplate.channels === undefined || normalizedTemplate.channels === null) {
      normalizedTemplate.channels = [];
      normalizationWarnings.push('channels was missing and defaulted to an empty array.');
    } else {
      return {
        ok: false,
        normalizedTemplate: null,
        normalizationWarnings,
        code: 'INVALID_CHANNELS',
        message: 'channels could not be normalized.',
      };
    }
  }

  if (!Array.isArray(normalizedTemplate.welcomeEmbeds)) {
    if (normalizedTemplate.welcomeEmbeds === undefined || normalizedTemplate.welcomeEmbeds === null) {
      normalizedTemplate.welcomeEmbeds = [];
      normalizationWarnings.push('welcomeEmbeds was missing and defaulted to an empty array.');
    } else {
      return {
        ok: false,
        normalizedTemplate: null,
        normalizationWarnings,
        code: 'INVALID_WELCOME_EMBEDS',
        message: 'welcomeEmbeds could not be normalized.',
      };
    }
  }

  if (normalizedTemplate.name !== undefined) {
    const normalizedName = toCleanString(normalizedTemplate.name);

    if (normalizedName) {
      normalizedTemplate.name = normalizedName;
    }
  }

  normalizedTemplate.roles = normalizedTemplate.roles.map((role, index) => normalizeRole(role, index, normalizationWarnings));
  normalizedTemplate.categories = normalizedTemplate.categories.map((category, index) => normalizeCategory(category, index, normalizationWarnings));

  const categoryIds = normalizedTemplate.categories
    .map((category) => toCleanString(category?.id || category?.key))
    .filter(Boolean);

  normalizedTemplate.channels = normalizedTemplate.channels.map((channel, index) => (
    normalizeChannel(channel, index, categoryIds, normalizationWarnings)
  ));

  return {
    ok: true,
    normalizedTemplate,
    normalizationWarnings,
  };
};

module.exports = {
  normalizeTemplate,
};
