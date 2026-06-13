const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const { buildDiscordPayloads } = require('./discordPayloadBuilder');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'execution-plans');

const isProduction = () => process.env.NODE_ENV === 'production';

const ensureDebugDirectory = () => {
  fs.mkdirSync(debugDirectoryPath, { recursive: true });
};

const textCapableChannelTypes = new Set([0, 5]);

const createPlaceholderMaps = (payloads) => ({
  rolePlaceholders: Object.fromEntries(
    payloads.roles.map((role) => [role.templateRoleId, `FUTURE_ROLE_${role.templateRoleId}`]),
  ),
  categoryPlaceholders: Object.fromEntries(
    payloads.categories.map((category) => [category.templateCategoryId, `FUTURE_CATEGORY_${category.templateCategoryId}`]),
  ),
  channelPlaceholders: Object.fromEntries(
    payloads.channels.map((channel) => [channel.templateChannelId, `FUTURE_CHANNEL_${channel.templateChannelId}`]),
  ),
});

const writeDebugPlan = (slug, plan) => {
  if (isProduction()) {
    return null;
  }

  ensureDebugDirectory();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(debugDirectoryPath, `${slug}-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
  return filePath;
};

const resolveOnboardingChannelRef = (template, payloads, warnings, errors) => {
  const compatibleChannels = payloads.channels.filter((channel) => (
    textCapableChannelTypes.has(channel.discordPayload.type)
  ));

  if (template.onboardingChannelId) {
    const explicitChannel = payloads.channels.find((channel) => channel.templateChannelId === template.onboardingChannelId);

    if (!explicitChannel) {
      warnings.push(`Onboarding channel "${template.onboardingChannelId}" is not defined in channels. Falling back to the first text-capable channel when available.`);
    } else if (!textCapableChannelTypes.has(explicitChannel.discordPayload.type)) {
      warnings.push(`Onboarding channel "${template.onboardingChannelId}" is not text-capable. Falling back to the first text-capable channel when available.`);
    } else {
      return explicitChannel.templateChannelId;
    }
  }

  if (compatibleChannels.length > 0) {
    return compatibleChannels[0].templateChannelId;
  }

  if (payloads.embeds.length > 0) {
    errors.push('Onboarding embeds require at least one text or announcement channel.');
  }

  return null;
};

const buildExecutionPlanFromPayloadResult = (payloadResult) => {
  const { payloads, template, summary, buildErrors, buildWarnings } = payloadResult;
  const placeholders = createPlaceholderMaps(payloads);
  const errors = [...buildErrors];
  const warnings = [...buildWarnings];
  const dependencies = [];

  const phase1Steps = payloads.roles.map((role, index) => ({
    stepId: `role-${index + 1}`,
    action: 'create_role',
    templateRef: role.templateRoleId,
    outputPlaceholder: placeholders.rolePlaceholders[role.templateRoleId],
    payload: role.discordPayload,
    dependsOn: [],
  }));

  const phase2Steps = payloads.categories.map((category, index) => ({
    stepId: `category-${index + 1}`,
    action: 'create_category',
    templateRef: category.templateCategoryId,
    outputPlaceholder: placeholders.categoryPlaceholders[category.templateCategoryId],
    payload: category.discordPayload,
    dependsOn: [],
  }));

  const phase3Steps = payloads.channels.map((channel, index) => {
    const dependsOn = [];

    if (channel.parentRef) {
      const categoryPlaceholder = placeholders.categoryPlaceholders[channel.parentRef];

      if (categoryPlaceholder) {
        dependsOn.push(categoryPlaceholder);
        dependencies.push(`Channel ${channel.templateChannelId} depends on category ${channel.parentRef}.`);
      } else {
        errors.push(`Channel "${channel.templateChannelId}" depends on missing category "${channel.parentRef}".`);
      }
    }

    return {
      stepId: `channel-${index + 1}`,
      action: 'create_channel',
      templateRef: channel.templateChannelId,
      outputPlaceholder: placeholders.channelPlaceholders[channel.templateChannelId],
      payload: channel.discordPayload,
      dependsOn,
    };
  });

  const phase4Steps = [];

  payloads.channels.forEach((channel, channelIndex) => {
    (channel.discordPayload.permissionOverwrites || []).forEach((overwrite, overwriteIndex) => {
      const dependsOn = [placeholders.channelPlaceholders[channel.templateChannelId]];
      const roleRef = overwrite.roleRef;

      if (roleRef && roleRef !== '@everyone') {
        const rolePlaceholder = placeholders.rolePlaceholders[roleRef];

      if (rolePlaceholder) {
        dependsOn.push(rolePlaceholder);
        dependencies.push(`Overwrite on ${channel.templateChannelId} depends on role ${roleRef}.`);
      } else {
        warnings.push(`Overwrite on channel "${channel.templateChannelId}" references unresolved role "${roleRef}".`);
        return;
      }
    }

    phase4Steps.push({
        stepId: `overwrite-${channelIndex + 1}-${overwriteIndex + 1}`,
        action: 'apply_channel_overwrite',
        targetChannelRef: channel.templateChannelId,
        roleRef: overwrite.roleRef,
        payload: overwrite,
        dependsOn,
      });
    });
  });

  const defaultOnboardingChannelRef = resolveOnboardingChannelRef(template, payloads, warnings, errors);

  const phase5Steps = payloads.embeds.map((embed, index) => ({
    stepId: `onboarding-embed-${index + 1}`,
    action: 'publish_onboarding_embed',
    targetChannelRef: defaultOnboardingChannelRef,
    payload: embed.discordPayload,
    dependsOn: [],
  }));

  if (defaultOnboardingChannelRef) {
    phase5Steps.forEach((step) => {
      const channelPlaceholder = placeholders.channelPlaceholders[defaultOnboardingChannelRef];

      if (channelPlaceholder) {
        step.dependsOn.push(channelPlaceholder);
        dependencies.push(`Onboarding embed depends on channel ${defaultOnboardingChannelRef}.`);
      } else {
        warnings.push(`Onboarding embed target channel "${defaultOnboardingChannelRef}" is not defined in channels.`);
      }
    });
  } else if (phase5Steps.length > 0) {
    phase5Steps.length = 0;
  }

  const phases = [
    { name: 'Phase 1', label: 'Create Roles', steps: phase1Steps },
    { name: 'Phase 2', label: 'Create Categories', steps: phase2Steps },
    { name: 'Phase 3', label: 'Create Channels', steps: phase3Steps },
    { name: 'Phase 4', label: 'Apply Permission Overwrites', steps: phase4Steps },
    { name: 'Phase 5', label: 'Publish Onboarding Embeds', steps: phase5Steps },
  ];

  const totalSteps = phases.reduce((total, phase) => total + phase.steps.length, 0);
  const status = errors.length ? 'blocked' : 'ready';

  const plan = {
    templateName: template.name,
    slug: payloadResult.slug,
    status,
    summary: {
      ...summary,
      totalSteps,
      phaseCount: phases.length,
    },
    placeholders,
    phases,
    dependencies,
    blockingErrors: errors,
    warnings,
  };

  const debugFilePath = writeDebugPlan(payloadResult.slug, plan);

  logger.info('Discord execution plan prepared', {
    template: payloadResult.slug,
    status,
    totalSteps,
    phases: phases.length,
    dependencies: dependencies.length,
    errors: errors.length,
    warnings: warnings.length,
    debugFile: Boolean(debugFilePath),
  });

  return {
    ok: true,
    slug: payloadResult.slug,
    template,
    payloads,
    plan,
    debugFilePath,
  };
};

const buildExecutionPlan = (slug) => {
  const payloadResult = buildDiscordPayloads(slug);

  if (!payloadResult.ok) {
    return payloadResult;
  }

  return buildExecutionPlanFromPayloadResult(payloadResult);
};

module.exports = {
  buildExecutionPlan,
  buildExecutionPlanFromPayloadResult,
};
