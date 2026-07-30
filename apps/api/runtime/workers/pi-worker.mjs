import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

const sessions = new Map();
const pendingToolCalls = new Map();
const pendingCredentialCalls = new Map();
let sequence = 0;

function send(message) {
  if (process.send) process.send(message);
}

function providerApi(apiMode) {
  if (apiMode === 'anthropic_messages') return 'anthropic-messages';
  if (apiMode === 'codex_responses' || apiMode === 'openai_responses') return 'openai-responses';
  return 'openai-completions';
}

function thinkingLevel(value) {
  const clean = String(value || '').toLowerCase();
  if (['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(clean)) return clean;
  return 'off';
}

function resultText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((item) => item?.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

function safeErrorMessage(value, fallback = 'Pi 运行失败。') {
  const message = String(value || fallback)
    .replace(/(authorization|api[-_ ]?key|bearer)\s*[:=]?\s*[^\s,;]+/gi, '$1: [已隐藏]')
    .trim();
  return (message || fallback).slice(0, 2000);
}

function assistantText(message) {
  return resultText(message);
}

function messageText(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : [])
    .filter((item) => item?.type === 'text' || item?.type === 'thinking')
    .map((item) => item.text || item.thinking || '')
    .join('\n');
}

function geminiContents(context) {
  return (context.messages || []).flatMap((message) => {
    if (message.role === 'toolResult') {
      return [{
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.toolName,
            response: { content: messageText(message.content) },
          },
        }],
      }];
    }
    const text = messageText(message.content);
    if (!text) return [];
    return [{ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text }] }];
  });
}

