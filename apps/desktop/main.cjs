const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { isAllowedExternalUrl } = require('./external-url.cjs');
const { electronNodeExecutable: resolveElectronNodeExecutable } = require('./platform-paths.cjs');
const { closeActionForState, closeNoticeForPlatform, restoreWindow } = require('./window-lifecycle.cjs');
const { applyAppearance, appearanceState } = require('./appearance.cjs');
const { desktopRuntimeTarget } = require('./dev-runtime.cjs');
const { createDesktopUpdateService } = require('./desktop-update.cjs');

const APP_NAME = 'Frakio Work';
const DEFAULT_PORT = 8787;
const HEALTH_TIMEOUT_MS = 45000;
const HEALTH_INTERVAL_MS = 500;
const desktopLaunchId = randomUUID();
const desktopLaunchStartedAt = Date.now();

let mainWindow = null;
let apiProcess = null;
let apiPort = DEFAULT_PORT;
let apiUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
let rendererUrl = apiUrl;
let quitting = false;
let startupError = '';
let startingPromise = null;
let closeNoticeShown = false;
let desktopUpdateService = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const userHome = String(process.env.FRAKIO_WORK_HOME || '').trim() || path.join(os.homedir(), '.frakio-work');
const logsDir = path.join(userHome, 'logs');
const desktopLogPath = path.join(logsDir, 'desktop.log');
const apiLogPath = path.join(logsDir, 'api.log');
const managedServicePath = path.join(userHome, 'runtime', 'service.json');
const desktopSessionSecretPath = path.join(userHome, 'runtime', 'desktop-session-secret');
const SERVICE_PROTOCOL = 1;

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function writeDesktopLog(message) {
  try {
    ensureLogsDir();
    fs.appendFileSync(desktopLogPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function appendApiLog(chunk) {
  try {
    ensureLogsDir();
    fs.appendFileSync(apiLogPath, chunk);
  } catch {}
}

function appRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, '../..');
  return path.join(process.resourcesPath, 'app.asar.unpacked');
}

function resourcePath(...parts) {
  return path.join(appRoot(), ...parts);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findPort(preferred) {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = preferred + offset;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error('No free local port found for Frakio Work.');
}

function requestHealth(url) {
  return new Promise((resolve) => {
    const target = new URL('/api/health', `${url}/`);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.get(target, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve(res.statusCode >= 200 && res.statusCode < 500 && Number(body.apiProtocol || 0) >= 2);
      });
    });
    req.once('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function requestPage(url) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.get(target, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.once('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function discoverManagedService() {
  if (!app.isPackaged || String(process.env.FRAKIO_WORK_EXTERNAL_API_URL || '').trim()) return null;
  let descriptor;
  try {
    descriptor = JSON.parse(fs.readFileSync(managedServicePath, 'utf8'));
  } catch {
    return null;
  }
  if (descriptor?.deploymentMode !== 'managed-web' || !descriptor?.loopbackUrl) return null;
  if (descriptor.apiProtocol !== SERVICE_PROTOCOL) {
    throw new Error(`托管 Web 服务协议不兼容（服务 ${descriptor.apiProtocol || '未知'}，桌面 ${SERVICE_PROTOCOL}）。请先更新 Frakio Work。`);
  }
  if (!await requestHealth(descriptor.loopbackUrl)) return null;
  return descriptor;
}

function requestDesktopSession(url, secret) {
  return new Promise((resolve, reject) => {
    const target = new URL('/api/auth/desktop-session', `${url}/`);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '2',
        'X-Frakio-Desktop-Secret': secret,
      },
    }, (response) => {
      response.resume();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`托管 Web 桌面会话初始化失败（${response.statusCode}）。`));
        return;
      }
      const setCookie = response.headers['set-cookie']?.[0] || '';
      const pair = setCookie.split(';')[0];
      const separator = pair.indexOf('=');
      resolve(separator > 0 ? { name: pair.slice(0, separator), value: decodeURIComponent(pair.slice(separator + 1)) } : null);
    });
    request.once('error', reject);
    request.end('{}');
  });
}

async function authenticateManagedDesktop(url) {
  const secret = fs.readFileSync(desktopSessionSecretPath, 'utf8').trim();
  const cookie = await requestDesktopSession(url, secret);
  if (!cookie || !mainWindow) throw new Error('托管 Web 服务没有返回桌面会话。');
  await mainWindow.webContents.session.cookies.set({
    url,
    name: cookie.name,
    value: cookie.value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(url).protocol === 'https:',
  });
}

async function waitForHealth(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (await requestHealth(url)) return true;
    await wait(HEALTH_INTERVAL_MS);
  }
  return false;
}

