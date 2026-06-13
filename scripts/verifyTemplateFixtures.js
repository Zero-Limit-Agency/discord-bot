const fs = require('node:fs');
const path = require('node:path');
const { normalizeTemplate } = require('../src/services/templateNormalizer');
const { repairTemplate } = require('../src/services/templateRepairService');
const { validateTemplate } = require('../src/services/discordTemplateService');

const fixturesDirectoryPath = path.join(process.cwd(), 'templates', 'fixtures');

const fixtureFiles = fs.readdirSync(fixturesDirectoryPath)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort();

let hasFailure = false;

fixtureFiles.forEach((fileName) => {
  const filePath = path.join(fixturesDirectoryPath, fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const normalized = normalizeTemplate(parsed);

  if (!normalized.ok) {
    hasFailure = true;
    console.error(`[FAIL] ${fileName}: normalization failed -> ${normalized.message}`);
    return;
  }

  const repaired = repairTemplate(normalized.normalizedTemplate);
  const candidate = repaired.ok ? repaired.repairedTemplate : normalized.normalizedTemplate;
  const validation = validateTemplate(candidate);

  if (!validation.isValid) {
    hasFailure = true;
    console.error(`[FAIL] ${fileName}: validation failed`);
    validation.errors.forEach((error) => console.error(`  - ${error}`));
    return;
  }

  console.log(`[PASS] ${fileName}`);
});

if (hasFailure) {
  process.exitCode = 1;
}
