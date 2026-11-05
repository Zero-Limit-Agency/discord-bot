const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

const isStaffMember = (member) => {
  if (!member) {
    return false;
  }

  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  if (!config.staffRoleIds.length) {
    return false;
  }

  return member.roles.cache.some((role) => config.staffRoleIds.includes(role.id));
};

module.exports = {
  isStaffMember,
  isOwner: (userId) => Boolean(userId) && (process.env.ZERO_LIMIT_OWNER_IDS || '')
    .split(',').map((id) => id.trim()).filter((id) => /^\d{17,20}$/.test(id)).includes(userId),
};
