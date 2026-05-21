const {
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const channelTypeMap = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
};

const permissionMap = {
  view_channel: PermissionFlagsBits.ViewChannel,
  send_messages: PermissionFlagsBits.SendMessages,
  manage_messages: PermissionFlagsBits.ManageMessages,
  manage_channels: PermissionFlagsBits.ManageChannels,
  connect: PermissionFlagsBits.Connect,
  speak: PermissionFlagsBits.Speak,
  read_message_history: PermissionFlagsBits.ReadMessageHistory,
  mention_everyone: PermissionFlagsBits.MentionEveryone,
  attach_files: PermissionFlagsBits.AttachFiles,
  embed_links: PermissionFlagsBits.EmbedLinks,
};

const voiceOnlyPermissions = new Set(['connect', 'speak']);
const textOrForumPermissions = new Set([
  'send_messages',
  'manage_messages',
  'read_message_history',
  'mention_everyone',
  'attach_files',
  'embed_links',
]);
const textCompatibleChannelTypes = new Set(['text', 'announcement', 'forum']);

const isKnownPermission = (permission) => Object.prototype.hasOwnProperty.call(permissionMap, permission);

const mapChannelType = (type) => {
  if (!type || !Object.prototype.hasOwnProperty.call(channelTypeMap, type)) {
    return null;
  }

  return channelTypeMap[type];
};

const mapPermission = (permission) => {
  if (!permission || !isKnownPermission(permission)) {
    return null;
  }

  return permissionMap[permission];
};

const validatePermissionList = (permissions, pathLabel, channelType, errors, warnings) => {
  if (!Array.isArray(permissions)) {
    return 0;
  }

  let mappedCount = 0;

  permissions.forEach((permission) => {
    const normalized = typeof permission === 'string' ? permission.trim().toLowerCase() : '';

    if (!normalized || !isKnownPermission(normalized)) {
      errors.push(`${pathLabel} contains unknown permission "${permission}".`);
      return;
    }

    mappedCount += 1;

    if (voiceOnlyPermissions.has(normalized) && channelType !== 'voice') {
      warnings.push(`${pathLabel} uses voice permission "${normalized}" on ${channelType} channel.`);
    }

    if (textOrForumPermissions.has(normalized) && channelType === 'voice') {
      warnings.push(`${pathLabel} uses text/forum permission "${normalized}" on voice channel.`);
    }

    if (channelType === 'forum' && normalized === 'send_messages') {
      warnings.push(`${pathLabel} uses "send_messages" on forum channel; check whether forum posting behavior matches your intent.`);
    }

    if (textCompatibleChannelTypes.has(channelType) && normalized === 'speak') {
      warnings.push(`${pathLabel} uses "speak" on non-voice channel.`);
    }
  });

  return mappedCount;
};

const analyzeTemplateMapping = (template) => {
  const errors = [];
  const warnings = [];

  let mappedChannelTypeCount = 0;
  let mappedPermissionCount = 0;

  (template.roles || []).forEach((role, roleIndex) => {
    mappedPermissionCount += validatePermissionList(
      role.permissions,
      `roles[${roleIndex}].permissions`,
      'role',
      errors,
      warnings,
    );
  });

  (template.channels || []).forEach((channel, channelIndex) => {
    const mappedChannelType = mapChannelType(channel.type);

    if (mappedChannelType === null) {
      errors.push(`channels[${channelIndex}].type "${channel.type}" cannot be mapped to Discord.js.`);
    } else {
      mappedChannelTypeCount += 1;
    }

    (channel.permissions || []).forEach((overwrite, overwriteIndex) => {
      mappedPermissionCount += validatePermissionList(
        overwrite.allow,
        `channels[${channelIndex}].permissions[${overwriteIndex}].allow`,
        channel.type,
        errors,
        warnings,
      );

      mappedPermissionCount += validatePermissionList(
        overwrite.deny,
        `channels[${channelIndex}].permissions[${overwriteIndex}].deny`,
        channel.type,
        errors,
        warnings,
      );
    });
  });

  return {
    isValid: errors.length === 0,
    mappedChannelTypeCount,
    mappedPermissionCount,
    supportedChannelTypes: Object.keys(channelTypeMap),
    supportedPermissions: Object.keys(permissionMap),
    errors,
    warnings,
  };
};

module.exports = {
  channelTypeMap,
  permissionMap,
  supportedChannelTypes: Object.keys(channelTypeMap),
  supportedPermissions: Object.keys(permissionMap),
  mapChannelType,
  mapPermission,
  analyzeTemplateMapping,
};
