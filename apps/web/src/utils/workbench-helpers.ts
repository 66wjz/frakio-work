// wjz新建文件，新建原因：解耦 main.tsx 中的纯工具函数与状态初始化器，修改时间：2026-08-17。
// 文件内容概述：RunUiState 初始化、本地会话草稿读写、活动事件归并、运行时判定等纯函数工具。
// wjz新建文件结束。

import type {
  RunActivityGroup,
  RunActivityItem,
} from '@frakio/contracts';
import type {
  Agent,
  AgentModelOverrides,
  ChatEvent,
  ChatRunTarget,
  CollaborationTaskStatus,
  CollaborationWorkflow,
  HarnessId,
  KanbanTaskStatus,
  MentionOption,
  ModelProfile,
  RightRailTab,
  RunPresentationUi,
  RunUiState,
  RuntimeDefinition,
  RuntimeId,
  Thread,
} from '../types/workbench';
import { resolveModelChoice } from './model-helpers';
import hermesRuntimeLogoUrl from '../assets/runtime-logos/hermes.svg';
import piRuntimeLogoUrl from '../assets/runtime-logos/pi.svg';
import codexRuntimeLogoUrl from '../assets/runtime-logos/codex.svg';
import claudeRuntimeLogoUrl from '../assets/runtime-logos/claude.svg';

export const runtimeLabels: Record<string, string> = {
  hermes: 'Hermes Agent',
  pi: 'Pi',
  codex: 'Codex',
  claude: 'Claude Code',
  native: 'Frakio Native',
};

export const runtimeVisuals: Record<string, { label: string; iconUrl: string; badge?: string; color?: string }> = {
  hermes: { label: 'Hermes Agent', iconUrl: hermesRuntimeLogoUrl, badge: 'Hermes', color: '#f59e0b' },
  pi: { label: 'Pi', iconUrl: piRuntimeLogoUrl, badge: 'Pi', color: '#10b981' },
  codex: { label: 'Codex', iconUrl: codexRuntimeLogoUrl, badge: 'Codex', color: '#6366f1' },
  claude: { label: 'Claude Code', iconUrl: claudeRuntimeLogoUrl, badge: 'Claude', color: '#d97706' },
};

export const rightRailTabMeta: Record<RightRailTab, { title: string; detail: string }> = {
  browser: { title: '浏览器', detail: '打开网页预览' },
  files: { title: '文件', detail: '查看项目文件' },
  review: { title: '审阅', detail: '查看代码改动' },
  sources: { title: '资料库', detail: '查看会话来源' },
  collaboration: { title: '协作', detail: '查看任务进展' },
};

export const rightRailTabs: RightRailTab[] = ['browser', 'files', 'review', 'sources', 'collaboration'];

import {
  Activity,
  Bell,
  Bot,
  Boxes,
  Clock3,
  Library,
  MessageSquare,
  Network,
  Settings,
} from 'lucide-react';

export const navItems = [
  { id: 'council', label: '新对话', icon: MessageSquare, placement: 'system' },
  { id: 'knowledge', label: '知识问答', icon: Library, placement: 'hidden' },
  { id: 'channels', label: '频道', icon: MessageSquare, placement: 'settings' },
  { id: 'plugins', label: '插件中心', icon: Boxes, placement: 'settings' },
  { id: 'inbox', label: '收件箱', icon: Bell, placement: 'rail' },
  { id: 'kanban', label: '协作', icon: Boxes, placement: 'rail' },
  { id: 'jobs', label: '定时任务', icon: Clock3, placement: 'settings' },
  { id: 'monitoring', label: '监控', icon: Activity, placement: 'settings' },
  { id: 'models', label: '模型配置', icon: Bot, placement: 'settings' },
  { id: 'org', label: 'Agent 配置', icon: Network, placement: 'hidden' },
  { id: 'settings', label: '设置', icon: Settings, placement: 'system' },
];
export const railNavItems = navItems.filter((item) => item.placement === 'rail');
export const managementNavIds = new Set(['settings', 'org', 'models', 'channels', 'plugins', 'inbox', 'kanban', 'jobs', 'monitoring']);
export const workspaceSurfaceNavIds = new Set(['inbox', 'kanban']);

export const kanbanStatusLabels: Record<KanbanTaskStatus, string> = {
  triage: '待分拣',
  todo: '待办',
  scheduled: '已调度',
  ready: '就绪',
  running: '进行中',
  blocked: '阻塞',
  review: '待审查',
  done: '已完成',
  archived: '已归档',
};
export const kanbanStatusOrder = Object.keys(kanbanStatusLabels) as KanbanTaskStatus[];

