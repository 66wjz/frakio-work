const IMMEDIATE_TYPES = new Set([
  'run.accepted', 'run.started', 'session.opening', 'session.parked', 'session.resume_started', 'session.resumed', 'session.resume_failed',
  'context.compaction.started', 'context.compaction.completed', 'context.compaction.failed', 'session.checkpoint.created', 'session.recovered',
  'tool.started', 'tool.completed', 'approval.requested', 'approval.resolved', 'skill.applied', 'skill.apply_failed',
  'run.interrupting', 'run.completed', 'run.failed', 'run.cancelled',
]);

export function createEventJournal({ store, onAppend = null }) {
  return {
    append(input) {
      const event = store.appendEvent({ ...input, immediate: input.immediate ?? IMMEDIATE_TYPES.has(input.type) });
      if (input.hostVisible) {
        try { onAppend?.(event); } catch { /* UI delivery must not affect durable runtime state. */ }
      }
      return event;
    },
    eventsAfter(runId, cursor = 0, limit = 1000) {
      return store.eventsAfter(runId, cursor, limit);
    },
  };
}
