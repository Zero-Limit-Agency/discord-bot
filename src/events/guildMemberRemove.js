const { memberEvent } = require('../services/managed/memberEvents');
module.exports = { name: 'guildMemberRemove', execute: (member) => memberEvent(member, 'goodbye') };
