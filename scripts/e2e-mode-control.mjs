import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.FRAKIO_E2E_API_URL || 'http://127.0.0.1:8787';

async function attachLocalApiProxy(page, modePatchState) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();

    const modeMatch = request.method() === 'PATCH' && url.pathname.match(/^\/api\/threads\/([^/]+)\/mode$/);
    if (modeMatch && modePatchState.behavior === 'failure') {
      await new Promise((resolve) => setTimeout(resolve, 260));
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Test collaboration runtime is unavailable.', code: 'COLLABORATION_RUNTIME_DEPENDENCY_MISSING' }),
      });
    }
    if (modeMatch) {
      if (modePatchState.behavior === 'slow') await new Promise((resolve) => setTimeout(resolve, 1000));
      const threadResponse = await fetch(`${apiUrl}/api/threads/${modeMatch[1]}`);
      const threadPayload = await threadResponse.json();
      const requestedMode = JSON.parse(request.postData() || '{}').mode === 'work' ? 'work' : 'chat';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ thread: { ...threadPayload.thread, executionMode: requestedMode }, mode: requestedMode }),
      });
    }

    const headers = { ...request.headers() };
    delete headers.origin;
    delete headers.host;
    const response = await fetch(`${apiUrl}${url.pathname}${url.search}`, {
      method: request.method(),
      headers,
      body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer(),
    });
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

async function createWorkbenchPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 900 },
    reducedMotion: options.reducedMotion || 'no-preference',
  });
  await context.addInitScript(() => window.localStorage.setItem('frakio-work.firstUseGuideCompleted', '1'));
  const page = await context.newPage();
  const modePatchState = { behavior: 'success' };
  await attachLocalApiProxy(page, modePatchState);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '我们接下来做点什么？', exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  return { context, page, modePatchState };
}

async function openModeMenu(page) {
  const trigger = page.getByRole('button', { name: /^运行模式：/ });
  await trigger.click();
  // Radix adds aria-labelledby to the content, which takes precedence over
  // aria-label in Chromium's accessibility tree after a screenshot.
  const menu = page.locator('[role="menu"][aria-label="选择对话运行模式"]');
  await menu.waitFor({ state: 'visible' });
  return { trigger, menu };
}

async function chooseMode(page, mode) {
  const { trigger } = await openModeMenu(page);
  const option = page.getByRole('menuitemradio', { name: new RegExp(`^${mode}`, 'i') });
  await option.click({ force: true });
  return trigger;
}

const browser = await chromium.launch({ headless: true });
await mkdir('output/playwright', { recursive: true });

