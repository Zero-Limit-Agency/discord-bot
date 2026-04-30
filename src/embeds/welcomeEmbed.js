const { EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = (member) => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('Welcome to Zero Limit Agency')
  .setDescription(`Welcome ${member} to **${config.branding.name}**.`)
  .addFields(
    { name: 'Start Here', value: 'Check the rules, introduce yourself, and get ready to build.' },
    { name: 'Mindset', value: 'Discipline, execution, and no limits.' },
  )
  .setTimestamp();
