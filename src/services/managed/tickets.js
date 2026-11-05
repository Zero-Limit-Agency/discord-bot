const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { store, serial } = require('../../repositories/commercialStore');
const { requireFeature, enabled } = require('./access');
const { audit } = require('./audit');
const transcriptRoot = path.join(process.cwd(), '.data', 'commercial', 'transcripts');
const controls = (id) => new ActionRowBuilder().addComponents(['claim', 'unclaim', 'close', 'reopen', 'transcript'].map((action) => new ButtonBuilder().setCustomId(`zl:ticket:${action}:${id}`).setLabel(action).setStyle(action === 'close' ? ButtonStyle.Danger : ButtonStyle.Secondary)));
const panel = (settings) => [new ActionRowBuilder().addComponents(settings.types.map((type) => new ButtonBuilder().setCustomId(`zl:ticket:open:${type.id}`).setLabel(type.label).setStyle(ButtonStyle.Primary)))];
const ticketConfig = (guildId) => {
  requireFeature(guildId, 'tickets');
  const config = store.read(guildId).features.tickets;
  if (!config?.enabled) throw new Error('Tickets désactivés.');
  return config;
};
const staff = (member, ticket) => member.permissions.has(P.Administrator) || ticket.staffRoleIds.some((id) => member.roles.cache.has(id));
const transcript = async (channel, ticket) => {
  const rows = [];
  let before;
  let truncated = true;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    for (const msg of batch.values()) rows.push({ id: msg.id, at: msg.createdAt.toISOString(), authorId: msg.author.id, content: msg.content, embeds: msg.embeds.map((e) => ({ title: e.title, description: e.description, fields: e.fields })), attachments: msg.attachments.map((a) => ({ name: a.name, size: a.size })) });
    if (batch.size < 100) { truncated = false; break; }
    before = batch.last().id;
  }
  const directory = path.join(transcriptRoot, channel.guild.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${ticket.id}.json`);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ticketId: ticket.id, guildId: channel.guild.id, truncated, note: 'At most 1000 messages; attachment metadata only. Message Content intent needed for member content.', messages: rows.reverse() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
  return target;
};
const handleTicket = async (i) => {
  const [, , action, id] = i.customId.split(':');
  const config = ticketConfig(i.guildId);
  if (action === 'open') {
    if (!config.types.some((t) => t.id === id)) throw new Error('Type de ticket absent.');
    const modal = new ModalBuilder().setCustomId(`zl:ticket:submit:${id}`).setTitle('Ouvrir un ticket');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('Votre demande').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)));
    await i.showModal(modal);
    return;
  }
  await i.deferReply({ flags: 64 });
  await serial(`${i.guildId}:tickets`, async () => {
    const config = ticketConfig(i.guildId); // Recheck after waiting for concurrent requests.
    const member = await i.guild.members.fetch(i.user.id);
    if (action === 'submit') {
      const type = config.types.find((t) => t.id === id);
      if (!type) throw new Error('Type de ticket absent.');
      const state = store.read(i.guildId);
      if (Object.values(state.tickets).filter((t) => t.ownerId === i.user.id && t.status !== 'closed' && t.status !== 'missing').length >= config.maxOpen) throw new Error('Limite de tickets ouverts atteinte.');
      const ticketId = randomUUID();
      const ticket = { id: ticketId, ownerId: i.user.id, type: id, staffRoleIds: config.staffRoleIds, status: 'creating', createdAt: new Date().toISOString(), channelId: null };
      // Persist intent before API creation. Channel topic allows recovery after an interrupted request.
      store.update(i.guildId, (s) => { s.tickets[ticketId] = ticket; });
      let channel;
      try {
        const parent = await i.guild.channels.fetch(type.categoryId || config.categoryId);
        if (!parent || parent.type !== ChannelType.GuildCategory) throw new Error('Catégorie tickets supprimée.');
        const me = i.guild.members.me || await i.guild.members.fetchMe();
        const staffRoles = [];
        for (const roleId of config.staffRoleIds) {
          const role = await i.guild.roles.fetch(roleId);
          if (!role || role.id === i.guildId) throw new Error('Rôle staff supprimé ou invalide.');
          staffRoles.push({ id: roleId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] });
        }
        requireFeature(i.guildId, 'tickets');
        channel = await i.guild.channels.create({ name: `ticket-${i.user.username}`.slice(0, 80), type: ChannelType.GuildText, parent: parent.id, topic: `zero-limit-ticket:${ticketId}`, permissionOverwrites: [
          { id: i.guildId, deny: [P.ViewChannel] },
          { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.EmbedLinks, P.AttachFiles] },
          { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }, ...staffRoles,
        ], reason: 'Zero Limit ticket' });
        store.update(i.guildId, (s) => { s.tickets[ticketId].channelId = channel.id; s.tickets[ticketId].status = 'open'; });
        const controlMessage = await channel.send({ content: `Demande de <@${i.user.id}>\n${i.fields.getTextInputValue('subject')}`.slice(0, 1900), components: [controls(ticketId)], allowedMentions: { parse: [] } });
        store.update(i.guildId, (s) => { s.tickets[ticketId].controlMessageId = controlMessage.id; });
        await audit(i.guild, 'ticket.open', i.user.id, channel.id);
        await i.editReply({ content: `Ticket créé : <#${channel.id}>` });
      } catch (error) {
        if (!channel) store.update(i.guildId, (s) => { s.tickets[ticketId].lastError = 'Creation interrupted; startup reconciliation required.'; });
        throw error;
      }
      return;
    }
    const ticket = store.read(i.guildId).tickets[id];
    if (!ticket || ticket.channelId !== i.channelId) throw new Error('Ticket absent de ce salon/serveur.');
    requireFeature(i.guildId, 'tickets');
    const isStaff = staff(member, ticket);
    if (!isStaff && !(action === 'close' && ticket.ownerId === i.user.id)) throw new Error('Action réservée au staff du ticket.');
    if (action === 'claim') {
      if (ticket.status !== 'open' || (ticket.claimedBy && ticket.claimedBy !== i.user.id)) throw new Error('Ticket fermé ou déjà attribué.');
      store.update(i.guildId, (s) => { s.tickets[id].claimedBy = i.user.id; });
    } else if (action === 'unclaim') {
      if (ticket.claimedBy && ticket.claimedBy !== i.user.id && !member.permissions.has(P.Administrator)) throw new Error('Seul le staff assigné ou un administrateur peut libérer ce ticket.');
      store.update(i.guildId, (s) => { s.tickets[id].claimedBy = null; });
    } else if (action === 'close') {
      if (ticket.status !== 'open') throw new Error('Ticket déjà fermé.');
      await transcript(i.channel, ticket); // Failure keeps the ticket open and data intact.
      await i.channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false });
      store.update(i.guildId, (s) => { s.tickets[id].status = 'closed'; s.tickets[id].closedAt = new Date().toISOString(); });
    } else if (action === 'reopen') {
      if (ticket.status !== 'closed') throw new Error('Ticket non fermé.');
      const count = Object.values(store.read(i.guildId).tickets).filter((t) => t.ownerId === ticket.ownerId && ['creating', 'open'].includes(t.status)).length;
      if (count >= config.maxOpen) throw new Error('Limite de tickets ouverts atteinte.');
      await i.channel.permissionOverwrites.edit(ticket.ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      store.update(i.guildId, (s) => { s.tickets[id].status = 'open'; });
    } else if (action === 'transcript') {
      const target = await transcript(i.channel, ticket);
      await i.editReply({ content: 'Transcription privée (1000 messages maximum, métadonnées des pièces jointes).', files: [new AttachmentBuilder(target, { name: 'transcript.json' })] });
      await audit(i.guild, 'ticket.transcript', i.user.id, i.channelId);
      return;
    } else throw new Error('Action ticket inconnue.');
    await audit(i.guild, `ticket.${action}`, i.user.id, i.channelId);
    await i.editReply({ content: `Ticket : ${action} effectué.` });
  });
};
const reconcileTickets = async (guild) => {
  const channels = await guild.channels.fetch();
  store.update(guild.id, (s) => {
    for (const ticket of Object.values(s.tickets)) {
      if (ticket.status === 'creating') {
        const found = channels.find((c) => c?.topic === `zero-limit-ticket:${ticket.id}`);
        ticket.channelId = found?.id || null; ticket.status = found ? 'open' : 'missing';
      } else if (ticket.channelId && !channels.has(ticket.channelId)) ticket.status = 'missing';
    }
  });
  if (!enabled(guild.id, 'tickets') || !store.read(guild.id).features.tickets?.enabled) return;
  for (const ticket of Object.values(store.read(guild.id).tickets)) {
    const channel = channels.get(ticket.channelId);
    if (channel && ticket.status !== 'missing' && !ticket.controlMessageId) {
      const sent = await channel.send({ content: 'Ticket récupéré après redémarrage.', components: [controls(ticket.id)], allowedMentions: { parse: [] } });
      store.update(guild.id, (s) => { s.tickets[ticket.id].controlMessageId = sent.id; });
    }
  }
};
module.exports = { panel, controls, handleTicket, reconcileTickets };
