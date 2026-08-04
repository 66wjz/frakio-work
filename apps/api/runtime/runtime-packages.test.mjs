import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createRuntimePackageManager } from './package-manager.mjs';
import { createPiBridgePool } from './pi-bridge.mjs';
import { createPiRuntimeProvider } from './pi-package-provider.mjs';
import { createCliRuntimeProvider } from './cli-package-provider.mjs';
import { createRuntimePlatform } from './platform.mjs';
import { createRuntimeStore } from './store.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-packages-'));
  return { root, store: createRuntimeStore(path.join(root, 'frakio.db')) };
}

function provider() {
  return {
    async inspectBundled() {
      return {
        runtimeVersion: '0.83.0', runtimeBuildId: 'pi-bundled-083', runtimeDir: '/app',
        platform: process.platform, arch: process.arch, adapterProtocolVersion: 1, verificationState: 'verified',
      };
    },
    async releases() { return { verified: [], upstreamLatest: null, checkedAt: '' }; },
    async verify(pkg) { return { ok: !pkg.metadata?.reject, runtimeVersion: pkg.runtimeVersion, runtimeBuildId: pkg.runtimeBuildId }; },
  };
}

test('Runtime Package Manager requires an explicit active binding', async (t) => {
  const { store } = await fixture();
  t.after(() => store.close());
  const manager = createRuntimePackageManager({ store, providers: new Map([['pi', provider()]]) });
  assert.equal(await manager.resolveBinding('pi'), null);
  await manager.ensureBundled('pi');
  const bundled = await manager.resolveBinding('pi');
  assert.equal(bundled.runtimeVersion, '0.83.0');
  const firstStoredAt = store.getRuntimePackage(bundled.runtimeBuildId).updatedAt;
  await manager.status('pi');
  assert.equal(store.getRuntimePackage(bundled.runtimeBuildId).updatedAt, firstStoredAt, 'cached status reads must not rewrite bundled package state');
  store.putRuntimePackage({
    runtimeId: 'pi', runtimeVersion: '0.84.0', runtimeBuildId: 'pi-managed-084', runtimeDir: '/managed',
    source: 'managed', platform: process.platform, arch: process.arch, adapterProtocolVersion: 1,
    installationState: 'installed', verificationState: 'verified',
  });
  const activation = await manager.activate('pi', 'pi-managed-084');
  assert.equal(activation.activeBuildId, 'pi-managed-084');
  assert.equal(activation.previousBuildId, 'pi-bundled-083');
  const repeatedActivation = await manager.activate('pi', 'pi-managed-084');
  assert.equal(repeatedActivation.activationRevision, activation.activationRevision, 'reusing the active Build must not create a fake version switch');
  assert.equal(repeatedActivation.previousBuildId, 'pi-bundled-083');
  assert.equal((await manager.resolveBinding('pi')).runtimeVersion, '0.84.0');
  await assert.rejects(() => manager.remove('pi', '0.83.0'), /找不到已安装/);
});

test('Pi Package Provider rejects unsafe versions and catalog integrity mismatches', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-pi-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalogPath = path.join(root, 'runtime-catalog', 'pi.json');
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, JSON.stringify({
    schema: 1,
    runtimeId: 'pi',
    generatedAt: '2026-08-02T00:00:00.000Z',
    versions: [{ version: '0.84.0', integrity: 'sha512-catalog', adapterProtocolVersion: 1 }],
  }));
  const piProvider = createPiRuntimeProvider({
    appRoot: root,
    managedRoot: path.join(root, 'managed'),
    stagingRoot: path.join(root, 'staging'),
    catalogPath,
    execFile: async () => { throw new Error('npm must not run'); },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          'dist-tags': { latest: '0.84.0' },
          versions: { '0.84.0': { dist: { integrity: 'sha512-registry' }, engines: { node: '>=22' } } },
          time: { '0.84.0': '2026-08-01T00:00:00.000Z' },
        };
      },
    }),
  });
  const releases = await piProvider.releases({ refresh: true });
  assert.deepEqual(releases.verified, []);
  assert.equal(releases.upstreamLatest.version, '0.84.0');
  await assert.rejects(() => piProvider.install('../../escape'), /版本号无效/);
  await assert.rejects(() => piProvider.install('0.84.0'), /尚未进入 Frakio 稳定兼容目录/);
  await assert.rejects(() => piProvider.remove({ runtimeDir: path.join(root, 'outside') }), /删除路径无效/);
});

test('legacy bundled Pi imports into the managed directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-pi-legacy-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'legacy-app');
  const version = '0.83.0';
  for (const name of ['pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-tui']) {
    const packageRoot = path.join(appRoot, 'node_modules', '@earendil-works', name);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: `@earendil-works/${name}`, version }));
  }
  const managedRoot = path.join(root, 'managed');
  const piProvider = createPiRuntimeProvider({ appRoot, managedRoot, stagingRoot: path.join(root, 'staging') });
  const imported = await piProvider.importLegacyBundled({ runtimeVersion: version, runtimeDir: appRoot, artifactDigest: 'legacy-digest' });
  assert.equal(imported.source, 'managed');
  assert.equal(imported.metadata.legacyBundledImport, true);
  assert.equal(imported.verificationState, 'verified');
  assert.equal(imported.runtimeDir, path.join(managedRoot, version, `${process.platform}-${process.arch}`));
  assert.equal(JSON.parse(await readFile(path.join(imported.runtimeDir, 'node_modules', '@earendil-works', 'pi-ai', 'package.json'), 'utf8')).version, version);
});

