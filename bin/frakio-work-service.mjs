#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.FRAKIO_WORK_HOME || path.join(os.homedir(), '.frakio-work');
const runtimeDir = path.join(home, 'runtime');
const descriptorPath = path.join(runtimeDir, 'service.json');
const logPath = path.join(home, 'logs', 'managed-web.log');
const authPath = path.join(home, 'data', 'managed-web-auth.json');
const command = process.argv[2] || 'status';

function runtimePlatform() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

async function runtimeNode() {
  const root = path.join(installRoot, 'runtime', 'hermes');
  const versions = (await import('node:fs/promises')).readdir(root, { withFileTypes: true });
  for (const entry of (await versions).filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const candidate = path.join(root, entry.name, runtimePlatform(), 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
    try {
      await (await import('node:fs/promises')).access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`Frakio Work package does not contain a ${runtimePlatform()} Node runtime.`);
}

async function descriptor() {
  return JSON.parse(await readFile(descriptorPath, 'utf8').catch(() => '{}'));
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(target, timeout = 45_000) {
  const url = typeof target === 'string' && target.includes('://')
    ? target
    : `http://127.0.0.1:${target}`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function start() {
  const current = await descriptor();
  if (alive(current.pid) && await waitForHealth(current.loopbackUrl || current.port, 1200)) {
    console.log(`Frakio Work is already running at ${current.loopbackUrl || `http://127.0.0.1:${current.port}`}.`);
    return;
  }
  await mkdir(path.dirname(logPath), { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  const node = await runtimeNode();
  const { openSync } = await import('node:fs');
  const output = openSync(logPath, 'a', 0o600);
  const port = Number(process.env.PORT || 8787);
  const child = spawn(node, [path.join(installRoot, 'apps', 'api', 'server.mjs')], {
    cwd: installRoot,
    detached: true,
    stdio: ['ignore', output, output],
    env: {
      ...process.env,
      FRAKIO_WORK_DEPLOYMENT_MODE: 'managed-web',
      FRAKIO_WORK_PACKAGED: '1',
      FRAKIO_WORK_HOME: home,
      FRAKIO_WORK_APP_ROOT: installRoot,
      FRAKIO_WORK_WEB_DIST: path.join(installRoot, 'dist'),
      FRAKIO_WORK_RUNTIME_HOME: path.join(installRoot, 'runtime'),
      FRAKIO_WORK_APP_VERSION: process.env.FRAKIO_WORK_APP_VERSION || '',
      PORT: String(port),
    },
  });
  child.unref();
  const loopbackUrl = String(process.env.FRAKIO_WORK_TLS_LOOPBACK_URL || '').trim()
    || `${process.env.FRAKIO_WORK_TLS_CERT && process.env.FRAKIO_WORK_TLS_KEY ? 'https://localhost' : 'http://127.0.0.1'}:${port}`;
  if (!await waitForHealth(loopbackUrl)) throw new Error(`Frakio Work did not become ready. See ${logPath}.`);
  console.log(`Frakio Work is ready at ${loopbackUrl}.`);
  const log = await readFile(logPath, 'utf8').catch(() => '');
  const generated = [...log.matchAll(/administrator password: ([^\s]+)/g)].at(-1)?.[1];
  if (generated) console.log(`Administrator password: ${generated}`);
}

async function stop() {
  const current = await descriptor();
  if (!alive(current.pid)) {
    console.log('Frakio Work is not running.');
    return;
  }
  process.kill(current.pid, 'SIGTERM');
  const deadline = Date.now() + 6000;
  while (alive(current.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 150));
  if (alive(current.pid)) process.kill(current.pid, 'SIGKILL');
  console.log('Frakio Work stopped.');
}

async function status() {
  const current = await descriptor();
  if (alive(current.pid) && await waitForHealth(current.loopbackUrl || current.port, 1200)) {
    console.log(JSON.stringify({ running: true, ...current }, null, 2));
    return;
  }
  console.log(JSON.stringify({ running: false }, null, 2));
  process.exitCode = 1;
}

async function resetPassword() {
  const next = randomBytes(18).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const record = {
    schema: 1,
    salt,
    hash: scryptSync(next, salt, 64).toString('hex'),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (alive((await descriptor()).pid)) {
    await stop();
    await start();
  }
  console.log(`Administrator password: ${next}`);
}

async function logs() {
  console.log(logPath);
  const content = await readFile(logPath, 'utf8').catch(() => '');
  console.log(content.split('\n').slice(-120).join('\n'));
}

async function runInstaller(action) {
  const installer = path.join(installRoot, 'scripts', process.platform === 'win32' ? 'install.ps1' : 'install.sh');
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, ...(action === 'rollback' ? ['-Rollback'] : [])]
    : [installer, ...(action === 'rollback' ? ['--rollback'] : [])];
  const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}.`)));
  });
}

if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'restart') { await stop(); await start(); }
else if (command === 'status') await status();
else if (command === 'logs') await logs();
else if (command === 'password' && process.argv[3] === 'reset') await resetPassword();
else if (command === 'update') await runInstaller('update');
else if (command === 'rollback') await runInstaller('rollback');
else {
  console.error('Usage: frakio-work <start|stop|restart|status|logs|password reset|update|rollback>');
  process.exitCode = 2;
}
