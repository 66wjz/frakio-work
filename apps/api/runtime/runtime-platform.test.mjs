import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRuntimeStore } from './store.mjs';
import { createMemoryLedger } from '../memory/ledger.mjs';
import { createKnowledgeGateway } from '../knowledge/gateway.mjs';
import { createRuntimeRegistry, normalizeRuntimePolicy, runtimeForAgent } from './registry.mjs';
import { createPiBridge } from './pi-bridge.mjs';
import { createWorkScheduler } from './work-scheduler.mjs';
import { createWorktreeManager } from './worktree-manager.mjs';
import { createCodexAppServerBridge } from './codex-app-server.mjs';
import { createClaudeAgentSdkBridge } from './claude-agent-sdk.mjs';

const execFileAsync = promisify(execFile);
const runtimeTestDirectory = path.dirname(fileURLToPath(import.meta.url));
const developmentPiRoot = path.resolve(runtimeTestDirectory, '../../..');
const bundledPiAvailable = await access(path.join(developmentPiRoot, 'node_modules/@earendil-works/pi-coding-agent/package.json')).then(() => true).catch(() => false);
const developmentPiBinding = { runtimeId: 'pi', runtimeVersion: '0.83.0', runtimeBuildId: 'pi-development-test', runtimeDir: developmentPiRoot, adapterProtocolVersion: 1 };

test('runtime store keeps separate native sessions for one Agent across runtimes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-store-'));
  const store = createRuntimeStore(path.join(root, 'frakio.db'));
  const hermes = store.upsertSession({ runtimeId: 'hermes', threadId: 'thread-1', agentId: 'ares', workspaceId: 'workspace-1', nativeSessionId: 'hermes-native' });
  const pi = store.upsertSession({ runtimeId: 'pi', threadId: 'thread-1', agentId: 'ares', workspaceId: 'workspace-1', nativeSessionId: 'pi-native' });
  assert.notEqual(hermes.id, pi.id);
  assert.equal(store.listSessions({ threadId: 'thread-1' }).length, 2);
  const run = store.createRun({ sessionId: pi.id, runtimeId: 'pi', threadId: 'thread-1', agentId: 'ares', turnId: 'turn-1', status: 'running' });
  assert.equal(store.appendEvent({ runId: run.id, type: 'run.started', payload: {} }).cursor, 1);
  assert.equal(store.appendEvent({ runId: run.id, type: 'message.delta', payload: { delta: 'hi' } }).cursor, 2);
  assert.deepEqual(store.eventsAfter(run.id, 1).map((event) => event.type), ['message.delta']);
  store.close();
});

test('Memory Ledger deduplicates candidates and only injects accepted valid facts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-memory-ledger-'));
  const store = createRuntimeStore(path.join(root, 'frakio.db'));
  const ledger = createMemoryLedger({ store });
  const first = ledger.propose({ scope: 'agent', subjectId: 'ares', fact: 'The user prefers concise status updates.', confidence: 0.6, provenance: [{ source: 'test' }] });
  const duplicate = ledger.propose({ scope: 'agent', subjectId: 'ares', fact: '  The user prefers concise status updates.  ', confidence: 0.8, provenance: [{ source: 'test-2' }] });
  assert.equal(first.id, duplicate.id);
  assert.equal(ledger.packet({ agentId: 'ares' }).length, 0);
  ledger.accept(first.id);
  assert.deepEqual(ledger.packet({ agentId: 'ares' }).map((entry) => entry.fact), ['The user prefers concise status updates.']);
  store.putMemory({ scope: 'workspace', subjectId: 'workspace-1', fact: 'Legacy project rule.', status: 'accepted' });
  assert.equal(store.migrateWorkspaceMemoryScopes([{ id: 'workspace-1', vaultId: 'vault-1' }]), 1);
  assert.deepEqual(store.listMemory({ scope: 'vault', subjectId: 'vault-1' }).map((entry) => entry.fact), ['Legacy project rule.']);
  store.close();
});

