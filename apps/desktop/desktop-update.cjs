const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_MANIFEST = 'downloaded-update.json';
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function releaseDownloadUrlAllowed(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && /^\/MadsGao\/frakio-work\/releases\/download\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function responseUrlAllowed(value, fallback = '') {
  try {
    const url = new URL(String(value || fallback || ''));
    return url.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function safeAssetName(value, extension) {
  const name = path.basename(String(value || '').trim());
  if (!name || name !== String(value || '').trim() || !name.toLowerCase().endsWith(extension)) return '';
  return name;
}

function checksumForAsset(raw, assetName) {
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && path.basename(match[2].trim()) === assetName) return match[1].toLowerCase();
  }
  return '';
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function cloneState(state) {
  return {
    ...state,
    progress: { ...state.progress },
  };
}

function createDesktopUpdateService({
  app,
  platform = process.platform,
  arch = process.arch,
  getApiUrl,
  fetchImpl = global.fetch,
  broadcast = () => {},
  openInstallerAndQuit,
  log = () => {},
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
  clearTimeoutImpl = clearTimeout,
  clearIntervalImpl = clearInterval,
  checkDelayMs = CHECK_DELAY_MS,
  checkIntervalMs = CHECK_INTERVAL_MS,
}) {
  const supported = Boolean(app?.isPackaged && platform === 'darwin');
  const currentVersion = String(app?.getVersion?.() || '0.0.0');
  const updateRoot = path.join(app.getPath('userData'), 'updates');
  const manifestPath = path.join(updateRoot, UPDATE_MANIFEST);
  let releaseInfo = null;
  let downloadedPath = '';
  let downloadAbort = null;
  let downloadPartPath = '';
  let checkTimer = null;
  let checkInterval = null;
  let lastProgressBroadcast = 0;
  let state = {
    supported,
    packaged: Boolean(app?.isPackaged),
    platform,
    arch,
    phase: 'idle',
    currentVersion,
    latestVersion: '',
    checkedAt: '',
    publishedAt: '',
    releaseUrl: '',
    releaseNotes: '',
    assetName: '',
    downloadedFileName: '',
    restartRequired: false,
    error: '',
    progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
  };

  function emit(patch = {}) {
    state = {
      ...state,
      ...patch,
      progress: patch.progress ? { ...state.progress, ...patch.progress } : state.progress,
    };
    const snapshot = cloneState(state);
    broadcast(snapshot);
    return snapshot;
  }

  async function clearCachedUpdate() {
    downloadedPath = '';
    await fsp.rm(manifestPath, { force: true }).catch(() => {});
  }

  async function restoreCachedUpdate() {
    if (!supported) return;
    let manifest = null;
    try {
      manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    } catch {}
    if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) {
      if (manifest?.fileName) await fsp.rm(path.join(updateRoot, path.basename(manifest.fileName)), { force: true }).catch(() => {});
      await clearCachedUpdate();
      return;
    }
    const fileName = safeAssetName(manifest.fileName, '.dmg');
    const filePath = fileName ? path.join(updateRoot, fileName) : '';
    if (!filePath || !fs.existsSync(filePath) || !/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))) {
      await clearCachedUpdate();
      return;
    }
    const digest = await sha256File(filePath).catch(() => '');
    if (digest !== String(manifest.sha256).toLowerCase()) {
      await fsp.rm(filePath, { force: true }).catch(() => {});
      await clearCachedUpdate();
      return;
    }
    downloadedPath = filePath;
    emit({
      phase: 'downloaded',
      latestVersion: String(manifest.version || ''),
      assetName: fileName,
      downloadedFileName: fileName,
      restartRequired: true,
      error: '',
      progress: {
        percent: 100,
        transferred: Number(manifest.size || 0),
        total: Number(manifest.size || 0),
        bytesPerSecond: 0,
      },
    });
  }

  async function initialize() {
    await fsp.mkdir(updateRoot, { recursive: true });
    await restoreCachedUpdate();
    return cloneState(state);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetchImpl(url, options);
    if (!response?.ok) throw new Error(`更新服务返回 HTTP ${response?.status || 'unknown'}。`);
    return response.json();
  }

  async function checkForUpdates() {
    if (!supported || state.phase === 'downloading') return cloneState(state);
    emit({ phase: 'checking', error: '', checkedAt: new Date().toISOString() });
    try {
      const baseUrl = String(getApiUrl?.() || '').replace(/\/+$/, '');
      if (!baseUrl) throw new Error('本地更新服务尚未就绪。');
      const release = await fetchJson(`${baseUrl}/api/app-update/status?refresh=1`);
      if (release?.error) throw new Error(release.error);
      releaseInfo = release;
      const next = {
        latestVersion: String(release.latestVersion || ''),
        publishedAt: String(release.publishedAt || ''),
        releaseUrl: String(release.releaseUrl || ''),
        releaseNotes: String(release.notes || ''),
        assetName: String(release.asset?.name || ''),
        checkedAt: new Date().toISOString(),
        error: '',
      };
      if (!release.updateAvailable) {
        emit({ ...next, phase: 'up-to-date', restartRequired: false });
        return cloneState(state);
      }
      if (downloadedPath && state.latestVersion === next.latestVersion) {
        emit({ ...next, phase: 'downloaded', restartRequired: true });
        return cloneState(state);
      }
      if (!releaseDownloadUrlAllowed(release.asset?.browser_download_url)
        || !releaseDownloadUrlAllowed(release.checksumAsset?.browser_download_url)
        || !safeAssetName(release.asset?.name, '.dmg')) {
        throw new Error('GitHub Release 缺少当前架构的 DMG 或校验文件。');
      }
      emit({
        ...next,
        phase: 'available',
        restartRequired: false,
        downloadedFileName: '',
        progress: { percent: 0, transferred: 0, total: Number(release.asset?.size || 0), bytesPerSecond: 0 },
      });
    } catch (error) {
      emit({ phase: 'error', error: error?.message || String(error), restartRequired: false });
      log(`Update check failed: ${error?.stack || error}`);
    }
    return cloneState(state);
  }

  async function fetchChecksum(release, signal) {
    const checksumUrl = String(release?.checksumAsset?.browser_download_url || '');
    if (!releaseDownloadUrlAllowed(checksumUrl)) throw new Error('更新校验文件地址无效。');
    const response = await fetchImpl(checksumUrl, {
      headers: { Accept: 'text/plain', 'User-Agent': 'Frakio-Work' },
      redirect: 'follow',
      signal,
    });
    if (!response?.ok || !responseUrlAllowed(response.url, checksumUrl)) throw new Error('无法读取更新校验文件。');
    const digest = checksumForAsset(await response.text(), release.asset.name);
    if (!digest) throw new Error('校验文件中没有找到当前安装包。');
    return digest;
  }

  async function downloadUpdate() {
    if (!supported || state.phase === 'downloading') return cloneState(state);
    if (state.phase === 'downloaded' && downloadedPath) return cloneState(state);
    if (!releaseInfo?.updateAvailable) await checkForUpdates();
    if (!releaseInfo?.updateAvailable || state.phase === 'error') return cloneState(state);

    const assetUrl = String(releaseInfo.asset?.browser_download_url || '');
    const assetName = safeAssetName(releaseInfo.asset?.name, '.dmg');
    if (!releaseDownloadUrlAllowed(assetUrl) || !assetName) {
      emit({ phase: 'error', error: '更新安装包地址无效。' });
      return cloneState(state);
    }

    downloadAbort = new AbortController();
    downloadPartPath = path.join(updateRoot, `${assetName}.part`);
    const finalPath = path.join(updateRoot, assetName);
    const startedAt = Date.now();
    let transferred = 0;
    emit({
      phase: 'downloading',
      error: '',
      restartRequired: false,
      assetName,
      progress: { percent: 0, transferred: 0, total: Number(releaseInfo.asset?.size || 0), bytesPerSecond: 0 },
    });

    try {
      await fsp.rm(downloadPartPath, { force: true });
      const expectedHash = await fetchChecksum(releaseInfo, downloadAbort.signal);
      const response = await fetchImpl(assetUrl, {
        headers: { Accept: 'application/octet-stream', 'User-Agent': 'Frakio-Work' },
        redirect: 'follow',
        signal: downloadAbort.signal,
      });
      if (!response?.ok || !response?.body || !responseUrlAllowed(response.url, assetUrl)) throw new Error('更新安装包下载失败。');
      const contentLength = Number(response.headers?.get?.('content-length') || releaseInfo.asset?.size || 0);
      if (contentLength > 2 * 1024 * 1024 * 1024) throw new Error('更新安装包大小异常。');
      const handle = await fsp.open(downloadPartPath, 'w');
      const hash = createHash('sha256');
      try {
        for await (const rawChunk of response.body) {
          const chunk = Buffer.from(rawChunk);
          await handle.write(chunk);
          hash.update(chunk);
          transferred += chunk.length;
          const elapsedSeconds = Math.max(0.25, (Date.now() - startedAt) / 1000);
          const percent = contentLength > 0 ? Math.min(100, transferred / contentLength * 100) : 0;
          if (Date.now() - lastProgressBroadcast >= 120 || percent >= 100) {
            lastProgressBroadcast = Date.now();
            emit({
              progress: {
                percent,
                transferred,
                total: contentLength,
                bytesPerSecond: transferred / elapsedSeconds,
              },
            });
          }
        }
      } finally {
        await handle.close();
      }
      const actualHash = hash.digest('hex');
      if (actualHash !== expectedHash) throw new Error('更新安装包校验失败，文件已删除。');
      await fsp.rm(finalPath, { force: true });
      await fsp.rename(downloadPartPath, finalPath);
      const manifest = {
        schema: 1,
        version: String(releaseInfo.latestVersion || ''),
        fileName: assetName,
        sha256: actualHash,
        size: transferred,
        downloadedAt: new Date().toISOString(),
      };
      await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      downloadedPath = finalPath;
      downloadPartPath = '';
      emit({
        phase: 'downloaded',
        downloadedFileName: assetName,
        restartRequired: true,
        error: '',
        progress: { percent: 100, transferred, total: contentLength || transferred, bytesPerSecond: 0 },
      });
    } catch (error) {
      await fsp.rm(downloadPartPath, { force: true }).catch(() => {});
      downloadPartPath = '';
      if (error?.name === 'AbortError') {
        emit({
          phase: releaseInfo?.updateAvailable ? 'available' : 'idle',
          error: '',
          progress: { percent: 0, transferred: 0, total: Number(releaseInfo?.asset?.size || 0), bytesPerSecond: 0 },
        });
      } else {
        emit({ phase: 'error', error: error?.message || String(error), restartRequired: false });
        log(`Update download failed: ${error?.stack || error}`);
      }
    } finally {
      downloadAbort = null;
    }
    return cloneState(state);
  }

  async function cancelDownload() {
    if (state.phase !== 'downloading' || !downloadAbort) return cloneState(state);
    downloadAbort.abort();
    return cloneState(state);
  }

  async function openDownloadedInstaller() {
    if (state.phase !== 'downloaded' || !downloadedPath || !fs.existsSync(downloadedPath)) {
      emit({ phase: 'error', error: '已下载的安装包不存在，请重新下载。', restartRequired: false });
      return cloneState(state);
    }
    const relative = path.relative(updateRoot, downloadedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      emit({ phase: 'error', error: '安装包路径无效。', restartRequired: false });
      return cloneState(state);
    }
    try {
      await openInstallerAndQuit(downloadedPath);
    } catch (error) {
      emit({ phase: 'error', error: error?.message || String(error), restartRequired: false });
    }
    return cloneState(state);
  }

  function start() {
    if (!supported || checkTimer || checkInterval) return;
    checkTimer = setTimeoutImpl(() => {
      checkTimer = null;
      void checkForUpdates();
    }, checkDelayMs);
    checkInterval = setIntervalImpl(() => void checkForUpdates(), checkIntervalMs);
    checkTimer?.unref?.();
    checkInterval?.unref?.();
  }

  function stop() {
    if (checkTimer) clearTimeoutImpl(checkTimer);
    if (checkInterval) clearIntervalImpl(checkInterval);
    checkTimer = null;
    checkInterval = null;
    downloadAbort?.abort();
  }

  return {
    initialize,
    start,
    stop,
    getState: () => cloneState(state),
    checkForUpdates,
    downloadUpdate,
    cancelDownload,
    openDownloadedInstaller,
  };
}

module.exports = {
  CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
  checksumForAsset,
  compareVersions,
  createDesktopUpdateService,
  releaseDownloadUrlAllowed,
  responseUrlAllowed,
  safeAssetName,
};
