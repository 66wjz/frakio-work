import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server.address().port;
}

test('automatic detection confirms and returns the v1 runtime root', async (t) => {
  const requests = [];
  const providerServer = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    const body = JSON.parse(rawBody || '{}');
    requests.push({ method: req.method, url: req.url, body });
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'chat-thinking' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/responses') {
      const effort = body.reasoning?.effort;
      const accepted = !effort || ['low', 'medium', 'high'].includes(effort) || body.service_tier === 'priority';
      res.writeHead(accepted ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(accepted ? { id: 'response' } : { error: { message: `unsupported ${effort}` } }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions' && body.model === 'chat-thinking') {
      const hasOpenRouterReasoning = body.reasoning && typeof body.reasoning === 'object';
      const rejectsParameter = 'reasoning_effort' in body || 'service_tier' in body;
      const accepted = !rejectsParameter && (!('thinking' in body) && !('enable_thinking' in body) && !('chat_template_kwargs' in body));
      res.writeHead(accepted ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(accepted ? { choices: [{ message: { content: hasOpenRouterReasoning ? 'thinking' : 'ok' } }] } : { error: { message: 'unknown parameter' } }));
      return;
    }
    res.writeHead(req.url === '/responses' ? 403 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: req.url === '/responses' ? 'missing v1' : 'not found' } }));
  });
  const providerPort = await listen(providerServer);
  t.after(() => providerServer.close());

  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-provider-detect-'));
  const home = path.join(parent, '.frakio-work');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    models: [{
      id: 'legacy-responses',
      name: 'Legacy Responses',
      provider: 'Custom',
      providerKey: 'custom:legacy',
      kind: 'relay',
      protocol: 'OpenAI Compatible',
      apiMode: 'codex_responses',
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      model: 'gpt-test',
      models: ['gpt-test'],
      capabilityMode: 'auto',
      capabilityOverrides: {},
    }],
    agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  })}\n`);
  t.after(() => rm(parent, { recursive: true, force: true }).catch(() => {}));

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?provider-detection-api=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const apiServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => apiServer.once('listening', resolve));
  t.after(() => apiServer.close());
  const baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-frakio-request': '1' };
  const modelsResponse = await fetch(`${baseUrl}/api/models`, { headers: { cookie } });
  const legacyModel = (await modelsResponse.json()).models.find((item) => item.id === 'legacy-responses');
  assert.equal(legacyModel.apiModePreference, 'openai_responses');
  assert.ok(legacyModel.runtimeRevision);

  const response = await fetch(`${baseUrl}/api/model-providers/detect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Relay',
      provider: 'Custom',
      baseUrl: `http://127.0.0.1:${providerPort}`,
      apiKey: 'test-key',
      apiModePreference: 'auto',
      stream: true,
      model: 'gpt-test',
      models: [],
      capabilityMode: 'auto',
      capabilityOverrides: {},
    }),
  });
  assert.equal(response.status, 200);
  const streamEvents = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  const detected = streamEvents.find((event) => event.type === 'result')?.data;
  const stages = streamEvents.filter((event) => event.type === 'stage').map((event) => event.stage);
  assert.equal(stages[0], '正在获取模型');
  assert.ok(stages.includes('正在验证连接'));
  assert.ok(stages.some((stage) => stage.startsWith('正在识别 API 协议')));
  assert.ok(stages.includes('正在探测推理档位'));
  assert.ok(stages.includes('正在检测快速模式'));
  assert.equal(detected.baseUrl, `http://127.0.0.1:${providerPort}/v1`);
  assert.equal(detected.apiModePreference, 'auto');
  assert.equal(detected.apiMode, 'codex_responses');
  assert.equal(detected.autoCompletedV1, true);
  assert.equal(detected.model, 'gpt-test');
  assert.equal(detected.diagnostic.path, '/v1/responses');
  assert.deepEqual(requests.slice(0, 3).map((item) => `${item.method} ${item.url}`), [
    'GET /v1/models',
    'POST /responses',
    'POST /v1/responses',
  ]);

  requests.length = 0;
  const manual = await fetch(`${baseUrl}/api/model-providers/detect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Relay',
      provider: 'Custom',
      baseUrl: `http://127.0.0.1:${providerPort}`,
      apiKey: 'test-key',
      apiModePreference: 'chat_completions',
      model: 'gpt-test',
      models: ['gpt-test'],
      capabilityMode: 'auto',
      capabilityOverrides: {},
    }),
  });
  assert.notEqual(manual.status, 200);
  const attemptedPosts = requests.filter((item) => item.method === 'POST').map((item) => item.url);
  assert.deepEqual(attemptedPosts, ['/chat/completions', '/v1/chat/completions']);
  assert.equal(attemptedPosts.some((url) => url.includes('responses')), false);

  requests.length = 0;
  const chatResponse = await fetch(`${baseUrl}/api/model-providers/detect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Chat relay',
      provider: 'Custom',
      baseUrl: `http://127.0.0.1:${providerPort}`,
      apiKey: 'test-key',
      apiModePreference: 'chat_completions',
      model: 'chat-thinking',
      models: ['chat-thinking'],
      capabilityMode: 'auto',
      capabilityOverrides: {},
    }),
  });
  assert.equal(chatResponse.status, 200);
  const chatDetected = await chatResponse.json();
  assert.equal(chatDetected.apiMode, 'chat_completions');
  assert.equal(chatDetected.baseUrl, `http://127.0.0.1:${providerPort}/v1`);
  assert.equal(chatDetected.capability.thinkingFormat, 'openrouter');
  assert.equal(chatDetected.capability.confidence, 'inferred');
  assert.deepEqual(chatDetected.capability.reasoningEfforts, ['off', 'high']);
});
