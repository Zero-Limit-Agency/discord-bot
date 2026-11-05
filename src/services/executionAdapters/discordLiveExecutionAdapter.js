const { ChannelType, OverwriteType, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');

const asBigInt = (value) => {
  const parsed = BigInt(value || '0');

  if (parsed < 0n) {
    throw new Error('Permission bitfield cannot be negative.');
  }

  return parsed;
};

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const findDuplicateNames = (names) => {
  const seen = new Set();
  const duplicates = new Set();

  names.map(normalizeName).filter(Boolean).forEach((name) => {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  });

  return Array.from(duplicates);
};

const validateLiveExecutionPreflight = async (guild, executionPlanResult) => {
  const errors = [];
  const warnings = [];
  const plan = executionPlanResult?.plan;

  if (!guild?.roles?.cache || !guild?.channels?.cache) {
    errors.push('Discord guild roles or channels are not available for preflight.');
  }

  if (!plan || plan.status !== 'ready') {
    errors.push('The execution plan is not ready.');
  }

  if (!errors.length) {
    try {
      if (typeof guild.roles.fetch === 'function') {
        await guild.roles.fetch();
      }

      if (typeof guild.channels.fetch === 'function') {
        await guild.channels.fetch();
      }
    } catch (error) {
      errors.push(`Discord state could not be refreshed for preflight: ${error.message || 'unknown error'}`);
    }
  }

  if (errors.length) {
    return { ok: false, errors, warnings };
  }

  const steps = plan.phases.flatMap((phase) => phase.steps || []);
  const roleNames = steps.filter((step) => step.action === 'create_role').map((step) => step.payload?.name);
  const categoryNames = steps.filter((step) => step.action === 'create_category').map((step) => step.payload?.name);
  const channelNames = steps.filter((step) => step.action === 'create_channel').map((step) => step.payload?.name);
  const existingRoles = new Set(Array.from(guild.roles.cache.values()).map((role) => normalizeName(role?.name)).filter(Boolean));
  const existingCategories = new Set(Array.from(guild.channels.cache.values())
    .filter((channel) => channel?.type === ChannelType.GuildCategory)
    .map((channel) => normalizeName(channel?.name))
    .filter(Boolean));
  const existingChannels = new Set(Array.from(guild.channels.cache.values())
    .filter((channel) => channel?.type !== ChannelType.GuildCategory)
    .map((channel) => normalizeName(channel?.name))
    .filter(Boolean));

  findDuplicateNames(roleNames).forEach((name) => errors.push(`The plan contains duplicate role name "${name}".`));
  findDuplicateNames(categoryNames).forEach((name) => errors.push(`The plan contains duplicate category name "${name}".`));
  findDuplicateNames(channelNames).forEach((name) => errors.push(`The plan contains duplicate channel name "${name}".`));

  roleNames.map(normalizeName).filter(Boolean).forEach((name) => {
    if (existingRoles.has(name)) {
      errors.push(`Role "${name}" already exists. Live creation will not overwrite or duplicate it.`);
    }
  });
  categoryNames.map(normalizeName).filter(Boolean).forEach((name) => {
    if (existingCategories.has(name)) {
      errors.push(`Category "${name}" already exists. Live creation will not overwrite or duplicate it.`);
    }
  });
  channelNames.map(normalizeName).filter(Boolean).forEach((name) => {
    if (existingChannels.has(name)) {
      errors.push(`Channel "${name}" already exists. Live creation will not overwrite or duplicate it.`);
    }
  });

  const roleSteps = steps.filter((step) => step.action === 'create_role');
  const channelSteps = steps.filter((step) => ['create_channel', 'create_category'].includes(step.action));
  if (guild.roles.cache.size + roleSteps.length > 250) errors.push('Discord role limit would be exceeded.');
  if (guild.channels.cache.size + channelSteps.length > 500) errors.push('Discord channel limit would be exceeded.');
  if (steps.some((step) => step.action === 'create_channel' && [5, 15].includes(step.payload.type)) && guild.features && !guild.features.includes('COMMUNITY')) errors.push('Forums and announcements require a Community server. Enable Community in Discord first.');
  for (const category of steps.filter((step) => step.action === 'create_category')) {
    if (steps.filter((step) => step.action === 'create_channel' && step.payload.parent === category.templateRef).length > 50) errors.push('A category cannot contain more than 50 channels.');
  }

  if (!steps.length) {
    errors.push('The execution plan contains no actions.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      roleCount: roleNames.length,
      categoryCount: categoryNames.length,
      channelCount: channelNames.length,
      totalSteps: steps.length,
    },
  };
};

const formatDiscordApiError = (action, error) => {
  const code = error?.code ? ` code=${error.code}` : '';
  const status = error?.status ? ` status=${error.status}` : '';
  const message = error?.message || 'Unknown Discord API error.';
  return `${action} failed:${code}${status} ${message}`.trim();
};

const buildPermissionOverwriteOptions = (allowValue, denyValue) => {
  const options = {};
  const allowed = new PermissionsBitField(asBigInt(allowValue));
  const denied = new PermissionsBitField(asBigInt(denyValue));

  allowed.toArray().forEach((permission) => {
    options[permission] = true;
  });
  denied.toArray().forEach((permission) => {
    options[permission] = false;
  });

  return options;
};

const createLiveDiscordExecutionAdapter = (guild) => ({
  async createRole({ templateRef, payload }) {
    try {
      const createdRole = await guild.roles.create({
        name: payload.name,
        color: payload.color,
        hoist: payload.hoist,
        mentionable: payload.mentionable,
        permissions: new PermissionsBitField(asBigInt(payload.permissions)),
        reason: `Template creation: role ${templateRef}`,
      });

      return {
        ok: true,
        action: 'createRole',
        templateRef,
        runtimeId: createdRole.id,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatDiscordApiError(`Role "${templateRef}" creation`, error),
      };
    }
  },

  async createCategory({ templateRef, payload }) {
    try {
      const createdCategory = await guild.channels.create({
        name: payload.name,
        type: ChannelType.GuildCategory,
        position: payload.position,
        permissionOverwrites: [
          { id: guild.id, deny: [P.ViewChannel] },
          { id: guild.members.me.id, allow: [P.ViewChannel, P.ManageChannels, P.SendMessages, P.EmbedLinks] },
        ],
        reason: `Template creation: category ${templateRef}`,
      });

      return {
        ok: true,
        action: 'createCategory',
        templateRef,
        runtimeId: createdCategory.id,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatDiscordApiError(`Category "${templateRef}" creation`, error),
      };
    }
  },

  async createChannel({ templateRef, payload, resolvedParentId, resolvedRoleRefs = {} }) {
    try {
      const overwrites = (payload.permissionOverwrites || []).map((ow) => ({
        id: ow.roleRef === '@everyone' ? guild.id : resolvedRoleRefs[`FUTURE_ROLE_${ow.roleRef}`],
        allow: asBigInt(ow.allow), deny: asBigInt(ow.deny), type: OverwriteType.Role,
      }));
      if (overwrites.some((ow) => !ow.id)) throw new Error('Unresolved permission role.');
      if (!overwrites.some((ow) => ow.id === guild.id)) overwrites.push({ id: guild.id, allow: P.ViewChannel, deny: 0n, type: OverwriteType.Role });
      overwrites.push({ id: guild.members.me.id, allow: P.ViewChannel | P.ManageChannels | P.SendMessages | P.EmbedLinks, deny: 0n, type: OverwriteType.Member });
      const createdChannel = await guild.channels.create({
        name: payload.name,
        type: payload.type,
        topic: payload.topic,
        permissionOverwrites: overwrites,
        parent: resolvedParentId || undefined,
        reason: `Template creation: channel ${templateRef}`,
      });

      return {
        ok: true,
        action: 'createChannel',
        templateRef,
        runtimeId: createdChannel.id,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatDiscordApiError(`Channel "${templateRef}" creation`, error),
      };
    }
  },

  async applyPermissionOverwrite({
    targetChannelRef,
    roleRef,
    payload,
    resolvedChannelId,
    resolvedRoleId,
  }) {
    try {
      const channel = guild.channels.cache.get(resolvedChannelId) || await guild.channels.fetch(resolvedChannelId);

      if (!channel) {
        return {
          ok: false,
          error: `Created channel for overwrite "${targetChannelRef}" could not be found.`,
        };
      }

      const overwriteTarget = roleRef === '@everyone' ? guild.roles.everyone.id : resolvedRoleId;

      if (!overwriteTarget) {
        return {
          ok: false,
          error: `Overwrite target "${roleRef}" could not be resolved.`,
        };
      }

      await channel.permissionOverwrites.create(overwriteTarget, buildPermissionOverwriteOptions(
        payload.allow,
        payload.deny,
      ), {
        type: OverwriteType.Role,
        reason: `Template creation: overwrite for ${targetChannelRef}`,
      });

      return {
        ok: true,
        action: 'applyPermissionOverwrite',
        runtimeId: `${resolvedChannelId}:${overwriteTarget}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatDiscordApiError(`Permission overwrite on "${targetChannelRef}"`, error),
      };
    }
  },

  async postOnboardingEmbed({ targetChannelRef, payload, resolvedChannelId }) {
    try {
      if (!resolvedChannelId) {
        return {
          ok: false,
          error: `Onboarding embed target "${targetChannelRef || 'unknown'}" could not be resolved.`,
        };
      }

      const channel = guild.channels.cache.get(resolvedChannelId) || await guild.channels.fetch(resolvedChannelId);

      if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
        return {
          ok: false,
          error: `Onboarding embed target "${targetChannelRef}" is not a writable text channel.`,
        };
      }

      const sentMessage = await channel.send({
        embeds: [payload],
        allowedMentions: { parse: [] },
      });

      const verified = await sentMessage.fetch();
      if (!verified.embeds?.length) throw new Error('Onboarding embed verification failed.');
      return {
        ok: true,
        action: 'postOnboardingEmbed',
        runtimeId: sentMessage.id,
      };
    } catch (error) {
      return {
        ok: false,
        error: formatDiscordApiError(`Onboarding embed post on "${targetChannelRef || 'unknown'}"`, error),
      };
    }
  },
});

module.exports = {
  buildPermissionOverwriteOptions,
  createLiveDiscordExecutionAdapter,
  validateLiveExecutionPreflight,
};
