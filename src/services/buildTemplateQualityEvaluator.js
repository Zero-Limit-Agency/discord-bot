const fs = require('node:fs');
const path = require('node:path');

const qualityDebugDirectoryPath = path.join(process.cwd(), 'debug', 'build-quality');
const voicePermissions = new Set(['connect', 'speak']);

const ensureArray = (value) => (Array.isArray(value) ? value : []);
const isProduction = () => process.env.NODE_ENV === 'production';
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9@]+/g, ' ')
  .trim();

const uniqueStrings = (values) => Array.from(new Set(
  ensureArray(values).map((value) => String(value || '').trim()).filter(Boolean),
));

const entityText = (entity) => normalizeText([
  entity?.id,
  entity?.key,
  entity?.name,
  entity?.description,
  entity?.topic,
  entity?.title,
].filter(Boolean).join(' '));

const hasEntitySignal = (entities, aliases) => ensureArray(entities)
  .some((entity) => aliases.some((alias) => entityText(entity).includes(normalizeText(alias))));

const addCheck = (checks, id, status, message) => {
  checks.push({ id, status, message });
};

const roleSignalAliases = {
  owner: ['owner', 'founder', 'fondateur', 'direction'],
  admin: ['admin', 'administrator', 'administrateur'],
  staff: ['staff', 'moderation', 'moderator', 'moderateur', 'management'],
  manager: ['manager', 'coach'],
  player: ['player', 'joueur', 'roster', 'team'],
  creator: ['creator', 'createur', 'streamer'],
  premium: ['premium', 'vip'],
  vip: ['vip'],
  partner: ['partner', 'partenaire', 'sponsor'],
  member: ['member', 'membre', 'community'],
};

const areaSignalAliases = {
  'public-community': ['public', 'community', 'communaute', 'general', 'lobby', 'welcome'],
  'staff-operations': ['staff', 'admin', 'moderation', 'management', 'direction'],
  'team-operations': ['player', 'joueur', 'team', 'roster', 'scrim', 'competitive'],
  support: ['support', 'ticket', 'help', 'aide'],
  onboarding: ['welcome', 'bienvenue', 'rules', 'regles', 'start', 'onboarding'],
  voice: ['voice', 'vocal', 'lounge'],
  'premium-private': ['premium', 'vip', 'private', 'prive', 'exclusive'],
  'media-announcements': ['media', 'content', 'video', 'live', 'announcement', 'annonce'],
};

const channelSignalAliases = {
  welcome: ['welcome', 'bienvenue', 'start'],
  rules: ['rules', 'regles'],
  announcements: ['announcement', 'annonce'],
  support: ['support', 'ticket', 'help'],
  media: ['media', 'content', 'video', 'live', 'clip'],
  scrims: ['scrim', 'training', 'practice'],
  voice: ['voice', 'vocal', 'lounge'],
  premium: ['premium', 'vip'],
  vip: ['vip'],
};

const getInternalId = (entity) => String(entity?.id || entity?.key || '').trim();

const collectDuplicateWarnings = (collection, label) => {
  const seen = new Set();
  const warnings = [];

  ensureArray(collection).forEach((entity) => {
    const value = normalizeText(entity?.name);

    if (!value) {
      return;
    }

    if (seen.has(value)) {
      warnings.push(`${label} contains duplicate name "${String(entity.name).trim()}".`);
      return;
    }

    seen.add(value);
  });

  return warnings;
};

const hasEveryoneViewDeny = (channel) => ensureArray(channel?.permissions).some((overwrite) => {
  const target = normalizeText(overwrite?.target || overwrite?.roleId);
  return target === '@everyone' && ensureArray(overwrite?.deny).includes('view_channel');
});

const collectPermissionDiagnostics = (template, roleIds, categoryIds) => {
  const contradictions = [];
  const warnings = [];

  ensureArray(template?.roles).forEach((role, roleIndex) => {
    ensureArray(role?.permissions).forEach((permission) => {
      if (voicePermissions.has(permission)) {
        contradictions.push(`roles[${roleIndex}].permissions contains channel-only voice permission "${permission}".`);
      }
    });
  });

  ensureArray(template?.channels).forEach((channel, channelIndex) => {
    const channelId = getInternalId(channel);

    if (channel.categoryId && !categoryIds.has(String(channel.categoryId).trim())) {
      warnings.push(`Channel "${channelId || channel.name || channelIndex}" references missing category "${channel.categoryId}".`);
    }

    ensureArray(channel.permissions).forEach((overwrite, overwriteIndex) => {
      if (!isPlainObject(overwrite)) {
        contradictions.push(`channels[${channelIndex}].permissions[${overwriteIndex}] is not a permission overwrite object.`);
        return;
      }

      const target = String(overwrite.target || overwrite.roleId || '').trim();

      if (target && target !== '@everyone' && !roleIds.has(target)) {
        warnings.push(`Channel "${channelId || channel.name || channelIndex}" has an orphan overwrite for role "${target}".`);
      }

      if (channel.type !== 'voice') {
        [...ensureArray(overwrite.allow), ...ensureArray(overwrite.deny)].forEach((permission) => {
          if (voicePermissions.has(permission)) {
            contradictions.push(`Channel "${channelId || channel.name || channelIndex}" uses voice permission "${permission}" on type "${channel.type || 'unknown'}".`);
          }
        });
      }
    });
  });

  return {
    contradictions: uniqueStrings(contradictions),
    warnings: uniqueStrings(warnings),
  };
};

