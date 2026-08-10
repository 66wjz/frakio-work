import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.FRAKIO_E2E_API_URL || 'http://127.0.0.1:8787';

async function proxyLocalApi(page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
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

async function createPage(browser, viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript(() => window.localStorage.setItem('frakio-work.firstUseGuideCompleted', '1'));
  const page = await context.newPage();
  await proxyLocalApi(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '我们接下来做点什么？', exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  return { context, page };
}

async function enablePlan(page) {
  await page.getByRole('button', { name: '添加内容' }).click();
  const planOption = page.getByRole('menuitem', { name: /计划模式/ });
  await planOption.waitFor({ state: 'visible' });
  await planOption.click();
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await createPage(browser, { width: 1440, height: 900 });
  const { page } = desktop;
  assert.equal(await page.locator('.plan-mode-indicator').count(), 0, 'Plan indicator must be absent by default.');
  await enablePlan(page);
  const indicator = page.locator('.plan-mode-indicator');
  await indicator.waitFor({ state: 'visible' });
  assert.match(await indicator.textContent(), /计划/);
  assert.equal(await page.locator('.composer-collaboration-toggle').isDisabled(), true);

  await page.getByRole('button', { name: '关闭计划模式' }).focus();
  await page.keyboard.press('Enter');
  await indicator.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.composer-collaboration-toggle').isDisabled(), false);

  await page.getByRole('button', { name: '添加内容' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: /计划模式/ }).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '添加内容' }).getAttribute('aria-expanded'), 'false');
  await desktop.context.close();

  const narrow = await createPage(browser, { width: 520, height: 760 }, 'reduce');
  await enablePlan(narrow.page);
  const metrics = await narrow.page.locator('.new-chat-composer').evaluate((composer) => {
    const indicatorElement = composer.querySelector('.plan-mode-indicator');
    return {
      overflow: composer.scrollWidth > composer.clientWidth,
      transitionDuration: indicatorElement ? getComputedStyle(indicatorElement).transitionDuration : '',
    };
  });
  assert.equal(metrics.overflow, false);
  assert.equal(metrics.transitionDuration, '0s');
  await narrow.context.close();

  console.log('Plan mode composer checks passed.');
} finally {
  await browser.close();
}

process.exit(0);
