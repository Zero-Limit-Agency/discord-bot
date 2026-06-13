const { normalizeTemplate } = require('../templateNormalizer');
const { repairTemplate } = require('../templateRepairService');
const { validateTemplate } = require('../discordTemplateService');
const { supportedPermissions, supportedChannelTypes } = require('../discordTemplateMapper');

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
const MAX_EMBED_TITLE_LENGTH = 256;
const MAX_EMBED_DESCRIPTION_LENGTH = 4000;
const MAX_NOTE_TEXT_LENGTH = 1000;

const normalizePermissionName = (permission) => toCleanString(permission)
  .toLowerCase()
  .replace(/\s+/g, '_');

const filterSupportedPermissions = (permissions, warnings, pathLabel) => {
  const supported = new Set(supportedPermissions);

  return ensureArray(permissions)
    .map(normalizePermissionName)
    .filter(Boolean)
    .filter((permission) => {
      if (supported.has(permission)) {
        return true;
      }

      warnings.push(`${pathLabel} dropped unsupported permission "${permission}".`);
      return false;
    });
};

const createRefLookup = (entities = []) => {
  const lookup = new Map();

  ensureArray(entities)
    .filter(isPlainObject)
    .forEach((entity) => {
      const canonical = toCleanString(entity.id || entity.key || entity.name);

      if (!canonical) {
        return;
      }

      [entity.id, entity.key, entity.name]
        .map(toCleanString)
        .filter(Boolean)
        .forEach((value) => lookup.set(value.toLowerCase(), canonical));
    });

  return lookup;
};

const resolveKnownRef = (value, lookup) => {
  const normalized = toCleanString(value);

  if (!normalized) {
    return '';
  }

  return lookup.get(normalized.toLowerCase()) || normalized;
};

const ensureEntity = (collection, entity, warnings, reason) => {
  const wanted = toCleanString(entity.id || entity.key || entity.name).toLowerCase();

  if (!wanted) {
    return;
  }

  const exists = collection.some((item) => (
    [item?.id, item?.key, item?.name]
      .map((value) => toCleanString(value).toLowerCase())
      .filter(Boolean)
      .includes(wanted)
  ));

  if (exists) {
    return;
  }

  collection.push(entity);
  warnings.push(reason);
};

const findCategoryId = (categories, preferredIds = []) => {
  const loweredPreferredIds = preferredIds.map((value) => toCleanString(value).toLowerCase()).filter(Boolean);
  const exactMatch = categories.find((category) => (
    [category?.id, category?.key, category?.name]
      .map((value) => toCleanString(value).toLowerCase())
      .filter(Boolean)
      .some((value) => loweredPreferredIds.includes(value))
  ));

  return exactMatch?.id || exactMatch?.key || categories[0]?.id || categories[0]?.key || '';
};

