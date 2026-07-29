import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.FRAKIO_E2E_BROWSER || '';
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];

page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

await page.addInitScript(() => {
  const listeners = new Set();
  let state = {
    supported: true,
    packaged: true,
    platform: 'darwin',
    arch: 'arm64',
    phase: 'available',
    currentVersion: '0.1.8',
    latestVersion: '0.1.9',
    checkedAt: '2026-07-27T12:00:00.000Z',
    publishedAt: '2026-07-27T11:00:00.000Z',
    releaseUrl: 'https://github.com/MadsGao/frakio-work/releases/tag/v0.1.9',
    releaseNotes: 'Update',
    assetName: 'Frakio.Work-0.1.9-arm64.dmg',
    downloadedFileName: '',
    restartRequired: false,
    error: '',
    progress: { percent: 0, transferred: 0, total: 1000, bytesPerSecond: 0 },
  };
  const publish = (patch) => {
    state = { ...state, ...patch, progress: { ...state.progress, ...(patch.progress || {}) } };
    listeners.forEach((listener) => listener(state));
    return state;
  };
  window.__setDesktopUpdateState = publish;
  window.frakioDesktop = {
    platform: 'darwin',
    getAppearance: async () => ({ source: 'system', dark: false }),
    setAppearance: async () => ({ source: 'system', dark: false }),
    onAppearanceChanged: () => () => {},
    getUpdateState: async () => state,
    checkForUpdates: async () => state,
    downloadUpdate: async () => publish({ phase: 'downloading', progress: { percent: 36, transferred: 360, total: 1000 } }),
    cancelUpdateDownload: async () => publish({ phase: 'available', progress: { percent: 0, transferred: 0, total: 1000 } }),
    openDownloadedUpdate: async () => state,
    onUpdateStateChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    windowControl: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    openExternal: async () => ({ ok: true }),
  };
});

async function clearBlockingNotices() {
  const closeGuide = page.getByRole('button', { name: /(稍后处理|进入工作台)/ });
  await closeGuide.waitFor({ state: 'visible', timeout: 20000 }).catch(() => null);
  if (await closeGuide.count()) await closeGuide.click();
  const decline = page.getByRole('button', { name: '不发送' });
  if (await decline.count()) await decline.click();
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await clearBlockingNotices();
  await page.waitForTimeout(250);
  await mkdir('output/playwright', { recursive: true });

  const badge = page.getByRole('button', { name: '下载 Frakio Work v0.1.9' });
  assert.equal(await badge.isVisible(), true, '有新版时左栏没有显示更新徽标');
  await page.screenshot({ path: 'output/playwright/frakio-update-badge-available.png', fullPage: true });
  await badge.focus();
  assert.equal(await badge.evaluate((element) => element === document.activeElement), true, '更新徽标无法键盘聚焦');
  await badge.press('Enter');
  await page.getByRole('button', { name: /正在下载，36%/ }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('[role="menu"]').count(), 0, '点击更新徽标错误打开了用户菜单');

  const downloadingBadge = page.getByRole('button', { name: /正在下载，36%/ });
  await downloadingBadge.click();
  assert.equal(await page.getByText('36% · 360 B / 1000 B').isVisible(), true, '下载进度 Popover 没有显示');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'output/playwright/frakio-update-badge-downloading.png', fullPage: true });
  await page.getByRole('button', { name: '取消下载' }).click();
  await page.getByRole('button', { name: '下载 Frakio Work v0.1.9' }).waitFor({ state: 'visible' });

  await page.evaluate(() => window.__setDesktopUpdateState({
    phase: 'downloaded',
    downloadedFileName: 'Frakio.Work-0.1.9-arm64.dmg',
    restartRequired: true,
    progress: { percent: 100, transferred: 1000, total: 1000 },
  }));
  const downloadedBadge = page.getByRole('button', { name: /已下载，点击安装/ });
  await downloadedBadge.click();
  assert.equal(await page.getByRole('button', { name: '退出并打开安装包' }).isVisible(), true, '下载完成 Popover 缺少安装入口');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'output/playwright/frakio-update-badge-downloaded.png', fullPage: true });

  await page.setViewportSize({ width: 700, height: 900 });
  const compactBadge = page.locator('.desktop-update-badge');
  const compactSize = await compactBadge.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
  assert.ok(compactSize >= 17 && compactSize <= 19, `窄侧栏更新徽标尺寸不正确：${compactSize}`);
  await page.screenshot({ path: 'output/playwright/frakio-update-badge-compact.png', fullPage: true });
  assert.deepEqual(errors, [], `Browser console errors: ${errors.join(' | ')}`);
  console.log('Playwright desktop update badge flow passed.');
} finally {
  await browser.close();
}
