const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const { normalizeTemplate } = require('./templateNormalizer');
const { repairTemplate } = require('./templateRepairService');
const {
  draftTemplatesDirectoryPath,
  officialTemplatesDirectoryPath,
} = require('./draftTemplateStore');

const validChannelTypes = ['text', 'voice', 'announcement', 'forum'];
const LARGE_TEMPLATE_THRESHOLD = 25;
const templateSearchDirectories = [
  {
    source: 'official',
    directoryPath: officialTemplatesDirectoryPath,
  },
  {
    source: 'draft',
    directoryPath: draftTemplatesDirectoryPath,
  },
];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const toTemplateSlug = (fileName) => fileName.replace(/\.json$/i, '');
const getTemplatePath = (directoryPath, slug) => path.join(directoryPath, `${slug}.json`);

const getInternalId = (value) => {
  if (!isPlainObject(value)) {
    return null;
  }

  if (isNonEmptyString(value.id)) {
    return value.id.trim();
  }

  if (isNonEmptyString(value.key)) {
    return value.key.trim();
  }

  return null;
};

const formatPath = (collection, index, field) => `${collection}[${index}]${field ? `.${field}` : ''}`;

const listTemplateFiles = () => {
  const fileMap = new Map();

  templateSearchDirectories.forEach(({ source, directoryPath }) => {
    if (!fs.existsSync(directoryPath)) {
      logger.warn('Discord template directory is missing', { path: directoryPath, source });
      return;
    }

    fs.readdirSync(directoryPath)
      .filter((fileName) => fileName.endsWith('.json'))
      .forEach((fileName) => {
        const slug = toTemplateSlug(fileName);

        if (!fileMap.has(slug)) {
          fileMap.set(slug, {
            slug,
            fileName,
            source,
            path: path.join(directoryPath, fileName),
          });
        }
      });
  });

  return Array.from(fileMap.values())
    .sort((left, right) => left.slug.localeCompare(right.slug));
};

const listTemplates = () => listTemplateFiles();

const validatePermissionOverwrite = (overwrite, pathLabel, errors, warnings, roleIds) => {
  if (!isPlainObject(overwrite)) {
    errors.push(`${pathLabel} must be an object.`);
    return;
  }

  if (!isNonEmptyString(overwrite.target)) {
    errors.push(`${pathLabel}.target must be a non-empty string.`);
  } else if (overwrite.target !== '@everyone' && !roleIds.has(overwrite.target.trim())) {
    warnings.push(`${pathLabel}.target references missing role "${overwrite.target.trim()}".`);
  }

  if (overwrite.allow !== undefined && !Array.isArray(overwrite.allow)) {
    errors.push(`${pathLabel}.allow must be an array when provided.`);
  }

  if (overwrite.deny !== undefined && !Array.isArray(overwrite.deny)) {
    errors.push(`${pathLabel}.deny must be an array when provided.`);
  }
};

const validateRole = (role, index, errors) => {
  const pathLabel = formatPath('roles', index);

  if (!isPlainObject(role)) {
    errors.push(`${pathLabel} must be an object.`);
    return null;
  }

  const internalId = getInternalId(role);

  if (!internalId) {
    errors.push(`${pathLabel} must define a non-empty id or key.`);
  }

  if (!isNonEmptyString(role.name)) {
    errors.push(`${pathLabel}.name must be a non-empty string.`);
  }

  if (role.color !== undefined && !isNonEmptyString(role.color)) {
    errors.push(`${pathLabel}.color must be a string when provided.`);
  }

  if (role.hoist !== undefined && typeof role.hoist !== 'boolean') {
    errors.push(`${pathLabel}.hoist must be a boolean when provided.`);
  }

  if (role.mentionable !== undefined && typeof role.mentionable !== 'boolean') {
    errors.push(`${pathLabel}.mentionable must be a boolean when provided.`);
  }

  if (role.permissions !== undefined && !Array.isArray(role.permissions)) {
    errors.push(`${pathLabel}.permissions must be an array when provided.`);
  }

  return internalId;
};

const validateCategory = (category, index, errors) => {
  const pathLabel = formatPath('categories', index);

  if (!isPlainObject(category)) {
    errors.push(`${pathLabel} must be an object.`);
    return null;
  }

  const internalId = getInternalId(category);

  if (!internalId) {
    errors.push(`${pathLabel} must define a non-empty id or key.`);
  }

  if (!isNonEmptyString(category.name)) {
    errors.push(`${pathLabel}.name must be a non-empty string.`);
  }

  if (category.position !== undefined && !Number.isInteger(category.position)) {
    errors.push(`${pathLabel}.position must be an integer when provided.`);
  }

  return internalId;
};

