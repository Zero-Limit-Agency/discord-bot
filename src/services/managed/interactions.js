const { handleAdmin } = require('./adminPanel');
const { handleTicket } = require('./tickets');
const { handleRoles } = require('./roles');
const handleManaged = async (i) => {
  if (!i.customId?.startsWith('zl:')) return false;
  if (!i.guildId || !i.guild || !i.user) throw new Error('Interaction hors serveur.');
  const area = i.customId.split(':')[1];
  if (area === 'admin') await handleAdmin(i);
  else if (area === 'ticket') await handleTicket(i);
  else if (area === 'roles') await handleRoles(i);
  else throw new Error('Interaction inconnue.');
  return true;
};
module.exports = { handleManaged };
