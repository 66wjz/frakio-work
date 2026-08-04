import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContextCoordinator, contextThresholds, estimateContextTokens } from './context-coordinator.mjs';
import { createRuntimeStore } from './store.mjs';

async function fixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const store = createRuntimeStore(path.join(root, 'runtime.db'));
  return { root, store };
}

test('context thresholds reserve output space and cap record estimation', () => {
  const thresholds = contextThresholds({ contextWindow: 100_000, maxOutputTokens: 20_000 });
  assert.equal(thresholds.effectiveLimit, 80_000);
  assert.equal(thresholds.softThreshold, 56_000);
  assert.equal(thresholds.hardThreshold, 72_000);
  const records = Array.from({ length: 600 }, (_, index) => ({ role: 'user', content: 'x'.repeat(100), cursor: index + 1 }));
  assert.ok(estimateContextTokens(records) <= 20_000);
});

test('compaction persists a portable checkpoint and emits one lifecycle', async (t) => {
  const { root, store } = await fixture('frakio-context-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const emitted = [];
  const coordinator = createContextCoordinator({ store, summarizer: async () => '## Current goal\nShip the fix' });
  const checkpoint = await coordinator.compact({
    threadId: 'thread-1', runId: 'run-1', runtimeId: 'pi', modelId: 'model-1', throughCursor: 4,
    records: [{ cursor: 1, role: 'user', content: 'hello' }, { cursor: 4, role: 'assistant', content: 'working' }],
    emit: (type, payload) => emitted.push({ type, payload }),
  });
  assert.equal(checkpoint.throughCursor, 4);
  assert.equal(store.latestContextCheckpoint('thread-1').summary, '## Current goal\nShip the fix');
  assert.deepEqual(emitted.map((item) => item.type), ['context.compaction.started', 'session.checkpoint.created', 'context.compaction.completed']);
});

test('compaction failures preserve the source history', async (t) => {
  const { root, store } = await fixture('frakio-context-failure-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const emitted = [];
  const coordinator = createContextCoordinator({ store, summarizer: async () => { throw new Error('timeout'); } });
  await assert.rejects(() => coordinator.compact({
    threadId: 'thread-2', runId: 'run-2', runtimeId: 'hermes', modelId: 'model-2',
    records: [{ cursor: 1, role: 'user', content: 'keep me' }],
    emit: (type, payload) => emitted.push({ type, payload }),
  }), /timeout/);
  assert.equal(store.latestContextCheckpoint('thread-2'), undefined);
  assert.equal(emitted.at(-1).payload.originalContextPreserved, true);
});
