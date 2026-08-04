const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const debugDirectoryPath = path.join(process.cwd(), 'debug', 'build-briefs');

const isProduction = () => process.env.NODE_ENV === 'production';
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizeForDetection = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const uniqueStrings = (values = []) => {
  const seen = new Set();

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .filter((value) => {
      const normalized = value.toLowerCase();

      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
};

const createSummary = (text) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  if (normalized.length <= 280) {
    return normalized;
  }

  const start = normalized.slice(0, 185).trimEnd();
  const end = normalized.slice(-85).trimStart();
  return `${start} ... ${end}`;
};

const normalizeChunkKey = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const splitSourceChunks = (text) => String(text || '')
  .split(/\n+/)
  .flatMap((line) => line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [])
  .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const trimAtWordBoundary = (value, maxLength, fromEnd = false) => {
  if (value.length <= maxLength) {
    return value;
  }

  const slice = fromEnd ? value.slice(-maxLength) : value.slice(0, maxLength);
  const boundary = fromEnd ? slice.indexOf(' ') : slice.lastIndexOf(' ');

  if (boundary < Math.floor(maxLength * 0.5)) {
    return slice;
  }

  return fromEnd ? slice.slice(boundary + 1) : slice.slice(0, boundary);
};

const prepareBuildBriefSource = ({ prompt, attachmentText, maxCharacters = config.buildBriefMaxChars }) => {
  const sourceSections = [prompt, attachmentText]
    .map((value) => (isNonEmptyString(value) ? value.trim() : ''))
    .filter(Boolean);
  const originalText = sourceSections.join('\n\n');
  const seen = new Set();
  let duplicateChunksRemoved = 0;
  const uniqueChunks = [];

  splitSourceChunks(originalText).forEach((chunk) => {
    const key = normalizeChunkKey(chunk);

    if (seen.has(key)) {
      duplicateChunksRemoved += 1;
      return;
    }

    seen.add(key);
    uniqueChunks.push(chunk);
  });

  const deduplicatedText = uniqueChunks.join('\n');
  const safeMaxCharacters = Number.isFinite(maxCharacters) && maxCharacters >= 2000
    ? Math.trunc(maxCharacters)
    : 60000;
  let agentSourceText = deduplicatedText;
  let truncated = false;

  if (agentSourceText.length > safeMaxCharacters) {
    const marker = '\n\n[... middle of brief omitted for context limit ...]\n\n';
    const available = safeMaxCharacters - marker.length;
    const headLength = Math.floor(available * 0.6);
    const tailLength = available - headLength;
    agentSourceText = [
      trimAtWordBoundary(deduplicatedText, headLength),
      marker,
      trimAtWordBoundary(deduplicatedText, tailLength, true),
    ].join('').slice(0, safeMaxCharacters);
    truncated = true;
  }

  const warnings = [];

  if (duplicateChunksRemoved) {
    warnings.push(`${duplicateChunksRemoved} repeated brief section(s) were removed before generation.`);
  }

  if (truncated) {
    warnings.push(`The agent brief was limited to ${safeMaxCharacters} characters while preserving its beginning and end.`);
  }

  return {
    originalText,
    agentSourceText,
    warnings,
    metadata: {
      originalCharacters: originalText.length,
      preparedCharacters: agentSourceText.length,
      duplicateChunksRemoved,
      truncated,
      maxCharacters: safeMaxCharacters,
    },
  };
};

const splitSentences = (text) => String(text || '')
  .split(/[\n.!?]+/)
  .map((chunk) => chunk.trim())
  .filter(Boolean);

const detectServerType = (text) => {
  const normalized = normalizeForDetection(text);

  if (/(esport|scrim|tournoi|tournament|team|joueur|player)/.test(normalized)) {
    return 'esports';
  }

  if (/(creator|createur|créateur|contenu|content creator|stream|youtube|tiktok)/.test(normalized)) {
    return 'content-creator';
  }

  if (/(premium|vip|prive|private|exclusive)/.test(normalized)) {
    return 'premium-community';
  }

  if (/(community|communaute|communauté|members|public)/.test(normalized)) {
    return 'community';
  }

  if (/(agency|agence|client|service)/.test(normalized)) {
    return 'agency';
  }

  return 'general';
};

const extractMatches = (text, patterns) => uniqueStrings(
  patterns
    .filter(({ regex }) => regex.test(text) || regex.test(normalizeForDetection(text)))
    .map(({ value }) => value),
);

const detectRequiredAreas = (text) => extractMatches(text, [
  { regex: /(public|communaute|communauté|community|membres)/i, value: 'public-community' },
  { regex: /(staff|moderation|admin|management|direction)/i, value: 'staff-operations' },
  { regex: /(joueur|player|team|scrim|training)/i, value: 'team-operations' },
  { regex: /(support|ticket|help)/i, value: 'support' },
  { regex: /(welcome|onboarding|rules|regles|accueil|accueillir|nouveaux)/i, value: 'onboarding' },
  { regex: /(voice|vocal|calls?)/i, value: 'voice' },
  { regex: /(premium|vip|private|prive)/i, value: 'premium-private' },
  { regex: /(media|médias|medias|content|clip|annonce|announcement)/i, value: 'media-announcements' },
]);

const detectRolesMentioned = (text) => extractMatches(text, [
  { regex: /(owner|fondateur|founder|direction)/i, value: 'owner' },
  { regex: /(admin|administrateur)/i, value: 'admin' },
  { regex: /(staff|moderation|moderateur|mod)/i, value: 'staff' },
  { regex: /(manager|coach)/i, value: 'manager' },
  { regex: /(joueur|player)/i, value: 'player' },
  { regex: /(creator|createur|streamer)/i, value: 'creator' },
  { regex: /(premium|vip)/i, value: 'premium' },
  { regex: /(partner|partenaire|sponsor)/i, value: 'partner' },
  { regex: /(member|membre|community|communaute|communauté)/i, value: 'member' },
]);

const detectChannelsMentioned = (text) => extractMatches(text, [
  { regex: /(welcome|bienvenue)/i, value: 'welcome' },
  { regex: /(rules|regles)/i, value: 'rules' },
  { regex: /(announcements|annonces)/i, value: 'announcements' },
  { regex: /(support|ticket)/i, value: 'support' },
  { regex: /(media|médias|medias|clips?)/i, value: 'media' },
  { regex: /(scrim|training|practice)/i, value: 'scrims' },
  { regex: /(voice|vocal)/i, value: 'voice' },
  { regex: /(premium|vip)/i, value: 'premium' },
]);

const detectAudience = (text) => extractMatches(text, [
  { regex: /(public|communaute|communauté|community|member|membre)/i, value: 'public-members' },
  { regex: /(staff|moderation|admin)/i, value: 'staff-team' },
  { regex: /(joueur|player|team)/i, value: 'players' },
  { regex: /(creator|createur|streamer)/i, value: 'creators' },
  { regex: /(premium|vip)/i, value: 'premium-members' },
]);

const detectGoals = (text) => extractMatches(text, [
  { regex: /(grow|croissance|community|communaute)/i, value: 'community-growth' },
  { regex: /(support|ticket|help)/i, value: 'member-support' },
  { regex: /(professional|premium|propre|serieux)/i, value: 'premium-presentation' },
  { regex: /(coordination|staff|operations)/i, value: 'internal-coordination' },
  { regex: /(onboarding|welcome|rules|regles|accueillir|nouveaux|new members)/i, value: 'clear-onboarding' },
  { regex: /(content|media|médias|medias|stream)/i, value: 'content-publishing' },
]);

const detectTone = (text) => {
  const normalized = normalizeForDetection(text);

  if (/(premium|high-end|haut de gamme|luxueux)/.test(normalized)) {
    return 'premium';
  }

  if (/(friendly|convivial|chill|detendu|détendu)/.test(normalized)) {
    return 'friendly';
  }

  if (/(serious|professionnel|professional|strict)/.test(normalized)) {
    return 'professional';
  }

  return 'professional';
};

const detectPermissionHints = (text) => extractMatches(text, [
  { regex: /@everyone|everyone|public tres limite|public très limité|public limite|public limité/i, value: '@everyone-limited' },
  { regex: /(private|prive|privé|staff only|reserve staff|zone staff|staff prive|staff privé)/i, value: 'private-staff-areas' },
  { regex: /(read only|lecture seule|announcements only)/i, value: 'read-only-info' },
  { regex: /(premium|vip)/i, value: 'premium-separation' },
]);

const detectOnboardingHints = (text) => extractMatches(text, [
  { regex: /(welcome|bienvenue|accueil)/i, value: 'welcome-message' },
  { regex: /(rules|regles)/i, value: 'rules-channel' },
  { regex: /(onboarding|start here|commencer)/i, value: 'guided-onboarding' },
  { regex: /(verification|verification)/i, value: 'verification-step' },
]);

const detectSupportHints = (text) => extractMatches(text, [
  { regex: /(support|help)/i, value: 'support-channel' },
  { regex: /(ticket|tickets)/i, value: 'ticket-flow' },
  { regex: /(faq|knowledge base|resource)/i, value: 'support-resources' },
]);

const detectConstraints = (text) => {
  const constraints = [];
  const normalized = normalizeForDetection(text);
  const sentences = splitSentences(text);

  if (/(no local|zero local|0 local)/.test(normalized)) {
    constraints.push('No local dependency should remain.');
  }

  if (/(premium|professional|propre|serieux)/.test(normalized)) {
    constraints.push('The server should feel professional and premium.');
  }

  if (/(private|prive|staff only)/.test(normalized)) {
    constraints.push('Private areas should be isolated from public members.');
  }

  sentences.forEach((sentence) => {
    if (/(must|doit|important|obligatoire|need|besoin)/i.test(sentence) && sentence.length <= 160) {
      constraints.push(sentence);
    }
  });

  return uniqueStrings(constraints).slice(0, 8);
};

const detectContradictions = (text) => {
  const normalized = normalizeForDetection(text);
  const contradictions = [];
  const hasBoth = (negativePattern, positivePattern, message) => {
    if (negativePattern.test(normalized) && positivePattern.test(normalized)) {
      contradictions.push(message);
    }
  };

  hasBoth(
    /(pas de|sans|no)\s+(systeme de\s+)?tickets?/,
    /(tickets?\s+(obligatoire|necessaire|required)|il faut[^.!?]*tickets?)/,
    'The brief both rejects and requires a ticket system.',
  );
  hasBoth(
    /(pas de|sans|no)\s+(salons?\s+)?(voice|vocal|vocaux)/,
    /(il faut[^.!?]*(voice|vocal|vocaux)|salons?\s+vocaux\s+(obligatoires?|necessaires?))/,
    'The brief both rejects and requires voice channels.',
  );
  hasBoth(
    /(serveur|espace)\s+(entierement\s+)?(public|ouvert a tous)/,
    /(serveur|espace)\s+(entierement\s+)?(prive|ferme)|acces\s+uniquement\s+sur\s+invitation/,
    'The brief describes the whole server as both public and private.',
  );

  return uniqueStrings(contradictions);
};

const createAgentBrief = (normalizedBrief) => {
  if (!normalizedBrief || typeof normalizedBrief !== 'object') {
    return null;
  }

  return {
    summary: normalizedBrief.summary || '',
    serverType: normalizedBrief.serverType || 'general',
    audience: uniqueStrings(normalizedBrief.audience || []),
    goals: uniqueStrings(normalizedBrief.goals || []),
    tone: normalizedBrief.tone || 'professional',
    requiredAreas: uniqueStrings(normalizedBrief.requiredAreas || []),
    rolesMentioned: uniqueStrings(normalizedBrief.rolesMentioned || []),
    channelsMentioned: uniqueStrings(normalizedBrief.channelsMentioned || []),
    permissionHints: uniqueStrings(normalizedBrief.permissionHints || []),
    onboardingHints: uniqueStrings(normalizedBrief.onboardingHints || []),
    supportHints: uniqueStrings(normalizedBrief.supportHints || []),
    constraints: uniqueStrings(normalizedBrief.constraints || []),
    assumptions: uniqueStrings(normalizedBrief.assumptions || []),
    contradictions: uniqueStrings(normalizedBrief.contradictions || []),
  };
};

const detectMissingButUseful = ({
  requiredAreas,
  rolesMentioned,
  channelsMentioned,
  supportHints,
  onboardingHints,
}) => {
  const suggestions = [];

  if (!requiredAreas.includes('onboarding')) {
    suggestions.push('Clarify whether a dedicated onboarding area is expected.');
  }

  if (!rolesMentioned.includes('staff')) {
    suggestions.push('Clarify who manages moderation and operations.');
  }

  if (!channelsMentioned.includes('announcements')) {
    suggestions.push('Clarify whether announcements should be separated from chat.');
  }

  if (!supportHints.length) {
    suggestions.push('Clarify whether support or ticket handling is needed.');
  }

  if (!onboardingHints.length) {
    suggestions.push('Clarify the desired onboarding depth.');
  }

  return uniqueStrings(suggestions).slice(0, 5);
};

const detectAssumptions = ({
  serverType,
  tone,
  requiredAreas,
  rolesMentioned,
  channelsMentioned,
}) => {
  const assumptions = [];

  if (!rolesMentioned.length) {
    assumptions.push('A minimal member/staff role structure will likely be needed.');
  }

  if (!channelsMentioned.includes('welcome') && requiredAreas.includes('onboarding')) {
    assumptions.push('A welcome or start-here channel will likely be needed.');
  }

  if (serverType === 'esports' && !requiredAreas.includes('team-operations')) {
    assumptions.push('Team operations spaces may still be useful for an esports server.');
  }

  if (tone === 'premium') {
    assumptions.push('Clean naming and controlled public access are likely expected.');
  }

  if (!requiredAreas.includes('support')) {
    assumptions.push('A lightweight support flow may still be useful if members need help.');
  }

  return uniqueStrings(assumptions).slice(0, 6);
};

const createFallbackBrief = (originalPrompt, warning) => ({
  ok: false,
  mode: 'fallback',
  warning,
  normalizedBrief: {
    originalPrompt,
    summary: createSummary(originalPrompt),
    serverType: 'general',
    audience: [],
    goals: [],
    tone: 'professional',
    requiredAreas: [],
    rolesMentioned: [],
    channelsMentioned: [],
    permissionHints: [],
    onboardingHints: [],
    supportHints: [],
    constraints: [],
    missingButUseful: [],
    assumptions: [],
    contradictions: [],
  },
  agentSourceText: originalPrompt,
  sourceWarnings: warning ? [warning] : [],
  sourceMetadata: {
    originalCharacters: String(originalPrompt || '').length,
    preparedCharacters: String(originalPrompt || '').length,
    duplicateChunksRemoved: 0,
    truncated: false,
    maxCharacters: config.buildBriefMaxChars,
  },
});

const normalizeBuildBrief = ({ prompt, attachment }) => {
  try {
    const promptText = isNonEmptyString(prompt) ? prompt.trim() : '';
    const attachmentText = isNonEmptyString(attachment?.text) ? attachment.text.trim() : '';
    const preparedSource = prepareBuildBriefSource({
      prompt: promptText,
      attachmentText,
    });
    const originalPrompt = preparedSource.originalText;

    if (!originalPrompt) {
      return createFallbackBrief('', 'No usable brief content was available.');
    }

    const summary = createSummary(originalPrompt);
    const serverType = detectServerType(originalPrompt);
    const audience = detectAudience(originalPrompt);
    const goals = detectGoals(originalPrompt);
    const tone = detectTone(originalPrompt);
    const requiredAreas = detectRequiredAreas(originalPrompt);
    const rolesMentioned = detectRolesMentioned(originalPrompt);
    const channelsMentioned = detectChannelsMentioned(originalPrompt);
    const permissionHints = detectPermissionHints(originalPrompt);
    const onboardingHints = detectOnboardingHints(originalPrompt);
    const supportHints = detectSupportHints(originalPrompt);
    const constraints = detectConstraints(originalPrompt);
    const contradictions = detectContradictions(originalPrompt);
    const missingButUseful = detectMissingButUseful({
      requiredAreas,
      rolesMentioned,
      channelsMentioned,
      supportHints,
      onboardingHints,
    });
    const assumptions = detectAssumptions({
      serverType,
      tone,
      requiredAreas,
      rolesMentioned,
      channelsMentioned,
    });

    return {
      ok: true,
      mode: 'normalized',
      warning: null,
      normalizedBrief: {
        originalPrompt,
        summary,
        serverType,
        audience,
        goals,
        tone,
        requiredAreas,
        rolesMentioned,
        channelsMentioned,
        permissionHints,
        onboardingHints,
        supportHints,
        constraints,
        missingButUseful,
        assumptions,
        contradictions,
      },
      agentSourceText: preparedSource.agentSourceText,
      sourceWarnings: preparedSource.warnings,
      sourceMetadata: preparedSource.metadata,
    };
  } catch (error) {
    return createFallbackBrief(prompt, 'Brief normalization failed unexpectedly. The original prompt will be used.');
  }
};

const writeNormalizedBriefDebugFile = ({ runId, normalizedBrief, metadata = {} }) => {
  if (isProduction()) {
    return null;
  }

  const effectiveRunId = isNonEmptyString(runId)
    ? runId.trim()
    : new Date().toISOString().replace(/[:.]/g, '-');
  const runDirectoryPath = path.join(debugDirectoryPath, effectiveRunId);
  fs.mkdirSync(runDirectoryPath, { recursive: true });
  const filePath = path.join(runDirectoryPath, 'normalized-brief.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    ...metadata,
    normalizedBrief,
  }, null, 2)}\n`, 'utf8');
  return filePath;
};

module.exports = {
  createAgentBrief,
  normalizeBuildBrief,
  prepareBuildBriefSource,
  writeNormalizedBriefDebugFile,
};