const validateChannel = (channel, index, errors, warnings, categoryIds, roleIds) => {
  const pathLabel = formatPath('channels', index);

  if (!isPlainObject(channel)) {
    errors.push(`${pathLabel} must be an object.`);
    return null;
  }

  const internalId = getInternalId(channel);

  if (!internalId) {
    errors.push(`${pathLabel} must define a non-empty id or key.`);
  }

  if (!isNonEmptyString(channel.name)) {
    errors.push(`${pathLabel}.name must be a non-empty string.`);
  }

  if (!validChannelTypes.includes(channel.type)) {
    errors.push(`${pathLabel}.type must be one of: ${validChannelTypes.join(', ')}.`);
  }

  if (channel.categoryId !== undefined && !isNonEmptyString(channel.categoryId)) {
    errors.push(`${pathLabel}.categoryId must be a non-empty string when provided.`);
  }

  if (channel.categoryId && !categoryIds.has(channel.categoryId.trim())) {
    warnings.push(`${pathLabel}.categoryId references missing category "${channel.categoryId.trim()}".`);
  }

  if (!channel.categoryId) {
    warnings.push(`${pathLabel} has no category assignment.`);
  }

  if (channel.topic !== undefined && !isNonEmptyString(channel.topic)) {
    errors.push(`${pathLabel}.topic must be a non-empty string when provided.`);
  }

  if (channel.permissions !== undefined) {
    if (!Array.isArray(channel.permissions)) {
      errors.push(`${pathLabel}.permissions must be an array when provided.`);
    } else {
      channel.permissions.forEach((overwrite, overwriteIndex) => {
        validatePermissionOverwrite(
          overwrite,
          `${pathLabel}.permissions[${overwriteIndex}]`,
          errors,
          warnings,
          roleIds,
        );
      });
    }
  }

  return internalId;
};

const validateWelcomeEmbed = (embed, index, errors, warnings) => {
  const pathLabel = formatPath('welcomeEmbeds', index);

  if (!isPlainObject(embed)) {
    errors.push(`${pathLabel} must be an object.`);
    return;
  }

  const hasTitle = isNonEmptyString(embed.title);
  const hasDescription = isNonEmptyString(embed.description);

  if (!hasTitle && !hasDescription) {
    errors.push(`${pathLabel} must define at least a title or a description.`);
  }

  if (embed.title !== undefined && !hasTitle) {
    errors.push(`${pathLabel}.title must be a non-empty string when provided.`);
  }

  if (embed.description !== undefined && !hasDescription) {
    errors.push(`${pathLabel}.description must be a non-empty string when provided.`);
  }

  if (embed.fields !== undefined && !Array.isArray(embed.fields)) {
    errors.push(`${pathLabel}.fields must be an array when provided.`);
  }

  if (embed.fields !== undefined && Array.isArray(embed.fields) && !hasTitle && !hasDescription && embed.fields.length === 0) {
    warnings.push(`${pathLabel} has very little visible content.`);
  }
};

const collectDuplicateWarnings = (collectionName, items, getName, warnings) => {
  const names = new Map();

  items.forEach((item, index) => {
    const name = getName(item);

    if (!isNonEmptyString(name)) {
      return;
    }

    const normalized = name.trim().toLowerCase();

    if (names.has(normalized)) {
      warnings.push(`${collectionName} contains duplicate name "${name.trim()}".`);
      return;
    }

    names.set(normalized, index);
  });
};

