// wjz新建文件，新建原因：解耦 main.tsx 中的侧边栏项目/对话导航交互组件（RailNavigationViews），修改时间：2026-08-17。
// 文件内容概述：RailScrollingTitle 悬停平滑滚动标题、ThreadRailContent 会话导航条目、RenameDialog 重命名模态窗、RailContextMenu 侧边栏右键菜单、RailConfirmDialog 删除确认弹窗。
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BaseIcon,
  BaseButton,
  BaseInput,
  BaseModal,
} from '../base';

const Archive = (p: any) => <BaseIcon name="archive" {...p} />;
const Copy = (p: any) => <BaseIcon name="copy" {...p} />;
const FolderOpen = (p: any) => <BaseIcon name="folder-open" {...p} />;
const MoreHorizontal = (p: any) => <BaseIcon name="more-horizontal" {...p} />;
const Pencil = (p: any) => <BaseIcon name="pencil" {...p} />;
const Pin = (p: any) => <BaseIcon name="pin" {...p} />;
const Settings = (p: any) => <BaseIcon name="settings" {...p} />;
const Trash2 = (p: any) => <BaseIcon name="trash-2" {...p} />;
const X = (p: any) => <BaseIcon name="x" {...p} />;
import {
  AppAlertDialog,
  AppAlertDialogAction,
  AppAlertDialogCancel,
  AppAlertDialogContent,
  AppAlertDialogDescription,
  AppAlertDialogTitle,
  AppDialog,
  AppDialogClose,
  AppDialogContent,
  AppDialogDescription,
  AppDialogTitle,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSeparator,
  AppMenuTrigger,
} from '../../overlay-primitives';
import type {
  Agent,
  RailConfirm,
  RailContextMenuTarget,
  RenameDialogTarget,
  Space,
  ThreadSummary,
  Workspace,
} from '../../types/workbench';

export function RailScrollingTitle({ title, className = '' }: { title: string; className?: string }) {
  const titleRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const titleElement = titleRef.current;
    const row = titleElement?.closest<HTMLElement>('[data-rail-hover-row]');
    if (!titleElement || !row) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let startTimer = 0;
    let animationFrame = 0;

    const cancelAnimation = () => {
      window.clearTimeout(startTimer);
      window.cancelAnimationFrame(animationFrame);
      startTimer = 0;
      animationFrame = 0;
    };

    const overflowDistance = () => {
      const distance = Math.max(0, titleElement.scrollWidth - titleElement.clientWidth);
      titleElement.dataset.overflowing = distance > 1 ? 'true' : 'false';
      return distance;
    };

    const animateTo = (
      target: number,
      duration: number,
      delay: number,
      easing: (progress: number) => number,
      onComplete?: () => void,
      onStart?: () => void,
    ) => {
      cancelAnimation();
      if (reducedMotion.matches) {
        titleElement.scrollLeft = 0;
        delete titleElement.dataset.revealing;
        onComplete?.();
        return;
      }
      startTimer = window.setTimeout(() => {
        onStart?.();
        const start = titleElement.scrollLeft;
        const distance = target - start;
        if (Math.abs(distance) <= 1) {
          titleElement.scrollLeft = target;
          onComplete?.();
          return;
        }
        const startedAt = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / duration);
          titleElement.scrollLeft = start + distance * easing(progress);
          if (progress < 1) animationFrame = window.requestAnimationFrame(tick);
          else onComplete?.();
        };
        animationFrame = window.requestAnimationFrame(tick);
      }, delay);
    };

    const reveal = () => {
      const distance = overflowDistance();
      if (distance <= 1) return;
      const duration = Math.min(3000, Math.max(800, Math.round((distance / 55) * 1000)));
      animateTo(distance, duration, 400, (progress) => progress, undefined, () => {
        titleElement.dataset.revealing = 'true';
      });
    };

    const reset = () => {
      if (reducedMotion.matches) {
        cancelAnimation();
        titleElement.scrollLeft = 0;
        delete titleElement.dataset.revealing;
        return;
      }
      animateTo(0, 180, 0, (progress) => 1 - ((1 - progress) ** 3), () => {
        delete titleElement.dataset.revealing;
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      reveal();
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      reset();
    };
    const handleResize = () => {
      cancelAnimation();
      titleElement.scrollLeft = 0;
      delete titleElement.dataset.revealing;
      const distance = overflowDistance();
      if (distance > 1 && (row.matches(':hover') || row.contains(document.activeElement))) reveal();
    };
    const handleMotionChange = () => {
      if (reducedMotion.matches) reset();
    };

    row.addEventListener('pointerenter', reveal);
    row.addEventListener('pointerleave', reset);
    row.addEventListener('focusin', handleFocusIn);
    row.addEventListener('focusout', handleFocusOut);
    reducedMotion.addEventListener('change', handleMotionChange);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(titleElement);
    overflowDistance();

    return () => {
      cancelAnimation();
      delete titleElement.dataset.revealing;
      resizeObserver.disconnect();
      reducedMotion.removeEventListener('change', handleMotionChange);
      row.removeEventListener('pointerenter', reveal);
      row.removeEventListener('pointerleave', reset);
      row.removeEventListener('focusin', handleFocusIn);
      row.removeEventListener('focusout', handleFocusOut);
    };
  }, [title]);

  return (
    <strong ref={titleRef} className={`rail-scrolling-title ${className}`.trim()} title={title}>
      {title}
    </strong>
  );
}

