import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canApplyPresentation,
  canApplyRunSnapshot,
  canApplyRuntimeCursor,
  mergeThreadWithPendingMessages,
  normalizeApprovalPresentation,
  normalizeClarificationPresentation,
  runtimeEventKey,
  shouldApplyRuntimeEvent,
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

test('live and recovered SSE share one native event idempotency rule', () => {
  const seen = new Set();
  const native = { event: 'message.delta', hostRunId: 'host-1', runtimeCursor: 9, nativeEventKey: 'native-9' };
  assert.equal(runtimeEventKey(native), 'native-9');
  assert.equal(shouldApplyRuntimeEvent(seen, native), true);
  assert.equal(shouldApplyRuntimeEvent(seen, { ...native, cursor: 90 }), false);
  assert.equal(shouldApplyRuntimeEvent(seen, { event: 'message.delta', hostRunId: 'host-2', runtimeCursor: 9 }), true);
  assert.equal(shouldApplyRuntimeEvent(seen, { event: 'message.delta', hostRunId: 'host-2', runtimeCursor: 9 }), false);
});

test('stale thread snapshots retain pending optimistic messages until server confirmation', () => {
  const optimistic = { id: 'thread-1', messages: [{ id: 'client-message-1', content: '你好' }] };
  const stale = { id: 'thread-1', messages: [] };
  const confirmed = { id: 'thread-1', messages: [{ id: 'client-message-1', content: '你好' }] };

  assert.deepEqual(mergeThreadWithPendingMessages(optimistic, stale, ['client-message-1']).messages, optimistic.messages);
  assert.deepEqual(mergeThreadWithPendingMessages(optimistic, confirmed, ['client-message-1']).messages, confirmed.messages);
});

test('older thread snapshots cannot remove a newer completed Agent reply', () => {
  const current = {
    id: 'thread-1',
    updatedAt: '2026-08-06T03:32:04.000Z',
    messages: [
      { id: 'user-1', agentId: 'user', content: '叫 Victor' },
      { id: 'iris-1', agentId: 'iris', content: 'Victor 出来一下' },
      { id: 'victor-1', agentId: 'victor', content: '收到，我在。' },
    ],
  };
  const stale = {
    id: 'thread-1',
    updatedAt: '2026-08-06T03:32:03.000Z',
    messages: current.messages.slice(0, 2),
  };

  assert.deepEqual(mergeThreadWithPendingMessages(current, stale).messages, current.messages);
});
