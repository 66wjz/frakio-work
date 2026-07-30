import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';

function systemPrompt(snapshot, contextPacket) {
  const memory = (contextPacket?.memory || []).map((entry) => `- ${entry.fact}`).join('\n') || '- None';
  const knowledge = (contextPacket?.knowledge || []).map((entry) => `- ${entry.relativePath}: ${entry.summary || ''}`).join('\n') || '- None';
  return `You are ${snapshot.name}, a Frakio Work Agent.

Role: ${snapshot.role}
Operating style: ${snapshot.soul || snapshot.scope || 'Precise and practical.'}
Responsibility: ${snapshot.scope || 'Complete the assigned task.'}

Accepted portable memory:
${memory}

Relevant Workspace Vault material:
${knowledge}

Frakio Work owns durable Agent identity, memory, project knowledge, task state and the shared event log. Do not create a competing private memory or task board. Never expose hidden reasoning.`;
}

function permissionMode(mode) {
  if (mode === 'off') return 'dontAsk';
  return 'default';
}

function textBlocks(message) {
  return (message?.message?.content || []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
}

export function createClaudeAgentSdkBridge({ commandResolver, queryFactory = query }) {
  const emitter = new EventEmitter();
  const sessions = new Map();
  const approvals = new Map();
  let sequence = 0;

  function emit(holder, type, payload = {}) {
    if (holder?.runId) emitter.emit('event', { runId: holder.runId, event: { type, payload } });
  }

  async function run(input, holder, executable, accepted) {
    const abortController = new AbortController();
    holder.abortController = abortController;
    const stream = queryFactory({
      prompt: input.prompt,
      options: {
        abortController,
        cwd: input.cwd,
        pathToClaudeCodeExecutable: executable,
        ...(input.nativeSessionId ? { resume: input.nativeSessionId } : {}),
        ...(input.model ? { model: input.model } : {}),
        includePartialMessages: true,
        permissionMode: permissionMode(input.permissionMode),
        settingSources: ['user', 'project', 'local'],
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt(input.profileSnapshot, input.contextPacket),
        },
        canUseTool: async (toolName, toolInput, options) => {
          const approvalId = `claude_approval_${++sequence}`;
          return new Promise((resolve) => {
            approvals.set(approvalId, { resolve, sessionId: input.sessionId, suggestions: options.suggestions || [] });
            emit(holder, 'approval.requested', {
              approvalId,
              toolName,
              toolInput,
              toolUseId: options.toolUseID,
              title: options.title || options.displayName || toolName,
              description: options.description || options.decisionReason || '',
            });
          });
        },
      },
    });
    holder.query = stream;
    try {
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') {
          holder.nativeSessionId = message.session_id;
          accepted.resolve({ nativeSessionId: message.session_id });
          emit(holder, 'run.started', { nativeSessionId: message.session_id });
          continue;
        }
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const delta = String(event.delta.text || '');
            holder.output += delta;
            emit(holder, 'message.delta', { delta });
          }
          continue;
        }
        if (message.type === 'assistant') {
          for (const block of message.message?.content || []) {
            if (block.type === 'tool_use') {
              emit(holder, 'tool.started', { toolCallId: block.id, toolName: block.name, args: block.input || {} });
            }
          }
          const text = textBlocks(message);
          if (!holder.output && text) {
            holder.output = text;
            emit(holder, 'message.delta', { delta: text });
          }
          continue;
        }
        if (message.type === 'tool_progress') {
          emit(holder, 'tool.updated', { toolCallId: message.tool_use_id || '', toolName: message.tool_name || 'Claude tool', elapsedSeconds: message.elapsed_time_seconds });
          continue;
        }
        if (message.type === 'result') {
          const output = typeof message.result === 'string' ? message.result : holder.output;
          if (!holder.output && output) emit(holder, 'message.delta', { delta: output });
          const failed = message.subtype !== 'success' || message.is_error;
          emit(holder, failed ? 'run.failed' : 'run.completed', {
            output: output || holder.output,
            error: failed ? (message.errors || []).join('\n') || 'Claude Agent SDK run failed.' : '',
            costUsd: message.total_cost_usd,
            durationMs: message.duration_ms,
          });
        }
      }
      if (!holder.nativeSessionId) accepted.reject(new Error('Claude Agent SDK did not return a session id.'));
    } catch (error) {
      accepted.reject(error);
      emit(holder, abortController.signal.aborted ? 'run.cancelled' : 'run.failed', { output: holder.output, error: error.message || String(error) });
    } finally {
      holder.query = null;
      holder.abortController = null;
      holder.runId = '';
      holder.output = '';
    }
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    async startRun(input) {
      const executable = await commandResolver('claude');
      if (!executable) throw new Error('Claude Code CLI is not installed.');
      let holder = sessions.get(input.sessionId);
      if (!holder) {
        holder = { sessionId: input.sessionId, nativeSessionId: input.nativeSessionId || '', runId: '', output: '', query: null, abortController: null };
        sessions.set(input.sessionId, holder);
      }
      if (holder.query) throw new Error('Claude session already has an active run.');
      holder.runId = input.runId;
      holder.output = '';
      const accepted = {};
      const promise = new Promise((resolve, reject) => Object.assign(accepted, { resolve, reject }));
      void run({ ...input, nativeSessionId: holder.nativeSessionId || input.nativeSessionId }, holder, executable, accepted);
      return promise;
    },
    async steer() {
      throw new Error('Claude Agent SDK steering requires streaming input and is not enabled in this channel.');
    },
    async cancel(sessionId) {
      const holder = sessions.get(sessionId);
      if (!holder?.query) return { ok: false };
      await holder.query.interrupt().catch(() => {});
      holder.abortController?.abort();
      return { ok: true };
    },
    async resolveApproval(approvalId, decision) {
      const approval = approvals.get(approvalId);
      if (!approval) throw new Error('Claude approval request does not exist.');
      approvals.delete(approvalId);
      const allow = ['approve_once', 'approve_always', 'accept', 'acceptForSession'].includes(decision);
      approval.resolve(allow
        ? { behavior: 'allow', ...(decision === 'approve_always' ? { updatedPermissions: approval.suggestions } : {}) }
        : { behavior: 'deny', message: 'User declined this tool call.', interrupt: decision === 'cancel' });
      const holder = sessions.get(approval.sessionId);
      emit(holder, 'approval.resolved', { approvalId, decision: allow ? 'accept' : 'decline' });
      return { ok: true };
    },
    async close() {
      for (const holder of sessions.values()) {
        holder.abortController?.abort();
        holder.query?.close?.();
      }
      sessions.clear();
    },
  };
}
