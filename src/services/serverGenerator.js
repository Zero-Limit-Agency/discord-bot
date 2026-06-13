const logger = require('../utils/logger');
const { loadTemplate } = require('./discordTemplateService');
const { analyzeTemplateMapping } = require('./discordTemplateMapper');

const buildServerPlan = (slug) => {
  const result = loadTemplate(slug);

  if (!result.ok) {
    return result;
  }

  const { template, validation } = result;
  const mapping = analyzeTemplateMapping(template);

  const roles = template.roles.map((role) => ({
    internalId: role.id || role.key,
    name: role.name,
    color: role.color || null,
    hoist: role.hoist === true,
    mentionable: role.mentionable === true,
  }));

  const categories = template.categories.map((category) => ({
    internalId: category.id || category.key,
    name: category.name,
    position: category.position ?? null,
  }));

  const channels = template.channels.map((channel) => ({
    internalId: channel.id || channel.key,
    name: channel.name,
    type: channel.type,
    categoryId: channel.categoryId || null,
    topic: channel.topic || null,
    permissionOverwriteCount: Array.isArray(channel.permissions) ? channel.permissions.length : 0,
  }));

  const welcomeEmbeds = template.welcomeEmbeds.map((embed, index) => ({
    index: index + 1,
    title: embed.title || null,
    description: embed.description || null,
    fieldCount: Array.isArray(embed.fields) ? embed.fields.length : 0,
  }));

  const plan = {
    templateName: template.name,
    description: template.description || 'No description provided.',
    templateDiagnostics: {
      normalizationWarnings: result.normalizationWarnings || [],
      repairWarnings: result.repairWarnings || [],
      validationWarnings: validation.warnings,
    },
    roles,
    categories,
    channels,
    welcomeEmbeds,
    summary: {
      roleCount: roles.length,
      categoryCount: categories.length,
      channelCount: channels.length,
      welcomeEmbedCount: welcomeEmbeds.length,
    },
    blockingErrors: validation.errors,
    warnings: validation.warnings,
    mapping: {
      isValid: mapping.isValid,
      mappedChannelTypeCount: mapping.mappedChannelTypeCount,
      mappedPermissionCount: mapping.mappedPermissionCount,
      errors: mapping.errors,
      warnings: mapping.warnings,
      supportedChannelTypes: mapping.supportedChannelTypes,
      supportedPermissions: mapping.supportedPermissions,
    },
  };

  logger.info('Server generation plan prepared', {
    template: result.slug,
    roles: plan.summary.roleCount,
    categories: plan.summary.categoryCount,
    channels: plan.summary.channelCount,
    embeds: plan.summary.welcomeEmbedCount,
    warnings: plan.warnings.length,
    mappingErrors: plan.mapping.errors.length,
    mappingWarnings: plan.mapping.warnings.length,
  });

  return {
    ok: true,
    slug: result.slug,
    template: result.template,
    plan,
  };
};

module.exports = {
  buildServerPlan,
};
