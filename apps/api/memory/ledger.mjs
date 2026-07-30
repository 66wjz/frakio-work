function currentTimestamp() {
  return new Date().toISOString();
}

function isCurrentlyValid(entry, at = Date.now()) {
  const starts = entry.validFrom ? Date.parse(entry.validFrom) : Number.NEGATIVE_INFINITY;
  const ends = entry.validUntil ? Date.parse(entry.validUntil) : Number.POSITIVE_INFINITY;
  return (Number.isNaN(starts) || starts <= at) && (Number.isNaN(ends) || ends > at);
}

export function createMemoryLedger({ store }) {
  return {
    propose({ scope, subjectId, fact, confidence = 0.5, provenance = [], validFrom = null, validUntil = null }) {
      if (!['user', 'agent', 'workspace'].includes(scope)) throw new Error('Memory scope must be user, agent, or workspace.');
      if (!subjectId) throw new Error('Memory subject is required.');
      return store.putMemory({
        scope,
        subjectId,
        fact,
        confidence,
        provenance: provenance.map((item) => ({ ...item, createdAt: item.createdAt || currentTimestamp() })),
        status: 'candidate',
        validFrom,
        validUntil,
      });
    },
    accept(id, { confidence, supersedesId = null } = {}) {
      if (supersedesId) store.updateMemory(supersedesId, { status: 'superseded' });
      return store.updateMemory(id, { status: 'accepted', confidence, supersedesId });
    },
    reject(id) {
      return store.updateMemory(id, { status: 'rejected' });
    },
    search({ scope = '', subjectId = '', query = '', status = 'accepted', limit = 50 } = {}) {
      return store.listMemory({ scope, subjectId, query, status, limit }).filter(isCurrentlyValid);
    },
    packet({ userId = 'default', agentId = '', workspaceId = '', query = '', limit = 24 } = {}) {
      const groups = [
        store.listMemory({ scope: 'user', subjectId: userId, status: 'accepted', query, limit }),
        agentId ? store.listMemory({ scope: 'agent', subjectId: agentId, status: 'accepted', query, limit }) : [],
        workspaceId ? store.listMemory({ scope: 'workspace', subjectId: workspaceId, status: 'accepted', query, limit }) : [],
      ];
      const seen = new Set();
      return groups.flat().filter(isCurrentlyValid).filter((entry) => {
        const key = entry.fact.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((left, right) => right.confidence - left.confidence || right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
    },
  };
}
