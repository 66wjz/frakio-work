import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1144, height: 768 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'frakioDesktop', {
      configurable: true,
      value: { platform: 'darwin', isElectron: true },
    });
  });
  const page = await context.newPage();
  const expected = '先确认当前状态。工具调用完成后，继续补充 Markdown 结论，以及一段突发到达但仍需柔和呈现的正文。';

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${baseUrl}/?stream-reveal-qa=1&appearance=dark&startDelay=320&handoffDelay=900`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="run-status"]').waitFor();
  const initialSlot = page.locator('[data-testid="run-reply-transition-slot"]');
  await initialSlot.waitFor();
  await page.waitForTimeout(210);
  const initialSlotBox = await initialSlot.boundingBox();
  assert.ok(initialSlotBox, 'the initial presence must reserve a reply slot');
  await page.waitForTimeout(105);
  assert.equal(await page.locator('[data-testid="run-status"] .markdown-message').count(), 0, 'the raw first delta must not hide presence before it is visible');
  assert.equal(await page.locator('[data-testid="run-presence"]').count(), 1, 'presence must remain visible during the reveal buffer');
  const samples = [];
  let sawAnimatedTail = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 330) {
    const parts = await page.locator('[data-testid="stream-output"] .markdown-message').allInnerTexts();
    const visible = parts.join('').replace(/\s+/g, ' ').trim();
    if (visible) {
      const plainVisible = visible.replace(/\*\*/g, '');
      assert.equal(expected.startsWith(plainVisible), true, `streamed text must remain a prefix: ${visible}`);
      assert.equal(samples.length === 0 || plainVisible.length >= samples.at(-1).length, true, 'streamed text must only grow');
      samples.push(plainVisible);
    }
    if (await page.locator('.run-activity-summary').count()) {
      assert.equal(visible.startsWith('先确认当前状态。'), true, 'tool summary must wait for the preceding text');
    }
    const animated = await page.locator('.stream-reveal-tail').evaluateAll((nodes) => nodes.some((node) => node.getAnimations().length > 0));
    sawAnimatedTail ||= animated;
    if (await initialSlot.count()) {
      const slotBox = await initialSlot.boundingBox();
      assert.ok(slotBox, 'the reply transition slot must stay mounted while the first body appears');
      assert.ok(Math.abs(slotBox.y - initialSlotBox.y) <= 1, 'the first visible body must keep the thinking row baseline');
    }
    if (!await page.locator('[data-testid="persisted-message"]').count()) {
      assert.equal(await page.locator('[data-testid="run-status"]').count(), 1, 'the live reply must remain mounted until persistent handoff');
    }
    assert.equal(await page.locator('textarea[aria-label="QA 输入框"]').count(), 1);
    await page.waitForTimeout(16);
  }
  assert.equal(samples.length > 2, true);
  assert.equal(sawAnimatedTail, true);

  const summary = page.locator('.run-activity-summary');
  await summary.waitFor();
  const resting = await summary.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, shadow: style.boxShadow };
  });
  assert.match(resting.background, /rgba?\([^)]*,\s*0\)$/);
  assert.equal(resting.shadow, 'none');
  await summary.hover();
  const hovered = await summary.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, shadow: style.boxShadow };
  });
  assert.doesNotMatch(hovered.background, /rgba?\([^)]*,\s*0\)$/);
  assert.notEqual(hovered.shadow, 'none');
  await summary.click();
  assert.equal(await summary.getAttribute('aria-expanded'), 'true');

  await page.locator('[data-testid="persisted-message"]').waitFor();
  assert.equal(await page.locator('[data-testid="stream-output"] > .message').count(), 1);
  assert.equal(await page.locator('[data-testid="run-status"]').count(), 0, 'the terminal handoff must not leave an empty live Agent node');
  assert.equal((await page.locator('[data-testid="persisted-message"] .markdown-message').innerText()).replace(/\s+/g, ' ').trim(), expected);
  assert.equal(await page.locator('[data-testid="run-status"]').count(), 0);

  await page.goto(`${baseUrl}/?stream-reveal-qa=1&streaming=off`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="run-status"]').waitFor();
  await page.waitForTimeout(220);
  assert.equal(await page.locator('[data-testid="run-status"] .markdown-message').count(), 0);
  assert.equal(await page.locator('[data-testid="run-status"] .processing-presence').count(), 1);
  await page.locator('[data-testid="persisted-message"]').waitFor();
  assert.equal((await page.locator('[data-testid="persisted-message"] .markdown-message').innerText()).replace(/\s+/g, ' ').trim(), expected);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/?stream-reveal-qa=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(160);
  assert.equal(await page.locator('[data-testid="run-status"] .markdown-message').count(), 1);
  assert.equal(await page.locator('.stream-reveal-tail').count(), 0);
  await context.close();
  console.log('macOS desktop stream reveal QA passed.');
} finally {
  await browser.close();
}
