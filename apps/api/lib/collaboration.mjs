const workflowStatuses = new Set(['active', 'paused', 'completed', 'failed', 'cancelled', 'archived']);
const workflowControlStates = new Set(['idle', 'pausing', 'paused', 'resuming', 'cancelling', 'cancelled', 'pause_failed']);
export const MAX_COLLABORATION_TASKS = 64;
export const MAX_COLLABORATION_DEPENDENCY_DEPTH = 16;
export const MAX_COLLABORATION_EVENT_BYTES = 64 * 1024;

export function collaborationSchedulerKind(state = {}) {
  return state?.features?.collaborationV2 === false ? 'legacy' : 'frakio';
}

export const collaborationEventTypes = new Set([
  'task.created',
  'task.started',
  'task.waiting',
  'task.resumed',
  'task.completed',
  'task.review',
  'task.failed',
  'task.cancelled',
  'dependency.created',
  'dependency.satisfied',
  'artifact.published',
  'artifact.conflict',
  'escalation.started',
  'escalation.resolved',
  'human.required',
  'intervention.sent',
  'workflow.created',
  'workflow.completed',
  'workflow.failed',
  'workflow.finalization_requested',
  'workflow.finalization_started',
  'workflow.delivery_ready',
  'workflow.finalization_failed',
  'workflow.pause_started',
  'workflow.paused',
  'workflow.pause_failed',
  'workflow.resume_started',
  'workflow.resumed',
  'workflow.cancelled',
  'workflow.archived',
  'mode.changed',
  'plan.published',
  'plan.revised',
  'capability.blocked',
]);

function boundedEventPayload(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded) <= MAX_COLLABORATION_EVENT_BYTES) return payload;
  const compact = {};
  for (const [key, entry] of Object.entries(payload).slice(0, 80)) {
    if (typeof entry === 'string') compact[key] = entry.slice(0, 4000);
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry == null) compact[key] = entry;
    else if (Array.isArray(entry)) compact[key] = entry.slice(0, 40).map((item) => typeof item === 'string' ? item.slice(0, 1000) : item);
  }
  compact.truncated = true;
  compact.originalBytes = Buffer.byteLength(encoded);
  const compactEncoded = JSON.stringify(compact);
  return Buffer.byteLength(compactEncoded) <= MAX_COLLABORATION_EVENT_BYTES
    ? compact
    : { truncated: true, originalBytes: Buffer.byteLength(encoded), preview: compactEncoded.slice(0, 48000) };
}

export function assertCollaborationGraphLimits(tasks = [], { reserve = 0 } = {}) {
  if (tasks.length + reserve > MAX_COLLABORATION_TASKS) {
    throw Object.assign(new Error(`Workflow task limit exceeded: ${MAX_COLLABORATION_TASKS}`), { status: 409, code: 'WORKFLOW_TASK_LIMIT' });
  }
  const byId = new Map(tasks.map((task) => [String(task.id || task.key || ''), task]));
  const visiting = new Set();
  const depths = new Map();
  const depth = (id) => {
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) throw Object.assign(new Error(`Dependency cycle detected at ${id}`), { status: 409, code: 'PLAN_DEPENDENCY_CYCLE' });
    visiting.add(id);
    const task = byId.get(id);
    const dependencies = task?.dependencies || task?.dependsOnKeys || [];
    const value = dependencies.length ? 1 + Math.max(...dependencies.map((dependencyId) => depth(String(dependencyId)))) : 1;
    visiting.delete(id);
    depths.set(id, value);
    return value;
  };
  const maximumDepth = Math.max(0, ...byId.keys().map(depth));
  if (maximumDepth > MAX_COLLABORATION_DEPENDENCY_DEPTH) {
    throw Object.assign(new Error(`Workflow dependency depth limit exceeded: ${MAX_COLLABORATION_DEPENDENCY_DEPTH}`), { status: 409, code: 'WORKFLOW_DEPENDENCY_DEPTH_LIMIT' });
  }
  return { taskCount: tasks.length + reserve, maximumDepth };
}

