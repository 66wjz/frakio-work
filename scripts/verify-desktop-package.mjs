import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const timeoutMs = 25_000;

export function desktopPackagePaths(appPath) {
  const bundle = path.resolve(appPath);
  const resources = path.join(bundle, 'Contents', 'Resources');
  const appRoot = path.join(resources, 'app.asar.unpacked');
  return {
    bundle,
    executable: path.join(bundle, 'Contents', 'MacOS', 'Frakio Work'),
    appRoot,
    serverEntry: path.join(appRoot, 'apps', 'api', 'server.mjs'),
    webDist: path.join(appRoot, 'dist'),
    mermaidPackage: path.join(appRoot, 'node_modules', 'beautiful-mermaid', 'package.json'),
    piWorker: path.join(appRoot, 'apps', 'api', 'runtime', 'workers', 'pi-worker.mjs'),
    codexAdapter: path.join(appRoot, 'apps', 'api', 'runtime', 'codex-app-server.mjs'),
    claudeAdapter: path.join(appRoot, 'apps', 'api', 'runtime', 'claude-agent-sdk.mjs'),
    runtimePlatform: path.join(appRoot, 'apps', 'api', 'runtime', 'platform.mjs'),
    adapterContract: path.join(appRoot, 'apps', 'api', 'runtime', 'adapter-contract.mjs'),
    sessionManager: path.join(appRoot, 'apps', 'api', 'runtime', 'session-manager.mjs'),
    contextCompiler: path.join(appRoot, 'apps', 'api', 'runtime', 'context-compiler.mjs'),
    skillProjector: path.join(appRoot, 'apps', 'api', 'runtime', 'skill-projector.mjs'),
    permissionBroker: path.join(appRoot, 'apps', 'api', 'runtime', 'permission-broker.mjs'),
    eventJournal: path.join(appRoot, 'apps', 'api', 'runtime', 'event-journal.mjs'),
    runtimePackageManager: path.join(appRoot, 'apps', 'api', 'runtime', 'package-manager.mjs'),
    piPackageProvider: path.join(appRoot, 'apps', 'api', 'runtime', 'pi-package-provider.mjs'),
    cliPackageProvider: path.join(appRoot, 'apps', 'api', 'runtime', 'cli-package-provider.mjs'),
    hostController: path.join(appRoot, 'apps', 'api', 'runtime', 'host-controller.mjs'),
    modelGateway: path.join(appRoot, 'apps', 'api', 'runtime', 'model-gateway.mjs'),
    piRuntimeCatalog: path.join(appRoot, 'runtime-catalog', 'pi.json'),
    claudeSdkPackage: path.join(appRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
    claudePlatformPackage: path.join(appRoot, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, 'package.json'),
    piPackageScope: path.join(appRoot, 'node_modules', '@earendil-works'),
    acpSdkPackage: path.join(appRoot, 'node_modules', '@agentclientprotocol', 'sdk', 'package.json'),
    braceExpansionPackage: path.join(appRoot, 'node_modules', 'brace-expansion', 'package.json'),
  };
}

export async function assertDesktopPackageLayout(appPath) {
  const paths = desktopPackagePaths(await realpath(appPath));
  await Promise.all([
    access(paths.executable),
    access(paths.serverEntry),
    access(paths.webDist),
    access(paths.mermaidPackage),
    access(paths.piWorker),
    access(paths.codexAdapter),
    access(paths.claudeAdapter),
    access(paths.runtimePlatform),
    access(paths.adapterContract),
    access(paths.sessionManager),
    access(paths.contextCompiler),
    access(paths.skillProjector),
    access(paths.permissionBroker),
    access(paths.eventJournal),
    access(paths.runtimePackageManager),
    access(paths.piPackageProvider),
    access(paths.cliPackageProvider),
    access(paths.hostController),
    access(paths.modelGateway),
    access(paths.piRuntimeCatalog),
    access(paths.claudeSdkPackage),
    access(paths.braceExpansionPackage),
  ]);
  const braceExpansion = JSON.parse(await readFile(paths.braceExpansionPackage, 'utf8'));
  assert.equal(braceExpansion.version, '5.0.8');
  await assert.rejects(() => access(paths.piPackageScope), 'Desktop package must not bundle Pi SDK packages.');
  await assert.rejects(() => access(paths.acpSdkPackage), 'Desktop package must not bundle Gemini ACP SDK.');
  await assert.rejects(() => access(paths.claudePlatformPackage), 'Desktop package must not bundle Claude Code platform binaries.');
  return paths;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, child, output) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`Packaged API exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode || 'none'}).\n${output()}`);
    }
    const response = await fetch(`${url}/api/health`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged API did not become healthy within ${timeoutMs / 1000} seconds.\n${output()}`);
}

async function verifyPackagedRuntimeInventory(url) {
  const response = await fetch(`${url}/api/runtimes`);
  assert.equal(response.ok, true, `Packaged Runtime inventory failed with ${response.status}.`);
  const payload = await response.json();
  assert.deepEqual(payload.runtimes.map((runtime) => runtime.id), ['hermes', 'pi', 'codex', 'claude']);

  const hermes = payload.runtimes.find((runtime) => runtime.id === 'hermes');
  assert.equal(hermes?.bundled, true, 'The base package must include Hermes.');
  for (const runtimeId of ['pi', 'codex', 'claude']) {
    const runtime = payload.runtimes.find((item) => item.id === runtimeId);
    assert.equal(runtime?.bundled, false, `${runtimeId} must remain an optional Runtime.`);
    assert.equal(runtime?.activeBinding, null, `${runtimeId} must not be bound on a fresh install.`);
  }
  return payload.runtimes;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_500))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export async function verifyDesktopPackage(appPath) {
  assert.equal(process.platform, 'darwin', 'Desktop package verification must run on macOS.');
  const paths = await assertDesktopPackageLayout(appPath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'frakio-desktop-package-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(paths.executable, [paths.serverEntry], {
    cwd: paths.appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FRAKIO_WORK_DESKTOP: '1',
      FRAKIO_WORK_PACKAGED: '1',
      FRAKIO_WORK_HOME: path.join(tempRoot, 'home'),
      FRAKIO_WORK_APP_ROOT: paths.appRoot,
      FRAKIO_WORK_WEB_DIST: paths.webDist,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => {
    output.push(String(chunk));
    if (output.join('').length > 12_000) output.splice(0, 1);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  try {
    await waitForHealth(url, child, () => output.join('').slice(-12_000));
    await verifyPackagedRuntimeInventory(url);
    console.log(`Verified packaged Frakio Work API and optional Runtime inventory at ${url}.`);
  } finally {
    await stop(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const appPath = process.argv[2] || path.join('release', `mac-${process.arch}`, 'Frakio Work.app');
  await verifyDesktopPackage(appPath);
}
