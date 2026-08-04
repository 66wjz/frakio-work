import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMemoryCandidate, memorySourceHash } from './router.mjs';

test('explicit user remember requests become personal memory outside a project rule', () => {
  assert.deepEqual(classifyMemoryCandidate({ fact: '请记住我喜欢简短的状态更新', origin: 'user' }), {
    scope: 'user', kind: 'preference', confidence: 0.86, requiresReview: false,
  });
});

test('connected project paths and workflow rules stay in the project vault', () => {
  const result = classifyMemoryCandidate({ fact: '这个项目的交付路径是 交付物/，流程由 Victor 复核', origin: 'user', vaultId: 'vault-1' });
  assert.equal(result.scope, 'vault');
  assert.equal(result.kind, 'project_rule');
});

test('Agent output cannot promote itself into personal facts', () => {
  const result = classifyMemoryCandidate({ fact: '用户每天早上六点起床', origin: 'agent', scope: 'user' });
  assert.equal(result.scope, 'thread');
  assert.equal(result.requiresReview, true);
});

test('source hashes are stable and include the source message', () => {
  const first = memorySourceHash({ fact: 'same', origin: 'user', sourceMessageId: 'one', threadId: 'thread' });
  assert.equal(first, memorySourceHash({ fact: 'same', origin: 'user', sourceMessageId: 'one', threadId: 'thread' }));
  assert.notEqual(first, memorySourceHash({ fact: 'same', origin: 'user', sourceMessageId: 'two', threadId: 'thread' }));
});
