import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('state API persists the one-time macOS sidebar width migration', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-sidebar-width-'));
  const home = path.join(parent, '.frakio-work');
  const dataDir = path.join(home, 'data');
  const statePath = path.join(dataDir, 'workbench-state.json');
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath, JSON.stringify({ version: 2, ui: { sidebarWidth: 240 } }));

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?sidebar-width=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const migrated = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
  assert.equal(migrated.ui.sidebarWidth, 240);
  assert.equal(migrated.ui.macSidebarWidth, 224);
  assert.equal(migrated.ui.macSidebarWidthVersion, 1);

  const stored = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(stored.ui.macSidebarWidth, 224);
  assert.equal(stored.ui.macSidebarWidthVersion, 1);

  const patchResponse = await fetch(`${baseUrl}/api/state/ui`, {
    method: 'PATCH',
    headers: { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ macSidebarWidth: 12 }),
  });
  assert.equal(patchResponse.status, 200);
  const clamped = await patchResponse.json();
  assert.equal(clamped.ui.macSidebarWidth, 220);

  const deliberateResponse = await fetch(`${baseUrl}/api/state/ui`, {
    method: 'PATCH',
    headers: { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ macSidebarWidth: 240 }),
  });
  assert.equal(deliberateResponse.status, 200);
  const deliberate = await deliberateResponse.json();
  assert.equal(deliberate.ui.macSidebarWidth, 240);
  assert.equal(deliberate.ui.macSidebarWidthVersion, 1);
});
