const assert = require('node:assert/strict');
const { EmbedBuilder } = require('discord.js');
const { _test } = require('../src/commands/build');

const createLargeEmbed = (title, fieldCount = 8) => new EmbedBuilder()
  .setTitle(title)
  .setDescription('D'.repeat(900))
  .addFields(Array.from({ length: fieldCount }, (_, index) => ({
    name: `Field ${index + 1}`,
    value: 'V'.repeat(900),
  })));

const embeds = [
  createLargeEmbed('BUILD PREPARED', 18),
  createLargeEmbed('BUILD PREVIEW'),
  createLargeEmbed('BUILD EXECUTION PLAN'),
  createLargeEmbed('PERMISSION OVERVIEW'),
  createLargeEmbed('BUILD DRY RUN'),
];

const normalized = _test.normalizeEmbedsForDiscord(embeds);
const totalCharacters = _test.countEmbedsCharacters(normalized);

assert.equal(normalized.length, 5, 'The final report should retain all summary embeds.');
assert.ok(totalCharacters <= 5800, `Embed report exceeds safe budget: ${totalCharacters}.`);
assert.equal(normalized.at(-1).data.title, 'BUILD DRY RUN');
assert.ok(normalized.every((embed) => (embed.data.fields || []).length <= 12));

console.log(`Build embed budget verification passed (${totalCharacters}/5800 characters).`);
