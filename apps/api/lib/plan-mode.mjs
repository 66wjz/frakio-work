import { randomUUID } from 'node:crypto';

const planStatuses = new Set([
  'drafting',
  'waiting_input',
  'waiting_approval',
  'approved',
  'executing',
  'completed',
  'cancelled',
  'failed',
]);
const questionStatuses = new Set(['pending', 'resolved', 'cancelled', 'auto_resolved']);
const terminalPlanStatuses = new Set(['completed', 'cancelled']);

function iso(value, fallback) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function text(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function compactTitle(value, fallback) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) return fallback;
  if (source.length <= 28) return source;
  const segment = source.split(/[：:→|｜]/)[0].trim();
  return text(segment || source, 28) || fallback;
}

export function normalizePlanOption(option = {}, index = 0) {
  return {
    label: text(option.label, 80) || `选项 ${index + 1}`,
    description: text(option.description, 240),
    recommended: option.recommended === true,
  };
}

export function normalizePlanQuestion(question = {}, index = 0) {
  const options = (Array.isArray(question.options) ? question.options : [])
    .slice(0, 3)
    .map(normalizePlanOption);
  const recommendedIndex = Math.max(0, options.findIndex((option) => option.recommended));
  return {
    id: text(question.id, 100) || `question_${randomUUID()}`,
    header: text(question.header, 40) || `问题 ${index + 1}`,
    question: text(question.question, 600),
    options: options.map((option, optionIndex) => ({
      ...option,
      recommended: optionIndex === recommendedIndex,
    })),
  };
}

export function normalizePlanQuestionBatch(batch = {}, fallbackNow = new Date().toISOString()) {
  const createdAt = iso(batch.createdAt, fallbackNow);
  const answers = {};
  for (const [questionId, answer] of Object.entries(batch.answers || {})) {
    answers[text(questionId, 100)] = {
      ...(text(answer?.selectedLabel, 80) ? { selectedLabel: text(answer.selectedLabel, 80) } : {}),
      ...(text(answer?.note, 1200) ? { note: text(answer.note, 1200) } : {}),
    };
  }
  const autoResolutionMs = Number(batch.autoResolutionMs);
  return {
    id: text(batch.id, 100) || `plan_question_${randomUUID()}`,
    questions: (Array.isArray(batch.questions) ? batch.questions : []).slice(0, 3).map(normalizePlanQuestion),
    answers,
    status: questionStatuses.has(batch.status) ? batch.status : 'pending',
    ...(Number.isFinite(autoResolutionMs) && autoResolutionMs >= 60_000 && autoResolutionMs <= 240_000 ? { autoResolutionMs } : {}),
    createdAt,
    ...(batch.resolvedAt ? { resolvedAt: iso(batch.resolvedAt, fallbackNow) } : {}),
  };
}

export function normalizePlanStep(step = {}, index = 0) {
  return {
    key: text(step.key, 80) || `step_${index + 1}`,
    title: text(step.title, 160),
    displayTitle: text(step.displayTitle, 36) || compactTitle(step.title, `任务 ${index + 1}`),
    description: text(step.description, 2000),
    files: [...new Set((Array.isArray(step.files) ? step.files : []).map((item) => text(item, 500)).filter(Boolean))].slice(0, 80),
    ...(text(step.assigneeAgentId, 100) ? { assigneeAgentId: text(step.assigneeAgentId, 100) } : {}),
    expectedResult: text(step.expectedResult, 1000),
    dependsOnKeys: [...new Set((Array.isArray(step.dependsOnKeys) ? step.dependsOnKeys : []).map((item) => text(item, 80)).filter(Boolean))].slice(0, 80),
  };
}

export function normalizePlanDraft(draft = {}, fallbackNow = new Date().toISOString()) {
  return {
    revision: Math.max(1, Number(draft.revision) || 1),
    title: text(draft.title, 160),
    displayTitle: text(draft.displayTitle, 36) || compactTitle(draft.title, '协作方案'),
    summary: text(draft.summary, 4000),
    steps: (Array.isArray(draft.steps) ? draft.steps : []).slice(0, 100).map(normalizePlanStep),
    tests: (Array.isArray(draft.tests) ? draft.tests : []).map((item) => text(item, 1000)).filter(Boolean).slice(0, 100),
    assumptions: (Array.isArray(draft.assumptions) ? draft.assumptions : []).map((item) => text(item, 1000)).filter(Boolean).slice(0, 100),
    submittedByRunId: text(draft.submittedByRunId, 120),
    createdAt: iso(draft.createdAt, fallbackNow),
  };
}

