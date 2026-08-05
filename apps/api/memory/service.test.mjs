import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntimeStore } from '../runtime/store.mjs';
import { createMemoryLedger } from './ledger.mjs';
import { createMemoryService } from './service.mjs';

test('memory service owns idempotent writes, receipts, and forgotten tombstones', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-memory-service-'));
  const store = createRuntimeStore(path.join(root, 'runtime.db'));
  const service = createMemoryService({ ledger: createMemoryLedger({ store }), store });
  const input = { fact: '请记住我喜欢简短回答', origin: 'user', userId: 'default', userConfirmed: true, sourceMessageId: 'message-1', threadId: 'thread-1', sourceRuntimeId: 'hermes' };
  const first = service.propose(input);
  const replay = service.propose(input);
  assert.equal(replay.id, first.id);
  assert.equal(service.events(first.id).filter((event) => event.type === 'memory.proposed').length, 1);
  const selected = service.search({ userId: 'default', threadId: 'thread-1', runtimeId: 'pi', query: '回答' });
  assert.deepEqual(selected.entries.map((entry) => entry.id), [first.id]);
  assert.equal(service.receipts('thread-1').length, 1);
  assert.equal(service.forget(first.id).status, 'forgotten');
  assert.equal(service.search({ userId: 'default', threadId: 'thread-1', runtimeId: 'codex', query: '回答' }).entries.length, 0);
  store.close();
  await rm(root, { recursive: true, force: true });
});