function geminiTools(context) {
  const declarations = (context.tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  return declarations.length ? [{ functionDeclarations: declarations }] : undefined;
}

function geminiUsage(metadata = {}) {
  const input = Number(metadata.promptTokenCount || 0);
  const output = Number(metadata.candidatesTokenCount || 0);
  return {
    input,
    output,
    cacheRead: Number(metadata.cachedContentTokenCount || 0),
    cacheWrite: 0,
    totalTokens: Number(metadata.totalTokenCount || input + output),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function geminiStopReason(value, content) {
  if ((content || []).some((part) => part?.functionCall)) return 'toolUse';
  if (/max|length/i.test(String(value || ''))) return 'length';
  return 'stop';
}

function streamGeminiCodeAssist(model, context, options = {}) {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    const output = {
      role: 'assistant', content: [], api: 'frakio-gemini-code-assist', provider: model.provider, model: model.id,
      usage: geminiUsage(), stopReason: 'pending', timestamp: Date.now(),
    };
    try {
      if (!options.apiKey) throw new Error('Gemini Code Assist 授权已失效，请重新授权。');
      const base = String(process.env.FRAKIO_WORK_GEMINI_CODE_ASSIST_URL || 'https://cloudcode-pa.googleapis.com/v1internal').replace(/\/+$/, '');
      const payload = {
        model: model.id,
        project: model.compat?.projectId,
        user_prompt_id: crypto.randomUUID(),
        request: {
          contents: geminiContents(context),
          ...(context.systemPrompt ? { systemInstruction: { parts: [{ text: context.systemPrompt }] } } : {}),
          ...(geminiTools(context) ? { tools: geminiTools(context) } : {}),
          generationConfig: { maxOutputTokens: options.maxTokens || model.maxTokens },
          session_id: options.sessionId || crypto.randomUUID(),
        },
      };
      const response = await fetch(`${base}:generateContent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'GeminiCLI/Frakio-Work' },
        body: JSON.stringify(payload), signal: options.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `Gemini Code Assist 请求失败（HTTP ${response.status}）。`);
      const candidate = body?.response?.candidates?.[0] || body?.candidates?.[0] || {};
      const parts = candidate?.content?.parts || body?.response?.content?.parts || [];
      output.responseId = body?.response?.responseId || body?.responseId || '';
      output.usage = geminiUsage(body?.response?.usageMetadata || body?.usageMetadata || {});
      stream.push({ type: 'start', partial: output });
      for (const part of parts) {
        if (part?.text !== undefined) {
          const contentIndex = output.content.length;
          const text = String(part.text || '');
          output.content.push({ type: 'text', text });
          stream.push({ type: 'text_start', contentIndex, partial: output });
          if (text) stream.push({ type: 'text_delta', contentIndex, delta: text, partial: output });
          stream.push({ type: 'text_end', contentIndex, content: text, partial: output });
        }
        if (part?.functionCall?.name) {
          const contentIndex = output.content.length;
          const toolCall = { type: 'toolCall', id: `gemini_${process.pid}_${++sequence}`, name: part.functionCall.name, arguments: part.functionCall.args || {} };
          output.content.push(toolCall);
          stream.push({ type: 'toolcall_start', contentIndex, partial: output });
          stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: output });
        }
      }
      output.stopReason = geminiStopReason(candidate.finishReason || body?.finishReason, parts);
      output.rawStopReason = candidate.finishReason || body?.finishReason || '';
      stream.push({ type: 'done', reason: output.stopReason, message: output });
    } catch (error) {
      output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = safeErrorMessage(error?.message || error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
    }
  })();
  return stream;
}

function requestTool(name, params, context) {
  const requestId = `pi_tool_${process.pid}_${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingToolCalls.delete(requestId);
      reject(new Error(`Frakio tool timed out: ${name}`));
    }, 30000);
    pendingToolCalls.set(requestId, { resolve, reject, timer });
    send({ type: 'tool.request', requestId, name, params, context });
  });
}

function requestCredential(operation, providerId, credential, accountId = '') {
  const requestId = `pi_credential_${process.pid}_${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCredentialCalls.delete(requestId);
      reject(new Error(`Frakio credential request timed out: ${operation}`));
    }, 30000);
    pendingCredentialCalls.set(requestId, { resolve, reject, timer });
    send({ type: 'credential.request', requestId, operation, providerId, credential, accountId });
  });
}

function frakioCredentialStore(expectedProviderId, accountId = '') {
  return {
    async read(providerId) {
      if (providerId !== expectedProviderId) return undefined;
      return requestCredential('read', providerId, undefined, accountId);
    },
    async list() {
      const credential = await requestCredential('read', expectedProviderId, undefined, accountId);
      return credential ? [{ providerId: expectedProviderId, type: credential.type }] : [];
    },
    async modify(providerId, fn) {
      if (providerId !== expectedProviderId) return undefined;
      const current = await requestCredential('read', providerId, undefined, accountId);
      const next = await fn(current);
      if (!next) return current;
      return requestCredential('write', providerId, next, accountId);
    },
    async delete(providerId) {
      if (providerId !== expectedProviderId) return;
      await requestCredential('delete', providerId, undefined, accountId);
    },
  };
}

const toolSchemas = {
  frakio_memory_search: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
  frakio_memory_propose: Type.Object({
    fact: Type.String(),
    scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('agent'), Type.Literal('workspace')])),
    confidence: Type.Optional(Type.Number()),
  }),
  frakio_knowledge_search: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
  frakio_knowledge_read: Type.Object({ path: Type.String() }),
  frakio_knowledge_draft_write: Type.Object({ path: Type.String(), content: Type.String() }),
  frakio_artifact_publish: Type.Object({ path: Type.String(), title: Type.Optional(Type.String()) }),
  frakio_task_get: Type.Object({ taskId: Type.Optional(Type.String()) }),
  frakio_task_update: Type.Object({ taskId: Type.String(), status: Type.String(), detail: Type.Optional(Type.String()) }),
  frakio_task_request_input: Type.Object({ taskId: Type.String(), question: Type.String() }),
  frakio_task_complete: Type.Object({ taskId: Type.String(), summary: Type.String() }),
};

function customTools(context) {
  return Object.entries(toolSchemas).map(([name, parameters]) => ({
    name,
    label: name.replace(/^frakio_/, '').replaceAll('_', ' '),
    description: `Use Frakio Work's canonical ${name.replace(/^frakio_/, '').replaceAll('_', ' ')} service.`,
    promptSnippet: `${name}: access Frakio Work state instead of creating a private copy.`,
    parameters,
    executionMode: name.includes('search') || name.includes('read') || name.includes('get') ? 'parallel' : 'sequential',
    async execute(_toolCallId, params) {
      try {
        const result = await requestTool(name, params, context);
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error.message || String(error) }],
          details: { error: error.message || String(error) },
          isError: true,
        };
      }
    },
  }));
}

function systemPrompt(snapshot, contextPacket) {
  const memory = Array.isArray(contextPacket?.memory) && contextPacket.memory.length
    ? contextPacket.memory.map((entry) => `- ${entry.fact}`).join('\n')
    : '- No portable long-term memory is relevant to this task.';
  const knowledge = Array.isArray(contextPacket?.knowledge) && contextPacket.knowledge.length
    ? contextPacket.knowledge.map((entry) => `- ${entry.relativePath}: ${entry.summary || ''}`).join('\n')
    : '- No project knowledge excerpt was selected.';
  return `You are ${snapshot.name}, a Frakio Work Agent.

Role: ${snapshot.role}
Soul and operating style:
${snapshot.soul || 'Use a precise, practical, collaborative style.'}

Responsibility:
${snapshot.scope || 'Complete the assigned task and report verifiable results.'}

User profile context:
${snapshot.userProfile || 'No additional user profile was provided.'}

Portable accepted memory:
${memory}

Relevant workspace knowledge:
${knowledge}

Frakio Work owns Agent identity, durable memory, project knowledge and task state. Use the frakio_* tools for those domains. Do not create a competing private memory or task board. Never expose hidden reasoning. Return concise user-facing results and publish durable work through the provided tools.`;
}

