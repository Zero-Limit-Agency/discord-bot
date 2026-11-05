const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { store } = require('../../repositories/commercialStore');
const { requireAdmin, requireFeature, FEATURES, enabled } = require('./access');
const { configure, samples, channel } = require('./configuration');
const { message, contextFor, sendVerified } = require('./messages');
const { audit } = require('./audit');
const buttons = (items) => {
  const rows = [];
  for (let n = 0; n < items.length; n += 5) rows.push(new ActionRowBuilder().addComponents(items.slice(n, n + 5).map(([id, label]) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary))));
  return rows;
};
const panelPayload = (guildId) => ({
  embeds: [new EmbedBuilder().setColor('#7A1632').setTitle('Zero Limit — Administration').setDescription(FEATURES.filter((f) => f !== 'panel').map((f) => `${enabled(guildId, f) ? '✅' : '🔒'} ${f}`).join('\n')).setFooter({ text: 'Chaque action vérifie vos permissions et la licence en cours.' })],
  components: buttons([...Object.keys(samples).map((f) => [`zl:admin:config:${f}`, f]), ['zl:admin:embeds', 'Embeds'], ['zl:admin:settings', 'Settings']]),
  allowedMentions: { parse: [] },
});
const input = (id, label, value, style = TextInputStyle.Short, required = true) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setValue(value || '').setStyle(style).setMaxLength(style === TextInputStyle.Paragraph ? 4000 : 100).setRequired(required));
const handleAdmin = async (i) => {
  const member = await requireAdmin(i);
  requireFeature(i.guildId, 'panel');
  const [, , action, feature] = i.customId.split(':');
  if (action === 'settings') {
    await i.reply({ content: 'Configuration par serveur persistante. Placeholders : {user}, {username}, {server}, {memberCount}. Copier un ID : activer le mode développeur Discord, puis clic droit → Copier l’identifiant. Les licences sont gérées par Zero Limit avec /license.', flags: 64 });
    return;
  }
  if (action === 'embeds') {
    requireFeature(i.guildId, 'embeds');
    await i.reply({ content: 'Presets de messages et embeds : enregistrer/modifier, prévisualiser, envoyer ou modifier un message existant.', components: buttons(['save', 'preview', 'send', 'edit'].map((a) => [`zl:admin:embedform:${a}`, a])), flags: 64 });
    return;
  }
  if (action === 'embedform') {
    requireFeature(i.guildId, 'embeds');
    if (!['save', 'preview', 'send', 'edit'].includes(feature)) throw new Error('Action embed invalide.');
    const modal = new ModalBuilder().setCustomId(`zl:admin:embedsubmit:${feature}`).setTitle(`Embed — ${feature}`);
    modal.addComponents(input('name', 'Nom du preset', 'default'));
    if (feature === 'save') modal.addComponents(input('json', 'Message JSON (content et/ou embed)', JSON.stringify({ content: '', embed: { title: 'Bienvenue sur {server}', description: 'Un message personnalisé.', color: '#7A1632', fields: [{ name: 'Information', value: 'Votre contenu' }], footer: { text: 'Zero Limit' } } }, null, 2), TextInputStyle.Paragraph));
    if (['send', 'edit'].includes(feature)) modal.addComponents(input('channel', 'ID du salon de destination', i.channelId));
    if (feature === 'edit') modal.addComponents(input('message', 'ID du message envoyé par le bot', ''));
    await i.showModal(modal);
    return;
  }
  if (action === 'embedsubmit') {
    requireFeature(i.guildId, 'embeds');
    await i.deferReply({ flags: 64 });
    const name = i.fields.getTextInputValue('name');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Nom de preset invalide.');
    const context = contextFor(member);
    if (feature === 'save') {
      const spec = JSON.parse(i.fields.getTextInputValue('json'));
      const payload = message(spec, context);
      store.update(i.guildId, (s) => {
        if (!Object.hasOwn(s.presets, name) && Object.keys(s.presets).length >= 100) throw new Error('Limite de 100 presets atteinte.');
        s.presets[name] = spec;
      });
      await i.editReply({ content: 'Preset enregistré. Aperçu :', embeds: payload.embeds || [] });
    } else {
      const spec = store.read(i.guildId).presets[name];
      if (!spec) throw new Error('Preset introuvable.');
      const payload = message(spec, context);
      if (feature === 'preview') await i.editReply(payload);
      else {
        const target = await channel(i.guild, i.fields.getTextInputValue('channel'), [0, 5]);
        if (feature === 'send') await sendVerified(target, payload);
        else if (feature === 'edit') {
          const sent = await target.messages.fetch(i.fields.getTextInputValue('message'));
          if (sent.author.id !== i.client.user.id || sent.webhookId) throw new Error('Le message doit appartenir au bot.');
          const edited = await sent.edit({ content: payload.content || '', embeds: payload.embeds || [], allowedMentions: payload.allowedMentions });
          const checked = await edited.fetch();
          if (!checked.content && !checked.embeds.length) throw new Error('Message modifié vide.');
        } else throw new Error('Action embed invalide.');
        await i.editReply({ content: feature === 'send' ? 'Message envoyé et vérifié.' : 'Message modifié et vérifié.' });
      }
    }
    await audit(i.guild, `embed.${feature}`, i.user.id);
    return;
  }
  if (!Object.hasOwn(samples, feature)) throw new Error('Module inconnu.');
  requireFeature(i.guildId, feature);
  if (action === 'config') {
    const existing = store.read(i.guildId).features[feature];
    const modal = new ModalBuilder().setCustomId(`zl:admin:save:${feature}`).setTitle(`Configuration — ${feature}`);
    const value = JSON.stringify(existing || samples[feature], null, 2);
    if (value.length > 4000) throw new Error('Configuration trop longue pour le formulaire Discord.');
    modal.addComponents(input('json', 'Configuration JSON — remplacer les IDs', value, TextInputStyle.Paragraph));
    await i.showModal(modal);
  } else if (action === 'save') {
    await i.deferReply({ flags: 64 });
    const config = JSON.parse(i.fields.getTextInputValue('json'));
    await configure(i, feature, config);
    await i.editReply({ content: `${feature} : configuration enregistrée et ${config.enabled ? 'activée' : 'désactivée'}.` });
  } else throw new Error('Action admin inconnue.');
};
module.exports = { panelPayload, handleAdmin };