const validateTemplate = (template) => {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(template)) {
    return {
      isValid: false,
      errors: ['Template root must be a JSON object.'],
      warnings,
    };
  }

  if (!isNonEmptyString(template.name)) {
    errors.push('name must be a non-empty string.');
  }

  if (template.description !== undefined && typeof template.description !== 'string') {
    errors.push('description must be a string when provided.');
  }

  if (!Array.isArray(template.roles)) {
    errors.push('roles must be an array.');
  }

  if (!Array.isArray(template.categories)) {
    errors.push('categories must be an array.');
  }

  if (!Array.isArray(template.channels)) {
    errors.push('channels must be an array.');
  }

  if (!Array.isArray(template.welcomeEmbeds)) {
    errors.push('welcomeEmbeds must be an array.');
  }

  const roleIds = new Set();
  const categoryIds = new Set();
  const channelIds = new Set();

  if (Array.isArray(template.roles)) {
    template.roles.forEach((role, index) => {
      const internalId = validateRole(role, index, errors);

      if (internalId) {
        const normalized = internalId.toLowerCase();

        if (roleIds.has(normalized)) {
          errors.push(`roles contains duplicate id/key "${internalId}".`);
          warnings.push(`roles contains duplicate internal reference "${internalId}".`);
        } else {
          roleIds.add(normalized);
        }
      }
    });

    collectDuplicateWarnings('roles', template.roles, (role) => role && role.name, warnings);
  }

  if (Array.isArray(template.categories)) {
    template.categories.forEach((category, index) => {
      const internalId = validateCategory(category, index, errors);

      if (internalId) {
        const normalized = internalId.toLowerCase();

        if (categoryIds.has(normalized)) {
          errors.push(`categories contains duplicate id/key "${internalId}".`);
          warnings.push(`categories contains duplicate internal reference "${internalId}".`);
        } else {
          categoryIds.add(normalized);
        }
      }
    });

    collectDuplicateWarnings('categories', template.categories, (category) => category && category.name, warnings);
  }

  if (Array.isArray(template.channels)) {
    template.channels.forEach((channel, index) => {
      const internalId = validateChannel(channel, index, errors, warnings, categoryIds, roleIds);

      if (internalId) {
        const normalized = internalId.toLowerCase();

        if (channelIds.has(normalized)) {
          errors.push(`channels contains duplicate id/key "${internalId}".`);
          warnings.push(`channels contains duplicate internal reference "${internalId}".`);
        } else {
          channelIds.add(normalized);
        }
      }
    });

    collectDuplicateWarnings('channels', template.channels, (channel) => channel && channel.name, warnings);
  }

  if (Array.isArray(template.welcomeEmbeds)) {
    template.welcomeEmbeds.forEach((embed, index) => validateWelcomeEmbed(embed, index, errors, warnings));
  }

  const totalObjects = (Array.isArray(template.roles) ? template.roles.length : 0)
    + (Array.isArray(template.categories) ? template.categories.length : 0)
    + (Array.isArray(template.channels) ? template.channels.length : 0)
    + (Array.isArray(template.welcomeEmbeds) ? template.welcomeEmbeds.length : 0);

  if (totalObjects >= LARGE_TEMPLATE_THRESHOLD) {
    warnings.push(`Template is large (${totalObjects} objects) and may require phased creation.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

const prepareTemplate = (parsed, metadata = {}) => {
  const normalizedSlug = String(metadata.slug || '').trim().toLowerCase() || 'inline-template';
  const normalized = normalizeTemplate(parsed);

  if (!normalized.ok) {
    return {
      ok: false,
      code: normalized.code || 'TEMPLATE_NORMALIZATION_ERROR',
      message: normalized.message || 'Template could not be normalized.',
      errors: [normalized.message || 'Template normalization failed.'],
      warnings: normalized.normalizationWarnings || [],
    };
  }

  const repaired = repairTemplate(normalized.normalizedTemplate);
  const template = repaired.ok ? repaired.repairedTemplate : normalized.normalizedTemplate;
  const pipelineWarnings = [
    ...(normalized.normalizationWarnings || []),
    ...(repaired.repairWarnings || []),
  ];

  if (!repaired.ok) {
    pipelineWarnings.push(repaired.message || 'Template repair failed and validation continued with normalized data.');
  }

  const validation = validateTemplate(template);
  const mergedWarnings = [...pipelineWarnings, ...validation.warnings];

  if (!validation.isValid) {
    logger.warn('Discord template validation failed', {
      template: normalizedSlug,
      errors: validation.errors.length,
      warnings: mergedWarnings.length,
    });

    return {
      ok: false,
      code: 'INVALID_TEMPLATE',
      message: 'Template JSON is invalid.',
      errors: validation.errors,
      warnings: mergedWarnings,
    };
  }

  return {
    ok: true,
    slug: normalizedSlug,
    source: metadata.source || 'memory',
    path: metadata.path || null,
    template,
    validation: {
      ...validation,
      warnings: mergedWarnings,
    },
    normalizationWarnings: normalized.normalizationWarnings || [],
    repairWarnings: repaired.repairWarnings || [],
  };
};

const loadTemplate = (slug) => {
  const normalizedSlug = String(slug || '').trim().toLowerCase();

  if (!normalizedSlug) {
    return {
      ok: false,
      code: 'INVALID_TEMPLATE_NAME',
      message: 'Template name is required.',
      errors: ['Template name is required.'],
      warnings: [],
    };
  }

  const matchingDirectory = templateSearchDirectories.find(({ directoryPath }) => (
    fs.existsSync(getTemplatePath(directoryPath, normalizedSlug))
  ));

  if (!matchingDirectory) {
    return {
      ok: false,
      code: 'TEMPLATE_NOT_FOUND',
      message: `Template "${normalizedSlug}" was not found.`,
      errors: ['Template not found.'],
      warnings: [],
    };
  }

  const templatePath = getTemplatePath(matchingDirectory.directoryPath, normalizedSlug);

  try {
    const raw = fs.readFileSync(templatePath, 'utf8');
    const parsed = JSON.parse(raw);
    return prepareTemplate(parsed, {
      slug: normalizedSlug,
      source: matchingDirectory.source,
      path: templatePath,
    });
  } catch (error) {
    logger.error('Failed to load Discord template', {
      template: normalizedSlug,
      error: error.message,
    });

    return {
      ok: false,
      code: 'TEMPLATE_READ_ERROR',
      message: 'Template could not be loaded.',
      errors: ['Template JSON is invalid or unreadable.'],
      warnings: [],
    };
  }
};

module.exports = {
  listTemplates,
  loadTemplate,
  prepareTemplate,
  validateTemplate,
  validChannelTypes,
};