test('Knowledge Gateway writes run-owned drafts and publishes reviewed Markdown', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-knowledge-'));
  const store = createRuntimeStore(path.join(root, 'frakio.db'));
  const gateway = createKnowledgeGateway({ store });
  const workspace = { id: 'workspace-1' };
  const vault = { id: 'vault-1', path: path.join(root, 'vault'), kind: 'project', trustedRulePaths: ['FRAKIO.md'] };
  await gateway.initializeVault(vault);
  const draft = await gateway.draftWrite({ workspace, vault, runId: 'run-1', relativePath: 'research/result.md', content: '# Result\n\nVerified.' });
  assert.equal(draft.relativePath, '.frakio/drafts/run-1/research/result.md');
  const published = await gateway.publish({ workspace, vault, runId: 'run-1', draftPath: draft.relativePath });
  assert.equal(published.relativePath, '知识/research/result.md');
  assert.match(await readFile(path.join(vault.path, published.relativePath), 'utf8'), /Verified/);
  assert.equal(await readFile(path.join(vault.path, 'AGENTS.md'), 'utf8').catch(() => ''), '');
  await gateway.index(vault);
  assert.equal((await gateway.search(vault, 'Verified'))[0]?.relativePath, '知识/research/result.md');
  await assert.rejects(() => gateway.read(vault, '../outside.md'), /超出当前 Workspace Root/);
  store.close();
});

test('runtime policy keeps identity independent from runtime choice', () => {
  const policy = normalizeRuntimePolicy({ defaultRuntimeId: 'pi', allowedRuntimeIds: ['pi', 'hermes'], defaultModelByRuntime: { pi: 'legacy-model' } }, { hasHermesProfile: true });
  const agent = { id: 'ares', profileName: 'ares', runtimePolicy: policy };
  assert.equal('defaultModelByRuntime' in policy, false);
  assert.equal(runtimeForAgent(agent), 'pi');
  assert.equal(runtimeForAgent(agent, 'hermes'), 'hermes');
  assert.equal(runtimeForAgent(agent, 'codex'), 'pi');
});

test('runtime registry exposes stable cards before independent detection completes', async () => {
  let resolveHermes;
  const registry = createRuntimeRegistry({
    bindingStatus: async (runtimeId) => ({ activeBinding: runtimeId === 'pi' ? { runtimeVersion: '0.83.0', source: 'managed', availability: 'ready' } : null }),
    hermesStatus: () => new Promise((resolve) => { resolveHermes = resolve; }),
  });
  assert.deepEqual(registry.snapshot().map((runtime) => runtime.id), ['hermes', 'pi', 'codex', 'claude']);
  assert.equal(registry.snapshot().find((runtime) => runtime.id === 'pi').installation.status, 'checking');
  const pi = await registry.refresh('pi');
  assert.equal(pi.installation.status, 'ready');
  const hermes = registry.refresh('hermes');
  resolveHermes({ ready: true, version: '0.19.0' });
  assert.equal((await hermes).installation.status, 'ready');
});

test('Work scheduler promotes dependencies, enforces per-Agent concurrency, and recovers expired leases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-work-scheduler-'));
  const store = createRuntimeStore(path.join(root, 'frakio.db'));
  const workflowId = 'workflow-1';
  const first = store.upsertWorkTask({
    workflowId,
    title: 'First',
    assigneeAgentId: 'ares',
    runtimeId: 'pi',
    dependencies: [],
    status: 'ready',
    idempotencyKey: 'first',
  });
  const second = store.upsertWorkTask({
    workflowId,
    title: 'Second',
    assigneeAgentId: 'ares',
    runtimeId: 'pi',
    dependencies: [],
    status: 'ready',
    idempotencyKey: 'second',
  });
  const dependent = store.upsertWorkTask({
    workflowId,
    title: 'Dependent',
    assigneeAgentId: 'iris',
    runtimeId: 'hermes',
    dependencies: [first.id],
    status: 'blocked',
    idempotencyKey: 'dependent',
  });
  const scheduler = createWorkScheduler({ store, defaultConcurrency: 4, leaseMs: 30000 });
  assert.deepEqual(scheduler.runnable(workflowId).map((task) => task.id), [first.id]);
  const claimed = scheduler.claim(first.id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempt, 1);
  assert.equal(scheduler.runnable(workflowId).some((task) => task.id === second.id), false);
  store.upsertWorkTask({ ...claimed, status: 'completed', leaseExpiresAt: null, idempotencyKey: claimed.idempotencyKey });
  scheduler.reconcile(workflowId);
  assert.equal(store.getWorkTask(dependent.id).status, 'ready');
  const expired = scheduler.claim(second.id);
  store.upsertWorkTask({ ...expired, leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), idempotencyKey: expired.idempotencyKey });
  assert.deepEqual(scheduler.reconcile(workflowId).recovered.map((task) => task.id), [second.id]);
  assert.equal(store.getWorkTask(second.id).status, 'ready');
  store.close();
});

