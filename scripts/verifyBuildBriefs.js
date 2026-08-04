const fs = require('node:fs');
const path = require('node:path');
const {
  createAgentBrief,
  normalizeBuildBrief,
  prepareBuildBriefSource,
} = require('../src/services/buildBriefNormalizer');
const { buildArchitectAgentRequest } = require('../src/services/buildAgents/architectAgent');

const fixturesDirectoryPath = path.join(process.cwd(), 'templates', 'brief-fixtures');

const includesAll = (values, expectedValues) => expectedValues.every((expectedValue) => values.includes(expectedValue));

let hasFailure = false;

fs.readdirSync(fixturesDirectoryPath)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .forEach((fileName) => {
    const filePath = path.join(fixturesDirectoryPath, fileName);
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = normalizeBuildBrief({
      prompt: fixture.prompt,
      attachment: fixture.attachmentText
        ? { filename: 'fixture.txt', text: fixture.attachmentText }
        : null,
    });

    if (!result.normalizedBrief) {
      hasFailure = true;
      console.error(`[FAIL] ${fileName}: no normalized brief returned.`);
      return;
    }

    const brief = result.normalizedBrief;
    const failures = [];

    if (fixture.expected.serverType && brief.serverType !== fixture.expected.serverType) {
      failures.push(`Expected serverType=${fixture.expected.serverType} but got ${brief.serverType}.`);
    }

    if (fixture.expected.tone && brief.tone !== fixture.expected.tone) {
      failures.push(`Expected tone=${fixture.expected.tone} but got ${brief.tone}.`);
    }

    if (fixture.expected.requiredAreasIncludes && !includesAll(brief.requiredAreas, fixture.expected.requiredAreasIncludes)) {
      failures.push('Missing expected required areas.');
    }

    if (fixture.expected.rolesMentionedIncludes && !includesAll(brief.rolesMentioned, fixture.expected.rolesMentionedIncludes)) {
      failures.push('Missing expected rolesMentioned entries.');
    }

    if (fixture.expected.channelsMentionedIncludes && !includesAll(brief.channelsMentioned, fixture.expected.channelsMentionedIncludes)) {
      failures.push('Missing expected channelsMentioned entries.');
    }

    if (fixture.expected.permissionHintsIncludes && !includesAll(brief.permissionHints, fixture.expected.permissionHintsIncludes)) {
      failures.push('Missing expected permissionHints entries.');
    }

    if (fixture.expected.supportHintsIncludes && !includesAll(brief.supportHints, fixture.expected.supportHintsIncludes)) {
      failures.push('Missing expected supportHints entries.');
    }

    if (fixture.expected.goalsIncludes && !includesAll(brief.goals, fixture.expected.goalsIncludes)) {
      failures.push('Missing expected goals entries.');
    }

    if (fixture.expected.assumptionsMin && brief.assumptions.length < fixture.expected.assumptionsMin) {
      failures.push(`Expected at least ${fixture.expected.assumptionsMin} assumptions.`);
    }

    if (fixture.expected.missingButUsefulMin && brief.missingButUseful.length < fixture.expected.missingButUsefulMin) {
      failures.push(`Expected at least ${fixture.expected.missingButUsefulMin} missingButUseful entries.`);
    }

    if (fixture.expected.contradictionsMin && brief.contradictions.length < fixture.expected.contradictionsMin) {
      failures.push(`Expected at least ${fixture.expected.contradictionsMin} contradiction(s).`);
    }

    if (fixture.expected.duplicateChunksRemovedMin
      && (result.sourceMetadata?.duplicateChunksRemoved || 0) < fixture.expected.duplicateChunksRemovedMin) {
      failures.push(`Expected at least ${fixture.expected.duplicateChunksRemovedMin} duplicate chunk(s) to be removed.`);
    }

    if ((result.agentSourceText || '').length > (result.sourceMetadata?.maxCharacters || 60000)) {
      failures.push('Prepared agent brief exceeds its configured character limit.');
    }

    if (result.agentSourceText && /originalPrompt/.test(result.agentSourceText)) {
      failures.push('Prepared agent brief unexpectedly contains serialized normalized brief fields.');
    }

    if (!brief.summary || brief.summary.length < 10) {
      failures.push('Summary is too short or missing.');
    }

    if (failures.length) {
      hasFailure = true;
      console.error(`[FAIL] ${fileName}`);
      failures.forEach((failure) => console.error(`  - ${failure}`));
      return;
    }

    console.log(`[PASS] ${fileName}`);
  });

if (hasFailure) {
  process.exitCode = 1;
}

const longSource = prepareBuildBriefSource({
  prompt: `BEGIN-BRIEF ${'details '.repeat(12000)} FINAL-CONSTRAINT`,
  attachmentText: '',
  maxCharacters: 2000,
});

if (!longSource.metadata.truncated
  || longSource.agentSourceText.length > 2000
  || !longSource.agentSourceText.startsWith('BEGIN-BRIEF')
  || !longSource.agentSourceText.includes('FINAL-CONSTRAINT')) {
  console.error('[FAIL] long brief compaction did not preserve the beginning, end and configured limit.');
  process.exitCode = 1;
} else {
  console.log('[PASS] long brief compaction preserves beginning and end');
}

const compactAgentBrief = createAgentBrief({
  originalPrompt: 'This raw prompt must not be copied into downstream agent context.',
  summary: 'Compact summary.',
  constraints: ['Keep private areas protected.'],
});

if (Object.prototype.hasOwnProperty.call(compactAgentBrief, 'originalPrompt')) {
  console.error('[FAIL] downstream agent brief still contains originalPrompt.');
  process.exitCode = 1;
} else {
  console.log('[PASS] downstream agent brief excludes originalPrompt');
}

const architectRequest = buildArchitectAgentRequest({
  prompt: longSource.originalText,
  attachment: null,
  normalizedBrief: {
    originalPrompt: longSource.originalText,
    summary: 'A deliberately long build brief.',
    constraints: ['Preserve the final constraint.'],
  },
  preparedBriefText: longSource.agentSourceText,
  skillsBlock: null,
  model: 'fixture-model',
});
const serializedArchitectRequest = JSON.stringify(architectRequest);

if (serializedArchitectRequest.includes('originalPrompt') || serializedArchitectRequest.length > 10000) {
  console.error('[FAIL] architect request still contains the full original brief or exceeds the compact test limit.');
  process.exitCode = 1;
} else {
  console.log('[PASS] architect request uses compact source without serialized originalPrompt');
}

const accentedFrenchBrief = normalizeBuildBrief({
  prompt: 'Je crée une communauté privée pour des créateurs. Il faut des règles, un accès VIP et un accueil soigné.',
  attachment: null,
}).normalizedBrief;

if (accentedFrenchBrief.serverType !== 'content-creator'
  || !accentedFrenchBrief.requiredAreas.includes('onboarding')
  || !accentedFrenchBrief.requiredAreas.includes('premium-private')
  || !accentedFrenchBrief.permissionHints.includes('private-staff-areas')) {
  console.error('[FAIL] correctly accented French brief lost important signals.');
  process.exitCode = 1;
} else {
  console.log('[PASS] correctly accented French brief preserves creator, onboarding and private signals');
}
