import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoResolvePlanQuestionBatch,
  cancelPlanQuestionBatch,
  createPlanQuestionBatch,
  createPlanSession,
  normalizePlanSession,
  normalizePlanQuestion,
  normalizeThreadPlans,
  resolvePlanQuestionBatch,
  submitPlanDraft,
} from './plan-mode.mjs';

test('legacy threads normalize to default collaboration mode without a migration', () => {
  assert.deepEqual(normalizeThreadPlans({ executionMode: 'chat' }), {
    collaborationMode: 'default',
    activePlanId: '',
    planSessions: [],
  });
});

test('legacy Plan handoff metadata remains readable without changing its purpose', () => {
  const plan = normalizePlanSession({
    id: 'legacy-plan',
    purpose: 'plan',
    targetExecutionMode: 'chat',
    postApprovalIntent: 'collaboration',
    status: 'waiting_approval',
  });
  assert.equal(plan.purpose, 'plan');
  assert.equal(plan.targetExecutionMode, 'chat');
  assert.equal(plan.postApprovalIntent, 'collaboration');
});

test('Plan sessions preserve bounded revisions and idempotent submissions', () => {
  const thread = { executionMode: 'chat', planSessions: [] };
  const plan = createPlanSession(thread, { authorAgentId: 'iris', targetExecutionMode: 'chat', at: '2026-07-26T00:00:00.000Z' });
  const input = {
    baseRevision: 0,
    title: 'Plan',
    summary: 'Summary',
    idempotencyKey: 'plan-v1',
    steps: [{ key: 'inspect', title: 'Inspect', description: 'Read source.', files: [], expectedResult: 'Findings', dependsOnKeys: [] }],
    tests: ['typecheck'],
    assumptions: [],
  };
  const first = submitPlanDraft(plan, input, { agentIds: ['iris'], submittedByRunId: 'run-1' }, '2026-07-26T00:01:00.000Z');
  const replay = submitPlanDraft(plan, input, { agentIds: ['iris'], submittedByRunId: 'run-1' }, '2026-07-26T00:02:00.000Z');
  assert.equal(first.revision, 1);
  assert.equal(replay.revision, 1);
  assert.equal(plan.drafts.length, 1);
});

test('Work Plan validation rejects missing assignees and dependency cycles', () => {
  const thread = { executionMode: 'work', planSessions: [] };
  const plan = createPlanSession(thread, { authorAgentId: 'coord', targetExecutionMode: 'work' });
  assert.throws(() => submitPlanDraft(plan, {
    baseRevision: 0,
    title: 'Invalid',
    summary: 'Missing assignee',
    idempotencyKey: 'missing-assignee',
    steps: [{ key: 'one', title: 'One', description: 'One', expectedResult: 'One', dependsOnKeys: [] }],
  }, { agentIds: ['coord'] }), /assigneeAgentId/);
  assert.throws(() => submitPlanDraft(plan, {
    baseRevision: 0,
    title: 'Cycle',
    summary: 'Cycle',
    idempotencyKey: 'cycle',
    steps: [
      { key: 'one', title: 'One', description: 'One', assigneeAgentId: 'coord', expectedResult: 'One', dependsOnKeys: ['two'] },
      { key: 'two', title: 'Two', description: 'Two', assigneeAgentId: 'coord', expectedResult: 'Two', dependsOnKeys: ['one'] },
    ],
  }, { agentIds: ['coord'] }), /cycle/);
});

