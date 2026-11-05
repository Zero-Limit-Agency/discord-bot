const { audit } = require('../services/managed/audit');
module.exports = { name: 'channelDelete', execute: (channel) => channel.guild ? audit(channel.guild, 'channel.delete', null, channel.id) : undefined };
