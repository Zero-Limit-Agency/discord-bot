const { randomUUID } = require('node:crypto');
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { store, serial } = require('../../repositories/commercialStore');
const { enabled, requireFeature } = require('./access');
const { audit } = require('./audit');
const reconcileVoice = async (guild) => {
  if (!enabled(guild.id, 'tempvoice') || !store.read(guild.id).features.tempvoice?.enabled) return;
  await guild.channels.fetch();
  for (const voice of Object.values(store.read(guild.id).voices)) {
    let channel = guild.channels.cache.get(voice.channelId);
    if (!voice.channelId && voice.pendingName) {
      channel = guild.channels.cache.find((candidate) => candidate?.type === ChannelType.GuildVoice && candidate.name === voice.pendingName && candidate.parentId === voice.categoryId);
      const pendingKey = `pending-${voice.runId}`;
      store.update(guild.id, (s) => {
        delete s.voices[pendingKey];
        if (channel) s.voices[channel.id] = { ...voice, channelId: channel.id };
      });
      if (!channel) continue;
    }
    if (!channel) { store.update(guild.id, (s) => { delete s.voices[voice.channelId]; }); continue; }
    if (channel.type === ChannelType.GuildVoice && channel.members.size === 0 && voice.createdByBot === true) {
      await channel.delete('Empty Zero Limit temporary voice');
      store.update(guild.id, (s) => { delete s.voices[channel.id]; });
    }
  }
};
const voiceUpdate = async (oldState, newState) => serial(`${newState.guild.id}:voice`, async () => {
  const guild = newState.guild;
  if (!enabled(guild.id, 'tempvoice') || !store.read(guild.id).features.tempvoice?.enabled) return;
  const settings = store.read(guild.id).features.tempvoice;
  if (!settings?.enabled) return;
  await reconcileVoice(guild);
  if (newState.channelId !== settings.joinChannelId || oldState.channelId === newState.channelId || newState.member.user.bot) return;
  const existing = Object.values(store.read(guild.id).voices).find((v) => v.ownerId === newState.id);
  if (existing) {
    const channel = await guild.channels.fetch(existing.channelId);
    if (newState.member.voice.channelId === settings.joinChannelId) await newState.member.voice.setChannel(channel);
    return;
  }
  const parent = await guild.channels.fetch(settings.categoryId);
  if (!parent || parent.type !== ChannelType.GuildCategory) throw new Error('Temporary voice category deleted.');
  requireFeature(guild.id, 'tempvoice');
  const runId = randomUUID();
  const pendingName = `🔊 ${newState.member.user.username}`.slice(0, 75) + ` · ${runId.slice(0, 8)}`;
  const pending = { runId, pendingName, categoryId: parent.id, channelId: null, ownerId: newState.id, createdByBot: true };
  store.update(guild.id, (s) => { s.voices[`pending-${runId}`] = pending; });
  const channel = await guild.channels.create({ name: pendingName, type: ChannelType.GuildVoice, parent: parent.id, userLimit: settings.userLimit || 0,
    permissionOverwrites: [
      { id: guild.id, allow: [P.ViewChannel, P.Connect] },
      { id: (guild.members.me || await guild.members.fetchMe()).id, allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers] },
      { id: newState.id, allow: [P.ViewChannel, P.Connect] },
    ], reason: 'Zero Limit join-to-create' });
  store.update(guild.id, (s) => { delete s.voices[`pending-${runId}`]; s.voices[channel.id] = { ...pending, channelId: channel.id }; });
  if (newState.member.voice.channelId === settings.joinChannelId) await newState.member.voice.setChannel(channel);
  await audit(guild, 'voice.create', newState.id, channel.id);
  await reconcileVoice(guild);
});
const controlVoice = async (i) => serial(`${i.guildId}:voice`, async () => {
  requireFeature(i.guildId, 'tempvoice');
  if (!store.read(i.guildId).features.tempvoice?.enabled) throw new Error('Temp Voice désactivé.');
  const member = await i.guild.members.fetch(i.user.id);
  const channel = member.voice.channel;
  const record = store.read(i.guildId).voices[channel?.id];
  if (!record || record.ownerId !== member.id) throw new Error('Vous devez être propriétaire de ce vocal temporaire.');
  const action = i.options.getSubcommand();
  if (action === 'rename') await channel.setName(i.options.getString('name', true));
  else if (action === 'limit') await channel.setUserLimit(i.options.getInteger('count', true));
  else if (action === 'lock' || action === 'unlock') await channel.permissionOverwrites.edit(i.guildId, { Connect: action === 'unlock' });
  else if (action === 'transfer') {
    const user = i.options.getUser('member', true);
    const next = await i.guild.members.fetch(user.id);
    if (user.bot || next.voice.channelId !== channel.id) throw new Error('Le nouveau propriétaire doit être présent dans ce vocal.');
    await channel.permissionOverwrites.edit(next.id, { ViewChannel: true, Connect: true });
    await channel.permissionOverwrites.delete(member.id);
    store.update(i.guildId, (s) => { s.voices[channel.id].ownerId = next.id; });
  }
  await audit(i.guild, `voice.${action}`, i.user.id, channel.id);
  return 'Vocal temporaire mis à jour.';
});
module.exports = { voiceUpdate, reconcileVoice, controlVoice };