const collectExplicitRoleSignals = (normalizedBrief) => {
  const signals = [...ensureArray(normalizedBrief?.rolesMentioned)];
  const original = normalizeText(normalizedBrief?.originalPrompt);

  if (/\bvip\b/.test(original)) {
    signals.push('vip');
  }

  return uniqueStrings(signals.map(normalizeText));
};

const isDetailedBrief = (normalizedBrief) => {
  const originalLength = String(normalizedBrief?.originalPrompt || '').trim().length;
  const structuredSignals = [
    ...ensureArray(normalizedBrief?.goals),
    ...ensureArray(normalizedBrief?.requiredAreas),
    ...ensureArray(normalizedBrief?.constraints),
  ].length;
  return originalLength >= 280 || structuredSignals >= 6;
};

const evaluateBuildTemplateQuality = ({ normalizedBrief, template }) => {
  const roles = ensureArray(template?.roles);
  const categories = ensureArray(template?.categories);
  const channels = ensureArray(template?.channels);
  const embeds = ensureArray(template?.welcomeEmbeds);
  const searchableAreas = [...categories, ...channels];
  const checks = [];
  const warnings = [];
  const missingSignals = [];
  const contradictions = [];
  let score = 100;

  const explicitRoles = collectExplicitRoleSignals(normalizedBrief);
  explicitRoles.forEach((signal) => {
    if (signal === 'member' && roles.length === 0) {
      return;
    }

    const aliases = roleSignalAliases[signal] || [signal];
    const present = hasEntitySignal(roles, aliases);
    addCheck(checks, `role:${signal}`, present ? 'pass' : 'warning', present
      ? `Requested role signal "${signal}" is represented.`
      : `Requested role signal "${signal}" is missing.`);

    if (!present) {
      missingSignals.push(`role:${signal}`);
      score -= signal === 'member' ? 4 : 10;
    }
  });

  uniqueStrings(normalizedBrief?.requiredAreas).forEach((area) => {
    const aliases = areaSignalAliases[area] || [area];
    const present = area === 'voice'
      ? channels.some((channel) => channel?.type === 'voice') || hasEntitySignal(searchableAreas, aliases)
      : area === 'onboarding'
        ? embeds.length > 0 || hasEntitySignal(searchableAreas, aliases)
        : hasEntitySignal(searchableAreas, aliases);
    addCheck(checks, `area:${area}`, present ? 'pass' : 'warning', present
      ? `Required area "${area}" is represented.`
      : `Required area "${area}" is missing.`);

    if (!present) {
      missingSignals.push(`area:${area}`);
      score -= 10;
    }
  });

  uniqueStrings(normalizedBrief?.channelsMentioned).forEach((signal) => {
    const aliases = channelSignalAliases[signal] || [signal];
    const present = signal === 'voice'
      ? channels.some((channel) => channel?.type === 'voice')
      : hasEntitySignal(channels, aliases);

    if (!present) {
      missingSignals.push(`channel:${signal}`);
      score -= 7;
      addCheck(checks, `channel:${signal}`, 'warning', `Requested channel signal "${signal}" is missing.`);
    } else {
      addCheck(checks, `channel:${signal}`, 'pass', `Requested channel signal "${signal}" is represented.`);
    }
  });

  if (ensureArray(normalizedBrief?.supportHints).length) {
    const hasSupport = hasEntitySignal(channels, areaSignalAliases.support);
    addCheck(checks, 'support', hasSupport ? 'pass' : 'warning', hasSupport
      ? 'Requested support flow is represented.'
      : 'Support was requested but no support/ticket channel was found.');

    if (!hasSupport) {
      missingSignals.push('support');
      score -= 12;
    }
  }

  if (ensureArray(normalizedBrief?.onboardingHints).length || ensureArray(normalizedBrief?.goals).includes('clear-onboarding')) {
    const hasOnboarding = embeds.length > 0 || hasEntitySignal(channels, areaSignalAliases.onboarding);
    addCheck(checks, 'onboarding', hasOnboarding ? 'pass' : 'warning', hasOnboarding
      ? 'Requested onboarding is represented.'
      : 'Onboarding was requested but no onboarding channel or embed was found.');

    if (!hasOnboarding) {
      missingSignals.push('onboarding');
      score -= 12;
    }
  }

  const duplicateWarnings = [
    ...collectDuplicateWarnings(roles, 'roles'),
    ...collectDuplicateWarnings(categories, 'categories'),
    ...collectDuplicateWarnings(channels, 'channels'),
  ];
  warnings.push(...duplicateWarnings);
  score -= Math.min(15, duplicateWarnings.length * 5);

  const roleIds = new Set(roles.map(getInternalId).filter(Boolean));
  const categoryIds = new Set(categories.map(getInternalId).filter(Boolean));
  const permissionDiagnostics = collectPermissionDiagnostics(template, roleIds, categoryIds);
  warnings.push(...permissionDiagnostics.warnings);
  contradictions.push(...permissionDiagnostics.contradictions);
  score -= Math.min(30, permissionDiagnostics.contradictions.length * 15);
  score -= Math.min(15, permissionDiagnostics.warnings.length * 5);

  const expectsPrivateAreas = ensureArray(normalizedBrief?.permissionHints)
    .some((hint) => ['private-staff-areas', 'premium-separation'].includes(hint));

  if (expectsPrivateAreas) {
    const sensitiveChannels = channels.filter((channel) => /(staff|admin|premium|vip|private|prive)/.test(entityText(channel)));
    const unprotected = sensitiveChannels.filter((channel) => !hasEveryoneViewDeny(channel));

    if (!sensitiveChannels.length) {
      missingSignals.push('private-space');
      score -= 12;
      addCheck(checks, 'private-space', 'warning', 'Private access was requested but no sensitive channel was identified.');
    } else if (unprotected.length) {
      contradictions.push(`${unprotected.length} sensitive channel(s) do not explicitly deny view_channel to @everyone.`);
      score -= Math.min(20, unprotected.length * 8);
      addCheck(checks, 'private-access', 'warning', 'Some sensitive channels lack an explicit @everyone view deny.');
    } else {
      addCheck(checks, 'private-access', 'pass', 'Sensitive channels explicitly restrict @everyone access.');
    }
  }

  if (isDetailedBrief(normalizedBrief)) {
    const contentText = normalizeText(embeds.map((embed) => `${embed?.title || ''} ${embed?.description || ''}`).join(' '));
    const contextualSignals = uniqueStrings([
      normalizedBrief?.serverType,
      ...ensureArray(normalizedBrief?.goals),
      ...ensureArray(normalizedBrief?.requiredAreas),
    ]).filter((signal) => normalizeText(signal).split(' ').some((word) => word.length >= 5 && contentText.includes(word)));

    if (!embeds.length || (contentText.length < 100 && contextualSignals.length === 0)) {
      warnings.push('Onboarding content is too generic for the level of detail in the brief.');
      score -= 8;
      addCheck(checks, 'content-specificity', 'warning', 'Detailed brief has little contextual onboarding content.');
    } else {
      addCheck(checks, 'content-specificity', 'pass', 'Onboarding content reflects the detailed brief.');
    }
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const uniqueWarnings = uniqueStrings(warnings);
  const uniqueMissingSignals = uniqueStrings(missingSignals);
  const uniqueContradictions = uniqueStrings(contradictions);
  const status = finalScore < 60 || uniqueContradictions.length >= 2
    ? 'poor'
    : (finalScore < 90 || uniqueWarnings.length || uniqueMissingSignals.length || uniqueContradictions.length ? 'warning' : 'good');

  return {
    status,
    score: finalScore,
    checks,
    warnings: uniqueWarnings,
    missingSignals: uniqueMissingSignals,
    contradictions: uniqueContradictions,
  };
};

const writeBuildTemplateQualityDebugFile = ({ runId, evaluation }) => {
  if (isProduction() || !runId || !evaluation) {
    return null;
  }

  const safeRunId = String(runId).replace(/[^A-Za-z0-9_-]/g, '-');
  fs.mkdirSync(qualityDebugDirectoryPath, { recursive: true });
  const filePath = path.join(qualityDebugDirectoryPath, `${safeRunId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
  return filePath;
};

module.exports = {
  evaluateBuildTemplateQuality,
  writeBuildTemplateQualityDebugFile,
};
