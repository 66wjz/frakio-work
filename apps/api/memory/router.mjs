import { createHash } from 'node:crypto';

const PROJECT_SIGNAL_RE = /(?:^|\b)(?:workspace|project|repo|repository|path|directory|workflow|sop|role)(?:\b|$)|项目|仓库|目录|路径|流程|分工|角色|规则|交付/iu;
const PREFERENCE_RE = /喜欢|偏好|习惯|希望|不要|总是|prefer|preference|like|dislike/iu;
const REMEMBER_RE = /记住|帮我记|remember|keep this in mind/iu;
const AGENT_EXPERIENCE_RE = /工具|命令|调试|排错|经验|做法|tool|command|debug|lesson|pattern/iu;

export function memorySourceHash({ fact, origin = '', sourceMessageId = '', threadId = '' }) {
  return createHash('sha256').update([origin, sourceMessageId, threadId, String(fact || '').trim().toLowerCase().replace(/\s+/g, ' ')].join('\0')).digest('hex');
}

export function classifyMemoryCandidate(input = {}) {
  const fact = String(input.fact || '').trim();
  if (!fact) throw new Error('Memory fact is required.');
  const origin = String(input.origin || 'unknown');
  const requested = input.scope === 'workspace' ? 'vault' : String(input.scope || '');
  const userGrounded = origin === 'user' || Boolean(input.userConfirmed);
  const verifiedTask = Boolean(input.verifiedTask);
  const suppliedConfidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5)));
  const projectSignal = Boolean(input.vaultId && PROJECT_SIGNAL_RE.test(fact));

  if (requested && ['user', 'agent', 'vault', 'thread'].includes(requested)) {
    if (requested === 'user' && !userGrounded) return { scope: 'thread', kind: 'fact', confidence: Math.min(0.49, Number(input.confidence ?? 0.4)), requiresReview: true };
    if (requested === 'vault' && !input.vaultId) return { scope: 'thread', kind: 'fact', confidence: Math.min(0.49, Number(input.confidence ?? 0.4)), requiresReview: true };
    const trusted = requested === 'thread' || userGrounded || (requested === 'agent' && verifiedTask);
    return { scope: requested, kind: input.kind || (requested === 'agent' ? 'agent_experience' : requested === 'vault' ? 'project_fact' : requested === 'user' ? 'personal_fact' : 'fact'), confidence: suppliedConfidence || 0.7, requiresReview: !trusted || suppliedConfidence < 0.85 };
  }

  if (projectSignal) {
    const kind = /规则|流程|分工|角色|sop|workflow|role/iu.test(fact) ? 'project_rule' : /决定|确认|采用|decision|approved/iu.test(fact) ? 'project_decision' : 'project_fact';
    const confidence = Number(input.confidence ?? (userGrounded ? 0.88 : 0.7));
    return { scope: 'vault', kind, confidence, requiresReview: !userGrounded || confidence < 0.85 };
  }
  if (origin === 'agent' && AGENT_EXPERIENCE_RE.test(fact)) {
    const confidence = Number(input.confidence ?? (verifiedTask ? 0.88 : 0.68));
    return { scope: 'agent', kind: 'agent_experience', confidence, requiresReview: !verifiedTask || confidence < 0.85 };
  }
  if (userGrounded && REMEMBER_RE.test(fact)) return { scope: 'user', kind: PREFERENCE_RE.test(fact) ? 'preference' : 'personal_fact', confidence: Number(input.confidence ?? 0.86), requiresReview: false };
  return { scope: 'thread', kind: 'fact', confidence: Math.min(0.59, Number(input.confidence ?? 0.45)), requiresReview: true };
}

export function routeMemoryCandidate(ledger, input = {}) {
  const classification = classifyMemoryCandidate(input);
  const subjectId = classification.scope === 'user' ? String(input.userId || 'default')
    : classification.scope === 'agent' ? String(input.sourceAgentId || input.agentId || '')
      : classification.scope === 'vault' ? String(input.vaultId || '')
        : String(input.threadId || '');
  if (!subjectId) throw new Error('The selected memory scope is not available in this conversation.');
  const entry = ledger.propose({
    scope: classification.scope,
    subjectId,
    fact: input.fact,
    kind: classification.kind,
    origin: input.origin || 'unknown',
    sourceAgentId: input.sourceAgentId || input.agentId || '',
    threadId: input.threadId || '',
    vaultId: input.vaultId || '',
    sourceHash: input.sourceHash || memorySourceHash(input),
    reason: input.reason || '',
    statusReason: input.statusReason || '',
    confidence: classification.confidence,
    provenance: input.provenance || [],
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
    supersedesId: input.supersedesId || null,
  });
  return classification.requiresReview ? entry : ledger.accept(entry.id, { confidence: classification.confidence, supersedesId: input.supersedesId || null });
}