export function collaborationWorkflowStatusLabel(status: CollaborationWorkflow['status']) {
  return ({ active: '执行中', paused: '已暂停', completed: '已完成', failed: '执行失败', cancelled: '已结束', archived: '已归档' } as Record<string, string>)[status] || status;
}

export function collaborationStatusLabel(status: CollaborationTaskStatus) {
  return ({
    ...kanbanStatusLabels,
    pending_confirmation: '待确认',
    waiting_dependency: '等待依赖',
    waiting_input: '等待输入',
    completed: '已完成',
    failed: '失败',
    paused: '已暂停',
    cancelled: '已结束',
  } as Record<CollaborationTaskStatus, string>)[status] || status;
}



export const runtimeSeed: RuntimeDefinition[] = [
  { id: 'hermes', name: 'Hermes Agent', kind: 'core', bundled: true, enabled: true, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'frakio-managed', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'pi', name: 'Pi', kind: 'core', bundled: false, enabled: false, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'frakio-managed', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'codex', name: 'Codex', kind: 'channel', bundled: false, enabled: false, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'frakio-managed', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'claude', name: 'Claude Code', kind: 'channel', bundled: false, enabled: false, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'frakio-managed', detail: '正在检测运行时。', checkedAt: '' } },
];

export function mergeRuntimeDefinitions(current: RuntimeDefinition[], updates: RuntimeDefinition[]) {
  const updateById = new Map(updates.map((runtime) => [runtime.id, runtime]));
  return runtimeSeed.map((seed) => updateById.get(seed.id) || current.find((runtime) => runtime.id === seed.id) || seed);
}

export function isRuntimeReady(runtime: RuntimeDefinition | undefined) {
  return runtime?.installation?.status === 'ready' && runtime.installation.installed;
}

export const harnessChoices: Array<{ id: HarnessId; runtimeId: RuntimeId; name: string }> = [
  { id: 'native', runtimeId: 'native', name: 'Frakio Native' },
  { id: 'hermes', runtimeId: 'hermes', name: 'Hermes' },
  { id: 'codex', runtimeId: 'codex', name: 'Codex' },
  { id: 'claude', runtimeId: 'claude', name: 'Claude Code' },
];

export function effectiveRuntimeForAgentUi(agent: Agent | null | undefined, thread: Pick<Thread, 'agentRuntimeOverrides' | 'agentHarnessBindings'> | null | undefined, requested = ''): RuntimeId {
  const binding = agent?.id ? thread?.agentHarnessBindings?.[agent.id] : undefined;
  const explicitBinding = binding && ['user_override', 'explicit_migration', 'explicit'].includes(String(binding.source || '')) ? binding.harnessId : '';
  const policyRuntime = agent?.runtimePolicy?.defaultHarnessId || agent?.runtimePolicy?.defaultRuntimeId || 'hermes';
  const harness = requested || explicitBinding || thread?.agentRuntimeOverrides?.[agent?.id || ''] || policyRuntime;
  return harness === 'pi' ? 'native' : (harness as RuntimeId);
}

export async function openExternalUrl(targetUrl: string): Promise<boolean> {
  if (!targetUrl) return false;
  if (window.frakioDesktop?.openExternal) {
    const result = await window.frakioDesktop.openExternal(targetUrl);
    return result?.ok === true;
  }
  return Boolean(window.open(targetUrl, '_blank', 'noopener,noreferrer'));
}

export function createRunUiState(overrides: Partial<RunUiState> = {}): RunUiState {
  return {
    isRunning: false,
    startPending: false,
    hideStatus: false,
    presentationPhase: 'thinking',
    startedAt: null,
    target: null,
    activeRun: null,
    draft: '',
    activityGroups: [],
    approval: null,
    approvalSubmitting: false,
    approvalError: '',
    clarification: null,
    clarificationSubmitting: false,
    clarificationError: '',
    error: '',
    errorCode: '',
    stopping: false,
    changeSet: null,
    compaction: null,
    compactionRecords: [],
    presentationRevision: 0,
    lastRuntimeCursor: 0,
    terminalRunId: '',
    ...overrides,
  };
}

export function createRunPresentation(overrides: Partial<RunPresentationUi> = {}): RunPresentationUi {
  return {
    ...createRunUiState(),
    hostRunId: '',
    turnId: '',
    agentId: '',
    agentName: '',
    completed: false,
    ...overrides,
  };
}