export function normalizePlanSession(session = {}, fallbackNow = new Date().toISOString()) {
  const drafts = (Array.isArray(session.drafts) ? session.drafts : []).slice(-20).map((draft) => normalizePlanDraft(draft, fallbackNow));
  const currentRevision = Math.max(Number(session.currentRevision) || 0, ...drafts.map((draft) => draft.revision), 0);
  return {
    id: text(session.id, 120) || `plan_${randomUUID()}`,
    ...(session.readOnly === true ? { readOnly: true } : {}),
    purpose: session.purpose === 'collaboration' ? 'collaboration' : 'plan',
    targetExecutionMode: session.targetExecutionMode === 'work'
      ? 'work'
      : session.targetExecutionMode === 'collaboration' ? 'collaboration' : 'chat',
    ...(session.postApprovalIntent === 'collaboration' ? { postApprovalIntent: 'collaboration' } : {}),
    ...(text(session.workflowId, 120) ? { workflowId: text(session.workflowId, 120) } : {}),
    authorAgentId: text(session.authorAgentId, 100),
    status: planStatuses.has(session.status) ? session.status : 'drafting',
    currentRevision,
    drafts,
    questions: (Array.isArray(session.questions) ? session.questions : []).slice(-50).map((batch) => normalizePlanQuestionBatch(batch, fallbackNow)),
    ...(text(session.sourceRunId, 120) ? { sourceRunId: text(session.sourceRunId, 120) } : {}),
    ...(text(session.executionRunId, 120) ? { executionRunId: text(session.executionRunId, 120) } : {}),
    ...(text(session.error, 1000) ? { error: text(session.error, 1000) } : {}),
    submissionKeys: [...new Set((Array.isArray(session.submissionKeys) ? session.submissionKeys : []).map((item) => text(item, 160)).filter(Boolean))].slice(-100),
    createdAt: iso(session.createdAt, fallbackNow),
    updatedAt: iso(session.updatedAt, fallbackNow),
  };
}

export function normalizeThreadPlans(thread = {}, fallbackNow = new Date().toISOString()) {
  const sessions = (Array.isArray(thread.planSessions) ? thread.planSessions : [])
    .slice(-20)
    .map((session) => normalizePlanSession(session, fallbackNow));
  const requestedActiveId = text(thread.activePlanId, 120);
  const active = sessions.find((session) => session.id === requestedActiveId && !terminalPlanStatuses.has(session.status));
  return {
    collaborationMode: active
      ? active.purpose === 'collaboration' ? 'collaboration' : 'plan'
      : 'default',
    activePlanId: active?.id || '',
    planSessions: sessions,
  };
}

export function activePlanSession(thread = {}) {
  return (thread.planSessions || []).find((session) => session.id === thread.activePlanId) || null;
}

export function hasActivePlanningSession(thread = {}) {
  const session = activePlanSession(thread);
  return Boolean(session && !terminalPlanStatuses.has(session.status));
}

export function createPlanSession(thread, { authorAgentId = '', purpose = 'plan', targetExecutionMode, postApprovalIntent = '', workflowId = '', at = new Date().toISOString() } = {}) {
  const current = activePlanSession(thread);
  if (current && !terminalPlanStatuses.has(current.status)) return current;
  const session = normalizePlanSession({
    id: `plan_${randomUUID()}`,
    purpose: purpose === 'collaboration' ? 'collaboration' : 'plan',
    targetExecutionMode: targetExecutionMode === 'work'
      ? 'work'
      : targetExecutionMode === 'collaboration' ? 'collaboration' : 'chat',
    postApprovalIntent,
    workflowId,
    authorAgentId,
    status: 'drafting',
    currentRevision: 0,
    drafts: [],
    questions: [],
    createdAt: at,
    updatedAt: at,
  }, at);
  thread.planSessions = [...(thread.planSessions || []), session].slice(-20);
  thread.activePlanId = session.id;
  thread.collaborationMode = session.purpose === 'collaboration' ? 'collaboration' : 'plan';
  thread.updatedAt = at;
  return session;
}

export function validatePlanQuestionInput(input = {}) {
  const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 3).map(normalizePlanQuestion);
  if (questions.length < 1 || questions.length > 3) throw Object.assign(new Error('questions must contain one to three questions.'), { status: 400, code: 'PLAN_QUESTION_COUNT_INVALID' });
  for (const question of questions) {
    if (!question.header || !question.question) throw Object.assign(new Error('Every question requires header and question.'), { status: 400, code: 'PLAN_QUESTION_INVALID' });
    if (question.options.length < 2 || question.options.length > 3) throw Object.assign(new Error('Every question requires two or three options.'), { status: 400, code: 'PLAN_OPTION_COUNT_INVALID' });
    if (new Set(question.options.map((option) => option.label.toLowerCase())).size !== question.options.length) throw Object.assign(new Error('Question option labels must be unique.'), { status: 400, code: 'PLAN_OPTION_DUPLICATE' });
    if (question.options.some((option) => !option.description)) throw Object.assign(new Error('Every option requires a description.'), { status: 400, code: 'PLAN_OPTION_DESCRIPTION_REQUIRED' });
  }
  const autoResolutionMs = Number(input.autoResolutionMs);
  if (input.autoResolutionMs !== undefined && (!Number.isFinite(autoResolutionMs) || autoResolutionMs < 60_000 || autoResolutionMs > 240_000)) {
    throw Object.assign(new Error('autoResolutionMs must be between 60000 and 240000.'), { status: 400, code: 'PLAN_AUTO_RESOLUTION_INVALID' });
  }
  return { questions, ...(input.autoResolutionMs !== undefined ? { autoResolutionMs } : {}) };
}

