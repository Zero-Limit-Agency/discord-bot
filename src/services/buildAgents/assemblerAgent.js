const cloneArray = (value) => (Array.isArray(value) ? value.map((item) => ({ ...(item || {}) })) : []);

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeIdentifier = (value) => String(value || '').trim().toLowerCase();

const slugify = (value, fallback) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
};

const findMatchingChannelIndex = (channels, overwrite) => {
  const candidates = [
    overwrite?.channelId,
    overwrite?.channelKey,
    overwrite?.channelName,
    overwrite?.channel,
    overwrite?.targetChannelId,
    overwrite?.targetChannelKey,
    overwrite?.targetChannelName,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);

  if (!candidates.length) {
    return -1;
  }

  return channels.findIndex((channel) => {
    const channelCandidates = [
      channel?.id,
      channel?.key,
      channel?.name,
    ]
      .map(normalizeIdentifier)
      .filter(Boolean);

    return candidates.some((candidate) => channelCandidates.includes(candidate));
  });
};

const normalizeOverwrite = (overwrite) => {
  if (!overwrite || typeof overwrite !== 'object') {
    return null;
  }

  const target = overwrite.target
    || overwrite.roleId
    || overwrite.roleKey
    || overwrite.role
    || overwrite.targetRoleId
    || overwrite.targetRoleKey
    || '@everyone';

  const allow = safeArray(overwrite.allow);
  const deny = safeArray(overwrite.deny);

  return {
    target,
    allow,
    deny,
  };
};

const applyChannelOverwrites = (channels, channelOverwrites, roleRefs, warnings) => {
  safeArray(channelOverwrites).forEach((overwriteEntry) => {
    const channelIndex = findMatchingChannelIndex(channels, overwriteEntry);

    if (channelIndex === -1) {
      warnings.push('Skipped channel overwrite because no matching channel was found.');
      return;
    }

    const normalizedPermissions = Array.isArray(overwriteEntry?.permissions)
      ? overwriteEntry.permissions
          .map(normalizeOverwrite)
          .filter(Boolean)
      : [normalizeOverwrite(overwriteEntry)].filter(Boolean);

    if (!normalizedPermissions.length) {
      warnings.push(`Skipped empty overwrite block for channel "${channels[channelIndex].id || channels[channelIndex].key || channels[channelIndex].name}".`);
      return;
    }

    const filteredPermissions = normalizedPermissions.filter((permission) => {
      if (permission.target === '@everyone') {
        return true;
      }

      if (!roleRefs.has(normalizeIdentifier(permission.target))) {
        warnings.push(`Dropped overwrite targeting missing role "${permission.target}" on channel "${channels[channelIndex].id || channels[channelIndex].key || channels[channelIndex].name}".`);
        return false;
      }

      return true;
    });

    if (!filteredPermissions.length) {
      filteredPermissions.push({
        target: '@everyone',
        allow: [],
        deny: [],
      });
      warnings.push(`Inserted fallback @everyone overwrite on channel "${channels[channelIndex].id || channels[channelIndex].key || channels[channelIndex].name}".`);
    }

    const existingPermissions = safeArray(channels[channelIndex].permissions);
    channels[channelIndex].permissions = existingPermissions.concat(filteredPermissions);
  });
};

const findMatchingRoleIndex = (roles, rolePermission) => {
  const candidates = [
    rolePermission?.roleId,
    rolePermission?.roleKey,
    rolePermission?.roleName,
    rolePermission?.role,
    rolePermission?.target,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);

  if (!candidates.length) {
    return -1;
  }

  return roles.findIndex((role) => {
    const roleCandidates = [
      role?.id,
      role?.key,
      role?.name,
    ]
      .map(normalizeIdentifier)
      .filter(Boolean);

    return candidates.some((candidate) => roleCandidates.includes(candidate));
  });
};

const normalizeRolePermissions = (rolePermission) => {
  if (!rolePermission || typeof rolePermission !== 'object') {
    return [];
  }

  if (Array.isArray(rolePermission.permissions)) {
    return rolePermission.permissions;
  }

  if (typeof rolePermission.permissions === 'string') {
    return [rolePermission.permissions];
  }

  if (Array.isArray(rolePermission.allow)) {
    return rolePermission.allow;
  }

  if (typeof rolePermission.allow === 'string') {
    return [rolePermission.allow];
  }

  return [];
};

const applyRolePermissions = (roles, rolePermissions) => {
  safeArray(rolePermissions).forEach((rolePermission) => {
    const roleIndex = findMatchingRoleIndex(roles, rolePermission);

    if (roleIndex === -1) {
      return;
    }

    roles[roleIndex].permissions = normalizeRolePermissions(rolePermission);
  });
};

