const { EmbedBuilder } = require('discord.js');
const expand = (text, context = {}) => String(text || '').replace(/\{(user|username|server|memberCount)\}/g, (_, key) => String(context[key] ?? ''));
const safeUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Une URL HTTPS sans identifiants est requise.');
  return url.href;
};
const message = (spec, context = {}) => {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Configuration de message invalide.');
  const payload = { allowedMentions: { parse: [], repliedUser: false } };
  if (spec.content) payload.content = expand(spec.content, context).slice(0, 2000);
  if (spec.embed) {
    const source = spec.embed;
    const embed = new EmbedBuilder();
    if (source.title) embed.setTitle(expand(source.title, context).slice(0, 256));
    if (source.description) embed.setDescription(expand(source.description, context).slice(0, 4096));
    embed.setColor(source.color || '#7A1632');
    if (source.fields) embed.setFields(source.fields.slice(0, 25).map((field) => ({ name: expand(field.name, context).slice(0, 256) || '\u200b', value: expand(field.value, context).slice(0, 1024) || '\u200b', inline: field.inline === true })));
    if (source.footer) embed.setFooter({ text: expand(source.footer.text || source.footer, context).slice(0, 2048) });
    if (source.image) embed.setImage(safeUrl(source.image.url || source.image));
    if (source.thumbnail) embed.setThumbnail(safeUrl(source.thumbnail.url || source.thumbnail));
    if (!source.title && !source.description && !source.fields?.length && !source.image) throw new Error('Embed vide.');
    if (embed.length > 6000) throw new Error('Embed supérieur à 6000 caractères.');
    payload.embeds = [embed.toJSON()];
  }
  if (!payload.content && !payload.embeds?.length) throw new Error('Message vide.');
  return payload;
};
const contextFor = (member) => ({ user: `<@${member.id}>`, username: member.user.username, server: member.guild.name, memberCount: member.guild.memberCount });
const sendVerified = async (channel, payload) => {
  if (!channel || ![0, 5].includes(channel.type) || !channel.send) throw new Error('Salon textuel ou annonces introuvable.');
  const sent = await channel.send(payload);
  const verified = await sent.fetch();
  if (!verified?.id || (!verified.content && !verified.embeds?.length && !verified.components?.length)) throw new Error('Message envoyé mais vérification impossible.');
  return sent;
};
module.exports = { expand, message, contextFor, sendVerified };
