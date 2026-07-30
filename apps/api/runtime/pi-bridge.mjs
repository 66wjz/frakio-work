import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPiBridge({ workerPath = path.join(__dirname, 'workers', 'pi-worker.mjs'), env = {}, toolHandler, credentialHandler }) {
  const emitter = new EventEmitter();
  const pending = new Map();
  let child = null;
  let sequence = 0;
  let readyPromise = null;

  function failPending(error) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }

  function handleMessage(message) {
    if (message?.type === 'ready') {
      emitter.emit('ready', message);
      return;
    }
    if (message?.type === 'event') {
      emitter.emit('event', message);
      return;
    }
    if (message?.type === 'tool.request') {
      Promise.resolve(toolHandler?.(message.name, message.params || {}, message.context || {}))
        .then((result) => child?.send({ type: 'tool.response', requestId: message.requestId, result }))
        .catch((error) => child?.send({ type: 'tool.response', requestId: message.requestId, error: error.message || String(error) }));
      return;
    }
    if (message?.type === 'credential.request') {
      Promise.resolve(credentialHandler?.(message.operation, message.providerId, message.credential, message.accountId || ''))
        .then((credential) => child?.send({ type: 'credential.response', requestId: message.requestId, credential }))
        .catch((error) => child?.send({ type: 'credential.response', requestId: message.requestId, error: error.message || String(error) }));
      return;
    }
    const item = pending.get(message?.requestId);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.requestId);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message);
  }

  async function ensureStarted() {
    if (child?.connected) return child;
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
      const next = fork(workerPath, [], {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'advanced',
      });
      child = next;
      const stderr = [];
      next.stderr?.on('data', (chunk) => {
        stderr.push(String(chunk));
        if (stderr.length > 20) stderr.shift();
      });
      const timer = setTimeout(() => {
        reject(new Error(`Pi Worker startup timed out.${stderr.length ? ` ${stderr.join('').slice(-1000)}` : ''}`));
        next.kill('SIGTERM');
      }, 20000);
      const onReady = () => {
        clearTimeout(timer);
        emitter.off('ready', onReady);
        resolve(next);
      };
      emitter.on('ready', onReady);
      next.on('message', handleMessage);
      next.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      next.once('exit', (code, signal) => {
        clearTimeout(timer);
        const error = new Error(`Pi Worker exited code=${code ?? ''} signal=${signal ?? ''}.${stderr.length ? ` ${stderr.join('').slice(-1000)}` : ''}`);
        failPending(error);
        child = null;
        readyPromise = null;
        emitter.emit('exit', error);
      });
    }).finally(() => {
      if (!child?.connected) readyPromise = null;
    });
    return readyPromise;
  }

  async function request(type, payload = {}, timeoutMs = 30000) {
    const processHandle = await ensureStarted();
    const requestId = `pi_bridge_${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Pi Worker request timed out: ${type}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      processHandle.send({ type, requestId, ...payload });
    });
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    ensureStarted,
    async startRun(payload) {
      return request('run.start', payload, 120000);
    },
    async steer(sessionId, message) {
      return request('run.steer', { sessionId, message });
    },
    async cancel(sessionId) {
      return request('run.cancel', { sessionId });
    },
    async disposeSession(sessionId) {
      return request('session.dispose', { sessionId });
    },
    async close() {
      if (!child) return;
      const current = child;
      child = null;
      readyPromise = null;
      current.disconnect();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          current.kill('SIGTERM');
          resolve();
        }, 1500);
        current.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