try {
  const primary = await createWorkbenchPage(browser);
  const { page } = primary;
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));

  const modeRoot = page.locator('.execution-mode-control');
  const modeTrigger = page.getByRole('button', { name: '运行模式：Chat' });
  assert.equal(await modeRoot.count(), 1);
  assert.equal(await modeRoot.getAttribute('data-mode'), 'chat');
  assert.equal(await modeTrigger.getAttribute('aria-expanded'), 'false');

  const initialMetrics = await modeTrigger.evaluate((element) => {
    const style = getComputedStyle(element);
    const toolbar = element.closest('.composer-toolbar');
    const permission = toolbar?.querySelector('.permission-select');
    const model = toolbar?.querySelector('.provider-model-trigger');
    return {
      height: element.getBoundingClientRect().height,
      borderWidth: style.borderTopWidth,
      background: style.backgroundColor,
      radius: style.borderRadius,
      toolbarOverflow: Boolean(toolbar && toolbar.scrollWidth > toolbar.clientWidth),
      permissionBorder: permission ? getComputedStyle(permission).borderTopWidth : '',
      permissionBackground: permission ? getComputedStyle(permission).backgroundColor : '',
      modelBorder: model ? getComputedStyle(model).borderTopWidth : '',
      modelBackground: model ? getComputedStyle(model).backgroundColor : '',
    };
  });
  assert.ok(Math.abs(initialMetrics.height - 32) <= 1, JSON.stringify(initialMetrics));
  assert.equal(initialMetrics.borderWidth, '0px');
  assert.equal(initialMetrics.background, 'rgba(0, 0, 0, 0)');
  assert.equal(initialMetrics.radius, '7px');
  assert.equal(initialMetrics.permissionBorder, '0px');
  assert.equal(initialMetrics.permissionBackground, 'rgba(0, 0, 0, 0)');
  assert.equal(initialMetrics.modelBorder, '0px');
  assert.equal(initialMetrics.modelBackground, 'rgba(0, 0, 0, 0)');
  assert.equal(initialMetrics.toolbarOverflow, false);
  await page.locator('.new-chat-composer').screenshot({ path: 'output/playwright/composer-restrained-chat.png' });

  const { trigger, menu } = await openModeMenu(page);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  const chatOption = page.getByRole('menuitemradio', { name: /^Chat/i });
  const workOption = page.getByRole('menuitemradio', { name: /^Work/i });
  assert.equal(await chatOption.getAttribute('aria-checked'), 'true');
  assert.equal(await workOption.getAttribute('aria-checked'), 'false');
  await page.locator('.new-chat-composer').screenshot({ path: 'output/playwright/composer-restrained-mode-menu.png' });
  await workOption.click();
  assert.equal(await modeRoot.getAttribute('data-mode'), 'work');
  assert.equal(await page.getByRole('button', { name: '运行模式：Work' }).getAttribute('aria-expanded'), 'false');
  await page.locator('.new-chat-composer').screenshot({ path: 'output/playwright/composer-restrained-work.png' });

  const workTrigger = page.getByRole('button', { name: '运行模式：Work' });
  await workTrigger.focus();
  await workTrigger.press('ArrowDown');
  await menu.waitFor({ state: 'visible' });
  assert.equal(await workTrigger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await workTrigger.getAttribute('aria-expanded'), 'false');

  const permissionTrigger = page.getByRole('button', { name: '操作权限' });
  await permissionTrigger.click();
  assert.equal(await permissionTrigger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await permissionTrigger.getAttribute('aria-expanded'), 'false');

  await chooseMode(page, 'Chat');
  const threadButtons = page.locator('.rail-thread-main');
  assert.ok(await threadButtons.count() > 0, 'Existing-thread rollback test needs one thread.');
  await threadButtons.first().click();
  const threadModeRoot = page.locator('.execution-mode-control');
  await threadModeRoot.waitFor({ state: 'visible' });
  if (await threadModeRoot.getAttribute('data-mode') === 'work') await chooseMode(page, 'Chat');

  primary.modePatchState.behavior = 'slow';
  const threadTrigger = await chooseMode(page, 'Work');
  assert.equal(await threadModeRoot.getAttribute('data-mode'), 'work', 'Visual selection must update before the API responds.');
  await page.waitForFunction(() => document.querySelector('.execution-mode-trigger')?.getAttribute('aria-busy') === 'true');
  assert.equal(await threadTrigger.isDisabled(), true, 'A pending switch must prevent duplicate requests.');
  await page.waitForFunction(() => document.querySelector('.execution-mode-trigger')?.getAttribute('aria-busy') !== 'true');
  assert.equal(await page.getByRole('button', { name: '运行模式：Work' }).isDisabled(), false);

  await chooseMode(page, 'Chat');
  await page.waitForFunction(() => document.querySelector('.execution-mode-trigger')?.getAttribute('aria-busy') === 'true');
  await page.waitForFunction(() => document.querySelector('.execution-mode-trigger')?.getAttribute('aria-busy') !== 'true');
  primary.modePatchState.behavior = 'failure';
  await chooseMode(page, 'Work');
  assert.equal(await threadModeRoot.getAttribute('data-mode'), 'work', 'Optimistic selection must happen before the failure response.');
  await page.getByText('Test collaboration runtime is unavailable.', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(40);
  assert.equal(await threadModeRoot.getAttribute('data-mode'), 'chat', 'Failed mode initialization must return to Chat.');

  assert.deepEqual(errors.filter((value) => !value.includes('favicon') && !value.includes('503 (Service Unavailable)')), []);
  await primary.context.close();

  const reduced = await createWorkbenchPage(browser, { viewport: { width: 720, height: 820 }, reducedMotion: 'reduce' });
  const reducedTrigger = reduced.page.getByRole('button', { name: '运行模式：Chat' });
  const reducedMetrics = await reducedTrigger.evaluate((element) => {
    const toolbar = element.closest('.composer-toolbar');
    const composer = element.closest('.composer');
    return {
      transitionDuration: getComputedStyle(element).transitionDuration,
      toolbarOverflow: Boolean(toolbar && toolbar.scrollWidth > toolbar.clientWidth),
      composerOverflow: Boolean(composer && composer.scrollWidth > composer.clientWidth),
    };
  });
  assert.equal(reducedMetrics.transitionDuration, '0s');
  assert.equal(reducedMetrics.toolbarOverflow, false);
  assert.equal(reducedMetrics.composerOverflow, false);
  await reduced.page.locator('.new-chat-composer').screenshot({ path: 'output/playwright/composer-restrained-720.png' });
  await reduced.context.close();

  const narrow = await createWorkbenchPage(browser, { viewport: { width: 640, height: 820 }, reducedMotion: 'reduce' });
  await narrow.page.getByRole('button', { name: /Hermes Profile 模型/ }).click();
  const narrowModelMenu = narrow.page.locator('.provider-model-menu.advanced');
  await narrowModelMenu.waitFor({ state: 'visible' });
  assert.equal(await narrowModelMenu.locator('.provider-model-root-panel').isVisible(), true);
  assert.equal(await narrow.page.locator('.provider-model-submenu-v2').count(), 0);
  await narrowModelMenu.locator('.provider-model-root-panel > button', { hasText: '模型' }).click();
  assert.equal(await narrowModelMenu.locator('.provider-model-list-panel').isVisible(), true);
  assert.equal(await narrowModelMenu.locator('.provider-model-root-panel').isVisible(), false);
  await narrowModelMenu.getByRole('button', { name: '返回' }).click();
  assert.equal(await narrowModelMenu.locator('.provider-model-root-panel').isVisible(), true);
  await narrow.page.keyboard.press('Escape');
  assert.equal(await narrow.page.getByRole('button', { name: /Hermes Profile 模型/ }).getAttribute('aria-expanded'), 'false');
  await narrow.context.close();

  console.log('Restrained composer and Chat / Work menu checks passed.');
} finally {
  await browser.close();
}

process.exit(0);
