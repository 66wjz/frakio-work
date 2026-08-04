import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { normalizeRuntimeAdapter } from './adapter-contract.mjs';
import { compileContextDelta, contextPacketForAdapter } from './context-compiler.mjs';
import { decideToolIntent, permissionPolicySnapshot } from './permission-broker.mjs';
import { createRuntimePlatform } from './platform.mjs';
import { createRuntimeHostController } from './host-controller.mjs';
import { createRuntimeExecutionRealm } from './execution-realm.mjs';
import { resolveSkillSet } from './skill-projector.mjs';
import { createRuntimeStore } from './store.mjs';

async function storeFixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { root, store: createRuntimeStore(path.join(root, 'frakio.db')) };
}

test('Session V2 isolates chat and parallel work-task lanes', async (t) => {
  const { store } = await storeFixture('frakio-runtime-lanes-');
  t.after(() => store.close());
  const shared = { runtimeId: 'codex', threadId: 'thread-1', agentId: 'iris', workspaceId: 'workspace-1' };
  const chat = store.upsertSession({ ...shared, laneType: 'chat', laneId: 'thread-1', nativeSessionId: 'native-chat' });
  const taskA = store.upsertSession({ ...shared, laneType: 'work_task', laneId: 'task-a', worktreeId: 'tree-a', nativeSessionId: 'native-a' });
  const taskB = store.upsertSession({ ...shared, laneType: 'work_task', laneId: 'task-b', worktreeId: 'tree-b', nativeSessionId: 'native-b' });

  assert.equal(new Set([chat.id, taskA.id, taskB.id]).size, 3);
  assert.equal(store.findSession({ ...shared, laneType: 'work_task', laneId: 'task-a' }).nativeSessionId, 'native-a');
  assert.deepEqual(store.listSessions({ threadId: 'thread-1' }).map((item) => item.laneId).sort(), ['task-a', 'task-b', 'thread-1']);
});

test('Runtime Adapter contract is complete and reports unsupported capabilities structurally', async () => {
  const adapter = normalizeRuntimeAdapter('example', {});
  for (const method of ['probe', 'startRun', 'steer', 'cancel', 'resolveApproval', 'disposeSession', 'closeRealm']) {
    assert.equal(typeof adapter[method], 'function');
  }
  assert.deepEqual(await adapter.run({}), { status: 'unsupported', capability: 'run' });
  assert.deepEqual(await adapter.resume({}), { status: 'unsupported', capability: 'resume' });
});

test('Runtime Host Controller creates the Host Run before starting the native runtime', async (t) => {
  const { store } = await storeFixture('frakio-host-controller-');
  t.after(() => store.close());
  let observedStartingRun = null;
  const adapter = {
    async startRun(input) {
      observedStartingRun = store.getRun(input.runId);
      return { nativeRunId: 'native-run', nativeSessionId: 'native-session', nativeTurnId: 'native-turn' };
    },
  };
  const registry = {
    get: () => ({ id: 'hermes', capabilities: { streaming: true, tools: true, approvals: true } }),
    detect: async () => ({ status: 'ready', installed: true, version: '1.0.0', checkedAt: new Date().toISOString() }),
  };
  const platform = createRuntimePlatform({
    store, registry, adapters: new Map([['hermes', adapter]]),
    contextFactory: async () => ({ memory: [], handoff: { recentConversation: [] } }), skillResolver: async () => ({}),
  });
  const controller = createRuntimeHostController({ platform, store });
  const hosted = await controller.begin({
    state: { features: {} }, threadId: 'thread-host', thread: { id: 'thread-host' },
    agent: { id: 'agent-host', runtimePolicy: {} }, runtimeId: 'hermes', workspace: null,
    profileSnapshot: { revision: 'profile-host' }, message: 'hello', permissionMode: 'smart',
    modelRoute: { routeRevision: 'route-host', providerCredentialRevision: 'credential-host', modelId: 'model-host' },
  }, { turnId: 'turn-host', modelId: 'model-host' });
  assert.equal(hosted.run.status, 'queued');
  assert.match(hosted.run.id, /^runtime_run_/);
  const started = await controller.dispatch(hosted.prepared, hosted.run, { prompt: 'hello' });
  assert.equal(observedStartingRun.status, 'queued');
  assert.equal(started.run.nativeRunId, 'native-run');
  assert.equal(started.run.nativeTurnId, 'native-turn');
});

