import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHermesGatewayRepair } from './hermes-gateway-repair.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-gateway-repair-'));
  const homeDir = path.join(root, 'user');
  const hermesHome = path.join(homeDir, '.hermes');
  const frakioWorkHome = path.join(homeDir, '.frakio-work');
  await mkdir(path.join(hermesHome, 'profiles'), { recursive: true });
  return { root, homeDir, hermesHome, frakioWorkHome };
}

function plist({ runtimePath, hermesHome, profileName }) {
  const profileArgs = profileName === 'default' ? '' : `<string>--profile</string><string>${profileName}</string>`;
  return `<?xml version="1.0"?><plist><dict>
    <key>EnvironmentVariables</key><dict><key>HERMES_HOME</key><string>${hermesHome}</string></dict>
    <key>ProgramArguments</key><array><string>${runtimePath}</string><string>-m</string><string>hermes_cli.main</string>${profileArgs}<string>gateway</string><string>run</string><string>--replace</string></array>
  </dict></plist>`;
}

test('legacy Gateway repair removes stale auto-start state, unloads owned services, and archives managed orphan Profiles', async (t) => {
  const env = await fixture();
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const runtimeRoot = path.join(env.homeDir, '.hermes-web-ui', 'desktop-runtime', 'hermes', '0.16.0');
  const runtimePath = path.join(runtimeRoot, 'python', 'bin', 'python3');
  const orphanDir = path.join(env.hermesHome, 'profiles', 'deleted');
  const externalDir = path.join(env.hermesHome, 'profiles', 'external');
  await mkdir(path.join(orphanDir, 'memories'), { recursive: true });
  await mkdir(externalDir, { recursive: true });
  await writeFile(path.join(orphanDir, 'memories', 'MEMORY.md'), 'keep this memory\n');
  const launchAgents = path.join(env.homeDir, 'Library', 'LaunchAgents');
  await mkdir(launchAgents, { recursive: true });
  const servicePath = path.join(launchAgents, 'ai.hermes.gateway-deleted.plist');
  await writeFile(servicePath, plist({ runtimePath, hermesHome: orphanDir, profileName: 'deleted' }));
  let savedState = null;
  const stopped = [];
  const repair = createHermesGatewayRepair({
    ...env,
    platform: 'darwin', readFile, readdir, writeFile, writeState: async (state) => { savedState = state; },
    exists: (filePath) => access(filePath).then(() => true).catch(() => false), mkdir, rename, rm,
    allowedRuntimeRoots: [runtimeRoot], uninstallService: async (service) => { stopped.push(service.profileName); },
    now: () => '2026-08-04T00:00:00.000Z',
  });
  const initial = {
    agents: [{ id: 'active', profileName: 'active' }],
    integrations: { hermesAgent: { importedProfileNames: ['deleted'], gatewayAutoStart: { enabled: true, management: 'per_profile', include: ['default', 'active', 'deleted'], exclude: ['deleted'] } } },
  };
  const { result } = await repair.run(initial);
  assert.deepEqual(stopped, ['deleted']);
  assert.deepEqual(result.cleanedAutoStartNames, ['deleted']);
  assert.deepEqual(result.archivedProfiles, ['deleted']);
  assert.equal(result.status, 'completed_with_warnings');
  assert.match(result.unresolved[0].reason, /外部 Hermes Profile/);
  assert.deepEqual(savedState.integrations.hermesAgent.gatewayAutoStart.include, ['default', 'active']);
  assert.deepEqual(savedState.integrations.hermesAgent.gatewayAutoStart.exclude, []);
  const archived = path.join(env.frakioWorkHome, 'backups', 'hermes-gateway-cleanup', '2026-08-04T00-00-00-000Z', 'profiles', 'deleted', 'memories', 'MEMORY.md');
  assert.equal(await readFile(archived, 'utf8'), 'keep this memory\n');
  await assert.rejects(access(orphanDir));
  await access(externalDir);
});

