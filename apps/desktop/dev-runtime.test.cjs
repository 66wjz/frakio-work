'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { desktopRuntimeTarget, normalizeLoopbackUrl } = require('./dev-runtime.cjs');

test('desktop development uses the Vite renderer and external API without spawning another API', () => {
  assert.deepEqual(desktopRuntimeTarget({
    packaged: false,
    devServerUrl: 'http://127.0.0.1:5173/',
    externalApiUrl: 'http://127.0.0.1:8787/',
  }), {
    rendererUrl: 'http://127.0.0.1:5173',
    apiUrl: 'http://127.0.0.1:8787',
    spawnApi: false,
    development: true,
  });
});

test('packaged desktop ignores development addresses and keeps the embedded API flow', () => {
  assert.deepEqual(desktopRuntimeTarget({
    packaged: true,
    devServerUrl: 'http://127.0.0.1:5173',
    externalApiUrl: 'http://127.0.0.1:8787',
    embeddedApiUrl: 'http://127.0.0.1:8790',
  }), {
    rendererUrl: '',
    apiUrl: 'http://127.0.0.1:8790',
    spawnApi: true,
    development: false,
  });
});

test('development addresses are restricted to local HTTP servers', () => {
  assert.throws(() => normalizeLoopbackUrl('https://example.com', '开发服务器'), /本机 HTTP/);
  assert.throws(() => normalizeLoopbackUrl('not a url', '开发服务器'), /不是有效地址/);
});
