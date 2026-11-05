const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Synchronous read/modify/atomic rename prevents lost updates in the single bot process.
// The runtime lock prevents two processes from sharing this JSON repository.
const createStore = (root = path.join(process.cwd(), '.data', 'commercial')) => {
  const file = (guildId) => {
    if (!/^\d{17,20}$/.test(guildId)) throw new Error('Invalid guild ID.');
    return path.join(root, `${guildId}.json`);
  };
  const read = (guildId) => {
    const target = file(guildId);
    if (!fs.existsSync(target)) return { version: 1, guildId, features: {}, tickets: {}, voices: {}, presets: {}, audit: [] };
    const state = JSON.parse(fs.readFileSync(target, 'utf8'));
    const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (state.version !== 1 || state.guildId !== guildId || !record(state.features) || !record(state.tickets) || !record(state.voices) || !record(state.presets) || !Array.isArray(state.audit)) {
      throw new Error('Commercial storage is corrupt or has an unsupported version. Restore a private backup.');
    }
    return state;
  };
  const update = (guildId, mutate) => {
    const state = read(guildId);
    const result = mutate(state);
    if (result?.then) throw new Error('Store mutations must be synchronous.');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const target = file(guildId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(state)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, target);
      const directory = fs.openSync(root, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return state;
  };
  return { read, update };
};
const store = createStore();
const queues = new Map();
const serial = async (key, action) => {
  const previous = queues.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  queues.set(key, task);
  try { return await task; } finally { if (queues.get(key) === task) queues.delete(key); }
};
module.exports = { createStore, store, serial };