export function normalizeWorkflow(workflow = {}, fallback = {}) {
  const status = workflowStatuses.has(workflow.status) ? workflow.status : 'active';
  const rawControl = workflow.control && typeof workflow.control === 'object' ? workflow.control : {};
  const controlState = workflowControlStates.has(rawControl.state) ? rawControl.state : status === 'paused' ? 'paused' : status === 'cancelled' ? 'cancelled' : 'idle';
  return {
    id: String(workflow.id || fallback.id || ''),
    name: String(workflow.name || fallback.name || '协作工作流').slice(0, 120),
    boardSlug: workflow.nativeOnly === true ? '' : String(workflow.boardSlug || fallback.boardSlug || 'default'),
    nativeOnly: workflow.nativeOnly === true,
    status,
    coordinatorAgentId: String(workflow.coordinatorAgentId || fallback.coordinatorAgentId || ''),
    fallbackDecisionAgentId: String(workflow.fallbackDecisionAgentId || fallback.fallbackDecisionAgentId || ''),
    rootTaskIds: [...new Set((Array.isArray(workflow.rootTaskIds) ? workflow.rootTaskIds : []).map(String).filter(Boolean))],
    currentRootTaskId: String(workflow.currentRootTaskId || ''),
    approvedPlanId: String(workflow.approvedPlanId || workflow.plan?.approvedPlanId || ''),
    approvedPlanRevision: Math.max(0, Math.floor(Number(workflow.approvedPlanRevision || workflow.plan?.approvedPlanRevision || 0))),
    planRevision: Math.max(0, Math.floor(Number(workflow.planRevision || 0))),
    plan: workflow.plan && typeof workflow.plan === 'object' ? workflow.plan : null,
    executionBindings: workflow.executionBindings && typeof workflow.executionBindings === 'object' ? workflow.executionBindings : {},
    interventionQueue: (Array.isArray(workflow.interventionQueue) ? workflow.interventionQueue : []).slice(-200),
    control: {
      operationId: String(rawControl.operationId || ''),
      idempotencyKey: String(rawControl.idempotencyKey || ''),
      action: ['pause', 'resume', 'cancel'].includes(rawControl.action) ? rawControl.action : '',
      state: controlState,
      affectedTaskIds: [...new Set((Array.isArray(rawControl.affectedTaskIds) ? rawControl.affectedTaskIds : []).map(String).filter(Boolean))],
      stoppedRuns: Math.max(0, Number(rawControl.stoppedRuns || 0)),
      pendingRunIds: [...new Set((Array.isArray(rawControl.pendingRunIds) ? rawControl.pendingRunIds : []).map(String).filter(Boolean))],
      deferredRunIds: [...new Set((Array.isArray(rawControl.deferredRunIds) ? rawControl.deferredRunIds : []).map(String).filter(Boolean))],
      blockedTasks: Math.max(0, Number(rawControl.blockedTasks || 0)),
      preservedWaitingTasks: Math.max(0, Number(rawControl.preservedWaitingTasks || 0)),
      failedTaskIds: [...new Set((Array.isArray(rawControl.failedTaskIds) ? rawControl.failedTaskIds : []).map(String).filter(Boolean))],
      heldInterventionCount: Math.max(0, Number(rawControl.heldInterventionCount || 0)),
      startedAt: rawControl.startedAt || null,
      completedAt: rawControl.completedAt || null,
      error: String(rawControl.error || ''),
    },
    capability: workflow.capability && typeof workflow.capability === 'object' ? workflow.capability : { status: 'unknown', protocolVersion: 0, error: '' },
    createdAt: String(workflow.createdAt || fallback.createdAt || new Date().toISOString()),
    updatedAt: String(workflow.updatedAt || fallback.updatedAt || new Date().toISOString()),
    completedAt: workflow.completedAt || null,
    pausedAt: workflow.pausedAt || null,
    cancelledAt: workflow.cancelledAt || null,
    archivedAt: workflow.archivedAt || null,
    finalization: {
      state: ['idle', 'requested', 'running', 'delivered', 'failed'].includes(workflow.finalization?.state) ? workflow.finalization.state : 'idle',
      requestedAt: workflow.finalization?.requestedAt || null,
      startedAt: workflow.finalization?.startedAt || null,
      deliveredAt: workflow.finalization?.deliveredAt || null,
      failedAt: workflow.finalization?.failedAt || null,
      deliveryMessageId: String(workflow.finalization?.deliveryMessageId || ''),
      runId: String(workflow.finalization?.runId || ''),
      error: String(workflow.finalization?.error || ''),
    },
    finalDelivery: workflow.finalDelivery && typeof workflow.finalDelivery === 'object' ? {
      status: ['pending', 'ready', 'failed'].includes(workflow.finalDelivery.status) ? workflow.finalDelivery.status : 'pending',
      summary: String(workflow.finalDelivery.summary || ''),
      content: String(workflow.finalDelivery.content || ''),
      coordinatorAgentId: String(workflow.finalDelivery.coordinatorAgentId || workflow.coordinatorAgentId || fallback.coordinatorAgentId || ''),
      sourceTaskIds: [...new Set((Array.isArray(workflow.finalDelivery.sourceTaskIds) ? workflow.finalDelivery.sourceTaskIds : []).map(String).filter(Boolean))],
      runId: String(workflow.finalDelivery.runId || ''),
      messageId: String(workflow.finalDelivery.messageId || ''),
      createdAt: workflow.finalDelivery.createdAt || null,
      error: String(workflow.finalDelivery.error || ''),
    } : { status: 'pending', summary: '', content: '', coordinatorAgentId: String(workflow.coordinatorAgentId || fallback.coordinatorAgentId || ''), sourceTaskIds: [], runId: '', messageId: '', createdAt: null, error: '' },
    taskStatusProjection: workflow.taskStatusProjection && typeof workflow.taskStatusProjection === 'object' ? workflow.taskStatusProjection : {},
  };
}

