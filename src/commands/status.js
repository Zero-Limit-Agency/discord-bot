const { SlashCommandBuilder } = require('discord.js');

const formatUptime = (uptimeMs) => {
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the current bot status.'),
  async execute(interaction) {
    const ping = Math.max(0, Math.round(interaction.client.ws.ping));
    const uptime = formatUptime(process.uptime() * 1000);

    await interaction.reply({
      content: [
        '**Zero Limit Agency Bot Status**',
        'Status: online',
        `Ping: ${ping}ms`,
        `Uptime: ${uptime}`,
      ].join('\n'),
    });
  },
};
