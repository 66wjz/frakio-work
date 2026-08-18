// wjz新建文件，新建原因：解耦 main.tsx 中的会话顶部栏内核切换器与会话配置菜单（HeaderControls），修改时间：2026-08-17。
// 文件内容概述：RuntimeSwitcher 团队 Agent 运行时内核切换与会话状态浮层、ThreadActionsMenu 会话标题/跟随模式/项目资料库及上下文检视菜单。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  UserPlus,
} from 'lucide-react';
import {
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
} from '../../overlay-primitives';
import {
  isRuntimeReady,
  mergeRuntimeDefinitions,
  runtimeLabels,
  runtimeSeed,
  runtimeVisuals,
} from '../../utils/workbench-helpers';
import { RuntimeLabel } from './RuntimeLabel';
import { AgentAvatar } from '../common/AgentAvatar';
import { requestJson } from '../../utils/api-client';
import type {
  Agent,
  FollowMode,
  RuntimeDefinition,
  RuntimeId,
  RuntimeSessionSummary,
  Thread,
  Vault,
  Workspace,
} from '../../types/workbench';

export function RuntimeSwitcher({
  thread,
  activeAgent,
  agents = [],
  currentRuntimeId: runtimeIdOverride,
  isRunning,
  onRuntimeChange: _onRuntimeChange,
  onOpenRuntimeCenter,
}: {
  thread?: Pick<Thread, 'id' | 'selectedAgents' | 'agentRuntimeOverrides' | 'agentHarnessBindings' | 'runtimeId'> | null;
  activeAgent: Agent | null;
  agents?: Agent[];
  currentRuntimeId?: RuntimeId;
  isRunning: boolean;
  onRuntimeChange: (agentId: string, runtimeId: RuntimeId) => Promise<{ message?: string; resumeCandidate?: boolean } | void>;
  onOpenRuntimeCenter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice] = useState('');
  const [runtimes, setRuntimes] = useState<RuntimeDefinition[]>(runtimeSeed);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const teamAgentIds = thread
    ? Array.from(
        new Set(
          [
            ...(thread.selectedAgents || []),
            ...Object.keys(thread.agentHarnessBindings || {}),
            activeAgent?.id || '',
          ].filter(Boolean),
        ),
      )
    : activeAgent
      ? [activeAgent.id]
      : [];
  const teamAgents = teamAgentIds
    .map((agentId) => agents.find((agent) => agent.id === agentId) || (activeAgent?.id === agentId ? activeAgent : null))
    .filter((agent): agent is Agent => Boolean(agent));
  const teamAgentIdsKey = teamAgents
    .map(
      (agent) =>
        `${agent.id}:${agent.runtimePolicy?.defaultHarnessId || agent.runtimePolicy?.defaultRuntimeId || ''}`,
    )
    .join('|');
  const harnessForAgent = (agent: Agent): RuntimeId => {
    const bound =
      thread?.agentHarnessBindings?.[agent.id]?.harnessId ||
      thread?.agentRuntimeOverrides?.[agent.id] ||
      (agent.id === activeAgent?.id ? runtimeIdOverride : '') ||
      agent.runtimePolicy?.defaultHarnessId ||
      agent.runtimePolicy?.defaultRuntimeId ||
      'native';
    return bound === 'pi' ? 'native' : bound;
  };
  const currentRuntimeId = activeAgent ? harnessForAgent(activeAgent) : 'native';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      const response = await fetch('/api/runtimes');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || cancelled) return;
      setRuntimes((current) => mergeRuntimeDefinitions(current, payload.runtimes || []));
      if (thread?.id) {
        const sessionPayload = await fetch(
          `/api/runtime-sessions?threadId=${encodeURIComponent(thread.id)}&laneType=chat`,
        )
          .then((item) => item.json())
          .catch(() => ({}));
        if (!cancelled) setSessions(Array.isArray(sessionPayload.sessions) ? sessionPayload.sessions : []);
      }
      await Promise.all(
        runtimeSeed.map(async ({ id: runtimeId }) => {
          const detected = await fetch(`/api/runtimes/${runtimeId}/detect`, { method: 'POST' })
            .then((item) => item.json())
            .catch(() => null);
          if (!cancelled && detected?.runtime)
            setRuntimes((current) => mergeRuntimeDefinitions(current, [detected.runtime]));
        }),
      );
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [open, teamAgentIdsKey, thread?.id]);

  const displayRuntimeId = currentRuntimeId === 'native' ? 'pi' : currentRuntimeId;
  const currentLabel =
    currentRuntimeId === 'native'
      ? 'Frakio Native'
      : runtimeVisuals[displayRuntimeId]?.label || runtimeLabels[displayRuntimeId] || displayRuntimeId;
  const buttonLabel = activeAgent
    ? `团队运行内核，${activeAgent.name} 当前为 ${currentLabel}`
    : '当前对话未选择 Agent';

  return (
    <AppMenu open={open} onOpenChange={setOpen} modal={false}>
      <div className="runtime-switcher">
        <AppMenuTrigger asChild>
          <button
            className="runtime-switcher-trigger"
            disabled={!activeAgent}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={buttonLabel}
            title={buttonLabel}
          >
            <span className="runtime-switcher-mark">
              <RuntimeLabel runtimeId={currentRuntimeId} showName={false} />
              {isRunning && (
                <LoaderCircle className="runtime-switcher-spinner spin" size={12} aria-label="运行中" />
              )}
            </span>
          </button>
        </AppMenuTrigger>
      </div>
      <AppMenuContent className="runtime-switcher-popover" aria-label="团队运行内核" side="bottom" align="end">
        <div className="runtime-switcher-summary">
          <span>团队运行内核</span>
          <small>会话创建时已绑定</small>
        </div>
        {teamAgents.length ? (
          teamAgents.map((agent) => {
            const runtimeId = harnessForAgent(agent);
            const runtime = runtimes.find((item) => item.id === (runtimeId === 'native' ? 'pi' : runtimeId));
            const ready = isRuntimeReady(runtime);
            const runtimeSession = sessions.find(
              (session) =>
                session.runtimeId === (runtimeId === 'native' ? 'pi' : runtimeId) &&
                session.laneId === thread?.id &&
                session.agentId === agent.id,
            );
            const sessionLabel =
              runtimeSession?.lifecycleState === 'active'
                ? 'Session 活跃'
                : runtimeSession?.lifecycleState === 'recovering' || runtimeSession?.lifecycleState === 'restoring'
                  ? '等待恢复'
                  : runtimeSession?.lifecycleState === 'parked'
                    ? '已停泊'
                    : runtimeSession?.lifecycleState === 'stale'
                      ? '需交接恢复'
                      : '';
            return (
              <AppMenuItem
                key={agent.id}
                className="runtime-switcher-option selected"
                disabled
                title={
                  ready
                    ? `${agent.name} 已绑定 ${runtimeId === 'native' ? 'Frakio Native' : runtimeLabels[runtimeId] || runtimeId}`
                    : runtime?.installation?.detail || '请前往 Runtime Center 完成修复'
                }
              >
                <AgentAvatar agent={agent} size="sm" />
                <span className="runtime-switcher-agent">
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
                </span>
                <RuntimeLabel runtimeId={runtimeId} />
                {!ready && <em>{runtime?.installation?.status === 'checking' ? '检测中' : '不可用'}</em>}
                {ready && sessionLabel && <em>{sessionLabel}</em>}
                <Check size={14} aria-hidden="true" />
              </AppMenuItem>
            );
          })
        ) : (
          <span className="provider-model-empty">当前对话没有 Agent。</span>
        )}
        <div className="runtime-switcher-footer">
          <small>{notice || 'Harness 在会话创建时固定；如需迁移，请前往 Runtime Center。'}</small>
          <button
            onClick={() => {
              setOpen(false);
              onOpenRuntimeCenter();
            }}
          >
            打开 Runtime Center
          </button>
        </div>
      </AppMenuContent>
    </AppMenu>
  );
}