test('Host interruption is durable before a native Run ID exists and terminal state is single-writer', async (t) => {
  const { store } = await storeFixture('frakio-host-interrupt-');
  t.after(() => store.close());
  let cancelled = 0;
  const adapter = { cancel: async () => { cancelled += 1; } };
  const registry = {
    get: () => ({ id: 'hermes', capabilities: { streaming: true, tools: true, approvals: true } }),
    detect: async () => ({ status: 'ready', installed: true, version: '1.0.0', checkedAt: new Date().toISOString() }),
  };
  const platform = createRuntimePlatform({
    store, registry, adapters: new Map([['hermes', adapter]]),
    contextFactory: async () => ({ memory: [], handoff: { recentConversation: [] } }), skillResolver: async () => ({}),
  });
  const controller = createRuntimeHostController({ platform, store });
  const hosted = await controller.begin({
    state: { features: {} }, threadId: 'thread-stop', thread: { id: 'thread-stop' },
    agent: { id: 'agent-stop', runtimePolicy: {} }, runtimeId: 'hermes', workspace: null,
    profileSnapshot: { revision: 'profile-stop' }, message: 'hello', permissionMode: 'smart',
    modelRoute: { routeRevision: 'route-stop', providerCredentialRevision: 'credential-stop', modelId: 'model-stop' },
  }, { turnId: 'turn-stop', modelId: 'model-stop' });
  const interrupted = await controller.interrupt(hosted.run.id, { timeoutMs: 25 });
  assert.equal(interrupted.status, 'interrupting');
  assert.equal(interrupted.stopRequestedAt !== null, true);
  const first = controller.finish(hosted.run.id, 'cancelled');
  const second = controller.finish(hosted.run.id, 'failed', { error: 'late native failure' });
  assert.equal(first.status, 'cancelled');
  assert.equal(second.status, 'cancelled');
  assert.equal(cancelled, 1);
  assert.equal(store.eventsAfter(hosted.run.id).filter((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).length, 1);
});

test('Execution Realm changes when Provider credentials or Runtime Build changes', () => {
  const input = { runtimeId: 'codex', runtimeBinding: { runtimeBuildId: 'build-a' }, modelRoute: { providerId: 'provider-a', credentialRevision: 'credential-a' }, agentId: 'agent-a', skillSetRevision: 'skills-a', runtimeConfigRevision: 'config-a' };
  const first = createRuntimeExecutionRealm(input);
  const credentialChanged = createRuntimeExecutionRealm({ ...input, modelRoute: { ...input.modelRoute, credentialRevision: 'credential-b' } });
  const buildChanged = createRuntimeExecutionRealm({ ...input, runtimeBinding: { runtimeBuildId: 'build-b' } });
  assert.notEqual(first.revision, credentialChanged.revision);
  assert.notEqual(first.revision, buildChanged.revision);
});

test('Context Delta only projects sources added after the applied watermark', () => {
  const firstPacket = {
    memory: [{ id: 'memory-a', updatedAt: '1', fact: 'A' }],
    projectKnowledge: [{ relativePath: 'guide.md', updatedAt: '1', content: 'v1' }],
    handoff: { recentConversation: [{ messageId: 'message-a', content: 'hello' }], acceptedDecisions: [] },
  };
  const first = compileContextDelta(firstPacket, null, { profileRevision: 'profile-1' });
  const session = {
    contextWatermark: first.toWatermark,
    profileRevision: 'profile-1',
    metadata: { contextSourceIds: first.sourceIds },
  };
  const secondPacket = {
    ...firstPacket,
    memory: [...firstPacket.memory, { id: 'memory-b', updatedAt: '1', fact: 'B' }],
    handoff: { recentConversation: [...firstPacket.handoff.recentConversation, { messageId: 'message-b', content: 'next' }], acceptedDecisions: [] },
  };
  const second = compileContextDelta(secondPacket, session, { profileRevision: 'profile-1' });
  const projected = contextPacketForAdapter(second, secondPacket);

  assert.equal(first.full, true);
  assert.equal(second.full, false);
  assert.deepEqual(projected.memory.map((item) => item.id), ['memory-b']);
  assert.deepEqual(projected.projectKnowledge, []);
  assert.deepEqual(projected.handoff.recentConversation.map((item) => item.messageId), ['message-b']);
});

test('Permission Broker preserves product semantics and hard boundaries', () => {
  const command = { category: 'command', action: 'shell', mutating: true, target: '/workspace' };
  assert.equal(decideToolIntent(command, permissionPolicySnapshot({ mode: 'manual' })).decision, 'ask');
  assert.equal(decideToolIntent(command, permissionPolicySnapshot({ mode: 'smart' })).decision, 'ask');
  assert.equal(decideToolIntent(command, permissionPolicySnapshot({ mode: 'off' })).decision, 'allow');
  assert.equal(decideToolIntent({ category: 'payment', action: 'pay' }, permissionPolicySnapshot({ mode: 'off' })).decision, 'ask');
  assert.equal(decideToolIntent(command, permissionPolicySnapshot({ mode: 'off', planMode: true })).decision, 'deny');
});

test('Event Journal storage deduplicates retried native events', async (t) => {
  const { store } = await storeFixture('frakio-runtime-events-');
  t.after(() => store.close());
  const session = store.upsertSession({ runtimeId: 'pi', threadId: 'thread-1', agentId: 'iris', laneType: 'chat', laneId: 'thread-1' });
  const run = store.createRun({ sessionId: session.id, runtimeId: 'pi', threadId: 'thread-1', agentId: 'iris', turnId: 'turn-1' });
  const first = store.appendEvent({ runId: run.id, nativeEventKey: 'native-1', type: 'message.delta', payload: { delta: 'A' } });
  const duplicate = store.appendEvent({ runId: run.id, nativeEventKey: 'native-1', type: 'message.delta', payload: { delta: 'A' } });
  const next = store.appendEvent({ runId: run.id, nativeEventKey: 'native-2', type: 'run.completed', payload: {} });

  assert.equal(first.id, duplicate.id);
  assert.equal(next.cursor, 2);
  assert.equal(store.eventsAfter(run.id).length, 2);
  assert.deepEqual(store.getRunPresentation(run.id), {
    runId: run.id,
    revision: 2,
    lastCursor: 2,
    status: 'completed',
    phase: 'opening',
    content: 'A',
    activityGroups: [],
    approval: null,
    clarification: null,
    compaction: null,
    error: '',
    updatedAt: next.createdAt,
  });
});

test('approval presentation exposes one normalized identifier after native replay', async (t) => {
  const { store } = await storeFixture('frakio-runtime-approval-presentation-');
  t.after(() => store.close());
  const session = store.upsertSession({ runtimeId: 'hermes', threadId: 'thread-approval', agentId: 'iris', laneType: 'chat', laneId: 'thread-approval' });
  const run = store.createRun({ sessionId: session.id, runtimeId: 'hermes', threadId: 'thread-approval', agentId: 'iris', turnId: 'turn-approval' });
  const first = store.appendEvent({ runId: run.id, nativeEventKey: 'approval-native-1', type: 'approval.requested', payload: { approval_id: 'approval-1', title: '允许命令' } });
  const duplicate = store.appendEvent({ runId: run.id, nativeEventKey: 'approval-native-1', type: 'approval.requested', payload: { approval_id: 'approval-1', title: '允许命令' } });
  const presentation = store.getRunPresentation(run.id);

  assert.equal(first.id, duplicate.id);
  assert.equal(presentation.revision, 1);
  assert.equal(presentation.approval.id, 'approval-1');
  assert.equal(presentation.approval.approvalId, 'approval-1');
});

test('restart recovery trusts adapter inspection and Host Controller owns terminal state', async (t) => {
  const { store } = await storeFixture('frakio-runtime-restart-');
  t.after(() => store.close());
  const session = store.upsertSession({ runtimeId: 'hermes', threadId: 'thread-restart', agentId: 'iris', laneType: 'chat', laneId: 'thread-restart', nativeSessionId: 'native-session' });
  const running = store.createRun({ sessionId: session.id, runtimeId: 'hermes', threadId: 'thread-restart', agentId: 'iris', turnId: 'turn-running', nativeRunId: 'native-running', status: 'running' });
  const missing = store.createRun({ sessionId: session.id, runtimeId: 'codex', threadId: 'thread-restart-2', agentId: 'iris', turnId: 'turn-missing', nativeRunId: 'native-missing', status: 'running' });
  const registry = { get: (id) => ({ id, capabilities: {} }), detect: async () => ({ installed: true, status: 'ready', checkedAt: new Date().toISOString() }) };
  const platform = createRuntimePlatform({
    store, registry,
    adapters: new Map([
      ['hermes', { inspectRun: async () => ({ status: 'running' }) }],
      ['codex', { inspectRun: async () => ({ status: 'missing' }) }],
    ]),
    contextFactory: async () => ({ memory: [], handoff: {} }),
  });
  const controller = createRuntimeHostController({ platform, store });
  await controller.reconcileAfterRestart();
  assert.equal(store.getRun(running.id).status, 'running');
  assert.equal(store.getRun(missing.id).status, 'failed');
  assert.equal(store.getRun(missing.id).metadata.errorCode, 'HOST_RESTART_INTERRUPTED');
  assert.equal(store.eventsAfter(missing.id).filter((event) => event.type === 'run.failed').length, 1);
});

test('Runtime Platform falls back within the selected runtime when native resume fails', async (t) => {
  const { store } = await storeFixture('frakio-runtime-fallback-');
  t.after(() => store.close());
  store.upsertSession({
    runtimeId: 'codex', threadId: 'thread-1', agentId: 'iris', workspaceId: 'workspace-1',
    laneType: 'chat', laneId: 'thread-1', nativeSessionId: 'missing-native', profileRevision: 'profile-1',
  });
  const calls = [];
  const adapter = {
    async startRun(input) {
      calls.push(input);
      if (input.nativeSessionId) throw new Error('native session not found');
      return { nativeSessionId: 'replacement-native', nativeTurnId: 'native-turn-2' };
    },
    async disposeSession() {},
  };
  const runtime = { id: 'codex', capabilities: { streaming: true, tools: true, approvals: true } };
  const registry = {
    get(id) { return id === 'codex' ? runtime : null; },
    async detect() { return { installed: true, status: 'ready', checkedAt: new Date().toISOString(), version: '1.0.0' }; },
  };
  const platform = createRuntimePlatform({
    store,
    registry,
    adapters: new Map([['codex', adapter]]),
    contextFactory: async () => ({
      memory: [{ id: 'memory-a', updatedAt: '1', fact: 'Accepted fact' }],
      handoff: { recentConversation: [{ messageId: 'message-a', content: 'Earlier context' }], acceptedDecisions: [] },
    }),
    skillResolver: async () => ({}),
  });
  const prepared = await platform.prepare({
    runtimeId: 'codex', threadId: 'thread-1', agent: { id: 'iris', runtimePolicy: {} }, workspace: { id: 'workspace-1' },
    profileSnapshot: { revision: 'profile-1' }, permissionMode: 'smart',
  });
  const run = platform.createRun(prepared, { id: 'run-1', turnId: 'turn-1' });
  const accepted = await platform.dispatch(prepared, run, { message: 'Continue' });
  const active = platform.markStarted(prepared, run, accepted);
  store.updateRun(run.id, { status: 'completed' });
  const receipt = platform.receipt(run.id, { status: 'completed' });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].nativeSessionId, '');
  assert.equal(calls[1].contextPacket.contextDelta.full, true);
  assert.equal(active.nativeSessionId, 'replacement-native');
  assert.equal(receipt.resumeStrategy, 'handoff_resumed');
  assert.deepEqual(receipt.memoryEntryIds, ['memory-a']);
  assert.deepEqual(store.eventsAfter(run.id).map((item) => item.type), [
    'run.accepted', 'permission.coverage_changed', 'session.resume_started', 'session.resume_failed', 'session.recovered', 'session.resumed', 'context.delta_applied',
  ]);
});