export function threadDraftStorageKey(thread: Pick<Thread, 'id' | 'workspaceId'> | null | undefined) {
  if (!thread?.id) return '';
  return `frakio:draft:${thread.workspaceId || 'no-workspace'}:${thread.id}`;
}

export function readThreadDraft(thread: Pick<Thread, 'id' | 'workspaceId'> | null | undefined) {
  const key = threadDraftStorageKey(thread);
  if (!key) return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function writeThreadDraft(thread: Pick<Thread, 'id' | 'workspaceId'> | null | undefined, value: string) {
  const key = threadDraftStorageKey(thread);
  if (!key) return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable in a restricted desktop profile. */
  }
}

export function mergeRunActivityEvent(groups: RunActivityGroup[], data: any): RunActivityGroup[] {
  const activity = data.activity as RunActivityItem | undefined;
  if (!activity?.id) return groups;
  const groupId = String(data.groupId || `activity:${data.contentOffset || 0}`);
  const existingGroupIndex = groups.findIndex((group) => group.id === groupId || group.items.some((item) => item.id === activity.id));
  if (existingGroupIndex < 0) {
    return [
      ...groups,
      {
        id: groupId,
        contentOffset: Math.max(0, Number(data.contentOffset || 0)),
        status: data.groupStatus || activity.status,
        summary: String(data.groupSummary || activity.activeLabel || '正在执行操作'),
        items: [activity],
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
      },
    ];
  }
  return groups.map((group, groupIndex) => {
    if (groupIndex !== existingGroupIndex) return group;
    const itemIndex = group.items.findIndex((item) => item.id === activity.id);
    const items =
      itemIndex < 0
        ? [...group.items, activity]
        : group.items.map((item, index) => (index === itemIndex ? { ...item, ...activity } : item));
    return {
      ...group,
      contentOffset: Number.isFinite(Number(data.contentOffset)) ? Number(data.contentOffset) : group.contentOffset,
      status: data.groupStatus || (items.some((item) => item.status === 'failed') ? 'failed' : items.some((item) => item.status === 'running') ? 'running' : 'completed'),
      summary: String(data.groupSummary || group.summary),
      items,
      updatedAt: activity.updatedAt,
    };
  });
}

export const attachmentAcceptValue = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.svg', '.ico',
  '.txt', '.md', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.sql', '.pdf', '.doc', '.docx', '.odt', '.rtf',
  '.xls', '.xlsx', '.ppt', '.pptx', '.odp', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus',
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.html', '.py', '.rb', '.php', '.java', '.go', '.rs', '.swift', '.c', '.h', '.cpp', '.sh', '.zsh', '.vue', '.svelte', '.astro',
].join(',');

export const compatibilityRelayProviderKeys = new Set(['ikuncode', 'fun-codex', 'fun-claude']);

export function isVisibleChatMessage(message: ChatEvent) {
  const content = String(message.content || '');
  if (message.agentId === 'system') return false;
  if (message.contentType === 'workflow_final_delivery') return false;
  if (message.agentName === 'Hermes Bridge') return false;
  if (/Local Fallback|检测到 Hermes Studio|没有可用的模型 API Key|已回退到本地模拟/.test(`${message.role} ${content}`)) return false;
  if (/^(已开启普通对话|已开启与 .+ 的单 Agent 对话|已开启临时对话|项目已创建|新项目对话已创建|Workspace 已开启)/.test(content)) return false;
  return true;
}

export function workspaceDirectoryPreview(value: string) {
  return value.trim();
}

export function agentColor(agents: Agent[], id: string) {
  if (id === 'user') return '#0f172a';
  return agents.find((agent) => agent.id === id)?.color || '#64748b';
}

