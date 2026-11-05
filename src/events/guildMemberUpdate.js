const { audit } = require('../services/managed/audit');
module.exports = { name: 'guildMemberUpdate', execute: (before, after) => before.roles.cache.map((r) => r.id).sort().join(',') !== after.roles.cache.map((r) => r.id).sort().join(',') ? audit(after.guild, 'member.roles', null, after.id) : undefined };
