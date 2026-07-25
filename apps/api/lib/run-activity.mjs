import path from 'node:path';

const MAX_PREVIEW_CHARS = 4096;
const MAX_PREVIEW_LINES = 20;
const MAX_TRANSCRIPTS = 200;

const sensitiveKeyPattern = /^(?:api[_-]?key|authorization|token|access[_-]?token|refresh[_-]?token|secret|password|cookie|set-cookie)$/i;

function cleanText(value, limit = 500) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return String(text || '').replace(/\u0000/g, '').trim().slice(0, limit);
}

export function redactActivityText(value) {
  return String(value || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/(api[_-]?key["'\s:=]+)([^"'\s,}]+)/gi, '$1***')
    .replace(/(authorization["'\s:=]+bearer\s+)([^"'\s,}]+)/gi, '$1***')
    .replace(/((?:access|refresh)?[_-]?token["'\s:=]+)([^"'\s,}]+)/gi, '$1***')
    .replace(/(password["'\s:=]+)([^"'\s,}]+)/gi, '$1***');
}

function redactValue(value, depth = 0) {
  if (depth > 4) return '[已截断]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? '***' : redactValue(entry, depth + 1),
    ]));
  }
  return typeof value === 'string' ? redactActivityText(value) : value;
}

export function activityResultPreview(value) {
  if (value == null || value === '') return '';
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(redactValue(value), null, 2);
  } catch {
    text = String(value);
  }
  const lines = redactActivityText(text).split(/\r?\n/);
  const clipped = lines.slice(0, MAX_PREVIEW_LINES).join('\n').slice(0, MAX_PREVIEW_CHARS).trim();
  return clipped + (lines.length > MAX_PREVIEW_LINES || text.length > MAX_PREVIEW_CHARS ? '\n…' : '');
}

function normalizedToolName(event = {}) {
  const raw = cleanText(event.toolName || event.tool_name || event.tool || event.name || event.function_name, 180).toLowerCase();
  return raw.replace(/^mcp__.+?__/, '').replace(/^mcp_[^_]+_/, '');
}

function eventArgs(event = {}) {
  const raw = event.raw && typeof event.raw === 'object' ? event.raw : event;
  const args = raw.args ?? raw.arguments ?? raw.input ?? event.args ?? event.arguments ?? event.input;
  return args && typeof args === 'object' ? args : {};
}

function firstTarget(args, keys) {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return cleanText(value, 500);
    if (Array.isArray(value) && value.length) return value.map((item) => cleanText(item?.path || item?.file || item, 160)).filter(Boolean).slice(0, 4).join(' · ');
  }
  return '';
}

function basenameTarget(target, kind) {
  if (!target || !['read', 'edit', 'write'].includes(kind)) return target;
  if (target.includes(' · ')) return target.split(' · ').map((item) => path.basename(item)).join(' · ');
  return path.basename(target) || target;
}

function classifyTool(name) {
  if (/^(read_file|read|view_file|open_file|list_files|list_directory|glob|find_files)$/.test(name)) return 'read';
  if (/^(search_files|search|grep|ripgrep|rg|code_search|session_search)$/.test(name)) return 'search';
  if (/^(patch|apply_patch|edit_file|replace|str_replace)$/.test(name)) return 'edit';
  if (/^(write_file|create_file|save_file)$/.test(name)) return 'write';
  if (/^(terminal|execute_code|exec|exec_command|shell|bash|powershell)$/.test(name)) return 'command';
  if (/^(web_search|web_extract|x_search|browser_|fetch|http)/.test(name)) return 'web';
  if (/^(skills?_list|skills?_view|skill_|use_skill)/.test(name)) return 'skill';
  if (/^(todo|kanban_|delegate_task|collaboration_|hermes_workbench_)/.test(name)) return 'collaboration';
  return 'other';
}

const copyByKind = {
  read: ['正在读取', '读取了'],
  search: ['正在搜索', '搜索了'],
  edit: ['正在编辑', '编辑了'],
  write: ['正在写入', '写入了'],
  command: ['正在运行命令', '运行了命令'],
  web: ['正在访问网络', '访问了网络'],
  skill: ['正在使用技能', '使用了技能'],
  collaboration: ['正在更新协作任务', '更新了协作任务'],
  other: ['正在执行操作', '执行了操作'],
};

function targetForTool(kind, name, args, event) {
  if (typeof event.target === 'string' && event.target.trim()) return cleanText(event.target, 500);
  const paths = Array.isArray(event.paths) ? event.paths.filter(Boolean) : [];
  if (paths.length) return basenameTarget(paths.slice(0, 4).join(' · '), kind);
  if (kind === 'read' || kind === 'edit' || kind === 'write') return basenameTarget(firstTarget(args, ['path', 'file', 'file_path', 'target', 'paths', 'files']), kind);
  if (kind === 'search') return firstTarget(args, ['pattern', 'query', 'search', 'text', 'path']);
  if (kind === 'command') return firstTarget(args, ['command', 'cmd', 'code', 'script']);
  if (kind === 'web') return firstTarget(args, ['query', 'url', 'urls', 'target']);
  if (kind === 'skill') return firstTarget(args, ['skill', 'name', 'path']) || cleanText(event.skillName || event.skill_name, 180);
  if (kind === 'collaboration') return firstTarget(args, ['title', 'taskId', 'task_id', 'workflowId', 'workflow_id', 'boardSlug', 'board_slug']) || name.replaceAll('_', ' ');
  return firstTarget(args, ['title', 'query', 'path', 'target', 'command']) || name.replaceAll('_', ' ');
}

export function normalizeRunActivityItem(event = {}, status = 'running') {
  const name = normalizedToolName(event) || 'operation';
  const kind = classifyTool(name);
  const args = eventArgs(event);
  const [defaultActiveLabel, defaultCompletedLabel] = copyByKind[kind];
  const activeLabel = cleanText(event.activeLabel, 120) || defaultActiveLabel;
  const completedLabel = cleanText(event.completedLabel, 120) || defaultCompletedLabel;
  const target = targetForTool(kind, name, args, event);
  const timestamp = Number(event.timestamp || 0);
  const createdAt = event.createdAt || (timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString());
  const result = event.raw?.result ?? event.result ?? event.resultPreview ?? event.result_preview ?? event.error;
  return {
    id: cleanText(event.callId || event.call_id || event.tool_call_id || event.id || `${name}:${createdAt}`, 240),
    kind,
    status: status === 'failed' || event.error || event.is_error ? 'failed' : status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'running',
    toolName: name,
    activeLabel,
    completedLabel,
    target: cleanText(redactActivityText(target), 500),
    durationMs: Math.max(0, Number(event.durationMs ?? event.duration_ms ?? (Number(event.duration || 0) * 1000)) || 0),
    resultPreview: activityResultPreview(event.resultPreview || result),
    createdAt,
    updatedAt: event.updatedAt || createdAt,
  };
}

const groupNouns = {
  read: ['正在读取', '读取了', '个文件'], search: ['正在搜索', '搜索了', '次'], edit: ['正在编辑', '编辑了', '个文件'], write: ['正在写入', '写入了', '个文件'],
  command: ['正在运行', '运行了', '条命令'], web: ['正在访问网络', '访问了网络', '次'], skill: ['正在使用技能', '使用了技能', '次'], collaboration: ['正在更新协作任务', '更新了协作任务', '次'], other: ['正在执行操作', '执行了操作', '次'],
};

export function summarizeActivityItems(items = [], running = false) {
  const counts = new Map();
  for (const item of items) counts.set(item.kind || 'other', (counts.get(item.kind || 'other') || 0) + 1);
  return [...counts.entries()].map(([kind, count]) => {
    const [runningCopy, completedCopy, unit] = groupNouns[kind] || groupNouns.other;
    return `${running ? runningCopy : completedCopy} ${count} ${unit}`;
  }).join(' · ');
}

export function normalizeRunTranscript(value = {}) {
  const groups = (Array.isArray(value.groups) ? value.groups : []).slice(-100).map((group, groupIndex) => {
    const items = (Array.isArray(group.items) ? group.items : []).slice(-100).map((item) => normalizeRunActivityItem(item, item.status));
    const status = items.some((item) => item.status === 'failed') ? 'failed'
      : items.some((item) => item.status === 'running') ? 'running'
        : items.some((item) => item.status === 'cancelled') ? 'cancelled' : 'completed';
    return {
      id: cleanText(group.id || `group-${groupIndex}`, 240),
      contentOffset: Math.max(0, Number(group.contentOffset || 0) || 0),
      status,
      summary: summarizeActivityItems(items, status === 'running'),
      items,
      createdAt: group.createdAt || items[0]?.createdAt || new Date().toISOString(),
      updatedAt: group.updatedAt || items.at(-1)?.updatedAt || new Date().toISOString(),
    };
  });
  return {
    runId: cleanText(value.runId || value.run_id, 240),
    turnId: cleanText(value.turnId || value.turn_id, 240),
    messageId: cleanText(value.messageId || value.message_id, 240),
    agentId: cleanText(value.agentId || value.agent_id, 180),
    status: ['running', 'completed', 'failed', 'cancelled'].includes(value.status) ? value.status : 'completed',
    groups,
    partialContent: String(value.partialContent || '').replace(/\u0000/g, '').slice(0, 20000),
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

export function normalizeRunTranscripts(values) {
  return (Array.isArray(values) ? values : []).slice(-MAX_TRANSCRIPTS).map(normalizeRunTranscript).filter((item) => item.runId);
}

export function applyRunActivityToTranscript(value, activityValue, { contentOffset = 0, groupOpen = false } = {}) {
  const transcript = normalizeRunTranscript(value);
  const activity = normalizeRunActivityItem(activityValue, activityValue?.status);
  let group = transcript.groups.find((candidate) => candidate.items.some((item) => item.id === activity.id));
  const matchedExistingItem = Boolean(group);
  if (!group) {
    group = groupOpen ? transcript.groups.at(-1) : null;
    if (!group) {
      group = {
        id: `${transcript.runId}:activity:${transcript.groups.length + 1}`,
        contentOffset: Math.max(0, Number(contentOffset || 0)),
        status: 'running',
        summary: '',
        items: [],
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
      };
      transcript.groups.push(group);
    }
  }
  const itemIndex = group.items.findIndex((item) => item.id === activity.id);
  if (itemIndex >= 0) group.items[itemIndex] = { ...group.items[itemIndex], ...activity };
  else group.items.push(activity);
  group.status = group.items.some((item) => item.status === 'failed') ? 'failed'
    : group.items.some((item) => item.status === 'running') ? 'running'
      : group.items.some((item) => item.status === 'cancelled') ? 'cancelled' : 'completed';
  group.summary = summarizeActivityItems(group.items, group.status === 'running');
  group.updatedAt = activity.updatedAt;
  transcript.status = 'running';
  transcript.updatedAt = activity.updatedAt;
  return { transcript, group, groupOpen: matchedExistingItem ? groupOpen : true };
}

export function upsertRunTranscript(thread, transcript) {
  const normalized = normalizeRunTranscript(transcript);
  const current = normalizeRunTranscripts(thread.runTranscripts);
  const index = current.findIndex((item) => item.runId === normalized.runId);
  if (index >= 0) current[index] = normalized;
  else current.push(normalized);
  thread.runTranscripts = current.slice(-MAX_TRANSCRIPTS);
  return normalized;
}
