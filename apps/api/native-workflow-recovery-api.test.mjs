import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntimeStore } from './runtime/store.mjs';

test('startup recovery aborts stale native Runs and returns expired Tasks to ready once', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-native-recovery-'));
  const home = path.join(parent, '.frakio-work');
  const data = path.join(home, 'data');
  const databasePath = path.join(data, 'frakio.db');
  await mkdir(data, { recursive: true });
  const workflow = {
    id: 'workflow-recovery', name: 'Recovery workflow', boardSlug: '', nativeOnly: true, status: 'active',
    coordinatorAgentId: 'iris-recovery', fallbackDecisionAgentId: 'iris-recovery', rootTaskIds: ['task-recovery'], currentRootTaskId: 'task-recovery',
    planRevision: 1, plan: null, executionBindings: {}, interventionQueue: [], control: { state: 'idle' }, capability: { status: 'ready', protocolVersion: 1 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const state = {
    ui: { defaultAgentId: 'iris-recovery' },
    agents: [{ id: 'iris-recovery', name: 'Iris', role: 'Coordinator', source: 'frakio', runtimePolicy: { defaultRuntimeId: 'hermes', allowedRuntimeIds: ['hermes'] } }],
    threads: [{
      id: 'thread-recovery', title: 'Recovery thread', executionMode: 'chat', mode: 'direct', defaultAgentId: 'iris-recovery', activeAgentId: 'iris-recovery', selectedAgents: ['iris-recovery'],
      runStatus: 'running', activeRunId: 'native-run-recovery', activeSessionId: 'session-recovery', activeRunTurnId: 'turn-recovery',
      activeRunGroup: { turnId: 'turn-recovery', status: 'running', activeRuns: { 'native-run-recovery': { runId: 'native-run-recovery', status: 'running' } } },
      messages: [], planSessions: [], collaboration: { activeWorkflowId: workflow.id, workflows: [workflow], events: [], eventCursor: 0, idempotency: {} },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }],
  };
  await writeFile(path.join(data, 'workbench-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  const seed = createRuntimeStore(databasePath);
  seed.upsertCollaborationWorkflow({ id: workflow.id, conversationId: 'thread-recovery', coordinatorAgentId: 'iris-recovery', status: 'active', revision: 1, metadata: { nativeOnly: true } });
  seed.upsertWorkTask({
    id: 'task-recovery', workflowId: workflow.id, title: 'Recover me', assigneeAgentId: 'iris-recovery', runtimeId: 'hermes', status: 'running',
    leaseToken: 'expired-lease', leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(), idempotencyKey: 'recovery-task', metadata: { root: true, nativeOnly: true },
  });
  seed.upsertSession({ id: 'session-recovery', runtimeId: 'hermes', threadId: 'thread-recovery', agentId: 'iris-recovery', workspaceId: '', laneType: 'work_task', laneId: 'task-recovery', status: 'running' });
  seed.createRun({
    id: 'run-recovery', sessionId: 'session-recovery', runtimeId: 'hermes', threadId: 'thread-recovery', agentId: 'iris-recovery', turnId: 'turn-recovery',
    nativeRunId: 'native-run-recovery', status: 'running', metadata: { taskId: 'task-recovery', workflowId: workflow.id, taskDispatch: true },
  });
  seed.upsertWorkflowProposal({
    id: 'proposal-recovery', conversationId: 'thread-recovery', sourcePlanId: 'plan-recovery', revision: 2,
    status: 'pending_confirmation', title: 'Recovered proposal', summary: 'Wait for confirmation after restart.',
    content: { revision: 2, title: 'Recovered proposal', summary: 'Wait for confirmation after restart.', steps: [{ key: 'recover', title: 'Recover', description: 'Continue safely.', assigneeAgentId: 'iris-recovery', expectedResult: 'Recovered result', dependsOnKeys: [] }] },
    idempotencyKey: 'proposal-recovery-key',
  });
  seed.putCollaborationIntervention({
    id: 'intervention-recovery', workflowId: workflow.id, taskId: 'task-recovery', targetAgentId: 'iris-recovery',
    status: 'deferred_to_next_run', message: 'Keep this instruction after restart.', idempotencyKey: 'intervention-recovery-key',
  });
  seed.close();

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_RUNTIME_DB_PATH = databasePath;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?native-recovery=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await fetch(`${baseUrl}/api/threads/thread-recovery/collaboration`).then(response => response.json());
  const task = snapshot.snapshot.workflows[0].tasks.find(item => item.id === 'task-recovery');
  assert.equal(task.status, 'ready');
  assert.equal(snapshot.snapshot.events.filter(event => event.payload?.runId === 'run-recovery' && event.payload?.recovery === 'lease_expired').length, 1);
  assert.equal(snapshot.snapshot.proposals.find(item => item.id === 'proposal-recovery').status, 'pending_confirmation');
  assert.equal(snapshot.snapshot.workflows[0].interventionQueue.find(item => item.id === 'intervention-recovery').status, 'deferred_to_next_run');
  const recoveredThread = await fetch(`${baseUrl}/api/threads/thread-recovery`).then(response => response.json());
  assert.equal(recoveredThread.thread.runStatus, 'idle');
  assert.equal(recoveredThread.thread.activeRunId, '');
  assert.equal(recoveredThread.thread.activeRunTurnId, '');
  assert.equal(recoveredThread.thread.activeRunGroup.status, 'aborted');
  assert.deepEqual(recoveredThread.thread.activeRunGroup.activeRuns, {});
  const recoveredPlan = recoveredThread.thread.planSessions.find(item => item.id === 'plan-recovery');
  assert.equal(recoveredPlan.status, 'waiting_approval');
  assert.equal(recoveredThread.thread.activePlanId, recoveredPlan.id);
  assert.equal(recoveredThread.thread.collaborationMode, 'collaboration');

  const verification = createRuntimeStore(databasePath);
  assert.equal(verification.getRun('run-recovery').status, 'aborted');
  assert.equal(verification.getWorkTask('task-recovery').leaseToken, '');
  assert.equal(verification.getWorkTask('task-recovery').leaseExpiresAt, null);
  verification.close();
});

test('startup recovery accepts a completed Task Run with the matching lease instead of executing it twice', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-native-terminal-recovery-'));
  const home = path.join(parent, '.frakio-work');
  const data = path.join(home, 'data');
  const databasePath = path.join(data, 'frakio.db');
  await mkdir(data, { recursive: true });
  const createdAt = new Date().toISOString();
  const workflow = {
    id: 'workflow-terminal-recovery', name: 'Terminal recovery workflow', boardSlug: '', nativeOnly: true, status: 'active',
    coordinatorAgentId: 'iris-terminal', fallbackDecisionAgentId: 'iris-terminal', rootTaskIds: ['task-summary'], currentRootTaskId: 'task-summary',
    planRevision: 1, plan: null, executionBindings: {}, interventionQueue: [], control: { state: 'idle' }, capability: { status: 'ready', protocolVersion: 1 },
    taskStatusProjection: { 'task-worker': { status: 'running', title: 'Worker' }, 'task-summary': { status: 'waiting_dependency', title: 'Summary' } },
    createdAt, updatedAt: createdAt,
  };
  const state = {
    ui: { defaultAgentId: 'iris-terminal' },
    agents: [
      { id: 'worker-terminal', name: 'Worker', role: 'Worker', source: 'frakio', runtimePolicy: { defaultRuntimeId: 'pi', allowedRuntimeIds: ['pi'] } },
      { id: 'iris-terminal', name: 'Iris', role: 'Coordinator', source: 'frakio', runtimePolicy: { defaultRuntimeId: 'hermes', allowedRuntimeIds: ['hermes'] } },
    ],
    threads: [{
      id: 'thread-terminal-recovery', title: 'Terminal recovery thread', executionMode: 'chat', mode: 'direct', defaultAgentId: 'iris-terminal', activeAgentId: 'iris-terminal', selectedAgents: ['worker-terminal', 'iris-terminal'],
      runStatus: 'idle', activeWorkRuns: { 'run-terminal-recovery': { runId: 'run-terminal-recovery', taskId: 'task-worker', status: 'running' } }, messages: [], planSessions: [],
      collaboration: { activeWorkflowId: workflow.id, workflows: [workflow], events: [], eventCursor: 0, idempotency: {} }, createdAt, updatedAt: createdAt,
    }],
  };
  await writeFile(path.join(data, 'workbench-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  const seed = createRuntimeStore(databasePath);
  seed.upsertCollaborationWorkflow({ id: workflow.id, conversationId: 'thread-terminal-recovery', coordinatorAgentId: 'iris-terminal', status: 'active', revision: 1, metadata: { nativeOnly: true } });
  seed.upsertWorkTask({
    id: 'task-worker', workflowId: workflow.id, title: 'Worker', assigneeAgentId: 'worker-terminal', runtimeId: 'pi', status: 'running',
    leaseToken: 'terminal-lease', leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(), idempotencyKey: 'terminal-worker', metadata: { nativeOnly: true },
  });
  seed.upsertWorkTask({
    id: 'task-summary', workflowId: workflow.id, title: 'Summary', assigneeAgentId: 'iris-terminal', runtimeId: 'hermes', status: 'waiting_dependency',
    dependencies: ['task-worker'], idempotencyKey: 'terminal-summary', metadata: { root: true, nativeOnly: true },
  });
  seed.upsertSession({ id: 'session-terminal-recovery', runtimeId: 'pi', threadId: 'thread-terminal-recovery', agentId: 'worker-terminal', workspaceId: '', laneType: 'work_task', laneId: 'task-worker', status: 'active' });
  seed.createRun({
    id: 'run-terminal-recovery', sessionId: 'session-terminal-recovery', runtimeId: 'pi', threadId: 'thread-terminal-recovery', agentId: 'worker-terminal', turnId: 'turn-terminal-recovery',
    status: 'completed', completedAt: new Date().toISOString(), metadata: { taskId: 'task-worker', workflowId: workflow.id, taskDispatch: true, leaseToken: 'terminal-lease' },
  });
  seed.upsertRunPresentation({ runId: 'run-terminal-recovery', status: 'completed', phase: 'terminal', content: '已完成上游资料整理，供 Iris 汇总。' });
  seed.close();

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_RUNTIME_DB_PATH = databasePath;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?native-terminal-recovery=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const verification = createRuntimeStore(databasePath);
  assert.equal(verification.getWorkTask('task-worker').status, 'completed');
  assert.equal(verification.getWorkTask('task-worker').acceptanceState, 'accepted');
  assert.equal(verification.getWorkTask('task-worker').attempt, 0);
  assert.equal(verification.getWorkTask('task-summary').status, 'ready');
  assert.equal(verification.getTaskRunBinding('task-worker', 'run-terminal-recovery').leaseToken, 'terminal-lease');
  const completedEvents = verification.collaborationEventsAfter(workflow.id, 0).filter(event => event.type === 'task.completed' && event.taskId === 'task-worker');
  assert.equal(completedEvents.length, 1);
  assert.equal(completedEvents[0].runId, 'run-terminal-recovery');
  verification.close();

  const recoveredThread = await fetch(`http://127.0.0.1:${server.address().port}/api/threads/thread-terminal-recovery`).then(response => response.json());
  assert.deepEqual(recoveredThread.thread.activeWorkRuns, {});
});
