import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalSecurity } from './local-security.mjs';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('local security rejects foreign origins and unauthenticated writes', () => {
  const security = createLocalSecurity({ port: 8787, development: false });
  const foreign = response();
  security.protect({ method: 'GET', get: (name) => name === 'Origin' ? 'https://evil.example' : '' }, foreign, () => assert.fail('foreign origin reached handler'));
  assert.equal(foreign.statusCode, 403);

  const unauthenticated = response();
  security.protect({ method: 'POST', get: (name) => name === 'Origin' ? 'http://127.0.0.1:8787' : '' }, unauthenticated, () => assert.fail('write reached handler'));
  assert.equal(unauthenticated.statusCode, 403);
  assert.deepEqual(unauthenticated.body, {
    error: 'Local session validation failed.',
    code: 'LOCAL_SESSION_INVALID',
  });
});

test('session cookie and request header authorize same-origin writes', () => {
  const security = createLocalSecurity({ port: 8787, development: false });
  const sessionResponse = response();
  security.sessionRoute({}, sessionResponse);
  const cookie = sessionResponse.headers['Set-Cookie'].split(';')[0];
  let passed = false;
  security.protect({
    method: 'PATCH',
    get(name) {
      if (name === 'Origin') return 'http://127.0.0.1:8787';
      if (name === 'Cookie') return cookie;
      if (name === 'X-Frakio-Request') return '1';
      return '';
    },
  }, response(), () => { passed = true; });
  assert.equal(passed, true);
});

test('managed Web accepts matching private LAN origins and rejects public hosts', () => {
  const security = createLocalSecurity({ port: 8787, development: false, managedWeb: true });
  let privatePassed = false;
  security.protect({
    method: 'GET',
    get(name) {
      if (name === 'Origin') return 'http://192.168.1.20:8787';
      if (name === 'Host') return '192.168.1.20:8787';
      return '';
    },
  }, response(), () => { privatePassed = true; });
  assert.equal(privatePassed, true);

  let privateTlsPassed = false;
  security.protect({
    method: 'GET',
    get(name) {
      if (name === 'Origin') return 'https://192.168.1.20:8787';
      if (name === 'Host') return '192.168.1.20:8787';
      return '';
    },
  }, response(), () => { privateTlsPassed = true; });
  assert.equal(privateTlsPassed, true);

  const publicResponse = response();
  security.protect({
    method: 'GET',
    get(name) {
      if (name === 'Origin') return 'http://203.0.113.10:8787';
      if (name === 'Host') return '203.0.113.10:8787';
      return '';
    },
  }, publicResponse, () => assert.fail('public origin reached handler'));
  assert.equal(publicResponse.statusCode, 403);
});
