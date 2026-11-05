const readBoundedText = async (response, maximumBytes) => {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > maximumBytes) { await response.body?.cancel(); throw new Error('Response exceeds size limit.'); }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumBytes) throw new Error('Response exceeds size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) { await reader.cancel(); throw new Error('Response exceeds size limit.'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
};
module.exports = { readBoundedText };
