import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackage = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'frakio-package-smoke-'));
const home = path.join(temporary, 'data');
const port = 8898;
const password = 'archive-test-password';

function platformName() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

const extension = process.platform === 'win32' ? '.zip' : '.tar.gz';
const archive = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(sourceRoot, 'release', 'managed-web', `Frakio.Work.Web-${sourcePackage.version}-${platformName()}${extension}`);
await access(archive).catch(() => {
  throw new Error(`Managed package archive not found: ${archive}`);
});
await execFileAsync('tar', [process.platform === 'win32' ? '-xf' : '-xzf', archive, '-C', temporary]);
const root = path.join(temporary, 'frakio-work');
const runtimeRoot = path.join(root, 'runtime', 'hermes');
const versions = (await import('node:fs/promises')).readdir(runtimeRoot, { withFileTypes: true });
const version = (await versions).find((entry) => entry.isDirectory());
assert.ok(version);
const node = path.join(runtimeRoot, version.name, platformName(), 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
const cli = path.join(root, 'bin', 'frakio-work-service.mjs');
const env = { ...process.env, FRAKIO_WORK_HOME: home, FRAKIO_WORK_ADMIN_PASSWORD: password, PORT: String(port) };

async function removeTemporaryPackage() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(temporary, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}

try {
  const { stdout: startOutput } = await execFileAsync(node, [cli, 'start'], { cwd: root, env, timeout: 60_000 });
  assert.match(startOutput, /ready/);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
  assert.equal(health.deploymentMode, 'managed-web');
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const descriptor = JSON.parse(await readFile(path.join(home, 'runtime', 'service.json'), 'utf8'));
  assert.equal(descriptor.deploymentMode, 'managed-web');
  console.log(`Managed package smoke passed for ${platformName()} at port ${port}.`);
} catch (error) {
  const log = await readFile(path.join(home, 'logs', 'managed-web.log'), 'utf8').catch(() => '');
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nManaged Web log:\n${log.slice(-5000)}`);
} finally {
  await execFileAsync(node, [cli, 'stop'], { cwd: root, env, timeout: 15_000 }).catch(() => {});
  await removeTemporaryPackage();
}