export function formatHermesRuntimeError(
  message: string,
  profileName = 'default',
  details?: { command?: string; serverName?: string; missingExecutable?: boolean },
) {
  if (/No Codex credentials stored|hermes auth/i.test(message)) {
    return `当前 Hermes Profile「${profileName}」使用 openai-codex，但本机未完成 hermes auth。请在右下角切换到 DeepSeek 等已配置模型，或运行 hermes auth 后重试。`;
  }
  const missingCommand =
    details?.command ||
    message.match(/找不到命令「([^」]+)」/)?.[1] ||
    message.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1] ||
    message.match(/requires\s+([A-Za-z0-9_.-]+), but/i)?.[1] ||
    '';
  if (missingCommand) {
    const server =
      details?.serverName ||
      message.match(/MCP server[「'\s]+([^」'\s]+)[」']?/i)?.[1] ||
      message.match(/MCP server「([^」]+)」/)?.[1] ||
      '';
    return `当前 Hermes Profile「${profileName}」的${server ? ` ${server} ` : ' '}MCP 启动失败：找不到 ${missingCommand}。请安装 Node/npm，或把 MCP command 改成绝对路径。`;
  }
  if (details?.missingExecutable || /FileNotFoundError|No such file or directory|\[Errno 2\]/i.test(message)) {
    const server = details?.serverName ? ` ${details.serverName} ` : ' ';
    return `当前 Hermes Profile「${profileName}」的${server}MCP 启动失败：找不到运行依赖。请检查 Node/npm/npx 或 MCP command 绝对路径。`;
  }
  return message;
}

export function isMentionBeforeBoundary(char: string | undefined) {
  return char === undefined || !/[A-Za-z0-9_]/.test(char);
}

export function mentionIndex(content: string, mentionName: string) {
  const raw = String(content || '');
  const name = String(mentionName || '').trim();
  if (!raw || !name) return -1;
  const lower = raw.toLowerCase();
  const needle = `@${name.toLowerCase()}`;
  let fromIndex = 0;
  while (fromIndex < lower.length) {
    const atIndex = lower.indexOf(needle, fromIndex);
    if (atIndex === -1) return -1;
    const end = atIndex + needle.length;
    const aliasEnd = name[name.length - 1];
    const after = raw[end];
    const validEnd = after === undefined || !(/[A-Za-z0-9_]/.test(aliasEnd || '') && /[A-Za-z0-9_]/.test(after));
    if (isMentionBeforeBoundary(raw[atIndex - 1]) && validEnd) return atIndex;
    fromIndex = atIndex + 1;
  }
  return -1;
}

export function resolveRunTarget(message: string, agents: Agent[], fallbackAgent: Agent | null): ChatRunTarget | null {
  const allIndex = mentionIndex(message, 'all');
  const matches = agents
    .map((agent) => {
      const names = [agent.name, agent.id, agent.profileName].filter((name): name is string => Boolean(name));
      const indices = names.map((name) => mentionIndex(message, name)).filter((index) => index >= 0);
      return indices.length ? { agent, index: Math.min(...indices) } : null;
    })
    .filter(Boolean) as Array<{ agent: Agent; index: number }>;
  const firstAgentMatch = matches.sort((a, b) => a.index - b.index)[0];
  if (allIndex >= 0 && (!firstAgentMatch || allIndex <= firstAgentMatch.index)) return { kind: 'all', agent: fallbackAgent };
  if (firstAgentMatch) return { kind: 'agent', agent: firstAgentMatch.agent };
  return fallbackAgent ? { kind: 'agent', agent: fallbackAgent } : null;
}

export function pruneAgentModelOverrides(overrides: AgentModelOverrides, agents: Agent[], models: ModelProfile[]) {
  const agentIds = new Set(agents.map((agent) => agent.id));
  return Object.fromEntries(
    Object.entries(overrides).filter(([agentId, modelId]) => agentIds.has(agentId) && Boolean(resolveModelChoice(modelId, models).model)),
  );
}

export function buildMentionOptions(agents: Agent[], selectedAgentIds: string[], query: string): MentionOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedSet = new Set(selectedAgentIds);
  const options: MentionOption[] = [];
  if (!normalizedQuery || 'all'.includes(normalizedQuery)) {
    options.push({ key: 'special:all', type: 'all', name: 'all', label: '@all', description: '当前房间全部 Agent' });
  }
  const sortedAgents = [...agents].sort((a, b) => Number(selectedSet.has(b.id)) - Number(selectedSet.has(a.id)) || a.name.localeCompare(b.name));
  for (const agent of sortedAgents) {
    const searchable = [agent.name, agent.id, agent.profileName, agent.role].filter(Boolean).join(' ').toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;
    options.push({
      key: `agent:${agent.id}`,
      type: 'agent',
      name: agent.name,
      label: `@${agent.name}`,
      description: `${selectedSet.has(agent.id) ? '当前房间 · ' : ''}${agent.role || agent.profileName || agent.model || 'Agent'}`,
      agent,
    });
  }
  return options;
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsDataURL(file);
  });
}