async function buildSession(message) {
  const context = {
    threadId: message.threadId,
    agentId: message.agentId,
    workspaceId: message.workspaceId || '',
    runId: message.runId,
    taskId: message.taskId || '',
    vaultId: message.vaultId || '',
  };
  const agentDir = path.resolve(message.agentDir);
  const sessionRoot = path.resolve(message.sessionRoot);
  const cwd = path.resolve(message.cwd);
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  const usesOAuth = message.model.authMode === 'oauth';
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
    ...(usesOAuth ? { credentials: frakioCredentialStore(message.model.providerId, message.model.oauthAccountId || '') } : {}),
  });
  const providerId = usesOAuth
    ? String(message.model.providerId || '')
    : `frakio-${String(message.model.providerId || 'custom').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const api = providerApi(message.model.apiMode);
  if (usesOAuth && providerId === 'frakio-gemini-code-assist') {
    modelRuntime.registerProvider(providerId, {
      name: 'Frakio Gemini Code Assist',
      baseUrl: message.model.baseUrl || 'https://cloudcode-pa.googleapis.com/v1internal',
      api: 'frakio-gemini-code-assist',
      streamSimple: streamGeminiCodeAssist,
      oauth: {
        name: 'Frakio Gemini Code Assist',
        async login() { throw new Error('请在 Frakio Model Center 完成 Gemini 授权。'); },
        async refreshToken(credentials) { return requestCredential('refresh', providerId, credentials, message.model.oauthAccountId || ''); },
        getApiKey(credentials) { return credentials.access; },
      },
      models: [{
        id: message.model.modelId,
        name: message.model.modelName || message.model.modelId,
        api: 'frakio-gemini-code-assist',
        baseUrl: message.model.baseUrl || 'https://cloudcode-pa.googleapis.com/v1internal',
        reasoning: false,
        input: ['text', 'image'],
        cost: message.model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: Number(message.model.contextWindow || 128000),
        maxTokens: Number(message.model.maxTokens || 8192),
        compat: { ...(message.model.compat || {}), projectId: message.model.geminiProjectId || '' },
      }],
    });
  }
  if (!usesOAuth) modelRuntime.registerProvider(providerId, {
    name: message.model.providerName || 'Frakio Model Center',
    baseUrl: message.model.baseUrl,
    api,
    authHeader: true,
    models: [{
      id: message.model.modelId,
      name: message.model.modelName || message.model.modelId,
      api,
      baseUrl: message.model.baseUrl,
      reasoning: Boolean(message.model.reasoning),
      thinkingLevelMap: message.model.thinkingLevelMap || undefined,
      input: ['text', 'image'],
      cost: message.model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Number(message.model.contextWindow || 128000),
      maxTokens: Number(message.model.maxTokens || 8192),
      compat: message.model.compat || undefined,
    }],
  });
  if (!usesOAuth && message.model.apiKey) await modelRuntime.setRuntimeApiKey(providerId, message.model.apiKey);
  const model = modelRuntime.getModel(providerId, message.model.modelId);
  if (!model) throw new Error(`Pi could not register model ${message.model.modelId}.`);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt(message.profileSnapshot, message.contextPacket),
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();
  const manager = message.sessionFile
    ? SessionManager.open(path.resolve(message.sessionFile))
    : SessionManager.create(cwd, sessionRoot);
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    thinkingLevel: thinkingLevel(message.thinkingLevel),
    modelRuntime,
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
    customTools: customTools(context),
    tools: message.permissionMode === 'off'
      ? ['read', 'grep', 'find', 'ls', ...Object.keys(toolSchemas)]
      : ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', ...Object.keys(toolSchemas)],
  });
  return { session, modelRuntime, context };
}

async function startRun(message) {
  let holder = sessions.get(message.sessionId);
  if (!holder) {
    holder = await buildSession(message);
    sessions.set(message.sessionId, holder);
  }
  holder.context.runId = message.runId;
  holder.context.taskId = message.taskId || '';
  holder.session.setThinkingLevel(thinkingLevel(message.thinkingLevel));
  let output = '';
  let lastAssistantMessage = null;
  let publishedArtifact = false;
  const unsubscribe = holder.session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const delta = String(event.assistantMessageEvent.delta || '');
      output += delta;
      send({ type: 'event', runId: message.runId, event: { type: 'message.delta', payload: { delta } } });
      return;
    }
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta') {
      send({ type: 'event', runId: message.runId, event: { type: 'reasoning.summary', payload: { delta: String(event.assistantMessageEvent.delta || '') } } });
      return;
    }
    if (event.type === 'tool_execution_start') {
      send({ type: 'event', runId: message.runId, event: { type: 'tool.started', payload: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args } } });
      return;
    }
    if (event.type === 'tool_execution_update') {
      send({ type: 'event', runId: message.runId, event: { type: 'tool.updated', payload: { toolCallId: event.toolCallId, toolName: event.toolName } } });
      return;
    }
    if (event.type === 'tool_execution_end') {
      if (!event.isError && event.toolName === 'frakio_artifact_publish') publishedArtifact = true;
      send({
        type: 'event',
        runId: message.runId,
        event: {
          type: 'tool.completed',
          payload: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: Boolean(event.isError),
            resultPreview: resultText(event.result).slice(0, 1000),
          },
        },
      });
      return;
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      lastAssistantMessage = event.message;
      if (!output) output = assistantText(event.message);
    }
  });
  send({
    type: 'run.accepted',
    requestId: message.requestId,
    runId: message.runId,
    sessionId: message.sessionId,
    nativeSessionId: holder.session.sessionId,
    sessionFile: holder.session.sessionFile || '',
  });
  try {
    await holder.session.prompt(message.prompt);
    await holder.session.waitForIdle();
    const finalMessage = lastAssistantMessage
      || [...holder.session.messages].reverse().find((item) => item?.role === 'assistant')
      || null;
    const stopReason = String(finalMessage?.stopReason || '');
    const finalError = safeErrorMessage(finalMessage?.errorMessage || '');
    if (stopReason === 'aborted') {
      send({ type: 'event', runId: message.runId, event: { type: 'run.cancelled', payload: { error: finalError || 'Pi 运行已取消。' } } });
      return;
    }
    if (stopReason === 'error' || finalMessage?.errorMessage) {
      send({ type: 'event', runId: message.runId, event: { type: 'run.failed', payload: { code: 'PI_MODEL_FAILED', error: finalError || 'Pi 模型请求失败。' } } });
      return;
    }
    if (!output.trim() && finalMessage) output = assistantText(finalMessage);
    if (!output.trim() && publishedArtifact) output = '已发布本次运行的成果。';
    if (!output.trim()) {
      send({ type: 'event', runId: message.runId, event: { type: 'run.failed', payload: { code: 'PI_EMPTY_RESPONSE', error: 'Pi 返回了空响应，请检查模型服务或重试。' } } });
      return;
    }
    send({ type: 'event', runId: message.runId, event: { type: 'run.completed', payload: { output } } });
  } catch (error) {
    const aborted = /abort/i.test(String(error?.message || error));
    send({
      type: 'event',
      runId: message.runId,
      event: { type: aborted ? 'run.cancelled' : 'run.failed', payload: { code: aborted ? 'PI_CANCELLED' : 'PI_RUN_FAILED', error: safeErrorMessage(error?.message || error), output } },
    });
  } finally {
    unsubscribe();
  }
}

process.on('message', (message) => {
  void (async () => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'run.start') {
      await startRun(message);
      return;
    }
    if (message.type === 'run.steer') {
      const holder = sessions.get(message.sessionId);
      if (!holder) throw new Error('Pi session is not active.');
      await holder.session.steer(String(message.message || ''));
      send({ type: 'response', requestId: message.requestId, result: { ok: true } });
      return;
    }
    if (message.type === 'run.cancel') {
      const holder = sessions.get(message.sessionId);
      if (holder) await holder.session.abort();
      send({ type: 'response', requestId: message.requestId, result: { ok: Boolean(holder) } });
      return;
    }
    if (message.type === 'session.dispose') {
      const holder = sessions.get(message.sessionId);
      holder?.session.dispose();
      sessions.delete(message.sessionId);
      send({ type: 'response', requestId: message.requestId, result: { ok: true } });
      return;
    }
    if (message.type === 'tool.response') {
      const pending = pendingToolCalls.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingToolCalls.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    }
    if (message.type === 'credential.response') {
      const pending = pendingCredentialCalls.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingCredentialCalls.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.credential);
    }
  })().catch((error) => {
    if (message?.requestId) send({ type: 'response', requestId: message.requestId, error: error.message || String(error) });
    else if (message?.runId) send({ type: 'event', runId: message.runId, event: { type: 'run.failed', payload: { error: error.message || String(error) } } });
  });
});

process.on('disconnect', () => {
  for (const holder of sessions.values()) holder.session.dispose();
  process.exit(0);
});

send({ type: 'ready', version: '0.83.0' });
