const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const asBulletList = (items, fallback, limit = 6) => {
  if (!items.length) {
    return fallback;
  }

  const visibleItems = items.slice(0, limit).map((item) => `- ${item}`);

  if (items.length > limit) {
    visibleItems.push(`- ...and ${items.length - limit} more`);
  }

  return visibleItems.join('\n');
};

const createTemplatePreviewEmbed = (slug, plan) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE PREVIEW')
  .setDescription(plan.description)
  .addFields(
    { name: 'Template', value: `${plan.templateName} (\`${slug}\`)`, inline: false },
    { name: 'Roles', value: String(plan.summary.roleCount), inline: true },
    { name: 'Categories', value: String(plan.summary.categoryCount), inline: true },
    { name: 'Channels', value: String(plan.summary.channelCount), inline: true },
    { name: 'Welcome Embeds', value: String(plan.summary.welcomeEmbedCount), inline: true },
    { name: 'Warnings', value: String(plan.warnings.length), inline: true },
  );

const createTemplatePlanEmbed = (slug, plan) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE PLAN')
  .setDescription(plan.description)
  .addFields(
    { name: 'Template', value: `${plan.templateName} (\`${slug}\`)`, inline: false },
    {
      name: 'Roles To Create',
      value: asBulletList(
        plan.roles.map((role) => `${role.name} (\`${role.internalId}\`)`),
        'No roles in this template.',
      ),
      inline: false,
    },
    {
      name: 'Categories To Create',
      value: asBulletList(
        plan.categories.map((category) => `${category.name} (\`${category.internalId}\`)`),
        'No categories in this template.',
      ),
      inline: false,
    },
    {
      name: 'Channels To Create',
      value: asBulletList(
        plan.channels.map((channel) => `${channel.name} [${channel.type}]`),
        'No channels in this template.',
      ),
      inline: false,
    },
    {
      name: 'Embeds To Post',
      value: asBulletList(
        plan.welcomeEmbeds.map((embed) => embed.title || `Embed ${embed.index}`),
        'No welcome embeds in this template.',
      ),
      inline: false,
    },
    {
      name: 'Blocking Errors',
      value: asBulletList(plan.blockingErrors, 'None detected.'),
      inline: false,
    },
    {
      name: 'Warnings',
      value: asBulletList(plan.warnings, 'None detected.'),
      inline: false,
    },
    {
      name: 'Discord.js Mapping',
      value: [
        `Valid: ${plan.mapping.isValid ? 'yes' : 'no'}`,
        `Mapped types: ${plan.mapping.mappedChannelTypeCount}`,
        `Mapped permissions: ${plan.mapping.mappedPermissionCount}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Mapping Errors',
      value: asBulletList(plan.mapping.errors, 'None detected.'),
      inline: false,
    },
    {
      name: 'Mapping Warnings',
      value: asBulletList(plan.mapping.warnings, 'None detected.'),
      inline: false,
    },
  );

const createTemplateListEmbed = (templates) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('AVAILABLE TEMPLATES')
  .setDescription(
    templates.length
      ? templates.map((template) => `- \`${template.slug}\``).join('\n')
      : 'No templates are currently available.',
  );

const createTemplatePayloadEmbed = (slug, result) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE PAYLOAD')
  .setDescription(result.template.description || 'No description provided.')
  .addFields(
    { name: 'Template', value: `${result.template.name} (\`${slug}\`)`, inline: false },
    { name: 'Role Payloads', value: String(result.summary.rolePayloadCount), inline: true },
    { name: 'Category Payloads', value: String(result.summary.categoryPayloadCount), inline: true },
    { name: 'Channel Payloads', value: String(result.summary.channelPayloadCount), inline: true },
    { name: 'Embed Payloads', value: String(result.summary.embedPayloadCount), inline: true },
    { name: 'Build Errors', value: String(result.buildErrors.length), inline: true },
    { name: 'Build Warnings', value: String(result.buildWarnings.length), inline: true },
    { name: 'Debug File', value: result.debugFilePath || 'Not written (production or blocked).', inline: false },
    { name: 'Errors', value: asBulletList(result.buildErrors, 'None detected.'), inline: false },
    { name: 'Warnings', value: asBulletList(result.buildWarnings, 'None detected.'), inline: false },
  );

const createTemplateExecutionPlanEmbed = (slug, result) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE EXECUTION PLAN')
  .setDescription(result.template.description || 'No description provided.')
  .addFields(
    { name: 'Template', value: `${result.template.name} (\`${slug}\`)`, inline: false },
    { name: 'Status', value: result.plan.status, inline: true },
    { name: 'Phases', value: String(result.plan.summary.phaseCount), inline: true },
    { name: 'Total Steps', value: String(result.plan.summary.totalSteps), inline: true },
    {
      name: 'Phase Breakdown',
      value: asBulletList(
        result.plan.phases.map((phase) => `${phase.name} - ${phase.label}: ${phase.steps.length} steps`),
        'No phases generated.',
      ),
      inline: false,
    },
    {
      name: 'Dependencies',
      value: asBulletList(result.plan.dependencies, 'None detected.'),
      inline: false,
    },
    {
      name: 'Blocking Errors',
      value: asBulletList(result.plan.blockingErrors, 'None detected.'),
      inline: false,
    },
    {
      name: 'Warnings',
      value: asBulletList(result.plan.warnings, 'None detected.'),
      inline: false,
    },
    {
      name: 'Debug File',
      value: result.debugFilePath || 'Not written (production mode).',
      inline: false,
    },
  );

const createTemplateSimulationEmbed = (slug, result) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE SIMULATION')
  .setDescription(result.template.description || 'No description provided.')
  .addFields(
    { name: 'Template', value: `${result.template.name} (\`${slug}\`)`, inline: false },
    { name: 'Final Status', value: result.simulation.finalStatus, inline: true },
    { name: 'Total Steps', value: String(result.simulation.summary.totalSteps), inline: true },
    { name: 'Phases', value: String(result.simulation.summary.phaseCount), inline: true },
    { name: 'Success', value: String(result.simulation.summary.successCount), inline: true },
    { name: 'Skipped', value: String(result.simulation.summary.skippedCount), inline: true },
    { name: 'Blocked', value: String(result.simulation.summary.blockedCount), inline: true },
    {
      name: 'Phase Summary',
      value: asBulletList(
        result.simulation.phases.map((phase) => {
          const success = phase.steps.filter((step) => step.status === 'success').length;
          const blocked = phase.steps.filter((step) => step.status === 'blocked').length;
          return `${phase.name} - ${phase.label}: ${success} success, ${blocked} blocked`;
        }),
        'No phases simulated.',
      ),
      inline: false,
    },
    {
      name: 'Main Errors',
      value: asBulletList(result.simulation.blockingErrors, 'None detected.'),
      inline: false,
    },
    {
      name: 'Main Warnings',
      value: asBulletList(result.simulation.warnings, 'None detected.'),
      inline: false,
    },
    {
      name: 'Debug File',
      value: result.debugFilePath || 'Not written (production mode).',
      inline: false,
    },
  );

const createTemplateDryRunEmbed = (slug, result) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE DRY RUN')
  .setDescription(result.template.description || 'No description provided.')
  .addFields(
    { name: 'Template', value: `${result.template.name} (\`${slug}\`)`, inline: false },
    { name: 'Final Status', value: result.dryRun.finalStatus, inline: true },
    { name: 'Executed Steps', value: String(result.dryRun.summary.totalSteps), inline: true },
    { name: 'Phases', value: String(result.dryRun.summary.phaseCount), inline: true },
    { name: 'Success', value: String(result.dryRun.summary.successCount), inline: true },
    { name: 'Blocked', value: String(result.dryRun.summary.blockedCount), inline: true },
    { name: 'Failed', value: String(result.dryRun.summary.failedCount), inline: true },
    {
      name: 'Warnings',
      value: asBulletList(result.dryRun.warnings, 'None detected.'),
      inline: false,
    },
    {
      name: 'Debug File',
      value: result.debugFilePath || 'Not written (production mode).',
      inline: false,
    },
  );

module.exports = {
  createTemplatePreviewEmbed,
  createTemplatePlanEmbed,
  createTemplateListEmbed,
  createTemplatePayloadEmbed,
  createTemplateExecutionPlanEmbed,
  createTemplateSimulationEmbed,
  createTemplateDryRunEmbed,
};