export function validateCollaborationPlan(input = {}, { agentIds = [], currentRevision = 0, rootTaskId = '' } = {}) {
  const baseRevision = Math.max(0, Math.floor(Number(input.baseRevision || 0)));
  if (baseRevision !== currentRevision) {
    const error = new Error(`Plan revision conflict: expected ${currentRevision}, received ${baseRevision}`);
    error.status = 409;
    error.code = 'PLAN_REVISION_CONFLICT';
    throw error;
  }
  if (rootTaskId && String(input.rootTaskId || '') !== rootTaskId) {
    const error = new Error('rootTaskId does not match the active root task.');
    error.status = 409;
    error.code = 'PLAN_ROOT_MISMATCH';
    throw error;
  }
  const allowedAgents = new Set(agentIds.map(String));
  const sourceTasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (!sourceTasks.length) {
    const error = new Error('Execution plan requires at least one task.');
    error.status = 400;
    error.code = 'PLAN_TASKS_REQUIRED';
    throw error;
  }
  const keys = new Set();
  const tasks = sourceTasks.map((task, index) => {
    const key = String(task?.key || '').trim();
    const title = String(task?.title || '').trim().slice(0, 160);
    const assigneeAgentId = String(task?.assigneeAgentId || '').trim();
    if (!key || !/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw Object.assign(new Error(`Task ${index + 1} has an invalid stable key.`), { status: 400, code: 'PLAN_TASK_KEY_INVALID' });
    if (keys.has(key)) throw Object.assign(new Error(`Duplicate task key: ${key}`), { status: 409, code: 'PLAN_TASK_KEY_DUPLICATE' });
    if (!title) throw Object.assign(new Error(`Task ${key} requires a title.`), { status: 400, code: 'PLAN_TASK_TITLE_REQUIRED' });
    if (!allowedAgents.has(assigneeAgentId)) throw Object.assign(new Error(`Task ${key} references an unavailable Agent: ${assigneeAgentId}`), { status: 400, code: 'PLAN_AGENT_INVALID' });
    keys.add(key);
    return {
      key,
      title,
      description: String(task?.description || '').trim().slice(0, 4000),
      assigneeAgentId,
      expectedResult: String(task?.expectedResult || '').trim().slice(0, 2000),
      dependsOnKeys: [...new Set((Array.isArray(task?.dependsOnKeys) ? task.dependsOnKeys : []).map(String).filter(Boolean))],
      cancelled: Boolean(task?.cancelled),
    };
  });
  for (const task of tasks) {
    for (const dependency of task.dependsOnKeys) {
      if (!keys.has(dependency)) throw Object.assign(new Error(`Task ${task.key} depends on an unknown key: ${dependency}`), { status: 400, code: 'PLAN_DEPENDENCY_UNKNOWN' });
      if (dependency === task.key) throw Object.assign(new Error(`Task ${task.key} cannot depend on itself.`), { status: 409, code: 'PLAN_DEPENDENCY_CYCLE' });
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const visit = (key) => {
    if (visiting.has(key)) throw Object.assign(new Error(`Plan dependency cycle detected at ${key}.`), { status: 409, code: 'PLAN_DEPENDENCY_CYCLE' });
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOnKeys || []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of tasks) visit(task.key);
  assertCollaborationGraphLimits(tasks, { reserve: rootTaskId ? 1 : 0 });
  return {
    rootTaskId: String(input.rootTaskId || rootTaskId || ''),
    baseRevision,
    summary: String(input.summary || '').trim().slice(0, 4000),
    goal: String(input.goal || '').trim().slice(0, 1000),
    tasks,
  };
}

export function diffCollaborationPlans(previous, next) {
  const before = new Map((previous?.tasks || []).map((task) => [task.key, task]));
  const after = new Map((next?.tasks || []).map((task) => [task.key, task]));
  const added = [];
  const changed = [];
  const cancelled = [];
  for (const [key, task] of after) {
    const oldTask = before.get(key);
    if (!oldTask) added.push(key);
    else if (task.cancelled && !oldTask.cancelled) cancelled.push(key);
    else if (JSON.stringify(oldTask) !== JSON.stringify(task)) changed.push(key);
  }
  for (const key of before.keys()) if (!after.has(key)) cancelled.push(key);
  return { added, changed, cancelled: [...new Set(cancelled)] };
}

export function normalizeThreadCollaboration(collaboration = {}, fallback = {}) {
  const workflows = (Array.isArray(collaboration.workflows) ? collaboration.workflows : [])
    .map((workflow) => normalizeWorkflow(workflow, fallback))
    .filter((workflow) => workflow.id);
  const activeWorkflowId = workflows.some((workflow) => workflow.id === collaboration.activeWorkflowId && ['active', 'paused'].includes(workflow.status))
    ? collaboration.activeWorkflowId
    : workflows.find((workflow) => ['active', 'paused'].includes(workflow.status))?.id || '';
  const rawEvents = Array.isArray(collaboration.events) ? collaboration.events : [];
  const events = rawEvents
    .filter((event) => event && collaborationEventTypes.has(event.type))
    .slice(-1000)
    .map((event, index) => ({
      id: String(event.id || `legacy-${index + 1}`),
      cursor: Math.max(1, Number(event.cursor || index + 1)),
      type: event.type,
      workflowId: String(event.workflowId || ''),
      taskId: String(event.taskId || ''),
      actorAgentId: String(event.actorAgentId || ''),
      title: String(event.title || '').slice(0, 240),
      detail: String(event.detail || '').slice(0, 2000),
      payload: boundedEventPayload(event.payload),
      createdAt: String(event.createdAt || new Date().toISOString()),
    }));
  const maxCursor = events.reduce((max, event) => Math.max(max, Number(event.cursor || 0)), 0);
  const idempotencyEntries = Object.entries(collaboration.idempotency || {}).slice(-200);
  return {
    kind: collaboration.kind || fallback.kind || 'workspace-group-chat',
    lastMentionedAgentId: collaboration.lastMentionedAgentId || null,
    lastMentionedAgentName: collaboration.lastMentionedAgentName || '',
    activeAgentId: collaboration.activeAgentId || fallback.activeAgentId || fallback.defaultAgentId || null,
    maxMentionDepth: collaboration.maxMentionDepth ?? fallback.maxMentionDepth ?? 2,
    lastRoutedAt: collaboration.lastRoutedAt || null,
    lastRouteReason: collaboration.lastRouteReason || '',
    workflows,
    activeWorkflowId,
    eventCursor: Math.max(Number(collaboration.eventCursor || 0), maxCursor),
    events,
    idempotency: Object.fromEntries(idempotencyEntries),
  };
}

export function appendCollaborationEvent(collaboration, event, createId = () => crypto.randomUUID()) {
  if (!collaborationEventTypes.has(event.type)) throw new Error(`Unsupported collaboration event type: ${event.type}`);
  const cursor = Math.max(0, Number(collaboration.eventCursor || 0)) + 1;
  const next = {
    id: String(event.id || createId()),
    cursor,
    type: event.type,
    workflowId: String(event.workflowId || collaboration.activeWorkflowId || ''),
    taskId: String(event.taskId || ''),
    actorAgentId: String(event.actorAgentId || ''),
    title: String(event.title || '').slice(0, 240),
    detail: String(event.detail || '').slice(0, 2000),
    payload: boundedEventPayload(event.payload),
    createdAt: String(event.createdAt || new Date().toISOString()),
  };
  collaboration.eventCursor = cursor;
  collaboration.events = [...(collaboration.events || []), next].slice(-1000);
  return next;
}

export function collaborationEventsAfter(collaboration, cursor = 0, workflowId = '') {
  return (collaboration.events || []).filter((event) => Number(event.cursor || 0) > Number(cursor || 0) && (!workflowId || event.workflowId === workflowId));
}

export function runtimeTaskTerminalWriteAllowed(run, task, binding) {
  if (!run || !task || !['running', 'waiting_input'].includes(task.status) || !binding) return false;
  const runLease = String(run.metadata?.leaseToken || binding.leaseToken || '');
  const taskLease = String(task.leaseToken || '');
  return Boolean(runLease && taskLease && runLease === taskLease && binding.leaseToken === taskLease && binding.runId === run.id && binding.taskId === task.id);
}

export function collaborationRunStatus(status) {
  return ({
    queued: 'queued',
    starting: 'starting',
    running: 'running',
    waiting_approval: 'running',
    interrupting: 'running',
    parked: 'parked',
    completed: 'ended',
    cancelled: 'aborted',
    aborted: 'aborted',
    failed: 'failed',
  })[String(status || '')] || 'failed';
}

export function taskStatusEvent(previous, next) {
  if (!next || previous?.status === next.status) return null;
  const eventByStatus = {
    running: 'task.started',
    blocked: 'task.waiting',
    waiting_dependency: 'task.waiting',
    waiting_input: 'task.waiting',
    ready: ['blocked', 'todo', 'waiting_dependency', 'waiting_input', 'paused'].includes(previous?.status) ? 'task.resumed' : null,
    done: 'task.completed',
    completed: 'task.completed',
    review: 'task.review',
    failed: 'task.failed',
  };
  const type = eventByStatus[next.status] || null;
  if (!type) return null;
  return { type, taskId: next.id, title: next.title || next.id, detail: next.result || next.body || '' };
}

export function boardLifecycle(tasks = []) {
  const visible = tasks.filter((task) => task.status !== 'archived');
  if (!visible.length) return 'active';
  return visible.every((task) => ['done', 'completed'].includes(task.status)) ? 'completed' : 'active';
}
