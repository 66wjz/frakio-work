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
