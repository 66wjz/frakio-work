// wjz新建文件，新建原因：解耦 main.tsx 中的协作事件标签、任务会话详情卡片、内联协作方案块与动态活动摘要（CollaborationCards），修改时间：2026-08-17。
// 文件内容概述：跨 Agent 协作全景卡片 InlineCollaborationBlock、任务实时工作会话 CollaborationTaskSessionPanel、打字机动画态协作活动流 CollaborationActivityList、高频事件摘要 ChatCollaborationEvents 与运行时错误卡片。
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  File,
  FileText,
  FolderOpen,
  Link2,
  LoaderCircle,
  Network,
  Pause,
  Play,
  Plus,
  ShieldAlert,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  RunActivityItem,
} from '@frakio/contracts';
import type {
  Agent,
  AttachmentDraft,
  CollaborationEvent,
  CollaborationProposal,
  CollaborationSnapshot,
  CollaborationTask,
  CollaborationTaskDetail,
  CollaborationTaskStatus,
  CollaborationWorkflowSnapshot,
  Thread,
} from '../../types/workbench';
import { requestJson } from '../../utils/api-client';
import { formatTime } from '../../utils/formatters';
import {
  attachmentAcceptValue,
  collaborationStatusLabel,
} from '../../utils/workbench-helpers';
import {
  publishThreadCollaborationSnapshot,
  refreshThreadCollaboration,
  useThreadCollaboration,
} from '../../collaboration-store';
import { AgentAvatar } from '../common/AgentAvatar';
import { RunTranscriptContent } from '../chat/RunActivityViews';

export function collaborationEventLabel(type: string) {
  const labels: Record<string, string> = {
    'workflow.created': '工作流已创建',
    'workflow.completed': '工作流已完成',
    'workflow.failed': '工作流执行失败',
    'workflow.finalization_requested': '正在准备最终交付',
    'workflow.finalization_started': '协调 Agent 正在汇总',
    'workflow.delivery_ready': '最终交付已完成',
    'workflow.finalization_failed': '最终汇总失败',
    'workflow.pause_started': '正在暂停全部任务',
    'workflow.paused': '工作流已暂停',
    'workflow.pause_failed': '暂停未完全生效',
    'workflow.resume_started': '正在恢复全部任务',
    'workflow.resumed': '工作流已恢复',
    'workflow.cancelled': '协作已结束',
    'workflow.archived': '工作流已归档',
    'task.created': '任务已创建',
    'task.started': '任务开始执行',
    'task.waiting': '任务进入等待',
    'task.resumed': '任务自动恢复',
    'task.completed': '任务已完成',
    'task.review': '等待验收',
    'task.failed': '任务执行异常',
    'task.cancelled': '任务已取消',
    'dependency.created': '新增任务依赖',
    'dependency.satisfied': '依赖已经满足',
    'artifact.published': '交付物已发布',
    'artifact.conflict': '交付物发生冲突',
    'escalation.started': '阻塞已经升级',
    'escalation.resolved': '阻塞已经解决',
    'human.required': '需要人工介入',
    'intervention.sent': '用户已经介入',
    'mode.changed': '对话模式已切换',
    'plan.published': '协作方案已确认',
    'plan.revised': '协作方案已修订',
    'capability.blocked': '协作工具未加载',
  };
  return labels[type] || type;
}

export function compactCollaborationLabel(value: string, fallback: string) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) return fallback;
  if (source.length <= 28) return source;
  const segment = source.split(/[：:→|｜]/)[0].trim();
  return (segment || source).slice(0, 28) || fallback;
}

export function CollaborationTaskStatusLabel({ status }: { status: CollaborationTaskStatus }) {
  const label = collaborationStatusLabel(status);
  const reducedMotion = useReducedMotion();
  return (
    <small className={`collaboration-task-status status-${status}`} aria-label={label}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </small>
  );
}

export type CollaborationCardLifecycle =
  | 'proposal'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'delivery_failed'
  | 'paused'
  | 'failed'
  | 'cancelled';

export function collaborationLifecycleLabel(lifecycle: CollaborationCardLifecycle) {
  return ({
    proposal: '待确认',
    running: '执行中',
    finalizing: '正在汇总',
    completed: '已完成',
    delivery_failed: '汇总失败',
    paused: '已暂停',
    failed: '执行失败',
    cancelled: '已结束',
  } as Record<CollaborationCardLifecycle, string>)[lifecycle];
}

export function collaborationCardLifecycle(
  workflow: CollaborationWorkflowSnapshot | null | undefined,
  proposal: CollaborationProposal | null | undefined,
  tasks: CollaborationTask[],
): CollaborationCardLifecycle {
  if (!workflow) {
    if (proposal?.status === 'cancelled') return 'cancelled';
    if (proposal?.status === 'failed') return 'failed';
    return 'proposal';
  }
  if (workflow.status === 'cancelled') return 'cancelled';
  if (workflow.status === 'paused') return 'paused';
  const allTasksFinished =
    tasks.length > 0 &&
    tasks.every((task) => ['done', 'completed', 'cancelled', 'failed'].includes(task.status));
  const allExecutionTasksCompleted =
    tasks.length > 0 && tasks.every((task) => ['done', 'completed'].includes(task.status));
  if (workflow.finalization?.state === 'failed' && allExecutionTasksCompleted) return 'delivery_failed';
  if (workflow.status === 'failed') return 'failed';
  if (!allTasksFinished) return 'running';
  return workflow.status === 'completed' || workflow.finalization?.state === 'delivered'
    ? 'completed'
    : 'finalizing';
}

