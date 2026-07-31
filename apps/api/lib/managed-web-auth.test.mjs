import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createManagedWebAuth, managedWebAuthInternals } from './managed-web-auth.mjs';

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

function request({ password = '', currentPassword = '', cookie = '', secret = '', address = '127.0.0.1' } = {}) {
  return {
    body: { password, currentPassword },
    ip: address,
    socket: { remoteAddress: address },
    get(name) {
      if (name === 'Cookie') return cookie;
      if (name === 'X-Frakio-Desktop-Secret') return secret;
      return '';
    },
  };
}

test('managed Web auth creates a hashed password and authenticates a session', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-managed-auth-'));
  process.env.FRAKIO_WORK_ADMIN_PASSWORD = 'test-password-123';
  const auth = createManagedWebAuth({ enabled: true, home });
  await auth.initialize();
  delete process.env.FRAKIO_WORK_ADMIN_PASSWORD;

  const stored = JSON.parse(await readFile(auth.paths.authPath, 'utf8'));
  assert.equal(stored.password, undefined);
  assert.equal(managedWebAuthInternals.passwordMatches('test-password-123', stored), true);

  const login = response();
  auth.loginRoute(request({ password: 'test-password-123' }), login);
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  let passed = false;
  auth.protect(request({ cookie }), response(), () => { passed = true; });
  assert.equal(passed, true);
});

test('new managed Web installs use Admin once and require a password change', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-managed-auth-default-'));
  const auth = createManagedWebAuth({ enabled: true, home });
  await auth.initialize();

  const stored = JSON.parse(await readFile(auth.paths.authPath, 'utf8'));
  assert.equal(stored.mustChangePassword, true);
  assert.equal(managedWebAuthInternals.passwordMatches('Admin', stored), true);
  const beforeLogin = response();
  auth.statusRoute(request(), beforeLogin);
  assert.equal(beforeLogin.body.defaultPasswordHint, 'Admin');

  const login = response();
  auth.loginRoute(request({ password: 'Admin' }), login);
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.passwordChangeRequired, true);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  const blocked = response();
  let reached = false;
  auth.protect({ ...request({ cookie }), path: '/state' }, blocked, () => { reached = true; });
  assert.equal(reached, false);
  assert.equal(blocked.statusCode, 403);

  const changed = response();
  await auth.passwordRoute(request({ password: 'new-password-123', cookie }), changed);
  assert.equal(changed.statusCode, 200);
  const afterChange = response();
  auth.statusRoute(request(), afterChange);
  assert.equal(afterChange.body.defaultPasswordHint, undefined);
  const oldLogin = response();
  auth.loginRoute(request({ password: 'Admin' }), oldLogin);
  assert.equal(oldLogin.statusCode, 401);
  const newLogin = response();
  auth.loginRoute(request({ password: 'new-password-123' }), newLogin);
  assert.equal(newLogin.statusCode, 200);
});

test('changing an established managed Web password requires the current password', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-managed-auth-change-'));
  process.env.FRAKIO_WORK_ADMIN_PASSWORD = 'current-password-123';
  const auth = createManagedWebAuth({ enabled: true, home });
  await auth.initialize();
  delete process.env.FRAKIO_WORK_ADMIN_PASSWORD;
  const login = response();
  auth.loginRoute(request({ password: 'current-password-123' }), login);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  const denied = response();
  await auth.passwordRoute(request({ password: 'new-password-123', currentPassword: 'incorrect', cookie }), denied);
  assert.equal(denied.statusCode, 401);
  const changed = response();
  await auth.passwordRoute(request({ password: 'new-password-123', currentPassword: 'current-password-123', cookie }), changed);
  assert.equal(changed.statusCode, 200);
});

test('managed Web auth rate limits bad passwords and rejects remote desktop bootstrap', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-managed-auth-'));
  process.env.FRAKIO_WORK_ADMIN_PASSWORD = 'test-password-123';
  const auth = createManagedWebAuth({ enabled: true, home });
  await auth.initialize();
  delete process.env.FRAKIO_WORK_ADMIN_PASSWORD;
  for (let index = 0; index < 5; index += 1) {
    const denied = response();
    auth.loginRoute(request({ password: 'wrong', address: '192.168.1.8' }), denied);
    assert.equal(denied.statusCode, 401);
  }
  const limited = response();
  auth.loginRoute(request({ password: 'wrong', address: '192.168.1.8' }), limited);
  assert.equal(limited.statusCode, 429);

  const desktop = response();
  auth.desktopSessionRoute(request({ address: '192.168.1.8', secret: 'bad' }), desktop);
  assert.equal(desktop.statusCode, 403);
});