test('a changed projected Skill opens a fresh native session before becoming applied', async (t) => {
  const { store } = await storeFixture('frakio-runtime-skill-restart-');
  t.after(() => store.close());
  store.upsertSession({
    runtimeId: 'codex', threadId: 'thread-1', agentId: 'iris', workspaceId: 'workspace-1', laneType: 'chat', laneId: 'thread-1',
    nativeSessionId: 'old-native', profileRevision: 'profile-1', skillSetRevision: 'old-skill-revision', checkpoint: { nativeTurnId: 'old-turn' },
  });
  let disposed = false;
  const adapter = {
    skillHotReload: false,
    async disposeSession() { disposed = true; },
    async applySkills({ skills }) { return { applications: skills.map((skill) => ({ skillId: skill.id, status: 'projecting', loadMethod: 'test_projection' })) }; },
    async startRun(input) {
      assert.equal(input.nativeSessionId, '');
      return { nativeSessionId: 'new-native', nativeTurnId: 'new-turn' };
    },
  };
  const registry = {
    get() { return { id: 'codex', capabilities: { tools: true, approvals: true } }; },
    async detect() { return { installed: true, status: 'ready', checkedAt: new Date().toISOString() }; },
  };
  const platform = createRuntimePlatform({ store, registry, adapters: new Map([['codex', adapter]]), contextFactory: async () => ({ memory: [], handoff: {} }) });
  const skillSet = resolveSkillSet({ teamSkills: [{ id: 'research', name: 'Research', version: '2', contentHash: 'new', scope: 'team' }] });
  const prepared = await platform.prepare({
    runtimeId: 'codex', threadId: 'thread-1', agent: { id: 'iris', runtimePolicy: {} }, workspace: { id: 'workspace-1' },
    profileSnapshot: { revision: 'profile-1' }, permissionMode: 'smart', skillSet, requiredSkillIds: ['research'],
  });
  assert.equal(disposed, true);
  assert.equal(prepared.session.nativeSessionId, '');
  assert.equal(prepared.handoffCandidate, true);
  assert.equal(prepared.skillApplications[0].status, 'projecting');
  const run = platform.createRun(prepared, { id: 'run-skill', turnId: 'turn-skill' });
  const accepted = await platform.dispatch(prepared, run, {});
  platform.markStarted(prepared, run, accepted);
  assert.equal(store.listSkillApplications({ sessionId: prepared.session.id })[0].status, 'applied');
  assert.equal(store.getSession(prepared.session.id).resumeStrategy, 'handoff_resumed');
});

