const { audit } = require('../services/managed/audit');
module.exports = { name: 'channelCreate', execute: (channel) => channel.guild ? audit(channel.guild, 'channel.create', null, channel.id) : undefined };