export function ThreadActionsMenu({
  thread,
  workspace,
  vaults,
  activeVault,
  activeAgent,
  triggerVariant = 'icon',
  triggerTitle = '',
  onFollowModeChange,
  onCreateProjectThread,
  onConvertToProject,
  onVaultChange,
  onOpenAgents,
  onRenameThread,
  onRegenerateTitle,
}: {
  thread: Thread;
  workspace: Workspace | null;
  vaults: Vault[];
  activeVault: Vault | null;
  activeAgent: Agent | null;
  triggerVariant?: 'icon' | 'title';
  triggerTitle?: string;
  onFollowModeChange: (mode: FollowMode) => Promise<void>;
  onCreateProjectThread: () => Promise<void>;
  onConvertToProject: () => void;
  onVaultChange: (vaultId: string | null) => Promise<void>;
  onOpenAgents: () => void;
  onRenameThread: () => void;
  onRegenerateTitle: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [contextPreview, setContextPreview] = useState<{
    sources: Array<{ kind: string; label: string; count: number }>;
    projectRulePaths?: string[];
    runtimeId?: string;
    targetAgentId?: string;
    cursor?: { from: number; to: number; stateRevision?: number };
    stateRevision?: number;
    budget?: { estimatedTokens?: number; softLimit?: number };
    warnings?: Array<{ code?: string; message?: string }>;
  } | null>(null);
  const threadIdRef = useRef(thread.id);
  const popoverId = `thread-actions-popover-${thread.id}`;
  const followLabel = thread.followMode === 'conversation' ? '对话跟随' : '默认跟随';
  const workspaceLabel = thread.mode === 'workspace' ? workspace?.name || '项目对话' : '临时对话';
  const agentLabel = activeAgent?.name || '未选择 Agent';

  const closeMenu = useCallback((_restoreFocus = true) => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (threadIdRef.current === thread.id) return;
    threadIdRef.current = thread.id;
    setOpen(false);
    setTitleBusy(false);
    setTitleError('');
  }, [thread.id]);

  async function regenerateTitle() {
    if (titleBusy) return;
    setTitleBusy(true);
    setTitleError('');
    try {
      await onRegenerateTitle();
      setOpen(false);
    } catch (err: any) {
      setTitleError(err instanceof Error ? err.message : '自动生成标题失败。');
    } finally {
      setTitleBusy(false);
    }
  }

  async function loadContextInspection() {
    const result = await requestJson<{
      receipts: Array<{
        runtimeId: string;
        agentId: string;
        stateRevision: number;
        cursor: { from: number; to: number };
        budget: { estimatedTokens?: number; softLimit?: number };
        included: Array<{ kind: string; count: number }>;
        warnings: Array<{ code?: string; message?: string }>;
      }>;
    }>(`/api/threads/${thread.id}/context-receipts?limit=1`);
    const receipt = result.receipts[0];
    if (receipt) {
      const labels: Record<string, string> = {
        thread_state: '共享会话状态',
        recent_conversation: '最近公开对话',
        relevant_history: '相关历史',
        memory: '记忆',
        knowledge: '资料与规则',
        artifacts: '产物引用',
      };
      setContextPreview({
        runtimeId: receipt.runtimeId,
        targetAgentId: receipt.agentId,
        stateRevision: receipt.stateRevision,
        cursor: receipt.cursor,
        budget: receipt.budget,
        warnings: receipt.warnings,
        sources: receipt.included.map((source) => ({ ...source, label: labels[source.kind] || source.kind })),
      });
      return;
    }
    const preview = await requestJson<{
      sources: Array<{ kind: string; label: string; count: number }>;
      projectRulePaths?: string[];
      runtimeId?: string;
      targetAgentId?: string;
      cursor?: { from: number; to: number; stateRevision?: number };
      budget?: { estimatedTokens?: number; softLimit?: number };
      warnings?: Array<{ code?: string; message?: string }>;
    }>(`/api/threads/${thread.id}/context-preview?agentId=${encodeURIComponent(activeAgent?.id || '')}`);
    setContextPreview(preview);
  }

  return (
    <AppMenu open={open} onOpenChange={setOpen} modal={false}>
      <div
        className={
          triggerVariant === 'title'
            ? 'thread-actions-menu conversation-title-menu'
            : 'thread-actions-menu'
        }
      >
        <AppMenuTrigger asChild>
          <button
            className={
              triggerVariant === 'title'
                ? 'conversation-title-trigger'
                : 'top-icon-btn thread-actions-trigger'
            }
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            aria-haspopup="dialog"
            aria-label={triggerVariant === 'title' ? `对话设置：${triggerTitle}` : '对话设置'}
            title="对话设置"
          >
            {triggerVariant === 'title' ? (
              <>
                <h1>{triggerTitle}</h1>
                <ChevronDown size={14} aria-hidden="true" />
              </>
            ) : (
              <MoreHorizontal size={18} />
            )}
          </button>
        </AppMenuTrigger>
      </div>
      <AppMenuContent
        id={popoverId}
        className="thread-actions-popover-v2"
        aria-label="对话设置"
        side="bottom"
        align={triggerVariant === 'title' ? 'center' : 'end'}
      >
        <div className="thread-actions-summary">
          <strong>{followLabel} · {agentLabel}</strong>
          <span>{workspaceLabel}{activeVault ? ` · ${activeVault.name}` : ''}</span>
        </div>
        <div className="thread-menu-section thread-title-actions">
          <span>标题</span>
          <button
            onClick={() => {
              closeMenu(false);
              onRenameThread();
            }}
          >
            <span>重命名</span>
          </button>
          <button disabled={titleBusy} onClick={() => void regenerateTitle()}>
            <span>{titleBusy ? '正在生成…' : '重新生成标题'}</span>
          </button>
          {titleError && (
            <small className="thread-title-error" role="alert">
              {titleError}
            </small>
          )}
        </div>
        <div className="thread-menu-section">
          <span>跟随</span>
          <button
            className={(thread.followMode || 'default') === 'default' ? 'selected' : ''}
            onClick={() => {
              closeMenu(false);
              void onFollowModeChange('default');
            }}
          >
            <span>默认跟随</span>
            {(thread.followMode || 'default') === 'default' && <Check size={14} aria-hidden="true" />}
          </button>
          <button
            className={thread.followMode === 'conversation' ? 'selected' : ''}
            onClick={() => {
              closeMenu(false);
              void onFollowModeChange('conversation');
            }}
          >
            <span>对话跟随</span>
            {thread.followMode === 'conversation' && <Check size={14} aria-hidden="true" />}
          </button>
        </div>
        <div className="thread-menu-section">
          <span>项目</span>
          {thread.mode === 'workspace' ? (
            <button
              onClick={() => {
                closeMenu(false);
                void onCreateProjectThread();
              }}
            >
              <Plus size={15} />新建项目对话
            </button>
          ) : (
            <button
              onClick={() => {
                closeMenu(false);
                onConvertToProject();
              }}
            >
              <FolderOpen size={15} />转为项目
            </button>
          )}
        </div>
        <label className="thread-menu-select">
          <span>项目资料库</span>
          <select
            value={thread.vaultId || ''}
            onChange={(event) => {
              closeMenu(false);
              void onVaultChange(event.target.value || null);
            }}
          >
            <option value="">不连接资料库</option>
            {vaults
              .filter((vault) => vault.kind === 'project')
              .map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
          </select>
        </label>
        <div className="thread-menu-section">
          <span>本轮上下文</span>
          <button onClick={() => void loadContextInspection()}>
            <span>查看实际注入来源</span>
          </button>
          {contextPreview && (
            <div className="thread-context-preview">
              {contextPreview.runtimeId && (
                <small>
                  {contextPreview.runtimeId} · 状态 r{contextPreview.stateRevision ?? contextPreview.cursor?.stateRevision ?? 0}
                </small>
              )}
              {contextPreview.cursor && (
                <small>事件 {contextPreview.cursor.from}–{contextPreview.cursor.to}</small>
              )}
              {contextPreview.budget?.estimatedTokens != null && (
                <small>
                  {contextPreview.budget.estimatedTokens} / {contextPreview.budget.softLimit || 0} tokens
                </small>
              )}
              {contextPreview.sources.map((source) => (
                <small key={source.kind}>{source.label} · {source.count}</small>
              ))}
              {(contextPreview.projectRulePaths || []).map((rulePath) => (
                <code key={rulePath}>{rulePath}</code>
              ))}
              {(contextPreview.warnings || []).map((warning, index) => (
                <small key={`${warning.code || 'warning'}-${index}`}>{warning.message || warning.code}</small>
              ))}
            </div>
          )}
        </div>
        <button
          className="thread-menu-wide"
          onClick={() => {
            closeMenu(false);
            onOpenAgents();
          }}
        >
          <UserPlus size={15} />团队成员
        </button>
      </AppMenuContent>
    </AppMenu>
  );
}
// wjz新建文件结束。
