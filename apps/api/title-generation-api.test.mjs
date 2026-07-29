import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startFakeBridge(t) {
  const requests = [];
  const server = net.createServer((socket) => {
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      const lineEnd = input.indexOf('\n');
      if (lineEnd < 0) return;
      const request = JSON.parse(input.slice(0, lineEnd));
      requests.push(request);
      const response = request.action === 'ping'
        ? { ok: true, broker: { pid: process.pid }, workers: {}, worker_details: {} }
        : request.action === 'title_generate'
          ? { ok: true, title: '<think>内部分析</think>Title: “浮层与标题优化。”' }
          : { ok: false, error: `Unsupported fake action: ${request.action}` };
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return { endpoint: `tcp://127.0.0.1:${server.address().port}`, requests };
}

test('title generation previews and atomically applies a sanitized title', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-title-generation-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const profileHome = path.join(hermesHome, 'profiles', 'iris');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(profileHome, { recursive: true });
  await writeFile(path.join(profileHome, 'config.yaml'), '{}\n');
  await writeFile(path.join(home, 'data', 'workbench-state.json'), JSON.stringify({
    ui: { defaultAgentId: 'iris' },
    agents: [{ id: 'iris', name: 'Iris', role: 'Assistant', profileName: 'iris', source: 'hermes-profile' }],
    threads: [{
      id: 'thread-title',
      title: '旧标题',
      mode: 'direct',
      primaryAgentId: 'iris',
      defaultAgentId: 'iris',
      selectedAgents: ['iris'],
      messages: [
        { id: 'm1', agentId: 'user', agentName: '用户', role: 'User', content: '优化输入框菜单' },
        { id: 'm2', agentId: 'iris', agentName: 'Iris', role: 'Assistant', content: '还会处理自动标题。' },
      ],
    }],
  }));

  const fakeBridge = await startFakeBridge(t);
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.HERMES_AGENT_BRIDGE_ENDPOINT = fakeBridge.endpoint;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?title-generation=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };

  const previewResponse = await fetch(`${baseUrl}/api/threads/thread-title/title-generation`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ apply: false }),
  });
  assert.equal(previewResponse.status, 200);
  assert.deepEqual(await previewResponse.json(), { title: '浮层与标题优化' });

  const unchanged = await fetch(`${baseUrl}/api/threads/thread-title`, { headers }).then((response) => response.json());
  assert.equal(unchanged.thread.title, '旧标题');

  const applyResponse = await fetch(`${baseUrl}/api/threads/thread-title/title-generation`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ apply: true }),
  });
  const applied = await applyResponse.json();
  assert.equal(applyResponse.status, 200, JSON.stringify(applied));
  assert.equal(applied.title, '浮层与标题优化');
  assert.equal(applied.thread.title, '浮层与标题优化');

  const titleRequests = fakeBridge.requests.filter((request) => request.action === 'title_generate');
  assert.equal(titleRequests.length, 2);
  assert.match(titleRequests[0].transcript, /用户：优化输入框菜单/);
  assert.match(titleRequests[0].transcript, /助手：还会处理自动标题/);
  assert.doesNotMatch(titleRequests[0].transcript, /旧标题/);
});
