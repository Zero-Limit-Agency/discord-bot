const fs = require('node:fs');
const path = require('node:path');
const acquireRuntimeLock = (root = path.join(process.cwd(), '.data')) => {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, 'bot.lock');
  try {
    const fd = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(target, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid runtime lock; inspect .data/bot.lock before restarting.');
    try { process.kill(pid, 0); } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
      fs.unlinkSync(target);
      return acquireRuntimeLock(root);
    }
    throw new Error('Another bot process is using this data directory.');
  }
  const release = () => { try { if (fs.readFileSync(target, 'utf8') === String(process.pid)) fs.unlinkSync(target); } catch {} };
  process.once('exit', release);
  return release;
};
module.exports = { acquireRuntimeLock };