const applyArchitectBriefHints = (guarded, context, warnings) => {
  const normalizedBrief = context?.normalizedBrief;

  if (!normalizedBrief) {
    return;
  }

  const requiredAreas = ensureArray(normalizedBrief.requiredAreas);
  const rolesMentioned = ensureArray(normalizedBrief.rolesMentioned);
  const channelsMentioned = ensureArray(normalizedBrief.channelsMentioned);
  const supportHints = ensureArray(normalizedBrief.supportHints);
  const originalPrompt = toCleanString(normalizedBrief.originalPrompt).toLowerCase();
  const hasTournamentHint = /(tournoi|tournament|tryout)/.test(originalPrompt);

  if (requiredAreas.includes('staff-operations') || rolesMentioned.includes('staff')) {
    ensureEntity(guarded.roles, {
      id: 'staff',
      key: 'staff',
      name: 'Staff',
    }, warnings, 'Architect guard added missing staff role from brief hints.');
    ensureEntity(guarded.categories, {
      id: 'staff-operations',
      key: 'staff-operations',
      name: 'Staff Operations',
    }, warnings, 'Architect guard added missing staff category from brief hints.');
  }

  if (requiredAreas.includes('team-operations') || rolesMentioned.includes('player') || normalizedBrief.serverType === 'esports') {
    ensureEntity(guarded.roles, {
      id: 'player',
      key: 'player',
      name: 'Player',
    }, warnings, 'Architect guard added missing player role from brief hints.');
    ensureEntity(guarded.categories, {
      id: 'team-operations',
      key: 'team-operations',
      name: 'Team Operations',
    }, warnings, 'Architect guard added missing team operations category from brief hints.');
  }

  if (requiredAreas.includes('premium-private') || rolesMentioned.includes('premium') || normalizedBrief.serverType === 'premium-community') {
    ensureEntity(guarded.roles, {
      id: 'premium',
      key: 'premium',
      name: 'Premium Member',
    }, warnings, 'Architect guard added missing premium role from brief hints.');
    ensureEntity(guarded.categories, {
      id: 'premium-private',
      key: 'premium-private',
      name: 'Premium Private',
    }, warnings, 'Architect guard added missing premium category from brief hints.');
  }

  if (normalizedBrief.serverType === 'content-creator') {
    ensureEntity(guarded.roles, {
      id: 'creator',
      key: 'creator',
      name: 'Creator',
    }, warnings, 'Architect guard added missing creator role from brief hints.');

    if (requiredAreas.includes('support') || requiredAreas.includes('public-community')) {
      ensureEntity(guarded.roles, {
        id: 'staff',
        key: 'staff',
        name: 'Staff',
      }, warnings, 'Architect guard added missing staff role for managed creator community.');
    }
  }

  if (requiredAreas.includes('onboarding') || channelsMentioned.includes('welcome')) {
    ensureEntity(guarded.channels, {
      id: 'welcome',
      key: 'welcome',
      name: 'welcome',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['information', 'public-community', 'media-announcements']),
    }, warnings, 'Architect guard added missing welcome channel from brief hints.');
  }

  if (requiredAreas.includes('support') || channelsMentioned.includes('support') || supportHints.length) {
    ensureEntity(guarded.categories, {
      id: 'support',
      key: 'support',
      name: 'Support',
    }, warnings, 'Architect guard added missing support category from brief hints.');
    ensureEntity(guarded.channels, {
      id: 'support-chat',
      key: 'support-chat',
      name: 'support-chat',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['support']),
    }, warnings, 'Architect guard added missing support channel from brief hints.');
  }

  if (channelsMentioned.includes('media')) {
    ensureEntity(guarded.categories, {
      id: 'media-announcements',
      key: 'media-announcements',
      name: 'Media & Announcements',
    }, warnings, 'Architect guard added missing media category from brief hints.');
    ensureEntity(guarded.channels, {
      id: 'media-feed',
      key: 'media-feed',
      name: 'media-feed',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['media-announcements']),
    }, warnings, 'Architect guard added missing media channel from brief hints.');
  }

  if (channelsMentioned.includes('announcements')) {
    ensureEntity(guarded.channels, {
      id: 'announcements',
      key: 'announcements',
      name: 'announcements',
      type: 'announcement',
      categoryId: findCategoryId(guarded.categories, ['public-community', 'media-announcements', 'information']),
    }, warnings, 'Architect guard added missing announcements channel from brief hints.');
  }

  if (channelsMentioned.includes('scrims')) {
    ensureEntity(guarded.channels, {
      id: 'scrims',
      key: 'scrims',
      name: 'scrims',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['team-operations']),
    }, warnings, 'Architect guard added missing scrims channel from brief hints.');
  }

  if (hasTournamentHint) {
    ensureEntity(guarded.channels, {
      id: 'tournaments',
      key: 'tournaments',
      name: 'tournaments',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['team-operations']),
    }, warnings, 'Architect guard added missing tournaments channel from brief hints.');
  }
};

