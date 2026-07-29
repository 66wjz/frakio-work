'use strict';

function normalizeLoopbackUrl(value, label) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} 不是有效地址：${raw}`);
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error(`${label} 必须使用本机 HTTP 地址。`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function desktopRuntimeTarget({
  packaged = false,
  devServerUrl = '',
  externalApiUrl = '',
  embeddedApiUrl = 'http://127.0.0.1:8787',
} = {}) {
  if (!packaged && String(devServerUrl || '').trim()) {
    return {
      rendererUrl: normalizeLoopbackUrl(devServerUrl, 'Vite 开发服务器'),
      apiUrl: normalizeLoopbackUrl(externalApiUrl || embeddedApiUrl, '开发 API'),
      spawnApi: false,
      development: true,
    };
  }
  return {
    rendererUrl: '',
    apiUrl: normalizeLoopbackUrl(embeddedApiUrl, '本地 API'),
    spawnApi: true,
    development: false,
  };
}

module.exports = {
  desktopRuntimeTarget,
  normalizeLoopbackUrl,
};
