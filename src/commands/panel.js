const { SlashCommandBuilder, PermissionFlagsBits: P, MessageFlags, ChannelType } = require('discord.js');
const { requireAdmin, requireFeature } = require('../services/managed/access');
const { panelPayload } = require('../services/managed/adminPanel');
module.exports = {
  data: new SlashCommandBuilder().setName('panel').setDescription('Panneau administration Zero Limit.').setDMPermission(false).setDefaultMemberPermissions(P.Administrator).addChannelOption((o) => o.setName('channel').setDescription('Publier un panel persistant dans ce salon (optionnel).').addChannelTypes(ChannelType.GuildText)),
  async execute(i) {
    await requireAdmin(i); requireFeature(i.guildId, 'panel');
    const target = i.options.getChannel?.('channel');
    if (target) {
      if (target.guildId !== i.guildId) throw new Error('Salon hors serveur.');
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await require('../services/managed/messages').sendVerified(target, panelPayload(i.guildId));
      await i.editReply({ content: 'Panel persistant publié. Chaque action reste réservée aux administrateurs.' });
    } else await i.reply({ ...panelPayload(i.guildId), flags: MessageFlags.Ephemeral });
  },
};
