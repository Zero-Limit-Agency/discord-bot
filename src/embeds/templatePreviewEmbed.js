const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const {
  countDiagnostics,
  getPrimaryIssue,
  inferTemplateStatus,
  summarizeDiagnostics,
} = require('../utils/templateDiagnostics');

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

const getTemplateWarnings = (diagnostics = {}) => [
  ...(diagnostics.normalizationWarnings || []),
  ...(diagnostics.repairWarnings || []),
  ...(diagnostics.validationWarnings || []),
];

const createTemplatePreviewEmbed = (slug, plan) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('TEMPLATE PREVIEW')
  .setDescription(plan.description)
  .addFields(
    { name: 'Template', value: `${plan.templateName} (\`${slug}\`)`, inline: false },
    { name: 'Status', value: inferTemplateStatus(plan.templateDiagnostics), inline: true },
    {
      name: 'Warnings',
      value: String(countDiagnostics([
        ...getTemplateWarnings(plan.templateDiagnostics),
        ...(plan.mapping?.warnings || []),
      ])),
      inline: true,
    },
    {
      name: 'Summary',
      value: [
        `Roles: ${plan.summary.roleCount}`,
        `Categories: ${plan.summary.categoryCount}`,
        `Channels: ${plan.summary.channelCount}`,
        `Embeds: ${plan.summary.welcomeEmbedCount}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Primary Issue',
      value: getPrimaryIssue(plan.blockingErrors, plan.mapping?.errors, getTemplateWarnings(plan.templateDiagnostics), plan.mapping?.warnings) || 'None detected.',
      inline: false,
    },
    {
      name: 'Top Diagnostics',
      value: summarizeDiagnostics(
        [
          ...(plan.blockingErrors || []),
          ...(plan.mapping?.errors || []),
          ...getTemplateWarnings(plan.templateDiagnostics),
          ...(plan.mapping?.warnings || []),
        ],
        { fallback: 'None detected.', limit: 4 },
      ),
      inline: false,
    },
  );

const createTemplatePlanEmbed = (slug, plan) => {
  const blockingErrors = plan.blockingErrors || [];
  const warnings = [
    ...getTemplateWarnings(plan.templateDiagnostics),
    ...(plan.mapping.warnings || []),
    ...(plan.warnings || []),
  ];
  const totalActions = plan.summary.roleCount
    + plan.summary.categoryCount
    + plan.summary.channelCount
    + plan.summary.welcomeEmbedCount;
  const status = inferTemplateStatus(plan.templateDiagnostics, {
    blocked: blockingErrors.length > 0 || plan.mapping.isValid === false,
  });

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('TEMPLATE PLAN')
    .setDescription(plan.description)
    .addFields(
      { name: 'Template', value: `${plan.templateName} (\`${slug}\`)`, inline: false },
      { name: 'Status', value: status, inline: true },
      { name: 'Planned Actions', value: String(totalActions), inline: true },
      { name: 'Warnings', value: String(countDiagnostics(warnings)), inline: true },
      {
        name: 'Plan Summary',
        value: [
          `Roles: ${plan.summary.roleCount}`,
          `Categories: ${plan.summary.categoryCount}`,
          `Channels: ${plan.summary.channelCount}`,
          `Embeds: ${plan.summary.welcomeEmbedCount}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Primary Issue',
        value: getPrimaryIssue(blockingErrors, plan.mapping.errors, warnings) || 'None detected.',
        inline: false,
      },
      {
        name: 'Top Diagnostics',
        value: summarizeDiagnostics(
          [...blockingErrors, ...plan.mapping.errors, ...warnings],
          { fallback: 'None detected.', limit: 4 },
        ),
        inline: false,
      },
      {
        name: 'Mapping',
        value: [
          `Valid: ${plan.mapping.isValid ? 'yes' : 'no'}`,
          `Types mapped: ${plan.mapping.mappedChannelTypeCount}`,
          `Permissions mapped: ${plan.mapping.mappedPermissionCount}`,
        ].join('\n'),
        inline: false,
      },
    );
};

const createTemplateListEmbed = (templates) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('AVAILABLE TEMPLATES')
  .setDescription(
    templates.length
      ? templates.map((template) => `- \`${template.slug}\``).join('\n')
      : 'No templates are currently available.',
  );

const createTemplatePayloadEmbed = (slug, result) => {
  const warnings = [
    ...getTemplateWarnings(result.templateDiagnostics),
    ...(result.buildWarnings || []),
  ];
  const status = inferTemplateStatus(result.templateDiagnostics, {
    blocked: (result.buildErrors || []).length > 0,
  });

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('TEMPLATE PAYLOAD')
    .setDescription(result.template.description || 'No description provided.')
    .addFields(
      { name: 'Template', value: `${result.template.name} (\`${slug}\`)`, inline: false },
      { name: 'Status', value: status, inline: true },
      {
        name: 'Payloads',
        value: String(
          result.summary.rolePayloadCount
          + result.summary.categoryPayloadCount
          + result.summary.channelPayloadCount
          + result.summary.embedPayloadCount,
        ),
        inline: true,
      },
      { name: 'Warnings', value: String(countDiagnostics(warnings)), inline: true },
      {
        name: 'Payload Summary',
        value: [
          `Roles: ${result.summary.rolePayloadCount}`,
          `Categories: ${result.summary.categoryPayloadCount}`,
          `Channels: ${result.summary.channelPayloadCount}`,
          `Embeds: ${result.summary.embedPayloadCount}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Primary Issue',
        value: getPrimaryIssue(result.buildErrors, warnings) || 'None detected.',
        inline: false,
      },
      {
        name: 'Top Diagnostics',
        value: summarizeDiagnostics(
          [...(result.buildErrors || []), ...warnings],
          { fallback: 'None detected.', limit: 4 },
        ),
        inline: false,
      },
      {
        name: 'Debug File',
        value: result.debugFilePath || 'Not written (production or blocked).',
        inline: false,
      },
    );
};

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

const createTemplateDryRunEmbed = (slug, result) => {
  const warnings = [
    ...getTemplateWarnings(result.templateDiagnostics),
    ...(result.plan?.warnings || []),
    ...(result.dryRun?.warnings || []),
  ];
  const status = inferTemplateStatus(result.templateDiagnostics, {
    blocked: result.dryRun.finalStatus !== 'success',
    failed: result.dryRun.summary.failedCount > 0,
  });

  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('TEMPLATE DRY RUN')
    .setDescription(result.template.description || 'No description provided.')
    .addFields(
      { name: 'Template', value: `${result.template.name} (\`${slug}\`)`, inline: false },
      { name: 'Status', value: status, inline: true },
      { name: 'Run Result', value: result.dryRun.finalStatus, inline: true },
      { name: 'Warnings', value: String(countDiagnostics(warnings)), inline: true },
      {
        name: 'Run Summary',
        value: [
          `Steps: ${result.dryRun.summary.totalSteps}`,
          `Success: ${result.dryRun.summary.successCount}`,
          `Blocked: ${result.dryRun.summary.blockedCount}`,
          `Failed: ${result.dryRun.summary.failedCount}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Primary Issue',
        value: getPrimaryIssue(result.dryRun.blockingErrors, warnings) || 'None detected.',
        inline: false,
      },
      {
        name: 'Top Diagnostics',
        value: summarizeDiagnostics(
          [...(result.dryRun.blockingErrors || []), ...warnings],
          { fallback: 'None detected.', limit: 4 },
        ),
        inline: false,
      },
      {
        name: 'Debug File',
        value: result.debugFilePath || 'Not written (production mode).',
        inline: false,
      },
    );
};

module.exports = {
  createTemplatePreviewEmbed,
  createTemplatePlanEmbed,
  createTemplateListEmbed,
  createTemplatePayloadEmbed,
  createTemplateExecutionPlanEmbed,
  createTemplateSimulationEmbed,
  createTemplateDryRunEmbed,
};