test('legacy bundled Pi migration does not replace an existing Binding', async (t) => {
  const { store } = await fixture();
  t.after(() => store.close());
  store.putRuntimePackage({
    runtimeId: 'pi', runtimeVersion: '0.84.0', runtimeBuildId: 'pi-native-current', runtimeDir: '/native',
    source: 'native', platform: process.platform, arch: process.arch, adapterProtocolVersion: 1,
    installationState: 'installed', verificationState: 'verified', availability: 'ready',
  });
  store.putRuntimeActivation({ runtimeId: 'pi', activeBuildId: 'pi-native-current', previousBuildId: '', activationRevision: 'active-native' });
  const manager = createRuntimePackageManager({ store, providers: new Map([['pi', {
    async inspectBundled() {
      return { runtimeVersion: '0.83.0', runtimeBuildId: 'pi-bundled-legacy', runtimeDir: '/old-app', platform: process.platform, arch: process.arch, adapterProtocolVersion: 1, verificationState: 'verified' };
    },
    async importLegacyBundled() {
      return { runtimeVersion: '0.83.0', runtimeBuildId: 'pi-managed-imported', runtimeDir: '/managed', platform: process.platform, arch: process.arch, adapterProtocolVersion: 1, verificationState: 'verified' };
    },
  }]]) });
  const migrated = await manager.migrateLegacyBundled('pi');
  assert.equal(migrated.status, 'imported');
  assert.equal(store.getRuntimeActivation('pi').activeBuildId, 'pi-native-current');
  assert.equal(store.getRuntimePackage('pi-managed-imported').source, 'managed');
  assert.equal(store.listRuntimePackages('pi').some((item) => item.source === 'bundled'), false);
});

test('missing legacy bundled Pi is recorded as broken without activating PATH fallback', async (t) => {
  const { store } = await fixture();
  t.after(() => store.close());
  const manager = createRuntimePackageManager({ store, providers: new Map([['pi', {
    async inspectBundled() { return null; },
    async importLegacyBundled() { throw new Error('must not import'); },
  }]]) });
  const migrated = await manager.migrateLegacyBundled('pi');
  assert.equal(migrated.status, 'broken');
  assert.equal(migrated.package.availability, 'broken');
  assert.equal(store.getRuntimeActivation('pi'), undefined);
  assert.equal(await manager.resolveBinding('pi'), null);
});

test('native CLI binding is explicit and becomes broken when the executable changes', async (t) => {
  const { root, store } = await fixture();
  t.after(() => store.close());
  const executablePath = path.join(root, 'claude');
  await writeFile(executablePath, 'first-build');
  const cliProvider = createCliRuntimeProvider({
    runtimeId: 'claude', commandName: 'claude', packageName: '@anthropic-ai/claude-agent-sdk',
    managedRoot: path.join(root, 'managed'), stagingRoot: path.join(root, 'staging'), catalogPath: path.join(root, 'catalog.json'),
    resolveCommand: async () => executablePath,
    execFile: async () => ({ stdout: '2.1.220' }),
  });
  const manager = createRuntimePackageManager({ store, providers: new Map([['claude', cliProvider]]) });
  assert.equal(await manager.resolveBinding('claude'), null);
  const [candidate] = await manager.discover('claude');
  assert.equal(candidate.compatibility, 'compatible');
  const bound = await manager.bindNative('claude', { executablePath: candidate.realPath, fingerprint: candidate.fingerprint });
  assert.equal(bound.package.source, 'native');
  assert.equal((await manager.resolveBinding('claude')).runtimeBuildId, bound.package.runtimeBuildId);
  await writeFile(executablePath, 'changed-build');
  assert.equal(await manager.resolveBinding('claude'), null);
  assert.equal(store.getRuntimePackage(bound.package.runtimeBuildId).availability, 'broken');
});