async function waitForHealthOrExit(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (child.exitCode !== null || child.signalCode) {
      return { healthy: false, exited: true, code: child.exitCode, signal: child.signalCode };
    }
    if (await requestHealth(url)) return { healthy: true, exited: false, code: null, signal: null };
    await wait(HEALTH_INTERVAL_MS);
  }
  return { healthy: false, exited: false, code: null, signal: null };
}

function apiExitError(code, signal) {
  const detail = signal ? `信号 ${signal}` : `退出代码 ${code ?? '未知'}`;
  return `Frakio Work 本地服务启动失败（${detail}）。`;
}

async function waitForPage(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (await requestPage(url)) return true;
    await wait(HEALTH_INTERVAL_MS);
  }
  return false;
}

function electronNodeExecutable() {
  return resolveElectronNodeExecutable({
    packaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    appName: APP_NAME,
  });
}

function serverEntry() {
  return resourcePath('apps/api/server.mjs');
}

function uniquePathEntries(entries) {
  const seen = new Set();
  return entries
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function runtimePath() {
  return uniquePathEntries([
    path.join(appRoot(), 'node_modules', '.bin'),
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    ...String(process.env.PATH || '').split(path.delimiter),
  ]).join(path.delimiter);
}

async function startApi() {
  if (apiProcess && !apiProcess.killed) return apiUrl;
  if (startingPromise) return startingPromise;

  startingPromise = (async () => {
    startupError = '';
    apiPort = await findPort(DEFAULT_PORT);
    apiUrl = `http://127.0.0.1:${apiPort}`;

    const root = appRoot();
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FRAKIO_WORK_DESKTOP: '1',
      FRAKIO_WORK_PACKAGED: app.isPackaged ? '1' : '0',
      FRAKIO_WORK_LAUNCH_ID: desktopLaunchId,
      FRAKIO_WORK_LAUNCH_STARTED_AT: String(desktopLaunchStartedAt),
      FRAKIO_WORK_APP_VERSION: app.getVersion(),
      FRAKIO_WORK_PLATFORM: process.platform === 'darwin' ? 'macos' : process.platform,
      FRAKIO_WORK_ARCH: process.arch,
      FRAKIO_WORK_BUILD_CHANNEL: app.isPackaged ? 'production' : 'development',
      FRAKIO_WORK_HOME: userHome,
      FRAKIO_WORK_APP_ROOT: root,
      FRAKIO_WORK_WEB_DIST: resourcePath('dist'),
      PATH: runtimePath(),
      PORT: String(apiPort),
    };

    writeDesktopLog(`Starting API on ${apiUrl}`);
    const child = spawn(electronNodeExecutable(), [serverEntry()], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apiProcess = child;

    child.stdout.on('data', (chunk) => appendApiLog(chunk));
    child.stderr.on('data', (chunk) => appendApiLog(chunk));
    child.once('spawn', () => {
      writeDesktopLog(`API child spawned pid=${child.pid || ''} entry=${serverEntry()}`);
    });
    child.once('error', (error) => {
      startupError = error?.message || String(error);
      writeDesktopLog(`API spawn error: ${startupError}`);
    });
    child.once('exit', (code, signal) => {
      writeDesktopLog(`API exited code=${code ?? ''} signal=${signal ?? ''}`);
      const wasActiveProcess = apiProcess === child;
      if (wasActiveProcess) apiProcess = null;
      if (!quitting && wasActiveProcess) {
        startupError = apiExitError(code, signal);
        showErrorPage();
      }
    });

    const health = await waitForHealthOrExit(apiUrl, child);
    if (!health.healthy) {
      if (health.exited) {
        startupError = apiExitError(health.code, health.signal);
        writeDesktopLog(startupError);
        throw new Error(startupError);
      }
      startupError = 'Frakio Work 本地服务启动超时。';
      writeDesktopLog(startupError);
      throw new Error(startupError);
    }
    writeDesktopLog(`API ready at ${apiUrl}`);
    return apiUrl;
  })().finally(() => {
    startingPromise = null;
  });

  return startingPromise;
}

async function resolveRendererUrl() {
  const managed = await discoverManagedService();
  if (managed) {
    apiUrl = managed.loopbackUrl;
    rendererUrl = apiUrl;
    await authenticateManagedDesktop(apiUrl);
    writeDesktopLog(`Using managed Web service at ${apiUrl}`);
    return rendererUrl;
  }
  const runtimeTarget = desktopRuntimeTarget({
    packaged: app.isPackaged,
    devServerUrl: process.env.FRAKIO_WORK_DEV_SERVER_URL,
    externalApiUrl: process.env.FRAKIO_WORK_EXTERNAL_API_URL,
    embeddedApiUrl: apiUrl,
  });
  if (runtimeTarget.spawnApi) return startApi();

  apiUrl = runtimeTarget.apiUrl;
  writeDesktopLog(`Using development API at ${apiUrl}`);
  if (!await waitForHealth(apiUrl)) {
    throw new Error(`开发 API 未启动：${apiUrl}。请先运行 npm run dev。`);
  }
  writeDesktopLog(`Waiting for Vite at ${runtimeTarget.rendererUrl}`);
  if (!await waitForPage(runtimeTarget.rendererUrl)) {
    throw new Error(`Vite 开发服务器未启动：${runtimeTarget.rendererUrl}。请先运行 npm run dev。`);
  }
  writeDesktopLog(`Vite ready at ${runtimeTarget.rendererUrl}`);
  return runtimeTarget.rendererUrl;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 520,
    minHeight: 680,
    title: APP_NAME,
    show: false,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#f7faf8',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    acceptFirstMouse: true,
    ...(process.platform === 'darwin' ? {
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(apiUrl) || url.startsWith(rendererUrl) || url.startsWith('data:text/html')) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (closeActionForState({ quitting }) === 'close') return;
    event.preventDefault();
    mainWindow.hide();
    if (closeNoticeShown) return;
    closeNoticeShown = true;
    void dialog.showMessageBox(closeNoticeForPlatform(process.platform)).catch(() => {});
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function loadApp() {
  if (!mainWindow) createWindow();
  try {
    const url = await resolveRendererUrl();
    rendererUrl = url;
    const launchQaMode = !app.isPackaged
      ? String(process.env.FRAKIO_WORK_LAUNCH_QA || '').trim()
      : '';
    const loadUrl = ['logo', 'installing', 'welcome'].includes(launchQaMode)
      ? `${url}${url.includes('?') ? '&' : '?'}launchQa=${launchQaMode}`
      : url;
    await mainWindow.loadURL(loadUrl);
  } catch (error) {
    startupError = error?.message || String(error);
    writeDesktopLog(`Load failed: ${startupError}`);
    showErrorPage();
  }
}

function showErrorPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cleanError = String(startupError || 'Frakio Work 本地服务暂时不可用。')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const developmentStartup = !app.isPackaged && Boolean(String(process.env.FRAKIO_WORK_DEV_SERVER_URL || '').trim());
  const errorTitle = developmentStartup ? 'Frakio Work 开发服务器没有启动' : 'Frakio Work 本地服务没有启动';
  const retryLabel = developmentStartup ? '重新检测' : '重试启动';
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Frakio Work</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7faf8; color: #1f2825; }
    main { width: min(520px, calc(100vw - 48px)); display: grid; gap: 18px; }
    h1 { margin: 0; font-size: 24px; }
    p { margin: 0; color: #66736f; line-height: 1.6; }
    code { color: #9a3412; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    button { height: 36px; padding: 0 14px; border-radius: 7px; border: 1px solid #cfd9d5; background: white; color: #173c35; font: inherit; cursor: pointer; }
    button.primary { background: #173c35; color: white; border-color: #173c35; }
  </style>
</head>
<body>
  <main>
    <h1>${errorTitle}</h1>
    <p>${cleanError}</p>
    <p>可以重试启动，或者打开日志目录查看 <code>desktop.log</code> 和 <code>api.log</code>。</p>
    <div class="actions">
      <button class="primary" onclick="window.frakioDesktop.restartService()">${retryLabel}</button>
      <button onclick="window.frakioDesktop.openLogs()">打开日志目录</button>
    </div>
  </main>
</body>
</html>`)}`);
}

async function stopApi() {
  if (!apiProcess) return;
  const processToStop = apiProcess;
  apiProcess = null;
  writeDesktopLog('Stopping API');
  const exited = new Promise((resolve) => processToStop.once('exit', resolve));
  processToStop.kill('SIGTERM');
  await Promise.race([exited, wait(3500)]);
  if (processToStop.exitCode === null) {
    try {
      processToStop.kill('SIGKILL');
    } catch {}
    await Promise.race([exited, wait(1000)]);
  }
  writeDesktopLog(`API stopped exitCode=${processToStop.exitCode ?? 'unknown'} signal=${processToStop.signalCode || 'none'}`);
}

async function restartApiAndReload() {
  await stopApi();
  await loadApp();
}

async function openUpdateInstallerAndQuit(installerPath) {
  const error = await shell.openPath(installerPath);
  if (error) throw new Error(error);
  quitting = true;
  await stopApi();
  app.quit();
}

function openLogsDir() {
  ensureLogsDir();
  shell.openPath(logsDir);
}

function setLoginStartup(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: false,
    name: APP_NAME,
  });
}

function loginStartupEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function buildMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { label: '关于 Frakio Work', role: 'about' },
        { type: 'separator' },
        {
          label: '开机自动启动',
          type: 'checkbox',
          checked: loginStartupEnabled(),
          click: (item) => setLoginStartup(item.checked),
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: '服务',
      submenu: [
        { label: '打开 Frakio Work', click: () => showOrLoadMainWindow() },
        { label: '重启本地服务', click: () => restartApiAndReload() },
        { label: '打开日志目录', click: () => openLogsDir() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'reload', label: '重新载入窗口' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('frakio:restart-service', async () => {
  await restartApiAndReload();
  return { ok: true };
});

ipcMain.handle('frakio:open-logs', async () => {
  openLogsDir();
  return { ok: true };
});

ipcMain.handle('frakio:get-login-startup', () => ({ enabled: loginStartupEnabled() }));

ipcMain.handle('frakio:set-login-startup', (_event, enabled) => {
  setLoginStartup(Boolean(enabled));
  buildMenu();
  return { enabled: loginStartupEnabled() };
});

ipcMain.handle('frakio:get-appearance', () => appearanceState(nativeTheme));

ipcMain.handle('frakio:set-appearance', (_event, appearance) => {
  const state = applyAppearance(nativeTheme, appearance);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('frakio:appearance-changed', state);
  }
  return state;
});

ipcMain.handle('frakio:select-folder', async (_event) => {
  const target = BrowserWindow.fromWebContents(_event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(target, {
    title: '选择文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  return {
    canceled: Boolean(result.canceled),
    path: result.filePaths?.[0] || '',
  };
});

ipcMain.handle('frakio:window-control', (_event, action) => {
  const target = BrowserWindow.fromWebContents(_event.sender);
  if (!target || target.isDestroyed()) return { ok: false };
  if (action === 'close') target.close();
  if (action === 'minimize') target.minimize();
  if (action === 'zoom') {
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
  }
  return { ok: true };
});

ipcMain.handle('frakio:show-item-in-folder', async (_event, targetPath) => {
  const cleanPath = String(targetPath || '').trim();
  const relative = path.relative(os.homedir(), path.resolve(cleanPath || '.'));
  if (!cleanPath || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(cleanPath)) return { ok: false };
  shell.showItemInFolder(cleanPath);
  return { ok: true };
});

ipcMain.handle('frakio:open-release', async (_event, targetUrl) => {
  if (!isAllowedExternalUrl(targetUrl)) return { ok: false };
  await shell.openExternal(String(targetUrl));
  return { ok: true };
});

ipcMain.handle('frakio:open-external', async (_event, targetUrl) => {
  if (!isAllowedExternalUrl(targetUrl)) return { ok: false };
  await shell.openExternal(String(targetUrl));
  return { ok: true };
});

ipcMain.handle('frakio:get-update-state', () => desktopUpdateService?.getState() || {
  supported: false,
  packaged: app.isPackaged,
  platform: process.platform,
  arch: process.arch,
  phase: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: '',
  checkedAt: '',
  progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
});

ipcMain.handle('frakio:check-for-updates', () => desktopUpdateService?.checkForUpdates());
ipcMain.handle('frakio:download-update', () => desktopUpdateService?.downloadUpdate());
ipcMain.handle('frakio:cancel-update-download', () => desktopUpdateService?.cancelDownload());
ipcMain.handle('frakio:open-downloaded-update', () => desktopUpdateService?.openDownloadedInstaller());

app.on('second-instance', () => {
  showOrLoadMainWindow();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  showOrLoadMainWindow();
});

function showOrLoadMainWindow() {
  if (!restoreWindow(mainWindow)) void loadApp();
}

app.whenReady().then(async () => {
  ensureLogsDir();
  nativeTheme.themeSource = 'system';
  nativeTheme.on('updated', () => {
    const state = appearanceState(nativeTheme);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('frakio:appearance-changed', state);
    }
  });
  desktopUpdateService = createDesktopUpdateService({
    app,
    getApiUrl: () => apiUrl,
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('frakio:update-state-changed', state);
      }
    },
    openInstallerAndQuit: openUpdateInstallerAndQuit,
    log: writeDesktopLog,
  });
  await desktopUpdateService.initialize();
  buildMenu();
  await loadApp();
  desktopUpdateService.start();
}).catch((error) => {
  dialog.showErrorBox(APP_NAME, error?.message || String(error));
});

app.on('will-quit', async (event) => {
  desktopUpdateService?.stop();
  if (apiProcess) {
    event.preventDefault();
    await stopApi();
    app.exit(0);
  }
});
