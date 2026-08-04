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
    if (request.method() === 'GET' && url.pathname === '/api/model-capabilities') {
      const response = await fetch(`${apiUrl}${url.pathname}${url.search}`, { headers: { ...request.headers(), host: new URL(apiUrl).host } });
      const payload = await response.json();
      const capabilities = Object.fromEntries(Object.entries(payload.capabilities || {}).map(([key, capability]) => [key, {
        ...capability,
        reasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
        reasoningStatus: 'confirmed',
        serviceTiers: [{ id: 'priority', name: '快速', requestValue: 'priority' }],
        serviceTierStatus: 'confirmed',
      }]));
      return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify({ ...payload, capabilities }) });
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

  async function inspectAdvancedModelSurface(side, extraStyle = '') {
    const session = await createWorkbenchPage(browser, { viewport: { width: 1440, height: 900 } });
    const threadButtons = session.page.locator('.rail-thread-main');
    assert.ok(await threadButtons.count() > 0, 'Advanced model surface regression needs an existing thread.');
    await threadButtons.first().click();
    if (extraStyle) await session.page.addStyleTag({ content: extraStyle });
    const trigger = session.page.locator('.provider-model-trigger').first();
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();
    const menu = session.page.locator('.provider-model-menu.advanced:visible');
    await menu.waitFor({ state: 'visible' });
    await menu.locator('.provider-model-root-panel > button', { hasText: '模型' }).click();
    const root = menu.locator('.provider-model-root-panel:visible');
    const subpanel = menu.locator('.provider-model-subpanel:visible');
    await root.waitFor({ state: 'visible' });
    await subpanel.waitFor({ state: 'visible' });
    const surface = await menu.evaluate((element) => {
      const menuStyle = getComputedStyle(element);
      return {
        menuWidth: element.getBoundingClientRect().width,
        menuBackground: menuStyle.backgroundColor,
        menuBorder: menuStyle.borderTopWidth,
        menuShadow: menuStyle.boxShadow,
        menuFilter: menuStyle.backdropFilter,
      };
    });
    const rootSurface = await root.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: element.getBoundingClientRect().width, background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, filter: style.backdropFilter };
    });
    const subpanelSurface = await subpanel.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, filter: style.backdropFilter };
    });
    assert.equal(await menu.evaluate((element, targetSide) => element.classList.contains(`submenu-${targetSide}`), side), true, `The submenu should open to the ${side}.`);
    assert.equal(surface.menuWidth, rootSurface.width, JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.equal(surface.menuBackground, 'rgba(0, 0, 0, 0)', JSON.stringify(surface));
    assert.equal(surface.menuBorder, '0px', JSON.stringify(surface));
    assert.equal(surface.menuShadow, 'none', JSON.stringify(surface));
    assert.equal(surface.menuFilter, 'none', JSON.stringify(surface));
    assert.equal(rootSurface.background, subpanelSurface.background, JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.notEqual(rootSurface.background, 'rgba(0, 0, 0, 0)', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.equal(rootSurface.border, '0px', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.equal(subpanelSurface.border, '0px', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.notEqual(rootSurface.shadow, 'none', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.notEqual(subpanelSurface.shadow, 'none', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.equal(rootSurface.filter, 'none', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    assert.equal(subpanelSurface.filter, 'none', JSON.stringify({ surface, rootSurface, subpanelSurface }));
    await session.context.close();
  }

  await inspectAdvancedModelSurface('left');
  await inspectAdvancedModelSurface('right', '.composer { margin-right: 500px !important; }');

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
  const narrowThreadButtons = narrow.page.locator('.rail-thread-main');
  assert.ok(await narrowThreadButtons.count() > 0, 'Provider model picker regression needs an existing thread.');
  await narrowThreadButtons.first().click();
  const providerPatchRequests = [];
  narrow.page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/api\/threads\/[^/]+$/.test(new URL(request.url()).pathname)) providerPatchRequests.push(request);
  });
  const narrowModelTrigger = narrow.page.locator('.provider-model-trigger').first();
  await narrowModelTrigger.waitFor({ state: 'visible', timeout: 60000 });
  await narrowModelTrigger.click();
  const narrowModelMenu = narrow.page.locator('.provider-model-menu.advanced');
  await narrowModelMenu.waitFor({ state: 'visible' });
  assert.equal(await narrowModelMenu.locator('.provider-model-root-panel').isVisible(), true);
  assert.equal(await narrow.page.locator('.provider-model-submenu-v2').count(), 0);

  async function chooseProviderOption(sectionLabel, optionPattern) {
    await narrowModelMenu.locator('.provider-model-root-panel > button', { hasText: sectionLabel }).click();
    const panel = narrowModelMenu.locator('.provider-model-subpanel').filter({ hasText: sectionLabel }).last();
    await panel.waitFor({ state: 'visible' });
    const options = panel.locator('.provider-setting-options > button');
    const option = options.filter({ hasText: optionPattern }).first();
    assert.equal(await option.count(), 1, `${sectionLabel} option is missing.`);
    const before = providerPatchRequests.length;
    const responsePromise = narrow.page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/api\/threads\/[^/]+$/.test(new URL(response.url()).pathname));
    await option.click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, `${sectionLabel} update failed: ${response.status()}`);
    assert.equal(providerPatchRequests.length > before, true, `${sectionLabel} did not send a thread PATCH.`);
    await narrowModelMenu.getByRole('button', { name: '返回' }).click();
  }

  await chooseProviderOption('推理强度', '中');
  await chooseProviderOption('速度', /标准|快速/);
  await narrowModelMenu.locator('.provider-model-root-panel > button', { hasText: '模型' }).click();
  assert.equal(await narrowModelMenu.locator('.provider-model-list-panel').isVisible(), true);
  const modelOptions = narrowModelMenu.locator('.provider-model-list-panel .provider-model-group button');
  assert.ok(await modelOptions.count() > 0, 'Model options are missing.');
  const modelResponsePromise = narrow.page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/api\/threads\/[^/]+$/.test(new URL(response.url()).pathname));
  await modelOptions.first().click();
  assert.equal((await modelResponsePromise).status(), 200, 'Model update failed.');
  assert.equal(await narrowModelMenu.locator('.provider-model-root-panel').isVisible(), false);
  await narrow.page.keyboard.press('Escape');
  assert.equal(await narrowModelTrigger.getAttribute('aria-expanded'), 'false');
  await narrow.context.close();

  console.log('Restrained composer and Chat / Work menu checks passed.');
} finally {
  await browser.close();
}

process.exit(0);
