import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Hermes migration backs up profiles and imports unconfirmed facts as candidates', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-hermes-memory-migration-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const profileDir = path.join(hermesHome, 'profiles', 'iris');
  const memoriesDir = path.join(profileDir, 'memories');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(memoriesDir, { recursive: true });
  await writeFile(path.join(profileDir, 'config.yaml'), '{}\n');
  await writeFile(path.join(memoriesDir, 'USER.md'), '# User\n\n- Imported preference stays concise.\n');
  await writeFile(path.join(memoriesDir, 'MEMORY.md'), '# Memory\n\n- Imported agent checks release notes.\n');
  await writeFile(path.join(home, 'data', 'workbench-state.json'), JSON.stringify({
    version: 9,
    memoryAuthority: 'compat',
    ui: { defaultAgentId: 'iris', fallbackDecisionAgentId: 'iris' },
    agents: [{
      id: 'iris', name: 'Iris', profileName: 'iris', source: 'frakio-agent', profileRevision: 'profile-1',
      soul: 'Be precise.', role: 'Assistant', scope: 'Help with focused work.', notes: '',
    }],
    models: [], spaces: [], workspaces: [], vaults: [], threads: [],
  }));

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?hermes-memory-migration=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const headers = {
    'content-type': 'application/json',
    'x-frakio-request': '1',
    cookie: session.headers.get('set-cookie')?.split(';')[0] || '',
  };

  const acceptedResponse = await fetch(`${baseUrl}/api/memory/proposals`, {
    method: 'POST', headers, body: JSON.stringify({
      fact: 'Accepted preference belongs in projection.', scope: 'user', userId: 'default', origin: 'user',
      userConfirmed: true, confidence: 1, kind: 'personal_fact', reason: 'User confirmed directly.',
    }),
  });
  assert.equal(acceptedResponse.status, 201, await acceptedResponse.text());

  const previewResponse = await fetch(`${baseUrl}/api/memory/migrations/hermes/preview`, { method: 'POST', headers, body: '{}' });
  const preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200, JSON.stringify(preview));
  assert.equal(preview.authority, 'compat');
  assert.deepEqual(preview.entries.map((entry) => entry.scope).sort(), ['agent', 'user']);

  const commitResponse = await fetch(`${baseUrl}/api/memory/migrations/hermes/commit`, {
    method: 'POST', headers, body: JSON.stringify({ entryIds: preview.entries.map((entry) => entry.id) }),
  });
  const committed = await commitResponse.json();
  assert.equal(commitResponse.status, 200, JSON.stringify(committed));
  assert.equal(committed.authority, 'authority');
  assert.equal(committed.imported.length, 2);
  assert.equal(committed.imported.every((entry) => entry.status === 'candidate'), true);
  await access(path.join(committed.backupRoot, 'iris', 'memories', 'USER.md'));

  const state = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(state.memoryAuthority, 'authority');
  assert.equal(state.memoryMigration.hermesVersion, 1);
  const projectedUser = await readFile(path.join(memoriesDir, 'USER.md'), 'utf8');
  const projectedMemory = await readFile(path.join(memoriesDir, 'MEMORY.md'), 'utf8');
  assert.match(projectedUser, /Accepted preference belongs in projection/);
  assert.doesNotMatch(projectedUser, /Imported preference stays concise/);
  assert.doesNotMatch(projectedMemory, /Imported agent checks release notes/);
});
