import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Hermes 0.19 migration makes missing approval modes smart and preserves explicit modes', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-hermes-019-approval-'));
  const frakioHome = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const runtimeDir = path.join(parent, 'runtime');
  await mkdir(path.join(frakioHome, 'data'), { recursive: true });
  await mkdir(path.join(runtimeDir, 'python', 'bin'), { recursive: true });
  await mkdir(path.join(hermesHome, 'profiles', 'iris'), { recursive: true });
  await mkdir(path.join(hermesHome, 'profiles', 'nora'), { recursive: true });
  await mkdir(path.join(hermesHome, 'profiles', 'max'), { recursive: true });
  await writeFile(path.join(runtimeDir, 'python', 'bin', 'python3'), '');
  await writeFile(path.join(runtimeDir, 'runtime-manifest.json'), JSON.stringify({
    hermesAgentVersion: '0.19.0',
    bridgeProtocolVersion: 3,
  }));
  await writeFile(path.join(hermesHome, 'profiles', 'iris', 'config.yaml'), 'approvals:\n  mode: manual\n');
  await writeFile(path.join(hermesHome, 'profiles', 'nora', 'config.yaml'), '{}\n');
  await writeFile(path.join(hermesHome, 'profiles', 'max', 'config.yaml'), 'approvals:\n  mode: off\n');
  await writeFile(path.join(frakioHome, 'data', 'workbench-state.json'), JSON.stringify({
    ui: { defaultAgentId: 'iris' },
    agents: [
      { id: 'iris', name: 'Iris', profileName: 'iris' },
      { id: 'nora', name: 'Nora', profileName: 'nora' },
      { id: 'max', name: 'Max', profileName: 'max' },
    ],
    threads: [
      { id: 'iris-thread', primaryAgentId: 'iris', permissionMode: 'smart', messages: [] },
      { id: 'nora-thread', primaryAgentId: 'nora', permissionMode: 'manual', messages: [] },
      { id: 'max-thread', primaryAgentId: 'max', permissionMode: 'manual', messages: [] },
    ],
  }));

  process.env.FRAKIO_WORK_HOME = frakioHome;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_HERMES_RUNTIME = runtimeDir;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?hermes-019-approval=${Date.now()}-${Math.random()}`);
  await module.createApp();

  const state = JSON.parse(await readFile(path.join(frakioHome, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(state.threads.find((thread) => thread.id === 'iris-thread').permissionMode, 'manual');
  assert.equal(state.threads.find((thread) => thread.id === 'nora-thread').permissionMode, 'smart');
  assert.equal(state.threads.find((thread) => thread.id === 'max-thread').permissionMode, 'off');
  assert.deepEqual(state.runtimeMigrations.hermes019ApprovalDefaults.profiles.sort(), ['default', 'nora']);
  assert.match(await readFile(path.join(hermesHome, 'config.yaml'), 'utf8'), /mode: smart/);
  assert.match(await readFile(path.join(hermesHome, 'profiles', 'nora', 'config.yaml'), 'utf8'), /mode: smart/);
  assert.match(await readFile(path.join(hermesHome, 'profiles', 'iris', 'config.yaml'), 'utf8'), /mode: manual/);
  assert.match(await readFile(path.join(hermesHome, 'profiles', 'max', 'config.yaml'), 'utf8'), /mode: off/);
});
