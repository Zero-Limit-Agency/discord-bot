const { audit } = require('../services/managed/audit');
module.exports = { name: 'roleDelete', execute: (role) => audit(role.guild, 'role.delete', null, role.id) };
