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
};
