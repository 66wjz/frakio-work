import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

test('combination model API is removed without rewriting existing profile moa config', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-moa-removal-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const profilePath = path.join(hermesHome, 'config.yaml');
  const profileConfig = [
    'auxiliary:',
    '  compression:',
    '    provider: auto',
    'moa:',
    '  default_preset: legacy',
    '  presets:',
    '    legacy:',
    '      enabled: true',
    '',
  ].join('\n');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  await writeFile(profilePath, profileConfig);

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?moa-removal=${Date.now()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const writeHeaders = {
    cookie,
    'content-type': 'application/json',
    'x-frakio-request': '1',
  };

  const auxiliaryResponse = await fetch(`${baseUrl}/api/hermes/config/auxiliary-models`);
  assert.equal(auxiliaryResponse.status, 200);
  assert.equal((await auxiliaryResponse.json()).auxiliary.compression.provider, 'auto');

  const readResponse = await fetch(`${baseUrl}/api/hermes/config/moa`);
  assert.equal(readResponse.status, 404);

  const writeResponse = await fetch(`${baseUrl}/api/hermes/config/moa`, {
    method: 'PUT',
    headers: writeHeaders,
    body: JSON.stringify({ moa: {} }),
  });
  assert.equal(writeResponse.status, 404);
  const persisted = YAML.parse(await readFile(profilePath, 'utf8'));
  const original = YAML.parse(profileConfig);
  assert.deepEqual(persisted.moa, original.moa);
  assert.deepEqual(persisted.auxiliary, original.auxiliary);
  assert.equal(persisted.approvals.mode, 'smart');
});
