import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('.');
const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-managed-web-e2e-'));
const port = 8897;
const password = 'managed-web-e2e-password';
const api = spawn(process.execPath, ['apps/api/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    FRAKIO_WORK_DEPLOYMENT_MODE: 'managed-web',
    FRAKIO_WORK_PACKAGED: '1',
    FRAKIO_WORK_DISABLE_AUTOSTART: '1',
    FRAKIO_WORK_HOME: home,
    FRAKIO_WORK_APP_ROOT: root,
    FRAKIO_WORK_WEB_DIST: path.join(root, 'dist'),
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
api.stdout.on('data', (chunk) => { output += chunk.toString(); });
api.stderr.on('data', (chunk) => { output += chunk.toString(); });

async function ready() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Managed Web did not start.\n${output}`);
}

try {
  await ready();
  const unauthenticated = await fetch(`http://127.0.0.1:${port}/api/state`);
  assert.equal(unauthenticated.status, 401);
  const descriptor = JSON.parse(await readFile(path.join(home, 'runtime', 'service.json'), 'utf8'));
  assert.equal(descriptor.deploymentMode, 'managed-web');

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByText('首次登录密码：').waitFor();
    await page.getByLabel('管理员密码').fill('Admin');
    await page.getByRole('button', { name: '进入工作台' }).click();
    await page.getByRole('heading', { name: '设置管理员密码' }).waitFor();
    await page.getByLabel('新密码', { exact: true }).fill(password);
    await page.getByLabel('确认新密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '保存并进入工作台' }).click();
    const shell = page.locator('.workbench-shell');
    await shell.waitFor();
    assert.equal(await shell.evaluate((element) => element.classList.contains('managed-web-shell')), true);
    assert.equal(await shell.evaluate((element) => element.classList.contains('mac-desktop-shell')), true);
  } finally {
    await browser.close();
  }
} finally {
  api.kill('SIGTERM');
}