export function ThreadRailContent({
  thread,
  agents,
  onOpen,
  onMore,
}: {
  thread: ThreadSummary;
  agents: Agent[];
  onOpen: () => void;
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const participantIds = [
    ...new Set(
      [
        ...(thread.participantAgentIds || []),
        thread.defaultAgentId,
        thread.activeAgentId,
        thread.primaryAgentId,
      ].filter((agentId): agentId is string => Boolean(agentId)),
    ),
  ];
  const participants = participantIds
    .map((agentId) => agentById.get(agentId))
    .filter((agent): agent is Agent => Boolean(agent));
  const visibleParticipants = participants.slice(0, 3);
  const hiddenCount = Math.max(0, participants.length - visibleParticipants.length);
  const statusLabel =
    thread.runStatus === 'running' ? '运行中' : thread.runStatus === 'failed' ? '运行失败' : '就绪';
  const participantLabel = participants.length
    ? participants.map((agent) => agent.name).join('、')
    : thread.primaryAgentName || 'Agent';
  const pinnedLabel = thread.pinnedAt ? '，已置顶' : '';

  return (
    <>
      <button
        className="rail-main rail-thread-main"
        onClick={onOpen}
        aria-label={`${thread.title}${pinnedLabel}，参与 Agent：${participantLabel}，${statusLabel}`}
      >
        <span className="rail-thread-line">
          {thread.pinnedAt && (
            <span className="rail-thread-pin" title="已置顶" aria-hidden="true">
              <Pin size={12} fill="currentColor" />
            </span>
          )}
          <RailScrollingTitle title={thread.title} className="rail-thread-title" />
          <span
            className={`rail-thread-participants ${thread.runStatus || 'idle'}`}
            title={participantLabel}
            aria-hidden="true"
          >
            {visibleParticipants.map((agent) => {
              const isActive =
                agent.id === (thread.activeAgentId || thread.defaultAgentId || thread.primaryAgentId);
              return (
                <span
                  className={`rail-thread-avatar ${thread.runStatus === 'running' && isActive ? 'active-running' : ''} ${thread.runStatus === 'failed' && isActive ? 'active-failed' : ''}`}
                  key={agent.id}
                  style={agent.avatarUrl ? undefined : { background: agent.color }}
                >
                  {agent.avatarUrl ? (
                    <img src={agent.avatarUrl} alt="" />
                  ) : (
                    agent.name.slice(0, 1).toUpperCase()
                  )}
                </span>
              );
            })}
            {hiddenCount > 0 && <span className="rail-thread-overflow">+{hiddenCount}</span>}
          </span>
        </span>
      </button>
      <button
        className="rail-more-button"
        onClick={onMore}
        aria-label={`更多对话操作：${thread.title}`}
        title="更多"
      >
        <MoreHorizontal size={15} />
      </button>
    </>
  );
}

export function RenameDialog({
  target,
  onClose,
  onSave,
  onGenerateTitle,
}: {
  target: Exclude<RenameDialogTarget, null>;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
  onGenerateTitle?: () => Promise<string>;
}) {
  const [draft, setDraft] = useState(target.title);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const noun = target.kind === 'workspace' ? '项目' : '对话';
  useEffect(() => {
    setDraft(target.title);
    setError('');
    setSaving(false);
    setGenerating(false);
  }, [target.id, target.title]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const value = draft.trim();
    if (!value) {
      setError(`${noun}名称不能为空。`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(value);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : '保存失败。');
    }
  }

  async function generateTitle() {
    if (!onGenerateTitle || generating || saving) return;
    setGenerating(true);
    setError('');
    try {
      setDraft(await onGenerateTitle());
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动生成标题失败。');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <AppDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving && !generating) onClose();
      }}
    >
      <AppDialogContent
        className="rename-dialog app-form-dialog"
        onEscapeKeyDown={(event) => {
          if (saving || generating) event.preventDefault();
        }}
      >
        <form className="rename-dialog-form" onSubmit={(event) => void submit(event)}>
          <header className="rename-dialog-head">
            <AppDialogTitle asChild>
              <h2>重命名{noun}</h2>
            </AppDialogTitle>
            <AppDialogDescription className="visually-hidden">
              输入新的{noun}名称，或自动生成一个标题。
            </AppDialogDescription>
            <AppDialogClose asChild>
              <button
                type="button"
                className="rename-dialog-close"
                aria-label="关闭"
                disabled={saving || generating}
              >
                <X size={15} />
              </button>
            </AppDialogClose>
          </header>
          <label className="rename-dialog-field">
            <span>{noun}名称</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={60}
              autoFocus
              disabled={saving || generating}
            />
          </label>
          {error && <div className="inline-error">{error}</div>}
          <footer className="rename-dialog-actions">
            {onGenerateTitle ? (
              <button
                type="button"
                className="rename-title-generate"
                disabled={saving || generating}
                onClick={() => void generateTitle()}
              >
                {generating ? '生成中…' : '自动生成标题'}
              </button>
            ) : (
              <span />
            )}
            <div>
              <AppDialogClose asChild>
                <button
                  type="button"
                  className="rename-dialog-cancel"
                  disabled={saving || generating}
                >
                  取消
                </button>
              </AppDialogClose>
              <button
                type="submit"
                className="rename-dialog-save"
                disabled={saving || generating || !draft.trim()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </footer>
        </form>
      </AppDialogContent>
    </AppDialog>
  );
}

export function RailContextMenu({
  target,
  canShowInFinder,
  onClose,
  onToggleWorkspacePinned,
  onRenameWorkspace,
  onArchiveWorkspace,
  onDeleteWorkspace,
  onShowInFinder,
  onCopyText,
  onEditSpace,
  onToggleThreadPinned,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
}: {
  target: RailContextMenuTarget;
  canShowInFinder: boolean;
  onClose: () => void;
  onToggleWorkspacePinned: (workspace: Workspace) => Promise<void>;
  onRenameWorkspace: (workspace: Workspace) => Promise<void>;
  onArchiveWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
  onShowInFinder: (targetPath: string) => Promise<void>;
  onCopyText: (value: string) => Promise<void>;
  onEditSpace: (space: Space) => void;
  onToggleThreadPinned: (thread: ThreadSummary) => Promise<void>;
  onRenameThread: (thread: ThreadSummary) => Promise<void>;
  onArchiveThread: (thread: ThreadSummary) => void;
  onDeleteThread: (thread: ThreadSummary) => void;
}) {
  const isWorkspace = target.kind === 'workspace';
  const workspace = isWorkspace ? target.workspace : null;
  const thread = target.kind === 'thread' ? target.thread : null;
  const space = target.kind === 'space' ? target.space : null;
  const rootPath = workspace?.rootPath || thread?.workspaceRootPath || '';
  const anchorStyle = {
    left: Math.max(8, Math.min(target.x, window.innerWidth - 8)),
    top: Math.max(8, Math.min(target.y, window.innerHeight - 8)),
  } as React.CSSProperties;
  async function run(action: () => void | Promise<void>) {
    onClose();
    await action();
  }
  return (
    <AppMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AppMenuTrigger asChild>
        <span className="rail-menu-virtual-anchor" style={anchorStyle} aria-hidden="true" />
      </AppMenuTrigger>
      <AppMenuContent
        className={space ? 'rail-menu-content compact' : 'rail-menu-content'}
        side="bottom"
        align="start"
        sideOffset={0}
      >
        {space ? (
          <>
            <AppMenuItem onSelect={() => void run(() => onEditSpace(space))}>
              <Settings />
              <span>编辑工作区</span>
            </AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem onSelect={() => void run(() => onCopyText(space.id))}>
              <Copy />
              <span>复制工作区 ID</span>
            </AppMenuItem>
          </>
        ) : workspace ? (
          <>
            <AppMenuItem onSelect={() => void run(() => onToggleWorkspacePinned(workspace))}>
              <Pin />
              <span>{workspace.pinnedAt ? '取消置顶项目' : '置顶项目'}</span>
            </AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onRenameWorkspace(workspace))}>
              <Pencil />
              <span>重命名项目</span>
            </AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onArchiveWorkspace(workspace))}>
              <Archive />
              <span>归档项目</span>
            </AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem
              disabled={!canShowInFinder || !rootPath}
              onSelect={() => void run(() => onShowInFinder(rootPath))}
            >
              <FolderOpen />
              <span>在 Finder 中显示</span>
            </AppMenuItem>
            <AppMenuItem disabled={!rootPath} onSelect={() => void run(() => onCopyText(rootPath))}>
              <Copy />
              <span>复制项目路径</span>
            </AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onCopyText(workspace.id))}>
              <Copy />
              <span>复制项目 ID</span>
            </AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem
              variant="destructive"
              onSelect={() => void run(() => onDeleteWorkspace(workspace))}
            >
              <Trash2 />
              <span>删除项目</span>
            </AppMenuItem>
          </>
        ) : thread ? (
          <>
            <AppMenuItem onSelect={() => void run(() => onToggleThreadPinned(thread))}>
              <Pin />
              <span>{thread.pinnedAt ? '取消置顶对话' : '置顶对话'}</span>
            </AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onRenameThread(thread))}>
              <Pencil />
              <span>重命名对话</span>
            </AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onArchiveThread(thread))}>
              <Archive />
              <span>归档对话</span>
            </AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem
              disabled={!canShowInFinder || !rootPath}
              onSelect={() => void run(() => onShowInFinder(rootPath))}
            >
              <FolderOpen />
              <span>在 Finder 中显示</span>
            </AppMenuItem>
            <AppMenuItem disabled={!rootPath} onSelect={() => void run(() => onCopyText(rootPath))}>
              <Copy />
              <span>复制项目路径</span>
            </AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onCopyText(thread.id))}>
              <Copy />
              <span>复制会话 ID</span>
            </AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem
              variant="destructive"
              onSelect={() => void run(() => onDeleteThread(thread))}
            >
              <Trash2 />
              <span>删除对话</span>
            </AppMenuItem>
          </>
        ) : null}
      </AppMenuContent>
    </AppMenu>
  );
}

export function RailConfirmDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: Exclude<RailConfirm, null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const noun = target.kind === 'workspace' ? '项目' : '对话';
  const hint =
    target.kind === 'workspace'
      ? '只移除 Frakio Work 记录，不删除本地文件夹。'
      : '删除后会从侧栏移除，不进入归档。';
  return (
    <AppAlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AppAlertDialogContent>
        <AppAlertDialogTitle className="app-alert-title">删除{noun}？</AppAlertDialogTitle>
        <AppAlertDialogDescription className="app-alert-description">
          <strong>{target.title}</strong>
          <span>{hint}</span>
        </AppAlertDialogDescription>
        <div className="app-alert-actions">
          <AppAlertDialogCancel className="cancel" autoFocus onClick={onCancel}>
            取消
          </AppAlertDialogCancel>
          <AppAlertDialogAction className="danger" onClick={onConfirm}>
            删除
          </AppAlertDialogAction>
        </div>
      </AppAlertDialogContent>
    </AppAlertDialog>
  );
}
// wjz新建文件结束。
