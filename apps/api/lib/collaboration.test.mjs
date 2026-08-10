import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COLLABORATION_DEPENDENCY_DEPTH,
  MAX_COLLABORATION_EVENT_BYTES,
  MAX_COLLABORATION_TASKS,
  appendCollaborationEvent,
  assertCollaborationGraphLimits,
  boardLifecycle,
  collaborationEventsAfter,
  collaborationRunStatus,
  collaborationSchedulerKind,
  diffCollaborationPlans,
  normalizeThreadCollaboration,
  runtimeTaskTerminalWriteAllowed,
  taskStatusEvent,
  validateCollaborationPlan,
} from './collaboration.mjs';

test('collaboration events use monotonic cursors and support replay filters', () => {
  const collaboration = normalizeThreadCollaboration({ workflows: [{ id: 'wf-1', boardSlug: 'launch' }] });
  appendCollaborationEvent(collaboration, { type: 'workflow.created', workflowId: 'wf-1', title: 'Launch' }, () => 'evt-1');
  appendCollaborationEvent(collaboration, { type: 'task.created', workflowId: 'wf-1', taskId: 'task-1', title: 'Research' }, () => 'evt-2');
  appendCollaborationEvent(collaboration, { type: 'task.cancelled', workflowId: 'wf-1', taskId: 'task-1', title: 'Cancelled' }, () => 'evt-3');
  assert.equal(collaboration.eventCursor, 3);
  assert.deepEqual(collaborationEventsAfter(collaboration, 1, 'wf-1').map((event) => event.id), ['evt-2', 'evt-3']);
});

test('normalization keeps a valid active workflow and caps idempotency records', () => {
  const idempotency = Object.fromEntries(Array.from({ length: 230 }, (_, index) => [`key-${index}`, { ok: true }]));
  const collaboration = normalizeThreadCollaboration({ activeWorkflowId: 'missing', workflows: [{ id: 'wf-1', status: 'active' }], idempotency });
  assert.equal(collaboration.activeWorkflowId, 'wf-1');
  assert.equal(Object.keys(collaboration.idempotency).length, 200);
});

test('normalization preserves the approved Plan binding and failed workflow state', () => {
  const collaboration = normalizeThreadCollaboration({
    workflows: [{ id: 'wf-1', status: 'failed', approvedPlanId: 'plan-1', approvedPlanRevision: 3 }],
  });
  assert.equal(collaboration.workflows[0].status, 'failed');
  assert.equal(collaboration.workflows[0].approvedPlanId, 'plan-1');
  assert.equal(collaboration.workflows[0].approvedPlanRevision, 3);
});

test('normalization does not revive terminal workflows', () => {
  const collaboration = normalizeThreadCollaboration({
    activeWorkflowId: 'finished',
    workflows: [{ id: 'finished', status: 'completed' }, { id: 'cancelled', status: 'cancelled' }],
  });
  assert.equal(collaboration.activeWorkflowId, '');
});

test('collaboration V2 feature flag chooses one scheduler only when a Workflow is created', () => {
  assert.equal(collaborationSchedulerKind({ features: { collaborationV2: true } }), 'frakio');
  assert.equal(collaborationSchedulerKind({ features: { collaborationV2: false } }), 'legacy');
  assert.equal(collaborationSchedulerKind({}), 'frakio');
});

test('collaboration Run projection hides Runtime-internal terminal states', () => {
  assert.equal(collaborationRunStatus('queued'), 'queued');
  assert.equal(collaborationRunStatus('waiting_approval'), 'running');
  assert.equal(collaborationRunStatus('completed'), 'ended');
  assert.equal(collaborationRunStatus('cancelled'), 'aborted');
  assert.equal(collaborationRunStatus('failed'), 'failed');
});

test('task status projection emits only high-signal transitions', () => {
  assert.equal(taskStatusEvent({ status: 'running' }, { id: 'a', status: 'waiting_dependency', title: 'A' })?.type, 'task.waiting');
  assert.equal(taskStatusEvent({ status: 'waiting_dependency' }, { id: 'a', status: 'ready', title: 'A' })?.type, 'task.resumed');
  assert.equal(taskStatusEvent({ status: 'running' }, { id: 'a', status: 'review', title: 'A' })?.type, 'task.review');
  assert.equal(taskStatusEvent({ status: 'review' }, { id: 'a', status: 'completed', title: 'A' })?.type, 'task.completed');
  assert.equal(taskStatusEvent({ status: 'todo' }, { id: 'a', status: 'scheduled', title: 'A' }), null);
});

test('late Runtime terminal events cannot overwrite a cancelled or re-leased Task', () => {
  const run = { id: 'run-old', metadata: { leaseToken: 'lease-old' } };
  const binding = { runId: 'run-old', taskId: 'task-1', leaseToken: 'lease-old' };
  assert.equal(runtimeTaskTerminalWriteAllowed(run, { id: 'task-1', status: 'running', leaseToken: 'lease-old' }, binding), true);
  assert.equal(runtimeTaskTerminalWriteAllowed(run, { id: 'task-1', status: 'waiting_input', leaseToken: 'lease-old' }, binding), true);
  assert.equal(runtimeTaskTerminalWriteAllowed(run, { id: 'task-1', status: 'cancelled', leaseToken: '' }, binding), false);
  assert.equal(runtimeTaskTerminalWriteAllowed(run, { id: 'task-1', status: 'running', leaseToken: 'lease-new' }, binding), false);
  assert.equal(runtimeTaskTerminalWriteAllowed(run, { id: 'task-1', status: 'running', leaseToken: 'lease-old' }, { ...binding, runId: 'run-new' }), false);
});