const ensureCategoryAssignments = (channels, categories, warnings) => {
  const categoryRefs = new Set(categories.map((category) => normalizeIdentifier(category.id || category.key || category.name)).filter(Boolean));
  const defaultCategoryId = categories[0]?.id || categories[0]?.key || null;

  channels.forEach((channel, index) => {
    const currentCategoryId = channel.categoryId || channel.category;

    if (currentCategoryId && categoryRefs.has(normalizeIdentifier(currentCategoryId))) {
      channel.categoryId = currentCategoryId;
      return;
    }

    if (currentCategoryId && !categoryRefs.has(normalizeIdentifier(currentCategoryId))) {
      warnings.push(`channels[${index}] referenced missing category "${currentCategoryId}".`);
    }

    if (defaultCategoryId) {
      channel.categoryId = defaultCategoryId;
      warnings.push(`channels[${index}] defaulted missing categoryId to "${defaultCategoryId}".`);
    }
  });
};

const normalizeRoleRefs = (roles) => new Set(
  roles.flatMap((role) => [role.id, role.key, role.name]).map(normalizeIdentifier).filter(Boolean),
);

const getRoleSpecificityScore = (role) => {
  const permissionsCount = safeArray(role?.permissions).length;
  const mentionableScore = role?.mentionable ? 1 : 0;
  const hoistScore = role?.hoist ? 1 : 0;

  return permissionsCount + mentionableScore + hoistScore;
};

const dedupeRoles = (roles, warnings) => {
  const deduped = [];
  const roleIndexByName = new Map();

  safeArray(roles).forEach((role) => {
    const normalizedName = normalizeIdentifier(role?.name);

    if (!normalizedName) {
      deduped.push(role);
      return;
    }

    if (!roleIndexByName.has(normalizedName)) {
      roleIndexByName.set(normalizedName, deduped.length);
      deduped.push(role);
      return;
    }

    const existingRoleIndex = roleIndexByName.get(normalizedName);
    const existingRole = deduped[existingRoleIndex];
    const keepIncoming = getRoleSpecificityScore(role) > getRoleSpecificityScore(existingRole);

    if (keepIncoming) {
      deduped[existingRoleIndex] = {
        ...existingRole,
        ...role,
        permissions: safeArray(role.permissions).length ? role.permissions : existingRole.permissions,
      };
    }

    warnings.push(`Assembler deduplicated role "${role.name}".`);
  });

  return deduped;
};

const createCategoryLookup = (categories) => new Map(
  categories.map((category) => [
    normalizeIdentifier(category.id || category.key || category.name),
    category,
  ]).filter(([key]) => key),
);

