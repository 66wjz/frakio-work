const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const appHandlers = new Map();
const sessions = new Map();
const mockApp = { on: (name, handler) => appHandlers.set(name, handler) };
const mockSession = {
  fromPartition(partition, options) {
    if (!sessions.has(partition)) {
      sessions.set(partition, {
        partition,
        options,
        events: new Map(),
        on(name, handler) { this.events.set(name, handler); },
        setPermissionRequestHandler(handler) { this.permissionHandler = handler; },
      });
    }
    return sessions.get(partition);
  },
};

Module._load = function load(request, parent, isMain) {
  if (request === 'electron') return { app: mockApp, session: mockSession };
  return originalLoad.call(this, request, parent, isMain);
};
const browser = require('./browser-webview.cjs');
Module._load = originalLoad;

function createHostContents() {
  const events = new Map();
  return { on: (name, handler) => events.set(name, handler), events };
}

function createGuest(id) {
  const events = new Map();
  const onceEvents = new Map();
  const guest = {
    id,
    events,
    onceEvents,
    on: (name, handler) => events.set(name, handler),
    once: (name, handler) => onceEvents.set(name, handler),
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; },
    loadURL: async (url) => { guest.loadedUrl = url; },
    capturePage: async (rect) => { guest.capturedRect = rect; return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,evidence' }; },
  };
  return guest;
}

test('browser webview hardener locks guest preferences and navigation', async () => {
  const sent = [];
  const window = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
  browser.installBrowserWebviewSecurity(() => window);
  const host = createHostContents();
  appHandlers.get('web-contents-created')({}, host);
  const preferences = { nodeIntegration: true, sandbox: false, webSecurity: false, preload: '/tmp/evil.js' };
  const params = { partition: browser.BROWSER_PARTITION, src: 'about:blank', disablewebsecurity: 'true', webpreferences: 'nodeIntegration=yes' };
  const attach = { prevented: false, preventDefault() { this.prevented = true; } };
  host.events.get('will-attach-webview')(attach, preferences, params);

  assert.equal(attach.prevented, false);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.webviewTag, false);
  assert.match(preferences.preload, /browser-preload\.cjs$/);
  assert.equal(params.partition, browser.BROWSER_PARTITION);
  assert.equal('disablewebsecurity' in params, false);
  assert.equal('webpreferences' in params, false);

  const guest = createGuest(91);
  host.events.get('did-attach-webview')({}, guest);
  assert.equal(browser.browserGuestIds.has(guest.id), true);
  assert.equal(guest.windowOpenHandler({ url: 'https://example.com/' }).action, 'deny');
  await Promise.resolve();
  assert.equal(guest.loadedUrl, 'https://example.com/');
  const blocked = { prevented: false, preventDefault() { this.prevented = true; } };
  guest.events.get('will-navigate')(blocked, 'file:///tmp/blocked.html');
  assert.equal(blocked.prevented, true);
  assert.equal(sent.at(-1)[1].error, '已阻止非网页协议。');

  const invalid = { prevented: false, preventDefault() { this.prevented = true; } };
  host.events.get('will-attach-webview')(invalid, {}, { partition: 'persist:other', src: 'https://example.com/' });
  assert.equal(invalid.prevented, true);
  guest.onceEvents.get('destroyed')();
});

test('browser session rejects permissions and downloads', () => {
  const browserSession = browser.configureBrowserSession(() => ({ isDestroyed: () => false, webContents: { send() {} } }));
  let granted = true;
  browserSession.permissionHandler({}, 'notifications', (value) => { granted = value; });
  assert.equal(granted, false);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  browserSession.events.get('will-download')(event);
  assert.equal(event.prevented, true);
});

test('annotation IPC only accepts registered browser guests', async () => {
  const handlers = new Map();
  browser.registerBrowserWebviewIpc({ on: (name, handler) => handlers.set(name, handler) }, () => null);
  const unknown = createGuest(92);
  await handlers.get('frakio:browser-annotation')({ sender: unknown }, { target: 'region', rect: { x: 1, y: 2, width: 30, height: 40 } });
  assert.equal(unknown.capturedRect, undefined);

  const guest = createGuest(93);
  browser.browserGuestIds.add(guest.id);
  const sent = [];
  await browser.handleBrowserAnnotation({ sender: guest }, { target: 'region', rect: { x: 1.2, y: 2.6, width: 30.4, height: 40.8 } }, () => ({ isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } }));
  assert.deepEqual(guest.capturedRect, { x: 1, y: 3, width: 30, height: 41 });
  assert.equal(sent.at(-1)[0], 'frakio:browser-annotation-created');
  browser.browserGuestIds.delete(guest.id);
});