test('schema v7 package inventory migrates without collapsing same-version Build IDs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-schema-v7-'));
  const databasePath = path.join(root, 'frakio.db');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta VALUES ('schema_version', '7');
    CREATE TABLE runtime_packages (
      runtime_id TEXT NOT NULL, runtime_version TEXT NOT NULL, runtime_build_id TEXT NOT NULL PRIMARY KEY,
      source TEXT NOT NULL, runtime_dir TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', arch TEXT NOT NULL DEFAULT '',
      artifact_digest TEXT NOT NULL DEFAULT '', adapter_protocol_version INTEGER NOT NULL DEFAULT 1,
      installation_state TEXT NOT NULL DEFAULT 'available', verification_state TEXT NOT NULL DEFAULT 'unverified',
      verification_receipt_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT NOT NULL DEFAULT '{}', installed_at TEXT NOT NULL,
      verified_at TEXT, last_used_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(runtime_id, runtime_version, source, platform, arch)
    );
  `);
  legacy.close();
  const store = createRuntimeStore(databasePath);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const common = {
    runtimeId: 'pi', runtimeVersion: '0.84.0', source: 'managed', runtimeDir: '/managed', platform: process.platform,
    arch: process.arch, adapterProtocolVersion: 1, installationState: 'installed', verificationState: 'verified',
  };
  store.putRuntimePackage({ ...common, runtimeBuildId: 'pi-managed-084-a', artifactDigest: 'a' });
  store.putRuntimePackage({ ...common, runtimeBuildId: 'pi-managed-084-b', artifactDigest: 'b' });
  assert.equal(store.schemaVersion, 11);
  assert.equal(store.listRuntimePackages('pi').length, 2);
  assert.ok(store.migrationBackupPath);
});

test('Pi Bridge Pool isolates workers by Runtime Build ID', async () => {
  const created = [];
  const factory = ({ runtimeBinding }) => {
    const emitter = new EventEmitter();
    created.push(runtimeBinding.runtimeBuildId);
    return {
      on: emitter.on.bind(emitter),
      async inspect() { return { runtimeVersion: runtimeBinding.runtimeVersion, runtimeBuildId: runtimeBinding.runtimeBuildId, hostProtocolVersion: 1 }; },
      async startRun(input) { return { nativeSessionId: `native-${runtimeBinding.runtimeBuildId}`, sessionFile: '', input }; },
      async steer() { return { ok: true }; }, async cancel() { return { ok: true }; },
      async disposeSession() { return { ok: true }; }, async close() {},
    };
  };
  const pool = createPiBridgePool({ bridgeFactory: factory });
  const first = { runtimeId: 'pi', runtimeVersion: '0.83.0', runtimeBuildId: 'build-a', runtimeDir: '/a', adapterProtocolVersion: 1 };
  const second = { runtimeId: 'pi', runtimeVersion: '0.84.0', runtimeBuildId: 'build-b', runtimeDir: '/b', adapterProtocolVersion: 1 };
  await pool.startRun({ runId: 'run-a', sessionId: 'session-a', runtimeBinding: first });
  await pool.startRun({ runId: 'run-b', sessionId: 'session-b', runtimeBinding: second });
  await pool.startRun({ runId: 'run-a2', sessionId: 'session-a2', runtimeBinding: first });
  assert.deepEqual(created.sort(), ['build-a', 'build-b']);
  assert.equal(pool.bridgeCount(), 2);
  await pool.close();
});

test('Chat changes Pi build through Handoff while work lane stays pinned', async (t) => {
  const { store } = await fixture();
  t.after(() => store.close());
  const manager = createRuntimePackageManager({ store, providers: new Map([['pi', provider()]]) });
  await manager.ensureBundled('pi');
  store.putRuntimePackage({
    runtimeId: 'pi', runtimeVersion: '0.84.0', runtimeBuildId: 'pi-managed-084', runtimeDir: '/managed', source: 'managed',
    platform: process.platform, arch: process.arch, adapterProtocolVersion: 1, installationState: 'installed', verificationState: 'verified',
  });
  const registry = {
    get() { return { id: 'pi', capabilities: { streaming: true, tools: true, approvals: false } }; },
    async detect() { return { status: 'ready', installed: true, version: '0.83.0', checkedAt: new Date().toISOString() }; },
  };
  const adapter = { async startRun() { return { nativeSessionId: 'native-new' }; }, async disposeSession() {} };
  const platform = createRuntimePlatform({
    store, registry, packageManager: manager, adapters: new Map([['pi', adapter]]),
    contextFactory: async () => ({ memory: [], handoff: { recentConversation: [] } }), skillResolver: async () => ({}),
  });
  const common = {
    state: { features: {} }, threadId: 'thread', thread: { id: 'thread' }, agent: { id: 'iris', runtimePolicy: {} },
    runtimeId: 'pi', workspace: null, profileSnapshot: { revision: 'profile' }, message: 'hello', permissionMode: 'smart',
  };
  const chatBefore = await platform.prepare(common);
  store.upsertSession({ ...chatBefore.session, nativeSessionId: 'native-old', lifecycleState: 'active' });
  const workBefore = await platform.prepare({ ...common, taskId: 'task-a', worktreeId: 'tree-a' });
  store.upsertSession({ ...workBefore.session, nativeSessionId: 'native-work', lifecycleState: 'active' });
  await manager.activate('pi', 'pi-managed-084');
  const chatAfter = await platform.prepare(common);
  const workAfter = await platform.prepare({ ...common, taskId: 'task-a', worktreeId: 'tree-a' });
  assert.equal(chatAfter.runtimeBinding.runtimeBuildId, 'pi-managed-084');
  assert.equal(chatAfter.session.nativeSessionId, '');
  assert.equal(chatAfter.session.resumeStrategy, 'handoff_resumed');
  assert.equal(workAfter.runtimeBinding.runtimeBuildId, 'pi-bundled-083');
  assert.equal(workAfter.session.nativeSessionId, 'native-work');
});
