import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

function profileInstructions(snapshot, contextPacket) {
  const memory = (contextPacket?.memory || []).map((entry) => `- ${entry.fact}`).join('\n') || '- None';
  const knowledge = (contextPacket?.knowledge || []).map((entry) => `- ${entry.relativePath}: ${entry.summary || ''}`).join('\n') || '- None';
  return `Frakio Agent identity for this thread:
Name: ${snapshot.name}
Role: ${snapshot.role}
Operating style: ${snapshot.soul || snapshot.scope || 'Precise and practical.'}
Responsibility: ${snapshot.scope || 'Complete the assigned task.'}

Accepted portable memory:
${memory}

Relevant Workspace Vault material:
${knowledge}

Frakio Work owns durable identity, memory, project knowledge, task state and the shared event log. Do not create a competing private task board or claim completion without verifiable output.`;
}

function approvalPolicy(mode) {
  if (mode === 'off') return 'never';
  if (mode === 'manual') return 'unlessTrusted';
  return 'onRequest';
}

function sandboxPolicy(mode, cwd) {
  if (mode === 'off') return { type: 'readOnly' };
  return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: mode === 'smart' };
}

export function createCodexAppServerBridge({ commandResolver, spawnProcess = spawn, commandArgs = ['app-server'] }) {
  const emitter = new EventEmitter();
  const pending = new Map();
  const sessions = new Map();
  const approvals = new Map();
  let child = null;
  let sequence = 0;
  let startPromise = null;

  function write(message) {
    if (!child?.stdin?.writable) throw new Error('Codex app-server is not connected.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function sendRequest(method, params = {}, timeoutMs = 30000) {
    const requestId = `frakio_codex_${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      write({ method, id: requestId, params });
    });
  }

  function runtimeForThread(threadId) {
    return Array.from(sessions.values()).find((session) => session.nativeThreadId === threadId) || null;
  }

  function emitRuntime(session, event) {
    if (!session?.runId) return;
    emitter.emit('event', { runId: session.runId, event });
  }

  function handleNotification(message) {
    const method = String(message.method || '');
    const params = message.params || {};
    const session = runtimeForThread(params.threadId);
    if (message.id !== undefined && method.includes('requestApproval')) {
      const approvalId = `codex_approval_${++sequence}`;
      approvals.set(approvalId, { requestId: message.id, sessionId: session?.sessionId || '', method });
      emitRuntime(session, {
        type: 'approval.requested',
        payload: { approvalId, method, ...params },
      });
      return;
    }
    if (!session) return;
    if (method === 'item/agentMessage/delta') {
      const delta = String(params.delta || '');
      session.output += delta;
      emitRuntime(session, { type: 'message.delta', payload: { delta } });
      return;
    }
    if (method === 'item/started') {
      const item = params.item || {};
      if (item.type === 'agentMessage') return;
      emitRuntime(session, {
        type: 'tool.started',
        payload: { toolCallId: item.id || '', toolName: item.type || 'codex.item', args: item },
      });
      return;
    }
    if (method === 'item/completed') {
      const item = params.item || {};
      if (item.type === 'agentMessage') {
        const text = String(item.text || item.content || '');
        if (!session.output && text) {
          session.output = text;
          emitRuntime(session, { type: 'message.delta', payload: { delta: text } });
        }
        return;
      }
      emitRuntime(session, {
        type: 'tool.completed',
        payload: { toolCallId: item.id || '', toolName: item.type || 'codex.item', isError: item.status === 'failed', resultPreview: JSON.stringify(item).slice(0, 1000) },
      });
      return;
    }
    if (method === 'turn/completed') {
      const status = String(params.turn?.status || params.status || 'completed');
      const failed = ['failed', 'error'].includes(status);
      const cancelled = ['interrupted', 'cancelled'].includes(status);
      emitRuntime(session, {
        type: failed ? 'run.failed' : cancelled ? 'run.cancelled' : 'run.completed',
        payload: { output: session.output, error: params.turn?.error?.message || params.error?.message || '', nativeTurnId: session.activeTurnId },
      });
      session.activeTurnId = '';
      session.runId = '';
      session.output = '';
    }
  }

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else item.resolve(message.result);
      return;
    }
    handleNotification(message);
  }

  async function ensureStarted() {
    if (child?.stdin?.writable) return child;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const command = await commandResolver('codex');
      if (!command) throw new Error('Codex CLI is not installed.');
      const next = spawnProcess(command, commandArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      child = next;
      const stderr = [];
      next.stderr.on('data', (chunk) => {
        stderr.push(String(chunk));
        if (stderr.length > 30) stderr.shift();
      });
      readline.createInterface({ input: next.stdout }).on('line', handleLine);
      next.once('exit', (code, signal) => {
        const error = new Error(`Codex app-server exited code=${code ?? ''} signal=${signal ?? ''}.${stderr.length ? ` ${stderr.join('').slice(-1000)}` : ''}`);
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(error);
        }
        pending.clear();
        child = null;
        startPromise = null;
        emitter.emit('exit', error);
      });
      next.once('error', (error) => emitter.emit('exit', error));
      await sendRequest('initialize', {
        clientInfo: { name: 'frakio_work', title: 'Frakio Work', version: '1.0.1' },
      });
      write({ method: 'initialized', params: {} });
      return next;
    })().catch((error) => {
      child?.kill('SIGTERM');
      child = null;
      startPromise = null;
      throw error;
    });
    return startPromise;
  }

  async function request(method, params = {}, timeoutMs = 30000) {
    await ensureStarted();
    return sendRequest(method, params, timeoutMs);
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    ensureStarted,
    async listModels() {
      const result = await request('model/list', { limit: 100, includeHidden: false });
      return result?.data || [];
    },
    async startRun(input) {
      await ensureStarted();
      let holder = sessions.get(input.sessionId);
      if (!holder) {
        holder = {
          sessionId: input.sessionId,
          nativeThreadId: input.nativeSessionId || '',
          activeTurnId: '',
          runId: '',
          output: '',
        };
        sessions.set(input.sessionId, holder);
      }
      if (holder.nativeThreadId) {
        const resumed = await request('thread/resume', {
          threadId: holder.nativeThreadId,
          cwd: input.cwd,
          ...(input.model ? { model: input.model } : {}),
        }, 60000);
        holder.nativeThreadId = resumed?.thread?.id || holder.nativeThreadId;
      } else {
        const started = await request('thread/start', {
          cwd: input.cwd,
          ...(input.model ? { model: input.model } : {}),
          approvalPolicy: approvalPolicy(input.permissionMode),
          sandbox: input.permissionMode === 'off' ? 'readOnly' : 'workspaceWrite',
          serviceName: 'frakio_work',
        }, 60000);
        holder.nativeThreadId = started?.thread?.id || '';
      }
      if (!holder.nativeThreadId) throw new Error('Codex app-server did not return a thread id.');
      holder.runId = input.runId;
      holder.output = '';
      const preamble = input.nativeSessionId ? '' : `${profileInstructions(input.profileSnapshot, input.contextPacket)}\n\n`;
      const result = await request('turn/start', {
        threadId: holder.nativeThreadId,
        input: [{ type: 'text', text: `${preamble}${input.prompt}` }],
        cwd: input.cwd,
        approvalPolicy: approvalPolicy(input.permissionMode),
        sandboxPolicy: sandboxPolicy(input.permissionMode, input.cwd),
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort && input.effort !== 'default' ? { effort: input.effort } : {}),
        summary: 'concise',
      }, 60000);
      holder.activeTurnId = result?.turn?.id || '';
      emitRuntime(holder, { type: 'run.started', payload: { nativeThreadId: holder.nativeThreadId, nativeTurnId: holder.activeTurnId } });
      return { nativeSessionId: holder.nativeThreadId, nativeTurnId: holder.activeTurnId };
    },
    async steer(sessionId, message) {
      const holder = sessions.get(sessionId);
      if (!holder?.activeTurnId) throw new Error('Codex turn is not active.');
      return request('turn/steer', {
        threadId: holder.nativeThreadId,
        expectedTurnId: holder.activeTurnId,
        input: [{ type: 'text', text: String(message || '') }],
      });
    },
    async cancel(sessionId) {
      const holder = sessions.get(sessionId);
      if (!holder?.activeTurnId) return { ok: false };
      await request('turn/interrupt', { threadId: holder.nativeThreadId, turnId: holder.activeTurnId });
      return { ok: true };
    },
    async resolveApproval(approvalId, decision) {
      const approval = approvals.get(approvalId);
      if (!approval) throw new Error('Codex approval request does not exist.');
      approvals.delete(approvalId);
      const mapped = ['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision) ? decision : decision === 'approve_always' ? 'acceptForSession' : decision === 'reject' ? 'decline' : 'accept';
      write({ id: approval.requestId, result: { decision: mapped } });
      const holder = sessions.get(approval.sessionId);
      emitRuntime(holder, { type: 'approval.resolved', payload: { approvalId, decision: mapped } });
      return { ok: true, decision: mapped };
    },
    async close() {
      if (!child) return;
      const current = child;
      child = null;
      startPromise = null;
      current.kill('SIGTERM');
    },
  };
}
