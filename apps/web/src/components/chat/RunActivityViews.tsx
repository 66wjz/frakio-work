// wjz新建文件，新建原因：解耦 main.tsx 中的 RunActivityViews 运行动态流式渲染、决策审批、活动卡片与上下文压缩组件，修改时间：2026-08-17。
// 文件内容概述：RunTranscriptContent 动态时间线、ChatRunStatus 会话执行状态条、RunDecisionPanel 权限/澄清审批盘、ComposerRunButton 发送/停止键、useStreamRevealFrame 打字机渐显钩子。
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BaseIcon,
  BaseButton,
  BaseBadge,
  BaseAlert,
} from '../base';

const ArrowUp = (p: any) => <BaseIcon name="arrow-up" {...p} />;
const ArrowUpRight = (p: any) => <BaseIcon name="arrow-up-right" {...p} />;
const Check = (p: any) => <BaseIcon name="check" {...p} />;
const CheckCircle2 = (p: any) => <BaseIcon name="check-circle-2" {...p} />;
const ChevronRight = (p: any) => <BaseIcon name="chevron-right" {...p} />;
const LoaderCircle = (p: any) => <BaseIcon name="loader-circle" {...p} />;
const PauseCircle = (p: any) => <BaseIcon name="pause-circle" {...p} />;
const Square = (p: any) => <BaseIcon name="square" {...p} />;
const TriangleAlert = (p: any) => <BaseIcon name="triangle-alert" {...p} />;
const X = (p: any) => <BaseIcon name="x" {...p} />;
import type {
  RunActivityGroup,
  RunActivityItem,
} from '@frakio/contracts';
import type {
  Agent,
  ChatRunTarget,
  HermesApprovalChoice,
  HermesRunApproval,
  HermesRunClarification,
  RunPresentationPhase,
  RunUiState,
  StreamRevealFrame,
  Thread,
} from '../../types/workbench';
import {
  activityElapsedMs,
  activityGroupPreview,
  formatActivityDuration,
  formatRunElapsed,
  nextActivityExpanded,
  processingMessageAt,
  shouldShowRunPresence,
} from '../../run-presence.mjs';
import {
  activityTimelineEntries,
  buildRunActivityTimeline,
} from '../../run-activity-timeline.mjs';
import {
  STREAM_REVEAL_ANIMATION_MS,
  STREAM_REVEAL_MAX_LAG_MS,
  STREAM_REVEAL_MIN_COMMIT_MS,
  streamRevealTransition,
} from '../../stream-reveal.mjs';
import { AgentAvatar } from '../common/AgentAvatar';
import { MarkdownMessage } from './MarkdownMessage';
import {
  DecisionOptionRow,
  DecisionOtherRow,
  DecisionTray,
} from '../collaboration/PlanAndDecisionPanels';

