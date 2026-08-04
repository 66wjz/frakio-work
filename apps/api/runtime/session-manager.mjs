const ACTIVE_RECOVERY_STATES = new Set(['opening', 'active', 'restoring', 'recovering']);

function legacyStatus(lifecycleState) {
  if (['opening', 'active', 'restoring', 'recovering'].includes(lifecycleState)) return 'active';
  if (lifecycleState === 'closed') return 'closed';
  if (lifecycleState === 'failed') return 'failed';
  return 'idle';
}

export function runtimeLane({ threadId, taskId = '', worktreeId = '' } = {}) {
  return taskId
    ? { type: 'work_task', id: String(taskId), worktreeId: String(worktreeId || taskId) }
    : { type: 'chat', id: String(threadId), worktreeId: '' };
}

export function createSessionManager({ store }) {
  function update(session, lifecycleState, patch = {}) {
    if (!session) return null;
    return store.upsertSession({
      ...session,
      ...patch,
      lifecycleState,
      status: legacyStatus(lifecycleState),
      lastError: patch.lastError === undefined ? session.lastError : patch.lastError,
    });
  }
  return {
    activate(input) {
      const lane = input.lane || runtimeLane(input);
      const session = store.upsertSession({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        agentId: input.agentId,
        workspaceId: input.workspaceId || '',
        laneType: lane.type,
        laneId: lane.id,
        worktreeId: lane.worktreeId,
        lifecycleState: 'opening',
        status: 'active',
        profileRevision: input.profileRevision || '',
        skillSetRevision: input.skillSetRevision || '',
        permissionPolicyRevision: input.permissionPolicyRevision || '',
        runtimeVersion: input.runtimeVersion || '',
        runtimeBuildId: input.runtimeBuildId || '',
        activationRevision: input.activationRevision || '',
        metadata: input.metadata || {},
      });
      return { session, lane, resumeCandidate: Boolean(session.nativeSessionId) };
    },
    markActive(session, patch = {}) {
      return update(session, 'active', { ...patch, lastError: '' });
    },
    park(session, patch = {}) {
      return update(session, 'parked', patch);
    },
    markRestoring(session, patch = {}) {
      return update(session, 'restoring', patch);
    },
    markRecovering(session, patch = {}) {
      return update(session, 'recovering', patch);
    },
    markStale(session, error = '') {
      return update(session, 'stale', { lastError: String(error || '') });
    },
    fail(session, error = '') {
      return update(session, 'failed', { lastError: String(error || ''), resumeStrategy: 'failed' });
    },
    recoverable() {
      return store.listSessions({ limit: 500 }).filter((session) => ACTIVE_RECOVERY_STATES.has(session.lifecycleState));
    },
    reconcileAfterRestart() {
      const changed = [];
      for (const session of this.recoverable()) {
        changed.push(session.nativeSessionId
          ? update(session, 'recovering', { checkpoint: { ...session.checkpoint, recoveredAfterRestart: true } })
          : session.checkpoint && Object.keys(session.checkpoint).length
            ? update(session, 'recovering', { resumeStrategy: 'handoff_resumed', checkpoint: { ...session.checkpoint, recoveredAfterRestart: true } })
            : update(session, 'stale', { lastError: 'The application stopped before a native session was established.' }));
      }
      return changed;
    },
  };
}
