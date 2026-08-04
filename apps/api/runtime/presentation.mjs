import { normalizeRunActivityItem, summarizeActivityItems } from '../lib/run-activity.mjs';

function nextActivityGroups(groups, payload, status) {
  const item = normalizeRunActivityItem(payload || {}, status);
  const current = Array.isArray(groups) ? groups.map((group) => ({ ...group, items: [...(group.items || [])] })) : [];
  const index = current.findIndex((group) => group.items.some((candidate) => candidate.id === item.id));
  if (index >= 0) {
    const group = current[index];
    group.items = group.items.map((candidate) => candidate.id === item.id ? { ...candidate, ...item } : candidate);
    group.status = group.items.some((candidate) => candidate.status === 'failed') ? 'failed'
      : group.items.some((candidate) => candidate.status === 'running') ? 'running'
        : group.items.some((candidate) => candidate.status === 'cancelled') ? 'cancelled' : 'completed';
    group.summary = summarizeActivityItems(group.items, group.status === 'running');
    group.updatedAt = item.updatedAt;
    return current;
  }
  current.push({
    id: `group-${item.id}`,
    contentOffset: 0,
    status: item.status,
    summary: summarizeActivityItems([item], item.status === 'running'),
    items: [item],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  return current.slice(-100);
}

function normalizedApproval(payload = {}) {
  const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const id = String(payload.id || payload.approvalId || payload.approval_id || raw.id || raw.approvalId || raw.approval_id || '').trim();
  return {
    ...payload,
    id,
    approvalId: id,
    title: payload.title || payload.description || raw.title || raw.description || '需要确认',
    command: payload.command || payload.commandPreview || raw.command || raw.commandPreview || '',
    cwd: payload.cwd || raw.cwd || '',
    tool: payload.tool || payload.toolName || raw.tool || raw.toolName || '',
  };
}

export function reduceRunPresentation(previous, event, run) {
  const current = previous || {
    runId: run.id,
    revision: 0,
    lastCursor: 0,
    status: run.status,
    phase: run.phase,
    content: '',
    activityGroups: [],
    approval: null,
    clarification: null,
    compaction: null,
    error: '',
  };
  const payload = event.payload || {};
  const next = { ...current, revision: current.revision + 1, lastCursor: event.cursor, status: run.status, phase: run.phase, updatedAt: event.createdAt };
  if (event.type === 'run.started' || event.type === 'approval.resolved') next.status = 'running';
  if (event.type === 'run.interrupting') next.status = 'interrupting';
  if (event.type === 'message.delta') next.content = `${current.content}${String(payload.delta || '')}`;
  if (event.type === 'tool.started' || event.type === 'tool.updated') {
    next.activityGroups = nextActivityGroups(current.activityGroups, payload, 'running');
    next.phase = 'tool';
  }
  if (event.type === 'tool.completed') {
    next.activityGroups = nextActivityGroups(current.activityGroups, payload, payload.error ? 'failed' : 'completed');
    next.phase = 'model';
  }
  if (event.type === 'approval.requested') { next.approval = normalizedApproval(payload); next.phase = 'approval'; }
  if (event.type === 'approval.resolved') { next.approval = null; next.phase = 'model'; }
  if (event.type === 'context.compaction.started' || event.type === 'context.compaction.completed' || event.type === 'context.compaction.failed') {
    next.compaction = { ...payload, status: event.type.endsWith('started') ? 'running' : event.type.endsWith('failed') ? 'failed' : 'completed' };
    next.phase = event.type.endsWith('started') ? 'compaction' : 'model';
  }
  if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
    next.status = event.type === 'run.completed' ? 'completed' : event.type === 'run.cancelled' ? 'cancelled' : 'failed';
    next.error = String(payload.error || '');
    next.approval = null;
    next.clarification = null;
    next.activityGroups = next.activityGroups.map((group) => ({
      ...group,
      status: group.status === 'running' ? (next.status === 'failed' ? 'failed' : next.status === 'cancelled' ? 'cancelled' : 'completed') : group.status,
      items: group.items.map((item) => item.status === 'running' ? { ...item, status: next.status === 'failed' ? 'failed' : next.status === 'cancelled' ? 'cancelled' : 'completed' } : item),
    }));
  }
  return next;
}