export function useCollaborationCompletionCelebrations(
  snapshot: CollaborationSnapshot | null,
  workflowId = '',
) {
  const [taskIds, setTaskIds] = useState<Set<string>>(() => new Set());
  const stateRef = useRef({ identity: '', cursor: 0 });
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!snapshot || !workflowId) return;
    const identity = `${snapshot.threadId}:${workflowId}`;
    if (stateRef.current.identity !== identity) {
      stateRef.current = { identity, cursor: snapshot.cursor };
      setTaskIds(new Set());
      return;
    }
    const previousCursor = stateRef.current.cursor;
    stateRef.current.cursor = Math.max(previousCursor, snapshot.cursor);
    const completedTaskIds = snapshot.events
      .filter(
        (event) =>
          event.workflowId === workflowId &&
          event.type === 'task.completed' &&
          event.cursor > previousCursor &&
          event.taskId,
      )
      .map((event) => String(event.taskId));
    if (!completedTaskIds.length) return;
    setTaskIds((current) => new Set([...current, ...completedTaskIds]));
    for (const taskId of completedTaskIds) {
      const currentTimer = timersRef.current.get(taskId);
      if (currentTimer) window.clearTimeout(currentTimer);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(taskId);
        setTaskIds((current) => {
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }, 650);
      timersRef.current.set(taskId, timer);
    }
  }, [snapshot?.threadId, snapshot?.cursor, workflowId]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  return taskIds;
}

