import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canApplyPresentation,
  canApplyRunSnapshot,
  canApplyRuntimeCursor,
  mergeThreadWithPendingMessages,
  normalizeApprovalPresentation,
  normalizeClarificationPresentation,
} from '../web/src/run-ui-state.mjs';

test('run presentation normalizes recovered approval and clarification identifiers', () => {
  const approval = normalizeApprovalPresentation({
    approval_id: 'approval-1',
    title: '允许命令',
    command: 'pwd',
    choices: ['once', 'session', 'invalid'],
  });
  const nested = normalizeApprovalPresentation({ raw: { approval_id: 'approval-2', toolName: 'terminal' } });
  const clarification = normalizeClarificationPresentation({ raw: { clarify_id: 'clarify-1' }, question: '继续吗？' });

  assert.equal(approval.approval.id, 'approval-1');
  assert.deepEqual(approval.approval.choices, ['once', 'session']);
  assert.equal(nested.approval.id, 'approval-2');
  assert.equal(nested.approval.tool, 'terminal');
  assert.equal(clarification.clarification.id, 'clarify-1');
  assert.equal(normalizeApprovalPresentation({ title: '缺少 ID' }).missingId, true);
});

test('run UI rejects old revisions and duplicate runtime cursors', () => {
  assert.equal(canApplyPresentation(5, 4), false);
  assert.equal(canApplyPresentation(5, 5), true);
  assert.equal(canApplyRuntimeCursor(8, 8), false);
  assert.equal(canApplyRuntimeCursor(8, 9), true);
  assert.equal(canApplyRunSnapshot('run-1', 'run-1', 'running'), false);
  assert.equal(canApplyRunSnapshot('run-1', 'run-1', 'completed'), true);
  assert.equal(canApplyRunSnapshot('run-1', 'run-2', 'running'), true);
});

test('stale thread snapshots retain pending optimistic messages until server confirmation', () => {
  const optimistic = { id: 'thread-1', messages: [{ id: 'client-message-1', content: '你好' }] };
  const stale = { id: 'thread-1', messages: [] };
  const confirmed = { id: 'thread-1', messages: [{ id: 'client-message-1', content: '你好' }] };

  assert.deepEqual(mergeThreadWithPendingMessages(optimistic, stale, ['client-message-1']).messages, optimistic.messages);
  assert.deepEqual(mergeThreadWithPendingMessages(optimistic, confirmed, ['client-message-1']).messages, confirmed.messages);
});
