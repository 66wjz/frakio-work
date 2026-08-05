import { createHash, randomUUID } from 'node:crypto';
import { routeMemoryCandidate } from './router.mjs';

function stableKey(parts) {
  return createHash('sha256').update(parts.map((value) => String(value || '')).join('\0')).digest('hex');
}

export function createMemoryService({ ledger, store }) {
  function event(type, memoryId, input = {}) {
    return store.putMemoryEvent({
      idempotencyKey: input.idempotencyKey || stableKey([type, memoryId, input.actorType, input.actorId, input.revision, input.reason]),
      memoryId,
      type,
      actorType: input.actorType || 'system',
      actorId: input.actorId || '',
      payload: input.payload || {},
      status: input.status || 'completed',
      error: input.error || '',
    });
  }

  return {
    revision(input = {}) {
      return store.memoryRevision(input);
    },
    propose(input = {}) {
      const sourceHash = input.sourceHash || stableKey([input.origin, input.sourceRuntimeId, input.sourceSessionId, input.sourceMessageId, input.threadId, input.fact]);
      const entry = routeMemoryCandidate(ledger, { ...input, sourceHash });
      const recorded = store.updateMemory(entry.id, {
        sourceRuntimeId: input.sourceRuntimeId || '',
        sourceSessionId: input.sourceSessionId || '',
        sourceMessageId: input.sourceMessageId || '',
        createdRevision: input.createdRevision || store.memoryRevision(),
      });
      event('memory.proposed', recorded.id, {
        idempotencyKey: input.idempotencyKey || `propose:${sourceHash}`,
        actorType: input.origin === 'user' ? 'user' : 'runtime',
        actorId: input.sourceRuntimeId || input.sourceAgentId || '',
        payload: { scope: recorded.scope, status: recorded.status, sourceHash },
      });
      if (recorded.status === 'accepted') event('memory.accepted', recorded.id, { idempotencyKey: `auto-accept:${sourceHash}`, actorType: 'policy' });
      return recorded;
    },
    importCandidate(input = {}) {
      if (!['user', 'agent'].includes(input.scope)) throw new Error('Imported Hermes memory must target user or agent scope.');
      const subjectId = input.scope === 'user' ? String(input.userId || 'default') : String(input.subjectId || input.sourceAgentId || input.agentId || '');
      if (!subjectId) throw new Error('Imported memory subject is required.');
      const sourceHash = input.sourceHash || stableKey(['import', input.profileName, input.scope, input.fact]);
      const entry = ledger.propose({
        scope: input.scope,
        subjectId,
        fact: input.fact,
        kind: input.kind || (input.scope === 'user' ? 'personal_fact' : 'agent_experience'),
        origin: input.origin || 'hermes-import',
        sourceAgentId: input.sourceAgentId || '',
        sourceHash,
        confidence: Number(input.confidence ?? 0.55),
        reason: input.reason || 'Imported from Hermes and awaiting confirmation',
        statusReason: 'import_waiting_confirmation',
        provenance: input.provenance || [],
      });
      const recorded = store.updateMemory(entry.id, { sourceRuntimeId: 'hermes', createdRevision: store.memoryRevision() });
      event('memory.proposed', recorded.id, { idempotencyKey: input.idempotencyKey || `import:${sourceHash}`, actorType: 'system', actorId: input.profileName || 'hermes', payload: { scope: recorded.scope, status: 'candidate', imported: true } });
      return recorded;
    },
    search(input = {}) {
      const selection = ledger.packetWithReceipt(input);
      if (selection.entries.length) store.touchMemoryRecall(selection.entries.map((entry) => entry.id));
      const revision = store.memoryRevision();
      const receipt = input.threadId ? store.putMemoryReceipt({
        id: input.receiptId || `memory_receipt_${randomUUID()}`,
        threadId: input.threadId,
        runId: input.runId || '',
        runtimeId: input.runtimeId || '',
        agentId: input.agentId || '',
        query: input.query || '',
        memoryRevision: revision,
        included: selection.entries.map((entry) => ({ id: entry.id, scope: entry.scope, kind: entry.kind, reason: 'scope_match' })),
        excluded: selection.excluded,
      }) : null;
      return { ...selection, revision, receipt };
    },
    confirm(id, input = {}) {
      const entry = ledger.accept(id, { confidence: input.confidence, supersedesId: input.supersedesId || null });
      if (!entry) return null;
      event('memory.accepted', id, { idempotencyKey: input.idempotencyKey || `confirm:${id}`, actorType: 'user', actorId: input.actorId || 'default' });
      return entry;
    },
    update(id, input = {}) {
      const current = store.getMemory(id);
      if (!current) return null;
      const replacement = ledger.propose({
        ...current,
        fact: input.fact,
        kind: input.kind || current.kind,
        origin: 'user',
        sourceHash: stableKey(['update', id, input.fact]),
        confidence: Number(input.confidence ?? current.confidence),
        supersedesId: id,
      });
      const accepted = ledger.accept(replacement.id, { confidence: Number(input.confidence ?? current.confidence), supersedesId: id });
      event('memory.updated', accepted.id, { idempotencyKey: input.idempotencyKey || `update:${id}:${accepted.id}`, actorType: 'user', payload: { supersedesId: id } });
      return accepted;
    },
    forget(id, input = {}) {
      const current = store.getMemory(id);
      if (!current) return null;
      const deletedAt = new Date().toISOString();
      const entry = store.updateMemory(id, { status: 'forgotten', statusReason: 'forgotten', deletedAt, deletionReason: input.reason || 'user_requested' });
      event('memory.forgotten', id, { idempotencyKey: input.idempotencyKey || `forget:${id}`, actorType: 'user', actorId: input.actorId || 'default', reason: input.reason });
      return entry;
    },
    purge(id, input = {}) {
      const current = store.getMemory(id);
      if (!current) return false;
      event('memory.purged', id, { idempotencyKey: input.idempotencyKey || `purge:${id}:${Date.now()}`, actorType: 'user', payload: { scope: current.scope, subjectId: current.subjectId } });
      return store.deleteMemory(id);
    },
    receipts(threadId, limit = 100) {
      return store.listMemoryReceipts({ threadId, limit });
    },
    events(memoryId = '', limit = 100) {
      return store.listMemoryEvents({ memoryId, limit });
    },
  };
}
