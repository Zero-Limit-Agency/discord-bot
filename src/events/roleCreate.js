const { audit } = require('../services/managed/audit');
module.exports = { name: 'roleCreate', execute: (role) => audit(role.guild, 'role.create', null, role.id) };
