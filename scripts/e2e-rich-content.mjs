import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

function minimalPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length + 35} >>\nstream\nBT /F1 20 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const root = process.cwd();
const qaRoot = await mkdtemp(path.join(os.tmpdir(), 'frakio-rich-content-qa-'));
const home = path.join(qaRoot, 'home');
await mkdir(home, { recursive: true });
await Promise.all([
  writeFile(path.join(qaRoot, 'one.html'), '<!doctype html><style>body{font:16px system-ui;padding:24px;color:#173c35}</style><h1>HTML 报告一</h1><p>严格 sandbox 预览。</p>'),
  writeFile(path.join(qaRoot, 'two.html'), '<!doctype html><style>body{font:16px system-ui;padding:24px;color:#3f4f8f}</style><h1>HTML 报告二</h1>'),
  writeFile(path.join(qaRoot, 'one.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="100%" height="100%" fill="#dcefe8"/><text x="50%" y="50%" text-anchor="middle" font-size="34">Frakio Image One</text></svg>'),
  writeFile(path.join(qaRoot, 'two.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="100%" height="100%" fill="#e4e5fb"/><text x="50%" y="50%" text-anchor="middle" font-size="34">Frakio Image Two</text></svg>'),
  writeFile(path.join(qaRoot, 'one.md'), '# Markdown 文档一\n\n- 嵌套表格\n\n| A | B |\n|---|---|\n| 1 | 2 |'),
  writeFile(path.join(qaRoot, 'two.md'), '# Markdown 文档二\n\n```mermaid\ngraph LR\nA["嵌套"] --> B["图表"]\n```'),
  writeFile(path.join(qaRoot, 'sample.pdf'), minimalPdf('Frakio PDF Preview')),
]);

const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, FRAKIO_WORK_HOME: home, FRAKIO_WORK_DISABLE_AUTOSTART: '1', FRAKIO_WORK_DESKTOP: '1' } });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1144, 768));
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:8787/?rich-content-qa=1&qaRoot=${encodeURIComponent(qaRoot)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.rich-qa-page').waitFor({ state: 'visible' });
  await page.locator('.rich-mermaid-canvas svg').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.rich-shiki').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.rich-pdf-frame canvas').waitFor({ state: 'visible', timeout: 15000 });

  assert.equal(await page.locator('strong', { hasText: '今天（7/26）' }).count(), 1);
  assert.equal((await page.locator('.rich-qa-page').innerText()).includes('**今天（7/26）**'), false);
  assert.equal(await page.locator('.rich-data-frame').count(), 2);
  assert.equal(await page.locator('.rich-html-frame iframe').getAttribute('sandbox'), '');
  assert.equal(await page.locator('.rich-preview-tabs').count() >= 3, true);
  assert.equal(await page.locator('.mac-desktop-shell .markdown-message').first().evaluate((node) => getComputedStyle(node).fontSize), '14px');
  assert.equal(await page.locator('.markdown-message h1').first().evaluate((node) => getComputedStyle(node).fontSize), '16px');

  const tableScroll = await page.locator('.markdown-table-scroll').first().evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, tableDisplay: getComputedStyle(node.querySelector('table')).display }));
  assert.equal(tableScroll.tableDisplay, 'table');
  assert.equal(tableScroll.scrollWidth >= tableScroll.clientWidth, true);

  await page.locator('.rich-mermaid-frame [aria-label="全屏查看"]').click();
  await page.locator('.rich-fullscreen').waitFor({ state: 'visible' });
  await page.locator('.rich-fullscreen [aria-label="放大"]').click();
  await page.keyboard.press('Escape');

  const datatable = page.locator('.rich-data-frame').first();
  await datatable.locator('input[placeholder="搜索数据"]').fill('广州');
  assert.equal(await datatable.locator('tbody tr:not(.rich-group-row)').count(), 1);
  await datatable.locator('select').selectOption('0');
  assert.equal(await datatable.locator('.rich-group-row').count(), 1);

  await page.locator('.rich-image-frame [role="tab"]').nth(1).click();
  await page.locator('.rich-markdown-preview [role="tab"]').nth(1).click();
  await page.locator('.rich-markdown-preview .rich-mermaid-canvas svg').waitFor({ state: 'visible', timeout: 10000 });

  await page.locator('.rich-qa-shell').evaluate((node) => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(root, 'artifacts/rich-content-electron-viewport-1144.png') });
  await page.locator('.rich-mermaid-frame').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, 'artifacts/rich-content-electron-mermaid-1144.png') });
  await page.screenshot({ path: path.join(root, 'artifacts/rich-content-electron-final-1144.png'), fullPage: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(720, 768));
  await page.locator('.rich-qa-shell').evaluate((node) => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(root, 'artifacts/rich-content-electron-viewport-narrow.png') });
  await page.screenshot({ path: path.join(root, 'artifacts/rich-content-electron-final-narrow.png'), fullPage: true });
  assert.equal(await page.locator('.rich-qa-page').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  assert.deepEqual(errors.filter((message) => !/DevTools|favicon/i.test(message)), []);
  console.log(`Electron rich-content QA passed. fixture=${qaRoot}`);
} finally {
  await app.close();
}