export function CollaborationTaskSquare({
  completed,
  celebrating,
  status,
}: {
  completed: boolean;
  celebrating: boolean;
  status: CollaborationTaskStatus;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  return (
    <span
      className={`collaboration-task-square status-${status}${celebrating && !reducedMotion ? ' is-celebrating' : ''}`}
      aria-hidden="true"
    >
      {completed && (
        <motion.svg
          className="collaboration-task-check"
          viewBox="0 0 20 20"
          initial={celebrating && !reducedMotion ? { scale: 0.75 } : false}
          animate={{ scale: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'easeOut' }}
        >
          <motion.path
            d="M4.5 10.5 8 14l7.5-8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
            initial={celebrating && !reducedMotion ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{
              duration: reducedMotion ? 0 : 0.24,
              delay: reducedMotion ? 0 : 0.08,
              ease: 'easeOut',
            }}
          />
        </motion.svg>
      )}
      {celebrating && !reducedMotion && (
        <span className="collaboration-task-confetti">
          {Array.from({ length: 8 }, (_, index) => (
            <i style={{ '--particle-index': index } as React.CSSProperties} key={index} />
          ))}
        </span>
      )}
    </span>
  );
}

export function CollaborationSummaryCard({
  title,
  tasks,
  agents,
  lifecycle,
  density = 'chat',
  collapsed = false,
  onToggleCollapsed,
  onOpenTask,
  celebratingTaskIds,
  children,
}: {
  title: string;
  tasks: CollaborationTask[];
  agents: Agent[];
  lifecycle: CollaborationCardLifecycle;
  density?: 'chat' | 'rail';
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenTask?: (task: CollaborationTask) => void;
  celebratingTaskIds?: Set<string>;
  children?: React.ReactNode;
}) {
  const done = tasks.filter((task) => ['done', 'completed'].includes(task.status)).length;
  const taskCount = tasks.length;
  const completed = lifecycle === 'completed';
  const displayTitle = compactCollaborationLabel(title, '协作任务');
  const lifecycleLabel = collaborationLifecycleLabel(lifecycle);
  return (
    <section
      className={`collaboration-summary-card density-${density} state-${lifecycle}${collapsed ? ' is-collapsed' : ''}`}
      aria-label={title}
    >
      <header className="collaboration-summary-head">
        {collapsed && completed && onToggleCollapsed ? (
          <button type="button" className="collaboration-summary-collapse" onClick={onToggleCollapsed}>
            <span>
              <strong>{title}</strong>
              <small>{done} / {taskCount} 已完成</small>
            </span>
            <ChevronRight size={16} />
          </button>
        ) : (
          <span className="collaboration-summary-title">
            <ChevronDown size={16} aria-hidden="true" />
            <strong title={title}>{displayTitle}</strong>
            <small>· {taskCount} 项 · {lifecycleLabel}</small>
          </span>
        )}
      </header>
      {!collapsed && (
        <>
          <div className="collaboration-summary-tasks">
            {tasks.slice(0, 8).map((task) => {
              const agent = agents.find((item) => item.name === task.assignee || item.id === task.assignee);
              const taskDone = ['done', 'completed'].includes(task.status);
              const active = ['running', 'doing'].includes(task.status);
              const label = compactCollaborationLabel(task.title, '任务');
              return (
                <button
                  type="button"
                  key={task.id}
                  className={`collaboration-summary-task status-${task.status}${active ? ' is-active' : ''}`}
                  onClick={() => onOpenTask?.(task)}
                  disabled={!onOpenTask}
                >
                  <CollaborationTaskSquare
                    completed={taskDone}
                    celebrating={Boolean(celebratingTaskIds?.has(task.id))}
                    status={task.status}
                  />
                  <strong title={task.title}>{label}</strong>
                  <span className="collaboration-summary-owner">
                    {agent ? <AgentAvatar agent={agent} size="sm" /> : <span className="agent-avatar sm">{String(task.assignee || '?').slice(0, 1)}</span>}
                  </span>
                  <CollaborationTaskStatusLabel status={task.status} />
                </button>
              );
            })}
          </div>
          {children}
        </>
      )}
    </section>
  );
}

export const collaborationRuntimeEventTypes = [
  'run.accepted',
  'run.started',
  'message.delta',
  'reasoning.delta',
  'tool.started',
  'tool.completed',
  'approval.requested',
  'approval.resolved',
  'clarify.requested',
  'clarify.resolved',
  'context.compaction.started',
  'context.compaction.completed',
  'run.interrupting',
  'run.completed',
  'run.failed',
  'run.cancelled',
];

export function CollaborationTaskSessionPanel({
  threadId,
  workflow,
  task,
  snapshotCursor,
  onBack,
}: {
  threadId: string;
  workflow: CollaborationWorkflowSnapshot;
  task: CollaborationTask;
  snapshotCursor: number;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<CollaborationTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [intervention, setIntervention] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [sending, setSending] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState('');
  const [hasNewContent, setHasNewContent] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const followStreamRef = useRef(true);
  const refreshTimerRef = useRef<number | null>(null);
  const versionRef = useRef('');
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const refreshDetail = useCallback(async () => {
    try {
      const endpoint = workflow.nativeOnly
        ? `/api/workflows/${encodeURIComponent(workflow.id)}/tasks/${encodeURIComponent(task.id)}`
        : `/api/hermes/kanban/tasks/${encodeURIComponent(task.id)}?board=${encodeURIComponent(workflow.boardSlug)}`;
      const data = await requestJson<{ detail: CollaborationTaskDetail }>(endpoint);
      setDetail(data.detail);
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '工作会话加载失败。');
    } finally {
      setLoading(false);
    }
  }, [task.id, workflow.id, workflow.nativeOnly, workflow.boardSlug]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail, snapshotCursor]);

  const latestRun = detail?.runs?.at(-1) || null;
  useEffect(() => {
    if (!latestRun?.id || ['ended', 'failed', 'aborted'].includes(latestRun.status)) return undefined;
    const cursor = Math.max(0, Number(latestRun.presentation?.lastCursor || 0));
    const source = new EventSource(`/api/runtime-runs/${latestRun.id}/events?cursor=${cursor}`);
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refreshDetail();
      }, 120);
    };
    for (const eventType of collaborationRuntimeEventTypes) source.addEventListener(eventType, scheduleRefresh);
    source.onerror = scheduleRefresh;
    return () => {
      source.close();
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [latestRun?.id, latestRun?.status, latestRun?.presentation?.lastCursor, refreshDetail]);

  const presentation = latestRun?.presentation || null;
  const contentVersion = `${presentation?.revision || 0}:${presentation?.lastCursor || 0}:${Array.isArray(detail?.events) ? detail.events.length : Array.isArray(detail?.runtimeEvents) ? detail.runtimeEvents.length : 0}:${Array.isArray(detail?.artifacts) ? detail.artifacts.length : 0}`;
  useLayoutEffect(() => {
    const node = streamRef.current;
    if (!node || versionRef.current === contentVersion) return;
    const initial = !versionRef.current;
    versionRef.current = contentVersion;
    if (initial || followStreamRef.current) {
      node.scrollTop = node.scrollHeight;
      setHasNewContent(false);
    } else {
      setHasNewContent(true);
    }
  }, [contentVersion]);

  const scrollToLatest = () => {
    const node = streamRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    followStreamRef.current = true;
    setHasNewContent(false);
  };

  async function sendIntervention() {
    const attachmentIds = attachments.flatMap((item) => (item.attachment?.id ? [item.attachment.id] : []));
    if ((!intervention.trim() && !attachmentIds.length) || sending) return;
    setSending(true);
    try {
      await requestJson(`/api/threads/${threadId}/collaboration/interventions`, {
        method: 'POST',
        body: JSON.stringify({
          workflowId: workflow.id,
          taskId: task.id,
          action: 'message',
          message: intervention.trim(),
          attachmentIds,
          idempotencyKey: globalThis.crypto.randomUUID(),
        }),
      });
      setIntervention('');
      attachments.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      setAttachments([]);
      await refreshDetail();
    } finally {
      setSending(false);
    }
  }

  async function addAttachments(files: FileList | null) {
    const selected = Array.from(files || []).slice(0, Math.max(0, 10 - attachments.length));
    if (!selected.length) return;
    const queued = selected.map((file): AttachmentDraft => ({
      localId: crypto.randomUUID(),
      file,
      previewUrl: '',
      status: 'uploading',
    }));
    setAttachments((current) => [...current, ...queued]);
    await Promise.all(
      queued.map(async (draft) => {
        try {
          const response = await fetch(`/api/attachments?name=${encodeURIComponent(draft.file.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': draft.file.type || 'application/octet-stream' },
            body: draft.file,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.attachment) throw new Error(data.error || '上传失败');
          setAttachments((current) =>
            current.map((item) =>
              item.localId === draft.localId ? { ...item, status: 'ready', attachment: data.attachment } : item,
            ),
          );
        } catch (nextError) {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === draft.localId
                ? { ...item, status: 'error', error: nextError instanceof Error ? nextError.message : '上传失败' }
                : item,
            ),
          );
        }
      }),
    );
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  function removeAttachment(localId: string) {
    const attachment = attachments.find((item) => item.localId === localId)?.attachment;
    setAttachments((current) => current.filter((item) => item.localId !== localId));
    if (attachment?.id) void fetch(`/api/attachments/${attachment.id}`, { method: 'DELETE' }).catch(() => null);
  }

  async function resolveApproval(decision: 'approve_once' | 'deny') {
    const approvalId = presentation?.approval?.id;
    if (!latestRun?.id || !approvalId || approvalBusy) return;
    setApprovalBusy(decision);
    try {
      await requestJson(`/api/runtime-runs/${latestRun.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approvalId, decision }),
      });
      await refreshDetail();
    } finally {
      setApprovalBusy('');
    }
  }

  const statusText =
    ({
      pending_confirmation: '待确认',
      running: '执行中',
      doing: '执行中',
      blocked: '等待依赖',
      waiting_dependency: '等待依赖',
      waiting_input: '等待输入',
      todo: '待执行',
      ready: '待执行',
      review: '待验收',
      done: '已完成',
      completed: '已完成',
      failed: '失败',
      paused: '已暂停',
      cancelled: '已结束',
    } as Record<string, string>)[detail?.task.status || task.status] ||
    detail?.task.status ||
    task.status;
  const collaborationEvents = (Array.isArray(detail?.events)
    ? detail.events
    : Array.isArray(detail?.runtimeEvents)
      ? detail.runtimeEvents
      : []) as CollaborationEvent[];
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  const parents = Array.isArray(detail?.parents) ? detail.parents : [];
  const children = Array.isArray(detail?.children) ? detail.children : [];

  return (
    <section className="collaboration-agent-panel" aria-labelledby={`collaboration-task-${task.id}`}>
      <div className="modal-head collaboration-agent-head">
        <div>
          <button type="button" className="collaboration-session-back" onClick={onBack}>
            <ArrowLeft size={14} />协作总览
          </button>
          <small>
            {task.assignee || detail?.task.assigneeAgentId || 'Agent'} · {detail?.task.runtimeId || latestRun?.runtimeId || 'Runtime'}
          </small>
          <h2 id={`collaboration-task-${task.id}`}>{task.title}</h2>
          <p>{statusText} · 工作会话</p>
        </div>
      </div>
      <div
        className="collaboration-agent-stream"
        ref={streamRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
          followStreamRef.current = nearBottom;
          if (nearBottom) setHasNewContent(false);
        }}
      >
        {loading && !detail && (
          <div className="resource-empty">
            <LoaderCircle className="spin" size={16} />正在载入工作会话
          </div>
        )}
        {error && (
          <div className="collaboration-session-error">
            <TriangleAlert size={15} />{error}
            <button onClick={() => void refreshDetail()}>重试</button>
          </div>
        )}
        {detail && (
          <>
            <div className="collaboration-session-meta">
              <span>
                <Clock3 size={14} />
                {latestRun ? `${latestRun.runtimeId || detail?.task.runtimeId || 'Runtime'} · ${latestRun.status}` : '尚未启动 Run'}
              </span>
              <span>
                <Link2 size={14} />{parents.length} 个上游 · {children.length} 个下游
              </span>
              <span>
                <FileText size={14} />{artifacts.length} 个产物
              </span>
            </div>
            {presentation?.approval && (
              <section className="collaboration-session-approval">
                <div>
                  <ShieldAlert size={16} />
                  <span>
                    <strong>{presentation.approval.title || '等待操作确认'}</strong>
                    <small>{presentation.approval.command || presentation.approval.tool || 'Agent 请求执行受控操作'}</small>
                  </span>
                </div>
                <div>
                  <button disabled={Boolean(approvalBusy)} onClick={() => void resolveApproval('deny')}>拒绝</button>
                  <button className="primary" disabled={Boolean(approvalBusy)} onClick={() => void resolveApproval('approve_once')}>
                    {approvalBusy ? '正在处理' : '允许一次'}
                  </button>
                </div>
              </section>
            )}
            {presentation?.clarification && (
              <section className="collaboration-session-clarification">
                <CircleHelp size={16} />
                <span>
                  <strong>等待你的补充</strong>
                  <small>{presentation.clarification.question}</small>
                </span>
              </section>
            )}
            {presentation?.content || presentation?.activityGroups?.length ? (
              <section className="collaboration-session-output">
                <RunTranscriptContent
                  content={presentation.content || ''}
                  groups={presentation.activityGroups || []}
                  streaming={!['ended', 'failed', 'aborted'].includes(latestRun?.status || '')}
                  runFinished={['ended', 'failed', 'aborted'].includes(latestRun?.status || '')}
                  showAwaiting={latestRun?.status === 'running'}
                  threadId={threadId}
                />
              </section>
            ) : (
              <div className="collaboration-session-events">
                {collaborationEvents.map((event) => {
                  const label =
                    event.title ||
                    event.detail ||
                    event.payload?.title ||
                    event.payload?.detail ||
                    collaborationEventLabel(event.type) ||
                    event.type;
                  return (
                    <div className="collaboration-agent-event" key={event.id}>
                      <span className="collaboration-event-dot" />
                      <div>
                        <strong>{label}</strong>
                        <small>{formatTime(event.createdAt)}</small>
                      </div>
                    </div>
                  );
                })}
                {!collaborationEvents.length && (
                  <div className="resource-empty">Agent 尚未产生可展示的内容。</div>
                )}
              </div>
            )}
            {(parents.length > 0 || children.length > 0) && (
              <section className="collaboration-session-section">
                <header><Network size={14} />任务依赖</header>
                <div className="collaboration-session-chips">
                  {parents.map((id) => <span key={`parent-${id}`}>上游 · {id}</span>)}
                  {children.map((id) => <span key={`child-${id}`}>下游 · {id}</span>)}
                </div>
              </section>
            )}
            {artifacts.length > 0 && (
              <section className="collaboration-session-section">
                <header><FileText size={14} />交付产物</header>
                <div className="collaboration-session-artifacts">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => void (window as any).frakioDesktop?.showItemInFolder?.(artifact.path)}
                    >
                      <File size={14} />
                      <span>
                        <strong>{artifact.metadata?.name || artifact.path.split('/').at(-1) || '产物'}</strong>
                        <small>{artifact.path}</small>
                      </span>
                      {(window as any).frakioDesktop?.showItemInFolder && <FolderOpen size={14} />}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {hasNewContent && (
        <button type="button" className="collaboration-new-content" onClick={scrollToLatest}>
          <ArrowDownToLine size={14} />查看新内容
        </button>
      )}
      {attachments.length > 0 && (
        <div className="collaboration-intervention-attachments">
          {attachments.map((item) => (
            <span key={item.localId}>
              <FileText size={12} />
              <em>{item.file.name}</em>
              <small>{item.status === 'uploading' ? '上传中' : item.status === 'error' ? '失败' : ''}</small>
              <button
                type="button"
                onClick={() => removeAttachment(item.localId)}
                aria-label={`移除 ${item.file.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="collaboration-agent-composer">
        <input
          ref={attachmentInputRef}
          className="file-input"
          type="file"
          multiple
          accept={attachmentAcceptValue}
          onChange={(event) => void addAttachments(event.target.files)}
        />
        <button
          type="button"
          className="top-icon-btn"
          onClick={() => attachmentInputRef.current?.click()}
          aria-label="添加附件"
          title="添加附件"
        >
          <Plus size={15} />
        </button>
        <textarea
          value={intervention}
          onChange={(event) => setIntervention(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void sendIntervention();
          }}
          placeholder="补充方向、资料或约束…"
          rows={2}
        />
        <button
          type="button"
          className="send-btn"
          disabled={(!intervention.trim() && !attachments.some((item) => item.status === 'ready')) || sending}
          onClick={() => void sendIntervention()}
          aria-label="发送引导"
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </section>
  );
}

export function InlineCollaborationBlock({
  thread,
  agents,
  anchorMessageId,
  anchorPlanId,
  fallback = false,
  onAdjust,
}: {
  thread: Thread | null;
  agents: Agent[];
  anchorMessageId?: string;
  anchorPlanId?: string;
  fallback?: boolean;
  onAdjust: (planId: string, feedback: string) => void;
}) {
  const collaborationState = useThreadCollaboration<CollaborationSnapshot>(thread?.id);
  const snapshot = collaborationState.snapshot;
  const syncPending = collaborationState.syncPending;
  const [sticky, setSticky] = useState(false);
  const [dismissedStickySignature, setDismissedStickySignature] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'cancel' | ''>('');
  const [adjusting, setAdjusting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [workflowControlBusy, setWorkflowControlBusy] = useState<'pause' | 'resume' | 'cancel' | ''>('');
  const [finalizationRetrying, setFinalizationRetrying] = useState(false);
  const blockRef = useRef<HTMLDivElement | null>(null);
  const proposal = (snapshot?.proposals || []).find(
    (item) =>
      (anchorMessageId && item.proposalMessageId === anchorMessageId) ||
      (anchorPlanId && item.sourcePlanId === anchorPlanId),
  ) || null;
  const anchoredWorkflow = proposal?.workflowId
    ? snapshot?.workflows.find((item) => item.id === proposal.workflowId)
    : snapshot?.workflows.find((item) => item.approvedPlanId === anchorPlanId);
  const workflow =
    anchoredWorkflow ||
    (fallback
      ? [...(snapshot?.workflows || [])]
          .reverse()
          .find(
            (item) =>
              item.status !== 'archived' &&
              !(
                item.approvedPlanId &&
                (thread?.messages || []).some((message) => message.planId === item.approvedPlanId)
              ),
          )
      : null);
  const celebratingTaskIds = useCollaborationCompletionCelebrations(snapshot, workflow?.id || '');
  const workflowSignature = workflow
    ? `${workflow.id}:${workflow.status}`
    : proposal
      ? `${proposal.id}:${proposal.revision}:${proposal.status}`
      : '';

  useEffect(() => {
    setSticky(false);
    setDismissedStickySignature('');
  }, [thread?.id]);

  useEffect(() => {
    const node = blockRef.current;
    if (!node || !workflow || workflow.status === 'archived' || proposal?.status !== 'confirmed') {
      setSticky(false);
      return undefined;
    }
    const root = node.closest('.thread');
    if (!root) {
      setSticky(false);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setSticky(!entry.isIntersecting && entry.boundingClientRect.top < root.getBoundingClientRect().top),
      { root, threshold: 0.02 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [workflowSignature, proposal?.status]);

  const proposalSteps = Array.isArray((proposal?.content as any)?.steps)
    ? (proposal?.content as any).steps
    : Array.isArray((proposal?.content as any)?.tasks)
      ? (proposal?.content as any).tasks
      : [];
  const tasks: CollaborationTask[] =
    workflow?.tasks.filter((task) => task.status !== 'archived' && task.id !== workflow.currentRootTaskId) ||
    proposalSteps.map(
      (step: any, index: number): CollaborationTask => ({
        id: String(step.taskId || step.key || index),
        title: String(step.title || '未命名任务'),
        assignee: agents.find((agent) => agent.id === step.assigneeAgentId)?.name || step.assigneeAgentId || '未分配',
        status: 'pending_confirmation',
      }),
    );
  const lifecycle = collaborationCardLifecycle(workflow, proposal, tasks);
  if ((!workflow && !proposal) || !tasks.length) return null;
  const done = tasks.filter((task) => ['done', 'completed'].includes(task.status)).length;
  const confirmed = Boolean(workflow || proposal?.status === 'confirmed');

  async function confirmProposal() {
    if (!thread?.id || !proposal || busy) return;
    setBusy('confirm');
    setActionError('');
    try {
      const data = await requestJson<{ snapshot: CollaborationSnapshot }>(
        `/api/threads/${thread.id}/collaboration/proposals/${proposal.id}/confirm`,
        { method: 'POST', body: JSON.stringify({ revision: proposal.revision, confirmedBy: 'user' }) },
      );
      publishThreadCollaborationSnapshot(data.snapshot);
      window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      window.dispatchEvent(new CustomEvent('frakio:thread-refresh-request', { detail: { threadId: thread.id } }));
    } catch (err: any) {
      setActionError(err instanceof Error ? err.message : '协作启动失败。');
    } finally {
      setBusy('');
    }
  }

  async function cancelProposal() {
    if (!thread?.id || !proposal || busy) return;
    setBusy('cancel');
    setActionError('');
    try {
      await requestJson(`/api/threads/${thread.id}/collaboration/proposals/${proposal.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshThreadCollaboration(thread.id);
    } catch (err: any) {
      setActionError(err instanceof Error ? err.message : '取消协作方案失败。');
    } finally {
      setBusy('');
    }
  }

  async function controlWorkflow(action: 'pause' | 'resume' | 'cancel') {
    if (!thread?.id || !workflow || workflowControlBusy) return;
    if (action === 'cancel' && !window.confirm('结束协作后，未完成任务将停止。')) return;
    setWorkflowControlBusy(action);
    setActionError('');
    try {
      const data = await requestJson<{ snapshot: CollaborationSnapshot }>(
        `/api/threads/${thread.id}/collaboration/workflows/${workflow.id}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey: `${action}:${globalThis.crypto.randomUUID()}` }),
        },
      );
      publishThreadCollaborationSnapshot(data.snapshot);
      window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      window.dispatchEvent(new CustomEvent('frakio:thread-refresh-request', { detail: { threadId: thread.id } }));
    } catch (err: any) {
      setActionError(err instanceof Error ? err.message : '协作控制失败。');
    } finally {
      setWorkflowControlBusy('');
    }
  }

  async function retryFinalization() {
    if (!thread?.id || !workflow || finalizationRetrying) return;
    setFinalizationRetrying(true);
    setActionError('');
    try {
      const data = await requestJson<{ snapshot: CollaborationSnapshot }>(
        `/api/threads/${thread.id}/collaboration/workflows/${workflow.id}/retry-finalization`,
        {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey: `retry-finalization:${globalThis.crypto.randomUUID()}` }),
        },
      );
      publishThreadCollaborationSnapshot(data.snapshot);
    } catch (err: any) {
      setActionError(err instanceof Error ? err.message : '最终汇总重试失败。');
    } finally {
      setFinalizationRetrying(false);
    }
  }

  return (
    <>
      <section
        className="inline-collaboration-block"
        ref={blockRef}
        aria-label={proposal?.title || workflow?.name || '协作任务'}
      >
        {syncPending && (
          <div className="collaboration-sync-pending" role="status">
            <LoaderCircle size={13} className="spin" />状态待同步
          </div>
        )}
        <CollaborationSummaryCard
          title={proposal?.title || workflow?.name || '协作任务'}
          tasks={tasks}
          agents={agents}
          lifecycle={lifecycle}
          celebratingTaskIds={celebratingTaskIds}
          onOpenTask={
            workflow
              ? (task) =>
                  window.dispatchEvent(
                    new CustomEvent('frakio:open-collaboration-task', {
                      detail: { threadId: thread?.id, workflowId: workflow.id, taskId: task.id },
                    }),
                  )
              : undefined
          }
        >
          {!confirmed && proposal?.status !== 'cancelled' && (
            <>
              {adjusting && (
                <div className="collaboration-adjust">
                  <textarea
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="说明需要调整的方向"
                    rows={2}
                  />
                  <button
                    disabled={!feedback.trim()}
                    onClick={() => {
                      onAdjust(String(proposal?.sourcePlanId || ''), feedback);
                      setAdjusting(false);
                      setFeedback('');
                    }}
                  >
                    提交调整
                  </button>
                </div>
              )}
              <div className="collaboration-proposal-actions">
                <button onClick={() => void cancelProposal()} disabled={Boolean(busy)}>取消</button>
                <button onClick={() => setAdjusting((value) => !value)}>调整方案</button>
                <button className="primary" onClick={() => void confirmProposal()} disabled={Boolean(busy)}>
                  {busy === 'confirm' ? '正在启动' : '确认执行'}
                </button>
              </div>
            </>
          )}
          {confirmed && workflow && ['active', 'paused'].includes(workflow.status) && (
            <div className="collaboration-workflow-inline-actions">
              <button
                type="button"
                onClick={() => void controlWorkflow(workflow.status === 'paused' ? 'resume' : 'pause')}
                disabled={Boolean(workflowControlBusy)}
              >
                {workflowControlBusy === 'pause' || workflowControlBusy === 'resume' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : workflow.status === 'paused' ? (
                  <Play size={14} fill="currentColor" />
                ) : (
                  <Pause size={14} fill="currentColor" />
                )}
                {workflow.status === 'paused' ? '恢复协作' : '暂停协作'}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void controlWorkflow('cancel')}
                disabled={Boolean(workflowControlBusy)}
              >
                {workflowControlBusy === 'cancel' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Square size={13} fill="currentColor" />
                )}
                结束协作
              </button>
            </div>
          )}
          {workflow?.finalization?.state === 'running' && (
            <div className="collaboration-final-delivery-status">
              <LoaderCircle size={14} className="spin" />
              <span>
                <strong>执行任务已经完成</strong>
                <small>协调 Agent 正在整理最终交付</small>
              </span>
            </div>
          )}
          {workflow?.finalization?.state === 'delivered' && workflow.finalDelivery?.status === 'ready' && (
            <button
              type="button"
              className="collaboration-final-delivery-link"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('frakio:open-collaboration-rail', {
                    detail: { threadId: thread?.id, workflowId: workflow.id },
                  }),
                )
              }
            >
              <CheckCircle2 size={15} />
              <span>
                <strong>Iris 已完成最终汇总</strong>
                <small>{workflow.finalDelivery.summary || '查看本次协作交付'}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          )}
          {workflow?.finalization?.state === 'failed' && (
            <div className="collaboration-final-delivery-status failed">
              <TriangleAlert size={14} />
              <span>
                <strong>任务已完成，最终汇总失败</strong>
                <small>{workflow.finalization.error || '可以只重新生成总结，不会重跑任务。'}</small>
              </span>
              <button type="button" disabled={finalizationRetrying} onClick={() => void retryFinalization()}>
                {finalizationRetrying ? '重试中' : '重新生成总结'}
              </button>
            </div>
          )}
          {actionError && <div className="collaboration-card-error">{actionError}</div>}
        </CollaborationSummaryCard>
      </section>
      {confirmed && (
        <CollaborationActivityList
          tasks={tasks}
          events={snapshot?.events || []}
          agents={agents}
          onOpen={(task) =>
            workflow &&
            window.dispatchEvent(
              new CustomEvent('frakio:open-collaboration-task', {
                detail: { threadId: thread?.id, workflowId: workflow.id, taskId: task.id },
              }),
            )
          }
        />
      )}
      {sticky && dismissedStickySignature !== workflowSignature && (
        <div className="sticky-collaboration-bar">
          <button
            type="button"
            className="sticky-collaboration-main"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('frakio:open-collaboration-rail', {
                  detail: { threadId: thread?.id, workflowId: workflow?.id },
                }),
              )
            }
          >
            <Activity size={14} />
            <span>
              <strong>
                {lifecycle === 'completed'
                  ? '协作已完成'
                  : lifecycle === 'delivery_failed'
                    ? '任务完成，汇总失败'
                    : workflow?.name || proposal?.title}
              </strong>
              <small>
                {lifecycle === 'completed'
                  ? '查看 Iris 总结'
                  : lifecycle === 'delivery_failed'
                    ? '点击重新生成总结'
                    : `${done}/${tasks.length} 完成`}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className="sticky-collaboration-dismiss"
            onClick={() => setDismissedStickySignature(workflowSignature)}
            aria-label="关闭协作任务条"
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );
}

export const collaborationWaitingCopies = [
  (upstream: string) => (upstream ? `我先候着，等 ${upstream} 把结果交过来…` : '我先候着，轮到我就开始…'),
  (upstream: string) => (upstream ? `${upstream} 还在忙，我在这里等着…` : '前面的任务还在进行，我在这里等着…'),
  () => '结果一到，我就接着处理…',
  () => '我这边准备好了，就等前面的交付…',
  () => '还没轮到我，我先在这里候着…',
  () => '上游还在忙，我随时可以接手…',
];

export function collaborationTextHash(value: string) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  return Math.abs(hash);
}

export function compactCollaborationActivity(value: string) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  return source.length <= 32 ? source : `${source.slice(0, 31)}…`;
}

export function collaborationActivityCopy(task: CollaborationTask, waitingClock: number) {
  const status = task.status;
  const activity = task.activity;
  const taskTitle = compactCollaborationLabel(task.title, '这项任务');
  if (['done', 'completed'].includes(status)) return { text: `我已搞定「${taskTitle}」`, phase: 'completed' };
  if (status === 'waiting_input') return { text: '我还缺一点信息，等你补充后继续…', phase: 'waiting_input' };
  if (status === 'paused') return { text: '我先停在这里，恢复后继续处理。', phase: 'paused' };
  if (status === 'failed') return { text: `这里没有跑通，需要重新处理「${taskTitle}」`, phase: 'failed' };
  if (['cancelled', 'archived'].includes(status)) return { text: '这项任务已经结束。', phase: 'cancelled' };
  if (status === 'review') return { text: '我已经交付，正在等验收…', phase: 'waiting_input' };
  if (['running', 'doing'].includes(status)) {
    const target = String(activity?.target || '').trim();
    const copyByKind: Partial<Record<RunActivityItem['kind'], string>> = {
      read: target ? `我正在读「${target}」…` : '我正在读取需要的资料…',
      search: target ? `我正在项目里查找「${target}」…` : '我正在项目里查找相关内容…',
      edit: target ? `我正在调整「${target}」…` : '我正在整理需要修改的内容…',
      write: target ? `我正在写入「${target}」…` : '我正在写入交付内容…',
      command: '我正在运行验证，确认结果是否正确…',
      web: '我正在查找需要的公开资料…',
      skill: '我正在调用合适的能力继续处理…',
      collaboration: '我正在整理协作任务的最新进展…',
      other: '我正在继续处理这项任务…',
    };
    const projected = activity?.kind ? copyByKind[activity.kind] : '';
    const displayName = String(activity?.displayName || '').replace(/^我/, '').trim();
    const fallback =
      displayName && !/^(执行任务|任务已开始)$/.test(displayName)
        ? `我${displayName.startsWith('正在') ? '' : '正在'}${displayName}${displayName.endsWith('…') ? '' : '…'}`
        : `我正在处理「${taskTitle}」…`;
    return { text: compactCollaborationActivity(projected || fallback), phase: 'running' };
  }
  const waitingSince = Date.parse(String(activity?.waitingSince || activity?.changedAt || '')) || waitingClock;
  const bucket = Math.max(0, Math.floor((waitingClock - waitingSince) / 12_000));
  const index = (collaborationTextHash(task.id) + bucket) % collaborationWaitingCopies.length;
  const upstream = (activity?.upstreamAgentNames || []).slice(0, 2).join('、');
  return {
    text: compactCollaborationActivity(collaborationWaitingCopies[index](upstream)),
    phase: 'waiting_dependency',
  };
}

export function collaborationTextSegments(value: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const Segmenter = Intl.Segmenter as typeof Intl.Segmenter;
    return [...new Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value)].map((entry) => entry.segment);
  }
  return Array.from(value);
}

export function AnimatedCollaborationActivityText({ text, active }: { text: string; active: boolean }) {
  const reducedMotion = Boolean(useReducedMotion());
  const [visible, setVisible] = useState(text);
  const [announced, setAnnounced] = useState(text);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    if (reducedMotion || visible === text) {
      setVisible(text);
      setAnnounced(text);
      return undefined;
    }
    const previous = collaborationTextSegments(visible);
    const next = collaborationTextSegments(text);
    const eraseStep = Math.max(8, Math.floor(160 / Math.max(1, previous.length)));
    const typeStep = Math.max(12, Math.min(28, Math.floor(420 / Math.max(1, next.length))));
    previous.forEach((_, index) => {
      timersRef.current.push(
        window.setTimeout(() => setVisible(previous.slice(0, previous.length - index - 1).join('')), eraseStep * (index + 1)),
      );
    });
    const eraseDuration = eraseStep * previous.length;
    next.forEach((_, index) => {
      timersRef.current.push(
        window.setTimeout(
          () => setVisible(next.slice(0, index + 1).join('')),
          eraseDuration + 36 + typeStep * (index + 1),
        ),
      );
    });
    timersRef.current.push(
      window.setTimeout(() => setAnnounced(text), eraseDuration + 36 + typeStep * next.length),
    );
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    };
  }, [text, reducedMotion]);

  const waitingEllipsis = !active && visible.endsWith('…');
  return (
    <span className={`collaboration-activity-summary${active ? ' is-active' : ''}`} title={text}>
      <span aria-hidden="true">
        {waitingEllipsis ? visible.slice(0, -1) : visible}
        {waitingEllipsis && <i className="collaboration-waiting-ellipsis">…</i>}
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announced}
      </span>
    </span>
  );
}

export function CollaborationActivityList({
  tasks,
  events,
  agents,
  onOpen,
}: {
  tasks: CollaborationTask[];
  events: CollaborationEvent[];
  agents: Agent[];
  onOpen: (task: CollaborationTask) => void;
}) {
  const hasWaitingTasks = tasks.some((task) =>
    ['pending_confirmation', 'ready', 'todo', 'scheduled', 'blocked', 'waiting_dependency'].includes(task.status),
  );
  const [waitingClock, setWaitingClock] = useState(() => Date.now());

  useEffect(() => {
    if (!hasWaitingTasks) return undefined;
    let timer = 0;
    const schedule = () => {
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        setWaitingClock(Date.now());
        schedule();
      }, 1000);
    };
    const onVisibilityChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (!document.hidden) {
        setWaitingClock(Date.now());
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hasWaitingTasks]);

  if (!tasks.length) return null;
  return (
    <div className="collaboration-activity-trace">
      {tasks.map((task) => {
        const agent = agents.find((item) => item.name === task.assignee || item.id === task.assignee);
        const fallbackEvent = [...events].reverse().find((item) => item.taskId === task.id);
        const activity = collaborationActivityCopy(task, waitingClock);
        const active = activity.phase === 'running';
        return (
          <button
            type="button"
            key={task.id}
            className={`is-${activity.phase}${active ? ' is-live' : ''}`}
            onClick={() => onOpen(task)}
            title={fallbackEvent?.detail || activity.text}
          >
            {agent ? <AgentAvatar agent={agent} size="sm" /> : <span className="agent-avatar sm">{String(task.assignee || '?').slice(0, 1)}</span>}
            <strong>{agent?.name || task.assignee || 'Agent'}</strong>
            <span className="collaboration-activity-copy">
              <AnimatedCollaborationActivityText text={activity.text} active={active} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChatCollaborationEvents({ thread }: { thread: Thread | null }) {
  const { snapshot } = useThreadCollaboration<CollaborationSnapshot>(thread?.id);
  const events = snapshot?.events || thread?.collaboration?.events || [];
  const highSignal = events
    .filter((event) =>
      [
        'plan.published',
        'plan.revised',
        'workflow.paused',
        'workflow.pause_failed',
        'workflow.resumed',
        'workflow.cancelled',
        'task.waiting',
        'task.resumed',
        'task.completed',
        'task.failed',
        'escalation.started',
        'human.required',
        'intervention.sent',
      ].includes(event.type),
    )
    .slice(-3);
  if (!highSignal.length) return null;
  return (
    <div className="chat-collaboration-events">
      {highSignal.map((event) => (
        <div
          className={
            event.type === 'human.required' ||
            event.type === 'task.waiting' ||
            event.type === 'workflow.pause_failed'
              ? 'waiting'
              : event.type === 'workflow.paused'
                ? 'paused'
                : event.type === 'workflow.cancelled'
                  ? 'cancelled'
                  : ''
          }
          key={event.id}
        >
          <span><Activity size={14} /></span>
          <span>
            <strong>{event.title || collaborationEventLabel(event.type)}</strong>
            <small>
              {event.type.startsWith('plan.')
                ? `${event.payload?.taskCount || 0} 项任务 · ${(event.payload?.agentIds || []).length} 位 Agent${event.detail ? ` · ${event.detail}` : ''}`
                : event.detail || collaborationEventLabel(event.type)}
            </small>
          </span>
        </div>
      ))}
    </div>
  );
}

export function CollaborationRuntimeErrorCard({
  error,
  loading,
  onRetry,
}: {
  error: { message: string; code?: string; details?: Record<string, any> };
  loading?: boolean;
  onRetry: () => void;
}) {
  const details = error.details || {};
  const detailLines = [
    details.profileName ? `Profile：${details.profileName}` : '',
    details.missingPythonPackages?.length ? `缺少运行库：${details.missingPythonPackages.join('、')}` : '',
    details.missingTools?.length ? `缺少工具：${details.missingTools.join('、')}` : '',
    ...Object.entries(details.connectionErrors || {}).map(([name, message]) => `${name}：${String(message)}`),
  ].filter(Boolean);
  return (
    <div className="collaboration-runtime-error" role="alert">
      <div>
        <ShieldAlert size={18} />
        <span>
          <strong>协作运行时未准备好</strong>
          <small>{error.message}</small>
        </span>
      </div>
      <button type="button" disabled={loading} onClick={onRetry}>{loading ? '正在加载' : '重新加载'}</button>
      {(error.code || detailLines.length > 0) && (
        <details>
          <summary>技术详情</summary>
          <pre>{[error.code || '', ...detailLines].filter(Boolean).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
// wjz新建文件结束。
