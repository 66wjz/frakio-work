import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const AUTH_COOKIE = 'frakio_auth';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;

function cookies(header = '') {
  return Object.fromEntries(String(header)
    .split(';')
    .map((part) => part.trim().split('=').map(decodeURIComponent))
    .filter((part) => part.length === 2));
}

function passwordRecord(password, salt = randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: scryptSync(String(password), salt, 64).toString('hex'),
  };
}

function passwordMatches(password, record) {
  try {
    const expected = Buffer.from(String(record?.hash || ''), 'hex');
    const actual = scryptSync(String(password), String(record?.salt || ''), expected.length);
    return expected.length > 0 && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function generatedPassword() {
  return randomBytes(18).toString('base64url');
}

function remoteAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function loopback(req) {
  const address = remoteAddress(req);
  return address === '127.0.0.1' || address === '::1';
}

function setAuthCookie(res, token, { secure = false, clear = false } = {}) {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token || '')}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function createManagedWebAuth({
  enabled = false,
  home = path.join(os.homedir(), '.frakio-work'),
  secureCookies = false,
  now = () => Date.now(),
} = {}) {
  const authPath = path.join(home, 'data', 'managed-web-auth.json');
  const desktopSecretPath = path.join(home, 'runtime', 'desktop-session-secret');
  const sessions = new Map();
  const attempts = new Map();
  let password = null;
  let desktopSecret = '';
  let generatedAdminPassword = '';

  async function initialize() {
    if (!enabled) return { enabled: false, generatedAdminPassword: '' };
    await Promise.all([
      mkdir(path.dirname(authPath), { recursive: true }),
      mkdir(path.dirname(desktopSecretPath), { recursive: true }),
    ]);
    try {
      password = JSON.parse(await readFile(authPath, 'utf8'));
    } catch {
      generatedAdminPassword = String(process.env.FRAKIO_WORK_ADMIN_PASSWORD || '').trim() || generatedPassword();
      password = { schema: 1, ...passwordRecord(generatedAdminPassword), updatedAt: new Date(now()).toISOString() };
      await writeFile(authPath, `${JSON.stringify(password, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    try {
      desktopSecret = (await readFile(desktopSecretPath, 'utf8')).trim();
    } catch {
      desktopSecret = randomBytes(32).toString('base64url');
      await writeFile(desktopSecretPath, `${desktopSecret}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    return { enabled: true, generatedAdminPassword };
  }

  function authenticated(req) {
    if (!enabled) return true;
    const token = cookies(req.get?.('Cookie') || req.headers?.cookie)[AUTH_COOKIE];
    const expiresAt = sessions.get(token);
    if (!expiresAt || expiresAt <= now()) {
      if (token) sessions.delete(token);
      return false;
    }
    return true;
  }

  function issueSession(res) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, now() + SESSION_MAX_AGE_SECONDS * 1000);
    setAuthCookie(res, token, { secure: secureCookies });
  }

  function statusRoute(req, res) {
    res.json({
      managed: enabled,
      authenticated: authenticated(req),
      transport: secureCookies ? 'https' : 'trusted-lan-http',
    });
  }

  function loginRoute(req, res) {
    if (!enabled) return res.json({ ok: true, managed: false });
    const address = remoteAddress(req);
    const recent = (attempts.get(address) || []).filter((time) => now() - time < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_LIMIT) return res.status(429).json({ error: '登录尝试过多，请稍后再试。' });
    if (!passwordMatches(req.body?.password, password)) {
      recent.push(now());
      attempts.set(address, recent);
      return res.status(401).json({ error: '密码不正确。' });
    }
    attempts.delete(address);
    issueSession(res);
    return res.json({ ok: true });
  }

  function desktopSessionRoute(req, res) {
    if (!enabled || !loopback(req) || req.get('X-Frakio-Desktop-Secret') !== desktopSecret) {
      return res.status(403).json({ error: 'Desktop session validation failed.' });
    }
    issueSession(res);
    return res.json({ ok: true });
  }

  function protect(req, res, next) {
    if (req.path === '/health') return next();
    if (authenticated(req)) return next();
    return res.status(401).json({ error: 'Authentication required.', code: 'managed_web_auth_required' });
  }

  function logoutRoute(req, res) {
    const token = cookies(req.get?.('Cookie') || req.headers?.cookie)[AUTH_COOKIE];
    if (token) sessions.delete(token);
    setAuthCookie(res, '', { secure: secureCookies, clear: true });
    res.json({ ok: true });
  }

  async function passwordRoute(req, res) {
    const nextPassword = String(req.body?.password || '');
    if (nextPassword.length < 10) return res.status(400).json({ error: '密码至少需要 10 个字符。' });
    password = { schema: 1, ...passwordRecord(nextPassword), updatedAt: new Date(now()).toISOString() };
    await writeFile(authPath, `${JSON.stringify(password, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    sessions.clear();
    issueSession(res);
    res.json({ ok: true });
  }

  return {
    enabled,
    initialize,
    statusRoute,
    loginRoute,
    desktopSessionRoute,
    protect,
    logoutRoute,
    passwordRoute,
    generatedPassword: () => generatedAdminPassword,
    paths: { authPath, desktopSecretPath },
  };
}

export const managedWebAuthInternals = {
  passwordRecord,
  passwordMatches,
  generatedPassword,
};
