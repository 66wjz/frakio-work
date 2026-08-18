// wjz新建文件，新建原因：解耦协作与决策面板（PlanCard, DecisionTray, PlanQuestionPanel, PermissionModeControl 等），修改时间：2026-08-17。
// 文件内容概述：计划卡片展示与反馈、决策问答盘托盘、执行权限与协作模式控制。
import React, { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  File,
  FileText,
  Hand,
  Image,
  Lightbulb,
  LoaderCircle,
  Network,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import {
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
} from '../../overlay-primitives';
import { AgentAvatar } from '../common/AgentAvatar';
import type {
  PlanDraft,
  PlanOption,
  PlanQuestion,
  PlanQuestionBatch,
  PlanSession,
  PlanStep,
} from '@frakio/contracts';

import type {
  Agent,
  HermesRunApproval,
  HermesRunClarification,
  PermissionMode,
  Thread,
  WorkflowStep,
} from '../../types/workbench';


export function permissionLabel(mode: string) {
  if (mode === 'manual') return '请求批准';
  if (mode === 'smart') return '替我审批';
  return '完全访问';
}

export function permissionDescription(mode: string) {
  if (mode === 'manual') return '编辑外部文件、执行命令和使用联网能力前先询问';
  if (mode === 'smart') return '仅对检测到的风险操作请求批准';
  return '跳过普通审批，硬性安全阻止和拒绝规则仍然生效';
}

export function permissionTone(mode: string) {
  if (mode === 'manual') return 'manual';
  if (mode === 'smart') return 'smart';
  return 'full';
}

export function permissionIcon(mode: string) {
  if (mode === 'manual') return Hand;
  if (mode === 'smart') return ShieldCheck;
  return ShieldAlert;
}

export function iconForFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return FileText;
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.py') ||
    lower.endsWith('.css') ||
    lower.endsWith('.html') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml')
  )
    return Code2;
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif')
  )
    return Image;
  return File;
}

export const defaultCouncilWorkflowTitles = [
  'Iris 接收需求',
  'Max 拆解任务',
  '相关 Agent 协作',
  '生成待确认动作',
];

export function isLegacyDefaultWorkflow(steps: WorkflowStep[]) {
  if (steps.length !== defaultCouncilWorkflowTitles.length) return false;
  return steps.every(
    (step, index) =>
      step.title === defaultCouncilWorkflowTitles[index] &&
      !step.source &&
      !step.detail &&
      !step.agentName,
  );
}

export function visibleWorkflowSteps(
  thread: Thread | null,
  live: {
    isRunning: boolean;
    runApproval: HermesRunApproval | null;
    runClarification: HermesRunClarification | null;
    runError: string;
    runDraft: string;
  },
): WorkflowStep[] {
  const liveSteps: WorkflowStep[] = [];
  if (live.isRunning)
    liveSteps.push({
      title: 'Agent 正在执行',
      status: 'running',
      source: 'run',
      detail: live.runDraft ? '正在思考' : '',
    });
  if (live.runApproval)
    liveSteps.push({
      title: live.runApproval.title || '等待确认',
      status: 'running',
      source: 'approval',
      detail: live.runApproval.command || live.runApproval.tool || '',
    });
  if (live.runClarification)
    liveSteps.push({
      title: '等待你的选择',
      status: 'running',
      source: 'clarify',
      detail: live.runClarification.question,
      callId: live.runClarification.id,
    });
  if (live.runError) liveSteps.push({ title: live.runError, status: 'failed', source: 'run' });
  if (liveSteps.length) return liveSteps;

  const steps = (Array.isArray(thread?.workflowState) ? thread.workflowState : []).filter(
    (step) => step.source !== 'tool',
  );
  if (!steps.length || isLegacyDefaultWorkflow(steps)) return [];
  const hasRealSignal = steps.some((step) => step.source || step.detail || step.agentName);
  if (!hasRealSignal && thread?.runStatus !== 'running') return [];
  return steps.map((step) =>
    thread?.runStatus !== 'running' && step.status === 'running'
      ? { ...step, status: 'completed' }
      : step,
  );
}

