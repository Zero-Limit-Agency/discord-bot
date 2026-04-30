const { EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = () => new EmbedBuilder()
  .setColor(config.branding.color)
  .setTitle('RULES')
  .setDescription('Respect the room. Protect the energy. Move like a closer.')
  .addFields(
    { name: '1. Respect', value: 'Stay respectful with every member, every time.' },
    { name: '2. No Spam', value: 'No flood, no repeated promo, no low-value noise.' },
    { name: '3. Confidentiality', value: 'What is shared inside the agency stays inside the agency.' },
    { name: '4. Add Value', value: 'Keep messages useful, clear, and action-oriented.' },
    { name: '5. Follow Staff', value: 'Moderator decisions are final inside this server.' },
  )
  .setFooter({ text: config.branding.footer });