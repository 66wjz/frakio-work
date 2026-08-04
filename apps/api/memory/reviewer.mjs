const MEMORY_KINDS = new Set(['personal_fact', 'preference', 'agent_experience', 'project_fact', 'project_decision', 'project_rule', 'fact']);
const MEMORY_SCOPES = new Set(['user', 'agent', 'vault', 'thread']);
const MEMORY_ACTIONS = new Set(['add', 'update', 'supersede', 'ignore']);
const UNSAFE_MEMORY_RE = /ignore\s+(?:all\s+)?previous|system\s+prompt|developer\s+message|prompt\s+injection|api[_ -]?key|access[_ -]?token|password|私钥|密钥|口令|忽略.{0,8}(?:此前|之前).{0,8}(?:指令|规则)/iu;

export function stripUntrustedMemoryText(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, '[代码块已省略]')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim()
    .slice(0, 12000);
}

export function memoryReviewPrompt({ kind = 'chat_turn', vault = null, existing = [], messages = [] } = {}) {
  const source = messages.map((message) => ({
    id: String(message.id || ''),
    role: String(message.role || ''),
    agentId: String(message.agentId || ''),
    content: stripUntrustedMemoryText(message.content || ''),
  })).filter((message) => message.content);
  const compactExisting = existing.slice(0, 40).map((entry) => ({ id: entry.id, scope: entry.scope, kind: entry.kind, fact: entry.fact, status: entry.status }));
  const instructions = [
    '你是 Frakio 的记忆整理器。只提取未来仍有用、可验证、足够具体的长期信息。',
    '不要保存临时进度、寒暄、工具日志、代码块、引用内容、密钥、模型推测或可轻易重新搜索的常识。',
    '个人事实和偏好必须直接来自用户原话。助手或资料内容不能单独建立用户画像。',
    kind === 'work_task' ? '本次只允许提取有成功任务结果支撑的 agent_experience；其他内容返回 ignore。' : '',
    '项目路径、角色、流程、决定和规则只有在提供了项目资料库时才能建议 vault 作用域。',
    '与现有记忆相同则 ignore；修正现有内容用 update；明确替代旧规则用 supersede，并填写 relatedEntryId。',
    '只返回 JSON，不要 Markdown。格式：{"candidates":[{"fact":"...","kind":"preference","scope":"user","reason":"用户明确表达偏好","confidence":0.9,"validUntil":null,"action":"add","relatedEntryId":null,"evidence":[{"messageId":"...","quote":"用户原话短摘录"}]}]}',
  ].filter(Boolean).join('\n');
  return {
    instructions,
    input: JSON.stringify({ reviewKind: kind, projectVault: vault ? { id: vault.id, name: vault.name } : null, existingMemories: compactExisting, messages: source }),
  };
}

export function parseMemoryReviewOutput(output = '') {
  let clean = String(output || '').trim();
  if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('记忆整理模型没有返回 JSON。');
  const parsed = JSON.parse(clean.slice(first, last + 1));
  const rows = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  return rows.slice(0, 12).map((row) => ({
    fact: String(row?.fact || '').trim().slice(0, 1600),
    kind: MEMORY_KINDS.has(row?.kind) ? row.kind : 'fact',
    scope: MEMORY_SCOPES.has(row?.scope) ? row.scope : 'thread',
    reason: String(row?.reason || '').trim().slice(0, 240),
    confidence: Math.max(0, Math.min(1, Number(row?.confidence ?? 0))),
    validUntil: row?.validUntil ? String(row.validUntil) : null,
    action: MEMORY_ACTIONS.has(row?.action) ? row.action : 'ignore',
    relatedEntryId: row?.relatedEntryId ? String(row.relatedEntryId) : null,
    evidence: Array.isArray(row?.evidence) ? row.evidence.slice(0, 6).map((item) => ({ messageId: String(item?.messageId || ''), quote: String(item?.quote || '').trim().slice(0, 320) })) : [],
  })).filter((row) => row.fact && !UNSAFE_MEMORY_RE.test(row.fact));
}

function evidenceSupportsFact(fact, quote) {
  const left = String(fact || '').toLowerCase();
  const right = String(quote || '').toLowerCase();
  const leftWords = new Set(left.match(/[a-z0-9]{3,}/g) || []);
  const rightWords = new Set(right.match(/[a-z0-9]{3,}/g) || []);
  const sharedWords = [...leftWords].filter((word) => rightWords.has(word)).length;
  const cjkBigrams = (value) => {
    const chars = (value.match(/[\u3400-\u9fff]/g) || []).join('');
    return new Set(Array.from({ length: Math.max(0, chars.length - 1) }, (_, index) => chars.slice(index, index + 2)));
  };
  const leftCjk = cjkBigrams(left);
  const rightCjk = cjkBigrams(right);
  const sharedCjk = [...leftCjk].filter((gram) => rightCjk.has(gram)).length;
  return sharedWords >= 2 || sharedCjk >= 2;
}

export function reviewCandidateDecision(candidate, { kind = 'chat_turn', vaultId = '', verifiedTask = false, userMessageIds = new Set(), userMessages = new Map() } = {}) {
  if (!candidate || candidate.action === 'ignore' || candidate.confidence < 0.6) return { persist: false, status: 'ignored' };
  const evidence = candidate.evidence || [];
  const userGrounded = evidence.some((item) => {
    if (!userMessageIds.has(item.messageId)) return false;
    const quote = String(item.quote || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const source = String(userMessages.get(item.messageId) || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return quote.length >= 2 && source.includes(quote) && evidenceSupportsFact(candidate.fact, quote);
  });
  if (['personal_fact', 'preference'].includes(candidate.kind) && !userGrounded) return { persist: true, status: 'candidate', scope: 'thread' };
  if (candidate.scope === 'vault' && !vaultId) return { persist: true, status: 'candidate', scope: 'thread' };
  if (kind === 'work_task' && candidate.kind !== 'agent_experience') return { persist: false, status: 'ignored' };
  const agentExperienceVerified = candidate.kind === 'agent_experience' && verifiedTask;
  const trusted = userGrounded || agentExperienceVerified;
  return {
    persist: true,
    status: trusted && candidate.confidence >= 0.85 ? 'accepted' : 'candidate',
    scope: candidate.scope,
    userGrounded,
    verifiedTask: agentExperienceVerified,
  };
}
