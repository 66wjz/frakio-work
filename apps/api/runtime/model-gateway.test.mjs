import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Writable } from 'node:stream';
import { createRuntimeModelGateway } from './model-gateway.mjs';

function responseSink() {
  const chunks = [];
  const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  response.statusCode = 200;
  response.headers = {};
  response.status = (value) => { response.statusCode = value; return response; };
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; };
  response.json = (value) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); return response; };
  response.body = () => Buffer.concat(chunks).toString('utf8');
  return response;
}

test('Runtime Model Gateway reports the missing launch-plan field', () => {
  const gateway = createRuntimeModelGateway({ origin: () => 'http://127.0.0.1:8787' });
  assert.throws(
    () => gateway.issue({ executionRealm: {}, route: { targetUrl: 'https://provider.test/v1/responses' }, credential: 'secret' }),
    (error) => error.code === 'RUNTIME_REALM_MISSING' && error.stage === 'materialize',
  );
  assert.throws(
    () => gateway.issue({ executionRealm: { revision: 'realm' }, route: {}, credential: 'secret' }),
    (error) => error.code === 'RUNTIME_TARGET_URL_MISSING' && error.stage === 'materialize',
  );
  assert.throws(
    () => gateway.issue({ executionRealm: { revision: 'realm' }, route: { targetUrl: 'https://provider.test/v1/responses' }, credential: '' }),
    (error) => error.code === 'RUNTIME_CREDENTIAL_MISSING' && error.stage === 'materialize',
  );
});

test('Runtime Model Gateway scopes credentials and model selection to one Realm token', async (t) => {
  let upstreamRequest = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamRequest = { authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const gateway = createRuntimeModelGateway({ origin: () => 'http://127.0.0.1:8787' });
  const executionRealm = { revision: 'realm-revision', runtimeBuildId: 'codex-build' };
  const route = {
    runtimeId: 'codex', routeRevision: 'route-revision', apiMode: 'codex_responses', modelId: 'frakio-model',
    targetUrl: `http://127.0.0.1:${port}/v1/responses`, authType: 'api_key',
  };
  const launch = gateway.issue({ executionRealm, route, credential: 'provider-secret' });
  assert.equal(launch.baseUrl.endsWith('/v1'), true);
  assert.equal(launch.baseUrl.includes('provider-secret'), false);
  const response = responseSink();
  const finished = new Promise((resolve) => response.once('finish', resolve));
  await gateway.handle({ params: { token: launch.token, operation: 'responses' }, headers: {}, body: { model: 'attempted-override', input: 'hello' } }, response);
  await finished;
  assert.equal(response.statusCode, 200);
  assert.equal(upstreamRequest.authorization, 'Bearer provider-secret');
  assert.equal(upstreamRequest.body.model, 'frakio-model');
  gateway.revokeRealm(executionRealm.revision);
  const rejected = responseSink();
  await gateway.handle({ params: { token: launch.token, operation: 'responses' }, headers: {}, body: {} }, rejected);
  assert.equal(rejected.statusCode, 401);
});

test('Runtime Model Gateway bridges Responses requests and Chat Completions streams', async (t) => {
  let upstreamBody = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const gateway = createRuntimeModelGateway({ origin: () => 'http://127.0.0.1:8787' });
  const executionRealm = { revision: 'bridge-realm', runtimeBuildId: 'codex-build' };
  const route = {
    runtimeId: 'codex', routeRevision: 'bridge-route', apiMode: 'chat_completions', upstreamApiMode: 'chat_completions', harnessApiMode: 'openai_responses',
    compatibility: 'bridged', bridgeId: 'responses-chat-v1', modelId: 'deepseek-test', targetUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, authType: 'api_key',
  };
  const launch = gateway.issue({ executionRealm, route, credential: 'provider-secret' });
  const response = responseSink();
  const finished = new Promise((resolve) => response.once('finish', resolve));
  await gateway.handle({ params: { token: launch.token, operation: 'responses' }, headers: {}, body: { model: 'override', input: 'hello', stream: true } }, response);
  await finished;
  assert.equal(upstreamBody.model, 'deepseek-test');
  assert.deepEqual(upstreamBody.messages, [{ role: 'user', content: 'hello' }]);
  assert.match(response.body(), /response\.output_text\.delta/);
  assert.match(response.body(), /你好/);
  assert.match(response.body(), /response\.completed/);
});

test('Responses to Chat bridge normalizes Codex developer messages for Chat providers', async (t) => {
  let upstreamBody = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const gateway = createRuntimeModelGateway({ origin: () => 'http://127.0.0.1:8787' });
  const route = {
    runtimeId: 'codex', routeRevision: 'developer-role-route', apiMode: 'chat_completions', upstreamApiMode: 'chat_completions', harnessApiMode: 'openai_responses',
    compatibility: 'bridged', bridgeId: 'responses-chat-v1', modelId: 'deepseek-test', targetUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, authType: 'api_key',
  };
  const launch = gateway.issue({ executionRealm: { revision: 'developer-role-realm' }, route, credential: 'provider-secret' });
  const response = responseSink();
  const finished = new Promise((resolve) => response.once('finish', resolve));
  await gateway.handle({
    params: { token: launch.token, operation: 'responses' },
    headers: {},
    body: {
      instructions: 'Host instruction',
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'Agent instruction' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
      ],
      tools: [
        { type: 'local_shell' },
        { type: 'function', name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
      ],
      stream: true,
    },
  }, response);
  await finished;
  assert.deepEqual(upstreamBody.messages, [
    { role: 'system', content: 'Host instruction' },
    { role: 'system', content: [{ type: 'text', text: 'Agent instruction' }] },
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  ]);
  assert.equal(upstreamBody.messages.some((message) => message.role === 'developer'), false);
  assert.deepEqual(upstreamBody.tools, [{
    type: 'function',
    function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
  }]);
  assert.match(response.body(), /response\.completed/);
});

test('Runtime Model Gateway bridges Claude Messages requests and Responses streams with tools', async (t) => {
  let upstreamBody = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read_file","arguments":""}}\n\n');
      res.write('event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"path\\":\\"a.txt\\"}"}\n\n');
      res.end('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}}}\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const gateway = createRuntimeModelGateway({ origin: () => 'http://127.0.0.1:8787' });
  const executionRealm = { revision: 'claude-bridge-realm', runtimeBuildId: 'claude-build' };
  const route = {
    runtimeId: 'claude', routeRevision: 'claude-bridge-route', apiMode: 'openai_responses', upstreamApiMode: 'openai_responses', harnessApiMode: 'anthropic_messages',
    compatibility: 'bridged', bridgeId: 'anthropic-responses-v1', modelId: 'gpt-test', targetUrl: `http://127.0.0.1:${server.address().port}/v1/responses`, authType: 'api_key',
  };
  const launch = gateway.issue({ executionRealm, route, credential: 'provider-secret' });
  const response = responseSink();
  const finished = new Promise((resolve) => response.once('finish', resolve));
  await gateway.handle({ params: { token: launch.token, operation: 'messages' }, headers: {}, body: { model: 'override', messages: [{ role: 'user', content: 'read it' }], tools: [{ name: 'read_file', input_schema: { type: 'object' } }], stream: true } }, response);
  await finished;
  assert.equal(upstreamBody.model, 'gpt-test');
  assert.equal(upstreamBody.input[0].content, 'read it');
  assert.equal(upstreamBody.tools[0].name, 'read_file');
  assert.match(response.body(), /content_block_start/);
  assert.match(response.body(), /tool_use/);
  assert.match(response.body(), /input_json_delta/);
  assert.match(response.body(), /message_stop/);
});
