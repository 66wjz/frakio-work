import assert from 'node:assert/strict';
import test from 'node:test';
import { installLocalApiFetchGuard } from '../web/src/api/fetch-guard.ts';

function createWindow(fetch) {
  return {
    fetch,
    location: { origin: 'http://127.0.0.1:5173' },
  };
}

test('fetch guard refreshes a stale local session and retries once', async () => {
  const calls = [];
  let mutationAttempts = 0;
  const target = createWindow(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    if (url === '/api/session') return Response.json({ ok: true });
    mutationAttempts += 1;
    return mutationAttempts === 1
      ? Response.json({ error: 'Local session validation failed.', code: 'LOCAL_SESSION_INVALID' }, { status: 403 })
      : Response.json({ ok: true });
  });

  installLocalApiFetchGuard(target);
  const response = await target.fetch('/api/threads/thread-1', { method: 'DELETE' });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.url), [
    '/api/session',
    '/api/threads/thread-1',
    '/api/session',
    '/api/threads/thread-1',
  ]);
  assert.equal(calls[1].init.credentials, 'include');
  assert.equal(calls[1].init.headers.get('X-Frakio-Request'), '1');
  assert.equal(mutationAttempts, 2);
});

test('fetch guard does not retry unrelated 403 responses', async () => {
  let sessionCalls = 0;
  let mutationCalls = 0;
  const target = createWindow(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/session') {
      sessionCalls += 1;
      return Response.json({ ok: true });
    }
    mutationCalls += 1;
    return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
  });

  installLocalApiFetchGuard(target);
  const response = await target.fetch('/api/threads/thread-1', { method: 'DELETE' });

  assert.equal(response.status, 403);
  assert.equal(sessionCalls, 1);
  assert.equal(mutationCalls, 1);
});

test('fetch guard stops after one stale-session retry', async () => {
  let sessionCalls = 0;
  let mutationCalls = 0;
  const target = createWindow(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/session') {
      sessionCalls += 1;
      return Response.json({ ok: true });
    }
    mutationCalls += 1;
    return Response.json({ error: 'Local session validation failed.', code: 'LOCAL_SESSION_INVALID' }, { status: 403 });
  });

  installLocalApiFetchGuard(target);
  const response = await target.fetch('/api/threads/thread-1', { method: 'DELETE' });

  assert.equal(response.status, 403);
  assert.equal(sessionCalls, 2);
  assert.equal(mutationCalls, 2);
});

test('fetch guard preserves a Request body across session recovery', async () => {
  const bodies = [];
  let mutationCalls = 0;
  const target = createWindow(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/session') return Response.json({ ok: true });
    mutationCalls += 1;
    bodies.push(await input.text());
    return mutationCalls === 1
      ? Response.json({ code: 'LOCAL_SESSION_INVALID' }, { status: 403 })
      : Response.json({ ok: true });
  });
  const request = new Request('http://127.0.0.1:5173/api/threads/thread-1/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: true }),
  });

  installLocalApiFetchGuard(target);
  const response = await target.fetch(request);

  assert.equal(response.status, 200);
  assert.deepEqual(bodies, ['{"archived":true}', '{"archived":true}']);
});

test('concurrent stale requests share one session refresh', async () => {
  let sessionCalls = 0;
  const attempts = new Map();
  const target = createWindow(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/session') {
      sessionCalls += 1;
      return Response.json({ ok: true });
    }
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    return count === 1
      ? Response.json({ code: 'LOCAL_SESSION_INVALID' }, { status: 403 })
      : Response.json({ ok: true });
  });

  installLocalApiFetchGuard(target);
  const responses = await Promise.all([
    target.fetch('/api/threads/thread-1', { method: 'DELETE' }),
    target.fetch('/api/threads/thread-2', { method: 'DELETE' }),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(sessionCalls, 2);
});