test('board lifecycle completes only when every visible task is done', () => {
  assert.equal(boardLifecycle([{ status: 'done' }, { status: 'archived' }]), 'completed');
  assert.equal(boardLifecycle([{ status: 'completed' }, { status: 'completed' }]), 'completed');
  assert.equal(boardLifecycle([{ status: 'done' }, { status: 'running' }]), 'active');
});

test('execution plans validate stable keys, Agents, revisions, and DAG dependencies', () => {
  const plan = validateCollaborationPlan({
    rootTaskId: 'root-1',
    baseRevision: 0,
    summary: 'Launch plan',
    tasks: [
      { key: 'research', title: 'Research', assigneeAgentId: 'max' },
      { key: 'copy', title: 'Copy', assigneeAgentId: 'kai', dependsOnKeys: ['research'] },
    ],
  }, { agentIds: ['max', 'kai'], currentRevision: 0, rootTaskId: 'root-1' });
  assert.deepEqual(plan.tasks[1].dependsOnKeys, ['research']);
  assert.throws(() => validateCollaborationPlan({ rootTaskId: 'root-1', baseRevision: 0, tasks: [
    { key: 'a', title: 'A', assigneeAgentId: 'max', dependsOnKeys: ['b'] },
    { key: 'b', title: 'B', assigneeAgentId: 'kai', dependsOnKeys: ['a'] },
  ] }, { agentIds: ['max', 'kai'], currentRevision: 0, rootTaskId: 'root-1' }), (error) => error.code === 'PLAN_DEPENDENCY_CYCLE');
  assert.throws(() => validateCollaborationPlan({ rootTaskId: 'root-1', baseRevision: 1, tasks: [{ key: 'a', title: 'A', assigneeAgentId: 'max' }] }, { agentIds: ['max'], currentRevision: 2, rootTaskId: 'root-1' }), (error) => error.code === 'PLAN_REVISION_CONFLICT');
});

test('collaboration graph limits accept the boundary and reject unbounded task growth', () => {
  const tasks = Array.from({ length: MAX_COLLABORATION_TASKS }, (_, index) => ({ id: `task-${index + 1}`, dependencies: [] }));
  assert.deepEqual(assertCollaborationGraphLimits(tasks), {
    taskCount: MAX_COLLABORATION_TASKS,
    maximumDepth: 1,
  });
  assert.throws(
    () => assertCollaborationGraphLimits([...tasks, { id: 'task-overflow', dependencies: [] }]),
    (error) => error.code === 'WORKFLOW_TASK_LIMIT' && error.status === 409,
  );
});

test('collaboration graph limits accept sixteen dependency levels and reject the seventeenth', () => {
  const chain = Array.from({ length: MAX_COLLABORATION_DEPENDENCY_DEPTH }, (_, index) => ({
    id: `task-${index + 1}`,
    dependencies: index === 0 ? [] : [`task-${index}`],
  }));
  assert.equal(assertCollaborationGraphLimits(chain).maximumDepth, MAX_COLLABORATION_DEPENDENCY_DEPTH);
  assert.throws(
    () => assertCollaborationGraphLimits([...chain, {
      id: `task-${MAX_COLLABORATION_DEPENDENCY_DEPTH + 1}`,
      dependencies: [`task-${MAX_COLLABORATION_DEPENDENCY_DEPTH}`],
    }]),
    (error) => error.code === 'WORKFLOW_DEPENDENCY_DEPTH_LIMIT' && error.status === 409,
  );
});

test('collaboration events bound oversized payloads without losing ordering metadata', () => {
  const collaboration = normalizeThreadCollaboration({ workflows: [{ id: 'wf-large', status: 'active' }] });
  const event = appendCollaborationEvent(collaboration, {
    type: 'task.completed',
    workflowId: 'wf-large',
    taskId: 'task-large',
    payload: { output: 'x'.repeat(MAX_COLLABORATION_EVENT_BYTES * 2) },
  }, () => 'event-large');
  assert.equal(event.cursor, 1);
  assert.equal(event.payload.truncated, true);
  assert.ok(event.payload.originalBytes > MAX_COLLABORATION_EVENT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(event.payload)) <= MAX_COLLABORATION_EVENT_BYTES);
});

test('plan revisions report additions, changes, and cancellations without rewriting history', () => {
  const previous = { tasks: [{ key: 'a', title: 'A', assigneeAgentId: 'max', dependsOnKeys: [] }, { key: 'b', title: 'B', assigneeAgentId: 'kai', dependsOnKeys: [] }] };
  const next = { tasks: [{ key: 'a', title: 'A revised', assigneeAgentId: 'max', dependsOnKeys: [] }, { key: 'c', title: 'C', assigneeAgentId: 'leo', dependsOnKeys: ['a'] }] };
  assert.deepEqual(diffCollaborationPlans(previous, next), { added: ['c'], changed: ['a'], cancelled: ['b'] });
});
