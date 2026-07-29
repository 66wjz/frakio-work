export const PROCESSING_CYCLE_MS = 9000;

export const RUN_PRESENTATION_PHASES = Object.freeze([
  'thinking',
  'activity',
  'responding',
  'waiting-input',
  'finished',
]);

export const PROCESSING_MESSAGES = Object.freeze([
  '仔细琢磨中…',
  '嗯…',
  '连接线索中…',
  '深思中…',
  '斟酌中…',
  '酝酿中…',
  '反复思量中…',
  '推理中…',
  '整理思路中…',
  '看看…',
  '计算中…',
  '沉浸思考中…',
  '快好了…',
  '正在处理…',
  '把细节串起来…',
]);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function formatRunElapsed(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  if (safe < 60) return `${safe}s`;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function processingMessageAt(startedAt, elapsedSeconds, identity = '') {
  const cycle = Math.max(0, Math.floor((Number(elapsedSeconds) || 0) * 1000 / PROCESSING_CYCLE_MS));
  const startIndex = stableHash(`${Number(startedAt) || 0}:${identity}`) % PROCESSING_MESSAGES.length;
  return PROCESSING_MESSAGES[(startIndex + cycle * 7) % PROCESSING_MESSAGES.length];
}

export function nextRunPresentationPhase(currentPhase = 'thinking', eventName = '', context = {}) {
  const current = RUN_PRESENTATION_PHASES.includes(currentPhase) ? currentPhase : 'thinking';
  if (eventName === 'run.started') return 'thinking';
  if (eventName === 'tool.running' || eventName === 'tool.completed') return 'activity';
  if (eventName === 'message.delta') {
    return String(context.delta || '').trim() ? 'responding' : current;
  }
  if (eventName === 'approval.request' || eventName === 'clarify.request') return 'waiting-input';
  if (eventName === 'approval.responded' || eventName === 'clarify.responded') {
    return context.hasActivity ? 'activity' : 'thinking';
  }
  if (eventName === 'run.completed' || eventName === 'run.failed' || eventName === 'run.cancelled') return 'finished';
  return current;
}

export function shouldShowRunPresence(phase) {
  return phase === 'thinking' || phase === 'activity';
}

export function nextActivityExpanded(expanded, eventName = '') {
  return eventName === 'user.toggle' ? !Boolean(expanded) : Boolean(expanded);
}

function commandTaskPreview(target) {
  const queryMatch = String(target || '').match(/[?&](?:q|query)=([^"'&\s]+)/i);
  if (queryMatch?.[1]) {
    try {
      const query = decodeURIComponent(queryMatch[1].replace(/\+/g, ' ')).trim();
      if (query) return `查询 ${query}`;
    } catch {
      // Fall through to the host preview when an emitted command has malformed URL encoding.
    }
  }
  const hostMatch = String(target || '').match(/(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}(?:\/[^"'\s|]*)?)/i);
  return hostMatch?.[1] ? `访问 ${hostMatch[1]}` : '';
}

export function activityGroupPreview(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  const item = [...items].reverse().find((candidate) => candidate?.status === 'running') || items.at(-1);
  if (!item) return String(group?.summary || '正在执行操作').trim();
  const target = String(item.target || '').replace(/\s+/g, ' ').trim();
  const label = item.status === 'running' ? item.activeLabel : item.completedLabel;
  if (target && ['read', 'edit', 'write'].includes(item.kind)) {
    const copy = `${label || '正在处理'} ${target.split('/').at(-1) || target}`;
    return copy.length > 120 ? `${copy.slice(0, 119).trimEnd()}…` : copy;
  }
  if (target && item.kind === 'command') {
    const commandPreview = commandTaskPreview(target);
    if (commandPreview) return commandPreview.length > 120 ? `${commandPreview.slice(0, 119).trimEnd()}…` : commandPreview;
  }
  const technicalTarget = item.kind === 'command'
    || /^(?:https?:\/\/|[./~]|#|\$)/i.test(target)
    || /(?:\bcurl\b|\bpython\d*\b|\s(?:&&|\|\||\|)\s)/i.test(target);
  if (target && !technicalTarget) {
    const copy = target;
    return copy.length > 120 ? `${copy.slice(0, 119).trimEnd()}…` : copy;
  }
  return String(label || group?.summary || '正在执行操作').trim();
}

export function activityElapsedMs(item, now = Date.now()) {
  const persisted = Math.max(0, Number(item?.durationMs) || 0);
  if (item?.status !== 'running') return persisted;
  const startedAt = Date.parse(String(item?.createdAt || ''));
  if (!Number.isFinite(startedAt)) return persisted;
  return Math.max(persisted, Math.max(0, Number(now) - startedAt));
}

export function formatActivityDuration(milliseconds) {
  const safe = Math.max(0, Number(milliseconds) || 0);
  if (!safe) return '';
  if (safe < 1000) return `${Math.round(safe)}ms`;
  const seconds = safe / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}
