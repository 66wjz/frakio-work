import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMemoryLedger } from '../memory/ledger.mjs';
import { createRuntimeStore } from './store.mjs';

test('memory review jobs are idempotent and recover interrupted work', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-memory-review-store-'));
  const store = createRuntimeStore(path.join(root, 'frakio.db'));
  t.after(() => store.close());
  const first = store.putMemoryReview({ triggerKey: 'chat:thread:turn', threadId: 'thread', turnId: 'turn', input: { messages: [] } });
  const duplicate = store.putMemoryReview({ triggerKey: 'chat:thread:turn', threadId: 'thread', turnId: 'turn', input: { messages: [{ id: 'ignored' }] } });
  assert.equal(duplicate.id, first.id);
  assert.deepEqual(duplicate.input.messages, []);
  store.updateMemoryReview(first.id, { status: 'running', attempts: 1 });
  const recovered = store.recoverMemoryReviews();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'queued');
  assert.equal(recovered[0].attempts, 1);
});

test('only accepted, active and unexpired scoped memories enter context', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-memory-packet-'));
  const store = createRuntimeStore(path.join(root, 'frakio.db'));
  const ledger = createMemoryLedger({ store });
  t.after(() => store.close());
  const personal = ledger.propose({ scope: 'user', subjectId: 'default', fact: '用户偏好中文', kind: 'preference', confidence: 0.95 });
  ledger.accept(personal.id);
  const paused = ledger.propose({ scope: 'agent', subjectId: 'iris', fact: '先做静态检查', kind: 'agent_experience', confidence: 0.9 });
  ledger.accept(paused.id);
  ledger.pause(paused.id);
  const expired = ledger.propose({ scope: 'vault', subjectId: 'vault-a', fact: '旧交付路径', kind: 'project_rule', confidence: 0.9, validUntil: '2000-01-01T00:00:00.000Z' });
  ledger.accept(expired.id);
  const project = ledger.propose({ scope: 'vault', subjectId: 'vault-a', fact: '新交付路径', kind: 'project_rule', confidence: 0.95 });
  ledger.accept(project.id, { supersedesId: expired.id });
  const packet = ledger.packet({ userId: 'default', agentId: 'iris', vaultId: 'vault-a' });
  assert.deepEqual(packet.map((entry) => entry.fact).sort(), ['新交付路径', '用户偏好中文'].sort());
  assert.equal(store.getMemory(expired.id).status, 'superseded');
});
