import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

test('legacy Iris auxiliary models migrate once into one global configuration and project to every Profile', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-global-auxiliary-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(path.join(home, 'data'), { recursive: true });
  for (const profile of ['iris', 'max', 'kai', 'victor']) {
    const profileDir = path.join(hermesHome, 'profiles', profile);
    await mkdir(profileDir, { recursive: true });
    const auxiliary = profile === 'iris'
      ? { vision: { provider: 'local', model: 'vision-model', timeout: 120, download_timeout: 30 }, title_generation: { provider: 'local', model: 'title-model', timeout: 30 } }
      : {};
    await writeFile(path.join(profileDir, 'config.yaml'), YAML.stringify({ providers: {}, auxiliary }), 'utf8');
    await writeFile(path.join(profileDir, 'profile.yaml'), YAML.stringify({ name: profile }), 'utf8');
  }
  await writeFile(path.join(home, 'data', 'workbench-state.json'), JSON.stringify({
    version: 8,
    ui: { defaultAgentId: 'iris' },
    agents: ['iris', 'max', 'kai', 'victor'].map((id) => ({ id, name: id === 'iris' ? 'Iris' : id, role: 'test', profileName: id })),
    models: [{ id: 'local-models', name: 'Local', provider: 'Local', providerKey: 'local', kind: 'local', protocol: 'OpenAI Compatible', apiMode: 'chat_completions', baseUrl: 'http://127.0.0.1:11434/v1', model: 'vision-model', models: ['vision-model', 'title-model'] }],
    spaces: [], workspaces: [], vaults: [], threads: [],
  }));

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?global-auxiliary=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const headers = { cookie: session.headers.get('set-cookie')?.split(';')[0] || '', 'content-type': 'application/json', 'x-frakio-request': '1' };

  const global = await fetch(`${baseUrl}/api/auxiliary-models`).then((response) => response.json());
  assert.equal(global.auxiliary.vision.model, 'vision-model');
  assert.equal(global.auxiliary.title_generation.model, 'title-model');
  const legacyAlias = await fetch(`${baseUrl}/api/hermes/config/auxiliary-models?profile=max`).then((response) => response.json());
  assert.deepEqual(legacyAlias.auxiliary, global.auxiliary);

  for (const profile of ['iris', 'max', 'kai', 'victor']) {
    const config = YAML.parse(await readFile(path.join(hermesHome, 'profiles', profile, 'config.yaml'), 'utf8'));
    assert.equal(config.auxiliary.vision.model, 'vision-model');
    assert.equal(config.auxiliary.title_generation.model, 'title-model');
  }

  const updated = await fetch(`${baseUrl}/api/auxiliary-models`, {
    method: 'PUT', headers,
    body: JSON.stringify({ auxiliary: { compression: { provider: 'auto', timeout: 99 } } }),
  }).then((response) => response.json());
  assert.equal(updated.auxiliary.compression.timeout, 99);
  for (const profile of ['iris', 'max', 'kai', 'victor']) {
    const config = YAML.parse(await readFile(path.join(hermesHome, 'profiles', profile, 'config.yaml'), 'utf8'));
    assert.equal(config.auxiliary.compression.timeout, 99);
    assert.equal(config.auxiliary.vision.model, 'vision-model');
  }
});
