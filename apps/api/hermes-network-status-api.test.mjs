import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startNetworkStatusBridge(t) {
  const requests = [];
  const server = net.createServer((socket) => {
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      const lineEnd = input.indexOf('\n');
      if (lineEnd < 0) return;
      const request = JSON.parse(input.slice(0, lineEnd));
      requests.push(request);
      const response = request.action === 'network_status'
        ? {
            ok: true,
            profile: request.profile,
            online_read_ready: true,
            search: {
              enabled: true,
              ready: true,
              provider: 'ddgs',
              source: 'free',
              detail: 'free_provider_ready',
            },
            extract: {
              enabled: true,
              ready: false,
              provider: null,
              detail: 'provider_not_configured',
            },
            browser: {
              enabled: true,
              ready: true,
              chromium_ready: true,
              detail: 'ready',
            },
            checked_at: '2026-07-29T00:00:00.000Z',
          }
        : request.action === 'ping'
          ? { ok: true, broker: { pid: process.pid }, workers: {}, worker_details: {} }
          : { ok: false, error: `Unsupported fake action: ${request.action}` };
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return { endpoint: `tcp://127.0.0.1:${server.address().port}`, requests };
}

test('network status exposes capability readiness without credentials or local paths', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-network-status-'));
  const frakioHome = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const irisHome = path.join(hermesHome, 'profiles', 'iris');
  await mkdir(path.join(frakioHome, 'data'), { recursive: true });
  await mkdir(irisHome, { recursive: true });
  await writeFile(path.join(irisHome, 'config.yaml'), '{}\n');

  const bridge = await startNetworkStatusBridge(t);
  process.env.FRAKIO_WORK_HOME = frakioHome;
  process.env.HERMES_HOME = hermesHome;
  process.env.HERMES_AGENT_BRIDGE_ENDPOINT = bridge.endpoint;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?network-status=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];

  const response = await fetch(`${baseUrl}/api/hermes/network-status?profile=iris`, {
    headers: { cookie },
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.profile, 'iris');
  assert.equal(payload.onlineReadReady, true);
  assert.deepEqual(payload.search, {
    enabled: true,
    ready: true,
    provider: 'ddgs',
    source: 'free',
    detail: 'free_provider_ready',
  });
  assert.equal(payload.browser.chromiumReady, true);
  assert.equal(JSON.stringify(payload).includes('API_KEY'), false);
  assert.equal(JSON.stringify(payload).includes(parent), false);
  assert.deepEqual(
    bridge.requests.find((request) => request.action === 'network_status'),
    { action: 'network_status', profile: 'iris' },
  );

  const cached = await fetch(`${baseUrl}/api/hermes/network-status?profile=iris`, { headers: { cookie } });
  const cachedPayload = await cached.json();
  assert.equal(cached.status, 200, JSON.stringify(cachedPayload));
  assert.equal(cachedPayload.verificationState, 'verified');
  assert.equal(bridge.requests.filter((request) => request.action === 'network_status').length, 1);

  const refreshed = await fetch(`${baseUrl}/api/hermes/network-status/refresh?profile=iris`, { method: 'POST', headers: { cookie, 'x-frakio-request': '1' } });
  assert.equal(refreshed.status, 200);
  assert.equal(bridge.requests.filter((request) => request.action === 'network_status').length, 2);

  const missing = await fetch(`${baseUrl}/api/hermes/network-status?profile=missing`, {
    headers: { cookie },
  });
  assert.equal(missing.status, 404);
});

test('local connection settings distinguish provider, website and Plan policy failures', async () => {
  const source = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /title="网页搜索"/);
  assert.match(source, /title="网页浏览"/);
  assert.match(source, /单个免费服务限流不代表本机离线/);
  assert.match(source, /目标网站拒绝或超时不代表本机离线/);
  assert.match(source, /属于 Plan 安全策略，不是网络故障/);
});