test('legacy Gateway repair is idempotent and never unloads an unowned service', async (t) => {
  const env = await fixture();
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const profileDir = path.join(env.hermesHome, 'profiles', 'active');
  await mkdir(profileDir, { recursive: true });
  const launchAgents = path.join(env.homeDir, 'Library', 'LaunchAgents');
  await mkdir(launchAgents, { recursive: true });
  await writeFile(path.join(launchAgents, 'ai.hermes.gateway-active.plist'), plist({ runtimePath: '/opt/external/python3', hermesHome: profileDir, profileName: 'active' }));
  let writes = 0;
  let unloads = 0;
  const repair = createHermesGatewayRepair({
    ...env,
    platform: 'darwin', readFile, readdir, writeFile, writeState: async () => { writes += 1; },
    exists: (filePath) => access(filePath).then(() => true).catch(() => false), mkdir, rename, rm,
    allowedRuntimeRoots: [path.join(env.homeDir, '.hermes-web-ui')], uninstallService: async () => { unloads += 1; },
    now: () => '2026-08-04T00:00:00.000Z',
  });
  const first = await repair.run({ agents: [{ id: 'active', profileName: 'active' }], integrations: { hermesAgent: { gatewayAutoStart: { include: ['active'], exclude: [] } } } });
  const second = await repair.run(first.state);
  assert.equal(unloads, 0);
  assert.equal(first.result.status, 'completed_with_warnings');
  assert.equal(second.result.stoppedServices.length, 0);
  assert.equal(writes, 2);
  await access(path.join(launchAgents, 'ai.hermes.gateway-active.plist'));
});

test('an interrupted state commit keeps a recovery manifest and can be retried safely', async (t) => {
  const env = await fixture();
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const orphanDir = path.join(env.hermesHome, 'profiles', 'old-agent');
  await mkdir(orphanDir, { recursive: true });
  await writeFile(path.join(orphanDir, 'SOUL.md'), 'recoverable\n');
  const initial = { agents: [], integrations: { hermesAgent: { importedProfileNames: ['old-agent'], gatewayAutoStart: { include: ['old-agent'], exclude: [] } } } };
  let attempt = 0;
  const createRepair = (writeState) => createHermesGatewayRepair({
    ...env, platform: 'darwin', readFile, readdir, writeFile, writeState,
    exists: (filePath) => access(filePath).then(() => true).catch(() => false), mkdir, rename, rm,
    stopGateway: async () => ({ stopped: true }),
    now: () => `2026-08-04T00:00:0${attempt++}.000Z`,
  });
  await assert.rejects(() => createRepair(async () => { throw new Error('simulated state failure'); }).run(initial), /simulated state failure/);
  const firstManifestPath = path.join(env.frakioWorkHome, 'backups', 'hermes-gateway-cleanup', '2026-08-04T00-00-00-000Z', 'repair.json');
  const firstManifest = JSON.parse(await readFile(firstManifestPath, 'utf8'));
  assert.deepEqual(firstManifest.archivedProfiles, ['old-agent']);
  assert.equal(await readFile(path.join(firstManifest.backupPath, 'profiles', 'old-agent', 'SOUL.md'), 'utf8'), 'recoverable\n');
  let saved = null;
  const retried = await createRepair(async (state) => { saved = state; }).run(initial);
  assert.equal(retried.result.status, 'completed');
  assert.equal(saved.runtimeMigrations.hermesGatewayLegacyCleanupV1.version, 1);
  assert.equal(JSON.parse(await readFile(firstManifestPath, 'utf8')).archivedProfiles[0], 'old-agent');
});

