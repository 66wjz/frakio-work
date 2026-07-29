import { randomBytes } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}

function isPrivateHostname(hostname = '') {
  const clean = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  if (clean === 'localhost' || clean === os.hostname().toLowerCase() || clean.endsWith('.local')) return true;
  if (net.isIP(clean) === 4) {
    const octets = clean.split('.').map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  if (net.isIP(clean) === 6) return clean === '::1' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb');
  return false;
}

export function createLocalSecurity({ port, development = false, managedWeb = false } = {}) {
  const sessionToken = randomBytes(32).toString('base64url');
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...(development ? ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174'] : []),
    ...String(process.env.FRAKIO_WORK_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  ]);

  function originAllowed(origin, requestHost = '') {
    if (!origin || allowedOrigins.has(origin)) return true;
    if (!managedWeb) return false;
    try {
      const parsed = new URL(origin);
      const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
      const portMatches = requestHost
        ? parsed.host === requestHost
        : (parsed.port || defaultPort) === String(port);
      const hostMatchesRequest = !requestHost || parsed.host === requestHost;
      return ['http:', 'https:'].includes(parsed.protocol)
        && portMatches
        && hostMatchesRequest
        && isPrivateHostname(parsed.hostname);
    } catch {
      return false;
    }
  }

  function corsOptions(req, callback) {
    const origin = req.get('Origin');
    callback(null, {
      origin: originAllowed(origin, req.get('Host')),
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Frakio-Request'],
    });
  }

  function sessionRoute(_req, res) {
    res.setHeader('Set-Cookie', `frakio_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/api`);
    res.json({ ok: true });
  }

  function protect(req, res, next) {
    if (!originAllowed(req.get('Origin'), req.get('Host'))) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const cookies = parseCookies(req.get('Cookie'));
    if (req.get('X-Frakio-Request') !== '1' || cookies.frakio_session !== sessionToken) {
      return res.status(403).json({ error: 'Local session validation failed.' });
    }
    return next();
  }

  return { allowedOrigins, corsOptions, sessionRoute, protect };
}