test('collaboration proposals retain their purpose, handoff, and Workflow revision target', () => {
  const thread = { executionMode: 'chat', planSessions: [] };
  const proposal = createPlanSession(thread, { authorAgentId: 'iris', purpose: 'collaboration', targetExecutionMode: 'collaboration', workflowId: 'workflow-1' });
  assert.equal(proposal.purpose, 'collaboration');
  assert.equal(proposal.targetExecutionMode, 'collaboration');
  assert.equal(proposal.workflowId, 'workflow-1');
  assert.equal(thread.collaborationMode, 'collaboration');
  assert.equal(normalizeThreadPlans(thread).collaborationMode, 'collaboration');
  assert.throws(() => submitPlanDraft(proposal, {
    baseRevision: 0,
    title: 'Collaboration',
    summary: 'Assign work.',
    idempotencyKey: 'collaboration-missing-assignee',
    steps: [{ key: 'one', title: 'One', description: 'One', expectedResult: 'One', dependsOnKeys: [] }],
  }, { agentIds: ['iris'] }), /assigneeAgentId/);
});

test('structured Plan questions resolve answers by question id', () => {
  const thread = { executionMode: 'chat', planSessions: [] };
  const plan = createPlanSession(thread, { authorAgentId: 'iris', targetExecutionMode: 'chat' });
  const batch = createPlanQuestionBatch(plan, {
    questions: [{
      id: 'scope',
      header: 'Scope',
      question: 'Which scope?',
      options: [
        { label: 'Focused', description: 'Smaller change.' },
        { label: 'Broad', description: 'Larger change.' },
      ],
    }],
  });
  resolvePlanQuestionBatch(plan, batch.id, { scope: { selectedLabel: 'Focused', note: 'Keep compatibility.' } });
  assert.equal(batch.status, 'resolved');
  assert.deepEqual(batch.answers.scope, { selectedLabel: 'Focused', note: 'Keep compatibility.' });
  assert.equal(plan.status, 'drafting');
});

test('Plan questions preserve one explicit recommendation and fall back to the first option', () => {
  const explicit = normalizePlanQuestion({
    id: 'explicit',
    header: 'Explicit',
    question: 'Choose.',
    options: [
      { label: 'One', description: 'First.', recommended: false },
      { label: 'Two', description: 'Second.', recommended: true },
      { label: 'Three', description: 'Third.', recommended: true },
    ],
  });
  assert.deepEqual(explicit.options.map((option) => option.recommended), [false, true, false]);

  const fallback = normalizePlanQuestion({
    id: 'fallback',
    header: 'Fallback',
    question: 'Choose.',
    options: [
      { label: 'One', description: 'First.' },
      { label: 'Two', description: 'Second.' },
    ],
  });
  assert.deepEqual(fallback.options.map((option) => option.recommended), [true, false]);
});

test('Plan question auto resolution uses the recommendation and cancellation preserves Plan mode', () => {
  const thread = { executionMode: 'chat', planSessions: [] };
  const plan = createPlanSession(thread, { authorAgentId: 'iris', targetExecutionMode: 'chat' });
  const autoBatch = createPlanQuestionBatch(plan, {
    autoResolutionMs: 60_000,
    questions: [{
      id: 'auto',
      header: 'Auto',
      question: 'Choose.',
      options: [
        { label: 'One', description: 'First.' },
        { label: 'Two', description: 'Second.', recommended: true },
      ],
    }],
  }, '2026-07-26T00:00:00.000Z');
  autoResolvePlanQuestionBatch(plan, autoBatch.id, '2026-07-26T00:02:00.000Z');
  assert.equal(autoBatch.answers.auto.selectedLabel, 'Two');
  assert.equal(autoBatch.status, 'auto_resolved');

  const cancelBatch = createPlanQuestionBatch(plan, {
    questions: [{
      id: 'cancel',
      header: 'Cancel',
      question: 'Choose.',
      options: [
        { label: 'One', description: 'First.' },
        { label: 'Two', description: 'Second.' },
      ],
    }],
  });
  cancelPlanQuestionBatch(plan, cancelBatch.id, '2026-07-26T00:03:00.000Z');
  assert.equal(cancelBatch.status, 'cancelled');
  assert.equal(plan.status, 'drafting');
  assert.equal(thread.collaborationMode, 'plan');
  assert.equal(thread.activePlanId, plan.id);
  assert.equal(cancelPlanQuestionBatch(plan, cancelBatch.id), cancelBatch);
});
