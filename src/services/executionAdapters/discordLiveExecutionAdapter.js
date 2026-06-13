const { ChannelType, PermissionsBitField } = require('discord.js');

const asBigInt = (value) => {
  try {
    return BigInt(value || '0');
  } catch (error) {
    return 0n;
  }
};

const formatDiscordApiError = (action, error) => {
  const code = error?.code ? ` code=${error.code}` : '';
  const status = error?.status ? ` status=${error.status}` : '';
  const message = error?.message || 'Unknown Discord API error.';
  return `${action} failed:${code}${status} ${message}`.trim();
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

  async createChannel({ templateRef, payload, resolvedParentId }) {
    try {
      const createdChannel = await guild.channels.create({
        name: payload.name,
        type: payload.type,
        topic: payload.topic,
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

      await channel.permissionOverwrites.create(overwriteTarget, {
        allow: new PermissionsBitField(asBigInt(payload.allow)),
        deny: new PermissionsBitField(asBigInt(payload.deny)),
      }, {
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
      });

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
  createLiveDiscordExecutionAdapter,
};
