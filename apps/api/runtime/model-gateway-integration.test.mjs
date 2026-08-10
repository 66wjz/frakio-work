import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClaudeAgentSdkBridge } from './claude-agent-sdk.mjs';
import { createCodexAppServerBridge } from './codex-app-server.mjs';
import { createRuntimeModelGateway } from './model-gateway.mjs';

const codexFixture = fileURLToPath(new URL('./fixtures/fake-codex-gateway-app-server.mjs', import.meta.url));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function upstreamServer(records) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    records.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    const isAnthropic = req.url === '/messages';
    const isChat = req.url === '/chat/completions';
    if (isAnthropic) {
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg-upstream', usage: {} } })}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'gateway-ok' } })}\n\n`);
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })}\n\n`);
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    } else if (isChat) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'gateway-ok' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
    } else {
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'gateway-ok' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { output_tokens: 1 } } })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    res.end();
  });
  const address = await listen(server);
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function gatewayServer(gateway) {
  const server = http.createServer(async (req, rawRes) => {
    const parts = new URL(req.url, 'http://127.0.0.1').pathname.split('/').filter(Boolean);
    const tokenIndex = parts.indexOf('runtime-model-gateway');
    const token = parts[tokenIndex + 1] || '';
    const operation = parts.at(-1) || '';
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = Object.assign(req, { params: { token, operation }, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
    const response = Object.assign(rawRes, {
      status(code) { rawRes.statusCode = code; return response; },
      json(payload) { rawRes.setHeader('content-type', 'application/json'); rawRes.end(JSON.stringify(payload)); return response; },
    });
    await gateway.handle(request, response);
  });
  const address = await listen(server);
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function launch(gateway, upstreamUrl, route) {
  const realm = { revision: `${route.runtimeId}-${route.routeRevision}`, runtimeBuildId: `${route.runtimeId}-build` };
  const issued = gateway.issue({ executionRealm: realm, route: { ...route, targetUrl: `${upstreamUrl}${route.targetPath}` }, credential: 'provider-secret' });
  return { realm, issued };
}

async function runCodex({ gateway, upstreamUrl, route, root }) {
  const { realm, issued } = launch(gateway, upstreamUrl, route);
  const bridge = createCodexAppServerBridge({
    runtimeHomeRoot: path.join(root, 'codex-home'),
    commandArgsFactory: (launchSpec) => [codexFixture, '-c', `model=${JSON.stringify(launchSpec.modelId)}`, '-c', `model_providers.frakio.base_url=${JSON.stringify(launchSpec.baseUrl)}`],
  });
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Codex integration run timed out.')), 5000);
    bridge.on('event', ({ runId, event }) => {
      if (runId !== 'codex-integration-run') return;
      if (event.type === 'run.completed' || event.type === 'run.failed') { clearTimeout(timer); resolve(event); }
    });
  });
  await bridge.startRun({ runId: 'codex-integration-run', sessionId: 'codex-integration-session', cwd: root, model: route.modelId, effort: 'high', permissionMode: 'off', profileSnapshot: { name: 'Victor', role: 'Engineer' }, contextPacket: {}, prompt: 'test', runtimeBinding: { executablePath: process.execPath }, executionRealm: realm, launchSpec: issued });
  const event = await completed;
  await bridge.close();
  return event;
}

async function runClaude({ gateway, route, root }) {
  const { realm, issued } = launch(gateway, route.targetUrlRoot, route);
  let responseStatus = 0;
  const queryFactory = ({ options }) => {
    const stream = (async function* () {
      const response = await fetch(`${options.env.ANTHROPIC_BASE_URL}/messages`, { method: 'POST', headers: { 'x-api-key': options.env.ANTHROPIC_AUTH_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ model: options.model, max_tokens: 64, messages: [{ role: 'user', content: 'test' }], stream: true }) });
      responseStatus = response.status;
      const body = await response.text();
      assert.equal(response.ok, true, body);
      assert.match(body, /gateway-ok/);
      yield { type: 'system', subtype: 'init', session_id: 'claude-integration-session' };
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'gateway-ok' } } };
      yield { type: 'result', subtype: 'success', result: 'gateway-ok', is_error: false };
    })();
    stream.interrupt = async () => {};
    stream.close = () => {};
    return stream;
  };
  const bridge = createClaudeAgentSdkBridge({ runtimeHomeRoot: path.join(root, 'claude-home'), queryFactory });
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Claude integration run timed out.')), 5000);
    bridge.on('event', ({ runId, event }) => { if (runId === 'claude-integration-run' && (event.type === 'run.completed' || event.type === 'run.failed')) { clearTimeout(timer); resolve(event); } });
  });
  await bridge.startRun({ runId: 'claude-integration-run', sessionId: 'claude-integration-session', cwd: root, model: route.modelId, permissionMode: 'off', profileSnapshot: { name: 'Max', role: 'Engineer' }, contextPacket: {}, prompt: 'test', runtimeBinding: { executablePath: process.execPath }, executionRealm: realm, launchSpec: issued });
  const event = await completed;
  await bridge.close();
  assert.equal(responseStatus, 200);
  return event;
}

test('Codex and Claude Harnesses use the same Model Center Gateway for bridged and direct routes', async (t) => {
  const records = [];
  const upstream = await upstreamServer(records);
  let gatewayOrigin = '';
  const gateway = createRuntimeModelGateway({ origin: () => gatewayOrigin });
  const gatewayHttp = await gatewayServer(gateway);
  gatewayOrigin = gatewayHttp.origin;
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-gateway-integration-'));
  t.after(async () => { gateway.close(); await close(gatewayHttp.server); await close(upstream.server); });

  const codexBridged = await runCodex({ gateway, upstreamUrl: upstream.url, route: { runtimeId: 'codex', routeRevision: 'codex-chat', modelId: 'deepseek-v4-flash', targetPath: '/chat/completions', harnessApiMode: 'openai_responses', upstreamApiMode: 'chat_completions', apiMode: 'chat_completions', compatibility: 'bridged', authType: 'api_key' }, root });
  const codexDirect = await runCodex({ gateway, upstreamUrl: upstream.url, route: { runtimeId: 'codex', routeRevision: 'codex-responses', modelId: 'gpt-5.6-sol', targetPath: '/responses', harnessApiMode: 'openai_responses', upstreamApiMode: 'openai_responses', apiMode: 'openai_responses', compatibility: 'direct', authType: 'api_key' }, root });
  const claudeBridged = await runClaude({ gateway, route: { runtimeId: 'claude', routeRevision: 'claude-responses', modelId: 'gpt-5.6-sol', targetPath: '/responses', targetUrlRoot: upstream.url, harnessApiMode: 'anthropic_messages', upstreamApiMode: 'openai_responses', apiMode: 'openai_responses', compatibility: 'bridged', authType: 'api_key' }, root });
  const claudeDirect = await runClaude({ gateway, route: { runtimeId: 'claude', routeRevision: 'claude-anthropic', modelId: 'claude-sonnet', targetPath: '/messages', targetUrlRoot: upstream.url, harnessApiMode: 'anthropic_messages', upstreamApiMode: 'anthropic_messages', apiMode: 'anthropic_messages', compatibility: 'direct', authType: 'api_key' }, root });

  assert.equal(codexBridged.payload.output, 'gateway-ok');
  assert.equal(codexDirect.payload.output, 'gateway-ok');
  assert.equal(claudeBridged.payload.output, 'gateway-ok');
  assert.equal(claudeDirect.payload.output, 'gateway-ok');
  assert.deepEqual(records.map((item) => item.body.model), ['deepseek-v4-flash', 'gpt-5.6-sol', 'gpt-5.6-sol', 'claude-sonnet']);
  assert.deepEqual(records.slice(0, 3).map((item) => item.headers.authorization), ['Bearer provider-secret', 'Bearer provider-secret', 'Bearer provider-secret']);
  assert.equal(records[3].headers['x-api-key'], 'provider-secret');
});