export function useStreamRevealFrame(rawContent: string, enabled: boolean, reduceMotion: boolean): StreamRevealFrame {
  const rawRef = useRef('');
  const displayedRef = useRef('');
  const queueStartedAtRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const [frame, setFrame] = useState<StreamRevealFrame>({
    rawContent: '',
    displayedContent: '',
    appendedGraphemes: 0,
    revision: 0,
    settled: true,
  });

  useEffect(() => {
    rawRef.current = String(rawContent || '');
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled) {
      displayedRef.current = '';
      queueStartedAtRef.current = 0;
      lastCommitAtRef.current = 0;
      setFrame((current: StreamRevealFrame) => ({
        rawContent: rawRef.current,
        displayedContent: '',
        appendedGraphemes: 0,
        revision: current.revision,
        settled: !rawRef.current,
      }));
      return undefined;
    }

    if (reduceMotion) {
      displayedRef.current = rawRef.current;
      queueStartedAtRef.current = 0;
      lastCommitAtRef.current = performance.now();
      setFrame((current: StreamRevealFrame) => ({
        rawContent: rawRef.current,
        displayedContent: rawRef.current,
        appendedGraphemes: 0,
        revision: current.revision,
        settled: true,
      }));
      return undefined;
    }

    if (!rawRef.current) {
      displayedRef.current = '';
      queueStartedAtRef.current = 0;
      lastCommitAtRef.current = 0;
      setFrame((current: StreamRevealFrame) => ({
        rawContent: '',
        displayedContent: '',
        appendedGraphemes: 0,
        revision: current.revision,
        settled: true,
      }));
      return undefined;
    }

    const now = performance.now();
    if (!rawRef.current.startsWith(displayedRef.current)) {
      displayedRef.current = rawRef.current;
      queueStartedAtRef.current = 0;
      lastCommitAtRef.current = now;
      setFrame((current: StreamRevealFrame) => ({
        rawContent: rawRef.current,
        displayedContent: rawRef.current,
        appendedGraphemes: 0,
        revision: current.revision,
        settled: true,
      }));
      return undefined;
    }
    if (rawRef.current !== displayedRef.current && queueStartedAtRef.current === 0) queueStartedAtRef.current = now;
    setFrame((current: StreamRevealFrame) => ({
      ...current,
      rawContent: rawRef.current,
      appendedGraphemes: 0,
      settled: rawRef.current === displayedRef.current,
    }));

    const schedule = (delay: number) => {
      timerRef.current = window.setTimeout(tick, delay);
    };
    const tick = () => {
      timerRef.current = null;
      const tickNow = performance.now();
      const queuedAt = queueStartedAtRef.current || tickNow;
      const force = tickNow - queuedAt >= STREAM_REVEAL_MAX_LAG_MS;
      const next = streamRevealTransition({
        displayedContent: displayedRef.current,
        rawContent: rawRef.current,
        queueStartedAt: queuedAt,
        lastCommitAt: lastCommitAtRef.current,
        now: tickNow,
        force,
      });
      if (next.kind === 'append' || next.kind === 'reset') {
        displayedRef.current = next.displayedContent;
        lastCommitAtRef.current = tickNow;
        if (next.appendedGraphemes > 0) revisionRef.current += 1;
        if (next.settled) queueStartedAtRef.current = 0;
        setFrame({
          rawContent: rawRef.current,
          displayedContent: next.displayedContent,
          appendedGraphemes: next.appendedGraphemes,
          revision: revisionRef.current,
          settled: next.settled,
        });
      }
      if (displayedRef.current !== rawRef.current) schedule(Math.min(12, STREAM_REVEAL_MIN_COMMIT_MS));
      else setFrame((current: StreamRevealFrame) => current.settled && current.rawContent === rawRef.current
        ? current
        : { ...current, rawContent: rawRef.current, appendedGraphemes: 0, settled: true });
    };

    schedule(0);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, rawContent, reduceMotion]);

  return frame;
}