test('code task worktrees are isolated from the main repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-worktree-'));
  const repository = path.join(root, 'repository');
  await mkdir(repository, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: repository });
  await execFileAsync('git', ['config', 'user.email', 'frakio@example.invalid'], { cwd: repository });
  await execFileAsync('git', ['config', 'user.name', 'Frakio Test'], { cwd: repository });
  await writeFile(path.join(repository, 'README.md'), '# Main\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repository });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repository });
  const manager = createWorktreeManager({ root: path.join(root, 'worktrees'), execFile: execFileAsync });
  const created = await manager.create({ repositoryPath: repository, workspaceId: 'workspace-1', taskId: 'task-1' });
  await writeFile(path.join(created.worktreePath, 'README.md'), '# Task\n');
  assert.equal(await readFile(path.join(repository, 'README.md'), 'utf8'), '# Main\n');
  assert.equal(created.branch, 'frakio/task-task-1');
});

test('Pi Worker runs an installed SDK in isolation and emits canonical stream events', { skip: !bundledPiAvailable }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-pi-worker-'));
  const requestBodies = [];
  const provider = http.createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requestBodies.push(JSON.parse(body));
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-frakio',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'frakio-test',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Pi Worker' }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-frakio',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'frakio-test',
        choices: [{ index: 0, delta: { content: ' ready' }, finish_reason: 'stop' }],
      })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  provider.listen(0, '127.0.0.1');
  await new Promise((resolve) => provider.once('listening', resolve));
  t.after(() => provider.close());

  const bridge = createPiBridge({ runtimeBinding: developmentPiBinding, toolHandler: async () => ({ ok: true }) });
  t.after(() => bridge.close());
  const events = [];
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pi Worker did not finish.')), 20000);
    bridge.on('event', ({ runId, event }) => {
      if (runId !== 'run-pi-test') return;
      events.push(event);
      if (event.type === 'run.completed' || event.type === 'run.failed') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
  const accepted = await bridge.startRun({
    runId: 'run-pi-test',
    sessionId: 'session-pi-test',
    threadId: 'thread-pi-test',
    agentId: 'ares',
    workspaceId: 'workspace-pi-test',
    cwd: root,
    agentDir: path.join(root, 'agent'),
    sessionRoot: path.join(root, 'sessions'),
    profileSnapshot: {
      id: 'ares',
      name: 'Ares',
      role: 'Research Agent',
      soul: 'Be precise.',
      scope: 'Complete the assigned task.',
      userProfile: '',
      revision: 'revision-test',
    },
    contextPacket: { memory: [], knowledge: [] },
    model: {
      providerId: 'test',
      providerName: 'Test Provider',
      modelId: 'frakio-test',
      modelName: 'Frakio Test',
      apiMode: 'openai_chat',
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      apiKey: 'test-key',
      reasoning: true,
      compat: { thinkingFormat: 'openai', supportsReasoningEffort: true, thinkingLevelMap: { high: 'high' } },
      contextWindow: 32000,
      maxTokens: 2048,
    },
    thinkingLevel: 'off',
    permissionMode: 'off',
    prompt: 'Reply with the test phrase.',
  });
  assert.equal(accepted.nativeSessionId.length > 0, true);
  assert.equal(accepted.sessionFile.length > 0, true);
  const terminalEvent = await completed;
  assert.equal(terminalEvent.type, 'run.completed');
  assert.equal(terminalEvent.payload.output, 'Pi Worker ready');
  assert.equal(events.some((event) => event.type === 'message.delta'), true);
  assert.equal(requestBodies.some((body) => body.reasoning_effort === 'none'), false);
});

test('Pi Worker converts a provider model error into run.failed instead of an empty completion', { skip: !bundledPiAvailable }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-pi-worker-error-'));
  const provider = http.createServer((request, response) => {
    request.resume();
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'reasoning_effort is not supported' } }));
  });
  provider.listen(0, '127.0.0.1');
  await new Promise((resolve) => provider.once('listening', resolve));
  t.after(() => provider.close());

  const bridge = createPiBridge({ runtimeBinding: developmentPiBinding, toolHandler: async () => ({ ok: true }) });
  t.after(() => bridge.close());
  const events = [];
  const terminal = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pi Worker error was not surfaced.')), 20000);
    bridge.on('event', ({ runId, event }) => {
      if (runId !== 'run-pi-error') return;
      events.push(event);
      if (event.type === 'run.failed' || event.type === 'run.completed') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
  await bridge.startRun({
    runId: 'run-pi-error', sessionId: 'session-pi-error', threadId: 'thread-pi-error', agentId: 'ares', workspaceId: 'workspace-pi-error',
    cwd: root, agentDir: path.join(root, 'agent'), sessionRoot: path.join(root, 'sessions'),
    profileSnapshot: { id: 'ares', name: 'Ares', role: 'Research Agent', soul: 'Be precise.', scope: 'Complete the assigned task.', userProfile: '', revision: 'revision-test' },
    contextPacket: { memory: [], knowledge: [] },
    model: { providerId: 'test', providerName: 'Test Provider', modelId: 'frakio-test', modelName: 'Frakio Test', apiMode: 'chat_completions', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'test-key', reasoning: false, contextWindow: 32000, maxTokens: 2048 },
    thinkingLevel: 'off', permissionMode: 'off', prompt: 'Reply with the test phrase.',
  });
  const terminalEvent = await terminal;
  assert.equal(terminalEvent.type, 'run.failed');
  assert.equal(terminalEvent.payload.code, 'PI_MODEL_FAILED');
  assert.match(terminalEvent.payload.error, /reasoning_effort is not supported/);
  assert.equal(events.some((event) => event.type === 'run.completed'), false);
});

