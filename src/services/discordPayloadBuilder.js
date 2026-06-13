const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder,
  OverwriteType,
  PermissionsBitField,
} = require('discord.js');
const logger = require('../utils/logger');
const { loadTemplate } = require('./discordTemplateService');
const {
  analyzeTemplateMapping,
  mapChannelType,
  mapPermission,
} = require('./discordTemplateMapper');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'generated-payloads');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const normalizePermissionList = (permissions = []) => permissions
  .filter((permission) => typeof permission === 'string')
  .map((permission) => permission.trim().toLowerCase())
  .filter(Boolean);

const buildPermissionBitfield = (permissions, pathLabel, warnings, errors, channelType = null) => {
  const normalizedPermissions = normalizePermissionList(permissions);
  let bitfield = 0n;

  normalizedPermissions.forEach((permission) => {
    const mappedPermission = mapPermission(permission);

    if (mappedPermission === null) {
      errors.push(`${pathLabel} contains unknown permission "${permission}".`);
      return;
    }

    try {
      bitfield |= PermissionsBitField.resolve(mappedPermission);
    } catch (error) {
      warnings.push(`${pathLabel} could not resolve permission "${permission}".`);
    }

    if (channelType === 'voice' && ['send_messages', 'manage_messages', 'read_message_history', 'attach_files', 'embed_links'].includes(permission)) {
      warnings.push(`${pathLabel} uses text-oriented permission "${permission}" on a voice channel.`);
    }

    if (channelType !== 'voice' && ['connect', 'speak'].includes(permission)) {
      warnings.push(`${pathLabel} uses voice-oriented permission "${permission}" on a non-voice channel.`);
    }
  });

  return bitfield;
};

const buildRolePayload = (role, index, warnings, errors) => {
  const internalId = role.id || role.key;
  const permissionBits = buildPermissionBitfield(
    role.permissions,
    `roles[${index}].permissions`,
    warnings,
    errors,
  );

  return {
    templateRoleId: internalId,
    discordPayload: {
      name: role.name,
      color: role.color || undefined,
      hoist: role.hoist === true,
      mentionable: role.mentionable === true,
      permissions: permissionBits.toString(),
    },
  };
};

const buildOverwritePayload = (overwrite, pathLabel, channelType, warnings, errors) => ({
  targetRef: overwrite.target,
  discordPayload: {
    type: OverwriteType.Role,
    allow: buildPermissionBitfield(overwrite.allow, `${pathLabel}.allow`, warnings, errors, channelType).toString(),
    deny: buildPermissionBitfield(overwrite.deny, `${pathLabel}.deny`, warnings, errors, channelType).toString(),
  },
});

const buildChannelPayload = (channel, index, warnings, errors) => {
  const internalId = channel.id || channel.key;
  const mappedType = mapChannelType(channel.type);

  if (mappedType === null) {
    errors.push(`channels[${index}].type "${channel.type}" cannot be converted to a Discord.js payload.`);
  }

  const permissionOverwrites = Array.isArray(channel.permissions)
    ? channel.permissions.map((overwrite, overwriteIndex) => buildOverwritePayload(
      overwrite,
      `channels[${index}].permissions[${overwriteIndex}]`,
      channel.type,
      warnings,
      errors,
    ))
    : [];

  return {
    templateChannelId: internalId,
    parentRef: channel.categoryId || null,
    discordPayload: {
      name: channel.name,
      type: mappedType,
      topic: channel.topic || undefined,
      parent: channel.categoryId || undefined,
      permissionOverwrites: permissionOverwrites.map((overwrite) => ({
        type: overwrite.discordPayload.type,
        allow: overwrite.discordPayload.allow,
        deny: overwrite.discordPayload.deny,
        roleRef: overwrite.targetRef,
      })),
    },
  };
};

const buildCategoryPayload = (category) => ({
  templateCategoryId: category.id || category.key,
  discordPayload: {
    name: category.name,
    position: Number.isInteger(category.position) ? category.position : undefined,
  },
});

const buildEmbedPayload = (embed, index, warnings) => {
  const builder = new EmbedBuilder();

  if (embed.title) {
    builder.setTitle(embed.title);
  }

  if (embed.description) {
    builder.setDescription(embed.description);
  }

  if (embed.color) {
    builder.setColor(embed.color);
  }

  if (Array.isArray(embed.fields)) {
    const validFields = embed.fields
      .filter((field) => field && typeof field === 'object' && field.name && field.value)
      .map((field) => ({
        name: String(field.name),
        value: String(field.value),
        inline: field.inline === true,
      }));

    if (validFields.length) {
      builder.addFields(validFields);
    } else if (embed.fields.length) {
      warnings.push(`welcomeEmbeds[${index}].fields contains no valid fields.`);
    }
  }

  return {
    templateEmbedIndex: index + 1,
    discordPayload: builder.toJSON(),
  };
};

const writeDebugPayloads = (slug, payloads) => {
  if (isProduction()) {
    return null;
  }

  ensureDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(debugDirectoryPath, `${slug}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payloads, null, 2));
  return filePath;
};

const buildDiscordPayloadsFromLoaded = (loaded) => {
  const mapping = analyzeTemplateMapping(loaded.template);

  if (!mapping.isValid) {
    logger.warn('Discord payload build blocked by mapping errors', {
      template: loaded.slug,
      errors: mapping.errors.length,
    });

    return {
      ok: false,
      code: 'INVALID_TEMPLATE_MAPPING',
      message: 'Template mapping is invalid.',
      errors: mapping.errors,
      warnings: mapping.warnings,
    };
  }

  const warnings = [
    ...loaded.validation.warnings,
    ...mapping.warnings,
  ];
  const errors = [];

  const rolePayloads = loaded.template.roles.map((role, index) => buildRolePayload(role, index, warnings, errors));
  const categoryPayloads = loaded.template.categories.map((category) => buildCategoryPayload(category));
  const channelPayloads = loaded.template.channels.map((channel, index) => buildChannelPayload(channel, index, warnings, errors));
  const embedPayloads = loaded.template.welcomeEmbeds.map((embed, index) => buildEmbedPayload(embed, index, warnings));

  const payloads = {
    roles: rolePayloads,
    categories: categoryPayloads,
    channels: channelPayloads,
    embeds: embedPayloads,
  };

  const debugFilePath = errors.length === 0 ? writeDebugPayloads(loaded.slug, payloads) : null;

  logger.info('Discord payloads prepared', {
    template: loaded.slug,
    roles: rolePayloads.length,
    categories: categoryPayloads.length,
    channels: channelPayloads.length,
    embeds: embedPayloads.length,
    warnings: warnings.length,
    errors: errors.length,
    debugFile: Boolean(debugFilePath),
  });

  return {
    ok: true,
    slug: loaded.slug,
    template: loaded.template,
    payloads,
    summary: {
      rolePayloadCount: rolePayloads.length,
      categoryPayloadCount: categoryPayloads.length,
      channelPayloadCount: channelPayloads.length,
      embedPayloadCount: embedPayloads.length,
    },
    buildErrors: errors,
    buildWarnings: warnings,
    mapping,
    debugFilePath,
  };
};

const buildDiscordPayloads = (slug) => {
  const loaded = loadTemplate(slug);

  if (!loaded.ok) {
    return loaded;
  }

  return buildDiscordPayloadsFromLoaded(loaded);
};

module.exports = {
  buildDiscordPayloads,
  buildDiscordPayloadsFromLoaded,
};
