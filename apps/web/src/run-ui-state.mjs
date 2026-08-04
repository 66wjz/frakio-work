const approvalChoices = new Set(['once', 'session', 'always', 'deny']);

function firstString(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

export function normalizeApprovalPresentation(value) {
  if (!value || typeof value !== 'object') return { approval: null, missingId: false };
  const raw = value.raw && typeof value.raw === 'object' ? value.raw : {};
  const id = firstString(value.id, value.approvalId, value.approval_id, raw.id, raw.approvalId, raw.approval_id);
  if (!id) return { approval: null, missingId: true };
  const choices = Array.isArray(value.choices)
    ? value.choices.map(String).filter((choice) => approvalChoices.has(choice))
    : undefined;
  return {
    missingId: false,
    approval: {
      id,
      title: firstString(value.title, value.description, raw.title, raw.description) || '需要确认',
      command: firstString(value.command, value.commandPreview, raw.command, raw.commandPreview),
      cwd: firstString(value.cwd, raw.cwd),
      tool: firstString(value.tool, value.toolName, raw.tool, raw.toolName),
      ...(choices?.length ? { choices } : {}),
      ...(typeof value.allowPermanent === 'boolean' ? { allowPermanent: value.allowPermanent } : {}),
      ...(value.smartDenied ? { smartDenied: true } : {}),
    },
  };
}

export function normalizeClarificationPresentation(value) {
  if (!value || typeof value !== 'object') return { clarification: null, missingId: false };
  const raw = value.raw && typeof value.raw === 'object' ? value.raw : {};
  const id = firstString(value.id, value.clarifyId, value.clarify_id, raw.id, raw.clarifyId, raw.clarify_id);
  if (!id) return { clarification: null, missingId: true };
  return {
    missingId: false,
    clarification: {
      id,
      question: firstString(value.question, raw.question) || '需要你补充一个选择',
      choices: Array.isArray(value.choices) ? value.choices.map(String).filter(Boolean) : [],
      ...(Number(value.timeoutMs || value.timeout_ms || raw.timeoutMs || raw.timeout_ms) > 0
        ? { timeoutMs: Number(value.timeoutMs || value.timeout_ms || raw.timeoutMs || raw.timeout_ms) }
        : {}),
    },
  };
}

export function mergeThreadWithPendingMessages(current, incoming, pendingMessageIds = []) {
  if (!current || !incoming || current.id !== incoming.id) return incoming;
  const incomingIds = new Set((incoming.messages || []).map((message) => message.id));
  const pendingIds = new Set(pendingMessageIds);
  const pending = (current.messages || []).filter((message) => pendingIds.has(message.id) && !incomingIds.has(message.id));
  return pending.length ? { ...incoming, messages: [...(incoming.messages || []), ...pending] } : incoming;
}

export function canApplyPresentation(currentRevision, nextRevision) {
  return Number(nextRevision || 0) >= Number(currentRevision || 0);
}

export function canApplyRuntimeCursor(currentCursor, nextCursor) {
  const cursor = Number(nextCursor || 0);
  return !cursor || cursor > Number(currentCursor || 0);
}

export function canApplyRunSnapshot(terminalRunId, nextRunId, nextStatus) {
  const terminal = String(terminalRunId || '');
  const next = String(nextRunId || '');
  if (!terminal || terminal !== next) return true;
  return ['completed', 'failed', 'cancelled'].includes(String(nextStatus || ''));
}
