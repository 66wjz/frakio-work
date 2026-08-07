function isLocalApi(input: RequestInfo | URL, origin: string) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(value, origin);
  return url.origin === origin && url.pathname.startsWith('/api/');
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function isAuthenticationBootstrap(input: RequestInfo | URL, origin: string) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(value, origin);
  return ['/api/auth/login', '/api/auth/status', '/api/auth/desktop-session'].includes(url.pathname);
}

async function isInvalidLocalSession(response: Response) {
  if (response.status !== 403) return false;
  try {
    const body = await response.clone().json() as { code?: string };
    return body?.code === 'LOCAL_SESSION_INVALID';
  } catch {
    return false;
  }
}

export function installLocalApiFetchGuard(targetWindow: Window = window) {
  const originalFetch = targetWindow.fetch.bind(targetWindow);
  const origin = targetWindow.location.origin;
  let sessionPromise: Promise<void> | null = null;

  function ensureSession() {
    if (!sessionPromise) {
      sessionPromise = originalFetch('/api/session', { credentials: 'include' }).then((response) => {
        if (!response.ok) throw new Error('Unable to initialize the local Frakio Work session.');
      }).catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  }

  function refreshSession(staleSession: Promise<void>) {
    if (sessionPromise === staleSession) sessionPromise = null;
    return ensureSession();
  }

  targetWindow.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!isLocalApi(input, origin)) return originalFetch(input, init);
    const method = requestMethod(input, init);
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const guardedMutation = mutating && !isAuthenticationBootstrap(input, origin);
    const activeSession = guardedMutation ? ensureSession() : null;
    if (activeSession) await activeSession;

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (mutating) headers.set('X-Frakio-Request', '1');

    // Clone Request bodies before the first attempt so a stale-session retry
    // never tries to reuse a consumed stream.
    const firstInput = input instanceof Request ? input.clone() : input;
    const retryInput = input instanceof Request ? input.clone() : input;
    const requestInit = { ...init, headers, credentials: 'include' as const };
    const response = await originalFetch(firstInput, requestInit);
    if (!activeSession || !await isInvalidLocalSession(response)) return response;

    await refreshSession(activeSession);
    return originalFetch(retryInput, requestInit);
  };
}