test('Pi Gemini Code Assist provider reads its OAuth credential through Frakio IPC and does not persist it', { skip: !bundledPiAvailable }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-pi-gemini-oauth-'));
  const requests = [];
  const provider = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(body || '{}') });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'Gemini shared OAuth ready' }] }, finishReason: 'STOP' }] } }));
  });
  provider.listen(0, '127.0.0.1');
  await new Promise((resolve) => provider.once('listening', resolve));
  t.after(() => provider.close());
  const bridge = createPiBridge({
    runtimeBinding: developmentPiBinding,
    env: { FRAKIO_WORK_GEMINI_CODE_ASSIST_URL: `http://127.0.0.1:${provider.address().port}/v1internal` },
    toolHandler: async () => ({ ok: true }),
    credentialHandler: async (operation, providerId) => {
      assert.equal(providerId, 'frakio-gemini-code-assist');
      assert.equal(operation, 'read');
      return { type: 'oauth', access: 'gemini-frakio-token', refresh: 'refresh-token', expires: Date.now() + 3600000 };
    },
  });
  t.after(() => bridge.close());
  const terminal = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pi Gemini OAuth Worker did not finish.')), 20000);
    bridge.on('event', ({ runId, event }) => {
      if (runId !== 'run-pi-gemini-oauth') return;
      if (event.type === 'run.completed' || event.type === 'run.failed') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
  const agentDir = path.join(root, 'agent');
  await bridge.startRun({
    runId: 'run-pi-gemini-oauth', sessionId: 'session-pi-gemini-oauth', threadId: 'thread-pi-gemini-oauth', agentId: 'ares', workspaceId: 'workspace-pi-gemini-oauth',
    cwd: root, agentDir, sessionRoot: path.join(root, 'sessions'),
    profileSnapshot: { id: 'ares', name: 'Ares', role: 'Research Agent', soul: 'Be precise.', scope: 'Complete the assigned task.', userProfile: '', revision: 'revision-test' },
    contextPacket: { memory: [], knowledge: [] },
    model: { providerId: 'frakio-gemini-code-assist', providerName: 'Gemini Code Assist', modelId: 'gemini-test', modelName: 'Gemini Test', authMode: 'oauth', apiMode: 'chat_completions', geminiProjectId: 'project-test', reasoning: false, contextWindow: 32000, maxTokens: 2048 },
    thinkingLevel: 'off', permissionMode: 'off', prompt: 'Reply with the test phrase.',
  });
  const result = await terminal;
  assert.equal(result.type, 'run.completed');
  assert.equal(result.payload.output, 'Gemini shared OAuth ready');
  assert.equal(requests[0].headers.authorization, 'Bearer gemini-frakio-token');
  assert.equal(requests[0].body.project, 'project-test');
  await assert.rejects(() => readFile(path.join(agentDir, 'auth.json'), 'utf8'), /ENOENT/);
});

