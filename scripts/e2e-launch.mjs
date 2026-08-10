import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const viewports = [
  { width: 1144, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
const installSteps = [
  { id: 'verify-runtime', label: '验证内置运行环境', status: 'ready', detail: '内置版本 0.19.0' },
  { id: 'write-config', label: '初始化 Hermes 配置', status: 'running', detail: '' },
  { id: 'start-runtime', label: '启动 Hermes Runtime', status: 'pending', detail: '' },
  { id: 'detect', label: '验证本地连接', status: 'pending', detail: '' },
];

function installJob(status, overrides = {}) {
  return {
    id: 'install-test-job',
    status,
    currentStepId: status === 'failed' ? 'start-runtime' : status === 'ready' ? '' : 'write-config',
    steps: installSteps.map((step) => status === 'ready'
      ? { ...step, status: 'ready' }
      : status === 'failed' && step.id === 'start-runtime'
        ? { ...step, status: 'failed', detail: 'Hermes Runtime 未能启动。' }
        : step),
    error: status === 'failed' ? 'Hermes Runtime 未能启动。' : '',
    bootstrap: status === 'ready' ? { status: 'connected', api: { online: true }, profiles: [] } : null,
    runtime: status === 'ready' ? { autoStart: { status: 'ready', steps: [] } } : null,
    ...overrides,
  };
}

function conversationThread(id, title) {
  return {
    id,
    spaceId: 'space_desktop_switch',
    workspaceId: null,
    title,
    mode: 'direct',
    executionMode: 'chat',
    workerOutputMode: 'summary',
    primaryAgentId: 'iris',
    defaultAgentId: 'iris',
    activeAgentId: 'iris',
    selectedAgents: ['iris'],
    participantAgentIds: ['iris'],
    followMode: 'auto',
    permissionMode: 'manual',
    agentModelOverrides: {},
    agentRunOverrides: {},
    vaultId: null,
    vaultName: '未连接资料库',
    messages: [],
    runTranscripts: [],
    runStatus: 'idle',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

function conversationSummary(thread) {
  return {
    ...thread,
    preview: '',
    messages: undefined,
    runTranscripts: undefined,
  };
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: viewport.width === 1280 ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    let runtimeReady = false;
    await page.route('**/*', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      if (pathname === '/api/hermes-runtime/status') {
        const ready = runtimeReady;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            autoStart: {
              status: ready ? 'ready' : 'starting',
              startedAt: new Date().toISOString(),
              finishedAt: ready ? new Date().toISOString() : null,
              steps: [
                { id: 'profiles', label: '读取本地 Hermes Profiles', status: 'ready', severity: 'standard', detail: '7 profiles' },
                { id: 'bridge', label: '启动 Frakio Work Bridge', status: 'ready', severity: 'core', detail: 'ipc:///tmp/frakio-work.sock' },
                { id: 'api', label: '启动外部兼容 API', status: ready ? 'warning' : 'running', severity: 'optional', detail: ready ? 'stderr: External API did not become ready\nfull command must not leak into the loading page' : 'http://127.0.0.1:8643/v1' },
              ],
              error: '',
              warnings: ready ? ['启动外部兼容 API: External API did not become ready'] : [],
            },
          }),
        });
        return;
      }
      if (pathname === '/api/agents') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'iris', name: 'Iris', role: 'Coordinator', model: '', color: '#0f766e', soul: '', scope: '' }] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const working = page.locator('[data-launch-panel="working"]');
    await working.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('[data-launch-panel]').count(), 1, `${viewport.width}: working phase rendered overlapping panels`);
    const workingBox = await working.boundingBox();
    assert.ok(workingBox && workingBox.x >= 0 && workingBox.x + workingBox.width <= viewport.width, `${viewport.width}: working panel overflowed`);
    runtimeReady = true;
    await page.locator('[data-launch-panel="welcome"]').waitFor({ state: 'visible', timeout: 12000 });
    assert.equal(await page.locator('[data-launch-panel]').count(), 1, `${viewport.width}: welcome phase rendered overlapping panels`);
    const welcome = page.locator('.launch-welcome');
    const welcomeBox = await welcome.boundingBox();
    assert.ok(welcomeBox && welcomeBox.x >= 0 && welcomeBox.y >= 0 && welcomeBox.x + welcomeBox.width <= viewport.width && welcomeBox.y + welcomeBox.height <= viewport.height, `${viewport.width}: welcome content was clipped`);
    const welcomeMetrics = await welcome.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    assert.equal(welcomeMetrics.scrollWidth <= welcomeMetrics.clientWidth + 1 && welcomeMetrics.scrollHeight <= welcomeMetrics.clientHeight + 1, true, `${viewport.width}: welcome content overflowed its box ${JSON.stringify(welcomeMetrics)}`);
    await context.close();
  }

  for (const terminalStatus of ['ready', 'failed']) {
    const context = await browser.newContext({ viewport: { width: 1144, height: 768 } });
    const page = await context.newPage();
    let installStarts = 0;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      if (pathname === '/api/hermes-bootstrap/status') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'missing', profiles: [], api: { online: false } }) });
        return;
      }
      if (pathname === '/api/hermes-runtime/diagnostics') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'not needed in launch test' }) });
        return;
      }
      if (pathname === '/api/hermes-bootstrap/install' && request.method() === 'POST') {
        installStarts += 1;
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: installJob('running'), reused: false }) });
        return;
      }
      if (pathname.endsWith('/events')) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const job = installJob(terminalStatus);
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
          body: `event: install.snapshot\ndata: ${JSON.stringify({ job })}\n\n`,
        });
        return;
      }
      if (pathname === '/api/agents') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const installPanel = page.locator('[data-launch-panel="installing"]');
    await installPanel.waitFor({ state: 'visible', timeout: 5000 });
    await installPanel.locator('.launch-install-step').nth(3).waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('.launch-install-step').count(), 4, `${terminalStatus}: install panel did not show four real phases`);
    assert.equal(installStarts, 1, `${terminalStatus}: missing Hermes started more than one install`);
    if (terminalStatus === 'ready') {
      await page.locator('[data-launch-panel="welcome"]').waitFor({ state: 'visible', timeout: 5000 });
    } else {
      const errorPanel = page.locator('[data-launch-panel="error"]');
      await errorPanel.waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await errorPanel.textContent(), /Hermes Runtime 未能启动/);
      await errorPanel.getByRole('button', { name: '打开 Hermes Agent 设置' }).click();
      await page.getByRole('heading', { name: 'Hermes 集成' }).waitFor({ state: 'visible', timeout: 5000 });
    }
    await context.close();
  }

  for (const colorMode of ['custom', 'native']) {
    const context = await browser.newContext({ viewport: { width: 1144, height: 768 } });
    await context.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ managed: false, authenticated: true }),
      });
    });
    await context.addInitScript(({ key, mode }) => {
      Object.defineProperty(window, 'frakioDesktop', {
        configurable: true,
        value: { platform: 'darwin' },
      });
      localStorage.setItem(key, JSON.stringify({
        activeSpaceId: 'space_material_test',
        dark: false,
        theme: {
          accentColor: '#735f88',
          sidebarBg: '#d8d1dc',
          opacity: 0.58,
          noise: 0,
          texture: 0,
          mode: 'soft',
          colorMode: mode,
          appearance: 'light',
          gradientColors: [{ id: 'primary', color: '#735f88', x: 0.5, y: 0.5, isPrimary: true }],
        },
      }));
    }, { key: 'frakio-work.launchMaterialSnapshot', mode: colorMode });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/?launchQa=logo`, { waitUntil: 'domcontentloaded' });
    const launch = page.locator('.launch-screen');
    const backdrop = page.locator('.workspace-material-backdrop');
    await launch.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await backdrop.count(), 1, `${colorMode}: launch did not keep exactly one persistent workspace backdrop`);
    assert.equal(await page.locator('.app').count(), 0, `${colorMode}: workbench surfaces remained mounted during launch`);
    assert.equal(await launch.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', `${colorMode}: launch content covered the shared backdrop`);
    assert.equal(await backdrop.getAttribute('data-space-color-mode'), colorMode, `${colorMode}: cached workspace material was not restored on the first frame`);
    assert.equal((await backdrop.evaluate((element) => getComputedStyle(element).getPropertyValue('--space-accent'))).trim(), '#735f88', `${colorMode}: cached workspace accent was not restored`);
    if (colorMode === 'native') {
      assert.equal(await backdrop.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'native: shared backdrop covered the native Electron material');
    } else {
      assert.notEqual(await backdrop.evaluate((element) => getComputedStyle(element).backgroundImage), 'none', 'custom: shared backdrop did not use the workspace background construction');
    }
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'frakioDesktop', {
        configurable: true,
        value: { platform: 'darwin' },
      });
    });
    const page = await context.newPage();
    const firstThread = conversationThread('thread_first', '首次会话');
    const secondThread = conversationThread('thread_second', '第二个会话');
    let releaseFirstThread;
    let releaseSecondThread;
    let signalFirstThreadRequest;
    let signalSecondThreadRequest;
    const firstThreadGate = new Promise((resolve) => { releaseFirstThread = resolve; });
    const secondThreadGate = new Promise((resolve) => { releaseSecondThread = resolve; });
    const firstThreadRequest = new Promise((resolve) => { signalFirstThreadRequest = resolve; });
    const secondThreadRequest = new Promise((resolve) => { signalSecondThreadRequest = resolve; });
    await page.route('**/*', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      if (pathname === '/api/agents') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'iris', name: 'Iris', role: 'Coordinator', model: '', color: '#0f766e', soul: '', scope: '' }] }) });
        return;
      }
      if (pathname === '/api/state') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ui: { appearance: 'light', libraryCollapsed: true, telemetryNoticeSeenAt: '2026-07-28T00:00:00.000Z', activeSpaceId: 'space_desktop_switch' } }) });
        return;
      }
      if (pathname === '/api/spaces') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            activeSpaceId: 'space_desktop_switch',
            spaces: [{
              id: 'space_desktop_switch',
              name: '桌面切换测试',
              iconKind: 'dot',
              iconValue: '',
              theme: {
                accentColor: '#735f88',
                sidebarBg: '#d8d1dc',
                opacity: 0.58,
                noise: 0,
                texture: 0,
                mode: 'soft',
                colorMode: 'native',
                appearance: 'light',
                gradientColors: [{ id: 'primary', color: '#735f88', x: 0.5, y: 0.5, isPrimary: true }],
              },
              createdAt: '2026-07-28T00:00:00.000Z',
              updatedAt: '2026-07-28T00:00:00.000Z',
            }],
          }),
        });
        return;
      }
      if (pathname === '/api/workspaces') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspaces: [] }) });
        return;
      }
      if (pathname === '/api/conversations') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [conversationSummary(firstThread), conversationSummary(secondThread)] }) });
        return;
      }
      if (pathname === '/api/hermes-bootstrap/status') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'connected', profiles: [], api: { online: true } }) });
        return;
      }
      if (pathname === '/api/hermes-runtime/status') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ autoStart: { status: 'ready', steps: [] }, profiles: [] }) });
        return;
      }
      if (pathname === '/api/user-profile') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userProfile: { avatarUrl: '', nickname: '测试用户', completedAt: '2026-07-28T00:00:00.000Z' } }) });
        return;
      }
      if (pathname === `/api/threads/${firstThread.id}/runs/active`) {
        signalFirstThreadRequest();
        await firstThreadGate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ thread: firstThread, run: null }) });
        return;
      }
      if (pathname === `/api/threads/${secondThread.id}/runs/active`) {
        signalSecondThreadRequest();
        await secondThreadGate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ thread: secondThread, run: null }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const shell = page.locator('.app');
    const main = page.locator('.main');
    await shell.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('new-chat-mode'));
    assert.equal(await shell.evaluate((element) => element.classList.contains('mac-conversation-shell')), true, 'desktop launch did not enter the macOS conversation shell');
    const launchMainBox = await main.boundingBox();
    assert.ok(launchMainBox, 'desktop launch did not render the main card');

    await page.getByRole('button', { name: /首次会话，参与 Agent/ }).click();
    await Promise.race([firstThreadRequest, new Promise((_, reject) => setTimeout(() => reject(new Error('首次会话未请求活动运行快照。')), 5000))]);
    await page.locator('.thread-opening-skeleton').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await shell.evaluate((element) => element.classList.contains('mac-conversation-shell')), true, 'macOS conversation shell disappeared while the first thread was loading');
    const pendingFirstBox = await main.boundingBox();
    assert.ok(pendingFirstBox, 'main card disappeared while the first thread was loading');
    assert.ok(Math.abs(pendingFirstBox.y - launchMainBox.y) <= 1, `main card moved vertically while the first thread was loading: ${launchMainBox.y} -> ${pendingFirstBox.y}`);
    assert.ok(Math.abs(pendingFirstBox.height - launchMainBox.height) <= 1, `main card changed height while the first thread was loading: ${launchMainBox.height} -> ${pendingFirstBox.height}`);
    releaseFirstThread();
    await page.getByRole('heading', { name: '首次会话' }).waitFor({ state: 'visible', timeout: 5000 });
    const loadedFirstBox = await main.boundingBox();
    assert.ok(loadedFirstBox, 'main card disappeared after the first thread loaded');
    assert.ok(Math.abs(loadedFirstBox.y - launchMainBox.y) <= 1, `main card moved vertically after the first thread loaded: ${launchMainBox.y} -> ${loadedFirstBox.y}`);
    assert.ok(Math.abs(loadedFirstBox.height - launchMainBox.height) <= 1, `main card changed height after the first thread loaded: ${launchMainBox.height} -> ${loadedFirstBox.height}`);

    await page.getByRole('button', { name: /第二个会话，参与 Agent/ }).click();
    await Promise.race([secondThreadRequest, new Promise((_, reject) => setTimeout(() => reject(new Error('第二个会话未请求活动运行快照。')), 5000))]);
    await page.getByRole('heading', { name: '首次会话' }).waitFor({ state: 'visible' });
    assert.equal(await shell.evaluate((element) => element.classList.contains('mac-conversation-shell')), true, 'macOS conversation shell disappeared while the second thread was loading');
    const pendingSecondBox = await main.boundingBox();
    assert.ok(pendingSecondBox, 'main card disappeared while the second thread was loading');
    assert.ok(Math.abs(pendingSecondBox.y - loadedFirstBox.y) <= 1, `main card moved vertically while the second thread was loading: ${loadedFirstBox.y} -> ${pendingSecondBox.y}`);
    assert.ok(Math.abs(pendingSecondBox.height - loadedFirstBox.height) <= 1, `main card changed height while the second thread was loading: ${loadedFirstBox.height} -> ${pendingSecondBox.height}`);
    releaseSecondThread();
    await page.getByRole('heading', { name: '第二个会话' }).waitFor({ state: 'visible', timeout: 5000 });
    await context.close();
  }
  console.log('Launch loading visual-state checks passed.');
} finally {
  await browser.close();
}
