const { voiceUpdate } = require('../services/managed/voice');
module.exports = { name: 'voiceStateUpdate', execute: voiceUpdate };
