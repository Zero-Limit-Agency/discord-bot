const { audit } = require('../services/managed/audit');
module.exports = { name: 'roleUpdate', execute: (before, after) => audit(after.guild, 'role.update', null, after.id) };
