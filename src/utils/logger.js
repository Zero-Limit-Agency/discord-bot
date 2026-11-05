const redact = (value) => {
  let text = String(value);
  for (const key of ['DISCORD_TOKEN', 'NVIDIA_API_KEY', 'LMSTUDIO_API_KEY']) {
    const secret = process.env[key];
    if (secret && secret.length > 5) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/(Bearer|Bot)\s+[A-Za-z0-9_.-]{20,}/gi, '$1 [REDACTED]');
};
const formatMeta = (meta = {}) => {
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!entries.length) {
    return '';
  }

  return ` ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`;
};

const log = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  console.log(redact(`[${timestamp}] [${level}] ${message}${formatMeta(meta)}`));
};

module.exports = {
  redact,
  info: (message, meta) => log('INFO', message, meta),
  warn: (message, meta) => log('WARN', message, meta),
  error: (message, meta) => log('ERROR', message, meta),
};