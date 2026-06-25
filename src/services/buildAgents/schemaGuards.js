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

const hasSemanticEntity = (collection, regex) => ensureArray(collection).some((item) => (
  [item?.id, item?.key, item?.name]
    .map(toCleanString)
    .filter(Boolean)
    .some((value) => regex.test(value.toLowerCase()))
));

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
  const hasVipHint = /\bvip\b/.test(originalPrompt);

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

    if (!hasSemanticEntity(guarded.categories, /(player|roster)/)) {
      ensureEntity(guarded.categories, {
        id: 'player-zone',
        key: 'player-zone',
        name: 'Player Zone',
      }, warnings, 'Architect guard added missing player category from brief hints.');
    } else {
      ensureEntity(guarded.categories, {
        id: 'team-operations',
        key: 'team-operations',
        name: 'Team Operations',
      }, warnings, 'Architect guard added missing team operations category from brief hints.');
    }
  }

  if ((requiredAreas.includes('premium-private') || rolesMentioned.includes('premium') || normalizedBrief.serverType === 'premium-community')
    && !hasSemanticEntity(guarded.roles, /(premium|vip)/)) {
    ensureEntity(guarded.roles, {
      id: 'premium',
      key: 'premium',
      name: 'Premium Member',
    }, warnings, 'Architect guard added missing premium role from brief hints.');
  }

  if (requiredAreas.includes('premium-private') || rolesMentioned.includes('premium') || normalizedBrief.serverType === 'premium-community') {
    ensureEntity(guarded.categories, {
      id: 'premium-private',
      key: 'premium-private',
      name: hasVipHint ? 'VIP Private' : 'Premium Private',
    }, warnings, 'Architect guard added missing premium category from brief hints.');
  }

  if (hasVipHint && !hasSemanticEntity(guarded.roles, /\bvip\b/)) {
    ensureEntity(guarded.roles, {
      id: 'vip-member',
      key: 'vip-member',
      name: 'VIP Member',
    }, warnings, 'Architect guard added missing VIP role from brief hints.');
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

    if (!hasSemanticEntity(guarded.categories, /(content|creator)/)) {
      ensureEntity(guarded.categories, {
        id: 'content-studio',
        key: 'content-studio',
        name: 'Content Studio',
      }, warnings, 'Architect guard added missing content category for creator brief.');
    }

    if (!hasSemanticEntity(guarded.categories, /(community|public|discussion)/)) {
      ensureEntity(guarded.categories, {
        id: 'community-lounge',
        key: 'community-lounge',
        name: 'Community Lounge',
      }, warnings, 'Architect guard added missing community category for creator brief.');
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
      categoryId: findCategoryId(guarded.categories, ['player-zone', 'team-operations']),
    }, warnings, 'Architect guard added missing scrims channel from brief hints.');
  }

  if (hasTournamentHint) {
    ensureEntity(guarded.channels, {
      id: 'tournaments',
      key: 'tournaments',
      name: 'tournaments',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['player-zone', 'team-operations']),
    }, warnings, 'Architect guard added missing tournaments channel from brief hints.');
  }

  if (normalizedBrief.serverType === 'content-creator' && !hasSemanticEntity(guarded.channels, /(content|creator|media)/)) {
    ensureEntity(guarded.channels, {
      id: 'content-feed',
      key: 'content-feed',
      name: 'content-feed',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['content-studio', 'media-announcements']),
    }, warnings, 'Architect guard added missing content channel for creator brief.');
  }

  if (normalizedBrief.serverType === 'content-creator' && !hasSemanticEntity(guarded.channels, /(community|discussion|general)/)) {
    ensureEntity(guarded.channels, {
      id: 'community-chat',
      key: 'community-chat',
      name: 'community-chat',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['community-lounge', 'public-community']),
    }, warnings, 'Architect guard added missing community chat for creator brief.');
  }

  if (hasVipHint && !hasSemanticEntity(guarded.channels, /\bvip\b/)) {
    ensureEntity(guarded.channels, {
      id: 'vip-lounge',
      key: 'vip-lounge',
      name: 'vip-lounge',
      type: 'text',
      categoryId: findCategoryId(guarded.categories, ['premium-private']),
    }, warnings, 'Architect guard added missing VIP channel from brief hints.');
  }

  const playerCategoryId = findCategoryId(guarded.categories, ['player-zone']);

  guarded.channels = guarded.channels.map((channel) => {
    const channelText = [channel.id, channel.key, channel.name]
      .map(toCleanString)
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (playerCategoryId && /(player|roster|scrim|tournament|tryout)/.test(channelText)) {
      return {
        ...channel,
        categoryId: playerCategoryId,
      };
    }

    if (normalizedBrief.serverType === 'content-creator' && /(media|creator|content)/.test(channelText)) {
      return {
        ...channel,
        categoryId: findCategoryId(guarded.categories, ['content-studio', 'media-announcements']) || channel.categoryId,
      };
    }

    if (normalizedBrief.serverType === 'content-creator' && /(community|general|discussion)/.test(channelText)) {
      return {
        ...channel,
        categoryId: findCategoryId(guarded.categories, ['community-lounge', 'public-community']) || channel.categoryId,
      };
    }

    return channel;
  });
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
  const roleLevelBlockedPermissions = new Set(['connect', 'speak']);

  ensureArray(entry.permissions).forEach((permissionEntry, permissionIndex) => {
    if (typeof permissionEntry === 'string') {
      const normalizedPermission = normalizePermissionName(permissionEntry);

      if (!normalizedPermission) {
        return;
      }

      if (roleLevelBlockedPermissions.has(normalizedPermission)) {
        warnings.push(`__DROP_ROLE_VOICE_PERMISSION__|${pathLabel}|${roleId}|${normalizedPermission}`);
        return;
      }

      rolePermissions.push(normalizedPermission);
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
      const safeRolePermissions = allow.filter((permission) => {
        if (!roleLevelBlockedPermissions.has(permission)) {
          return true;
        }

        warnings.push(`__DROP_ROLE_VOICE_PERMISSION__|${pathLabel}|${roleId}|${permission}`);
        return false;
      });

      rolePermissions.push(...safeRolePermissions);
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

const coalescePermissionWarnings = (warnings = []) => {
  const groupedDrops = new Map();
  const passthrough = [];

  warnings.forEach((warning) => {
    const text = String(warning || '');

    if (!text.startsWith('__DROP_ROLE_VOICE_PERMISSION__|')) {
      passthrough.push(text);
      return;
    }

    const [, pathLabel, roleId, permission] = text.split('|');
    const key = `${pathLabel}|${roleId}`;

    if (!groupedDrops.has(key)) {
      groupedDrops.set(key, {
        pathLabel,
        roleId,
        permissions: new Set(),
      });
    }

    groupedDrops.get(key).permissions.add(permission);
  });

  groupedDrops.forEach(({ pathLabel, roleId, permissions }) => {
    passthrough.push(`${pathLabel} dropped voice permissions "${Array.from(permissions).join(', ')}" from role-level permissions for "${roleId}".`);
  });

  return passthrough;
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

const createChannelTypeLookup = (channels = []) => {
  const lookup = new Map();

  ensureArray(channels)
    .filter(isPlainObject)
    .forEach((channel) => {
      const type = toCleanString(channel.type).toLowerCase();
      [channel.id, channel.key, channel.name]
        .map(toCleanString)
        .filter(Boolean)
        .forEach((value) => lookup.set(value.toLowerCase(), type));
    });

  return lookup;
};

const filterVoicePermissionsForChannel = (permissions, warnings, pathLabel, channelType) => {
  const voicePermissions = new Set(['connect', 'speak']);
  const effectiveChannelType = toCleanString(channelType).toLowerCase();

  return ensureArray(permissions).filter((permission) => {
    if (!voicePermissions.has(permission)) {
      return true;
    }

    if (effectiveChannelType === 'voice') {
      return true;
    }

    warnings.push(`${pathLabel} dropped voice permission "${permission}" on non-voice channel.`);
    return false;
  });
};

const guardPermissionsOutput = (output, context = {}) => {
  const errors = [];
  const warnings = [];
  const roleLookup = createRefLookup(context.architecture?.roles);
  const channelLookup = createRefLookup(context.architecture?.channels);
  const channelTypeLookup = createChannelTypeLookup(context.architecture?.channels);

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
      const channelType = channelTypeLookup.get(toCleanString(resolvedChannelId).toLowerCase()) || '';

      const permissions = ensureArray(entry.permissions)
        .filter(isPlainObject)
        .map((permission, permissionIndex) => ({
          ...permission,
          target: resolveKnownRef(
            permission.target || permission.roleId || permission.roleKey || permission.role,
            roleLookup,
          ) || '@everyone',
          allow: filterVoicePermissionsForChannel(
            filterSupportedPermissions(permission.allow, warnings, `channelOverwrites[${index}].permissions[${permissionIndex}].allow`),
            warnings,
            `channelOverwrites[${index}].permissions[${permissionIndex}].allow`,
            channelType,
          ),
          deny: filterVoicePermissionsForChannel(
            filterSupportedPermissions(permission.deny, warnings, `channelOverwrites[${index}].permissions[${permissionIndex}].deny`),
            warnings,
            `channelOverwrites[${index}].permissions[${permissionIndex}].deny`,
            channelType,
          ),
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
    warnings: coalescePermissionWarnings(warnings),
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

const findArchitectureChannel = (architecture, matcher) => ensureArray(architecture?.channels)
  .find((channel) => matcher([
    channel?.id,
    channel?.key,
    channel?.name,
    channel?.topic,
  ].map(toCleanString).filter(Boolean).join(' ').toLowerCase()));

const getChannelLabel = (channel) => toCleanString(channel?.name || channel?.id || channel?.key);

const isGenericContentText = (value) => /read the rules|merci de lire les r[eè]gles|lisez les r[eè]gles|use the appropriate channels|utilisez les canaux appropri[eé]s|d'utiliser les canaux appropri[eé]s|commencez par lire les r[eè]gles/i
  .test(toCleanString(value).toLowerCase());

const pushContentItemIfMissing = (collection, item, warnings, reason) => {
  if (!item || !toCleanString(item.text || item.description || item.title)) {
    return;
  }

  const normalizedText = toCleanString(item.text || item.description || item.title).toLowerCase();
  const exists = collection.some((entry) => (
    toCleanString(entry?.text || entry?.description || entry?.title).toLowerCase() === normalizedText
  ));

  if (exists) {
    return;
  }

  collection.push(item);
  warnings.push(reason);
};

const enrichContentOutput = ({ content, context, warnings }) => {
  const architecture = context?.architecture || {};
  const normalizedBrief = context?.normalizedBrief || null;
  const serverType = normalizedBrief?.serverType || 'general';
  const tone = normalizedBrief?.tone || 'professional';
  const welcomeChannel = findArchitectureChannel(architecture, (value) => /(welcome|bienvenue|start)/.test(value));
  const rulesChannel = findArchitectureChannel(architecture, (value) => /(rules|regles|r[eè]gles)/.test(value));
  const announcementsChannel = findArchitectureChannel(architecture, (value) => /(announcement|annonce)/.test(value));
  const supportChannel = findArchitectureChannel(architecture, (value) => /(support|help)/.test(value));
  const ticketChannel = findArchitectureChannel(architecture, (value) => /(ticket)/.test(value));
  const scrimChannel = findArchitectureChannel(architecture, (value) => /(scrim|tournament|tournoi|tryout|player|team)/.test(value));
  const premiumChannel = findArchitectureChannel(architecture, (value) => /(premium|vip)/.test(value));
  const mediaChannel = findArchitectureChannel(architecture, (value) => /(media|m[eé]dia|content|creator|partnership)/.test(value));

  const hasGenericWelcomeOnly = content.welcomeEmbeds.length === 1
    && isGenericContentText(content.welcomeEmbeds[0]?.description);

  if (content.welcomeEmbeds.length === 0) {
    const baseTitle = serverType === 'premium-community'
      ? 'Welcome to Your Premium Space'
      : serverType === 'content-creator'
        ? 'Welcome to the Creator Hub'
        : serverType === 'esports'
          ? 'Welcome to the Team Hub'
          : 'Welcome';
    const baseDescription = [
      welcomeChannel ? `Start in ${getChannelLabel(welcomeChannel)}.` : null,
      announcementsChannel ? `Check ${getChannelLabel(announcementsChannel)} for important updates.` : null,
      supportChannel ? `Use ${getChannelLabel(supportChannel)} if you need help.` : null,
    ].filter(Boolean).join(' ');

    pushContentItemIfMissing(content.welcomeEmbeds, {
      title: baseTitle,
      description: baseDescription || 'Start with the key information channels and follow the onboarding flow.',
    }, warnings, 'Content guard added a fallback welcome embed.');
  }

  if (hasGenericWelcomeOnly) {
    let contextualDescription = '';

    if (serverType === 'esports') {
      contextualDescription = [
        announcementsChannel ? `Watch ${getChannelLabel(announcementsChannel)} for official updates.` : null,
        scrimChannel ? `Use ${getChannelLabel(scrimChannel)} for team coordination and competitive prep.` : null,
        supportChannel ? `Contact staff via ${getChannelLabel(supportChannel)} if you need help.` : null,
      ].filter(Boolean).join(' ');
    } else if (serverType === 'content-creator') {
      contextualDescription = [
        announcementsChannel ? `Follow ${getChannelLabel(announcementsChannel)} for releases and live updates.` : null,
        mediaChannel ? `Share or review creator activity in ${getChannelLabel(mediaChannel)}.` : null,
        supportChannel ? `Use ${getChannelLabel(supportChannel)} for member support or moderation help.` : null,
      ].filter(Boolean).join(' ');
    } else if (serverType === 'premium-community') {
      contextualDescription = [
        premiumChannel ? `Premium members should check ${getChannelLabel(premiumChannel)} for private access.` : null,
        ticketChannel ? `Open requests through ${getChannelLabel(ticketChannel)} when support is needed.` : null,
        supportChannel ? `Use ${getChannelLabel(supportChannel)} for member assistance.` : null,
      ].filter(Boolean).join(' ');
    }

    if (contextualDescription) {
      pushContentItemIfMissing(content.welcomeEmbeds, {
        title: tone === 'premium' ? 'Member Access & Next Steps' : 'How To Use This Server',
        description: contextualDescription,
      }, warnings, 'Content guard added a contextual welcome embed.');
    }
  }

  if (content.rules.length === 0) {
    const rulesText = tone === 'premium'
      ? 'Keep conversations clear, respectful, and aligned with the premium standard of the server.'
      : serverType === 'esports'
        ? 'Use the right channels, keep competitive coordination focused, and follow staff guidance during team operations.'
        : serverType === 'content-creator'
          ? 'Keep discussions constructive, publish in the right channels, and respect staff or creator directions.'
          : 'Use the correct channels, stay respectful, and follow staff guidance.';

    pushContentItemIfMissing(content.rules, {
      channelId: rulesChannel ? rulesChannel.id || rulesChannel.key : (welcomeChannel ? welcomeChannel.id || welcomeChannel.key : undefined),
      text: rulesText,
    }, warnings, 'Content guard added fallback rule guidance.');
  }

  if (content.onboardingNotes.length === 0 || content.onboardingNotes.every((note) => isGenericContentText(note?.text))) {
    const onboardingText = [
      welcomeChannel ? `Start in ${getChannelLabel(welcomeChannel)}.` : null,
      announcementsChannel ? `Then review ${getChannelLabel(announcementsChannel)} for updates.` : null,
      supportChannel ? `If anything is unclear, ask in ${getChannelLabel(supportChannel)}.` : null,
      premiumChannel && serverType === 'premium-community' ? `Premium access details are available in ${getChannelLabel(premiumChannel)}.` : null,
    ].filter(Boolean).join(' ');

    pushContentItemIfMissing(content.onboardingNotes, {
      channelId: (welcomeChannel?.id || welcomeChannel?.key || announcementsChannel?.id || announcementsChannel?.key || ''),
      text: onboardingText || 'Start with the welcome information and follow the main community channels.',
    }, warnings, 'Content guard added fallback onboarding guidance.');
  }

  if (content.ticketGuidance.length === 0 && (supportChannel || ticketChannel)) {
    const targetChannel = ticketChannel || supportChannel;
    const ticketText = ticketChannel
      ? `Use ${getChannelLabel(ticketChannel)} for structured support requests and keep issue details concise.`
      : `Use ${getChannelLabel(supportChannel)} for help requests and provide clear context when contacting staff.`;

    pushContentItemIfMissing(content.ticketGuidance, {
      channelId: targetChannel?.id || targetChannel?.key || '',
      text: ticketText,
    }, warnings, 'Content guard added fallback support guidance.');
  }
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

  const guardedContent = {
    welcomeEmbeds,
    rules,
    onboardingNotes,
    ticketGuidance,
  };

  enrichContentOutput({
    content: guardedContent,
    context,
    warnings,
  });

  if (!guardedContent.welcomeEmbeds.length && !guardedContent.rules.length && !guardedContent.onboardingNotes.length && !guardedContent.ticketGuidance.length) {
    errors.push('Content output is empty after cleanup.');
  }

  return {
    ok: errors.length === 0,
    output: guardedContent,
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