test('legacy Gateway processes are reported without being terminated', async (t) => {
  const env = await fixture();
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const legacyRuntimePath = path.join(env.homeDir, '.hermes-web-ui', 'desktop-runtime', 'hermes', '0.16.0', 'python', 'bin', 'python3');
  let saved = null;
  const repair = createHermesGatewayRepair({
    ...env,
    platform: 'darwin',
    readFile,
    readdir,
    writeFile,
    writeState: async (state) => { saved = state; },
    exists: (filePath) => access(filePath).then(() => true).catch(() => false),
    mkdir,
    rename,
    inspectProcesses: async () => [{
      pid: 4312,
      profileName: 'retired',
      runtimePath: legacyRuntimePath,
      command: `${legacyRuntimePath} -m hermes_cli.main --profile retired gateway run`,
    }],
    now: () => '2026-08-04T00:00:00.000Z',
  });

  const { result } = await repair.run({ agents: [], integrations: { hermesAgent: { gatewayAutoStart: { include: [], exclude: [] } } } });

  assert.equal(result.status, 'completed_with_warnings');
  assert.equal(result.stoppedServices.length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].profileName, 'retired');
  assert.match(result.unresolved[0].reason, /PID 4312/);
  assert.match(result.unresolved[0].reason, /.hermes-web-ui/);
  assert.deepEqual(saved.runtimeMigrations.hermesGatewayLegacyCleanupV1.unresolved, result.unresolved);
});

for (const platformFixture of [
  {
    platform: 'linux',
    servicePath: (env) => path.join(env.homeDir, '.config', 'systemd', 'user', 'hermes-gateway-retired.service'),
    serviceBody: ({ runtimePath, profileDir }) => `[Service]\nEnvironment=HERMES_HOME=${profileDir}\nExecStart=${runtimePath} -m hermes_cli.main --profile retired gateway run --replace\n`,
    runtimePath: (runtimeRoot) => path.join(runtimeRoot, 'python', 'bin', 'python3'),
    kind: 'systemd',
  },
  {
    platform: 'win32',
    servicePath: (env) => path.join(env.hermesHome, 'profiles', 'retired', 'gateway-service', 'Hermes_Gateway_retired.cmd'),
    serviceBody: ({ runtimePath }) => `@echo off\n"${runtimePath}" -m hermes_cli.main --profile retired gateway run --replace\n`,
    runtimePath: (runtimeRoot) => path.join(runtimeRoot, 'python', 'python.exe'),
    kind: 'scheduled-task',
  },
]) {
  test(`${platformFixture.platform} legacy Gateway service is identified and archived`, async (t) => {
    const env = await fixture();
    t.after(() => rm(env.root, { recursive: true, force: true }));
    const runtimeRoot = path.join(env.homeDir, '.hermes-web-ui', 'desktop-runtime', 'hermes', '0.16.0');
    const runtimePath = platformFixture.runtimePath(runtimeRoot);
    const profileDir = path.join(env.hermesHome, 'profiles', 'retired');
    const servicePath = platformFixture.servicePath(env);
    await mkdir(profileDir, { recursive: true });
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, platformFixture.serviceBody({ runtimePath, profileDir }));
    const uninstalled = [];
    const repair = createHermesGatewayRepair({
      ...env,
      platform: platformFixture.platform,
      readFile,
      readdir,
      writeFile,
      writeState: async () => {},
      exists: (filePath) => access(filePath).then(() => true).catch(() => false),
      mkdir,
      rename,
      allowedRuntimeRoots: [runtimeRoot],
      legacyRuntimeRoots: [runtimeRoot],
      uninstallService: async (service) => { uninstalled.push(`${service.kind}:${service.profileName}`); },
      now: () => '2026-08-04T00:00:00.000Z',
    });

    const { result } = await repair.run({ agents: [], integrations: { hermesAgent: { importedProfileNames: ['retired'], gatewayAutoStart: { include: ['retired'], exclude: [] } } } });

    assert.deepEqual(uninstalled, [`${platformFixture.kind}:retired`]);
    assert.deepEqual(result.stoppedServices, [`${platformFixture.kind}:retired`]);
    assert.deepEqual(result.archivedProfiles, ['retired']);
    await assert.rejects(access(servicePath));
    await access(path.join(result.backupPath, 'services', path.basename(servicePath)));
  });
}
