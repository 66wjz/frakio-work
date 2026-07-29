import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
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
  };
}

export async function assertDesktopPackageLayout(appPath) {
  const paths = desktopPackagePaths(appPath);
  await Promise.all([
    access(paths.executable),
    access(paths.serverEntry),
    access(paths.webDist),
    access(paths.mermaidPackage),
  ]);
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
    console.log(`Verified packaged Frakio Work API at ${url}.`);
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