export function useReplyPresenceHandoff(hasVisibleDraft: boolean, reduceMotion: boolean) {
  const seenVisibleDraftRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const [exiting, setExiting] = useState(false);

  useLayoutEffect(() => {
    if (!hasVisibleDraft) {
      seenVisibleDraftRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setExiting(false);
      return undefined;
    }
    if (seenVisibleDraftRef.current) return undefined;
    seenVisibleDraftRef.current = true;
    if (reduceMotion) return undefined;
    setExiting(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setExiting(false);
    }, STREAM_REVEAL_ANIMATION_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [hasVisibleDraft, reduceMotion]);

  return exiting;
}

export const activityKindCopy: Record<RunActivityItem['kind'], { running: string; completed: string; unit: string }> = {
  read: { running: '正在读取', completed: '读取了', unit: '个文件' },
  search: { running: '正在搜索', completed: '搜索了', unit: '次' },
  edit: { running: '正在编辑', completed: '编辑了', unit: '个文件' },
  write: { running: '正在写入', completed: '写入了', unit: '个文件' },
  command: { running: '正在运行', completed: '运行了', unit: '条命令' },
  web: { running: '正在访问网络', completed: '访问了网络', unit: '次' },
  skill: { running: '正在使用技能', completed: '使用了技能', unit: '次' },
  collaboration: { running: '正在更新协作任务', completed: '更新了协作任务', unit: '次' },
  other: { running: '正在执行操作', completed: '执行了操作', unit: '次' },
};

export function activityGroupSummary(group: RunActivityGroup) {
  const counts = new Map<RunActivityItem['kind'], number>();
  group.items.forEach((item) => counts.set(item.kind, (counts.get(item.kind) || 0) + 1));
  const running = group.status === 'running';
  return [...counts.entries()].map(([kind, count]) => {
    const copy = activityKindCopy[kind] || activityKindCopy.other;
    return `${running ? copy.running : copy.completed} ${count} ${copy.unit}`;
  }).join(' · ') || group.summary;
}

export function semanticActivityPreview(group: RunActivityGroup) {
  const running = [...group.items].reverse().find((item) => item.status === 'running');
  const latest = group.items.at(-1);
  return String(
    latest?.intent
    || running?.intent
    || latest?.displayName
    || activityGroupPreview(group)
    || activityGroupSummary(group),
  ).replace(/\s+/g, ' ').trim();
}

export function compactActivityTarget(item: RunActivityItem) {
  const source = String(item.target || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  let target = source;
  if (item.kind === 'web') {
    try {
      const url = new URL(source);
      target = `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      target = source;
    }
  }
  const limit = item.kind === 'command' ? 76 : 62;
  return target.length > limit ? `${target.slice(0, limit).trimEnd()}…` : target;
}

export function RunActivityStatusIcon({ item }: { item: RunActivityItem }) {
  const reduceMotion = useReducedMotion();
  const icon = item.status === 'running' ? <LoaderCircle size={12} /> : item.status === 'failed' ? <X size={12} /> : item.status === 'cancelled' ? <PauseCircle size={12} /> : <CheckCircle2 size={12} />;
  return (
    <span className="run-activity-item-status" aria-label={item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '已取消' : item.status === 'running' ? '进行中' : '完成'}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={item.status}
          initial={reduceMotion ? false : { opacity: 0, scale: .8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: .8 }}
          transition={{ duration: reduceMotion ? 0 : .2 }}
        >{icon}</motion.span>
      </AnimatePresence>
    </span>
  );
}

export function RunActivityItemRow({ item, rowIndex }: { item: RunActivityItem; rowIndex: number }) {
  const [resultOpen, setResultOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const label = item.displayName || (item.status === 'running' ? item.activeLabel : item.completedLabel);
  const duration = formatActivityDuration(activityElapsedMs(item));
  return (
    <motion.div
      className={`run-activity-item is-${item.status}`}
      initial={reduceMotion ? false : { x: -8, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : .15, delay: reduceMotion ? 0 : Math.min(rowIndex, 9) * .03 }}
    >
      <RunActivityStatusIcon item={item} />
      <span className="run-activity-item-copy">
        <span className="run-activity-action">{label}</span>
        {item.intent && <span className="run-activity-intent">{item.intent}</span>}
        {item.target && <span className="run-activity-target" title={item.target}>{compactActivityTarget(item)}</span>}
      </span>
      {duration && <time>{duration}</time>}
      {item.resultPreview && (
        <>
          <button className="run-activity-result-toggle" type="button" aria-label="查看结果摘要" title="查看结果摘要" aria-expanded={resultOpen} onClick={() => setResultOpen((current) => !current)}><ArrowUpRight size={13} /></button>
          {resultOpen && <div className="run-activity-result"><pre>{item.resultPreview}</pre></div>}
        </>
      )}
    </motion.div>
  );
}

export function RunActivityGroupView({ group, hasFollowingText, runFinished, isCurrentGroup, showAwaiting }: { group: RunActivityGroup; hasFollowingText: boolean; runFinished: boolean; isCurrentGroup: boolean; showAwaiting: boolean }) {
  const live = isCurrentGroup && !hasFollowingText && !runFinished;
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const regionId = useId();
  const entries = activityTimelineEntries(group);
  const failedCount = group.items.filter((item) => item.status === 'failed').length;
  const awaitingNextStep = live && showAwaiting && !group.items.some((item) => item.status === 'running');
  const preview = semanticActivityPreview(group);
  return (
    <section className={`run-activity-group is-${group.status} ${live ? 'is-live' : ''}`} aria-busy={live && group.status === 'running'}>
      <button
        className="run-activity-summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((current) => nextActivityExpanded(current, 'user.toggle'))}
      >
        <motion.span className="run-activity-chevron" animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: reduceMotion ? 0 : .15, ease: 'easeOut' }}><ChevronRight size={13} /></motion.span>
        <span className="run-activity-count">{entries.length}</span>
        <span className="run-activity-preview-frame" aria-live={live ? 'polite' : undefined}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span className="run-activity-preview" key={preview} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .2 }}>{preview}</motion.span>
          </AnimatePresence>
        </span>
        {failedCount > 0 && <span className="run-activity-failures">{failedCount} 失败</span>}
      </button>
      <AnimatePresence initial={false}>
        {expanded && <motion.div
          className="run-activity-collapse"
          id={regionId}
          role="region"
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: reduceMotion ? 0 : .25, ease: [.4, 0, .2, 1] }, opacity: { duration: reduceMotion ? 0 : .15 } }}
        >
          <div className="run-activity-collapse-inner">
            <div className="run-activity-items">
              {entries.map((entry, index) => <RunActivityItemRow item={entry.item} rowIndex={index} key={entry.id} />)}
              {awaitingNextStep && (
                <div className="run-activity-awaiting" role="status">
                  <LoaderCircle size={13} aria-hidden="true" />
                  <span>正在整理结果…</span>
                </div>
              )}
            </div>
          </div>
        </motion.div>}
      </AnimatePresence>
    </section>
  );
}

export function RunTranscriptContent({ content, groups, streaming = false, streamReveal, runFinished = true, showAwaiting = false, threadId, workspaceId }: { content: string; groups: RunActivityGroup[]; streaming?: boolean; streamReveal?: StreamRevealFrame; runFinished?: boolean; showAwaiting?: boolean; threadId?: string | null; workspaceId?: string | null }) {
  const visibleGroups = streaming
    ? groups.filter((group) => Number(group.contentOffset || 0) <= content.length)
    : groups;
  const timeline = buildRunActivityTimeline(content, visibleGroups);
  const nodes: React.ReactNode[] = [];
  timeline.groups.forEach(({ group, commentary, hasFollowingText }, index) => {
    if (commentary) nodes.push(<MarkdownMessage content={commentary} threadId={threadId} workspaceId={workspaceId} key={`text-${group.id || index}`} />);
    nodes.push(<RunActivityGroupView group={group} hasFollowingText={hasFollowingText} runFinished={runFinished} isCurrentGroup={index === timeline.groups.length - 1} showAwaiting={showAwaiting} key={group.id || `group-${index}`} />);
  });
  const tail = timeline.tail;
  if (tail || streaming) nodes.push(<MarkdownMessage content={tail} streaming={streaming} streamReveal={streamReveal} threadId={threadId} workspaceId={workspaceId} key="text-tail" />);
  return <>{nodes}</>;
}

export function PersistedInterruptedRuns({ thread, agents }: { thread: Thread | null; agents: Agent[] }) {
  const messageRunIds = new Set((thread?.messages || []).map((message) => message.externalRunId).filter(Boolean));
  const transcripts = (thread?.runTranscripts || []).filter((item) => ['failed', 'cancelled'].includes(item.status) && !messageRunIds.has(item.runId) && item.groups.length);
  return <>{transcripts.slice(-3).map((transcript) => {
    const agent = agents.find((item) => item.id === transcript.agentId);
    return (
      <article className="message run-status-message interrupted-run-message" key={transcript.runId}>
        {agent ? <AgentAvatar agent={agent} /> : <span className="agent-avatar" style={{ background: '#0f766e' }}>@</span>}
        <div className="message-body run-status-body">
          <div className="message-meta"><strong>{agent?.name || 'Agent'}</strong><span>{transcript.status === 'failed' ? '执行失败' : '已取消'}</span></div>
          <RunTranscriptContent content={transcript.partialContent || ''} groups={transcript.groups} threadId={thread?.id} workspaceId={thread?.workspaceId} />
        </div>
      </article>
    );
  })}</>;
}

export function ComposerRunButton({
  isRunning,
  hasActiveRun,
  isStopping,
  canSend,
  onSend,
  onStop,
  runningLabel,
}: {
  isRunning: boolean;
  hasActiveRun: boolean;
  isStopping: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  runningLabel?: string;
}) {
  const phase = isRunning
    ? isStopping ? 'stopping' : hasActiveRun ? 'running' : 'starting'
    : 'idle';
  const label = phase === 'starting'
    ? '正在启动'
    : phase === 'running'
      ? runningLabel || '停止生成'
      : phase === 'stopping'
        ? '正在停止'
        : '发送消息';
  const disabled = phase === 'starting' || phase === 'stopping' || (phase === 'idle' && !canSend);
  return (
    <button
      className={`composer-run-button is-${phase}`}
      type="button"
      aria-label={label}
      aria-busy={phase === 'starting' || phase === 'stopping'}
      title={label}
      disabled={disabled}
      onClick={phase === 'running' ? onStop : onSend}
    >
      {phase === 'idle' && <ArrowUp size={18} strokeWidth={2.6} aria-hidden="true" />}
      {phase === 'running' && <Square className="composer-run-stop-icon" size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />}
      {(phase === 'starting' || phase === 'stopping') && <LoaderCircle className="composer-run-spinner" size={16} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  );
}

export function ContextCompactionRecord({ record }: { record: RunUiState['compactionRecords'][number] }) {
  if (record.status === 'running') {
    return <div className="context-compaction-record is-running" role="status" aria-live="polite"><LoaderCircle className="context-compaction-spinner" size={14} aria-hidden="true" /><span>正在压缩上下文…</span></div>;
  }
  if (record.status === 'failed') {
    return <div className="context-compaction-record is-failed" role="status"><TriangleAlert size={14} aria-hidden="true" /><span>上下文压缩失败：{record.error || '请稍后重试。'}{record.originalContextPreserved !== false && ' 原始上下文未删除。'}</span></div>;
  }
  const before = record.tokensBefore ? `${Math.round(record.tokensBefore / 1000)}K` : '—';
  const after = record.tokensAfterEstimate ? `${Math.round(record.tokensAfterEstimate / 1000)}K` : '—';
  return <div className="context-compaction-record is-completed" role="separator"><Check size={14} aria-hidden="true" /><span>已压缩上下文 · {before} → {after} tokens</span></div>;
}

export function ChatRunStatus({
  target,
  startedAt,
  tick,
  draft,
  activityGroups,
  presentationPhase,
  error,
  errorCode,
  onMigrateToNative,
  streamingResponses,
  threadId,
  workspaceId,
}: {
  target: ChatRunTarget | null;
  startedAt: number | null;
  tick: number;
  draft: string;
  activityGroups: RunActivityGroup[];
  presentationPhase: RunPresentationPhase;
  error: string;
  errorCode?: string;
  onMigrateToNative?: () => void;
  streamingResponses: boolean;
  threadId?: string | null;
  workspaceId?: string | null;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const revealFrame = useStreamRevealFrame(draft, streamingResponses, reduceMotion);
  const visibleDraft = streamingResponses ? revealFrame.displayedContent : '';
  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const agent = target?.agent || null;
  const isAll = target?.kind === 'all';
  const title = isAll ? '团队' : agent?.name || 'Agent';
  const processingText = processingMessageAt(startedAt, elapsed, title);
  const streamingDraft = streamingResponses && Boolean(draft);
  const hasVisibleDraft = Boolean(visibleDraft);
  const waitingForFirstVisibleDraft = streamingResponses
    && Boolean(draft)
    && !hasVisibleDraft
    && (presentationPhase === 'responding' || presentationPhase === 'finished');
  const showPresence = shouldShowRunPresence(presentationPhase) || (!streamingResponses && presentationPhase === 'responding') || waitingForFirstVisibleDraft;
  const exitingInitialPresence = useReplyPresenceHandoff(hasVisibleDraft, reduceMotion);
  const useInitialReplySlot = activityGroups.length === 0 && (showPresence || hasVisibleDraft || exitingInitialPresence);
  const canMigrateToNative = Boolean(onMigrateToNative && ['RUNTIME_NOT_INSTALLED', 'RUNTIME_BUILD_UNAVAILABLE', 'runtime_unavailable'].includes(String(errorCode || '')));
  const draftTranscript = hasVisibleDraft
    ? <RunTranscriptContent content={visibleDraft} groups={activityGroups} streaming={streamingDraft} streamReveal={reduceMotion ? undefined : revealFrame} runFinished={false} showAwaiting={presentationPhase === 'activity'} threadId={threadId} workspaceId={workspaceId} />
    : null;
  const presence = showPresence || exitingInitialPresence ? (
    <div className={`processing-presence ${hasVisibleDraft || activityGroups.length ? 'after-activity' : ''} ${exitingInitialPresence ? 'is-exiting' : ''}`} data-testid="run-presence" aria-live="polite" aria-atomic="true">
      <LoaderCircle className="processing-presence-spinner" size={13} aria-hidden="true" />
      <span className="processing-presence-message" key={processingText}>{processingText}</span>
      {elapsed >= 1 && <time>{formatRunElapsed(elapsed)}</time>}
    </div>
  ) : null;
  void tick;
  return (
    <article className="message run-status-message incoming-agent-message" aria-busy={presentationPhase !== 'waiting-input' && presentationPhase !== 'finished'}>
      {isAll || !agent ? <span className="agent-avatar" style={{ background: agent?.color || '#0f766e' }}>@</span> : <AgentAvatar agent={agent} />}
      <div className="message-body run-status-body">
        <div className="message-meta">
          <strong>{title}</strong>
        </div>
        {useInitialReplySlot ? (
          <div className={`run-reply-transition-slot ${hasVisibleDraft ? 'has-visible-draft' : ''}`} data-testid="run-reply-transition-slot">
            {draftTranscript}
            {presence}
          </div>
        ) : (
          <>
            {draftTranscript || (activityGroups.length > 0 && <div className="run-activity-before-text"><RunTranscriptContent content="" groups={activityGroups} runFinished={false} showAwaiting={presentationPhase === 'activity'} threadId={threadId} workspaceId={workspaceId} /></div>)}
            {presence}
          </>
        )}
        {error && <div className="inline-error run-error">{error}{canMigrateToNative && <button type="button" onClick={onMigrateToNative}>改用 Frakio Native</button>}</div>}
      </div>
    </article>
  );
}

export function RunDecisionPanel({ clarification, approval, submitting, error, onAnswer, onSkip, onInterrupt, onApprove }: {
  clarification: HermesRunClarification | null;
  approval: HermesRunApproval | null;
  submitting: boolean;
  error: string;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  onInterrupt: () => void;
  onApprove: (choice: HermesApprovalChoice) => void;
}) {
  const isClarification = Boolean(clarification);
  const requestKey = clarification?.id || approval?.id || 'decision';
  const [activeIndex, setActiveIndex] = useState(0);
  const [customOpen, setCustomOpen] = useState(Boolean(clarification && !clarification.choices.length));
  const [customAnswer, setCustomAnswer] = useState('');
  const panelRef = useRef<HTMLElement | null>(null);
  const allApprovalChoices = [
    { value: 'once' as const, label: '允许一次', description: '只允许当前这一次操作' },
    { value: 'session' as const, label: '本会话允许', description: '当前对话中允许同类操作' },
    { value: 'always' as const, label: '始终允许', description: '以后自动允许同类操作' },
    { value: 'deny' as const, label: '拒绝', description: '不执行这项操作' },
  ];
  const requestedApprovalChoices = approval?.smartDenied
    ? ['once', 'deny']
    : (approval?.choices?.length ? approval.choices : allApprovalChoices.map((choice) => choice.value));
  const approvalChoices = allApprovalChoices.filter((choice) => (
    requestedApprovalChoices.includes(choice.value)
    && (choice.value !== 'always' || approval?.allowPermanent !== false)
  ));
  const optionCount = clarification?.choices.length || approvalChoices.length;

  useEffect(() => {
    setActiveIndex(0);
    setCustomOpen(Boolean(clarification && !clarification.choices.length));
    setCustomAnswer('');
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('.decision-option-row, .decision-other-trigger')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestKey, clarification]);

  const chooseActive = (index: number) => {
    if (submitting || index < 0 || index >= optionCount) return;
    setActiveIndex(index);
    if (clarification) onAnswer(clarification.choices[index]);
    else onApprove(approvalChoices[index].value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (clarification && !submitting) onInterrupt();
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < optionCount) {
        event.preventDefault();
        chooseActive(index);
      }
      return;
    }
    if (!optionCount) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (activeIndex + direction + optionCount) % optionCount;
      setActiveIndex(nextIndex);
      panelRef.current?.querySelectorAll<HTMLButtonElement>('.decision-option-row')[nextIndex]?.focus();
      return;
    }
  };

  return (
    <DecisionTray
      className={`run-decision-panel ${isClarification ? 'clarification' : 'approval'}`}
      trayRef={panelRef}
      label={clarification ? undefined : '权限选项'}
      title={clarification?.question}
      titleId={clarification ? `run-decision-${requestKey}` : undefined}
      optionsLabel={clarification ? '回答选项' : '权限选项'}
      onKeyDown={onKeyDown}
      error={error}
      actions={clarification ? (
        <button type="button" className="decision-close" onClick={onInterrupt} disabled={submitting} aria-label="中断当前提问"><X size={15} /></button>
      ) : undefined}
      footer={clarification ? <button type="button" className="decision-skip" onClick={onSkip} disabled={submitting}>{submitting ? '提交中…' : '跳过'}</button> : undefined}
    >
      {clarification ? clarification.choices.map((choice, index) => (
        <DecisionOptionRow
          key={`${index}-${choice}`}
          number={index + 1}
          label={choice}
          active={activeIndex === index}
          disabled={submitting}
          onClick={() => chooseActive(index)}
          onFocus={() => setActiveIndex(index)}
        />
      )) : approvalChoices.map((choice, index) => (
        <DecisionOptionRow
          key={choice.value}
          number={index + 1}
          label={choice.label}
          description={choice.description}
          active={activeIndex === index}
          danger={choice.value === 'deny'}
          disabled={submitting}
          onClick={() => chooseActive(index)}
          onFocus={() => setActiveIndex(index)}
        />
      ))}
      {clarification && (
        <DecisionOtherRow
          open={customOpen}
          value={customAnswer}
          disabled={submitting}
          placeholder="输入自己的回答"
          onOpen={() => setCustomOpen(true)}
          onChange={setCustomAnswer}
          onSubmit={() => {
            const answer = customAnswer.trim();
            if (answer) onAnswer(answer);
          }}
          onClose={() => setCustomOpen(false)}
        />
      )}
    </DecisionTray>
  );
}
// wjz新建文件结束。