test('Codex channel uses app-server JSON-RPC and preserves the native thread id', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-codex-bridge-'));
  const bridge = createCodexAppServerBridge({
    runtimeHomeRoot: path.join(root, 'codex-home'),
    commandArgsFactory: () => [path.join(runtimeTestDirectory, 'fixtures', 'fake-codex-app-server.mjs')],
  });
  t.after(() => bridge.close());
  const events = [];
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Codex fake turn did not finish.')), 5000);
    bridge.on('event', ({ runId, event }) => {
      if (runId !== 'codex-run-test') return;
      events.push(event);
      if (event.type === 'run.completed') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
  const accepted = await bridge.startRun({
    runId: 'codex-run-test',
    sessionId: 'codex-session-test',
    cwd: root,
    model: 'fake-codex-model',
    permissionMode: 'off',
    profileSnapshot: { name: 'Ares', role: 'Engineer', soul: 'Be precise.', scope: 'Finish the task.' },
    contextPacket: { memory: [], knowledge: [] },
    prompt: 'Reply with the test phrase.',
    runtimeBinding: { runtimeVersion: '1.0.0', runtimeBuildId: 'codex-test-build', executablePath: process.execPath },
    executionRealm: { revision: 'codex-test-realm' },
    launchSpec: { baseUrl: 'http://127.0.0.1:8787/frakio', token: 'realm-token', modelId: 'fake-codex-model' },
  });
  assert.equal(accepted.nativeSessionId, 'codex-thread-1');
  const terminal = await completed;
  assert.equal(terminal.payload.output, 'Codex ready');
  assert.equal(events.some((event) => event.type === 'message.delta'), true);
});

test('Claude channel uses an isolated Agent SDK realm and canonical stream events', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-claude-bridge-'));
  let capturedOptions;
  const queryFactory = ({ options }) => {
    capturedOptions = options;
    const generator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-1' };
      yield {
        type: 'stream_event',
        session_id: 'claude-session-1',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Claude ready' } },
      };
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'claude-session-1',
        is_error: false,
        result: 'Claude ready',
        duration_ms: 12,
        total_cost_usd: 0,
      };
    })();
    generator.interrupt = async () => {};
    generator.close = () => {};
    return generator;
  };
  const bridge = createClaudeAgentSdkBridge({
    runtimeHomeRoot: path.join(root, 'claude-home'),
    queryFactory,
  });
  t.after(() => bridge.close());
  const events = [];
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Claude fake run did not finish.')), 5000);
    bridge.on('event', ({ runId, event }) => {
      if (runId !== 'claude-run-test') return;
      events.push(event);
      if (event.type === 'run.completed') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
  const accepted = await bridge.startRun({
    runId: 'claude-run-test',
    sessionId: 'claude-frakio-session',
    cwd: root,
    permissionMode: 'off',
    profileSnapshot: { name: 'Ares', role: 'Engineer', soul: 'Be precise.', scope: 'Finish the task.' },
    contextPacket: { memory: [], knowledge: [] },
    prompt: 'Reply with the test phrase.',
    model: 'claude-test',
    runtimeBinding: { runtimeVersion: '2.1.0', runtimeBuildId: 'claude-test-build', executablePath: process.execPath },
    executionRealm: { revision: 'claude-test-realm' },
    launchSpec: { baseUrl: 'http://127.0.0.1:8787/frakio', token: 'realm-token', modelId: 'claude-test' },
  });
  assert.equal(accepted.nativeSessionId, 'claude-session-1');
  const terminal = await completed;
  assert.equal(terminal.payload.output, 'Claude ready');
  assert.equal(events.some((event) => event.type === 'message.delta'), true);
  assert.deepEqual(capturedOptions.settingSources, []);
  assert.equal(capturedOptions.env.CLAUDE_CONFIG_DIR, path.join(root, 'claude-home', 'claude-test-realm'));
  assert.equal(capturedOptions.env.ANTHROPIC_AUTH_TOKEN, 'realm-token');
});

test('Claude channel preserves the Provider failure returned by the SDK', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-claude-failure-'));
  const queryFactory = () => {
    const generator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-failed' };
      yield { type: 'result', subtype: 'error_during_execution', session_id: 'claude-session-failed', is_error: true, result: 'Provider rejected the request.' };
    })();
    generator.interrupt = async () => {};
    generator.close = () => {};
    return generator;
  };
  const bridge = createClaudeAgentSdkBridge({ runtimeHomeRoot: path.join(root, 'claude-home'), queryFactory });
  t.after(() => bridge.close());
  const terminal = new Promise((resolve) => bridge.on('event', ({ event }) => {
    if (event.type === 'run.failed') resolve(event);
  }));
  await bridge.startRun({
    runId: 'claude-run-failed', sessionId: 'claude-frakio-failed', cwd: root, permissionMode: 'manual',
    profileSnapshot: { name: 'Victor', role: 'Engineer' }, contextPacket: { memory: [], knowledge: [] }, prompt: 'Hello', model: 'claude-test',
    runtimeBinding: { executablePath: process.execPath }, executionRealm: { revision: 'claude-failed-realm' },
    launchSpec: { baseUrl: 'http://127.0.0.1:8787/frakio', token: 'realm-token', modelId: 'claude-test' },
  });
  assert.equal((await terminal).payload.error, 'Provider rejected the request.');
});
