// discord.js 14's ws transport provides createConnection, which bypasses Node's
// default proxy agent. It exposes no socket-agent option. Inject the inherited
// HTTPS proxy only for its WebSocket upgrade; keep TLS/CA checks enabled.
const configureNetworkProxy = () => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return;
  const https = require('node:https');
  if (https.request.zeroLimitProxy) return;
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const agent = new HttpsProxyAgent(proxy);
  const original = https.request;
  const request = function (options, ...args) {
    if (options && typeof options === 'object' && options.headers?.Upgrade?.toLowerCase() === 'websocket' && !options.agent) {
      options = { ...options, agent };
    }
    return original.call(this, options, ...args);
  };
  request.zeroLimitProxy = true;
  https.request = request;
};
module.exports = { configureNetworkProxy };
