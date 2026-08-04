const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frakioDesktop', {
  platform: process.platform,
  restartService: () => ipcRenderer.invoke('frakio:restart-service'),
  openLogs: () => ipcRenderer.invoke('frakio:open-logs'),
  getLoginStartup: () => ipcRenderer.invoke('frakio:get-login-startup'),
  setLoginStartup: (enabled) => ipcRenderer.invoke('frakio:set-login-startup', Boolean(enabled)),
  getAppearance: () => ipcRenderer.invoke('frakio:get-appearance'),
  setAppearance: (appearance) => ipcRenderer.invoke('frakio:set-appearance', String(appearance || 'system')),
  onAppearanceChanged: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('frakio:appearance-changed', handler);
    return () => ipcRenderer.removeListener('frakio:appearance-changed', handler);
  },
  selectFolder: () => ipcRenderer.invoke('frakio:select-folder'),
  windowControl: (action) => ipcRenderer.invoke('frakio:window-control', action),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('frakio:show-item-in-folder', String(targetPath || '')),
  openObsidianVault: (targetPath) => ipcRenderer.invoke('frakio:open-obsidian-vault', String(targetPath || '')),
  openRelease: (targetUrl) => ipcRenderer.invoke('frakio:open-release', String(targetUrl || '')),
  openExternal: (targetUrl) => ipcRenderer.invoke('frakio:open-external', String(targetUrl || '')),
  browser: {
    onAnnotationCreated: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const handler = (_event, value) => listener(value);
      ipcRenderer.on('frakio:browser-annotation-created', handler);
      return () => ipcRenderer.removeListener('frakio:browser-annotation-created', handler);
    },
    onError: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const handler = (_event, value) => listener(value);
      ipcRenderer.on('frakio:browser-error', handler);
      return () => ipcRenderer.removeListener('frakio:browser-error', handler);
    },
  },
  getUpdateState: () => ipcRenderer.invoke('frakio:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('frakio:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('frakio:download-update'),
  cancelUpdateDownload: () => ipcRenderer.invoke('frakio:cancel-update-download'),
  openDownloadedUpdate: () => ipcRenderer.invoke('frakio:open-downloaded-update'),
  onUpdateStateChanged: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('frakio:update-state-changed', handler);
    return () => ipcRenderer.removeListener('frakio:update-state-changed', handler);
  },
});
