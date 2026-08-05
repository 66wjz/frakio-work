function currentTimestamp() {
  return new Date().toISOString();
}

function isCurrentlyValid(entry, at = Date.now()) {
  const starts = entry.validFrom ? Date.parse(entry.validFrom) : Number.NEGATIVE_INFINITY;
  const ends = entry.validUntil ? Date.parse(entry.validUntil) : Number.POSITIVE_INFINITY;
  return (Number.isNaN(starts) || starts <= at) && (Number.isNaN(ends) || ends > at);
}

export function createMemoryLedger({ store }) {
  function scopedEntries({ userId = 'default', agentId = '', vaultId = '', workspaceId = '', threadId = '', query = '', limit = 24 } = {}) {
    const projectSubjectId = vaultId || workspaceId;
    const read = (scope, subjectId) => subjectId ? store.listMemory({ scope, subjectId, query, limit: 500 }) : [];
    const candidates = [
      ...read('user', userId),
      ...read('agent', agentId),
      ...read('vault', projectSubjectId),
      ...read('workspace', projectSubjectId),
      ...read('thread', threadId),
    ];
    const excluded = [];
    const seen = new Set();
    const eligible = candidates.filter((entry) => {
      if (entry.status !== 'accepted') {
        excluded.push({ id: entry.id, reason: `status_${entry.status}` });
        return false;
      }
      if (!isCurrentlyValid(entry)) {
        excluded.push({ id: entry.id, reason: 'outside_validity_window' });
        return false;
      }
      const key = entry.fact.trim().toLowerCase();
      if (seen.has(key)) {
        excluded.push({ id: entry.id, reason: 'duplicate_fact' });
        return false;
      }
      seen.add(key);
      return true;
    }).sort((left, right) => right.confidence - left.confidence || right.updatedAt.localeCompare(left.updatedAt));
    const entries = eligible.slice(0, limit);
    for (const entry of eligible.slice(limit)) excluded.push({ id: entry.id, reason: 'context_limit' });
    return { entries, excluded };
  }

  return {
    propose({ scope, subjectId, fact, kind = 'fact', origin = 'unknown', sourceAgentId = '', threadId = '', vaultId = '', sourceHash = '', confidence = 0.5, provenance = [], reason = '', statusReason = '', validFrom = null, validUntil = null, supersedesId = null }) {
      const normalizedScope = scope === 'workspace' ? 'vault' : scope;
      if (!['user', 'agent', 'vault', 'thread'].includes(normalizedScope)) throw new Error('Memory scope must be user, agent, vault, or thread.');
      if (!subjectId) throw new Error('Memory subject is required.');
      if (!['personal_fact', 'preference', 'agent_experience', 'project_fact', 'project_decision', 'project_rule', 'fact'].includes(kind)) throw new Error('Memory kind is not supported.');
      return store.putMemory({
        scope: normalizedScope,
        subjectId,
        fact,
        kind,
        origin,
        sourceAgentId,
        threadId,
        vaultId,
        sourceHash,
        reason,
        statusReason,
        confidence,
        provenance: provenance.map((item) => ({ ...item, createdAt: item.createdAt || currentTimestamp() })),
        status: 'candidate',
        validFrom,
        validUntil,
        supersedesId,
      });
    },
    accept(id, { confidence, supersedesId = null } = {}) {
      if (supersedesId) store.updateMemory(supersedesId, { status: 'superseded' });
      return store.updateMemory(id, { status: 'accepted', confidence, supersedesId });
    },
    reject(id) {
      return store.updateMemory(id, { status: 'rejected', statusReason: 'rejected' });
    },
    pause(id) {
      return store.updateMemory(id, { status: 'paused', pausedAt: currentTimestamp(), statusReason: 'paused' });
    },
    resume(id) {
      return store.updateMemory(id, { status: 'accepted', pausedAt: null, statusReason: '' });
    },
    forget(id) {
      return store.updateMemory(id, { status: 'forgotten', pausedAt: null, statusReason: 'forgotten', deletedAt: currentTimestamp(), deletionReason: 'user_requested' });
    },
    search({ scope = '', subjectId = '', query = '', status = 'accepted', limit = 50 } = {}) {
      return store.listMemory({ scope, subjectId, query, status, limit }).filter(isCurrentlyValid);
    },
    packet({ userId = 'default', agentId = '', vaultId = '', workspaceId = '', threadId = '', query = '', limit = 24 } = {}) {
      return scopedEntries({ userId, agentId, vaultId, workspaceId, threadId, query, limit }).entries;
    },
    packetWithReceipt(input = {}) {
      return scopedEntries(input);
    },
  };
}
