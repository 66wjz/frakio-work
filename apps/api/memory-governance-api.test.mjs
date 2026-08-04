import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('memory governance keeps project rules in Frakio until explicit Markdown sync', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-memory-governance-'));
  const home = path.join(parent, '.frakio-work');
  const vaultPath = path.join(parent, 'Project Vault');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(vaultPath, { recursive: true });
  await writeFile(path.join(home, 'data', 'workbench-state.json'), JSON.stringify({
    version: 8,
    ui: {},
    memoryReview: { enabled: true, provider: 'auto', model: '', timeout: 60, extraBody: {} },
    spaces: [], workspaces: [], agents: [], models: [],
    vaults: [{ id: 'vault-project', name: 'Project Vault', path: vaultPath, kind: 'project', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    threads: [{ id: 'thread-memory', title: 'Memory', vaultId: 'vault-project', messages: [{ id: 'message-source', agentId: 'user', role: 'User', content: '项目交付路径固定为交付物目录' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  }));
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = path.join(parent, '.hermes');
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  const module = await import(`./server.mjs?memory-governance=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const headers = { 'content-type': 'application/json', 'x-frakio-request': '1', cookie: session.headers.get('set-cookie')?.split(';')[0] || '' };

  const config = await fetch(`${baseUrl}/api/memory/config`, { headers }).then((response) => response.json());
  assert.equal(config.config.enabled, true);
  const updatedConfig = await fetch(`${baseUrl}/api/memory/config`, { method: 'PUT', headers, body: JSON.stringify({ enabled: false, timeout: 75 }) }).then((response) => response.json());
  assert.equal(updatedConfig.config.enabled, false);
  assert.equal(updatedConfig.config.timeout, 75);

  const proposedResponse = await fetch(`${baseUrl}/api/memory/proposals`, { method: 'POST', headers, body: JSON.stringify({
    fact: '项目交付路径固定为交付物目录', scope: 'vault', vaultId: 'vault-project', threadId: 'thread-memory', sourceMessageId: 'message-source', origin: 'user', userConfirmed: true, confidence: 0.99, kind: 'project_rule', reason: '用户确认项目路径',
  }) });
  const proposed = await proposedResponse.json();
  assert.equal(proposedResponse.status, 201, JSON.stringify(proposed));
  assert.equal(proposed.entry.status, 'accepted');
  const targetPath = path.join(vaultPath, '规则', 'Frakio 记忆.md');
  await assert.rejects(readFile(targetPath, 'utf8'));

  const active = await fetch(`${baseUrl}/api/memory?view=active`).then((response) => response.json());
  assert.equal(active.entries.length, 1);
  const paused = await fetch(`${baseUrl}/api/memory/${proposed.entry.id}`, { method: 'PATCH', headers, body: JSON.stringify({ action: 'pause' }) }).then((response) => response.json());
  assert.equal(paused.entry.status, 'paused');
  const resumed = await fetch(`${baseUrl}/api/memory/${proposed.entry.id}`, { method: 'PATCH', headers, body: JSON.stringify({ action: 'resume' }) }).then((response) => response.json());
  assert.equal(resumed.entry.status, 'accepted');

  const preview = await fetch(`${baseUrl}/api/memory/${proposed.entry.id}/sync-preview`, { method: 'POST', headers }).then((response) => response.json());
  assert.match(preview.preview.diff, /Frakio managed block/);
  const synced = await fetch(`${baseUrl}/api/memory/${proposed.entry.id}/sync`, { method: 'POST', headers, body: '{}' }).then((response) => response.json());
  assert.equal(synced.entry.sync.state, 'synced');
  assert.match(await readFile(targetPath, 'utf8'), /项目交付路径固定为交付物目录/);

  const changed = (await readFile(targetPath, 'utf8')).replace('项目交付路径固定为交付物目录', '项目交付路径改为成果目录');
  await writeFile(targetPath, changed);
  const drift = await fetch(`${baseUrl}/api/memory/${proposed.entry.id}/sync-preview`, { method: 'POST', headers }).then((response) => response.json());
  assert.equal(drift.preview.drifted, true);
  const documentWins = await fetch(`${baseUrl}/api/memory/${proposed.entry.id}/sync`, { method: 'POST', headers, body: JSON.stringify({ resolution: 'document' }) }).then((response) => response.json());
  assert.equal(documentWins.entry.fact, '项目交付路径改为成果目录');

  const manualEntries = await Promise.all([
    fetch(`${baseUrl}/api/memory/proposals`, { method: 'POST', headers, body: JSON.stringify({
      fact: '状态更新应保持简短。', scope: 'user', userId: 'default', origin: 'user', userConfirmed: true, confidence: 0.99, kind: 'personal_fact', reason: '用户在记忆中心手动创建',
    }) }),
    fetch(`${baseUrl}/api/memory/proposals`, { method: 'POST', headers, body: JSON.stringify({
      fact: 'Iris 处理发布任务前先检查回滚点。', scope: 'agent', sourceAgentId: 'iris', origin: 'user', userConfirmed: true, confidence: 0.99, kind: 'agent_experience', reason: '用户在记忆中心手动创建',
    }) }),
    fetch(`${baseUrl}/api/memory/proposals`, { method: 'POST', headers, body: JSON.stringify({
      fact: '项目发布前必须由 Victor 复核迁移说明。', scope: 'vault', vaultId: 'vault-project', origin: 'user', userConfirmed: true, confidence: 0.99, kind: 'project_fact', reason: '用户在记忆中心手动创建',
    }) }),
  ]);
  const created = await Promise.all(manualEntries.map(async (response) => ({ status: response.status, body: await response.json() })));
  assert.deepEqual(created.map((item) => item.status), [201, 201, 201]);
  assert.deepEqual(created.map((item) => item.body.entry.scope), ['user', 'agent', 'vault']);
  assert.deepEqual(created.map((item) => item.body.entry.status), ['accepted', 'accepted', 'accepted']);
  assert.equal(created.every((item) => item.body.entry.reason === '用户在记忆中心手动创建' && !item.body.entry.threadId && !item.body.entry.provenance?.[0]?.messageId), true);
});
