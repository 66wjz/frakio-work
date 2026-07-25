import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCollaborationEvent, boardLifecycle, collaborationEventsAfter, diffCollaborationPlans, normalizeThreadCollaboration, taskStatusEvent, validateCollaborationPlan } from './collaboration.mjs';

test('collaboration events use monotonic cursors and support replay filters', () => {
  const collaboration = normalizeThreadCollaboration({ workflows: [{ id: 'wf-1', boardSlug: 'launch' }] });
  appendCollaborationEvent(collaboration, { type: 'workflow.created', workflowId: 'wf-1', title: 'Launch' }, () => 'evt-1');
  appendCollaborationEvent(collaboration, { type: 'task.created', workflowId: 'wf-1', taskId: 'task-1', title: 'Research' }, () => 'evt-2');
  assert.equal(collaboration.eventCursor, 2);
  assert.deepEqual(collaborationEventsAfter(collaboration, 1, 'wf-1').map((event) => event.id), ['evt-2']);
});

test('normalization keeps a valid active workflow and caps idempotency records', () => {
  const idempotency = Object.fromEntries(Array.from({ length: 230 }, (_, index) => [`key-${index}`, { ok: true }]));
  const collaboration = normalizeThreadCollaboration({ activeWorkflowId: 'missing', workflows: [{ id: 'wf-1', status: 'active' }], idempotency });
  assert.equal(collaboration.activeWorkflowId, 'wf-1');
  assert.equal(Object.keys(collaboration.idempotency).length, 200);
});

test('task status projection emits only high-signal transitions', () => {
  assert.equal(taskStatusEvent({ status: 'running' }, { id: 'a', status: 'blocked', title: 'A' })?.type, 'task.waiting');
  assert.equal(taskStatusEvent({ status: 'blocked' }, { id: 'a', status: 'ready', title: 'A' })?.type, 'task.resumed');
  assert.equal(taskStatusEvent({ status: 'todo' }, { id: 'a', status: 'scheduled', title: 'A' }), null);
});

test('board lifecycle completes only when every visible task is done', () => {
  assert.equal(boardLifecycle([{ status: 'done' }, { status: 'archived' }]), 'completed');
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

test('plan revisions report additions, changes, and cancellations without rewriting history', () => {
  const previous = { tasks: [{ key: 'a', title: 'A', assigneeAgentId: 'max', dependsOnKeys: [] }, { key: 'b', title: 'B', assigneeAgentId: 'kai', dependsOnKeys: [] }] };
  const next = { tasks: [{ key: 'a', title: 'A revised', assigneeAgentId: 'max', dependsOnKeys: [] }, { key: 'c', title: 'C', assigneeAgentId: 'leo', dependsOnKeys: ['a'] }] };
  assert.deepEqual(diffCollaborationPlans(previous, next), { added: ['c'], changed: ['a'], cancelled: ['b'] });
});
