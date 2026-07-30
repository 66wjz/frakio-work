import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk';
import { resolveInsideRoot } from '../lib/path-boundary.mjs';

function profileInstructions(snapshot, contextPacket) {
  const memory = (contextPacket?.memory || []).map((entry) => `- ${entry.fact}`).join('\n') || '- None';
  const knowledge = (contextPacket?.knowledge || []).map((entry) => `- ${entry.relativePath}: ${entry.summary || ''}`).join('\n') || '- None';
  return `Frakio Agent identity:
Name: ${snapshot.name}
Role: ${snapshot.role}
Operating style: ${snapshot.soul || snapshot.scope || 'Precise and practical.'}
Responsibility: ${snapshot.scope || 'Complete the assigned task.'}

Accepted portable memory:
${memory}

Relevant Workspace Vault material:
${knowledge}

Frakio Work owns durable identity, memory, project knowledge, task state and the shared event log. Do not create a competing private memory or task board.`;
}

export function createGeminiAcpBridge({ commandResolver, spawnProcess = spawn, commandArgs = ['--acp'] }) {
  const emitter = new EventEmitter();
  const sessions = new Map();
  const approvals = new Map();
  let sequence = 0;
  let child = null;
  let connection = null;
  let startPromise = null;

  function holderForNativeSession(sessionId) {
    return Array.from(sessions.values()).find((holder) => holder.nativeSessionId === sessionId) || null;
  }

  function emit(holder, type, payload = {}) {
    if (holder?.runId) emitter.emit('event', { runId: holder.runId, event: { type, payload } });
  }

  async function ensureStarted() {
    if (connection) return connection;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const command = await commandResolver('gemini');
      if (!command) throw new Error('Gemini CLI is not installed.');
      child = spawnProcess(command, commandArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      const stream = ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout),
      );
      connection = new ClientSideConnection(() => ({
        async requestPermission(params) {
          const holder = holderForNativeSession(params.sessionId);
          const approvalId = `gemini_approval_${++sequence}`;
          return new Promise((resolve) => {
            approvals.set(approvalId, { resolve, sessionId: holder?.sessionId || '', options: params.options || [] });
            emit(holder, 'approval.requested', {
              approvalId,
              toolCallId: params.toolCall?.toolCallId || '',
              toolName: params.toolCall?.title || params.toolCall?.kind || 'Gemini tool',
              options: params.options || [],
              args: params.toolCall?.rawInput || {},
            });
          });
        },
        async sessionUpdate(params) {
          const holder = holderForNativeSession(params.sessionId);
          const update = params.update || {};
          if (!holder) return;
          if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
            const delta = String(update.content.text || '');
            holder.output += delta;
            emit(holder, 'message.delta', { delta });
          } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
            emit(holder, 'reasoning.summary', { delta: String(update.content.text || '') });
          } else if (update.sessionUpdate === 'tool_call') {
            emit(holder, 'tool.started', { toolCallId: update.toolCallId, toolName: update.title || update.kind || 'Gemini tool', args: update.rawInput || {} });
          } else if (update.sessionUpdate === 'tool_call_update') {
            emit(holder, ['completed', 'failed'].includes(update.status) ? 'tool.completed' : 'tool.updated', {
              toolCallId: update.toolCallId,
              toolName: update.title || update.kind || 'Gemini tool',
              isError: update.status === 'failed',
              resultPreview: JSON.stringify(update.rawOutput || update.content || '').slice(0, 1000),
            });
          }
        },
        async readTextFile(params) {
          const holder = holderForNativeSession(params.sessionId);
          if (!holder) throw new Error('Gemini ACP session is not active.');
          const target = resolveInsideRoot(holder.cwd, params.path);
          return { content: await readFile(target, 'utf8') };
        },
        async writeTextFile(params) {
          const holder = holderForNativeSession(params.sessionId);
          if (!holder) throw new Error('Gemini ACP session is not active.');
          const target = resolveInsideRoot(holder.cwd, params.path);
          await writeFile(target, params.content, 'utf8');
          return {};
        },
      }), stream);
      child.once('exit', () => {
        connection = null;
        child = null;
        startPromise = null;
      });
      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'frakio_work', title: 'Frakio Work', version: '1.0.1' },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      });
      return connection;
    })().catch((error) => {
      child?.kill('SIGTERM');
      child = null;
      connection = null;
      startPromise = null;
      throw error;
    });
    return startPromise;
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    ensureStarted,
    async startRun(input) {
      const client = await ensureStarted();
      let holder = sessions.get(input.sessionId);
      if (!holder) {
        holder = {
          sessionId: input.sessionId,
          nativeSessionId: input.nativeSessionId || '',
          cwd: input.cwd,
          runId: '',
          output: '',
        };
        sessions.set(input.sessionId, holder);
      }
      holder.cwd = input.cwd;
      if (holder.nativeSessionId) {
        await client.loadSession({ sessionId: holder.nativeSessionId, cwd: input.cwd, mcpServers: [] });
      } else {
        const created = await client.newSession({ cwd: input.cwd, mcpServers: [] });
        holder.nativeSessionId = created.sessionId;
      }
      if (input.model) await client.unstable_setSessionModel({ sessionId: holder.nativeSessionId, modelId: input.model }).catch(() => {});
      holder.runId = input.runId;
      holder.output = '';
      emit(holder, 'run.started', { nativeSessionId: holder.nativeSessionId });
      const prefix = input.nativeSessionId ? '' : `${profileInstructions(input.profileSnapshot, input.contextPacket)}\n\n`;
      void client.prompt({
        sessionId: holder.nativeSessionId,
        prompt: [{ type: 'text', text: `${prefix}${input.prompt}` }],
      }).then((result) => {
        const cancelled = result.stopReason === 'cancelled';
        const failed = ['refusal'].includes(result.stopReason);
        emit(holder, cancelled ? 'run.cancelled' : failed ? 'run.failed' : 'run.completed', {
          output: holder.output,
          error: failed ? `Gemini stopped with ${result.stopReason}.` : '',
          stopReason: result.stopReason,
          usage: result.usage || null,
        });
        holder.runId = '';
        holder.output = '';
      }).catch((error) => {
        emit(holder, 'run.failed', { output: holder.output, error: error.message || String(error) });
        holder.runId = '';
        holder.output = '';
      });
      return { nativeSessionId: holder.nativeSessionId };
    },
    async steer() {
      throw new Error('Gemini ACP does not define mid-turn steering.');
    },
    async cancel(sessionId) {
      const holder = sessions.get(sessionId);
      if (!holder?.nativeSessionId || !connection) return { ok: false };
      await connection.cancel({ sessionId: holder.nativeSessionId });
      return { ok: true };
    },
    async resolveApproval(approvalId, decision) {
      const approval = approvals.get(approvalId);
      if (!approval) throw new Error('Gemini permission request does not exist.');
      approvals.delete(approvalId);
      const allow = ['approve_once', 'approve_always', 'accept', 'acceptForSession'].includes(decision);
      const selected = allow
        ? approval.options.find((option) => decision === 'approve_always' ? option.kind === 'allow_always' : option.kind !== 'reject_once' && option.kind !== 'reject_always')
        : approval.options.find((option) => option.kind === 'reject_once' || option.kind === 'reject_always');
      approval.resolve(selected ? { outcome: { outcome: 'selected', optionId: selected.optionId } } : { outcome: { outcome: 'cancelled' } });
      const holder = sessions.get(approval.sessionId);
      emit(holder, 'approval.resolved', { approvalId, decision: selected?.optionId || 'cancelled' });
      return { ok: true };
    },
    async close() {
      child?.kill('SIGTERM');
      child = null;
      connection = null;
      startPromise = null;
      sessions.clear();
    },
  };
}
