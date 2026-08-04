import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

function bearer(value) {
  return /^bearer\s/i.test(String(value || '')) ? String(value) : `Bearer ${value}`;
}

export function createRuntimeModelGateway({ origin }) {
  const tokens = new Map();
  const realmTokens = new Map();

  function issue({ executionRealm, route, credential }) {
    const realmRevision = String(executionRealm?.revision || '');
    if (!realmRevision || !route?.targetUrl || !credential) {
      throw Object.assign(new Error('Runtime Model Route 不完整。'), { status: 409, code: 'RUNTIME_MODEL_ROUTE_MISSING' });
    }
    const existingToken = realmTokens.get(realmRevision);
    const existing = existingToken ? tokens.get(existingToken) : null;
    if (existing?.route?.routeRevision === route.routeRevision) return existing.launchSpec;
    if (existingToken) tokens.delete(existingToken);
    const token = randomBytes(32).toString('base64url');
    const endpointRoot = `${origin()}/api/runtime-model-gateway/${token}`;
    const baseUrl = route.runtimeId === 'claude' ? endpointRoot : `${endpointRoot}/v1`;
    const launchSpec = {
      runtimeId: route.runtimeId,
      executionRealmRevision: realmRevision,
      runtimeBuildId: executionRealm.runtimeBuildId,
      modelRouteRevision: route.routeRevision,
      executablePath: '',
      runtimeHome: '',
      baseUrl,
      token,
      modelId: route.modelId,
      environment: {},
      arguments: [],
    };
    tokens.set(token, { realmRevision, route, credential, launchSpec, createdAt: Date.now() });
    realmTokens.set(realmRevision, token);
    return launchSpec;
  }

  function revokeRealm(realmRevision) {
    const key = String(realmRevision || '');
    const token = realmTokens.get(key);
    if (token) tokens.delete(token);
    realmTokens.delete(key);
  }

  async function handle(req, res) {
    const entry = tokens.get(String(req.params.token || ''));
    if (!entry) return res.status(401).json({ error: 'Runtime Realm token 已失效。' });
    const requestedPath = String(req.params.operation || '');
    const expectedPath = entry.route.apiMode === 'anthropic_messages' ? 'messages' : 'responses';
    if (requestedPath.replace(/^\/+/, '') !== expectedPath) return res.status(404).json({ error: 'Runtime Model Route 不支持该协议路径。' });
    const headers = { 'content-type': 'application/json', accept: req.headers.accept || 'text/event-stream, application/json' };
    if (entry.route.apiMode === 'anthropic_messages') {
      headers['anthropic-version'] = String(req.headers['anthropic-version'] || '2023-06-01');
      if (entry.route.authType === 'oauth') headers.authorization = bearer(entry.credential);
      else if (entry.route.authType !== 'none') headers['x-api-key'] = entry.credential;
    } else {
      if (entry.route.authType !== 'none') headers.authorization = bearer(entry.credential);
      if (entry.route.accountId) headers['chatgpt-account-id'] = entry.route.accountId;
    }
    try {
      const upstream = await fetch(entry.route.targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...(req.body || {}), model: entry.route.modelId }),
        signal: req.signal,
      });
      res.status(upstream.status);
      for (const name of ['content-type', 'request-id', 'x-request-id', 'openai-processing-ms']) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res);
    } catch (error) {
      if (!res.headersSent) return res.status(502).json({ error: 'Frakio 模型路由请求失败。' });
      return res.end();
    }
  }

  function close() {
    tokens.clear();
    realmTokens.clear();
  }

  return { issue, revokeRealm, handle, close, tokenCount: () => tokens.size };
}
