import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('rich preview API streams allowed files and blocks other paths', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-rich-preview-api-'));
  const home = path.join(parent, '.frakio-work');
  const data = path.join(home, 'data');
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'preview.md'), '# Preview');
  const outside = '/etc/hosts';

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?rich-preview-api=${Date.now()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const allowed = await fetch(`${baseUrl}/api/rich-preview?path=${encodeURIComponent(path.join(data, 'preview.md'))}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(await allowed.text(), '# Preview');

  const blocked = await fetch(`${baseUrl}/api/rich-preview?path=${encodeURIComponent(outside)}`);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'RICH_PREVIEW_FORBIDDEN');
});
