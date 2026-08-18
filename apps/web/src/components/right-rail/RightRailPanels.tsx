// wjz新建文件，新建原因：解耦 main.tsx 中的右侧多模态工作区面板群（RightRailPanels），修改时间：2026-08-17。
// 文件内容概述：RightRailLauncher 工具导航入口、CollaborationContextPanel 协作进度全景盘、BrowserPanel 内嵌受控浏览器及批注、ProjectFilesPanel 项目文件树、ReviewPanel 只读差异审阅面板、CodexResourcePanel 资源汇总与会话概览导轨。
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BaseIcon,
  BaseButton,
  BaseInput,
  BaseBadge,
  BaseCard,
  BaseEmptyState,
} from '../base';

const Activity = (p: any) => <BaseIcon name="activity" {...p} />;
const ArrowLeft = (p: any) => <BaseIcon name="arrow-left" {...p} />;
const BookOpenText = (p: any) => <BaseIcon name="book-open-text" {...p} />;
const Boxes = (p: any) => <BaseIcon name="boxes" {...p} />;
const Check = (p: any) => <BaseIcon name="check" {...p} />;
const CheckCircle2 = (p: any) => <BaseIcon name="check-circle-2" {...p} />;
const ChevronRight = (p: any) => <BaseIcon name="chevron-right" {...p} />;
const Circle = (p: any) => <BaseIcon name="circle" {...p} />;
const Clock3 = (p: any) => <BaseIcon name="clock3" {...p} />;
const Database = (p: any) => <BaseIcon name="database" {...p} />;
const ExternalLink = (p: any) => <BaseIcon name="external-link" {...p} />;
const File = (p: any) => <BaseIcon name="file" {...p} />;
const FileText = (p: any) => <BaseIcon name="file-text" {...p} />;
const Folder = (p: any) => <BaseIcon name="folder" {...p} />;
const FolderOpen = (p: any) => <BaseIcon name="folder-open" {...p} />;
const GitCompareArrows = (p: any) => <BaseIcon name="git-compare-arrows" {...p} />;
const Globe2 = (p: any) => <BaseIcon name="globe2" {...p} />;
const Library = (p: any) => <BaseIcon name="library" {...p} />;
const Link2 = (p: any) => <BaseIcon name="link2" {...p} />;
const LoaderCircle = (p: any) => <BaseIcon name="loader-circle" {...p} />;
const Minus = (p: any) => <BaseIcon name="minus" {...p} />;
const Monitor = (p: any) => <BaseIcon name="monitor" {...p} />;
const MoreHorizontal = (p: any) => <BaseIcon name="more-horizontal" {...p} />;
const MousePointer2 = (p: any) => <BaseIcon name="mouse-pointer-2" {...p} />;
const PauseCircle = (p: any) => <BaseIcon name="pause-circle" {...p} />;
const RefreshCw = (p: any) => <BaseIcon name="refresh-cw" {...p} />;
const Scan = (p: any) => <BaseIcon name="scan" {...p} />;
const Search = (p: any) => <BaseIcon name="search" {...p} />;
const Settings = (p: any) => <BaseIcon name="settings" {...p} />;
const Square = (p: any) => <BaseIcon name="square" {...p} />;
const X = (p: any) => <BaseIcon name="x" {...p} />;
import {
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
} from '../../overlay-primitives';
import {
  rightRailTabMeta,
  rightRailTabs,
  openExternalUrl,
} from '../../utils/workbench-helpers';
import { RightRailTabIcon } from '../layout/RightRailTabIcon';
import {
  CollaborationRuntimeErrorCard,
  CollaborationSummaryCard,
  collaborationCardLifecycle,
  useCollaborationCompletionCelebrations,
} from '../collaboration/CollaborationCards';
import { iconForFileName, visibleWorkflowSteps } from '../collaboration/PlanAndDecisionPanels';
import { requestJson } from '../../utils/api-client';
import { formatFileSize, formatTime } from '../../utils/formatters';
import {
  browserWebviewPool,
  normalizeBrowserUrl,
  type BrowserGuest,
} from '../../browser-webview-pool';
import {
  publishThreadCollaborationSnapshot,
  refreshThreadCollaboration,
  useThreadCollaboration,
} from '../../collaboration-store';
import type {
  Agent,
  AttachmentDraft,
  BrowserAnnotation,
  BrowserAnnotationMode,
  BrowserViewState,
  ChatEvent,
  CollaborationSnapshot,
  CollaborationWorkflowSnapshot,
  ContextPacket,
  ConversationOverview,
  HermesRunApproval,
  HermesRunClarification,
  MessageContext,
  Proposal,
  ReviewComment,
  RightRailTab,
  RunChangeSet,
  Thread,
  Vault,
  VaultDetail,
  WorkArtifact,
  Workspace,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from '../../types/workbench';

const LazyPatchDiff = React.lazy(() =>
  import('@pierre/diffs/react').then((module) => ({ default: module.PatchDiff })),
);

export type ThreadOverviewRound = {
  id: string;
  startMessageId: string;
  title: string;
  summary: string;
  messageIds: string[];
  agentNames: string[];
};

export type ContextPanelProps = {
  contextPacket: ContextPacket | null;
  proposals: Proposal[];
  workspaceArtifacts: WorkArtifact[];
  thread: Thread | null;
  agents: Agent[];
  workspace: Workspace | null;
  activeVault: Vault | null;
  isRunning: boolean;
  runApproval: HermesRunApproval | null;
  runClarification: HermesRunClarification | null;
  runError: string;
  runDraft: string;
  liveChangeSet: RunChangeSet | null;
  onDraftContextChanged: () => void;
  onOpenVaultSettings: () => void;
};

export function RightRailLauncher({ onOpen }: { onOpen: (tab: RightRailTab) => void }) {
  return (
    <div className="right-rail-launcher" aria-label="选择工具">
      <div>
        <small>右侧工作区</small>
        <strong>打开工具</strong>
      </div>
      <section>
        {rightRailTabs.map((tab) => (
          <button type="button" key={tab} onClick={() => onOpen(tab)}>
            <RightRailTabIcon tab={tab} size={17} />
            <span>
              <strong>{rightRailTabMeta[tab].title}</strong>
              <small>{rightRailTabMeta[tab].detail}</small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
      </section>
    </div>
  );
}

export function CollaborationContextPanel(
  props: ContextPanelProps & {
    fallbackDecisionAgentId: string;
    collaborationModeError: { message: string; code?: string; details?: Record<string, any> } | null;
    collaborationModeLoading: boolean;
    onRetryCollaboration: () => void;
    panelTab: RightRailTab;
    hasOpenTabs: boolean;
    collaborationTaskRequest: { id: string; threadId: string; workflowId?: string; taskId?: string } | null;
    onOpenTab: (tab: RightRailTab) => void;
    onCloseTab: (tab: RightRailTab) => void;
  },
) {
  const { thread, agents } = props;
  const collaborationState = useThreadCollaboration<CollaborationSnapshot>(thread?.id);
  const snapshot = collaborationState.snapshot;
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [, setSelectedTaskId] = useState('');
  const [localError, setError] = useState('');
  const error = localError || collaborationState.error;
  const syncPending = collaborationState.syncPending;
  const activeWorkflow =
    snapshot?.workflows.find((item) => item.id === selectedWorkflowId) ||
    snapshot?.workflows.find((item) => item.id === snapshot.activeWorkflowId) ||
    [...(snapshot?.workflows || [])].reverse().find((item) => item.status !== 'archived') ||
    null;
  const celebratingTaskIds = useCollaborationCompletionCelebrations(snapshot, activeWorkflow?.id || '');

  async function loadSnapshot() {
    if (!thread?.id) return;
    try {
      await refreshThreadCollaboration(thread.id);
      setError('');
    } catch (err: any) {
      setError(err.message || '协作状态读取失败');
    }
  }

  useEffect(() => {
    setSelectedWorkflowId('');
    setSelectedTaskId('');
  }, [thread?.id]);

  useEffect(() => {
    if (props.collaborationModeLoading || props.collaborationModeError) props.onOpenTab('collaboration');
  }, [props.collaborationModeLoading, props.collaborationModeError, props]);

  async function selectWorkflow(workflowId: string) {
    setSelectedWorkflowId(workflowId);
    setSelectedTaskId('');
  }

  useEffect(() => {
    const request = props.collaborationTaskRequest;
    if (!request || request.threadId !== thread?.id) return undefined;
    let cancelled = false;
    const openTask = async () => {
      props.onOpenTab('collaboration');
      if (request.workflowId && request.workflowId !== activeWorkflow?.id) await selectWorkflow(request.workflowId);
      if (!cancelled) setSelectedTaskId(request.taskId || '');
    };
    void openTask();
    return () => {
      cancelled = true;
    };
  }, [props.collaborationTaskRequest?.id, thread?.id, activeWorkflow?.id, props]);

  async function openOverview() {
    try {
      await requestJson<{
        workflows: Array<CollaborationWorkflowSnapshot & { threadId: string; threadTitle: string }>;
      }>('/api/collaboration/overview');
    } catch (err: any) {
      setError(err.message || '协作大盘读取失败');
    }
  }

  return (
    <div className="workbench-panel collaboration-context-panel" role="region" aria-label="协作工作区">
      <header className="workbench-panel-head">
        <div>
          <small>多 Agent 协作</small>
          <strong>协作中心</strong>
        </div>
        <div className="panel-head-actions">
          <button type="button" className="icon-btn small" onClick={() => void openOverview()} aria-label="打开大盘" title="全局大盘">
            <Activity size={14} />
          </button>
          <button type="button" className="icon-btn small" onClick={() => props.onCloseTab('collaboration')} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
      </header>
      {props.collaborationModeError && (
        <CollaborationRuntimeErrorCard
          error={props.collaborationModeError}
          loading={props.collaborationModeLoading}
          onRetry={props.onRetryCollaboration}
        />
      )}
      {syncPending && (
        <div className="collaboration-sync-pending" role="status">
          <LoaderCircle size={13} className="spin" />状态待同步
        </div>
      )}
      {activeWorkflow ? (
        <div className="collaboration-workflow-rail-view">
          <CollaborationSummaryCard
            title={activeWorkflow.name || '协作任务'}
            tasks={activeWorkflow.tasks}
            agents={agents}
            lifecycle={collaborationCardLifecycle(activeWorkflow, null, activeWorkflow.tasks)}
            density="rail"
            celebratingTaskIds={celebratingTaskIds}
            onOpenTask={(task) => setSelectedTaskId(task.id)}
          />
        </div>
      ) : (
        <div className="resource-empty">当前会话尚未创建多 Agent 协作任务。</div>
      )}
      {error && <div className="resource-error">{error}</div>}
    </div>
  );
}

export function MessageContextSummary({ context }: { context: MessageContext }) {
  return (
    <div className="message-context-summary" aria-label="消息批注">
      {(context.browserAnnotations || []).map((item: BrowserAnnotation) => (
        <span key={item.id}>
          <Globe2 size={12} />
          {item.target === 'region' ? '区域批注' : item.accessibleName || item.text || '网页批注'}
        </span>
      ))}
      {(context.reviewComments || []).map((item: ReviewComment) => (
        <span key={item.id}>
          <GitCompareArrows size={12} />
          {item.filePath}:{item.line}
        </span>
      ))}
    </div>
  );
}

export function DraftContextTray({
  context,
  onRemove,
}: {
  context: MessageContext;
  onRemove: (kind: 'browser' | 'review', id: string) => void;
}) {
  if (!context.browserAnnotations?.length && !context.reviewComments?.length) return null;
  return (
    <div className="draft-context-tray" aria-label="待发送批注">
      {(context.browserAnnotations || []).map((item: BrowserAnnotation) => (
        <span key={item.id}>
          <Globe2 size={13} />
          <strong>{item.target === 'region' ? '区域批注' : '网页批注'}</strong>
          <small>{item.comment}</small>
          <button type="button" onClick={() => onRemove('browser', item.id)} aria-label="移除网页批注">
            <X size={12} />
          </button>
        </span>
      ))}
      {(context.reviewComments || []).map((item: ReviewComment) => (
        <span key={item.id}>
          <GitCompareArrows size={13} />
          <strong>审阅意见</strong>
          <small>{item.filePath}:{item.line} · {item.comment}</small>
          <button type="button" onClick={() => onRemove('review', item.id)} aria-label="移除审阅意见">
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ConversationOverviewPopover({
  threadId,
  onClose,
  onOpenSources,
  onOpenReview,
}: {
  threadId: string;
  onClose: () => void;
  onOpenSources: () => void;
  onOpenReview: () => void;
}) {
  const [overview, setOverview] = useState<ConversationOverview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void requestJson<{ overview: ConversationOverview }>(`/api/threads/${threadId}/overview`)
      .then((data) => {
        if (active) setOverview(data.overview);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : '摘要读取失败');
      });
    return () => {
      active = false;
    };
  }, [threadId]);
  return (
    <div className="conversation-overview-popover" role="dialog" aria-label="会话摘要">
      <header>
        <div>
          <small>当前会话</small>
          <strong>摘要</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X size={14} />
        </button>
      </header>
      {!overview && !error && (
        <div className="overview-loading">
          <LoaderCircle className="spin" size={15} />正在整理
        </div>
      )}
      {error && <div className="resource-error">{error}</div>}
      {overview && (
        <div className="overview-body">
          <section>
            <span className="overview-label">环境</span>
            <div className="overview-fact">
              <Monitor size={14} />
              <span>
                <strong>{overview.environment.workspaceName || '未绑定项目'}</strong>
                <small>
                  {overview.environment.gitBranch
                    ? `分支 ${overview.environment.gitBranch}`
                    : overview.environment.workspaceRoot || '当前会话没有本地目录'}
                </small>
              </span>
            </div>
          </section>
          {overview.context && (
            <section>
              <span className="overview-label">上下文</span>
              <div className="overview-fact">
                <BookOpenText size={14} />
                <span>
                  <strong>{overview.context.personal.label}</strong>
                  <small>
                    {overview.context.project
                      ? `项目资料库：${overview.context.project.name} · ${overview.context.project.ruleCount} 条规则`
                      : '未挂载项目资料库'}
                  </small>
                </span>
              </div>
            </section>
          )}
          {overview.plan && (
            <section>
              <span className="overview-label">计划</span>
              <div className="overview-fact">
                <CheckCircle2 size={14} />
                <span>
                  <strong>{overview.plan.title}</strong>
                  <small>{overview.plan.taskCount} 个步骤 · {overview.plan.status || '进行中'}</small>
                </span>
              </div>
            </section>
          )}
          <section>
            <span className="overview-label">来源</span>
            {(overview.sources || []).slice(0, 3).map((source: ConversationOverview['sources'][number]) => (
              <div className="overview-source" key={source.id}>
                {source.kind === 'link' ? <Link2 size={13} /> : <FileText size={13} />}
                <span>{source.label}</span>
              </div>
            ))}
            {!overview.sources?.length && <div className="overview-empty">暂无来源</div>}
            <button className="overview-link" type="button" onClick={onOpenSources}>
              查看全部 <ChevronRight size={13} />
            </button>
          </section>
          {overview.artifacts && overview.artifacts.length > 0 && (
            <section>
              <span className="overview-label">产物</span>
              {overview.artifacts.slice(0, 3).map((artifact: any) => (
                <div className="overview-source" key={artifact.id}>
                  <File size={13} />
                  <span>{artifact.name}</span>
                </div>
              ))}
            </section>
          )}
          {overview.lastChangeSet && overview.lastChangeSet.fileCount > 0 && (
            <button className="overview-change" type="button" onClick={onOpenReview}>
              <GitCompareArrows size={15} />
              <span>
                <strong>上一轮改动</strong>
                <small>{overview.lastChangeSet.fileCount} 个文件</small>
              </span>
              <em>+{overview.lastChangeSet.additions}</em>
              <del>-{overview.lastChangeSet.deletions}</del>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SourcesPanel({
  threadId,
  vault,
  onOpenVaultSettings,
  onClose,
}: {
  threadId: string;
  vault: Vault | null;
  onOpenVaultSettings: () => void;
  onClose: () => void;
}) {
  const [overview, setOverview] = useState<ConversationOverview | null>(null);
  const [vaultDetail, setVaultDetail] = useState<VaultDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setOverview(null);
    setError('');
    if (!threadId) return;
    void requestJson<{ overview: ConversationOverview }>(`/api/threads/${threadId}/overview`)
      .then((data) => setOverview(data.overview))
      .catch((err) => setError(err instanceof Error ? err.message : '来源读取失败'));
  }, [threadId]);
  useEffect(() => {
    setVaultDetail(null);
    if (!vault?.id) return;
    void requestJson<VaultDetail>(`/api/vaults/${vault.id}`)
      .then(setVaultDetail)
      .catch(() => setVaultDetail(null));
  }, [vault?.id]);
  return (
    <div className="workbench-panel sources-panel">
      <header className="workbench-panel-head">
        <div>
          <small>会话上下文</small>
          <strong>来源</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X size={15} />
        </button>
      </header>
      {vault && (
        <div className="sources-vault-status">
          <div>
            <Database size={15} />
            <span>
              <strong>{vault.name}</strong>
              <small>{vaultDetail?.config.managementMode === 'read_only' ? '只读连接' : 'Frakio 知识维护已连接'}</small>
            </span>
          </div>
          <div>
            <span>
              <strong>{vaultDetail?.config.trustedRulePaths.length || 0}</strong>
              <small>实际注入规则</small>
            </span>
            <span>
              <strong>{vaultDetail?.stats.pending || 0}</strong>
              <small>待确认</small>
            </span>
          </div>
          {vaultDetail?.recentOperations[0] && (
            <p>最近维护：{vaultDetail.recentOperations[0].summary} · {formatTime(vaultDetail.recentOperations[0].createdAt)}</p>
          )}
          <button type="button" onClick={onOpenVaultSettings}>
            管理资料库 <ChevronRight size={13} />
          </button>
        </div>
      )}
      <div className="sources-list">
        {(overview?.sources || []).map((source: ConversationOverview['sources'][number]) =>
          source.kind === 'link' ? (
            <button type="button" key={source.id} onClick={() => void openExternalUrl(source.url || source.detail)}>
              <Link2 size={15} />
              <span>
                <strong>{source.label}</strong>
                <small>{source.detail}</small>
              </span>
              <ExternalLink size={13} />
            </button>
          ) : (
            <a key={source.id} href={source.attachment?.contentUrl || '#'} target="_blank" rel="noreferrer">
              <FileText size={15} />
              <span>
                <strong>{source.label}</strong>
                <small>用户上传的资料</small>
              </span>
              <ExternalLink size={13} />
            </a>
          ),
        )}
      </div>
      {!overview && !error && <div className="resource-empty">正在读取来源...</div>}
      {overview && !overview.sources?.length && <div className="resource-empty">当前会话还没有上传资料或参考链接</div>}
      {error && <div className="resource-error">{error}</div>}
    </div>
  );
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, encoded = ''] = dataUrl.split(',', 2);
  const mime = header.match(/^data:([^;]+)/)?.[1] || 'image/png';
  const bytes = atob(encoded);
  const values = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) values[index] = bytes.charCodeAt(index);
  return new Blob([values], { type: mime });
}

export const BROWSER_DEFAULT_URL = 'http://localhost:3000/';
export const BROWSER_MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export function BrowserPanel({
  thread,
  onDraftContextChanged,
}: {
  thread: Thread | null;
  onDraftContextChanged: () => void;
}) {
  const browserBridge = (window as any).frakioDesktop?.browser;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const annotationMenuRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<BrowserGuest | null>(null);
  const defaultUserAgentRef = useRef('');
  const mobileModeRef = useRef(false);
  const viewportWidthRef = useRef(0);
  const threadIdRef = useRef(thread?.id);
  const draftContextChangedRef = useRef(onDraftContextChanged);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [annotationMenuOpen, setAnnotationMenuOpen] = useState(false);
  const [browserState, setBrowserState] = useState<BrowserViewState>({
    url: BROWSER_DEFAULT_URL,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    visible: false,
    annotationMode: 'none',
    error: '',
  });
  const [address, setAddress] = useState(BROWSER_DEFAULT_URL);
  threadIdRef.current = thread?.id;
  draftContextChangedRef.current = onDraftContextChanged;

  useLayoutEffect(() => {
    if (!browserBridge || !viewportRef.current) return undefined;
    let disposed = false;
    const entry = browserWebviewPool.acquire();
    const { wrapper, webview } = entry;
    const viewport = viewportRef.current;
    webviewRef.current = webview;
    viewport.appendChild(wrapper);

    const refreshState = (patch: Partial<BrowserViewState> = {}) => {
      if (disposed) return;
      let url = BROWSER_DEFAULT_URL;
      let title = '';
      let canGoBack = false;
      let canGoForward = false;
      try {
        url = webview.getURL() || BROWSER_DEFAULT_URL;
        title = webview.getTitle() || '';
        canGoBack = webview.canGoBack();
        canGoForward = webview.canGoForward();
      } catch {
        // The guest is not attached until it enters the document.
      }
      setBrowserState((current: BrowserViewState) => ({ ...current, url, title, canGoBack, canGoForward, ...patch }));
    };
    const navigate = (value: string) => {
      let url = BROWSER_DEFAULT_URL;
      try {
        url = normalizeBrowserUrl(value);
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法打开这个地址');
        return;
      }
      setError('');
      setBrowserState((current: BrowserViewState) => ({ ...current, url, loading: true }));
      void webview.loadURL(url).catch((err) => setError(err instanceof Error ? err.message : '网页打开失败。'));
    };
    const applyResponsiveMode = () => {
      if (!defaultUserAgentRef.current) return;
      const width = viewportWidthRef.current;
      const nextMobileMode = mobileModeRef.current ? width < 800 : width <= 680;
      if (nextMobileMode === mobileModeRef.current) return;
      mobileModeRef.current = nextMobileMode;
      try {
        webview.setUserAgent(nextMobileMode ? BROWSER_MOBILE_USER_AGENT : defaultUserAgentRef.current);
        const url = webview.getURL();
        if (url && url !== 'about:blank')
          void webview.loadURL(url).catch((err) => setError(err instanceof Error ? err.message : '网页重新加载失败。'));
      } catch {
        // A detached guest will apply the mode after its next dom-ready event.
      }
    };
    const onDomReady = () => {
      if (!defaultUserAgentRef.current) {
        try {
          defaultUserAgentRef.current = webview.getUserAgent();
        } catch {}
      }
      setReady(true);
      refreshState({ visible: true });
      applyResponsiveMode();
      try {
        if (!webview.getURL() || webview.getURL() === 'about:blank') navigate(BROWSER_DEFAULT_URL);
      } catch {
        navigate(BROWSER_DEFAULT_URL);
      }
    };
    const onNavigate = () => refreshState({ loading: false, error: '' });
    const onStartLoading = () => refreshState({ loading: true, error: '' });
    const onStopLoading = () => refreshState({ loading: false });
    const onFailLoad = (event: Event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (detail.errorCode === -3 || detail.isMainFrame === false) return;
      refreshState({ loading: false });
      setError(detail.errorDescription || '网页加载失败。');
    };
    const onCrash = () => {
      refreshState({ loading: false });
      setError('网页进程已退出，请重新加载。');
    };
    webview.addEventListener('dom-ready', onDomReady);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('page-title-updated', onNavigate);
    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('did-fail-load', onFailLoad);
    webview.addEventListener('render-process-gone', onCrash);
    const existingGuestFrame = window.requestAnimationFrame(() => {
      try {
        if (!webview.getURL() || webview.getURL() === 'about:blank') return;
        if (!defaultUserAgentRef.current) defaultUserAgentRef.current = webview.getUserAgent();
        setReady(true);
        refreshState({ visible: true });
        applyResponsiveMode();
      } catch {
        // The first guest will report dom-ready after its initial attach.
      }
    });
    const observer = new ResizeObserver(([entry]) => {
      viewportWidthRef.current = entry.contentRect.width;
      applyResponsiveMode();
    });
    observer.observe(viewport);
    const removeAnnotation = browserBridge.onAnnotationCreated((payload: any) => {
      const currentThreadId = threadIdRef.current;
      if (!currentThreadId) return;
      setSaving(true);
      setError('');
      void (async () => {
        let evidenceAttachmentId = '';
        if (payload.evidenceDataUrl) {
          const blob = dataUrlToBlob(payload.evidenceDataUrl);
          const upload = await fetch(`/api/attachments?name=${encodeURIComponent(`browser-annotation-${Date.now()}.png`)}`, {
            method: 'POST',
            headers: { 'Content-Type': blob.type },
            body: blob,
          });
          const uploaded = await upload.json().catch(() => ({}));
          if (!upload.ok || !uploaded.attachment?.id) throw new Error(uploaded.error || '批注画面上传失败');
          evidenceAttachmentId = uploaded.attachment.id;
        }
        await requestJson(`/api/threads/${currentThreadId}/draft-context/browser`, {
          method: 'POST',
          body: JSON.stringify({ ...payload.annotation, ...(evidenceAttachmentId ? { evidenceAttachmentId } : {}) }),
        });
        draftContextChangedRef.current();
      })()
        .catch((err) => setError(err instanceof Error ? err.message : '网页批注保存失败'))
        .finally(() => setSaving(false));
    });
    const removeError = browserBridge.onError((payload: any) => setError(payload?.error || '网页操作失败。'));
    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(existingGuestFrame);
      removeAnnotation();
      removeError();
      webview.removeEventListener('dom-ready', onDomReady);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('page-title-updated', onNavigate);
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoading);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webview.removeEventListener('render-process-gone', onCrash);
      browserWebviewPool.park(wrapper);
      if (webviewRef.current === webview) webviewRef.current = null;
      setReady(false);
    };
  }, [browserBridge]);

  useEffect(() => {
    if (document.activeElement !== document.querySelector('.browser-address-input')) setAddress(browserState.url);
  }, [browserState.url]);

  useEffect(() => {
    if (!annotationMenuOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!annotationMenuRef.current?.contains(event.target as Node)) setAnnotationMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAnnotationMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [annotationMenuOpen]);

  const browserDisabled = !browserBridge || !ready || !webviewRef.current;
  const submitAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const webview = webviewRef.current;
    if (!webview || browserDisabled) return;
    try {
      const url = normalizeBrowserUrl(address);
      setError('');
      setBrowserState((current: BrowserViewState) => ({ ...current, url, loading: true }));
      void webview.loadURL(url).catch((err) => setError(err instanceof Error ? err.message : '无法打开这个地址'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开这个地址');
    }
  };
  const setAnnotationMode = (mode: BrowserAnnotationMode) => {
    const webview = webviewRef.current;
    if (!webview || browserDisabled) return;
    const nextMode = browserState.annotationMode === mode ? 'none' : mode;
    try {
      webview.send('frakio-browser:set-mode', nextMode);
      setBrowserState((current: BrowserViewState) => ({ ...current, annotationMode: nextMode }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法切换批注工具');
    }
  };
  const selectAnnotationMode = (mode: BrowserAnnotationMode) => {
    setAnnotationMode(mode);
    setAnnotationMenuOpen(false);
  };

  return (
    <div className="workbench-panel browser-panel" role="region" aria-label="浏览器">
      <header className="browser-chrome">
        <div className="browser-navigation-row">
          <button
            type="button"
            className="browser-icon-button"
            onClick={() => webviewRef.current?.goBack()}
            disabled={browserDisabled || !browserState.canGoBack}
            aria-label="后退"
            title="后退"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            onClick={() => webviewRef.current?.goForward()}
            disabled={browserDisabled || !browserState.canGoForward}
            aria-label="前进"
            title="前进"
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            onClick={() => (browserState.loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}
            disabled={browserDisabled}
            aria-label={browserState.loading ? '停止' : '刷新'}
            title={browserState.loading ? '停止' : '刷新'}
          >
            {browserState.loading ? <Square size={14} /> : <RefreshCw size={15} />}
          </button>
          <form className="browser-address-form" onSubmit={submitAddress}>
            <Globe2 size={14} aria-hidden="true" />
            <input
              className="browser-address-input"
              aria-label="网页地址"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={browserDisabled}
            />
          </form>
          <div className="browser-annotation-menu-wrap" ref={annotationMenuRef}>
            <button
              type="button"
              className={`browser-icon-button browser-annotation-menu-trigger${annotationMenuOpen ? ' active' : ''}`}
              onClick={() => setAnnotationMenuOpen((open) => !open)}
              disabled={browserDisabled}
              aria-label={saving ? '正在收录批注，打开批注工具' : '打开批注工具'}
              aria-expanded={annotationMenuOpen}
              aria-haspopup="menu"
              title={saving ? '正在收录批注' : '批注工具'}
            >
              {saving ? <LoaderCircle className="spin" size={15} /> : <MoreHorizontal size={16} />}
            </button>
            {annotationMenuOpen && (
              <div className="browser-annotation-menu" role="menu" aria-label="批注工具">
                <button
                  type="button"
                  className={browserState.annotationMode === 'element' ? 'active' : ''}
                  onClick={() => selectAnnotationMode('element')}
                  aria-pressed={browserState.annotationMode === 'element'}
                  role="menuitemcheckbox"
                >
                  <MousePointer2 size={14} />元素
                </button>
                <button
                  type="button"
                  className={browserState.annotationMode === 'region' ? 'active' : ''}
                  onClick={() => selectAnnotationMode('region')}
                  aria-pressed={browserState.annotationMode === 'region'}
                  role="menuitemcheckbox"
                >
                  <Scan size={14} />区域
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="browser-viewport" ref={viewportRef} />
      {error && <div className="browser-inline-error" role="alert">{error}</div>}
    </div>
  );
}

export function ProjectFilesPanel({ workspace }: { workspace: Workspace | null }) {
  const [entriesByDir, setEntriesByDir] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '': true });
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<WorkspaceFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setEntriesByDir({});
    setExpandedDirs({ '': true });
    setPreview(null);
    setError('');
  }, [workspace?.id]);
  useEffect(() => {
    if (workspace?.id && !entriesByDir['']) void loadDirectory('');
  }, [workspace?.id, entriesByDir]);
  async function loadDirectory(dir: string) {
    if (!workspace?.id) return;
    try {
      const data = await requestJson<{ entries: WorkspaceFileEntry[] }>(
        `/api/workspaces/${workspace.id}/files?${new URLSearchParams({ dir })}`,
      );
      setEntriesByDir((current: Record<string, WorkspaceFileEntry[]>) => ({ ...current, [dir]: data.entries || [] }));
    } catch (err: any) {
      setError(err.message || '文件读取失败');
    }
  }
  async function openPreview(relativePath: string) {
    if (!workspace?.id) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ file: WorkspaceFileContent }>(
        `/api/workspaces/${workspace.id}/files/content?${new URLSearchParams({ path: relativePath })}`,
      );
      setPreview(data.file);
    } catch (err: any) {
      setError(err.message || '文件预览失败');
    } finally {
      setLoading(false);
    }
  }
  async function toggleDirectory(entry: WorkspaceFileEntry) {
    const open = !expandedDirs[entry.relativePath];
    setExpandedDirs((current: Record<string, boolean>) => ({ ...current, [entry.relativePath]: open }));
    if (open && !entriesByDir[entry.relativePath]) await loadDirectory(entry.relativePath);
  }
  if (preview || loading) {
    return (
      <div className="workbench-panel project-files-panel">
        <header className="workbench-panel-head">
          <button type="button" onClick={() => setPreview(null)} aria-label="返回">
            <ArrowLeft size={15} />
          </button>
          <div>
            <small>{preview?.relativePath || '正在打开'}</small>
            <strong>{preview?.name || '文件预览'}</strong>
          </div>
        </header>
        {loading ? <div className="resource-empty">正在载入...</div> : preview && <FilePreview file={preview} />}
      </div>
    );
  }
  return (
    <div className="workbench-panel project-files-panel">
      <header className="workbench-panel-head">
        <div>
          <small>{workspace?.rootPath || '未绑定目录'}</small>
          <strong>项目文件</strong>
        </div>
      </header>
      <label className="resource-search">
        <Search size={14} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件" />
      </label>
      <div className="file-tree">
        {workspace ? (
          <FileTree
            dir=""
            depth={0}
            entriesByDir={entriesByDir}
            expandedDirs={expandedDirs}
            filter={search.trim()}
            onToggleDirectory={toggleDirectory}
            onOpenFile={openPreview}
          />
        ) : (
          <div className="resource-empty">当前会话未绑定项目目录</div>
        )}
      </div>
      {error && <div className="resource-error">{error}</div>}
    </div>
  );
}

export function ReviewPanel({
  thread,
  workspace,
  liveChangeSet,
  onDraftContextChanged,
}: {
  thread: Thread | null;
  workspace: Workspace | null;
  liveChangeSet: RunChangeSet | null;
  onDraftContextChanged: () => void;
}) {
  const [scope, setScope] = useState<'last-turn' | 'uncommitted'>('last-turn');
  const [changeSet, setChangeSet] = useState<RunChangeSet | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [selection, setSelection] = useState<{ side: 'old' | 'new'; line: number; hunk: string } | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setChangeSet(null);
    setSelectedPath('');
    setSelection(null);
    setError('');
    if (scope === 'uncommitted') {
      if (!workspace?.id) return;
      void requestJson<{ changeSet: RunChangeSet }>(`/api/workspaces/${workspace.id}/diff`)
        .then((data) => {
          if (active) setChangeSet(data.changeSet);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : '改动读取失败');
        });
    } else if (liveChangeSet) setChangeSet(liveChangeSet);
    else if (thread?.id)
      void requestJson<{ overview: ConversationOverview }>(`/api/threads/${thread.id}/overview`)
        .then((data) => {
          if (active) setChangeSet(data.overview.lastChangeSet);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : '上一轮改动读取失败');
        });
    return () => {
      active = false;
    };
  }, [scope, thread?.id, workspace?.id, liveChangeSet?.id, liveChangeSet?.fileCount, liveChangeSet?.additions, liveChangeSet?.deletions, liveChangeSet]);
  useEffect(() => {
    if (changeSet?.files.length && !changeSet.files.some((file: any) => file.path === selectedPath))
      setSelectedPath(changeSet.files[0].path);
  }, [changeSet, selectedPath]);
  const file = changeSet?.files.find((item: any) => item.path === selectedPath) || null;
  async function saveComment() {
    if (!thread?.id || !changeSet || !file || !selection || !comment.trim()) return;
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/threads/${thread.id}/draft-context/review`, {
        method: 'POST',
        body: JSON.stringify({
          changeSetId: changeSet.id,
          filePath: file.path,
          side: selection.side,
          line: selection.line,
          hunk: selection.hunk,
          comment: comment.trim(),
        }),
      });
      setSelection(null);
      setComment('');
      onDraftContextChanged();
    } catch (err: any) {
      setError(err.message || '审阅意见保存失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="workbench-panel review-panel">
      <header className="workbench-panel-head">
        <div>
          <small>只读审阅</small>
          <strong>改动</strong>
        </div>
        {changeSet && (
          <span className="review-total">
            <em>+{changeSet.additions}</em>
            <del>-{changeSet.deletions}</del>
          </span>
        )}
      </header>
      <div className="review-scope">
        <button className={scope === 'last-turn' ? 'active' : ''} onClick={() => setScope('last-turn')} type="button">
          上一轮
        </button>
        <button className={scope === 'uncommitted' ? 'active' : ''} onClick={() => setScope('uncommitted')} type="button">
          未提交
        </button>
      </div>
      {!changeSet && !error && <div className="resource-empty">正在读取改动...</div>}
      {changeSet && !changeSet.files.length && <div className="resource-empty">没有可审阅的改动</div>}
      {changeSet && changeSet.files.length > 0 && (
        <>
          <div className="review-file-list">
            {changeSet.files.map((item: any) => (
              <button
                className={item.path === file?.path ? 'active' : ''}
                type="button"
                key={item.path}
                onClick={() => {
                  setSelectedPath(item.path);
                  setSelection(null);
                }}
              >
                <span className={`review-status ${item.status}`}>{item.status.slice(0, 1).toUpperCase()}</span>
                <strong>{item.path}</strong>
                <em>+{item.additions}</em>
                <del>-{item.deletions}</del>
              </button>
            ))}
          </div>
          {file && (
            <div className="review-diff">
              <div className="review-diff-head">
                <FileText size={13} />
                <span>{file.path}</span>
              </div>
              {file.binary || !file.patch ? (
                <div className="resource-empty">{file.binary ? '二进制文件不支持行级审阅' : '该文件没有可显示的 Patch'}</div>
              ) : (
                <React.Suspense fallback={<div className="resource-empty">正在渲染 Diff...</div>}>
                  <LazyPatchDiff
                    patch={file.patch}
                    disableWorkerPool
                    options={{
                      diffStyle: 'unified',
                      themeType: 'system',
                      lineHoverHighlight: 'both',
                      onLineNumberClick: (value: any) => {
                        const line = Number(value.lineNumber || 1);
                        const hunk = file.patch?.split('\n').find((part: string) => part.startsWith('@@')) || '';
                        setSelection({ side: value.annotationSide === 'deletions' ? 'old' : 'new', line, hunk });
                      },
                    }}
                  />
                </React.Suspense>
              )}
            </div>
          )}
        </>
      )}
      {selection && file && (
        <div className="review-comment-box">
          <span>{file.path}:{selection.line}</span>
          <textarea autoFocus rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="添加修改意见" />
          <div>
            <button type="button" onClick={() => { setSelection(null); setComment(''); }}>取消</button>
            <button type="button" disabled={!comment.trim() || saving} onClick={() => void saveComment()}>{saving ? '正在保存' : '添加意见'}</button>
          </div>
        </div>
      )}
      {error && <div className="resource-error">{error}</div>}
    </div>
  );
}

export function CodexResourcePanel({
  contextPacket,
  proposals,
  workspaceArtifacts,
  thread,
  workspace,
  isRunning,
  runApproval,
  runClarification,
  runError,
  runDraft,
}: ContextPanelProps) {
  const [fileEntriesByDir, setFileEntriesByDir] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '': true });
  const [fileSearch, setFileSearch] = useState('');
  const [preview, setPreview] = useState<WorkspaceFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const workflowState = visibleWorkflowSteps(thread, { isRunning, runApproval, runClarification, runError, runDraft });
  const shouldShowTasks = workflowState.length > 0;
  const threadArtifacts: WorkArtifact[] = [
    ...(thread?.artifacts || []),
    ...proposals.slice(0, 4).map((proposal) => ({
      id: proposal.id,
      kind: proposal.type,
      name: proposal.title,
      target: proposal.target,
      updatedAt: thread?.updatedAt,
    })),
    ...(contextPacket
      ? [{ id: 'context-packet', kind: 'context', name: contextPacket.title || '上下文包', target: contextPacket.policy, updatedAt: thread?.updatedAt }]
      : []),
  ];
  const artifacts: WorkArtifact[] = [
    ...threadArtifacts,
    ...workspaceArtifacts.map((artifact) => ({ ...artifact, target: artifact.relativePath || artifact.path || artifact.target })),
  ]
    .filter(
      (artifact, index, all) =>
        all.findIndex(
          (item) =>
            `${item.kind}:${item.name}:${item.target || ''}` === `${artifact.kind}:${artifact.name}:${artifact.target || ''}`,
        ) === index,
    )
    .slice(0, 10);

  useEffect(() => {
    setPreview(null);
    setFileEntriesByDir({});
    setExpandedDirs({ '': true });
    setFileError('');
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace?.id || fileEntriesByDir['']) return;
    void loadDirectory('');
  }, [workspace?.id, fileEntriesByDir]);

  async function loadDirectory(dir: string) {
    if (!workspace?.id) return;
    setFileError('');
    const query = new URLSearchParams({ dir });
    const data = await fetch(`/api/workspaces/${workspace.id}/files?${query.toString()}`).then((res) => res.json());
    if (data.error) {
      setFileError(data.error);
      return;
    }
    setFileEntriesByDir((current) => ({ ...current, [dir]: data.entries || [] }));
  }

  async function openPreview(relativePath: string) {
    if (!workspace?.id || !relativePath) return;
    setPreviewLoading(true);
    setFileError('');
    const query = new URLSearchParams({ path: relativePath });
    const data = await fetch(`/api/workspaces/${workspace.id}/files/content?${query.toString()}`)
      .then((res) => res.json())
      .catch((err) => ({ error: String(err) }));
    setPreviewLoading(false);
    if (data.error) {
      setFileError(data.error);
      return;
    }
    setPreview(data.file || null);
  }

  async function toggleDirectory(entry: WorkspaceFileEntry) {
    const nextOpen = !expandedDirs[entry.relativePath];
    setExpandedDirs((current) => ({ ...current, [entry.relativePath]: nextOpen }));
    if (nextOpen && !fileEntriesByDir[entry.relativePath]) await loadDirectory(entry.relativePath);
  }

  const sourceDocs = [
    ...(contextPacket?.vault.activeRules || []),
    ...(contextPacket?.vault.products || []).map((product) => `产品：${product}`),
  ].slice(0, 6);

  if (preview || previewLoading) {
    return (
      <div className="context-inner resource-panel">
        <div className="resource-preview-head">
          <button className="top-icon-btn" onClick={() => setPreview(null)} aria-label="返回资源列表" title="返回">
            <ArrowLeft size={17} />
          </button>
          <div>
            <strong>{preview?.name || '正在打开'}</strong>
            <span>{preview?.relativePath || '加载文件内容'}</span>
          </div>
          <button className="top-icon-btn" aria-label="打开外部文件" title="打开外部文件">
            <ExternalLink size={16} />
          </button>
        </div>
        {previewLoading ? (
          <div className="resource-empty">正在载入预览...</div>
        ) : preview ? (
          <FilePreview file={preview} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="context-inner resource-panel">
      <section className="resource-section">
        <div className="panel-title">
          <span><FileText size={15} />输出</span>
        </div>
        <div className="artifact-list">
          {artifacts.length ? (
            artifacts.map((artifact, index) => {
              const Icon = artifactIcon(artifact.kind);
              const previewPath = artifact.relativePath || artifact.target || '';
              return (
                <button
                  className="artifact-row"
                  key={`${artifact.name}-${index}`}
                  aria-label={artifact.target || artifact.relativePath || artifact.path || artifact.name}
                  title={artifact.target || artifact.relativePath || artifact.path || artifact.name}
                  onClick={() => void openPreview(previewPath)}
                >
                  <Icon size={15} />
                  <span>
                    <strong>{artifact.name}</strong>
                    <small>{artifact.target || artifact.relativePath || artifact.path || '当前线程'}</small>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="resource-empty">暂无产物</div>
          )}
        </div>
      </section>

      {shouldShowTasks && (
        <section className="resource-section">
          <div className="panel-title">
            <span><PauseCircle size={15} />任务</span>
          </div>
          <div className="task-list">
            {workflowState.map((item, index) => {
              const done = item.status === 'completed';
              const active = item.status === 'running';
              const failed = item.status === 'failed';
              const Icon = done ? CheckCircle2 : active ? Clock3 : Circle;
              return (
                <div
                  className={`task-row ${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''}`}
                  key={`${item.title}-${index}`}
                >
                  <Icon size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="resource-section">
        <div className="panel-title">
          <span><FolderOpen size={15} />文件</span>
        </div>
        <label className="resource-search">
          <Search size={15} />
          <input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder="筛选文件..." />
        </label>
        <div className="file-tree">
          {workspace ? (
            <FileTree
              dir=""
              depth={0}
              entriesByDir={fileEntriesByDir}
              expandedDirs={expandedDirs}
              filter={fileSearch.trim()}
              onToggleDirectory={toggleDirectory}
              onOpenFile={openPreview}
            />
          ) : (
            <div className="resource-empty">当前对话未绑定项目目录</div>
          )}
        </div>
        {fileError && <div className="resource-error">{fileError}</div>}
      </section>

      {sourceDocs.length > 0 && (
        <section className="resource-section">
          <div className="panel-title">
            <span><Library size={15} />来源</span>
          </div>
          <div className="source-list">
            {sourceDocs.map((doc) => (
              <span key={doc}>{doc}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ThreadOverviewRail({
  rounds,
  onJumpToRound,
}: {
  rounds: ThreadOverviewRound[];
  activeRoundId: string;
  onJumpToRound: (roundId: string) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  if (!rounds.length) return null;
  const previewRound = hoveredIndex >= 0 ? rounds[hoveredIndex] || rounds[0] : null;

  return (
    <div
      className={`thread-overview-rail ${hoveredIndex >= 0 ? 'is-hovering' : ''}`}
      aria-label="对话概览"
      onMouseLeave={() => setHoveredIndex(-1)}
    >
      <div className="thread-overview-marks">
        {rounds.map((round, index) => {
          const distance = hoveredIndex >= 0 ? Math.abs(index - hoveredIndex) : Number.POSITIVE_INFINITY;
          const waveLevel = distance <= 3 ? 3 - distance : -1;
          return (
            <button
              className="thread-overview-mark"
              data-wave-level={waveLevel >= 0 ? waveLevel : undefined}
              key={round.id}
              type="button"
              aria-label={`跳转到第 ${index + 1} 段对话，${round.title}`}
              title={round.title}
              onBlur={() => setHoveredIndex(-1)}
              onClick={() => onJumpToRound(round.id)}
              onFocus={() => setHoveredIndex(index)}
              onMouseEnter={() => setHoveredIndex(index)}
            />
          );
        })}
      </div>
      {previewRound && (
        <button className="thread-overview-preview" type="button" onClick={() => onJumpToRound(previewRound.id)}>
          <strong>{previewRound.title}</strong>
          <span>{previewRound.summary}</span>
          {previewRound.agentNames.length > 0 && <small>{previewRound.agentNames.join(' · ')}</small>}
        </button>
      )}
    </div>
  );
}

export function buildThreadOverviewRounds(messages: ChatEvent[]): ThreadOverviewRound[] {
  const rounds: ThreadOverviewRound[] = [];
  let current: ThreadOverviewRound | null = null;
  const finishCurrent = () => {
    if (!current) return;
    current.summary = current.summary || current.title;
    current.agentNames = Array.from(new Set(current.agentNames)).slice(0, 3);
    rounds.push(current);
    current = null;
  };

  messages.forEach((message) => {
    const content = compactOverviewSnippet(message.content, 120);
    if (message.agentId === 'user' || !current) {
      if (message.agentId === 'user') finishCurrent();
      current = {
        id: `round-${rounds.length}-${message.id}`,
        startMessageId: message.id,
        title: message.agentId === 'user' ? compactOverviewTitle(message.content) : message.agentName || 'Agent 回复',
        summary: message.agentId === 'user' ? '' : content,
        messageIds: [message.id],
        agentNames: message.agentId === 'user' ? [] : [message.agentName || 'Agent'],
      };
      return;
    }
    current.messageIds.push(message.id);
    if (message.agentName) current.agentNames.push(message.agentName);
    current.summary = [current.summary, content].filter(Boolean).join(' ');
  });

  finishCurrent();
  return rounds;
}

export function compactOverviewTitle(content: string) {
  const normalized = normalizeOverviewText(content);
  if (!normalized) return '新的问题';
  const sentence = normalized.split(/(?<=[。！？!?])\s*/)[0] || normalized;
  return sentence.length > 38 ? `${sentence.slice(0, 38)}...` : sentence;
}

export function compactOverviewSnippet(content: string, maxLength = 86) {
  const normalized = normalizeOverviewText(content);
  if (!normalized) return '空消息';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function normalizeOverviewText(content: string) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' 代码片段 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function FileTree({
  dir,
  depth,
  entriesByDir,
  expandedDirs,
  filter,
  onToggleDirectory,
  onOpenFile,
}: {
  dir: string;
  depth: number;
  entriesByDir: Record<string, WorkspaceFileEntry[]>;
  expandedDirs: Record<string, boolean>;
  filter: string;
  onToggleDirectory: (entry: WorkspaceFileEntry) => Promise<void>;
  onOpenFile: (relativePath: string) => Promise<void>;
}) {
  const entries = entriesByDir[dir] || [];
  if (!entries.length && dir === '') return <div className="resource-empty">暂无文件</div>;
  const normalizedFilter = filter.toLowerCase();
  return (
    <>
      {entries
        .filter(
          (entry) =>
            !normalizedFilter ||
            entry.name.toLowerCase().includes(normalizedFilter) ||
            entry.relativePath.toLowerCase().includes(normalizedFilter),
        )
        .map((entry) => {
          const expanded = Boolean(expandedDirs[entry.relativePath]);
          const Icon = entry.kind === 'directory' ? Folder : iconForFileName(entry.name);
          return (
            <div className="file-tree-node" key={entry.relativePath}>
              <button
                className="file-tree-row"
                aria-label={entry.relativePath || entry.name}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => (entry.kind === 'directory' ? void onToggleDirectory(entry) : void onOpenFile(entry.relativePath))}
                disabled={entry.kind === 'file' && !entry.previewable}
              >
                {entry.kind === 'directory' ? <ChevronRight className={expanded ? 'expanded' : ''} size={14} /> : <span className="file-indent" />}
                <Icon size={15} />
                <span>{entry.name}</span>
              </button>
              {entry.kind === 'directory' && expanded && (
                <FileTree
                  dir={entry.relativePath}
                  depth={depth + 1}
                  entriesByDir={entriesByDir}
                  expandedDirs={expandedDirs}
                  filter={filter}
                  onToggleDirectory={onToggleDirectory}
                  onOpenFile={onOpenFile}
                />
              )}
            </div>
          );
        })}
    </>
  );
}

export function FilePreview({ file }: { file: WorkspaceFileContent }) {
  if (file.mimeKind === 'markdown' || file.mimeKind === 'text') {
    return (
      <article className="file-preview markdown-preview">
        <pre>{file.content || ''}</pre>
        {file.truncated && <div className="resource-empty">文件超过 1MB，已截断预览。</div>}
      </article>
    );
  }
  if (file.mimeKind === 'json' || file.mimeKind === 'code') {
    return (
      <article className="file-preview code-preview">
        <pre>{file.content || ''}</pre>
        {file.truncated && <div className="resource-empty">文件超过 1MB，已截断预览。</div>}
      </article>
    );
  }
  return (
    <div className="file-preview unsupported-preview">
      <FileText size={28} />
      <strong>{file.name}</strong>
      <span>{formatFileSize(file.size)} · {file.mimeKind === 'pdf' ? 'PDF' : file.mimeKind === 'image' ? '图片' : '二进制文件'}</span>
      <p>暂不内嵌预览。</p>
    </div>
  );
}

export function artifactIcon(kind: string) {
  if (kind === 'context') return Library;
  if (kind === 'plan' || kind === 'document' || kind === 'report') return FileText;
  if (kind === 'data') return Boxes;
  if (kind === 'script') return Settings;
  if (kind === 'pdf') return FileText;
  return CheckCircle2;
}

export function ConversationExternalControls({
  thread,
  vaults,
  personalVaultId,
  overviewOpen,
  onOverview,
  onUpdate,
  onOpenSources,
  onOpenReview,
}: {
  thread: Thread;
  vaults: Vault[];
  personalVaultId: string | null;
  overviewOpen: boolean;
  onOverview: () => void;
  onUpdate: (patch: { vaultId?: string | null; personalKnowledgeMode?: 'inherit' | 'on' | 'off' }) => Promise<void>;
  onOpenSources: () => void;
  onOpenReview: () => void;
}) {
  const personal = vaults.find((vault) => vault.id === personalVaultId) || null;
  const project = vaults.find((vault) => vault.id === thread.vaultId) || null;
  const context = thread.context;
  const enabled = context?.personal.enabled !== false;
  const label =
    context?.label ||
    [enabled ? personal?.name || '个人资料库' : '', project?.name || ''].filter(Boolean).join(' + ') ||
    '仅 Frakio Memory 与身份上下文';
  const nextPersonalMode = enabled ? 'off' : 'on';
  return (
    <div className="conversation-external-controls" aria-label="会话上下文控制">
      <button
        className={overviewOpen ? 'desktop-window-control conversation-external-icon active' : 'desktop-window-control conversation-external-icon'}
        type="button"
        onClick={onOverview}
        aria-label="会话摘要"
        title="会话摘要"
      >
        <Library size={16} />
      </button>
      <AppMenu modal={false}>
        <AppMenuTrigger asChild>
          <button
            className="desktop-window-control conversation-external-icon vault-switcher-trigger"
            type="button"
            aria-label="资料库上下文"
            title={`资料库：${label}`}
          >
            <span className="vault-switcher-icon">
              {personal?.avatarUrl ? <img src={personal.avatarUrl} alt="" /> : <BookOpenText size={16} />}
            </span>
          </button>
        </AppMenuTrigger>
        <AppMenuContent className="vault-switcher-menu conversation-library-menu" side="bottom" align="end" aria-label="资料库上下文">
          <div className="runtime-switcher-summary">
            资料库上下文<small>{label}</small>
          </div>
          <div className="context-library-personal">
            <span className={enabled ? 'context-status-dot on' : 'context-status-dot'} />
            {personal?.avatarUrl ? <img className="vault-switcher-menu-avatar" src={personal.avatarUrl} alt="" /> : <BookOpenText size={15} />}
            <span>
              <strong>{personal?.name || '个人资料库'}</strong>
              <small>{context?.personal.label || '个人资料库已启用'}</small>
            </span>
            <button
              type="button"
              className={enabled ? 'context-toggle on' : 'context-toggle'}
              onClick={() => void onUpdate({ personalKnowledgeMode: nextPersonalMode })}
              aria-label={enabled ? '关闭个人资料库' : '开启个人资料库'}
            >
              {enabled ? '开' : '关'}
            </button>
          </div>
          {!enabled && <p className="context-library-note">仅关闭个人 Markdown 文档检索；用户画像、Agent Soul 与 Frakio Memory 仍会保留。</p>}
          <div className="context-library-heading">项目资料库</div>
          <AppMenuItem className={!thread.vaultId ? 'selected' : ''} onSelect={() => void onUpdate({ vaultId: null })}>
            <Minus size={15} />
            <span>未挂载项目资料库</span>
            {!thread.vaultId && <Check size={14} />}
          </AppMenuItem>
          {vaults
            .filter((vault) => vault.kind === 'project')
            .map((vault) => (
              <AppMenuItem
                key={vault.id}
                className={thread.vaultId === vault.id ? 'selected' : ''}
                onSelect={() => void onUpdate({ vaultId: vault.id })}
              >
                {vault.avatarUrl ? <img className="vault-switcher-menu-avatar" src={vault.avatarUrl} alt="" /> : <BookOpenText size={15} />}
                <span>{vault.name}</span>
                {thread.vaultId === vault.id && <Check size={14} />}
              </AppMenuItem>
            ))}
          <button className="context-library-sources" type="button" onClick={onOpenSources}>
            查看本轮实际注入来源 <ChevronRight size={13} />
          </button>
        </AppMenuContent>
      </AppMenu>
      {overviewOpen && (
        <ConversationOverviewPopover
          threadId={thread.id}
          onClose={onOverview}
          onOpenSources={onOpenSources}
          onOpenReview={onOpenReview}
        />
      )}
    </div>
  );
}
// wjz新建文件结束。
