const { memberEvent } = require('../services/managed/memberEvents');
module.exports = { name: 'guildMemberAdd', execute: (member) => memberEvent(member, 'welcome') };
