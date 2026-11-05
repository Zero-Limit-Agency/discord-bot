const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { requireOwner } = require('../services/managed/access');
const { getBuildJob } = require('../services/buildJobService');
const { formatBuildProgressContent } = require('../services/buildProgressReporter');
module.exports = {
  data: new SlashCommandBuilder().setName('build-status').setDescription('Consulter un build persistant.').setDMPermission(false).addStringOption((o) => o.setName('run').setDescription('Identifiant du run').setRequired(true)),
  async execute(i) {
    requireOwner(i);
    const job = getBuildJob(i.options.getString('run', true));
    if (!job || job.guildId !== i.guildId) throw new Error('Build introuvable sur ce serveur.');
    await i.reply({ content: formatBuildProgressContent(job), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};
