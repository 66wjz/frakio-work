import { createHash, randomUUID } from 'node:crypto';

const HARD_BOUNDARY_CATEGORIES = new Set(['payment', 'authorization', 'delete', 'publish']);

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizePermissionMode(mode = 'smart') {
  if (mode === 'manual' || mode === 'ask_all') return 'ask_all';
  if (mode === 'off' || mode === 'full_access') return 'full_access';
  return 'risk_based';
}

export function legacyPermissionMode(mode = 'risk_based') {
  if (mode === 'ask_all') return 'manual';
  if (mode === 'full_access') return 'off';
  return 'smart';
}

export function permissionPolicySnapshot({ mode = 'smart', agentId = '', workspaceId = '', planMode = false, permissionProfileId = 'default' } = {}) {
  const internalMode = normalizePermissionMode(mode);
  const snapshot = {
    mode: internalMode,
    agentId: String(agentId || ''),
    workspaceId: String(workspaceId || ''),
    planMode: Boolean(planMode),
    permissionProfileId: String(permissionProfileId || 'default'),
  };
  return { ...snapshot, revision: stableHash(snapshot) };
}

export function permissionCoverageForRuntime(runtimeId, capabilities = {}) {
  if (runtimeId === 'pi') return 'partial';
  if (capabilities.approvals === true) return 'native_enforced';
  if (capabilities.tools === true) return 'partial';
  return 'unobservable';
}

export function createToolIntent(input = {}) {
  const category = ['read', 'write', 'command', 'network', 'publish', 'delete', 'payment', 'authorization'].includes(input.category)
    ? input.category
    : 'other';
  return {
    id: String(input.id || `tool_intent_${randomUUID()}`),
    agentId: String(input.agentId || ''),
    runtimeId: String(input.runtimeId || ''),
    runId: String(input.runId || ''),
    action: String(input.action || input.toolName || 'unknown').slice(0, 240),
    category,
    target: String(input.target || '').slice(0, 2000),
    workspaceRoot: String(input.workspaceRoot || '').slice(0, 2000),
    mutating: input.mutating === true || ['write', 'command', 'publish', 'delete', 'payment', 'authorization'].includes(category),
    networked: input.networked === true || ['network', 'publish', 'payment', 'authorization'].includes(category),
    externalPublish: input.externalPublish === true || category === 'publish',
    irreversible: input.irreversible === true || ['delete', 'payment', 'authorization', 'publish'].includes(category),
    summary: String(input.summary || '').slice(0, 1200),
  };
}

function grantMatches(grant, intent, policy) {
  if (!grant || grant.decision !== 'allow') return false;
  if (grant.agentId && grant.agentId !== policy.agentId) return false;
  if (grant.workspaceId && grant.workspaceId !== policy.workspaceId) return false;
  if (grant.actionPattern && grant.actionPattern !== intent.action) return false;
  if (grant.targetPrefix && !intent.target.startsWith(grant.targetPrefix)) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false;
  return true;
}

export function decideToolIntent(intentInput, policyInput, { grants = [], coverage = 'partial' } = {}) {
  const intent = createToolIntent(intentInput);
  const policy = policyInput?.revision ? policyInput : permissionPolicySnapshot(policyInput);
  const base = { scope: 'once', coverage, expiresAt: null, policyRevision: policy.revision };
  if (policy.planMode && (intent.mutating || intent.networked)) {
    return { ...base, decision: 'deny', reason: 'Plan Mode only permits read-only actions.', source: 'plan_mode' };
  }
  if (HARD_BOUNDARY_CATEGORIES.has(intent.category)) {
    return { ...base, decision: 'ask', reason: 'This action crosses a hard user-approval boundary.', source: 'hard_boundary' };
  }
  if (grants.some((grant) => grantMatches(grant, intent, policy))) {
    return { ...base, decision: 'allow', reason: 'A scoped user grant applies.', source: 'user_grant' };
  }
  if (!intent.mutating && !intent.networked) {
    return { ...base, decision: 'allow', reason: 'The action is read-only and local.', source: 'default' };
  }
  if (policy.mode === 'full_access') {
    return { ...base, decision: 'allow', reason: 'Full access skips ordinary approvals.', source: 'agent_policy' };
  }
  if (policy.mode === 'ask_all') {
    return { ...base, decision: 'ask', reason: 'The active policy asks before risky actions.', source: 'agent_policy' };
  }
  const highRisk = intent.irreversible || intent.externalPublish || intent.category === 'command';
  return highRisk
    ? { ...base, decision: 'ask', reason: 'Risk-based review requires approval.', source: 'smart_review' }
    : { ...base, decision: 'allow', reason: 'Risk-based review classified the action as low risk.', source: 'smart_review' };
}
