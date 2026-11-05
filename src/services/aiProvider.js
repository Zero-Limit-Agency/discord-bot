const config = require('../config');
const getProvider = () => {
  const name = String(process.env.AI_PROVIDER || (config.lmStudioEnabled ? 'lmstudio' : '')).toLowerCase();
  const providers = {
    lmstudio: { baseUrl: config.lmStudioBaseUrl, model: config.lmStudioModel, key: process.env.LMSTUDIO_API_KEY },
    nvidia: { baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com', model: process.env.NVIDIA_MODEL, key: process.env.NVIDIA_API_KEY },
    ollama: { baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', model: process.env.OLLAMA_MODEL },
  };
  if (!providers[name]) return null;
  return { name, ...providers[name] };
};
module.exports = { getProvider };