test('Skill resolution respects scope precedence and rejects same-scope content conflicts', () => {
  const team = { id: 'research', version: '1', contentHash: 'team', scope: 'team' };
  const workspace = { id: 'research', version: '2', contentHash: 'workspace', scope: 'workspace' };
  const agent = { id: 'research', version: '3', contentHash: 'agent', scope: 'agent' };
  const task = { id: 'research', version: '4', contentHash: 'task', scope: 'task' };
  assert.equal(resolveSkillSet({ teamSkills: [team], workspaceSkills: [workspace], agentSkills: [agent], taskSkills: [task] }).skills[0].version, '4');
  assert.throws(() => resolveSkillSet({ teamSkills: [team, { ...team, version: '2', contentHash: 'other' }] }), { code: 'SKILL_CONTENT_CONFLICT' });
});

test('schema v4 sessions migrate idempotently into chat lanes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-migration-'));
  const file = path.join(root, 'frakio.db');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE runtime_sessions (
      id TEXT PRIMARY KEY, runtime_id TEXT NOT NULL, thread_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '', native_session_id TEXT NOT NULL DEFAULT '', profile_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(thread_id, agent_id, runtime_id, workspace_id)
    );
    CREATE TABLE runtime_runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, runtime_id TEXT NOT NULL, thread_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      turn_id TEXT NOT NULL, profile_revision TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE runtime_events (
      id TEXT PRIMARY KEY, cursor INTEGER NOT NULL, run_id TEXT NOT NULL, session_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
      type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(run_id, cursor)
    );
    INSERT INTO runtime_sessions VALUES ('legacy-session', 'hermes', 'thread-1', 'iris', 'workspace-1', 'native-1', 'profile-1', 'active', '{}', '2026-01-01', '2026-01-01');
  `);
  legacy.close();

  const migrated = createRuntimeStore(file);
  assert.equal(migrated.schemaVersion, 12);
  assert.ok(migrated.migrationBackupPath);
  await access(migrated.migrationBackupPath);
  assert.equal(migrated.getSession('legacy-session').laneType, 'chat');
  assert.equal(migrated.getSession('legacy-session').laneId, 'thread-1');
  assert.equal(migrated.getSession('legacy-session').lifecycleState, 'recovering');
  migrated.close();

  const reopened = createRuntimeStore(file);
  assert.equal(reopened.listSessions().length, 1);
  reopened.close();
});
