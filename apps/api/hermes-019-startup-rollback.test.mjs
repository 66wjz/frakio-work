import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function fakeRuntime(root, version) {
  const runtimeDir = path.join(root, 'runtime', 'hermes', version, 'mac-arm64');
  await mkdir(path.join(runtimeDir, 'python', 'bin'), { recursive: true });
  await symlink('/usr/bin/python3', path.join(runtimeDir, 'python', 'bin', 'python3'));
  await writeFile(path.join(runtimeDir, 'runtime-manifest.json'), `${JSON.stringify({
    schema: 1,
    platform: 'mac-arm64',
    targetOs: 'darwin',
    targetArch: 'arm64',
    hermesAgentVersion: version,
    sourceTag: version === '0.19.0' ? 'v2026.7.20' : 'v2026.7.7.2',
    sourceCommit: version === '0.19.0'
      ? '3ef6bbd201263d354fd83ec55b3c306ded2eb72a'
      : '9de9c25f620ff7f1ce0fd5457d596052d5159596',
    bridgeProtocolVersion: 3,
  }, null, 2)}\n`);
}

test('failed first startup on bundled 0.19 restores configs and selects bundled 0.18.2', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-hermes-019-startup-'));
  const frakioHome = path.join(root, '.frakio-work');
  const hermesHome = path.join(root, '.hermes');
  const statePath = path.join(frakioHome, 'data', 'workbench-state.json');
  await Promise.all([
    fakeRuntime(root, '0.18.2'),
    fakeRuntime(root, '0.19.0'),
    mkdir(path.dirname(statePath), { recursive: true }),
    mkdir(hermesHome, { recursive: true }),
  ]);
  await writeFile(path.join(hermesHome, 'config.yaml'), 'model: test-model\n');
  await writeFile(statePath, `${JSON.stringify({
    ui: {},
    spaces: [],
    workspaces: [],
    agents: [],
    threads: [],
    models: [],
  })}\n`);

  process.env.FRAKIO_WORK_HOME = frakioHome;
  process.env.FRAKIO_WORK_APP_ROOT = root;
  process.env.FRAKIO_WORK_RUNTIME_HOME = path.join(root, 'runtime');
  process.env.FRAKIO_WORK_STATE_PATH = statePath;
  process.env.HERMES_HOME = hermesHome;
  delete process.env.FRAKIO_WORK_DISABLE_AUTOSTART;
  delete process.env.FRAKIO_WORK_HERMES_RUNTIME;
  process.env.PORT = '0';

  const module = await import(`./server.mjs?hermes-019-startup-rollback=${Date.now()}-${Math.random()}`);
  const server = await module.startServer();
  t.after(() => server.close());

  const registryPath = path.join(frakioHome, 'runtime', 'runtime-registry.json');
  const backupRoot = path.join(frakioHome, 'backups', 'hermes-agent');
  let registry = null;
  let manifest = null;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      registry = JSON.parse(await readFile(registryPath, 'utf8'));
      const backups = await readdir(backupRoot);
      if (backups.length) {
        manifest = JSON.parse(await readFile(path.join(backupRoot, backups[0], 'manifest.json'), 'utf8'));
      }
      if (registry.activeVersion === '0.18.2' && manifest?.status === 'restored-after-failure') break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(registry?.activeVersion, '0.18.2');
  assert.equal(registry?.previousVersion, '0.19.0');
  assert.equal(manifest?.status, 'restored-after-failure');
  assert.match(await readFile(path.join(hermesHome, 'config.yaml'), 'utf8'), /^model: test-model\n$/);
});
