const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const { isStaffMember } = require('../utils/permissions');

const DEFAULT_ANNOUNCE_COLOR = config.branding.color || 0x7a1632;
const ANNOUNCE_PERMISSION_ERROR = 'You do not have permission to use this command.';
const ANNOUNCE_CHANNEL_ERROR = 'I cannot send embeds in that channel.';

const parseEmbedColor = (value) => {
  if (!value) {
    return DEFAULT_ANNOUNCE_COLOR;
  }

  const normalized = value.trim().replace(/^#/, '').replace(/^0x/i, '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return Number.parseInt(normalized, 16);
};

const canSendEmbedToChannel = (channel, botMember, mention) => {
  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const permissions = channel.permissionsFor(botMember);

  if (!permissions) {
    return false;
  }

  if (!permissions.has(PermissionFlagsBits.ViewChannel)) {
    return false;
  }

  const canSendMessages = channel.isThread()
    ? permissions.has(PermissionFlagsBits.SendMessagesInThreads)
    : permissions.has(PermissionFlagsBits.SendMessages);

  if (!canSendMessages || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
    return false;
  }

  if (mention !== 'none' && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return false;
  }

  return true;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a staff announcement embed to a selected channel.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('The channel where the announcement will be posted.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('title')
      .setDescription('The announcement title.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('message')
      .setDescription('The announcement content.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('image')
      .setDescription('Optional image URL shown at the bottom of the embed.')
      .setRequired(false))
    .addStringOption((option) => option
      .setName('color')
      .setDescription('Optional hex color such as #7A1632.')
      .setRequired(false))
    .addStringOption((option) => option
      .setName('mention')
      .setDescription('Optional mention sent with the announcement.')
      .setRequired(false)
      .addChoices(
        { name: 'No mention', value: 'none' },
        { name: '@everyone', value: 'everyone' },
        { name: '@here', value: 'here' },
      )),
  async execute(interaction) {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({
        content: ANNOUNCE_PERMISSION_ERROR,
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const title = interaction.options.getString('title', true).trim();
    const message = interaction.options.getString('message', true).trim();
    const image = interaction.options.getString('image');
    const mention = interaction.options.getString('mention') || 'none';
    const colorInput = interaction.options.getString('color');
    const color = parseEmbedColor(colorInput);
    const botMember = interaction.guild.members.me;

    if (color === null) {
      await interaction.reply({
        content: 'Invalid color. Use a 6-digit hex value such as `#7A1632`.',
        ephemeral: true,
      });
      return;
    }

    if (!canSendEmbedToChannel(channel, botMember, mention)) {
      await interaction.reply({
        content: ANNOUNCE_CHANNEL_ERROR,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(message)
      .setAuthor({ name: config.branding.name })
      .setTimestamp();

    if (image) {
      embed.setImage(image);
    }

    const content = mention === 'none' ? undefined : `@${mention}`;

    try {
      await channel.send({
        content,
        embeds: [embed],
        allowedMentions: mention === 'none' ? { parse: [] } : { parse: ['everyone'] },
      });

      await interaction.reply({
        content: 'Announcement sent.',
        ephemeral: true,
      });

      logger.info('Announcement sent', {
        userId: interaction.user.id,
        channelId: channel.id,
        mention,
      });
    } catch (error) {
      logger.error('Failed to send announcement', {
        userId: interaction.user.id,
        channelId: channel.id,
        error: error.message,
      });

      await interaction.reply({
        content: 'I could not send the announcement in that channel.',
        ephemeral: true,
      });
    }
  },
};
