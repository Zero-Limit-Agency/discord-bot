const { audit } = require('../services/managed/audit');
module.exports = { name: 'channelUpdate', execute: (before, after) => after.guild ? audit(after.guild, 'channel.update', null, after.id) : undefined };