const guardArchitectOutput = (output, context = {}) => {
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
        const requestedType = toCleanString(channel.type).toLowerCase();
        const type = supportedChannelTypes.includes(requestedType) ? requestedType : 'text';
        const categoryId = toCleanString(channel.categoryId || channel.category);

        if (!name) {
          errors.push(`channels[${index}] is missing name.`);
        }

        if (!requestedType) {
          warnings.push(`channels[${index}] defaulted missing type to "text".`);
        } else if (!supportedChannelTypes.includes(requestedType)) {
          warnings.push(`channels[${index}] replaced unsupported type "${requestedType}" with "text".`);
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

  applyArchitectBriefHints(guarded, context, warnings);

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

const deriveRolePermissions = ({
  entry,
  roleId,
  warnings,
  pathLabel,
  roleLookup,
  channelLookup,
}) => {
  const rolePermissions = [];
  const generatedOverwrites = [];

  ensureArray(entry.permissions).forEach((permissionEntry, permissionIndex) => {
    if (typeof permissionEntry === 'string') {
      rolePermissions.push(permissionEntry);
      return;
    }

    if (!isPlainObject(permissionEntry)) {
      warnings.push(`${pathLabel}[${permissionIndex}] was dropped because it is not a valid permission entry.`);
      return;
    }

    const target = resolveKnownRef(
      permissionEntry.target
      || permissionEntry.channelId
      || permissionEntry.channelKey
      || permissionEntry.channel
      || permissionEntry.roleId
      || permissionEntry.roleKey
      || permissionEntry.role,
      channelLookup,
    );
    const allow = filterSupportedPermissions(
      permissionEntry.allow || permissionEntry.permissions,
      warnings,
      `${pathLabel}[${permissionIndex}].allow`,
    );
    const deny = filterSupportedPermissions(
      permissionEntry.deny,
      warnings,
      `${pathLabel}[${permissionIndex}].deny`,
    );
    const normalizedTarget = toCleanString(target).toLowerCase();
    const normalizedRoleId = toCleanString(roleId).toLowerCase();

    if (!allow.length && !deny.length) {
      warnings.push(`${pathLabel}[${permissionIndex}] was dropped because it had no supported permissions.`);
      return;
    }

    if (!normalizedTarget || ['@me', '@self', '@everyone', normalizedRoleId].includes(normalizedTarget) || roleLookup.has(normalizedTarget)) {
      rolePermissions.push(...allow);
      warnings.push(`${pathLabel}[${permissionIndex}] object form was normalized into role permissions for "${roleId}".`);
      return;
    }

    if (channelLookup.has(normalizedTarget)) {
      generatedOverwrites.push({
        channelId: channelLookup.get(normalizedTarget),
        permissions: [
          {
            target: roleId,
            allow,
            deny,
          },
        ],
      });
      warnings.push(`${pathLabel}[${permissionIndex}] was converted into a channel overwrite for "${target}".`);
      return;
    }

    warnings.push(`${pathLabel}[${permissionIndex}] was dropped because target "${target}" could not be resolved.`);
  });

  return {
    rolePermissions: Array.from(new Set(rolePermissions)),
    generatedOverwrites,
  };
};

const mergeChannelOverwriteEntries = (entries = []) => {
  const merged = new Map();

  entries.forEach((entry) => {
    const channelId = toCleanString(entry?.channelId);

    if (!channelId) {
      return;
    }

    if (!merged.has(channelId)) {
      merged.set(channelId, {
        channelId,
        permissions: [],
      });
    }

    merged.get(channelId).permissions.push(...ensureArray(entry.permissions));
  });

  return Array.from(merged.values());
};

const guardPermissionsOutput = (output, context = {}) => {
  const errors = [];
  const warnings = [];
  const roleLookup = createRefLookup(context.architecture?.roles);
  const channelLookup = createRefLookup(context.architecture?.channels);

  if (!isPlainObject(output)) {
    return {
      ok: false,
      output: null,
      errors: ['Permissions output must be a JSON object.'],
      warnings,
    };
  }

  const generatedOverwrites = [];
  const rolePermissions = ensureArray(output.rolePermissions)
    .map(normalizePermissionEntry)
    .map((entry, index) => {
      if (!entry) {
        return null;
      }

      const resolvedRoleId = resolveKnownRef(entry.roleId, roleLookup);
      const derivedPermissions = deriveRolePermissions({
        entry,
        roleId: resolvedRoleId,
        warnings,
        pathLabel: `rolePermissions[${index}].permissions`,
        roleLookup,
        channelLookup,
      });
      generatedOverwrites.push(...derivedPermissions.generatedOverwrites);

      return {
        ...entry,
        roleId: resolvedRoleId,
        permissions: derivedPermissions.rolePermissions,
      };
    })
    .filter(Boolean);
  const channelOverwrites = mergeChannelOverwriteEntries([
    ...ensureArray(output.channelOverwrites)
    .map(normalizeOverwriteGroup)
    .map((entry, index) => {
      if (!entry) {
        return null;
      }

      const resolvedChannelId = resolveKnownRef(entry.channelId, channelLookup);

      const permissions = ensureArray(entry.permissions)
        .filter(isPlainObject)
        .map((permission, permissionIndex) => ({
          ...permission,
          target: resolveKnownRef(
            permission.target || permission.roleId || permission.roleKey || permission.role,
            roleLookup,
          ) || '@everyone',
          allow: filterSupportedPermissions(permission.allow, warnings, `channelOverwrites[${index}].permissions[${permissionIndex}].allow`),
          deny: filterSupportedPermissions(permission.deny, warnings, `channelOverwrites[${index}].permissions[${permissionIndex}].deny`),
        }));

      return {
        ...entry,
        channelId: resolvedChannelId,
        permissions,
      };
    })
    .filter(Boolean),
    ...generatedOverwrites,
  ]);

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

const trimToLength = (value, maxLength) => {
  const cleaned = toCleanString(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned.slice(0, maxLength).trim();
};

const collectKnownRefs = (architecture) => {
  const channelRefs = new Set(
    ensureArray(architecture?.channels)
      .flatMap((channel) => [channel?.id, channel?.key, channel?.name])
      .map((value) => toCleanString(value).toLowerCase())
      .filter(Boolean),
  );
  const roleRefs = new Set(
    ensureArray(architecture?.roles)
      .flatMap((role) => [role?.id, role?.key, role?.name])
      .map((value) => toCleanString(value).toLowerCase())
      .filter(Boolean),
  );

  return {
    channelRefs,
    roleRefs,
  };
};

const sanitizeOptionalRef = (value, knownRefs, warnings, pathLabel, refType) => {
  const normalized = toCleanString(value);

  if (!normalized) {
    return null;
  }

  if (!knownRefs.has(normalized.toLowerCase())) {
    warnings.push(`${pathLabel} dropped unknown ${refType} reference "${normalized}".`);
    return null;
  }

  return normalized;
};

const sanitizeSimpleContentItem = (item, index, warnings, knownRefs, collectionName) => {
  if (typeof item === 'string') {
    const text = trimToLength(item, MAX_NOTE_TEXT_LENGTH);

    if (!text) {
      warnings.push(`${collectionName}[${index}] was dropped because it was empty.`);
      return null;
    }

    if (text.length !== toCleanString(item).length) {
      warnings.push(`${collectionName}[${index}] text was truncated.`);
    }

    return { text };
  }

  if (!isPlainObject(item)) {
    warnings.push(`${collectionName}[${index}] was dropped because it is not an object or string.`);
    return null;
  }

  const text = trimToLength(item.text || item.description || item.message || item.note, MAX_NOTE_TEXT_LENGTH);

  if (!text) {
    warnings.push(`${collectionName}[${index}] was dropped because it had no usable text.`);
    return null;
  }

  const sanitized = {
    text,
  };

  const channelId = sanitizeOptionalRef(
    item.channelId || item.channelKey || item.channel || item.targetChannelId,
    knownRefs.channelRefs,
    warnings,
    `${collectionName}[${index}]`,
    'channel',
  );

  if (channelId) {
    sanitized.channelId = channelId;
  }

  const roleId = sanitizeOptionalRef(
    item.roleId || item.roleKey || item.role || item.targetRoleId,
    knownRefs.roleRefs,
    warnings,
    `${collectionName}[${index}]`,
    'role',
  );

  if (roleId) {
    sanitized.roleId = roleId;
  }

  return sanitized;
};

const guardContentOutput = (output, context = {}) => {
  const errors = [];
  const warnings = [];
  const knownRefs = collectKnownRefs(context.architecture);

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
      return { title: trimToLength(embed, MAX_EMBED_TITLE_LENGTH) };
    }

    if (!isPlainObject(embed)) {
      warnings.push(`welcomeEmbeds[${index}] was dropped because it is not a valid embed object.`);
      return null;
    }

    const title = trimToLength(embed.title, MAX_EMBED_TITLE_LENGTH);
    const description = trimToLength(embed.description, MAX_EMBED_DESCRIPTION_LENGTH);

    if (!title && !description) {
      warnings.push(`welcomeEmbeds[${index}] was dropped because it had no usable title or description.`);
      return null;
    }

    if (embed.title && title.length !== toCleanString(embed.title).length) {
      warnings.push(`welcomeEmbeds[${index}].title was truncated.`);
    }

    if (embed.description && description.length !== toCleanString(embed.description).length) {
      warnings.push(`welcomeEmbeds[${index}].description was truncated.`);
    }

    return {
      title: title || undefined,
      description: description || undefined,
      color: embed.color,
    };
  }).filter(Boolean);

  const rules = ensureArray(output.rules)
    .map((item, index) => sanitizeSimpleContentItem(item, index, warnings, knownRefs, 'rules'))
    .filter(Boolean);
  const onboardingNotes = ensureArray(output.onboardingNotes)
    .map((item, index) => sanitizeSimpleContentItem(item, index, warnings, knownRefs, 'onboardingNotes'))
    .filter(Boolean);
  const ticketGuidance = ensureArray(output.ticketGuidance)
    .map((item, index) => sanitizeSimpleContentItem(item, index, warnings, knownRefs, 'ticketGuidance'))
    .filter(Boolean);

  if (!welcomeEmbeds.length && !rules.length && !onboardingNotes.length && !ticketGuidance.length) {
    errors.push('Content output is empty after cleanup.');
  }

  return {
    ok: errors.length === 0,
    output: {
      welcomeEmbeds,
      rules,
      onboardingNotes,
      ticketGuidance,
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