export function PermissionModeControl({
  value,
  compact = false,
  onChange,
}: {
  value: PermissionMode;
  compact?: boolean;
  onChange: (mode: PermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const CurrentIcon = permissionIcon(value);

  return (
    <AppMenu open={open} onOpenChange={setOpen} modal={false}>
      <div className="permission-menu-wrap">
        <AppMenuTrigger asChild>
          <button
            className={`permission-select ${permissionTone(value)}`}
            type="button"
            title={permissionDescription(value)}
            aria-label="操作权限"
            aria-controls={open ? menuId : undefined}
          >
            <CurrentIcon size={15} />
            {!compact && <span>{permissionLabel(value)}</span>}
            {!compact && <ChevronDown size={13} />}
          </button>
        </AppMenuTrigger>
        <AppMenuContent
          id={menuId}
          className="permission-menu-v2"
          side="top"
          align="start"
          aria-label="操作权限选项"
        >
          <div className="permission-menu-head">
            <strong>应如何批准 Hermes 操作？</strong>
            <a href="#settings" onClick={(event) => event.preventDefault()}>
              了解更多
            </a>
          </div>
          {(['manual', 'smart', 'off'] as const).map((mode) => {
            const Icon = permissionIcon(mode);
            const selected = mode === value;
            return (
              <AppMenuItem
                className={`${selected ? 'selected ' : ''}permission-menu-option permission-${mode}`}
                key={mode}
                role="menuitemradio"
                aria-checked={selected}
                onSelect={() => onChange(mode)}
              >
                <Icon size={20} />
                <span>
                  <strong>{permissionLabel(mode)}</strong>
                  <small>{permissionDescription(mode)}</small>
                </span>
                {selected && <CheckCircle2 size={18} />}
              </AppMenuItem>
            );
          })}
        </AppMenuContent>
      </div>
    </AppMenu>
  );
}

export function CollaborationIntentControl({
  active,
  disabled = false,
  adjusting = false,
  onChange,
}: {
  active: boolean;
  disabled?: boolean;
  adjusting?: boolean;
  onChange: (active: boolean) => void;
}) {
  const label = adjusting ? '调整协作' : '协作';
  return (
    <button
      type="button"
      className={`composer-collaboration-toggle${active ? ' active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!active)}
    >
      <UsersRound size={15} />
      <span>协作</span>
    </button>
  );
}

export function CollaborationIntentIndicator({ adjusting = false }: { adjusting?: boolean }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className="work-mode-hint collaboration-mode-hint"
      initial={{ height: 0, marginBottom: 0, opacity: 0, y: -4 }}
      animate={{ height: 19, marginBottom: 7, opacity: 1, y: 0 }}
      exit={{ height: 0, marginBottom: 0, opacity: 0, y: -4 }}
      transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
    >
      <UsersRound size={13} />
      <span>{adjusting ? '调整协作模式' : '启用协作模式'}</span>
    </motion.div>
  );
}

export function ComposerAddMenu({
  planEnabled,
  planBusy,
  onAddFile,
  onEnablePlan,
}: {
  planEnabled: boolean;
  planBusy?: boolean;
  onAddFile: () => void;
  onEnablePlan: () => void;
}) {
  return (
    <AppMenu modal={false}>
      <AppMenuTrigger asChild>
        <button
          className="icon-btn composer-tool upload"
          type="button"
          aria-label="添加内容"
          title="添加内容"
        >
          <Plus size={19} />
        </button>
      </AppMenuTrigger>
      <AppMenuContent className="composer-add-menu" side="top" align="start" aria-label="添加到对话">
        <AppMenuItem className="composer-add-option" onSelect={onAddFile}>
          <FileText size={14} />
          <span>添加文件</span>
        </AppMenuItem>
        <AppMenuItem
          className={planEnabled ? 'composer-add-option selected' : 'composer-add-option'}
          disabled={planEnabled || planBusy}
          onSelect={onEnablePlan}
        >
          <Lightbulb size={14} />
          <span>{planEnabled ? '计划模式已开启' : '计划模式'}</span>
          {planEnabled && <Check size={14} />}
        </AppMenuItem>
      </AppMenuContent>
    </AppMenu>
  );
}

export function PlanModeIndicator({ busy, onClose }: { busy?: boolean; onClose: () => void }) {
  return (
    <span className="plan-mode-indicator">
      <Lightbulb size={14} aria-hidden="true" />
      <span>计划</span>
      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        aria-label="关闭计划模式"
        title="关闭计划模式"
      >
        {busy ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}
      </button>
    </span>
  );
}

export function DecisionTray({
  className = '',
  label,
  title,
  titleId,
  actions,
  optionsLabel,
  children,
  footer,
  error,
  onKeyDown,
  trayRef,
}: {
  className?: string;
  label?: string;
  title?: React.ReactNode;
  titleId?: string;
  actions?: React.ReactNode;
  optionsLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  error?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  trayRef?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <section
      className={`decision-tray ${className}`.trim()}
      ref={trayRef}
      onKeyDown={onKeyDown}
      aria-label={title ? undefined : label}
      aria-labelledby={title ? titleId : undefined}
    >
      {title && (
        <header className="decision-tray-head">
          <strong id={titleId}>{title}</strong>
          {actions}
        </header>
      )}
      <div className="decision-option-list" role="group" aria-label={optionsLabel}>
        {children}
      </div>
      {(footer || error) && (
        <footer className="decision-tray-footer">
          {error ? (
            <span className="decision-tray-error" role="alert">
              {error}
            </span>
          ) : (
            <span />
          )}
          {footer}
        </footer>
      )}
    </section>
  );
}

export function DecisionPager({
  index,
  count,
  disabled,
  onPrevious,
  onNext,
  onClose,
}: {
  index: number;
  count: number;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className="decision-pager" aria-label="问题导航">
      <button
        type="button"
        disabled={disabled || index <= 0}
        onClick={onPrevious}
        aria-label="上一题"
      >
        <ChevronLeft size={15} />
      </button>
      <span>
        {index + 1} / {count}
      </span>
      <button
        type="button"
        disabled={disabled || index >= count - 1}
        onClick={onNext}
        aria-label="下一题"
      >
        <ChevronRight size={15} />
      </button>
      <button type="button" disabled={disabled} onClick={onClose} aria-label="关闭当前问题">
        <X size={15} />
      </button>
    </div>
  );
}

export function DecisionOptionRow({
  number,
  label,
  description,
  recommended,
  active,
  selected,
  danger,
  disabled,
  role,
  onClick,
  onFocus,
}: {
  number: number;
  label: string;
  description?: string;
  recommended?: boolean;
  active?: boolean;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  role?: 'radio';
  onClick: () => void;
  onFocus?: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'radio' ? Boolean(selected) : undefined}
      className={`decision-option-row${active ? ' active' : ''}${selected ? ' selected' : ''}${
        danger ? ' danger' : ''
      }`}
      disabled={disabled}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onFocus={onFocus}
    >
      <span className="decision-option-number">{number}</span>
      <span className="decision-option-copy">
        <strong>{label}</strong>
        {recommended && <em>推荐</em>}
        {description && <small>{description}</small>}
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

export function DecisionOtherRow({
  open,
  value,
  disabled,
  placeholder,
  onOpen,
  onChange,
  onSubmit,
  onClose,
}: {
  open: boolean;
  value: string;
  disabled?: boolean;
  placeholder: string;
  onOpen: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  if (!open) {
    return (
      <button type="button" className="decision-other-trigger" disabled={disabled} onClick={onOpen}>
        <span className="decision-other-icon">
          <Pencil size={14} />
        </span>
        <span>其他</span>
      </button>
    );
  }
  return (
    <div className="decision-other-input">
      <span className="decision-other-icon">
        <Pencil size={14} />
      </span>
      <input
        autoFocus
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Enter' && value.trim()) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button
        type="button"
        disabled={disabled || !value.trim()}
        onClick={onSubmit}
        aria-label="提交其他回答"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function PlanQuestionPanel({
  batch,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  batch: PlanQuestionBatch;
  submitting: boolean;
  error?: string;
  onSubmit: (answers: Record<string, { selectedLabel?: string; note?: string }>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { selectedLabel?: string; note?: string }>>(
    batch.answers || {},
  );
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({});
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const trayRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setIndex(0);
    setAnswers(batch.answers || {});
    setOtherOpen(false);
    setOtherDrafts({});
    setActiveOptionIndex(0);
  }, [batch.id]);
  const question = batch.questions[index];
  if (!question) return null;
  const answer = answers[question.id] || {};
  const otherDraft = otherDrafts[question.id] || answer.note || '';

  useEffect(() => {
    const selectedIndex = Math.max(
      0,
      question.options.findIndex((option: PlanOption) => option.label === answer.selectedLabel),
    );
    setActiveOptionIndex(selectedIndex);
    setOtherOpen(Boolean(answer.note && !answer.selectedLabel));
    const frame = window.requestAnimationFrame(() => {
      trayRef.current
        ?.querySelectorAll<HTMLButtonElement>('.decision-option-row')
        [selectedIndex]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [index, question.id, answer.selectedLabel, answer.note]);

  const commitAndAdvance = (nextAnswer: { selectedLabel?: string; note?: string }) => {
    if (submitting) return;
    const nextAnswers = { ...answers, [question.id]: nextAnswer };
    setAnswers(nextAnswers);
    setOtherOpen(false);
    if (index < batch.questions.length - 1) {
      setIndex(index + 1);
      return;
    }
    const firstUnanswered = batch.questions.findIndex((item: PlanQuestion) => {
      const itemAnswer = nextAnswers[item.id];
      return !itemAnswer?.selectedLabel && !itemAnswer?.note?.trim();
    });
    if (firstUnanswered >= 0) {
      setIndex(firstUnanswered);
      return;
    }
    onSubmit(nextAnswers);
  };

  const chooseOption = (optionIndex: number) => {
    const option = question.options[optionIndex];
    if (!option) return;
    setActiveOptionIndex(optionIndex);
    commitAndAdvance({ selectedLabel: option.label });
  };

  const skip = () => {
    const option = question.options.find((item: PlanOption) => item.recommended) || question.options[0];
    if (option) commitAndAdvance({ selectedLabel: option.label });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const optionIndex = Number(event.key) - 1;
      if (optionIndex < question.options.length) {
        event.preventDefault();
        chooseOption(optionIndex);
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      setIndex(index - 1);
      return;
    }
    if (event.key === 'ArrowRight' && index < batch.questions.length - 1) {
      event.preventDefault();
      setIndex(index + 1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        (activeOptionIndex + direction + question.options.length) % question.options.length;
      setActiveOptionIndex(nextIndex);
      trayRef.current
        ?.querySelectorAll<HTMLButtonElement>('.decision-option-row')
        [nextIndex]?.focus();
    }
  };

  return (
    <DecisionTray
      className="plan-question-panel"
      trayRef={trayRef}
      title={question.question}
      titleId={`plan-question-${batch.id}-${question.id}`}
      optionsLabel={question.header || question.question}
      onKeyDown={onKeyDown}
      error={error}
      actions={
        <DecisionPager
          index={index}
          count={batch.questions.length}
          disabled={submitting}
          onPrevious={() => setIndex((current) => Math.max(0, current - 1))}
          onNext={() => setIndex((current) => Math.min(batch.questions.length - 1, current + 1))}
          onClose={onCancel}
        />
      }
      footer={
        <button
          type="button"
          className="decision-skip"
          disabled={submitting}
          onClick={skip}
        >
          {submitting ? '提交中…' : '跳过'}
        </button>
      }
    >
      {question.options.map((option: PlanOption, optionIndex: number) => (
        <DecisionOptionRow
          key={option.label}
          number={optionIndex + 1}
          label={option.label}
          description={option.description}
          recommended={option.recommended}
          active={activeOptionIndex === optionIndex}
          selected={answer.selectedLabel === option.label}
          disabled={submitting}
          role="radio"
          onClick={() => chooseOption(optionIndex)}
          onFocus={() => setActiveOptionIndex(optionIndex)}
        />
      ))}
      <DecisionOtherRow
        open={otherOpen}
        value={otherDraft}
        disabled={submitting}
        placeholder="输入其他回答"
        onOpen={() => setOtherOpen(true)}
        onChange={(value) => setOtherDrafts((current) => ({ ...current, [question.id]: value }))}
        onSubmit={() => {
          const note = otherDraft.trim();
          if (note) commitAndAdvance({ note });
        }}
        onClose={() => setOtherOpen(false)}
      />
    </DecisionTray>
  );
}

export function CollaborationSuggestionCard({
  suggestion,
  busy,
  disabled,
  onStart,
}: {
  suggestion: { title: string; reason: string };
  busy: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <section className="collaboration-suggestion-card">
      <span className="collaboration-suggestion-icon">
        <Network size={16} />
      </span>
      <div>
        <strong>{suggestion.title}</strong>
        <p>{suggestion.reason}</p>
      </div>
      <button
        type="button"
        className="secondary-btn"
        disabled={busy || disabled}
        onClick={onStart}
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : <Network size={14} />}发起协作
      </button>
    </section>
  );
}

export function PlanCard({
  plan,
  draft,
  agents,
  latest,
  readOnly = false,
  busy,
  feedbackOpen,
  feedback,
  error,
  onFeedbackChange,
  onOpenFeedback,
  onCloseFeedback,
  onSubmitFeedback,
  onExecute,
  onCancel,
}: {
  plan: PlanSession;
  draft: PlanDraft;
  agents: Agent[];
  latest: boolean;
  readOnly?: boolean;
  busy: boolean;
  feedbackOpen: boolean;
  feedback: string;
  error?: string;
  onFeedbackChange: (value: string) => void;
  onOpenFeedback: () => void;
  onCloseFeedback: () => void;
  onSubmitFeedback: () => void;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const collaborationPlan =
    plan.purpose === 'collaboration' ||
    plan.targetExecutionMode === 'collaboration' ||
    plan.targetExecutionMode === 'work';
  const waitingApproval = !readOnly && latest && plan.status === 'waiting_approval';
  const canExecute =
    !readOnly && latest && (plan.status === 'waiting_approval' || plan.status === 'failed');
  const visibleError = error || (plan.status === 'failed' ? plan.error : '');
  const statusLabel = readOnly
    ? '历史计划'
    : !latest
    ? '已被新版本替代'
    : ({
        waiting_approval: '等待批准',
        approved: '已批准',
        executing: '执行中',
        completed: '已完成',
        cancelled: '已取消',
        failed: '执行失败',
        drafting: '修改中',
        waiting_input: '等待回答',
      } as Record<string, string>)[plan.status] || plan.status;
  return (
    <section className={`plan-card${latest ? ' is-latest' : ' is-superseded'}`}>
      <header>
        <span className="plan-card-icon">
          {collaborationPlan ? <Network size={17} /> : <Lightbulb size={17} />}
        </span>
        <div>
          <small>
            {collaborationPlan ? '协作方案' : '执行计划'} · 第 {draft.revision} 版
          </small>
          <h3>{draft.title}</h3>
        </div>
        <span className={`plan-card-status status-${plan.status}`}>{statusLabel}</span>
      </header>
      <p className="plan-card-summary">{draft.summary}</p>
      <div className="plan-card-section">
        <strong>执行步骤</strong>
        <ol>
          {draft.steps.map((step: PlanStep) => {
            const assignee = step.assigneeAgentId
              ? agents.find((agent) => agent.id === step.assigneeAgentId)
              : null;
            return (
              <li key={step.key}>
                <div>
                  <b>{step.title}</b>
                  {assignee && (
                    <span className="plan-assignee">
                      <AgentAvatar agent={assignee} size="sm" />
                      {assignee.name}
                    </span>
                  )}
                </div>
                <p>{step.description}</p>
                {step.files.length > 0 && <small>{step.files.join(' · ')}</small>}
                {step.expectedResult && <em>结果：{step.expectedResult}</em>}
                {step.dependsOnKeys.length > 0 && <em>依赖：{step.dependsOnKeys.join('、')}</em>}
              </li>
            );
          })}
        </ol>
      </div>
      {draft.tests.length > 0 && (
        <div className="plan-card-section compact">
          <strong>验证方式</strong>
          <ul>
            {draft.tests.map((test: string) => (
              <li key={test}>{test}</li>
            ))}
          </ul>
        </div>
      )}
      {draft.assumptions.length > 0 && (
        <div className="plan-card-section compact">
          <strong>假设</strong>
          <ul>
            {draft.assumptions.map((assumption: string) => (
              <li key={assumption}>{assumption}</li>
            ))}

          </ul>
        </div>
      )}
      {feedbackOpen && waitingApproval && (
        <div className="plan-feedback">
          <textarea
            autoFocus
            value={feedback}
            onChange={(event) => onFeedbackChange(event.target.value)}
            placeholder="说明需要调整的范围、顺序或取舍"
            rows={3}
          />
          <div>
            <button
              type="button"
              className="secondary-btn"
              disabled={busy}
              onClick={onCloseFeedback}
            >
              返回
            </button>
            <button
              type="button"
              className="send-btn"
              disabled={busy || !feedback.trim()}
              onClick={onSubmitFeedback}
            >
              提交修改
            </button>
          </div>
        </div>
      )}
      {visibleError && latest && (
        <div className="plan-inline-error" role="alert">
          {visibleError}
        </div>
      )}
      {canExecute && !feedbackOpen && (
        <footer>
          <button type="button" className="plan-cancel-btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          {waitingApproval && (
            <button
              type="button"
              className="secondary-btn"
              disabled={busy}
              onClick={onOpenFeedback}
            >
              {collaborationPlan ? '调整方案' : '修改计划'}
            </button>
          )}
          <button
            type="button"
            className="send-btn plan-execute-btn"
            disabled={busy}
            onClick={onExecute}
          >
            {busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}
            {plan.status === 'failed'
              ? '重试执行'
              : collaborationPlan
              ? '开始协作'
              : '开始执行'}
          </button>
        </footer>
      )}
    </section>
  );
}
// wjz新建文件结束。