export function createPlanQuestionBatch(session, input = {}, at = new Date().toISOString()) {
  if (!session || terminalPlanStatuses.has(session.status)) throw Object.assign(new Error('Plan session is not active.'), { status: 409, code: 'PLAN_NOT_ACTIVE' });
  if ((session.questions || []).some((batch) => batch.status === 'pending')) throw Object.assign(new Error('This Plan already has a pending question batch.'), { status: 409, code: 'PLAN_QUESTION_PENDING' });
  const validated = validatePlanQuestionInput(input);
  const batch = normalizePlanQuestionBatch({
    id: `plan_question_${randomUUID()}`,
    ...validated,
    answers: {},
    status: 'pending',
    createdAt: at,
  }, at);
  session.questions = [...(session.questions || []), batch].slice(-50);
  session.status = 'waiting_input';
  session.updatedAt = at;
  return batch;
}

export function resolvePlanQuestionBatch(session, requestId, rawAnswers = {}, at = new Date().toISOString()) {
  const batch = (session?.questions || []).find((item) => item.id === requestId);
  if (!batch) throw Object.assign(new Error('Plan question request does not exist.'), { status: 404, code: 'PLAN_QUESTION_NOT_FOUND' });
  if (batch.status !== 'pending') return batch;
  const answers = {};
  for (const question of batch.questions) {
    const answer = rawAnswers[question.id] || {};
    const selectedLabel = text(answer.selectedLabel, 80);
    const note = text(answer.note, 1200);
    if (!selectedLabel && !note) throw Object.assign(new Error(`Question ${question.id} requires an answer.`), { status: 400, code: 'PLAN_ANSWER_REQUIRED' });
    if (selectedLabel && !question.options.some((option) => option.label === selectedLabel)) throw Object.assign(new Error(`Question ${question.id} selected an unknown option.`), { status: 400, code: 'PLAN_ANSWER_OPTION_INVALID' });
    answers[question.id] = { ...(selectedLabel ? { selectedLabel } : {}), ...(note ? { note } : {}) };
  }
  batch.answers = answers;
  batch.status = 'resolved';
  batch.resolvedAt = at;
  session.status = 'drafting';
  session.updatedAt = at;
  return batch;
}

export function autoResolvePlanQuestionBatch(session, requestId, at = new Date().toISOString()) {
  const batch = (session?.questions || []).find((item) => item.id === requestId);
  if (!batch || batch.status !== 'pending' || !batch.autoResolutionMs) return batch || null;
  if (Date.now() - Date.parse(batch.createdAt) < batch.autoResolutionMs) return batch;
  batch.answers = Object.fromEntries(batch.questions.map((question) => [
    question.id,
    { selectedLabel: question.options.find((option) => option.recommended)?.label || question.options[0]?.label || '' },
  ]));
  batch.status = 'auto_resolved';
  batch.resolvedAt = at;
  session.status = 'drafting';
  session.updatedAt = at;
  return batch;
}

export function cancelPlanQuestionBatch(session, requestId, at = new Date().toISOString()) {
  const batch = (session?.questions || []).find((item) => item.id === requestId);
  if (!batch) throw Object.assign(new Error('Plan question request does not exist.'), { status: 404, code: 'PLAN_QUESTION_NOT_FOUND' });
  if (batch.status === 'cancelled') return batch;
  if (batch.status !== 'pending') throw Object.assign(new Error('Plan question request is no longer pending.'), { status: 409, code: 'PLAN_QUESTION_NOT_PENDING' });
  batch.status = 'cancelled';
  batch.resolvedAt = at;
  session.status = 'drafting';
  session.updatedAt = at;
  return batch;
}

function assertAcyclic(steps) {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) throw Object.assign(new Error('Plan dependencies contain a cycle.'), { status: 400, code: 'PLAN_DEPENDENCY_CYCLE' });
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOnKeys || []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const step of steps) visit(step.key);
}