const getChannelContextText = (channel, categoryLookup) => {
  const category = categoryLookup.get(normalizeIdentifier(channel.categoryId));

  return [
    channel?.id,
    channel?.key,
    channel?.name,
    category?.id,
    category?.key,
    category?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const getExpectedAccessRole = (contextText, roles) => {
  const roleIds = new Set(roles.map((role) => normalizeIdentifier(role.id || role.key || role.name)).filter(Boolean));

  if (/staff|admin|mod/.test(contextText) && roleIds.has('staff')) {
    return 'staff';
  }

  if (/(vip|premium)/.test(contextText)) {
    if (roleIds.has('premium')) {
      return 'premium';
    }

    if (roleIds.has('vip')) {
      return 'vip';
    }
  }

  if (/(player|team|scrim|tournament|tryout)/.test(contextText) && roleIds.has('player')) {
    return 'player';
  }

  if (/(creator|media|content)/.test(contextText) && roleIds.has('creator')) {
    return 'creator';
  }

  return '';
};

const getSuggestedAllowPermissions = (channel, roleId, contextText) => {
  if (channel.type === 'voice') {
    return roleId === 'staff'
      ? ['view_channel', 'connect', 'speak']
      : ['view_channel', 'connect', 'speak'];
  }

  if (roleId === 'staff') {
    if (/(support|ticket)/.test(contextText)) {
      return ['view_channel', 'send_messages', 'read_message_history', 'manage_messages'];
    }

    return ['view_channel', 'send_messages', 'read_message_history', 'manage_messages'];
  }

  return ['view_channel', 'send_messages', 'read_message_history'];
};

const ensureInferredPrivateOverwrites = (channels, categories, roles, warnings) => {
  const categoryLookup = createCategoryLookup(categories);

  channels.forEach((channel) => {
    const contextText = getChannelContextText(channel, categoryLookup);
    const expectedRole = getExpectedAccessRole(contextText, roles);

    if (!expectedRole) {
      return;
    }

    const existingPermissions = safeArray(channel.permissions);
    const deniesEveryone = existingPermissions.some((permission) => (
      normalizeIdentifier(permission.target) === '@everyone'
      && (safeArray(permission.deny).includes('view_channel') || safeArray(permission.deny).includes('connect'))
    ));
    const canInferPrivateAccess = expectedRole !== 'creator'
      && /(staff|admin|mod|vip|premium|private|player|team|roster|scrim|tournament|tryout)/.test(contextText);

    if (canInferPrivateAccess && !deniesEveryone) {
      const deny = channel.type === 'voice'
        ? ['view_channel', 'connect']
        : ['view_channel'];
      channel.permissions = existingPermissions.concat([{
        target: '@everyone',
        allow: [],
        deny,
      }]);
      warnings.push(`Assembler protected inferred private channel "${channel.id || channel.key || channel.name}" from @everyone.`);
    }

    const effectivePermissions = safeArray(channel.permissions);
    const effectiveDeniesEveryone = effectivePermissions.some((permission) => (
      normalizeIdentifier(permission.target) === '@everyone'
      && (safeArray(permission.deny).includes('view_channel') || safeArray(permission.deny).includes('connect'))
    ));
    const effectiveExpectedRoleAllowed = effectivePermissions.some((permission) => (
      normalizeIdentifier(permission.target) === expectedRole
      && safeArray(permission.allow).length
    ));

    if (effectiveDeniesEveryone && !effectiveExpectedRoleAllowed) {
      channel.permissions = effectivePermissions.concat([{
        target: expectedRole,
        allow: getSuggestedAllowPermissions(channel, expectedRole, contextText),
        deny: [],
      }]);
      warnings.push(`Assembler inferred missing "${expectedRole}" access overwrite for channel "${channel.id || channel.key || channel.name}".`);
    }

    if (/(support|ticket)/.test(contextText) && roles.some((role) => normalizeIdentifier(role.id || role.key || role.name) === 'staff')) {
      const staffHasAccess = safeArray(channel.permissions).some((permission) => (
        normalizeIdentifier(permission.target) === 'staff'
        && safeArray(permission.allow).includes('send_messages')
      ));

      if (!staffHasAccess) {
        channel.permissions = safeArray(channel.permissions).concat([{
          target: 'staff',
          allow: ['view_channel', 'send_messages', 'read_message_history', 'manage_messages'],
          deny: [],
        }]);
        warnings.push(`Assembler inferred missing staff support access on channel "${channel.id || channel.key || channel.name}".`);
      }
    }
  });
};

const assembleTemplateLocally = ({
  architecture,
  permissions,
  content,
}) => {
  const roles = cloneArray(architecture?.roles);
  const categories = cloneArray(architecture?.categories);
  const channels = cloneArray(architecture?.channels);
  const welcomeEmbeds = cloneArray(content?.welcomeEmbeds);
  const rules = cloneArray(content?.rules);
  const onboardingNotes = cloneArray(content?.onboardingNotes);
  const ticketGuidance = cloneArray(content?.ticketGuidance);
  const warnings = [];

  roles.forEach((role, index) => {
    const id = role.id || role.key || slugify(role.name, `role-${index + 1}`);
    role.id = id;
    role.key = role.key || id;
  });

  const dedupedRoles = dedupeRoles(roles, warnings);

  categories.forEach((category, index) => {
    const id = category.id || category.key || slugify(category.name, `category-${index + 1}`);
    category.id = id;
    category.key = category.key || id;
  });

  channels.forEach((channel, index) => {
    const id = channel.id || channel.key || slugify(channel.name, `channel-${index + 1}`);
    channel.id = id;
    channel.key = channel.key || id;
    channel.type = channel.type || 'text';
  });

  applyRolePermissions(dedupedRoles, permissions?.rolePermissions);
  ensureCategoryAssignments(channels, categories, warnings);
  applyChannelOverwrites(channels, permissions?.channelOverwrites, normalizeRoleRefs(dedupedRoles), warnings);
  ensureInferredPrivateOverwrites(channels, categories, dedupedRoles, warnings);

  return {
    template: {
      name: architecture?.name || '',
      description: architecture?.description || '',
      roles: dedupedRoles,
      categories,
      channels,
      welcomeEmbeds,
      rules,
      onboardingNotes,
      ticketGuidance,
    },
    warnings,
  };
};

module.exports = {
  assembleTemplateLocally,
};
