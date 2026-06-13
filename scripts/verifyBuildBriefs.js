const fs = require('node:fs');
const path = require('node:path');
const { normalizeBuildBrief } = require('../src/services/buildBriefNormalizer');

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
      attachment: null,
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
