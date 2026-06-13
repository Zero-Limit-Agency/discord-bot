const { normalizeTemplate } = require('../templateNormalizer');
const { repairTemplate } = require('../templateRepairService');
const { validateTemplate } = require('../discordTemplateService');

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

const slugify = (value, fallback) => {
  const normalized = toCleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const guardArchitectOutput = (output) => {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(output)) {
    return {
      ok: false,
      output: null,
      errors: ['Architect output must be a JSON object.'],
      warnings,
    };
  }

  const guarded = {
    name: toCleanString(output.name),
    description: toCleanString(output.description),
    purpose: toCleanString(output.purpose),
    notes: ensureArray(output.notes),
    roles: ensureArray(output.roles)
      .filter(isPlainObject)
      .map((role, index) => {
        const name = toCleanString(role.name);
        const id = toCleanString(role.id || role.key) || slugify(name, `role-${index + 1}`);

        if (!name) {
          errors.push(`roles[${index}] is missing name.`);
        }

        return {
          ...role,
          id,
          key: id,
          name,
        };
      }),
    categories: ensureArray(output.categories)
      .filter(isPlainObject)
      .map((category, index) => {
        const name = toCleanString(category.name);
        const id = toCleanString(category.id || category.key) || slugify(name, `category-${index + 1}`);

        if (!name) {
          errors.push(`categories[${index}] is missing name.`);
        }

        return {
          ...category,
          id,
          key: id,
          name,
        };
      }),
    channels: ensureArray(output.channels)
      .filter(isPlainObject)
      .map((channel, index) => {
        const name = toCleanString(channel.name);
        const id = toCleanString(channel.id || channel.key) || slugify(name, `channel-${index + 1}`);
        const type = toCleanString(channel.type) || 'text';
        const categoryId = toCleanString(channel.categoryId || channel.category);

        if (!name) {
          errors.push(`channels[${index}] is missing name.`);
        }

        if (!toCleanString(channel.type)) {
          warnings.push(`channels[${index}] defaulted missing type to "text".`);
        }

        return {
          ...channel,
          id,
          key: id,
          name,
          type,
          ...(categoryId ? { categoryId } : {}),
        };
      }),
  };

  if (!guarded.name) {
    errors.push('Architect output is missing server name.');
  }

  return {
    ok: errors.length === 0,
    output: guarded,
    errors,
    warnings,
  };
};

const normalizePermissionEntry = (entry) => {
  if (!isPlainObject(entry)) {
    return null;
  }

  return {
    ...entry,
    roleId: toCleanString(entry.roleId || entry.roleKey || entry.role || entry.target),
    permissions: Array.isArray(entry.permissions)
      ? entry.permissions
      : Array.isArray(entry.allow)
        ? entry.allow
        : typeof entry.permissions === 'string'
          ? [entry.permissions]
          : typeof entry.allow === 'string'
            ? [entry.allow]
            : [],
  };
};

const normalizeOverwriteGroup = (entry) => {
  if (!isPlainObject(entry)) {
    return null;
  }

  const channelId = toCleanString(
    entry.channelId
    || entry.channelKey
    || entry.channel
    || entry.channelName
    || entry.targetChannelId
    || entry.targetChannelKey
    || entry.targetChannelName,
  );

  let permissions = [];

  if (Array.isArray(entry.permissions)) {
    permissions = entry.permissions;
  } else if (typeof entry.permissions === 'string') {
    permissions = [entry.permissions];
  } else {
    permissions = [entry];
  }

  return {
    channelId,
    permissions,
  };
};

const guardPermissionsOutput = (output) => {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(output)) {
    return {
      ok: false,
      output: null,
      errors: ['Permissions output must be a JSON object.'],
      warnings,
    };
  }

  const rolePermissions = ensureArray(output.rolePermissions)
    .map(normalizePermissionEntry)
    .filter(Boolean);
  const channelOverwrites = ensureArray(output.channelOverwrites)
    .map(normalizeOverwriteGroup)
    .filter(Boolean);

  rolePermissions.forEach((entry, index) => {
    if (!entry.roleId) {
      errors.push(`rolePermissions[${index}] is missing roleId/roleKey/target.`);
    }
  });

  channelOverwrites.forEach((entry, index) => {
    if (!entry.channelId) {
      errors.push(`channelOverwrites[${index}] is missing channel reference.`);
    }

    if (!Array.isArray(entry.permissions)) {
      errors.push(`channelOverwrites[${index}].permissions must be an array.`);
    }
  });

  return {
    ok: errors.length === 0,
    output: {
      rolePermissions,
      channelOverwrites,
      permissionNotes: ensureArray(output.permissionNotes),
    },
    errors,
    warnings,
  };
};

const guardContentOutput = (output) => {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(output)) {
    return {
      ok: false,
      output: null,
      errors: ['Content output must be a JSON object.'],
      warnings,
    };
  }

  const welcomeEmbeds = ensureArray(output.welcomeEmbeds).map((embed, index) => {
    if (typeof embed === 'string' && embed.trim()) {
      warnings.push(`welcomeEmbeds[${index}] string was converted to a title-only embed.`);
      return { title: embed.trim() };
    }

    return embed;
  });

  return {
    ok: errors.length === 0,
    output: {
      welcomeEmbeds,
      rules: ensureArray(output.rules),
      onboardingNotes: ensureArray(output.onboardingNotes),
      ticketGuidance: ensureArray(output.ticketGuidance),
    },
    errors,
    warnings,
  };
};

const guardFinalTemplate = (template) => {
  const normalized = normalizeTemplate(template);

  if (!normalized.ok) {
    return {
      ok: false,
      output: template,
      errors: [normalized.message],
      warnings: normalized.normalizationWarnings,
    };
  }

  const repaired = repairTemplate(normalized.normalizedTemplate);
  const validation = validateTemplate(repaired.ok ? repaired.repairedTemplate : normalized.normalizedTemplate);

  return {
    ok: validation.isValid,
    output: repaired.ok ? repaired.repairedTemplate : normalized.normalizedTemplate,
    errors: validation.errors,
    warnings: [
      ...normalized.normalizationWarnings,
      ...(repaired.repairWarnings || []),
      ...validation.warnings,
    ],
  };
};

module.exports = {
  guardArchitectOutput,
  guardPermissionsOutput,
  guardContentOutput,
  guardFinalTemplate,
};
