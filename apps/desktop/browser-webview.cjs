const path = require('node:path');
const { app, session } = require('electron');

const BROWSER_PARTITION = 'persist:frakio-browser';
const configuredSessions = new WeakSet();
const browserGuestIds = new Set();

function isAllowedBrowserUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowedInitialUrl(value) {
  return value === 'about:blank' || isAllowedBrowserUrl(value);
}

function browserPreloadPath() {
  return path.join(__dirname, 'browser-preload.cjs');
}

function hardenBrowserWebPreferences(webPreferences, params) {
  delete params.disablewebsecurity;
  delete params.webpreferences;
  params.partition = BROWSER_PARTITION;
  params.allowpopups = 'true';

  webPreferences.preload = browserPreloadPath();
  webPreferences.sandbox = true;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.nodeIntegrationInWorker = false;
  webPreferences.contextIsolation = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.webviewTag = false;
  webPreferences.plugins = false;
  webPreferences.experimentalFeatures = false;
  webPreferences.enableBlinkFeatures = '';
  webPreferences.disableBlinkFeatures = '';
}

function notifyHost(getWindow, error) {
  const window = getWindow?.();
  if (!window || window.isDestroyed()) return;
  window.webContents.send('frakio:browser-error', { error });
}

function configureBrowserSession(getWindow) {
  const browserSession = session.fromPartition(BROWSER_PARTITION, { cache: true });
  if (configuredSessions.has(browserSession)) return browserSession;
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.on('will-download', (event) => {
    event.preventDefault();
    notifyHost(getWindow, '第一版浏览器暂不支持下载。');
  });
  configuredSessions.add(browserSession);
  return browserSession;
}

function installBrowserWebviewSecurity(getWindow) {
  app.on('web-contents-created', (_event, hostContents) => {
    let pendingBrowserGuest = false;
    hostContents.on('will-attach-webview', (event, webPreferences, params) => {
      const initialUrl = String(params.src || 'about:blank');
      if (params.partition !== BROWSER_PARTITION || !isAllowedInitialUrl(initialUrl)) {
        pendingBrowserGuest = false;
        event.preventDefault();
        return;
      }
      configureBrowserSession(getWindow);
      hardenBrowserWebPreferences(webPreferences, params);
      pendingBrowserGuest = true;
    });
    hostContents.on('did-attach-webview', (_event, guestContents) => {
      if (!pendingBrowserGuest) return;
      pendingBrowserGuest = false;
      browserGuestIds.add(guestContents.id);
      guestContents.setWindowOpenHandler(({ url }) => {
        if (!isAllowedBrowserUrl(url)) {
          notifyHost(getWindow, '已阻止非网页协议。');
          return { action: 'deny' };
        }
        void guestContents.loadURL(url).catch((error) => {
          notifyHost(getWindow, error?.message || '网页打开失败。');
        });
        return { action: 'deny' };
      });
      guestContents.on('will-navigate', (event, url) => {
        if (isAllowedBrowserUrl(url)) return;
        event.preventDefault();
        notifyHost(getWindow, '已阻止非网页协议。');
      });
      guestContents.on('will-redirect', (event, url) => {
        if (isAllowedBrowserUrl(url)) return;
        event.preventDefault();
        notifyHost(getWindow, '已阻止重定向到非网页协议。');
      });
      guestContents.once('destroyed', () => browserGuestIds.delete(guestContents.id));
    });
  });
}

async function handleBrowserAnnotation(event, annotation, getWindow) {
  const contents = event.sender;
  if (!contents || !browserGuestIds.has(contents.id)) return;
  let evidenceDataUrl = '';
  if (annotation?.target === 'region' && annotation.rect?.width > 1 && annotation.rect?.height > 1) {
    const rect = {
      x: Math.max(0, Math.round(annotation.rect.x)),
      y: Math.max(0, Math.round(annotation.rect.y)),
      width: Math.min(4096, Math.max(1, Math.round(annotation.rect.width))),
      height: Math.min(4096, Math.max(1, Math.round(annotation.rect.height))),
    };
    const image = await contents.capturePage(rect).catch(() => null);
    if (image && !image.isEmpty()) evidenceDataUrl = image.toDataURL();
  }
  const window = getWindow?.();
  if (!window || window.isDestroyed()) return;
  window.webContents.send('frakio:browser-annotation-created', { annotation, evidenceDataUrl });
}

function registerBrowserWebviewIpc(ipcMain, getWindow) {
  ipcMain.on('frakio:browser-annotation', (event, annotation) => {
    void handleBrowserAnnotation(event, annotation, getWindow);
  });
}

module.exports = {
  BROWSER_PARTITION,
  browserGuestIds,
  browserPreloadPath,
  configureBrowserSession,
  hardenBrowserWebPreferences,
  handleBrowserAnnotation,
  installBrowserWebviewSecurity,
  isAllowedBrowserUrl,
  registerBrowserWebviewIpc,
};