export function validatePlanDraftInput(input = {}, { targetExecutionMode = 'chat', agentIds = [] } = {}) {
  const title = text(input.title, 160);
  const summary = text(input.summary, 4000);
  const steps = (Array.isArray(input.steps) ? input.steps : []).slice(0, 100).map(normalizePlanStep);
  if (!title || !summary || !steps.length) throw Object.assign(new Error('title, summary and at least one step are required.'), { status: 400, code: 'PLAN_DRAFT_INVALID' });
  if (steps.some((step) => !step.key || !step.title || !step.description || !step.expectedResult)) throw Object.assign(new Error('Every step requires key, title, description and expectedResult.'), { status: 400, code: 'PLAN_STEP_INVALID' });
  const keys = new Set(steps.map((step) => step.key));
  if (keys.size !== steps.length) throw Object.assign(new Error('Plan step keys must be unique.'), { status: 400, code: 'PLAN_STEP_KEY_DUPLICATE' });
  for (const step of steps) {
    if (step.dependsOnKeys.includes(step.key) || step.dependsOnKeys.some((key) => !keys.has(key))) throw Object.assign(new Error(`Plan step ${step.key} has an invalid dependency.`), { status: 400, code: 'PLAN_DEPENDENCY_INVALID' });
  }
  if (targetExecutionMode === 'work' || targetExecutionMode === 'collaboration') {
    const allowedAgents = new Set(agentIds);
    if (steps.some((step) => !step.assigneeAgentId || !allowedAgents.has(step.assigneeAgentId))) throw Object.assign(new Error('Every Work plan step requires a valid assigneeAgentId.'), { status: 400, code: 'PLAN_ASSIGNEE_INVALID' });
  }
  assertAcyclic(steps);
  return {
    title,
    displayTitle: text(input.displayTitle, 36) || compactTitle(title, '协作方案'),
    summary,
    steps,
    tests: (Array.isArray(input.tests) ? input.tests : []).map((item) => text(item, 1000)).filter(Boolean).slice(0, 100),
    assumptions: (Array.isArray(input.assumptions) ? input.assumptions : []).map((item) => text(item, 1000)).filter(Boolean).slice(0, 100),
  };
}

export function submitPlanDraft(session, input = {}, options = {}, at = new Date().toISOString()) {
  if (!session || terminalPlanStatuses.has(session.status)) throw Object.assign(new Error('Plan session is not active.'), { status: 409, code: 'PLAN_NOT_ACTIVE' });
  const baseRevision = Math.max(0, Number(input.baseRevision) || 0);
  const idempotencyKey = text(input.idempotencyKey, 160);
  if (!idempotencyKey) throw Object.assign(new Error('idempotencyKey is required.'), { status: 400, code: 'PLAN_IDEMPOTENCY_REQUIRED' });
  if ((session.submissionKeys || []).includes(idempotencyKey)) return session.drafts.find((draft) => draft.idempotencyKey === idempotencyKey) || session.drafts.at(-1);
  if (baseRevision !== Number(session.currentRevision || 0)) throw Object.assign(new Error('Plan baseRevision is stale.'), { status: 409, code: 'PLAN_REVISION_CONFLICT', details: { currentRevision: session.currentRevision } });
  const validated = validatePlanDraftInput(input, { targetExecutionMode: session.targetExecutionMode, agentIds: options.agentIds || [] });
  const draft = {
    revision: baseRevision + 1,
    ...validated,
    submittedByRunId: text(options.submittedByRunId, 120),
    idempotencyKey,
    createdAt: at,
  };
  session.drafts = [...(session.drafts || []), draft].slice(-20);
  session.submissionKeys = [...(session.submissionKeys || []), idempotencyKey].slice(-100);
  session.currentRevision = draft.revision;
  session.status = 'waiting_approval';
  session.sourceRunId = draft.submittedByRunId || session.sourceRunId;
  session.error = '';
  session.updatedAt = at;
  return draft;
}

export function cancelPlanSession(thread, session, at = new Date().toISOString()) {
  if (!session) return null;
  for (const batch of session.questions || []) {
    if (batch.status === 'pending') {
      batch.status = 'cancelled';
      batch.resolvedAt = at;
    }
  }
  session.status = 'cancelled';
  session.updatedAt = at;
  thread.collaborationMode = 'default';
  thread.activePlanId = '';
  thread.updatedAt = at;
  return session;
}

export function latestPlanDraft(session) {
  return session?.drafts?.find((draft) => draft.revision === session.currentRevision) || session?.drafts?.at(-1) || null;
}

export function publicPlanSession(session) {
  if (!session) return null;
  const { submissionKeys: _submissionKeys, ...publicSession } = session;
  return {
    ...publicSession,
    drafts: (publicSession.drafts || []).map(({ idempotencyKey: _idempotencyKey, ...draft }) => draft),
  };
}
