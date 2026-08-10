import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startTestApp(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-model-catalog-'));
  const home = path.join(parent, '.frakio-work');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    models: [{
      id: 'mixed-relay',
      name: 'Mixed relay',
      provider: 'Custom',
      providerKey: 'custom:mixed',
      kind: 'local',
      protocol: 'OpenAI Compatible',
      apiMode: 'chat_completions',
      baseUrl: 'http://127.0.0.1:19191/v1',
      model: 'chat-model',
      models: ['chat-model', 'responses-model', 'claude-model'],
      modelApiModes: {
        'chat-model': 'chat_completions',
        'responses-model': 'openai_responses',
        'claude-model': 'anthropic_messages',
      },
      capabilityMode: 'manual',
      capabilityOverrides: {
        'chat-model': { status: 'unsupported', reasoning: false },
        'responses-model': { status: 'confirmed', reasoningMap: { low: 'low', high: 'high' } },
        'claude-model': { status: 'confirmed', reasoningMap: { medium: 'medium', high: 'high' } },
      },
    }],
    agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  }, null, 2)}\n`);
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = path.join(parent, '.hermes');
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?runtime-model-catalog=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  t.after(() => rm(parent, { recursive: true, force: true }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function runtimeCatalog(baseUrl, runtimeId) {
  const response = await fetch(`${baseUrl}/api/runtimes/${runtimeId}/models`);
  assert.equal(response.status, 200);
  return response.json();
}

test('runtime model catalogs expose exact compatibility for every model protocol', async (t) => {
  const baseUrl = await startTestApp(t);
  const [pi, hermes, codex, claude] = await Promise.all([
    runtimeCatalog(baseUrl, 'pi'),
    runtimeCatalog(baseUrl, 'hermes'),
    runtimeCatalog(baseUrl, 'codex'),
    runtimeCatalog(baseUrl, 'claude'),
  ]);

  const piModels = pi.models[0].modelCompatibilities;
  assert.equal(piModels['chat-model'].compatibility, 'direct');
  assert.equal(piModels['responses-model'].compatibility, 'direct');
  assert.equal(piModels['responses-model'].upstreamApiMode, 'codex_responses');
  assert.equal(piModels['claude-model'].compatibility, 'direct');

  const hermesModels = hermes.models[0].modelCompatibilities;
  assert.equal(hermesModels['responses-model'].compatibility, 'direct');
  assert.equal(hermesModels['responses-model'].harnessApiMode, 'codex_responses');
  assert.equal(hermesModels['chat-model'].capabilities.reasoning, 'unsupported');

  const codexModels = codex.models[0].modelCompatibilities;
  assert.equal(codexModels['chat-model'].compatibility, 'bridged');
  assert.equal(codexModels['chat-model'].bridgeId, 'responses-chat-v2');
  assert.equal(codexModels['responses-model'].compatibility, 'direct');
  assert.equal(codexModels['claude-model'].compatibility, 'bridged');
  assert.equal(codexModels['claude-model'].bridgeId, 'responses-anthropic-v1');

  const claudeModels = claude.models[0].modelCompatibilities;
  assert.equal(claudeModels['chat-model'].compatibility, 'bridged');
  assert.equal(claudeModels['responses-model'].compatibility, 'bridged');
  assert.equal(claudeModels['claude-model'].compatibility, 'direct');
});
