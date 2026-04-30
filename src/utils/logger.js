const formatMeta = (meta = {}) => {
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!entries.length) {
    return '';
  }

  return ` ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
};

const log = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}${formatMeta(meta)}`);
};

module.exports = {
  info: (message, meta) => log('INFO', message, meta),
  warn: (message, meta) => log('WARN', message, meta),
  error: (message, meta) => log('ERROR', message, meta),
};