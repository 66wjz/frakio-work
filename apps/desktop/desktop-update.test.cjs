const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const {
  checksumForAsset,
  createDesktopUpdateService,
  releaseDownloadUrlAllowed,
  safeAssetName,
} = require('./desktop-update.cjs');

function response({ url, json, text, body, status = 200, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => json,
    text: async () => text,
    body: body == null ? null : Readable.from([body]),
  };
}

function releasePayload(bytes, checksum) {
  return {
    currentVersion: '0.1.8',
    latestVersion: '0.1.9',
    updateAvailable: true,
    releaseUrl: 'https://github.com/MadsGao/frakio-work/releases/tag/v0.1.9',
    notes: 'Update notes',
    publishedAt: '2026-07-27T12:00:00Z',
    asset: {
      name: 'Frakio.Work-0.1.9-arm64.dmg',
      browser_download_url: 'https://github.com/MadsGao/frakio-work/releases/download/v0.1.9/Frakio.Work-0.1.9-arm64.dmg',
      size: bytes.length,
    },
    checksumAsset: {
      name: 'Frakio-Work-mac-arm64-SHA256SUMS.txt',
      browser_download_url: 'https://github.com/MadsGao/frakio-work/releases/download/v0.1.9/Frakio-Work-mac-arm64-SHA256SUMS.txt',
    },
    checksum,
  };
}

async function fixture(fetchImpl, options = {}) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'frakio-update-test-'));
  const opened = [];
  const states = [];
  const service = createDesktopUpdateService({
    app: { isPackaged: true, getVersion: () => '0.1.8', getPath: () => userData },
    platform: 'darwin',
    arch: 'arm64',
    getApiUrl: () => 'http://127.0.0.1:8787',
    fetchImpl,
    broadcast: (state) => states.push(state),
    openInstallerAndQuit: async (filePath) => opened.push(filePath),
    ...options,
  });
  await service.initialize();
  return { service, userData, opened, states };
}

test('release URL and asset filename validation rejects renderer-controlled targets', () => {
  assert.equal(releaseDownloadUrlAllowed('https://github.com/MadsGao/frakio-work/releases/download/v0.1.9/app.dmg'), true);
  assert.equal(releaseDownloadUrlAllowed('https://example.com/app.dmg'), false);
  assert.equal(safeAssetName('Frakio.Work-0.1.9-arm64.dmg', '.dmg'), 'Frakio.Work-0.1.9-arm64.dmg');
  assert.equal(safeAssetName('../app.dmg', '.dmg'), '');
});

test('checksum parser selects the exact release asset', () => {
  const hash = 'a'.repeat(64);
  assert.equal(checksumForAsset(`${hash}  Frakio.Work-0.1.9-arm64.dmg\n`, 'Frakio.Work-0.1.9-arm64.dmg'), hash);
  assert.equal(checksumForAsset(`${hash}  another.dmg\n`, 'Frakio.Work-0.1.9-arm64.dmg'), '');
});

test('checks, downloads, verifies, restores and opens a cached update', async () => {
  const bytes = Buffer.from('frakio signed-ish dmg fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const release = releasePayload(bytes, digest);
  const fetchImpl = async (url) => {
    if (String(url).includes('/api/app-update/status')) return response({ url, json: release });
    if (String(url).endsWith('SHA256SUMS.txt')) return response({ url, text: `${digest}  ${release.asset.name}\n` });
    return response({ url: 'https://release-assets.githubusercontent.com/frakio.dmg', body: bytes, headers: { 'content-length': String(bytes.length) } });
  };
  const first = await fixture(fetchImpl);
  try {
    assert.equal((await first.service.checkForUpdates()).phase, 'available');
    const downloaded = await first.service.downloadUpdate();
    assert.equal(downloaded.phase, 'downloaded');
    assert.equal(downloaded.progress.percent, 100);
    assert.equal(await readFile(path.join(first.userData, 'updates', release.asset.name), 'utf8'), bytes.toString());
    await first.service.openDownloadedInstaller();
    assert.equal(first.opened[0], path.join(first.userData, 'updates', release.asset.name));

    const restored = createDesktopUpdateService({
      app: { isPackaged: true, getVersion: () => '0.1.8', getPath: () => first.userData },
      platform: 'darwin',
      arch: 'arm64',
      getApiUrl: () => 'http://127.0.0.1:8787',
      fetchImpl,
      openInstallerAndQuit: async () => {},
    });
    await restored.initialize();
    assert.equal(restored.getState().phase, 'downloaded');
    assert.equal(restored.getState().latestVersion, '0.1.9');
  } finally {
    await rm(first.userData, { recursive: true, force: true });
  }
});

test('deletes an update whose checksum does not match', async () => {
  const bytes = Buffer.from('corrupt update');
  const release = releasePayload(bytes, '0'.repeat(64));
  const fetchImpl = async (url) => {
    if (String(url).includes('/api/app-update/status')) return response({ url, json: release });
    if (String(url).endsWith('SHA256SUMS.txt')) return response({ url, text: `${'0'.repeat(64)}  ${release.asset.name}\n` });
    return response({ url: 'https://release-assets.githubusercontent.com/frakio.dmg', body: bytes, headers: { 'content-length': String(bytes.length) } });
  };
  const current = await fixture(fetchImpl);
  try {
    await current.service.checkForUpdates();
    const state = await current.service.downloadUpdate();
    assert.equal(state.phase, 'error');
    assert.match(state.error, /校验失败/);
  } finally {
    await rm(current.userData, { recursive: true, force: true });
  }
});

test('does not schedule update checks for source builds', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'frakio-update-source-'));
  let scheduled = 0;
  const service = createDesktopUpdateService({
    app: { isPackaged: false, getVersion: () => '0.1.8', getPath: () => userData },
    platform: 'darwin',
    getApiUrl: () => 'http://127.0.0.1:8787',
    setTimeoutImpl: () => { scheduled += 1; },
    setIntervalImpl: () => { scheduled += 1; },
  });
  try {
    await service.initialize();
    service.start();
    assert.equal(service.getState().supported, false);
    assert.equal(scheduled, 0);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
