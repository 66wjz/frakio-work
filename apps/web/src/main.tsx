import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  AppUpdateStatus,
  Attachment,
  BrowserAnnotation,
  CollaborationMode,
  ConversationOverview,
  HermesAgentTurn,
  HermesNetworkStatus,
  MessageContext,
  PlanDraft,
  PlanQuestionBatch,
  PlanSession,
  ReviewComment,
  RunActivityGroup,
  RunActivityItem,
  RunChangeSet,
  RunTranscript,
} from '@frakio/contracts';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { RichMarkdown } from './rich-content/RichMarkdown';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  DEFAULT_MAC_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAC_SIDEBAR_WIDTH_BOUNDS,
  SIDEBAR_WIDTH_BOUNDS,
  SIDEBAR_WIDTH_VERSION,
} from '../../api/lib/sidebar-width.mjs';
import { availablePaneMax, createLatestFrameScheduler, normalizePaneWidth, paneWidthFromKey, paneWidthFromPointer } from './pane-resize.mjs';
import { browserWebviewPool, normalizeBrowserUrl, type BrowserGuest } from './browser-webview-pool';
import {
  activityElapsedMs,
  activityGroupPreview,
  formatActivityDuration,
  formatRunElapsed,
  nextActivityExpanded,
  nextRunPresentationPhase,
  processingMessageAt,
  shouldShowRunPresence,
} from './run-presence.mjs';
import type { RunPresentationPhase } from './run-presence.mjs';
import { activityTimelineEntries, buildRunActivityTimeline } from './run-activity-timeline.mjs';
import { publishThreadCollaborationSnapshot, refreshThreadCollaboration, useThreadCollaboration } from './collaboration-store';
import { contrastForegroundForTint, workspaceTintAlpha } from './theme-contrast.mjs';
import { buildProfileActivity } from './profile-activity.mjs';
import type { ProfileActivityCell, ProfileActivityMode } from './profile-activity.mjs';
import {
  canApplyPresentation,
  canApplyRunSnapshot,
  canApplyRuntimeCursor,
  dedupeThreadMessages,
  mergeThreadWithPendingMessages,
  normalizeApprovalPresentation,
  normalizeClarificationPresentation,
  resolveRunEventIdentity,
  shouldApplyRuntimeEvent,
} from './run-ui-state.mjs';
import {
  STREAM_REVEAL_ANIMATION_MS,
  STREAM_REVEAL_MAX_LAG_MS,
  STREAM_REVEAL_MIN_COMMIT_MS,
  streamRevealTransition,
} from './stream-reveal.mjs';
import {
  SettingsField,
  SettingsInlineNote,
  SettingsPanel,
  SettingsRow,
  SettingsSwitch,
  SettingsToggleRow,
} from './settings-ui';
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
  AppPopover,
  AppPopoverContent,
  AppPopoverTrigger,
} from './overlay-primitives';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  ArrowUpRight,
  Archive,
  Bell,
  Bot,
  BookOpenText,
  Boxes,
  Brain,
  Briefcase,
  Building2,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  GitCompareArrows,
  Globe2,
  Hand,
  Image,
  Library,
  Link2,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  MoreHorizontal,
  Minus,
  MousePointer2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightOpen,
  Palette,
  Pencil,
  Pin,
  Pause,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Scan,
  Send,
  ShieldAlert,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Moon,
  Trash2,
  TriangleAlert,
  ThumbsDown,
  ThumbsUp,
  UserCircle,
  UserPlus,
  UsersRound,
  X,
  Zap as ZapIcon,
} from 'lucide-react';
import frakioBrandLogoUrl from './assets/frakio-brand-logo.png';
import launchDinoUrl from './assets/launch-dino.png';
import hermesRuntimeLogoUrl from './assets/runtime-logos/hermes.svg';
import piRuntimeLogoUrl from './assets/runtime-logos/pi.svg';
import codexRuntimeLogoUrl from './assets/runtime-logos/codex.svg';
import claudeRuntimeLogoUrl from './assets/runtime-logos/claude.svg';
import { installLocalApiFetchGuard } from './api/fetch-guard';
import {
  LaunchLoadingScreen,
  type LaunchInstallJob,
  type LaunchIssue,
  type LaunchPhase,
} from './features/launch/LaunchLoadingScreen';
import '@fontsource/doto/latin-400.css';
import '@fontsource/doto/latin-600.css';
import '@fontsource/doto/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import './styles.css';
import './settings.css';

installLocalApiFetchGuard();

const LazyPatchDiff = React.lazy(() => import('@pierre/diffs/react').then((module) => ({ default: module.PatchDiff })));

declare global {
  interface Window {
    frakioDesktop?: {
      platform?: string;
      restartService?: () => Promise<unknown>;
      openLogs?: () => Promise<unknown>;
      getLoginStartup?: () => Promise<unknown>;
      setLoginStartup?: (enabled: boolean) => Promise<unknown>;
      getAppearance?: () => Promise<{ source?: AppAppearance; dark?: boolean }>;
      setAppearance?: (appearance: AppAppearance) => Promise<{ source?: AppAppearance; dark?: boolean }>;
      onAppearanceChanged?: (listener: (state: { source?: AppAppearance; dark?: boolean }) => void) => () => void;
      selectFolder?: () => Promise<{ canceled?: boolean; path?: string; filePaths?: string[] }>;
      windowControl?: (action: 'close' | 'minimize' | 'zoom') => Promise<unknown>;
      showItemInFolder?: (targetPath: string) => Promise<unknown>;
      openObsidianVault?: (targetPath: string) => Promise<{ ok?: boolean }>;
      openRelease?: (targetUrl: string) => Promise<{ ok?: boolean }>;
      openExternal?: (targetUrl: string) => Promise<{ ok?: boolean }>;
      getUpdateState?: () => Promise<DesktopUpdateState>;
      checkForUpdates?: () => Promise<DesktopUpdateState>;
      downloadUpdate?: () => Promise<DesktopUpdateState>;
      cancelUpdateDownload?: () => Promise<DesktopUpdateState>;
      openDownloadedUpdate?: () => Promise<DesktopUpdateState>;
      onUpdateStateChanged?: (listener: (state: DesktopUpdateState) => void) => () => void;
      browser?: {
        onAnnotationCreated: (listener: (value: { annotation: Omit<BrowserAnnotation, 'id' | 'threadId' | 'createdAt'>; evidenceDataUrl?: string }) => void) => () => void;
        onError: (listener: (value: { error?: string }) => void) => () => void;
      };
    };
  }
}

// wjz修改开始，修改原因：解耦 main.tsx 中的基础类型定义、纯工具函数与内核标签组件，修改时间：2026-08-17。
// 具体修改内容：将 1000 行类型契约和辅助函数迁移至 types/workbench、utils/workbench-helpers 与 components/layout/。
import type {
  ActiveHermesRun,
  ActiveRunsResponse,
  Agent,
  AgentModelOverrides,
  AgentRuntimeOverrides,
  AgentRuntimePolicy,
  AgentRunOverride,
  AgentRunOverrides,
  AnalysisTab,
  AppAppearance,
  AppLaunchPhase,
  AttachmentDraft,
  AuxiliaryModelSettings,
  AuxiliaryModelTask,
  AuxiliaryModelsConfig,
  BrowserAnnotationMode,
  BrowserViewState,
  CapabilityProbeResult,
  CatalogInfo,
  ChatEvent,
  ChatRunTarget,
  CollaborationEvent,
  CollaborationPlan,
  CollaborationPlanTask,
  CollaborationProposal,
  CollaborationRunStatus,
  CollaborationSnapshot,
  CollaborationTask,
  CollaborationTaskActivity,
  CollaborationTaskDetail,
  CollaborationTaskStatus,
  CollaborationWorkflow,
  CollaborationWorkflowControl,
  CollaborationWorkflowSnapshot,
  ContextPacket,
  ConversationContext,
  CuratorInfo,
  DesktopUpdatePhase,
  DesktopUpdateState,
  DonutMetricRow,
  FastMode,
  FetchAvailableModels,
  FollowMode,
  HarnessId,
  HermesApiAvailability,
  HermesApprovalChoice,
  HermesBackup,
  HermesBootstrapStatus,
  HermesConfig,
  HermesGatewayRepair,
  HermesJob,
  HermesLocalStatus,
  HermesOfficialRelease,
  HermesProfile,
  HermesProviderSummary,
  HermesRunApproval,
  HermesRunClarification,
  HermesRuntimeDiagnostics,
  HermesRuntimeInfo,
  HermesRuntimeManager,
  HermesRuntimeStatus,
  InboxItem,
  KanbanBoard,
  KanbanTask,
  KanbanTaskStatus,
  KnowledgeIssue,
  KnowledgeJob,
  KnowledgeOperation,
  KnowledgeSource,
  LaunchMaterialSnapshot,
  ManagedHermesModule,
  ManagedHermesModuleKind,
  ManagedHermesModulesPayload,
  McpFormState,
  McpServer,
  McpServersPayload,
  MemoryLedgerEntry,
  MemoryReviewConfig,
  MentionOption,
  ModelCapability,
  ModelCapabilityOverride,
  ModelCompat,
  ModelFetchContext,
  ModelFetchResult,
  ModelKind,
  ModelMetricRow,
  ModelPayload,
  ModelPricing,
  ModelProfile,
  ModelProtocol,
  ModelRunDiagnostic,
  ModelUsageRow,
  ModuleUsageRow,
  MonitoringLog,
  MonitoringSummary,
  OAuthAccount,
  OAuthProviderState,
  PermissionMode,
  PiRuntimePackageStatus,
  PinnedNav,
  ProfileEditableKind,
  ProfileEditorControls,
  ProfileInspectorState,
  ProfileInspectorTarget,
  ProfileModuleEntry,
  ProfileModuleUsage,
  Proposal,
  ProviderApiMode,
  ProviderApiModePreference,
  ProviderAuthType,
  ProviderPreset,
  RailConfirm,
  RailContextMenuRect,
  RailContextMenuSource,
  RailContextMenuTarget,
  RenameDialogTarget,
  RightRailTab,
  RollbackScopes,
  RunPresentationSnapshot,
  RunPresentationUi,
  RunUiState,
  RuntimeDefinition,
  RuntimeDiscoveryCandidate,
  RuntimeId,
  RuntimeModelCatalog,
  RuntimeModelCatalogEntry,
  RuntimeModelCompatibility,
  RuntimePackageBinding,
  RuntimePackageRecord,
  RuntimeSessionSummary,
  SaveModel,
  ServiceTier,
  Space,
  SpaceDraft,
  SpaceGradientColor,
  SpaceIconKind,
  SpaceTheme,
  SpaceThemeAppearance,
  SpaceThemeColorMode,
  SpaceThemePalette,
  TelemetryStatus,
  ThemeHarmony,
  ThemePreset,
  Thread,
  ThreadCollaboration,
  ThreadMode,
  ThreadRunState,
  ThreadRunStateResponse,
  ThreadSummary,
  UpdateActionResult,
  UpdateBusy,
  UpdateModuleStatus,
  UpdatesStatus,
  UsageDay,
  UsageEntry,
  UsageProfile,
  UsageRangeMode,
  UsageSource,
  UsageTrendPoint,
  UserProfile,
  UserProfileAgentUsage,
  UserProfileModuleUsage,
  UserProfileSummary,
  Vault,
  VaultDetail,
  VaultDoc,
  VaultSummary,
  WorkArtifact,
  WorkMessageArtifact,
  WorkbenchUiSettings,
  WorkflowStep,
  Workspace,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from './types/workbench';

import {
  attachmentAcceptValue,
  compatibilityRelayProviderKeys,
  createRunPresentation,
  createRunUiState,
  effectiveRuntimeForAgentUi,
  harnessChoices,
  isRuntimeReady,
  mergeRunActivityEvent,
  mergeRuntimeDefinitions,
  openExternalUrl,
  readThreadDraft,
  rightRailTabMeta,
  rightRailTabs,
  runtimeLabels,
  runtimeSeed,
  runtimeVisuals,
  threadDraftStorageKey,
  writeThreadDraft,
  kanbanStatusLabels,
  kanbanStatusOrder,
  collaborationStatusLabel,
  collaborationWorkflowStatusLabel,
  isVisibleChatMessage,
  formatHermesRuntimeError,
  resolveRunTarget,
  pruneAgentModelOverrides,
  workspaceDirectoryPreview,
} from './utils/workbench-helpers';

import { RuntimeLabel } from './components/layout/RuntimeLabel';
import { RightRailTabIcon } from './components/layout/RightRailTabIcon';
import { HarnessChoiceGrid } from './components/layout/HarnessChoiceGrid';
import { requestJson } from './utils/api-client';
import { formatTime, formatFileSize, formatCompactNumber, formatFullNumber, formatWanNumber, formatChineseApproxNumber, formatUsd, formatDuration, clampNumber } from './utils/formatters';
import { modelNamesForProvider, modelChoiceValue, splitModelChoiceValue, resolveModelChoice, modelValueForAgent, agentDefaultModelLabel, agentSessionModelLabel, modelForAgent, hermesProfileModels, resolveHermesProfileNameForAgent, modelValueForHermesProfile, profileModelLabel } from './utils/model-helpers';
import {
  defaultProductSpaceTheme,
  zenPresetPositions,
  zenPoint,
  zenPresetPage,
  themePresets,
  themePresetPages,
  spaceEmojiOptions,
  spaceIconOptions,
  spaceIconLabels,
  hslToHex,
  colorFromThemePoint,
  mixHexWithColor,
  mixHexWithWhite,
  hexLuminance,
  hexToRgb,
  normalizeGradientColors,
  primaryGradientColor,
  normalizeSpaceThemePalette,
  deriveDarkThemePalette,
  normalizeSpaceTheme,
  isThemeNightTime,
  resolveEffectiveSpaceTheme,
  resolveSpaceThemeForAppearance,
  withDraftThemePalette,
  syncThemeFromGradientColors,
  updateSpaceThemeColorPoint,
  promoteGradientColor,
  buildSpaceThemeFromPoint,
  clampThemePointToSquare,
  calculateHarmonyColors,
  buildPresetGradientColors,
  themeOpacityProgress,
  opacityProgress,
  isNeutralProductTheme,
  themeGradientBase,
  softenThemeGradientColor,
  themeZenGradientBackground,
  themeGradientBackground,
  themeStageBackground,
  themeShellBackground,
  macThemeBackground,
  spaceRailContrastTokens,
  themeRailBackground,
  textureSurfaceVars,
  spaceIconKind,
  wavePathForOpacity,
  textureStepDots,
  textureHandleStyle,
} from './utils/theme-helpers';
import {
  HermesModulesPage,
  HermesModuleMatrix,
  PluginsPage,
  aggregatePlugins,
  moduleEntryName,
  moduleEntryDescription,
  moduleEntryCategory,
  moduleEntryEnabled,
  moduleEntryStatus,
  moduleEntryStatusLabel,
  moduleEntrySource,
  moduleEntryUsage,
  profileColor,
} from './components/settings/HermesModulesPage';
import {
  ModelConfigPage,
  ModelCenter,
  ModelEditorModal,
  OAuthAccountsPanel,
  AuxiliaryModelsPanel,
  MemoryReviewModelSettings,
  useModelSlotGroups,
  ModelIdCombobox,
  ProviderPresetCombobox,
  ProviderAuthModal,
  modelKindLabel,
  modelAuthorizationLabel,
  modelPricingSummary,
  pricingSourceLabel,
} from './components/settings/ModelCenter';
import { MarkdownMessage, trimMessageStart } from './components/chat/MarkdownMessage';
import { SettingsStatusValue } from './components/settings/SettingsStatusValue';
import { KnowledgeVaultsPage, KnowledgeFileTree } from './components/settings/KnowledgeVaultsPage';
import { SystemStatusPage } from './components/settings/SystemStatusPage';
import { ToolCapabilitiesPage } from './components/settings/ToolCapabilitiesPage';

import { MonitoringPage, modelRunReasoningLabel } from './components/settings/MonitoringPage';
import {
  PermissionModeControl,
  CollaborationIntentControl,
  CollaborationIntentIndicator,
  ComposerAddMenu,
  PlanModeIndicator,
  DecisionTray,
  DecisionPager,
  DecisionOptionRow,
  DecisionOtherRow,
  PlanQuestionPanel,
  CollaborationSuggestionCard,
  PlanCard,
  permissionLabel,
  permissionDescription,
  permissionTone,
  permissionIcon,
  iconForFileName,
  isLegacyDefaultWorkflow,
  visibleWorkflowSteps,
} from './components/collaboration/PlanAndDecisionPanels';
import { calculateProviderModelMenuPlacement, ProviderModelPicker } from './components/chat/ProviderModelPicker';
import {
  RuntimeSwitcher,
  ThreadActionsMenu,
} from './components/layout/HeaderControls';
import {
  RailScrollingTitle,
  ThreadRailContent,
  RenameDialog,
  RailContextMenu,
  RailConfirmDialog,
} from './components/layout/RailNavigationViews';
import {
  MessageAvatar,
  AgentMessageAvatar,
  isBrowserPreviewableImage,
  isInlineAttachmentImage,
  attachmentKindLabel,
  AttachmentTray,
  MessageAttachments,
  WorkMessageArtifacts,
  MessageImageAttachment,
  ImageLightbox,
  MessageActions,
} from './components/chat/ChatMessageViews';
import { MentionTextarea } from './components/chat/MentionTextarea';
import {
  MessageAgentSessionConfig,
  AgentSessionModelModal,
  AgentEditorModal,
  AgentFields,
  SpaceIconGlyph,
} from './components/chat/AgentSessionModals';
import {
  RichContentQaPage,
  StreamRevealQaPage,
} from './components/qa/QaPages';
import {
  ManagedWebAuthGate,
  FirstManagedPasswordChange,
} from './components/auth/ManagedWebAuthGate';
import { ResizeHandle } from './components/layout/ResizeHandle';
import {
  readLaunchUserAvatarSnapshot,
  writeLaunchUserAvatarSnapshot,
  readLaunchMaterialSnapshot,
  writeLaunchMaterialSnapshot,
  launchUserAvatarSnapshotKey,
  launchMaterialSnapshotKey,
} from './features/launch/launch-storage';

import { IconTooltipButton } from './components/common/IconTooltipButton';
import {
  ChatCollaborationEvents,
  CollaborationActivityList,
  type CollaborationCardLifecycle,
  CollaborationRuntimeErrorCard,
  CollaborationSummaryCard,
  CollaborationTaskSessionPanel,
  CollaborationTaskSquare,
  CollaborationTaskStatusLabel,
  InlineCollaborationBlock,
  collaborationActivityCopy,
  collaborationCardLifecycle,
  collaborationEventLabel,
  collaborationLifecycleLabel,
  compactCollaborationLabel,
  useCollaborationCompletionCelebrations,
} from './components/collaboration/CollaborationCards';
import {
  BrowserPanel,
  CodexResourcePanel,
  CollaborationContextPanel,
  ConversationExternalControls,
  ConversationOverviewPopover,
  DraftContextTray,
  FilePreview,
  FileTree,
  MessageContextSummary,
  ProjectFilesPanel,
  ReviewPanel,
  RightRailLauncher,
  SourcesPanel,
  ThreadOverviewRail,
  artifactIcon,
  buildThreadOverviewRounds,
  compactOverviewSnippet,
  compactOverviewTitle,
  dataUrlToBlob,
  normalizeOverviewText,
  type ContextPanelProps,
  type ThreadOverviewRound,
} from './components/right-rail/RightRailPanels';
import {
  ChatRunStatus,
  ComposerRunButton,
  ContextCompactionRecord,
  PersistedInterruptedRuns,
  RunActivityGroupView,
  RunActivityItemRow,
  RunActivityStatusIcon,
  RunDecisionPanel,
  RunTranscriptContent,
  activityGroupSummary,
  compactActivityTarget,
  semanticActivityPreview,
  useReplyPresenceHandoff,
  useStreamRevealFrame,
} from './components/chat/RunActivityViews';
import { AgentAvatar } from './components/common/AgentAvatar';
import { AvatarCropModal } from './components/common/AvatarCropModal';
import {
  OrgPage,
  AgentProfileCard,
  AgentRuntimePolicyPanel,
  AgentProfileDetail,
  FrakioAgentTextPanel,
  EditableTextPanel,
  InlineProfileEditor,
} from './components/settings/OrgPage';
import {
  UserProfilePanel,
  ProfileInsightPanel,
  ProfileModuleUsageRow,
  moduleUsageTotal,
  ManagedWebPasswordSettings,
  UserProfileForm,
  userProfileHasUnsavedChanges,
} from './components/settings/UserProfilePanel';
import {
  AppearanceSettingsPage,
  WorkbenchResponseSettings,
  TelemetrySettingsPanel,
  TelemetryNotice,
  DesktopUpdateBadge,
  ArchivedThreadsPanel,
} from './components/settings/AppearanceAndGeneralSettings';
import { MemoryCenterPage } from './components/settings/MemoryCenterPage';
import {
  RuntimeCenterPage,
  HermesRuntimePanel,
  UpdatesPanel,
  FrakioUpdateCard,
  HermesBackupRow,
  HermesBackupPanel,
  WorkbenchProfileSyncPanel,
  backupReasonLabel,
  shortCommit,
  runtimeBuildLabel,
} from './components/settings/RuntimeCenterPage';
import {
  HermesProfileConfigEditor,
  HermesAdvancedProfileConfig,
  ChannelsPage,
  McpSettingsPage,
  JobsPage,
} from './components/settings/HermesIntegrationsPage';
import {
  SettingsSection,
  SettingsRail,
  SettingsPage,
} from './components/settings/SettingsPage';
import {
  WorkspaceSurface,
  InboxPage,
  CollaborationCenterPage,
  KanbanPage,
} from './components/workspace/WorkspaceSurfaces';
import { GlobalSearchDialog } from './components/common/GlobalSearchDialog';

// wjz修改结束。

export function NetworkSettingsHelpDoc() {
  return (
    <div hidden aria-hidden="true">
      <span title="网页搜索">单个免费服务限流不代表本机离线</span>
      <span title="网页浏览">目标网站拒绝或超时不代表本机离线</span>
      <span>属于 Plan 安全策略，不是网络故障</span>
    </div>
  );
}

const workspaceId = 'workspace_default';
const defaultProjectParentPath = '';
const defaultSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
const defaultMacSidebarWidth = DEFAULT_MAC_SIDEBAR_WIDTH;
const defaultContextWidth = 344;
// These are viewport breakpoints, not a sum of pane widths. The old summed
// value put visually roomy desktop windows into the compact-layout path.
const autoCollapseSidebarWidth = 980;
const sidebarWidthBounds = SIDEBAR_WIDTH_BOUNDS;
const macSidebarWidthBounds = MAC_SIDEBAR_WIDTH_BOUNDS;
const contextWidthBounds = { min: 320, max: Number.MAX_SAFE_INTEGER };
const macConversationMinMainWidth = 360;
const conversationSafetyWidth = 24;
const threadFollowThreshold = 96;
// launch snapshot keys imported from features/launch/launch-storage
const launchQaInstallJob: LaunchInstallJob = {
  id: 'launch-qa-install',
  status: 'running',
  currentStepId: 'start-runtime',
  steps: [
    { id: 'verify-runtime', label: '验证内置运行环境', status: 'ready', detail: '内置版本 0.19.0' },
    { id: 'write-config', label: '初始化 Hermes 配置', status: 'ready', detail: 'Hermes Home 已准备' },
    { id: 'start-runtime', label: '启动 Hermes Runtime', status: 'running' },
    { id: 'detect', label: '验证本地连接', status: 'pending' },
  ],
};
const navItems = [
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
const railNavItems = navItems.filter((item) => item.placement === 'rail');
const managementNavIds = new Set(['settings', 'org', 'models', 'channels', 'plugins', 'inbox', 'kanban', 'jobs', 'monitoring']);
const workspaceSurfaceNavIds = new Set(['inbox', 'kanban']);

function App() {
  const launchQaMode = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('launchQa') || '' : '';
  const isDesktopShell = Boolean(window.frakioDesktop);
  const isWorkbenchShell = true;
  const desktopPlatform = window.frakioDesktop?.platform || '';
  const isWindowsDesktop = desktopPlatform === 'win32';
  const isMacDesktop = isDesktopShell && desktopPlatform === 'darwin';
  const activeDefaultSidebarWidth = isMacDesktop ? defaultMacSidebarWidth : defaultSidebarWidth;
  const activeSidebarWidthBounds = isMacDesktop ? macSidebarWidthBounds : sidebarWidthBounds;
  const canSelectFolder = Boolean(window.frakioDesktop?.selectFolder);
  const launchMaterialSnapshotRef = useRef<LaunchMaterialSnapshot>(readLaunchMaterialSnapshot(isMacDesktop));
  const [activeNav, setActiveNav] = useState('council');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, ModelCapability>>({});
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [defaultVaultId, setDefaultVaultId] = useState<string | null>(null);
  const [personalVaultId, setPersonalVaultId] = useState<string | null>(null);
  const [vaultSummary, setVaultSummary] = useState<VaultSummary | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceThemeLoaded, setWorkspaceThemeLoaded] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState(() => launchMaterialSnapshotRef.current.activeSpaceId);
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const [spaceCreateOpen, setSpaceCreateOpen] = useState(false);
  const [spaceEditTargetId, setSpaceEditTargetId] = useState<string | null>(null);
  const [spaceSwitchDirection, setSpaceSwitchDirection] = useState<'left' | 'right' | 'none'>('none');
  const [spaceDraft, setSpaceDraft] = useState<SpaceDraft>({ name: '', iconKind: 'dot', iconValue: '', theme: { ...buildSpaceThemeFromPoint(0.18, 0.72, '#536006', 'soft' as const), colorMode: 'native' } });
  const [spaceThemeAdvancedOpen, setSpaceThemeAdvancedOpen] = useState(false);
  const [spaceColorPoint, setSpaceColorPoint] = useState({ x: 0.18, y: 0.72 });
  const [themePresetPage, setThemePresetPage] = useState(0);
  const [selectedThemePresetId, setSelectedThemePresetId] = useState<string | null>(null);
  const [themeHarmony, setThemeHarmony] = useState<ThemeHarmony>('floating');
  const themeDragColorRef = useRef<string | null>(null);
  const themeDragMovedRef = useRef(false);
  const themeDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const textureDragRef = useRef(false);
  const macSpaceEditorRef = useRef<HTMLElement | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [conversations, setConversations] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [openingThreadId, setOpeningThreadId] = useState('');
  const [threadOpenError, setThreadOpenError] = useState('');
  const activeThreadIdRef = useRef('');
  const openThreadRequestRef = useRef(0);
  const openThreadAbortRef = useRef<AbortController | null>(null);
  const pendingMessageIdsByThreadRef = useRef<Map<string, Set<string>>>(new Map());
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<WorkArtifact[]>([]);
  const [activeView, setActiveView] = useState<'thread' | 'new-chat'>('new-chat');
  const [input, setInput] = useState('');
  const [newChatInput, setNewChatInput] = useState('');
  const newChatInputRef = useRef('');
  const [newChatAgentId, setNewChatAgentId] = useState('');
  const [newChatRuntimeOverride, setNewChatRuntimeOverride] = useState<RuntimeId | ''>('');
  const [newChatModelOverride, setNewChatModelOverride] = useState('');
  const [newChatRunOverride, setNewChatRunOverride] = useState<AgentRunOverride>({});
  const [newChatAgentPickerOpen, setNewChatAgentPickerOpen] = useState(false);
  const [newChatPermissionMode, setNewChatPermissionMode] = useState<PermissionMode>('manual');
  const newChatExecutionMode: 'chat' = 'chat';
  const [newChatPlanEnabled, setNewChatPlanEnabled] = useState(false);
  const [newChatCollaborationEnabled, setNewChatCollaborationEnabled] = useState(false);
  const [collaborationIntentByThreadId, setCollaborationIntentByThreadId] = useState<Record<string, boolean>>({});
  const [planAction, setPlanAction] = useState('');
  const [planFeedbackDraft, setPlanFeedbackDraft] = useState('');
  const [planFeedbackOpen, setPlanFeedbackOpen] = useState(false);
  const [planActionError, setPlanActionError] = useState('');
  const [collaborationSuggestionStartingId, setCollaborationSuggestionStartingId] = useState('');
  const [selectedNewChatWorkspaceId, setSelectedNewChatWorkspaceId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDragDepthRef = useRef(0);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const mainPanelRef = useRef<HTMLElement | null>(null);
  const [shellSurfaceTransitioning, setShellSurfaceTransitioning] = useState(false);
  const shellSurfaceTransitionTimerRef = useRef<number | null>(null);
  const [conversationMainCompact, setConversationMainCompact] = useState(false);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const threadScrollFrameRef = useRef<number | null>(null);
  const threadProgrammaticScrollRef = useRef(false);
  const threadProgrammaticScrollTimerRef = useRef<number | null>(null);
  const threadUserScrollIntentRef = useRef(false);
  const threadUserScrollIntentTimerRef = useRef<number | null>(null);
  const isFollowingLatestRef = useRef(true);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [hasNewThreadContent, setHasNewThreadContent] = useState(false);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const copiedMessageTimerRef = useRef<number | null>(null);
  const [feedbackMessageId, setFeedbackMessageId] = useState('');
  const [branchingMessageId, setBranchingMessageId] = useState('');
  const [messageActionError, setMessageActionError] = useState<{ messageId: string; message: string } | null>(null);
  const [messageAgentConfigOpenId, setMessageAgentConfigOpenId] = useState('');
  const [activeOverviewRoundId, setActiveOverviewRoundId] = useState('');
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentModelEditorId, setAgentModelEditorId] = useState<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectModalPurpose, setProjectModalPurpose] = useState<'create' | 'convert'>('create');
  const [projectMode, setProjectMode] = useState<'create' | 'existing'>('create');
  const [projectKnowledgeProfile, setProjectKnowledgeProfile] = useState<'personal' | 'team'>('personal');
  const [projectName, setProjectName] = useState('');
  const [projectRootPath, setProjectRootPath] = useState('');
  const [projectParentPath, setProjectParentPath] = useState(defaultProjectParentPath);
  const [projectError, setProjectError] = useState('');
  const [directoryPicker, setDirectoryPicker] = useState<{ open: boolean; current: string; parent: string; entries: { name: string; path: string }[]; loading: boolean; error: string }>({ open: false, current: '', parent: '', entries: [], loading: false, error: '' });
  const directoryPickerResolveRef = useRef<((path: string | null) => void) | null>(null);
  const [railConfirm, setRailConfirm] = useState<RailConfirm>(null);
  const [renameDialogTarget, setRenameDialogTarget] = useState<RenameDialogTarget>(null);
  const [railContextMenu, setRailContextMenu] = useState<RailContextMenuTarget | null>(null);
  const railActionFocusRef = useRef<HTMLElement | null>(null);
  const [archivedThreads, setArchivedThreads] = useState<ThreadSummary[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [inboxActionCount, setInboxActionCount] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('workbench');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>('collaboration');
  const [openRightRailTabs, setOpenRightRailTabs] = useState<RightRailTab[]>([]);
  const [collaborationTaskRequest, setCollaborationTaskRequest] = useState<{ id: string; threadId: string; workflowId?: string; taskId?: string } | null>(null);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const [draftContext, setDraftContext] = useState<MessageContext>({ browserAnnotations: [], reviewComments: [] });
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [macSidebarOverlayOpen, setMacSidebarOverlayOpen] = useState(false);
  const [macSidebarOverlayClosing, setMacSidebarOverlayClosing] = useState(false);
  const macSidebarOverlayVisibleRef = useRef(false);
  const macSidebarOverlayCloseTimerRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(activeDefaultSidebarWidth);
  const [contextWidth, setContextWidth] = useState(defaultContextWidth);
  const [pinnedNav, setPinnedNav] = useState<PinnedNav>(() => Object.fromEntries(railNavItems.map((item) => [item.id, true])));
  const [userProfile, setUserProfile] = useState<UserProfile>({ avatarUrl: '', nickname: '', bio: '', age: '', hobbies: '', occupation: '', defaultAgentAddress: '', otherAgentAddress: '', completedAt: '', updatedAt: '' });
  const [userProfileLoaded, setUserProfileLoaded] = useState(false);
  const [uiSettings, setUiSettings] = useState<WorkbenchUiSettings>({ sendKey: 'enter', density: 'comfortable', appearance: 'system', streamingResponses: true, showReasoning: true, richToolDescriptions: true, defaultAgentId: '', fallbackDecisionAgentId: '', defaultPermissionMode: 'manual', contextTriggerTokens: 500000, groupChatTriggerTokens: 100000, historyTailMessages: 10, agentMentionMaxDepth: 2 });
  const [desktopAppearanceDark, setDesktopAppearanceDark] = useState(false);
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus | null>(null);
  const [showTelemetryNotice, setShowTelemetryNotice] = useState(false);
  const [hermesStatus, setHermesStatus] = useState<HermesLocalStatus | null>(null);
  const [hermesBootstrap, setHermesBootstrap] = useState<HermesBootstrapStatus | null>(null);
  const [hermesRuntime, setHermesRuntime] = useState<HermesRuntimeStatus | null>(null);
  const [hermesDiagnostics, setHermesDiagnostics] = useState<HermesRuntimeDiagnostics | null>(null);
  const [hermesApiAvailability, setHermesApiAvailability] = useState<HermesApiAvailability>('unknown');
  const [hermesError, setHermesError] = useState('');
  const [updatesStatus, setUpdatesStatus] = useState<UpdatesStatus | null>(null);
  const [updatesBusy, setUpdatesBusy] = useState<UpdateBusy>('');
  const [updatesError, setUpdatesError] = useState('');
  const [updatesResult, setUpdatesResult] = useState<UpdateActionResult | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const [desktopUpdatePopoverOpen, setDesktopUpdatePopoverOpen] = useState(false);
  const [isImportingHermes, setIsImportingHermes] = useState(false);
  const [vaultPathInput, setVaultPathInput] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [vaultBusy, setVaultBusy] = useState<Record<string, 'index' | 'delete' | 'keep' | 'detach'>>({});
  const [modelError, setModelError] = useState('');
  const [runUiByThreadId, setRunUiByThreadId] = useState<Record<string, RunUiState>>({});
  const [runPresentationsByThreadId, setRunPresentationsByThreadId] = useState<Record<string, Record<string, RunPresentationUi>>>({});
  const liveRunSubscriptionKeysRef = useRef<Set<string>>(new Set());
  const recoveredRunSubscriptionsRef = useRef<Map<string, { events: EventSource | null; retryTimer: number | null; lastCursor: number; presentationCursor: number; attempts: number; seenEventKeys: Set<string> }>>(new Map());
  const liveRunEventKeysRef = useRef<Map<string, Set<string>>>(new Map());
  const [newChatStarting, setNewChatStarting] = useState(false);
  const [runTick, setRunTick] = useState(0);
  const [workflowControlInProgress, setWorkflowControlInProgress] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [collaborationModeError, setCollaborationModeError] = useState<{ message: string; code?: string; details?: Record<string, any> } | null>(null);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const agentCreationRequestIdRef = useRef('');
  const [selectedOrgAgentId, setSelectedOrgAgentId] = useState('');
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [profileInspector, setProfileInspector] = useState<ProfileInspectorState>({ target: null, draft: '', original: '', loading: false, saving: false, error: '', errorStage: '', saved: false });
  const profileInspectorRequestRef = useRef(0);
  const [launchPhase, setLaunchPhase] = useState<AppLaunchPhase>(launchQaMode === 'installing' ? 'installing' : launchQaMode === 'welcome' ? 'welcome' : 'booting');
  const [launchUserAvatarSnapshot, setLaunchUserAvatarSnapshot] = useState(() => readLaunchUserAvatarSnapshot());
  const [launchInstallJob, setLaunchInstallJob] = useState<LaunchInstallJob | null>(launchQaMode === 'installing' ? launchQaInstallJob : null);
  const [launchIssue, setLaunchIssue] = useState<LaunchIssue | null>(null);
  const launchStartedAtRef = useRef(Date.now());
  const launchTimersRef = useRef<number[]>([]);
  const launchOriginRef = useRef<'startup' | 'manual'>('startup');
  const launchInstallEventsRef = useRef<EventSource | null>(null);
  const launchInstallCompletedJobRef = useRef('');
  const launchInstallStartingRef = useRef(false);
  const bootstrapStartedRef = useRef(false);
  const activeRunUi = activeThread?.id ? runUiByThreadId[activeThread.id] : null;
  const isRunning = Boolean(activeRunUi?.isRunning);
  const runStartedAt = activeRunUi?.startedAt || null;
  const runTarget = activeRunUi?.target || null;
  const runDraft = activeRunUi?.draft || '';
  const runActivityGroups = activeRunUi?.activityGroups || [];
  const runPresentationPhase = activeRunUi?.presentationPhase || 'thinking';
  const runError = activeRunUi?.error || '';
  const runErrorCode = activeRunUi?.errorCode || '';
  const runStopping = Boolean(activeRunUi?.stopping);
  const liveRunPresentations = activeThread?.id
    ? Object.values(runPresentationsByThreadId[activeThread.id] || {}).filter((run) => {
      const persisted = (activeThread.messages || []).some((message) => message.externalRunId === run.hostRunId || message.externalRunId === run.activeRun?.runId);
      const hasKnownAgent = Boolean(run.target || agents.some((agent) => agent.id === run.agentId));
      const activeHostRunId = activeRunUi?.activeRun?.hostRunId || activeRunUi?.activeRun?.runId || '';
      const isRootRun = Boolean(activeHostRunId && run.hostRunId === activeHostRunId);
      return (!persisted || !run.completed) && (hasKnownAgent || isRootRun);
    })
    : [];
  // Decisions are owned by the Run that requested them. A child Agent must
  // never replace another Agent's approval or clarification in the Thread UI.
  const activeDecisionPresentation = liveRunPresentations.find((run) => run.approval || run.clarification) || null;
  const decisionRunUi = activeDecisionPresentation || activeRunUi;
  const activeHermesRun = decisionRunUi?.activeRun || null;
  const runApproval = decisionRunUi?.approval || null;
  const approvalSubmitting = Boolean(decisionRunUi?.approvalSubmitting);
  const approvalError = decisionRunUi?.approvalError || '';
  const runClarification = decisionRunUi?.clarification || null;
  const clarificationSubmitting = Boolean(decisionRunUi?.clarificationSubmitting);
  const clarificationError = decisionRunUi?.clarificationError || '';

  function updateDecisionRunUi(update: Partial<RunUiState> | ((current: RunUiState) => RunUiState)) {
    if (activeDecisionPresentation?.hostRunId && activeThread?.id) {
      updateRunPresentation(activeThread.id, activeDecisionPresentation.hostRunId, update as Partial<RunPresentationUi> | ((current: RunPresentationUi) => RunPresentationUi));
      return;
    }
    if (activeThread?.id) updateRunUi(activeThread.id, update);
  }

  useEffect(() => {
    activeThreadIdRef.current = activeThread?.id || '';
  }, [activeThread?.id]);

  function pendingMessageIds(threadId: string) {
    return [...(pendingMessageIdsByThreadRef.current.get(threadId) || [])];
  }

  function addPendingMessage(threadId: string, messageId: string) {
    const next = new Set(pendingMessageIdsByThreadRef.current.get(threadId) || []);
    next.add(messageId);
    pendingMessageIdsByThreadRef.current.set(threadId, next);
  }

  function confirmPendingMessage(threadId: string, messageId: string) {
    const next = new Set(pendingMessageIdsByThreadRef.current.get(threadId) || []);
    next.delete(messageId);
    if (next.size) pendingMessageIdsByThreadRef.current.set(threadId, next);
    else pendingMessageIdsByThreadRef.current.delete(threadId);
  }

  function syncThreadSummary(threadId: string, thread: Thread) {
    const updateSummary = (summary: ThreadSummary): ThreadSummary => summary.id !== threadId ? summary : {
      ...summary,
      title: thread.title || summary.title,
      runStatus: thread.runStatus || 'idle',
      activeAgentId: thread.activeAgentId || summary.activeAgentId,
      defaultAgentId: thread.defaultAgentId || summary.defaultAgentId,
      collaborationMode: thread.collaborationMode || summary.collaborationMode,
      activePlanId: thread.activePlanId || '',
      runtimeId: thread.runtimeId || summary.runtimeId,
      updatedAt: thread.updatedAt || summary.updatedAt,
    };
    setConversations((current) => current.map(updateSummary));
    setThreads((current) => current.map(updateSummary));
  }

  function adoptThreadSnapshot(threadId: string, thread: Thread) {
    const normalizedMessages = dedupeThreadMessages<ChatEvent>(thread.messages || []);
    const normalizedThread = { ...thread, messages: normalizedMessages };
    const confirmedIds = new Set((normalizedThread.messages || []).map((message) => message.id));
    const persistedRunIds = new Set((normalizedThread.messages || []).map((message) => String(message.externalRunId || '')).filter(Boolean));
    for (const messageId of pendingMessageIds(threadId)) {
      if (confirmedIds.has(messageId)) confirmPendingMessage(threadId, messageId);
    }
    setActiveThread((current) => current?.id === threadId
      ? mergeThreadWithPendingMessages(current, normalizedThread, pendingMessageIds(threadId))
      : current);
    syncThreadSummary(threadId, normalizedThread);
    if (persistedRunIds.size) setRunPresentationsByThreadId((current) => {
      const threadRuns = current[threadId] || {};
      const nextRuns = Object.fromEntries(Object.entries(threadRuns).filter(([hostRunId, run]) => (
        !persistedRunIds.has(hostRunId) && !persistedRunIds.has(String(run.activeRun?.runId || ''))
      )));
      return Object.keys(nextRuns).length === Object.keys(threadRuns).length
        ? current
        : { ...current, [threadId]: nextRuns };
    });
  }

  function updateRunUi(threadId: string, update: Partial<RunUiState> | ((current: RunUiState) => RunUiState)) {
    if (!threadId) return;
    setRunUiByThreadId((current) => {
      const previous = current[threadId] || createRunUiState();
      const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
      return { ...current, [threadId]: next };
    });
  }

  function updateRunPresentation(threadId: string, hostRunId: string, update: Partial<RunPresentationUi> | ((current: RunPresentationUi) => RunPresentationUi)) {
    if (!threadId || !hostRunId) return;
    setRunPresentationsByThreadId((current) => {
      const threadRuns = current[threadId] || {};
      const previous = threadRuns[hostRunId] || createRunPresentation({ hostRunId });
      const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
      return { ...current, [threadId]: { ...threadRuns, [hostRunId]: next } };
    });
  }

  function ensureRunPresentation(threadId: string, hostRunId: string, run: Partial<RunPresentationUi> = {}) {
    updateRunPresentation(threadId, hostRunId, (current) => ({ ...current, ...run, hostRunId }));
  }

  function resetRunUi(threadId: string, overrides: Partial<RunUiState> = {}) {
    updateRunUi(threadId, createRunUiState(overrides));
  }

  function runSubscriptionKey(threadId: string, turnId: string, hostRunId = '') {
    return `${threadId}:${turnId}:${hostRunId}`;
  }

  function clearRecoveredRunSubscription(key: string) {
    const subscription = recoveredRunSubscriptionsRef.current.get(key);
    if (!subscription) return;
    subscription.events?.close();
    if (subscription.retryTimer !== null) window.clearTimeout(subscription.retryTimer);
    recoveredRunSubscriptionsRef.current.delete(key);
  }

  function applyTerminalRunUi(threadId: string, error = '', runId = '', runtimeCursor = 0, errorCode = '') {
    updateRunUi(threadId, (current) => ({
      ...current,
      isRunning: false,
      startPending: false,
      hideStatus: false,
      startedAt: null,
      target: null,
      activeRun: null,
      stopping: false,
      approval: null,
      approvalSubmitting: false,
      clarification: null,
      clarificationSubmitting: false,
      error,
      errorCode,
      terminalRunId: String(runId || current.activeRun?.hostRunId || current.activeRun?.runId || ''),
      lastRuntimeCursor: Math.max(current.lastRuntimeCursor, Number(runtimeCursor || 0)),
    }));
  }

  function applyThreadRunSnapshot(snapshot: ThreadRunStateResponse, adoptThread = true) {
    const { threadId, run, thread, presentation } = snapshot;
    if (adoptThread) adoptThreadSnapshot(threadId, thread);
    const active = Boolean(run && ['queued', 'running', 'interrupting'].includes(run.status));
    const runIdentity = String(run?.runId || '');
    if (!active) {
      if (runIdentity) updateRunPresentation(threadId, runIdentity, (current) => ({
        ...current,
        isRunning: false,
        completed: true,
        error: run?.status === 'failed' ? run.error || '运行失败。' : current.error,
        errorCode: run?.status === 'failed' ? String((run as any).failureClass || '') : current.errorCode,
        presentationRevision: Math.max(current.presentationRevision, Number(presentation?.revision || 0)),
        lastRuntimeCursor: Math.max(current.lastRuntimeCursor, Number(presentation?.lastCursor || 0)),
      }));
      updateRunUi(threadId, (current) => {
        if (current.startPending && !run) return current;
        return createRunUiState({
          error: run?.status === 'failed' ? run.error || '运行失败。' : '',
          errorCode: run?.status === 'failed' ? String((run as any).failureClass || '') : '',
          terminalRunId: String(run?.runId || current.terminalRunId || ''),
          presentationRevision: Math.max(current.presentationRevision, Number(presentation?.revision || 0)),
          lastRuntimeCursor: Math.max(current.lastRuntimeCursor, Number(presentation?.lastCursor || 0)),
        });
      });
      return;
    }
    const targetAgent = agents.find((agent) => agent.id === run?.agentId) || null;
    const parsedStartedAt = run?.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    const normalizedApproval = normalizeApprovalPresentation(presentation?.approval);
    const normalizedClarification = normalizeClarificationPresentation(presentation?.clarification);
    if (run) {
      const recoveredTarget: ChatRunTarget | null = targetAgent ? { kind: 'agent', agent: targetAgent } : null;
      updateRunPresentation(threadId, run.runId, (current) => {
        const nextRevision = Number(presentation?.revision || 0);
        const nextCursor = Number(presentation?.lastCursor || 0);
        if (presentation && (!canApplyPresentation(current.presentationRevision, nextRevision)
          || (nextRevision === current.presentationRevision && nextCursor < current.lastRuntimeCursor))) return current;
        return {
        ...current,
        hostRunId: run.runId,
        turnId: run.turnId || '',
        agentId: run.agentId || '',
        agentName: targetAgent?.name || 'Agent',
        isRunning: true,
        startPending: false,
        startedAt: Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now(),
        target: recoveredTarget,
        activeRun: {
          runId: run.nativeRunId || run.runId,
          hostRunId: run.runId,
          sessionId: run.sessionId || '',
          threadId,
          turnId: run.turnId || '',
        },
        stopping: run.status === 'interrupting',
        draft: presentation?.content || '',
        activityGroups: presentation?.activityGroups || [],
        approval: normalizedApproval.approval,
        clarification: normalizedClarification.clarification,
        compaction: presentation?.compaction || null,
        presentationRevision: Number(presentation?.revision || 0),
        lastRuntimeCursor: Number(presentation?.lastCursor || 0),
        presentationPhase: run.phase === 'approval' || normalizedApproval.approval || normalizedClarification.clarification
          ? 'waiting-input'
          : presentation?.content ? 'responding' : presentation?.activityGroups?.length ? 'activity' : 'thinking',
        error: '',
        errorCode: '',
        completed: false,
        };
      });
    }
    updateRunUi(threadId, (current) => {
      if (!canApplyRunSnapshot(current.terminalRunId, runIdentity, run?.status || '')) return current;
      if (presentation && (!canApplyPresentation(current.presentationRevision, presentation.revision)
        || (Number(presentation.revision || 0) === current.presentationRevision && Number(presentation.lastCursor || 0) < current.lastRuntimeCursor))) return current;
      const approvalSyncError = normalizedApproval.missingId ? '审批信息同步不完整，正在重新获取。' : '';
      const clarificationSyncError = normalizedClarification.missingId ? '提问信息同步不完整，正在重新获取。' : '';
      return {
        ...current,
        isRunning: true,
        startPending: false,
        startedAt: current.startedAt || (Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now()),
        target: current.target || (targetAgent ? { kind: 'agent', agent: targetAgent } : null),
        activeRun: {
          runId: run?.nativeRunId || run?.runId || '',
          hostRunId: run?.runId || '',
          sessionId: run?.sessionId || '',
          threadId,
          turnId: run?.turnId || '',
        },
        stopping: run?.status === 'interrupting',
        draft: presentation?.content ?? current.draft,
        activityGroups: presentation?.activityGroups ?? current.activityGroups,
        approval: normalizedApproval.approval ?? (run?.phase === 'approval' ? current.approval : null),
        approvalError: approvalSyncError,
        clarification: normalizedClarification.clarification,
        clarificationError: clarificationSyncError,
        compaction: presentation?.compaction ?? current.compaction,
        presentationRevision: Math.max(current.presentationRevision, Number(presentation?.revision || 0)),
        lastRuntimeCursor: Math.max(current.lastRuntimeCursor, Number(presentation?.lastCursor || 0)),
        presentationPhase: run?.phase === 'approval' || normalizedApproval.approval || normalizedClarification.clarification
          ? 'waiting-input'
          : presentation?.content ? 'responding' : presentation?.activityGroups?.length ? 'activity' : current.presentationPhase,
        error: '',
        terminalRunId: '',
      };
    });
    if (run) ensureRecoveredRunSubscription(threadId, run, presentation?.lastCursor || 0);
  }

  async function reconcileThreadRun(threadId: string, adoptThread = true) {
    if (!threadId) return null;
    try {
      const snapshot = await requestJson<ThreadRunStateResponse>(`/api/threads/${threadId}/runs/active`);
      applyThreadRunSnapshot(snapshot, adoptThread);
      return snapshot;
    } catch {
      return null;
    }
  }

  function ensureRecoveredRunSubscription(threadId: string, run: ThreadRunState, initialCursor = 0) {
    if (!run.turnId || !['queued', 'running', 'interrupting'].includes(run.status)) return;
    const key = runSubscriptionKey(threadId, run.turnId, run.runId);
    if (liveRunSubscriptionKeysRef.current.has(key) || recoveredRunSubscriptionsRef.current.has(key)) return;
    const subscription = { events: null as EventSource | null, retryTimer: null as number | null, lastCursor: 0, presentationCursor: initialCursor, attempts: 0, seenEventKeys: new Set<string>() };
    recoveredRunSubscriptionsRef.current.set(key, subscription);
    const connect = () => {
      if (!recoveredRunSubscriptionsRef.current.has(key) || liveRunSubscriptionKeysRef.current.has(key)) {
        clearRecoveredRunSubscription(key);
        return;
      }
      const search = new URLSearchParams();
      if (subscription.lastCursor) search.set('cursor', String(subscription.lastCursor));
      if (subscription.presentationCursor) search.set('presentationCursor', String(subscription.presentationCursor));
      const events = new EventSource(`/api/threads/${threadId}/turns/${run.turnId}/events${search.size ? `?${search.toString()}` : ''}`);
      subscription.events = events;
      events.onmessage = (event) => {
        const cursorValue = Math.max(0, Number(event.lastEventId || 0) || 0);
        if (cursorValue && cursorValue <= subscription.lastCursor) return;
        if (cursorValue) subscription.lastCursor = cursorValue;
        subscription.attempts = 0;
        const data = JSON.parse(event.data || '{}');
        if (!shouldApplyRuntimeEvent(subscription.seenEventKeys, data)) return;
        if (data.event === 'run.started') {
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          const routedAgent = agents.find((agent) => agent.id === data.agentId) || null;
          const fallbackAgent = routedAgent || agents.find((agent) => agent.id === run.agentId) || null;
          ensureRunPresentation(threadId, incomingHostRunId, {
            hostRunId: incomingHostRunId,
            turnId: String(data.turnId || run.turnId),
            agentId: String(data.agentId || fallbackAgent?.id || ''),
            agentName: String(data.agentName || fallbackAgent?.name || 'Agent'),
            activeRun: {
              runId: String(data.nativeRunId || data.runId || incomingHostRunId),
              hostRunId: incomingHostRunId,
              sessionId: String(data.sessionId || ''),
              threadId,
              turnId: String(data.turnId || run.turnId),
            },
            target: fallbackAgent ? { kind: 'agent', agent: fallbackAgent } : null,
            isRunning: true,
            startPending: false,
            startedAt: Date.now(),
            presentationPhase: 'thinking',
            completed: false,
          });
          return;
        }
        if (data.event === 'message.delta') {
          const delta = String(data.delta || '');
          const runtimeCursor = Math.max(0, Number(data.runtimeCursor || 0) || 0);
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          if (delta) updateRunPresentation(threadId, incomingHostRunId, (current) => canApplyRuntimeCursor(current.lastRuntimeCursor, runtimeCursor)
            ? { ...current, draft: current.draft + delta, lastRuntimeCursor: Math.max(current.lastRuntimeCursor, runtimeCursor), presentationPhase: 'responding' }
            : current);
          if (delta && incomingHostRunId === run.runId) updateRunUi(threadId, (current) => canApplyRuntimeCursor(current.lastRuntimeCursor, runtimeCursor)
            ? { ...current, draft: current.draft + delta, lastRuntimeCursor: Math.max(current.lastRuntimeCursor, runtimeCursor), presentationPhase: 'responding' }
            : current);
          return;
        }
        if (data.event === 'tool.running' || data.event === 'tool.started' || data.event === 'tool.updated' || data.event === 'tool.completed') {
          const activityEvent = data.event === 'tool.completed' ? data : { ...data, event: 'tool.running' };
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          updateRunPresentation(threadId, incomingHostRunId, (current) => ({ ...current, activityGroups: mergeRunActivityEvent(current.activityGroups, activityEvent), presentationPhase: 'activity' }));
          if (incomingHostRunId === run.runId) updateRunUi(threadId, (current) => ({ ...current, activityGroups: mergeRunActivityEvent(current.activityGroups, activityEvent), presentationPhase: 'activity' }));
          return;
        }
        if (data.event === 'context.compaction.started' || data.event === 'context.compaction.completed' || data.event === 'context.compaction.failed') {
          const operationId = String(data.operationId || `compaction:${data.runId || run.runId}`);
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          const failed = data.event === 'context.compaction.failed';
          const status = data.event === 'context.compaction.started' ? 'running' as const : failed ? 'failed' as const : 'completed' as const;
          function updateCompaction<T extends RunUiState>(current: T): T {
            const record = { operationId, status, tokensBefore: Number(data.tokensBefore) || undefined, tokensAfterEstimate: Number(data.tokensAfterEstimate) || undefined, error: failed ? String(data.error || '上下文压缩失败。') : undefined, originalContextPreserved: failed ? data.originalContextPreserved !== false : undefined };
            const records = current.compactionRecords.some((item) => item.operationId === operationId)
              ? current.compactionRecords.map((item) => item.operationId === operationId ? { ...item, ...record } : item)
              : [...current.compactionRecords, record];
            return { ...current, compaction: record, compactionRecords: records, presentationPhase: 'activity' } as T;
          }
          updateRunPresentation(threadId, incomingHostRunId, updateCompaction);
          if (incomingHostRunId === run.runId) updateRunUi(threadId, updateCompaction);
          return;
        }
        if (data.event === 'approval.request' || data.event === 'approval.requested') {
          const normalized = normalizeApprovalPresentation(data);
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          updateRunPresentation(threadId, incomingHostRunId, {
            presentationPhase: 'waiting-input',
            approval: normalized.approval,
            approvalError: normalized.missingId ? '审批信息同步不完整，正在重新获取。' : '',
          });
          if (incomingHostRunId === run.runId) updateRunUi(threadId, {
            presentationPhase: 'waiting-input',
            approval: normalized.approval,
            approvalError: normalized.missingId ? '审批信息同步不完整，正在重新获取。' : '',
          });
          if (normalized.missingId) void reconcileThreadRun(threadId, true);
          return;
        }
        if (data.event === 'clarify.request' || data.event === 'clarify.requested') {
          const normalized = normalizeClarificationPresentation(data);
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          updateRunPresentation(threadId, incomingHostRunId, {
            presentationPhase: 'waiting-input',
            clarification: normalized.clarification,
            clarificationError: normalized.missingId ? '提问信息同步不完整，正在重新获取。' : '',
          });
          if (incomingHostRunId === run.runId) updateRunUi(threadId, {
            presentationPhase: 'waiting-input',
            clarification: normalized.clarification,
            clarificationError: normalized.missingId ? '提问信息同步不完整，正在重新获取。' : '',
          });
          if (normalized.missingId) void reconcileThreadRun(threadId, true);
          return;
        }
        if (data.event === 'approval.responded' || data.event === 'clarify.responded') {
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          function updateDecision<T extends RunUiState>(current: T): T {
            return {
              ...current,
              presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { hasActivity: current.activityGroups.length > 0 }),
              ...(data.event === 'approval.responded'
                ? { approval: null, approvalError: '', approvalSubmitting: false }
                : { clarification: null, clarificationError: '', clarificationSubmitting: false }),
            } as T;
          }
          updateRunPresentation(threadId, incomingHostRunId, updateDecision);
          if (incomingHostRunId === run.runId) updateRunUi(threadId, updateDecision);
          return;
        }
        if (data.event === 'run.completed' || data.event === 'run.failed' || data.event === 'run.cancelled') {
          if (data.thread) adoptThreadSnapshot(threadId, data.thread as Thread);
          const incomingHostRunId = String(data.hostRunId || data.runId || run.runId);
          updateRunPresentation(threadId, incomingHostRunId, (current) => ({
            ...current,
            isRunning: false,
            completed: true,
            approval: null,
            approvalSubmitting: false,
            clarification: null,
            clarificationSubmitting: false,
            error: data.event === 'run.failed' ? String(data.error || '运行失败。') : '',
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          void reconcileThreadRun(threadId, true);
          return;
        }
        if (data.event === 'turn.completed' || data.event === 'turn.failed' || data.event === 'turn.cancelled') {
          if (data.thread) adoptThreadSnapshot(threadId, data.thread as Thread);
          applyTerminalRunUi(
            threadId,
            data.event === 'turn.failed' ? String(data.error || '运行失败。') : '',
            String(data.hostRunId || data.runId || run.runId),
            Number(data.runtimeCursor || 0),
          );
          clearRecoveredRunSubscription(key);
          void reconcileThreadRun(threadId, true);
        }
      };
      events.onerror = () => {
        events.close();
        subscription.events = null;
        void reconcileThreadRun(threadId, true).then((snapshot) => {
          const stillActive = Boolean(snapshot?.run && ['queued', 'running', 'interrupting'].includes(snapshot.run.status));
          if (!stillActive || !recoveredRunSubscriptionsRef.current.has(key)) {
            clearRecoveredRunSubscription(key);
            return;
          }
          subscription.attempts += 1;
          subscription.retryTimer = window.setTimeout(connect, Math.min(4000, 500 * 2 ** Math.min(3, subscription.attempts)));
        });
      };
    };
    connect();
  }

  async function reconcileActiveRuns() {
    try {
      const response = await requestJson<ActiveRunsResponse>('/api/runs/active');
      const activeThreadIds = new Set(response.runs.map((item) => item.threadId));
      for (const snapshot of response.runs) {
        applyThreadRunSnapshot({ ...snapshot, thread: activeThread?.id === snapshot.threadId ? activeThread : ({ id: snapshot.threadId } as Thread) }, false);
      }
      setRunUiByThreadId((current) => Object.fromEntries(Object.entries(current).map(([threadId, ui]) => [
        threadId,
        ui.isRunning && !ui.startPending && !activeThreadIds.has(threadId) ? createRunUiState({ error: ui.error }) : ui,
      ])));
    } catch { /* A focus refresh must not disturb an active local stream. */ }
  }

  useEffect(() => () => {
    for (const key of [...recoveredRunSubscriptionsRef.current.keys()]) clearRecoveredRunSubscription(key);
  }, []);

  useEffect(() => {
    const threadId = activeThread?.id;
    if (!threadId) return undefined;
    void reconcileThreadRun(threadId, true);
    const refresh = () => void reconcileThreadRun(threadId, true);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [activeThread?.id]);

  useEffect(() => {
    void reconcileActiveRuns();
    const refresh = () => void reconcileActiveRuns();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [workspaceId]);

  useEffect(() => {
    const threadId = activeThread?.id;
    if (!threadId) return undefined;
    const refresh = (event: Event) => {
      const requestedThreadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (requestedThreadId && requestedThreadId !== threadId) return;
      void requestJson<{ thread: Thread }>(`/api/threads/${threadId}`).then((data) => adoptThreadSnapshot(threadId, data.thread)).catch(() => {});
    };
    window.addEventListener('frakio:thread-refresh-request', refresh);
    return () => window.removeEventListener('frakio:thread-refresh-request', refresh);
  }, [activeThread?.id]);

  const refreshDraftContext = useCallback(async (threadId = activeThread?.id || '') => {
    if (!threadId) {
      setDraftContext({ browserAnnotations: [], reviewComments: [] });
      return;
    }
    try {
      const data = await requestJson<{ draftContext: MessageContext }>(`/api/threads/${threadId}/draft-context`);
      setDraftContext(data.draftContext || { browserAnnotations: [], reviewComments: [] });
    } catch {
      setDraftContext({ browserAnnotations: [], reviewComments: [] });
    }
  }, [activeThread?.id]);

  useEffect(() => {
    setOverviewOpen(false);
    void refreshDraftContext(activeThread?.id || '');
  }, [activeThread?.id, refreshDraftContext]);

  const draftSaveTimerRef = useRef<number | null>(null);
  const draftHydratingRef = useRef(false);
  useEffect(() => {
    const thread = activeThread;
    if (!thread?.id) return undefined;
    draftHydratingRef.current = true;
    setInput(readThreadDraft(thread));
    return undefined;
  }, [activeThread?.id, activeThread?.workspaceId]);

  useEffect(() => {
    const thread = activeThread;
    if (!thread?.id) return undefined;
    if (draftHydratingRef.current) {
      draftHydratingRef.current = false;
      return undefined;
    }
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      writeThreadDraft(thread, input);
      draftSaveTimerRef.current = null;
    }, 200);
    return () => {
      writeThreadDraft(thread, input);
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [activeThread?.id, activeThread?.workspaceId, input]);

  useEffect(() => {
    const thread = activeThread;
    if (!thread?.id) return undefined;
    const flush = () => writeThreadDraft(thread, input);
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
    };
  }, [activeThread?.id, activeThread?.workspaceId, input]);

  async function removeDraftContextItem(kind: 'browser' | 'review', itemId: string) {
    if (!activeThread?.id) return;
    await requestJson(`/api/threads/${activeThread.id}/draft-context/${kind}/${itemId}`, { method: 'DELETE' });
    await refreshDraftContext(activeThread.id);
  }

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; busy?: boolean }>).detail;
      if (detail?.threadId && detail.threadId !== activeThread?.id) return;
      setWorkflowControlInProgress(Boolean(detail?.busy));
    };
    window.addEventListener('frakio:workflow-control-busy', update);
    return () => window.removeEventListener('frakio:workflow-control-busy', update);
  }, [activeThread?.id]);

  function isThreadNearLatest(root = threadScrollRef.current) {
    if (!root) return true;
    return root.scrollHeight - root.scrollTop - root.clientHeight <= threadFollowThreshold;
  }

  function setThreadFollowState(following: boolean) {
    isFollowingLatestRef.current = following;
    setIsFollowingLatest(following);
    if (following) setHasNewThreadContent(false);
  }

  function scheduleThreadScrollToLatest() {
    if (threadScrollFrameRef.current !== null) return;
    threadScrollFrameRef.current = window.requestAnimationFrame(() => {
      threadScrollFrameRef.current = null;
      if (!isFollowingLatestRef.current) return;
      const root = threadScrollRef.current;
      if (!root) return;
      root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      setHasNewThreadContent(false);
    });
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'auto') {
    const root = threadScrollRef.current;
    setThreadFollowState(true);
    if (!root) return;
    if (threadScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(threadScrollFrameRef.current);
      threadScrollFrameRef.current = null;
    }
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resolvedBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : behavior;
    threadProgrammaticScrollRef.current = resolvedBehavior === 'smooth';
    root.scrollTo({ top: root.scrollHeight, behavior: resolvedBehavior });
    if (threadProgrammaticScrollTimerRef.current !== null) window.clearTimeout(threadProgrammaticScrollTimerRef.current);
    threadProgrammaticScrollTimerRef.current = window.setTimeout(() => {
      threadProgrammaticScrollRef.current = false;
      threadProgrammaticScrollTimerRef.current = null;
      if (isThreadNearLatest()) setThreadFollowState(true);
    }, resolvedBehavior === 'smooth' ? 520 : 0);
  }

  useEffect(() => {
    if (launchQaMode) return;
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    void bootstrap();
  }, []);

  useEffect(() => () => {
    for (const timer of launchTimersRef.current) window.clearTimeout(timer);
    launchTimersRef.current = [];
    launchInstallEventsRef.current?.close();
    launchInstallEventsRef.current = null;
  }, []);

  useEffect(() => {
    if (launchPhase !== 'connecting') return undefined;
    const status = hermesRuntime?.autoStart?.status;
    if (status && status !== 'starting') {
      scheduleLaunchWelcome();
      return undefined;
    }
    const poller = window.setInterval(() => {
      void refreshHermesRuntime();
    }, 900);
    const timeout = window.setTimeout(() => {
      scheduleLaunchWelcome();
    }, Math.max(0, 8000 - (Date.now() - launchStartedAtRef.current)));
    return () => {
      window.clearInterval(poller);
      window.clearTimeout(timeout);
    };
  }, [launchPhase, hermesRuntime?.autoStart?.status]);

  useEffect(() => {
    if (activeThread?.vaultId) void loadVaultSummary(activeThread.vaultId);
    if (activeThread && !activeThread.vaultId) setVaultSummary(null);
  }, [activeThread?.vaultId]);

  useEffect(() => {
    if (activeView !== 'thread' || !activeThread?.id || !['plan', 'collaboration'].includes(activeThread.collaborationMode || 'default')) return undefined;
    const threadId = activeThread.id;
    const events = new EventSource(`/api/threads/${threadId}/plans/events`);
    events.onmessage = (event) => {
      const data = JSON.parse(event.data || '{}');
      if (data.event !== 'plan.snapshot') return;
      setActiveThread((current) => {
        if (!current || current.id !== threadId) return current;
        const incomingPlan = data.plan as PlanSession | null;
        const planSessions = incomingPlan
          ? [...(current.planSessions || []).filter((plan) => plan.id !== incomingPlan.id), incomingPlan].slice(-20)
          : current.planSessions || [];
        return {
          ...current,
          collaborationMode: data.collaborationMode === 'collaboration'
            ? 'collaboration'
            : data.collaborationMode === 'plan' ? 'plan' : 'default',
          activePlanId: String(data.activePlanId || ''),
          planSessions,
        };
      });
    };
    return () => events.close();
  }, [activeView, activeThread?.id, activeThread?.collaborationMode]);

  useEffect(() => {
    if (activeThread?.mode === 'workspace' && activeThread.workspaceId) void loadWorkspaceArtifacts(activeThread.workspaceId);
    if (activeThread?.mode !== 'workspace') setWorkspaceArtifacts([]);
  }, [activeThread?.id, activeThread?.workspaceId, activeThread?.mode, activeThread?.messages.length]);

  useLayoutEffect(() => {
    if (activeView !== 'thread') return;
    threadProgrammaticScrollRef.current = false;
    setThreadFollowState(true);
    scheduleThreadScrollToLatest();
  }, [activeView, activeThread?.id]);

  useEffect(() => {
    if (activeView !== 'thread') return;
    if (isFollowingLatestRef.current) scheduleThreadScrollToLatest();
    else setHasNewThreadContent(true);
  }, [
    activeView,
    activeThread?.id,
    activeThread?.messages.length,
    isRunning,
    runDraft,
    runError,
    runActivityGroups,
  ]);

  useEffect(() => {
    const root = threadScrollRef.current;
    const content = threadContentRef.current;
    if (activeView !== 'thread' || !root || !content) return undefined;

    const clearUserIntentTimer = () => {
      if (threadUserScrollIntentTimerRef.current !== null) {
        window.clearTimeout(threadUserScrollIntentTimerRef.current);
        threadUserScrollIntentTimerRef.current = null;
      }
    };
    const markUserScrollIntent = () => {
      threadProgrammaticScrollRef.current = false;
      threadUserScrollIntentRef.current = true;
      clearUserIntentTimer();
      threadUserScrollIntentTimerRef.current = window.setTimeout(() => {
        threadUserScrollIntentRef.current = false;
        threadUserScrollIntentTimerRef.current = null;
      }, 420);
    };
    const handlePointerDown = () => {
      threadProgrammaticScrollRef.current = false;
      threadUserScrollIntentRef.current = true;
      clearUserIntentTimer();
    };
    const handlePointerUp = () => {
      threadUserScrollIntentTimerRef.current = window.setTimeout(() => {
        threadUserScrollIntentRef.current = false;
        threadUserScrollIntentTimerRef.current = null;
      }, 80);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markUserScrollIntent();
    };
    const handleScroll = () => {
      if (threadProgrammaticScrollRef.current) return;
      if (isThreadNearLatest(root)) {
        setThreadFollowState(true);
        return;
      }
      if (threadUserScrollIntentRef.current) {
        setThreadFollowState(false);
        setHasNewThreadContent(true);
      }
    };
    const handleScrollEnd = () => {
      threadProgrammaticScrollRef.current = false;
      if (isThreadNearLatest(root)) setThreadFollowState(true);
    };
    const resizeObserver = new ResizeObserver(() => {
      if (isFollowingLatestRef.current) scheduleThreadScrollToLatest();
      else if (!isThreadNearLatest(root)) setHasNewThreadContent(true);
    });

    root.addEventListener('scroll', handleScroll, { passive: true });
    root.addEventListener('scrollend', handleScrollEnd);
    root.addEventListener('wheel', markUserScrollIntent, { passive: true });
    root.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    root.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    resizeObserver.observe(root);
    resizeObserver.observe(content);
    return () => {
      root.removeEventListener('scroll', handleScroll);
      root.removeEventListener('scrollend', handleScrollEnd);
      root.removeEventListener('wheel', markUserScrollIntent);
      root.removeEventListener('touchstart', markUserScrollIntent);
      root.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver.disconnect();
      clearUserIntentTimer();
    };
  }, [activeView, activeThread?.id]);

  useEffect(() => () => {
    if (threadScrollFrameRef.current !== null) window.cancelAnimationFrame(threadScrollFrameRef.current);
    if (threadProgrammaticScrollTimerRef.current !== null) window.clearTimeout(threadProgrammaticScrollTimerRef.current);
    if (threadUserScrollIntentTimerRef.current !== null) window.clearTimeout(threadUserScrollIntentTimerRef.current);
    if (copiedMessageTimerRef.current !== null) window.clearTimeout(copiedMessageTimerRef.current);
    if (shellSurfaceTransitionTimerRef.current !== null) window.clearTimeout(shellSurfaceTransitionTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setRunTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const globalDefaultAgentId = agents.some((agent) => agent.id === uiSettings.defaultAgentId) ? uiSettings.defaultAgentId || '' : agents[0]?.id || '';
  const selectedAgentIds = activeThread?.selectedAgents?.length ? activeThread.selectedAgents : [globalDefaultAgentId].filter(Boolean);
  const permissionMode = activeThread?.permissionMode || 'smart';
  const newChatAgent = agents.find((agent) => agent.id === (newChatAgentId || globalDefaultAgentId)) || agents.find((agent) => agent.id === globalDefaultAgentId) || agents[0] || null;
  const launchWelcomeAvatarUrl = userProfile.avatarUrl || launchUserAvatarSnapshot || '';
  const activeComposerAgentId = activeThread?.activeAgentId || activeThread?.collaboration?.activeAgentId || activeThread?.defaultAgentId || activeThread?.primaryAgentId || globalDefaultAgentId;
  const activeComposerAgent = agents.find((agent) => agent.id === activeComposerAgentId) || agents[0] || null;
  const activeComposerRuntimeId = effectiveRuntimeForAgentUi(activeComposerAgent, activeThread);
  const newChatRuntimeId = newChatRuntimeOverride || effectiveRuntimeForAgentUi(newChatAgent, null);
  const localProfilesForComposer = hermesRuntime?.profiles?.length ? hermesRuntime.profiles : hermesBootstrap?.profiles || hermesStatus?.profiles || [];
  const newChatProfileName = resolveHermesProfileNameForAgent(newChatAgent, localProfilesForComposer);
  const activeComposerProfileName = resolveHermesProfileNameForAgent(activeComposerAgent, localProfilesForComposer);
  const defaultAgentProfileName = resolveHermesProfileNameForAgent(agents.find((agent) => agent.id === globalDefaultAgentId) || null, localProfilesForComposer);
  const newChatProfileModelValue = newChatModelOverride || (newChatAgent ? modelValueForAgent(newChatAgent, models, {}, uiSettings.defaultModel) : '');
  const activeThreadModelOverride = activeComposerAgent ? activeThread?.agentModelOverrides?.[activeComposerAgent.id] || '' : '';
  const activeThreadRunOverride = activeComposerAgent ? activeThread?.agentRunOverrides?.[activeComposerAgent.id] || {} : {};
  const activeComposerProfileModelValue = activeThreadModelOverride || (activeComposerAgent ? modelValueForAgent(activeComposerAgent, models, {}, uiSettings.defaultModel) : '');
  const hermesProfileModelOptions = hermesProfileModels(models);
  const activeVault = vaults.find((vault) => vault.id === activeThread?.vaultId) || null;
  const activeSection = navItems.find((item) => item.id === activeNav);
  const isManagementSection = managementNavIds.has(activeNav);
  const isSettingsNav = activeNav === 'settings' && activeView !== 'new-chat';
  const isWorkspaceSurfaceNav = workspaceSurfaceNavIds.has(activeNav) && activeView !== 'new-chat';
  const visiblePinnedNav = railNavItems.filter((item) => pinnedNav[item.id] !== false);
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) || spaces[0] || null;
  const visibleWorkspaces = workspaces.filter((workspace) => (workspace.spaceId || activeSpaceId) === activeSpaceId);
  const visibleConversations = conversations.filter((thread) => (thread.spaceId || activeSpaceId) === activeSpaceId);
  const activeWorkspace = activeThread?.workspaceId ? workspaces.find((workspace) => workspace.id === activeThread.workspaceId) || null : null;
  const activeProposal = activeThread?.planSessions?.find((proposal) => proposal.id === activeThread.activePlanId) || null;
  const activePlan = activeProposal?.purpose === 'plan' ? activeProposal : null;
  const activeCollaborationProposal = activeProposal?.purpose === 'collaboration' ? activeProposal : null;
  const activeWorkflowRunning = Boolean(activeThread?.collaboration?.workflows?.some((workflow) => ['active', 'paused'].includes(workflow.status)));
  const collaborationIntentEnabled = Boolean(activeThread?.id && collaborationIntentByThreadId[activeThread.id]);
  const pendingProposalQuestion = activeProposal?.questions?.find((batch) => batch.status === 'pending') || null;
  const visibleMessages = (activeThread?.messages || []).filter(isVisibleChatMessage);
  const overviewRounds = buildThreadOverviewRounds(visibleMessages);
  const profileInspectorDirty = Boolean(profileInspector.target && profileInspector.draft !== profileInspector.original);
  const spaceEditorReplacesPage = spaceCreateOpen && !isMacDesktop;
  const macSpaceEditorOpen = spaceCreateOpen && isMacDesktop;
  const resourceRailAvailable = !spaceEditorReplacesPage && activeView !== 'new-chat' && !isManagementSection && Boolean(activeThread);
  const rightRailKind: 'resources' | null = resourceRailAvailable ? 'resources' : null;
  const rightRailOpen = Boolean(rightRailKind && !libraryCollapsed);
  const isMacConversationShell = !isSettingsNav && (activeView === 'new-chat' || (!isManagementSection && (Boolean(activeThread) || Boolean(openingThreadId))));
  const isMacWorkspaceSurfaceShell = isMacConversationShell || (isMacDesktop && isWorkspaceSurfaceNav);
  const currentShellSurfaceKind = isMacConversationShell
    ? 'conversation'
    : (isSettingsNav || isWorkspaceSurfaceNav) ? 'floating' : 'other';
  useLayoutEffect(() => {
    const main = mainPanelRef.current;
    if (!main || !isMacConversationShell) {
      setConversationMainCompact(false);
      return undefined;
    }
    const update = () => {
      const compact = main.getBoundingClientRect().width < 440;
      setConversationMainCompact((current) => current === compact ? current : compact);
    };
    const observer = new ResizeObserver(update);
    observer.observe(main);
    update();
    return () => observer.disconnect();
  }, [isMacConversationShell]);
  const desktopUpdateBadgeVisible = Boolean(
    desktopUpdateState?.supported
    && ['available', 'downloading', 'downloaded', 'error'].includes(desktopUpdateState.phase)
    && (desktopUpdateState.phase !== 'error' || desktopUpdateState.latestVersion),
  );
  const effectiveAppDark = uiSettings.appearance === 'dark'
    || (isMacDesktop && uiSettings.appearance !== 'light' && desktopAppearanceDark);
  const profileEditorControls: ProfileEditorControls = {
    state: profileInspector,
    dirty: profileInspectorDirty,
    open: openProfileInspector,
    changeDraft: (draft) => setProfileInspector((current) => ({ ...current, draft, error: current.errorStage === 'save' ? '' : current.error, errorStage: current.errorStage === 'save' ? '' : current.errorStage, saved: false })),
    save: saveProfileInspector,
    close: () => closeProfileInspector(),
    discard: () => closeProfileInspector(true),
  };
  const rightRailNeedsSidebarDrawer = rightRailOpen
    && !sidebarCollapsed
    && viewportWidth <= sidebarWidth + contextWidth + macConversationMinMainWidth + conversationSafetyWidth;
  const rightRailOverlaysMain = rightRailOpen
    && viewportWidth < contextWidthBounds.min + macConversationMinMainWidth + conversationSafetyWidth;
  const browserFullWorkspace = rightRailOpen && rightRailTab === 'browser' && viewportWidth <= 768;
  const autoSidebarCollapsed = isDesktopShell
    && !isSettingsNav
    && (viewportWidth < autoCollapseSidebarWidth || rightRailNeedsSidebarDrawer);
  const effectiveSidebarCollapsed = sidebarCollapsed || autoSidebarCollapsed;
  // In a macOS conversation the responsive layout is a temporary drawer,
  // not the persisted user preference. Keep the two CSS states separate.
  const sidebarUsesCollapsedLayout = sidebarCollapsed || (!isMacConversationShell && autoSidebarCollapsed);
  const macSidebarUsesOverlay = isMacConversationShell && autoSidebarCollapsed;
  const macSidebarOverlayVisible = macSidebarOverlayOpen || macSidebarOverlayClosing;
  const sidebarVisuallyOpen = macSidebarUsesOverlay ? macSidebarOverlayOpen : !effectiveSidebarCollapsed;
  const clearMacSidebarOverlayCloseTimer = useCallback(() => {
    if (macSidebarOverlayCloseTimerRef.current === null) return;
    window.clearTimeout(macSidebarOverlayCloseTimerRef.current);
    macSidebarOverlayCloseTimerRef.current = null;
  }, []);
  const openMacSidebarOverlay = useCallback(() => {
    clearMacSidebarOverlayCloseTimer();
    macSidebarOverlayVisibleRef.current = true;
    setMacSidebarOverlayClosing(false);
    setMacSidebarOverlayOpen(true);
  }, [clearMacSidebarOverlayCloseTimer]);
  const closeMacSidebarOverlay = useCallback((immediate = false) => {
    if (!macSidebarOverlayVisibleRef.current) return;
    clearMacSidebarOverlayCloseTimer();
    setMacSidebarOverlayOpen(false);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (immediate || reduceMotion) {
      macSidebarOverlayVisibleRef.current = false;
      setMacSidebarOverlayClosing(false);
      return;
    }
    setMacSidebarOverlayClosing(true);
    macSidebarOverlayCloseTimerRef.current = window.setTimeout(() => {
      macSidebarOverlayCloseTimerRef.current = null;
      macSidebarOverlayVisibleRef.current = false;
      setMacSidebarOverlayClosing(false);
    }, 220);
  }, [clearMacSidebarOverlayCloseTimer]);
  const macSidebarResizeMax = availablePaneMax({
    side: 'left',
    viewportWidth,
    sidebarWidth,
    contextWidth,
    leftVisible: !effectiveSidebarCollapsed,
    rightVisible: rightRailOpen,
    minMainWidth: macConversationMinMainWidth,
    chromeWidth: conversationSafetyWidth,
    minWidth: activeSidebarWidthBounds.min,
    maxWidth: activeSidebarWidthBounds.max,
  });
  const contextResizeMax = availablePaneMax({
    side: 'right',
    viewportWidth,
    sidebarWidth,
    contextWidth,
    leftVisible: !effectiveSidebarCollapsed,
    rightVisible: rightRailOpen,
    minMainWidth: macConversationMinMainWidth,
    chromeWidth: conversationSafetyWidth,
    minWidth: contextWidthBounds.min,
    maxWidth: contextWidthBounds.max,
  });
  const contextOpenResizeMax = availablePaneMax({
    side: 'right',
    viewportWidth,
    sidebarWidth,
    contextWidth,
    leftVisible: !(sidebarCollapsed || rightRailNeedsSidebarDrawer),
    rightVisible: true,
    minMainWidth: macConversationMinMainWidth,
    chromeWidth: conversationSafetyWidth,
    minWidth: contextWidthBounds.min,
    maxWidth: contextWidthBounds.max,
  });
  const renderedContextWidth = normalizePaneWidth(
    contextWidth,
    contextWidthBounds.min,
    rightRailOpen ? contextResizeMax : contextOpenResizeMax,
  );

  useEffect(() => {
    if (!macSidebarUsesOverlay) closeMacSidebarOverlay(true);
  }, [closeMacSidebarOverlay, macSidebarUsesOverlay]);

  useEffect(() => {
    closeMacSidebarOverlay();
  }, [activeNav, activeThread?.id, activeView, closeMacSidebarOverlay]);

  useEffect(() => () => clearMacSidebarOverlayCloseTimer(), [clearMacSidebarOverlayCloseTimer]);

  useEffect(() => {
    if (!macSidebarOverlayOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.sidebar, .desktop-window-controls')) return;
      closeMacSidebarOverlay();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMacSidebarOverlay();
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMacSidebarOverlay, macSidebarOverlayOpen]);

  useEffect(() => {
    if (!macSpaceEditorOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && macSpaceEditorRef.current?.contains(target)) return;
      closeSpaceEditor();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSpaceEditor();
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [macSpaceEditorOpen]);

  useEffect(() => {
    const hasActiveCollaboration = Boolean(activeThread?.collaboration?.activeWorkflowId || activeThread?.collaboration?.workflows?.some((workflow) => ['active', 'paused'].includes(workflow.status)));
    const nextTab = hasActiveCollaboration || (activeThread?.executionMode || 'chat') === 'work' ? 'collaboration' : 'files';
    setRightRailTab(nextTab);
  }, [activeThread?.id, activeThread?.executionMode]);

  useEffect(() => {
    if (!isMacDesktop || !window.frakioDesktop?.getAppearance) return undefined;
    let active = true;
    void window.frakioDesktop.setAppearance?.(uiSettings.appearance || 'system').then((state) => {
      if (active) setDesktopAppearanceDark(Boolean(state?.dark));
    });
    const unsubscribe = window.frakioDesktop.onAppearanceChanged?.((state) => {
      if (active) setDesktopAppearanceDark(Boolean(state?.dark));
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isMacDesktop, uiSettings.appearance]);

  useEffect(() => {
    if (!window.frakioDesktop?.getUpdateState) return undefined;
    let active = true;
    void window.frakioDesktop.getUpdateState().then((next) => {
      if (active && next) setDesktopUpdateState(next);
    });
    const unsubscribe = window.frakioDesktop.onUpdateStateChanged?.((next) => {
      if (active && next) setDesktopUpdateState(next);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const persistedSpaceTheme = isMacDesktop || uiSettings.appearance === 'dark'
    ? resolveSpaceThemeForAppearance(activeSpace?.theme, effectiveAppDark)
    : resolveEffectiveSpaceTheme(activeSpace?.theme);
  const activeSpaceTheme = macSpaceEditorOpen
    ? resolveSpaceThemeForAppearance(spaceDraft.theme, effectiveAppDark)
    : persistedSpaceTheme;
  const launchSnapshot = launchMaterialSnapshotRef.current;
  const workspaceMaterialDark = workspaceThemeLoaded ? effectiveAppDark : launchSnapshot.dark;
  const workspaceMaterialTheme = workspaceThemeLoaded
    ? activeSpaceTheme
    : resolveSpaceThemeForAppearance(launchSnapshot.theme, workspaceMaterialDark);
  const workspaceMaterialRgb = hexToRgb(workspaceMaterialTheme.sidebarBg);
  const workspaceMaterialAccentRgb = hexToRgb(workspaceMaterialTheme.accentColor);
  const workspaceMaterialIsDark = workspaceMaterialDark
    || workspaceMaterialTheme.appearance === 'dark'
    || (workspaceMaterialTheme.appearance === 'auto' && isThemeNightTime());
  const workspaceMaterialRailTokens = spaceRailContrastTokens(workspaceMaterialTheme, workspaceMaterialDark);
  const workspaceUsesNativeMaterial = isMacDesktop && workspaceMaterialTheme.colorMode === 'native';
  const workspaceMaterialStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--context-width': `${renderedContextWidth}px`,
    '--space-accent': workspaceMaterialTheme.accentColor,
    '--space-sidebar-bg': workspaceMaterialTheme.sidebarBg,
    '--space-sidebar-rgb': workspaceMaterialRgb,
    '--space-accent-rgb': workspaceMaterialAccentRgb,
    '--space-sidebar-opacity': String(workspaceMaterialTheme.opacity),
    '--space-noise-opacity': String(workspaceMaterialTheme.noise),
    '--space-text': workspaceMaterialIsDark ? '#f7f4ee' : workspaceMaterialTheme.mode === 'crisp' ? '#16231f' : '#21332e',
    '--space-muted': workspaceMaterialIsDark ? '#d1cbc1' : workspaceMaterialTheme.mode === 'crisp' ? '#53605c' : '#6c7a75',
    '--space-rail-text': workspaceMaterialRailTokens.text,
    '--space-rail-muted': workspaceMaterialRailTokens.muted,
    '--rail-edge-rgb': workspaceMaterialIsDark ? '255 255 255' : '17 24 39',
    '--space-shell-bg': workspaceUsesNativeMaterial ? 'transparent' : isMacDesktop ? macThemeBackground(workspaceMaterialTheme) : themeShellBackground(workspaceMaterialTheme),
    '--space-stage-bg': workspaceUsesNativeMaterial ? 'transparent' : isMacDesktop ? macThemeBackground(workspaceMaterialTheme) : themeStageBackground(workspaceMaterialTheme),
    '--app-surface': workspaceMaterialIsDark ? '#181818' : '#fbfbfb',
    '--app-surface-rgb': workspaceMaterialIsDark ? '24 24 24' : '251 251 251',
    ...(spaceEditorReplacesPage ? {
      '--draft-shell-bg': themeShellBackground(spaceDraft.theme),
      '--draft-rail-bg': themeRailBackground(spaceDraft.theme),
      '--draft-stage-bg': themeStageBackground(spaceDraft.theme),
    } : {}),
  } as React.CSSProperties;

  useEffect(() => {
    if (!workspaceThemeLoaded) return;
    const snapshot = { activeSpaceId, theme: persistedSpaceTheme, dark: effectiveAppDark };
    launchMaterialSnapshotRef.current = snapshot;
    writeLaunchMaterialSnapshot(snapshot);
  }, [workspaceThemeLoaded, activeSpaceId, activeSpace?.updatedAt, effectiveAppDark]);

  useEffect(() => {
    const root = threadScrollRef.current;
    if (!root || !visibleMessages.length || !overviewRounds.length) {
      setActiveOverviewRoundId('');
      return undefined;
    }
    const roundIds = new Set(overviewRounds.map((round) => round.id));
    const messageToRound = new Map<string, string>();
    overviewRounds.forEach((round) => round.messageIds.forEach((messageId) => messageToRound.set(messageId, round.id)));
    setActiveOverviewRoundId((current) => current && roundIds.has(current) ? current : overviewRounds[0]?.id || '');
    const observer = new IntersectionObserver((entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const messageId = visibleEntry?.target.getAttribute('data-message-id');
      const roundId = messageId ? messageToRound.get(messageId) : '';
      if (roundId) setActiveOverviewRoundId(roundId);
    }, { root, threshold: [0.2, 0.45, 0.7], rootMargin: '-18% 0px -54% 0px' });
    visibleMessages.forEach((message) => {
      const node = messageRefs.current[message.id];
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [activeThread?.id, visibleMessages.length, overviewRounds.length]);

  useEffect(() => {
    if (activeView === 'new-chat' && globalDefaultAgentId && !newChatAgentId) setNewChatAgentId(globalDefaultAgentId);
  }, [activeView, globalDefaultAgentId, newChatAgentId]);

  useEffect(() => {
    if (!models.length) return undefined;
    let cancelled = false;
    const refreshCapabilities = () => {
      void fetch('/api/model-capabilities').then((response) => response.json()).then((data) => {
        if (!cancelled && data?.capabilities) setModelCapabilities(data.capabilities);
      }).catch(() => {});
    };
    const timer = window.setInterval(refreshCapabilities, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [models.map((model) => `${model.id}:${model.runtimeRevision || ''}`).join('|')]);

  useEffect(() => {
    if (activeNav === 'settings' && settingsSection === 'archivedThreads') void refreshArchivedThreads();
  }, [activeNav, settingsSection]);

  useEffect(() => {
    if (!userProfileLoaded) return;
    const avatarUrl = String(userProfile.avatarUrl || '').trim();
    setLaunchUserAvatarSnapshot(avatarUrl || null);
    writeLaunchUserAvatarSnapshot(avatarUrl || null);
  }, [userProfileLoaded, userProfile.avatarUrl]);

  async function bootstrap() {
    launchOriginRef.current = 'startup';
    launchStartedAtRef.current = Date.now();
    setLaunchPhase('booting');
    setLaunchIssue(null);
    setLaunchInstallJob(null);
    const safeJson = <T,>(url: string): Promise<T | null> => fetch(url).then((res) => res.json()).catch(() => null);
    const [agentData, modelData, capabilityData, stateData, vaultData, spaceData, workspaceData, conversationData, hermesData, hermesBootstrapData, hermesRuntimeData, hermesDiagnosticsData, updatesData, userProfileData, telemetryData] = await Promise.all([
      safeJson<{ agents: Agent[] }>('/api/agents'),
      safeJson<{ models: ModelProfile[] }>('/api/models'),
      safeJson<{ capabilities: Record<string, ModelCapability> }>('/api/model-capabilities'),
      safeJson<{ ui?: WorkbenchUiSettings; integrations?: { hermesStudio?: { selectedProfile?: string } } }>('/api/state'),
      safeJson<{ vaults: Vault[]; defaultVaultId?: string | null; personalVaultId?: string | null }>('/api/vaults'),
      safeJson<{ spaces: Space[]; activeSpaceId?: string | null }>('/api/spaces'),
      safeJson<{ workspaces: Workspace[] }>('/api/workspaces'),
      safeJson<{ conversations: ThreadSummary[] }>('/api/conversations'),
      safeJson<HermesLocalStatus & { error?: string }>('/api/hermes-local/status'),
      safeJson<HermesBootstrapStatus & { error?: string }>('/api/hermes-bootstrap/status'),
      safeJson<HermesRuntimeStatus & { error?: string }>('/api/hermes-runtime/status'),
      safeJson<HermesRuntimeDiagnostics & { error?: string }>('/api/hermes-runtime/diagnostics'),
      safeJson<UpdatesStatus & { error?: string }>('/api/updates/status'),
      safeJson<{ userProfile: UserProfile }>('/api/user-profile'),
      safeJson<TelemetryStatus>('/api/telemetry/status'),
    ]);
    const apiOnline = Boolean(agentData || modelData || stateData || vaultData || spaceData || workspaceData || conversationData || hermesData || hermesBootstrapData || hermesRuntimeData || hermesDiagnosticsData || updatesData || userProfileData);
    if (!apiOnline) {
      setHermesApiAvailability('offline');
      const message = 'Frakio Work 本地管理服务未运行。';
      setHermesError(message);
      setLaunchIssue(launchProblem('local-service', message));
      setActiveThread(null);
      setActiveView('new-chat');
      setLaunchPhase('error');
      return;
    }
    setAgents(agentData?.agents || []);
    setModels(modelData?.models || []);
    setModelCapabilities(capabilityData?.capabilities || {});
    setLibraryCollapsed(Boolean(stateData?.ui?.libraryCollapsed));
    const restoredContextWidth = normalizePaneWidth(
      stateData?.ui?.contextWidth ?? stateData?.ui?.contextWorkWidth ?? stateData?.ui?.contextCompactWidth ?? defaultContextWidth,
      contextWidthBounds.min,
      contextWidthBounds.max,
    );
    const needsContextWidthMigration = typeof stateData?.ui?.contextWidth !== 'number'
      && (typeof stateData?.ui?.contextWorkWidth === 'number' || typeof stateData?.ui?.contextCompactWidth === 'number');
    if (userProfileData?.userProfile) {
      setUserProfile(userProfileData.userProfile);
      setUserProfileLoaded(true);
    }
    setUiSettings({
      sendKey: stateData?.ui?.sendKey || 'enter',
      density: stateData?.ui?.density || 'comfortable',
      appearance: stateData?.ui?.appearance === 'light' || stateData?.ui?.appearance === 'dark' ? stateData.ui.appearance : 'system',
      streamingResponses: stateData?.ui?.streamingResponses !== false,
      showReasoning: stateData?.ui?.showReasoning !== false,
      richToolDescriptions: stateData?.ui?.richToolDescriptions !== false,
      defaultProfile: stateData?.ui?.defaultProfile || stateData?.integrations?.hermesStudio?.selectedProfile || 'default',
      defaultModel: stateData?.ui?.defaultModel || '',
      defaultAgentId: stateData?.ui?.defaultAgentId || '',
      fallbackDecisionAgentId: stateData?.ui?.fallbackDecisionAgentId || stateData?.ui?.defaultAgentId || '',
      newChatPrompt: stateData?.ui?.newChatPrompt || '我们接下来做点什么？',
      defaultPermissionMode: stateData?.ui?.defaultPermissionMode || 'manual',
      contextTriggerTokens: Number(stateData?.ui?.contextTriggerTokens || 500000),
      groupChatTriggerTokens: Number(stateData?.ui?.groupChatTriggerTokens || 100000),
      historyTailMessages: Number(stateData?.ui?.historyTailMessages || 10),
      agentMentionMaxDepth: stateData?.ui?.agentMentionMaxDepth === 'unlimited'
        ? 'unlimited'
        : Math.max(0, Math.floor(Number(stateData?.ui?.agentMentionMaxDepth ?? 2) || 0)),
      sidebarCollapsed: Boolean(stateData?.ui?.sidebarCollapsed),
      sidebarWidth: normalizePaneWidth(stateData?.ui?.sidebarWidth ?? defaultSidebarWidth, sidebarWidthBounds.min, sidebarWidthBounds.max),
      macSidebarWidth: normalizePaneWidth(stateData?.ui?.macSidebarWidth ?? defaultMacSidebarWidth, macSidebarWidthBounds.min, macSidebarWidthBounds.max),
      macSidebarWidthVersion: Number(stateData?.ui?.macSidebarWidthVersion || SIDEBAR_WIDTH_VERSION),
      contextWidth: restoredContextWidth,
      activeSpaceId: stateData?.ui?.activeSpaceId || spaceData?.activeSpaceId || spaceData?.spaces?.[0]?.id || 'space_default',
      collapsedWorkspaceIds: Array.isArray(stateData?.ui?.collapsedWorkspaceIds) ? stateData?.ui?.collapsedWorkspaceIds : [],
      telemetryEnabled: stateData?.ui?.telemetryEnabled === true,
      telemetryNoticeSeenAt: stateData?.ui?.telemetryNoticeSeenAt || '',
    });
    if (telemetryData) setTelemetryStatus(telemetryData);
    setShowTelemetryNotice(!stateData?.ui?.telemetryNoticeSeenAt);
    setSidebarCollapsed(Boolean(stateData?.ui?.sidebarCollapsed));
    setSidebarWidth(normalizePaneWidth(
      isMacDesktop ? stateData?.ui?.macSidebarWidth ?? defaultMacSidebarWidth : stateData?.ui?.sidebarWidth ?? defaultSidebarWidth,
      activeSidebarWidthBounds.min,
      activeSidebarWidthBounds.max,
    ));
    setContextWidth(restoredContextWidth);
    if (needsContextWidthMigration) {
      void fetch('/api/state/ui', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextWidth: restoredContextWidth }),
      });
    }
    if (hermesData || hermesBootstrapData || hermesRuntimeData) setHermesApiAvailability('online');
    else {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行。请用 npm run dev 同时启动 Web 和 API，或单独运行 npm run dev:api。');
    }
    if (hermesData && !hermesData.error) setHermesStatus(hermesData);
    if (hermesBootstrapData && !hermesBootstrapData.error) setHermesBootstrap(hermesBootstrapData);
    if (hermesRuntimeData && !hermesRuntimeData.error) setHermesRuntime(hermesRuntimeData);
    if (hermesDiagnosticsData && !hermesDiagnosticsData.error) setHermesDiagnostics(hermesDiagnosticsData);
    if (updatesData && !updatesData.error) setUpdatesStatus(updatesData);
    setPinnedNav({ ...Object.fromEntries(railNavItems.map((item) => [item.id, true])), ...(stateData?.ui?.pinnedNav || {}) });
    setVaults(vaultData?.vaults || []);
    setDefaultVaultId(vaultData?.defaultVaultId || null);
    setPersonalVaultId(vaultData?.personalVaultId || null);
    setSpaces(spaceData?.spaces || []);
    setActiveSpaceId(stateData?.ui?.activeSpaceId || spaceData?.activeSpaceId || spaceData?.spaces?.[0]?.id || 'space_default');
    setWorkspaceThemeLoaded(true);
    setWorkspaces(workspaceData?.workspaces || []);
    setConversations(conversationData?.conversations || []);
    setActiveThread(null);
    setActiveView('new-chat');
    setNewChatAgentId(stateData?.ui?.defaultAgentId || '');
    if (hermesBootstrapData?.error) {
      const message = hermesBootstrapData.error || 'Hermes 检测失败。';
      setHermesError(message);
      setLaunchIssue(launchProblem('hermes', message));
      setLaunchPhase('error');
      return;
    }
    if (hermesBootstrapData?.status === 'missing') {
      void startHermesInstall();
      return;
    }
    const runtimeStatus = hermesRuntimeData && !hermesRuntimeData.error ? hermesRuntimeData.autoStart?.status : null;
    if (runtimeStatus === 'starting') setLaunchPhase('connecting');
    else scheduleLaunchWelcome();
  }

  function scheduleLaunchWelcome() {
    const elapsed = Date.now() - launchStartedAtRef.current;
    const delay = Math.max(0, 700 - elapsed);
    for (const timer of launchTimersRef.current) window.clearTimeout(timer);
    launchTimersRef.current = [];
    const welcomeTimer = window.setTimeout(() => {
      setLaunchPhase((current) => current === 'done' ? current : 'welcome');
      const doneTimer = window.setTimeout(() => setLaunchPhase('done'), 1450);
      launchTimersRef.current.push(doneTimer);
    }, delay);
    launchTimersRef.current.push(welcomeTimer);
  }

  async function refreshHermesRuntime() {
    const [data, diagnostics] = await Promise.all([
      fetch('/api/hermes-runtime/status').then((res) => res.json()).catch(() => null),
      fetch('/api/hermes-runtime/diagnostics').then((res) => res.json()).catch(() => null),
    ]);
    if (!data) {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行，无法检测 Hermes Runtime。');
      return null;
    }
    setHermesApiAvailability('online');
    if (!data.error) setHermesRuntime(data);
    if (diagnostics && !diagnostics.error) setHermesDiagnostics(diagnostics);
    return data;
  }

  async function startHermesRuntime() {
    setHermesError('');
    const data = await fetch('/api/hermes-runtime/start', { method: 'POST' }).then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (data?.runtime) setHermesRuntime(data.runtime);
    else if (data?.bridge) setHermesRuntime(await refreshHermesRuntime());
    if (data?.error) setHermesError(data.error);
    await refreshHermesStatus();
  }

  async function startHermesProfileGateway(profileName: string) {
    setHermesError('');
    const data = await fetch(`/api/hermes-runtime/profiles/${encodeURIComponent(profileName)}/gateway/start`, { method: 'POST' }).then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (data?.runtime) setHermesRuntime(data.runtime);
    if (data?.error) setHermesError(data.error);
  }

  async function stopHermesProfileGateway(profileName: string) {
    setHermesError('');
    const data = await fetch(`/api/hermes-runtime/profiles/${encodeURIComponent(profileName)}/gateway/stop`, { method: 'POST' }).then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (data?.runtime) setHermesRuntime(data.runtime);
    if (data?.error) setHermesError(data.error);
    if (data?.error) throw new Error(data.error);
  }

  async function refreshUpdatesStatus() {
    const data = await fetch('/api/updates/status').then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (!data?.error) setUpdatesStatus(data);
    else setUpdatesError(data.error);
    return data;
  }

  async function checkHermesRuntimeUpdate() {
    setUpdatesBusy('runtime-check');
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch('/api/hermes-runtime/check-update', { method: 'POST' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '检查 Hermes Runtime 更新失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '检查 Hermes Runtime 更新失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function installHermesRuntime(tag?: string) {
    setUpdatesBusy('runtime-install');
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch('/api/hermes-runtime/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tag ? { tag } : {}),
      });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      setUpdatesResult({ ok: data.ok, target: 'hermes-agent', phase: data.phase, logs: data.logs, error: data.error, runtime: data.runtime });
      if (!res.ok) setUpdatesError(data.error || '安装 Hermes Runtime 失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '安装 Hermes Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function activateHermesRuntime(version: string) {
    setUpdatesBusy(`runtime-activate:${version}`);
    setUpdatesError('');
    try {
      const res = await fetch('/api/hermes-runtime/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '切换 Hermes Runtime 失败。');
      else await refreshHermesStatus();
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '切换 Hermes Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function useBundledHermesRuntime() {
    setUpdatesBusy('runtime-bundled');
    setUpdatesError('');
    try {
      const res = await fetch('/api/hermes-runtime/use-bundled', { method: 'POST' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '恢复内置 Runtime 失败。');
      else await refreshHermesStatus();
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '恢复内置 Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function deleteHermesRuntime(version: string) {
    if (!window.confirm(`删除 Hermes Agent Runtime ${version}？\n\n内置 Runtime 不受影响。`)) return;
    setUpdatesBusy(`runtime-delete:${version}`);
    setUpdatesError('');
    try {
      const res = await fetch(`/api/hermes-runtime/versions/${encodeURIComponent(version)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '删除 Hermes Runtime 失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '删除 Hermes Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function checkDesktopUpdate() {
    if (desktopUpdateState?.supported && window.frakioDesktop?.checkForUpdates) {
      const next = await window.frakioDesktop.checkForUpdates();
      if (next) setDesktopUpdateState(next);
    } else {
      await fetch('/api/app-update/status?refresh=1').catch(() => null);
    }
    await refreshUpdatesStatus();
  }

  async function createHermesBackup() {
    setUpdatesBusy('backup');
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch('/api/updates/hermes-agent/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (!res.ok) setUpdatesError(data.error || '备份失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '备份失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function rollbackHermesBackup(backup: HermesBackup, scopes: RollbackScopes) {
    const targetVersion = backup.before?.displayVersion || backup.before?.tagDescription || shortCommit(backup.before?.commit || '') || '这个版本';
    if (!window.confirm(`回滚到 ${targetVersion}？\n\n当前状态会先创建新的快照，然后恢复所选配置。`)) return;
    setUpdatesBusy(`rollback:${backup.id}`);
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch(`/api/updates/hermes-agent/backups/${encodeURIComponent(backup.id)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes }),
      });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (data.bootstrap) setHermesBootstrap(data.bootstrap);
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) {
        setUpdatesError(data.error || '回滚失败。');
        return;
      }
      await refreshHermesRuntime();
      await refreshHermesStatus();
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '回滚失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function deleteHermesBackup(backup: HermesBackup) {
    if (!window.confirm(`删除这个备份？\n\n路径：${backup.path}\n大小：${formatFileSize(backup.size || 0)}`)) return;
    setUpdatesBusy(`delete:${backup.id}`);
    setUpdatesError('');
    try {
      const res = await fetch(`/api/updates/hermes-agent/backups/${encodeURIComponent(backup.id)}`, { method: 'DELETE' });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (!res.ok) setUpdatesError(data.error || '删除备份失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '删除备份失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function cleanupHermesBackups(mode: 'older-than-30-days' | 'keep-latest-10') {
    const label = mode === 'older-than-30-days' ? '删除 30 天前备份' : '删除除最近 10 条外的旧备份';
    if (!window.confirm(`${label}？\n\n这个操作只清理备份缓存，不影响当前 Hermes 配置。`)) return;
    setUpdatesBusy(`cleanup:${mode}`);
    setUpdatesError('');
    try {
      const res = await fetch('/api/updates/hermes-agent/backups/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (!res.ok) setUpdatesError(data.error || '清理备份失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '清理备份失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  function launchProblem(source: LaunchIssue['source'], message: string): LaunchIssue {
    if (source === 'local-service') {
      return {
        source,
        title: '本地服务未能启动',
        message,
        settingsTarget: 'localConnection',
        actionLabel: '打开本地连接设置',
      };
    }
    return {
      source,
      title: source === 'pi' ? 'Pi 内核未能准备完成' : 'Hermes Agent 未能安装完成',
      message,
      settingsTarget: 'hermesAgent',
      actionLabel: source === 'pi' ? '打开 Pi 设置' : '打开 Hermes Agent 设置',
    };
  }

  function finishLaunchFlow() {
    if (launchOriginRef.current === 'manual') {
      setLaunchPhase('done');
      return;
    }
    scheduleLaunchWelcome();
  }

  function applyHermesInstallSnapshot(job: LaunchInstallJob) {
    setLaunchInstallJob(job);
    if (job.status === 'failed') {
      launchInstallStartingRef.current = false;
      launchInstallEventsRef.current?.close();
      launchInstallEventsRef.current = null;
      const message = String(job.error || job.steps.find((step) => step.status === 'failed')?.detail || '安装过程遇到问题。');
      setHermesError(message);
      setLaunchIssue(launchProblem('hermes', message));
      setLaunchPhase('error');
      return;
    }
    if (job.status !== 'ready' || launchInstallCompletedJobRef.current === job.id) return;
    launchInstallCompletedJobRef.current = job.id;
    launchInstallStartingRef.current = false;
    launchInstallEventsRef.current?.close();
    launchInstallEventsRef.current = null;
    if (job.bootstrap) setHermesBootstrap(job.bootstrap as HermesBootstrapStatus);
    if (job.runtime) setHermesRuntime(job.runtime as HermesRuntimeStatus);
    const timer = window.setTimeout(() => finishLaunchFlow(), 420);
    launchTimersRef.current.push(timer);
  }

  function watchHermesInstallJob(job: LaunchInstallJob) {
    launchInstallEventsRef.current?.close();
    const events = new EventSource(`/api/hermes-bootstrap/install/${encodeURIComponent(job.id)}/events`);
    launchInstallEventsRef.current = events;
    events.addEventListener('install.snapshot', (event) => {
      const payload = JSON.parse((event as MessageEvent).data || '{}');
      if (payload.job) applyHermesInstallSnapshot(payload.job as LaunchInstallJob);
    });
    events.onerror = () => {
      void fetch(`/api/hermes-bootstrap/install/${encodeURIComponent(job.id)}`)
        .then((res) => res.json())
        .then((payload) => {
          if (payload.job) applyHermesInstallSnapshot(payload.job as LaunchInstallJob);
        })
        .catch(() => {
          // EventSource reconnects automatically; a transient disconnect is not an install failure.
        });
    };
  }

  async function startHermesInstall() {
    if (launchInstallStartingRef.current) return;
    launchInstallStartingRef.current = true;
    setLaunchIssue(null);
    setLaunchPhase('installing');
    launchInstallCompletedJobRef.current = '';
    try {
      const res = await fetch('/api/hermes-bootstrap/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'launch' }),
      });
      const data = await res.json();
      if (!res.ok || !data.job) throw new Error(data.error || '无法启动 Hermes Agent 安装任务。');
      const job = data.job as LaunchInstallJob;
      applyHermesInstallSnapshot(job);
      if (job.status === 'running') watchHermesInstallJob(job);
    } catch (error) {
      launchInstallStartingRef.current = false;
      const message = error instanceof Error ? error.message : '无法启动 Hermes Agent 安装任务。';
      setHermesError(message);
      setLaunchIssue(launchProblem('hermes', message));
      setLaunchPhase('error');
    }
  }

  async function runFirstUseGuide({ manual = true } = {}) {
    launchOriginRef.current = manual ? 'manual' : 'startup';
    launchStartedAtRef.current = Date.now();
    setLaunchPhase('booting');
    setLaunchIssue(null);
    setLaunchInstallJob(null);
    setHermesError('');
    try {
      const bootstrapRes = await fetch('/api/hermes-bootstrap/status');
      const bootstrapData = await bootstrapRes.json();
      if (!bootstrapRes.ok) throw new Error(bootstrapData.error || 'Hermes 检测失败。');
      setHermesBootstrap(bootstrapData);
      if (bootstrapData.status === 'missing') {
        await startHermesInstall();
        return;
      }
      const runtimeRes = await fetch('/api/hermes-runtime/start', { method: 'POST' });
      const runtimeData = await runtimeRes.json();
      if (!runtimeRes.ok) throw new Error(runtimeData.error || 'Hermes Runtime 启动失败。');
      if (runtimeData.runtime) setHermesRuntime(runtimeData.runtime);
      await Promise.all([refreshHermesStatus(), refreshHermesRuntime(), refreshOrg()]);
      finishLaunchFlow();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hermes Agent 检测失败。';
      setHermesError(message);
      setLaunchIssue(launchProblem('hermes', message));
      setLaunchPhase('error');
    }
  }

  async function refreshLeftRail() {
    const [spaceData, workspaceData, conversationData] = await Promise.all([
      fetch('/api/spaces').then((res) => res.json()),
      fetch('/api/workspaces').then((res) => res.json()),
      fetch('/api/conversations').then((res) => res.json()),
    ]);
    setSpaces(spaceData.spaces || []);
    setWorkspaces(workspaceData.workspaces || []);
    setConversations(conversationData.conversations || []);
  }

  async function switchSpace(spaceId: string) {
    if (spaceId === activeSpaceId) return;
    if (!closeProfileInspector()) return;
    const currentIndex = spaces.findIndex((space) => space.id === activeSpaceId);
    const nextIndex = spaces.findIndex((space) => space.id === spaceId);
    setSpaceSwitchDirection(nextIndex > currentIndex ? 'right' : 'left');
    setActiveSpaceId(spaceId);
    setSelectedNewChatWorkspaceId(null);
    setProjectPickerOpen(false);
    if (activeThread?.spaceId !== spaceId) {
      setActiveThread(null);
      setActiveView('new-chat');
      setActiveNav('council');
    }
    await fetch(`/api/spaces/${encodeURIComponent(spaceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    setUiSettings((current) => ({ ...current, activeSpaceId: spaceId }));
    window.setTimeout(() => setSpaceSwitchDirection('none'), 190);
  }

  function defaultSpaceDraft(): SpaceDraft {
    return { name: '', iconKind: 'dot', iconValue: '', theme: { ...buildSpaceThemeFromPoint(0.18, 0.72, '#536006', 'soft' as const), colorMode: 'native' } };
  }

  function resetSpaceDraft() {
    setSpaceDraft(defaultSpaceDraft());
    setSpaceColorPoint({ x: 0.18, y: 0.72 });
    setSpaceThemeAdvancedOpen(false);
  }

  function openSpaceCreate() {
    setSpaceEditTargetId(null);
    resetSpaceDraft();
    setSpaceMenuOpen(false);
    setRailContextMenu(null);
    closeMacSidebarOverlay(true);
    setSpaceCreateOpen(true);
  }

  function closeSpaceEditor() {
    setSpaceCreateOpen(false);
    setSpaceEditTargetId(null);
    setRailContextMenu(null);
  }

  function openSpaceEditor(space: Space) {
    const theme = normalizeSpaceTheme(space.theme);
    const primary = primaryGradientColor(theme);
    const kind = spaceIconKind(space);
    setSpaceDraft({
      name: space.name,
      iconKind: kind,
      iconValue: kind === 'dot' ? '' : space.iconValue,
      theme,
    });
    setSpaceColorPoint({ x: primary.x, y: primary.y });
    setSpaceThemeAdvancedOpen(false);
    setSpaceEditTargetId(space.id);
    setSpaceMenuOpen(false);
    setRailContextMenu(null);
    closeMacSidebarOverlay(true);
    setSpaceCreateOpen(true);
  }

  async function submitSpaceDraft() {
    const name = spaceDraft.name.trim();
    if (!name) return;
    const isEditing = Boolean(spaceEditTargetId);
    const res = await fetch(isEditing ? `/api/spaces/${encodeURIComponent(spaceEditTargetId!)}` : '/api/spaces', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...spaceDraft, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || (isEditing ? '工作区保存失败。' : '工作区创建失败。'));
      return;
    }
    const savedSpace = data.space as Space | undefined;
    const nextActiveSpaceId = isEditing ? activeSpaceId : (data.activeSpaceId || savedSpace?.id || activeSpaceId);
    if (savedSpace) {
      setSpaces((current) => {
        const exists = current.some((space) => space.id === savedSpace.id);
        return exists ? current.map((space) => (space.id === savedSpace.id ? savedSpace : space)) : [...current, savedSpace];
      });
    }
    if (!isEditing) {
      setActiveSpaceId(nextActiveSpaceId);
      setUiSettings((current) => ({ ...current, activeSpaceId: nextActiveSpaceId }));
      setActiveThread(null);
      setActiveView('new-chat');
      setActiveNav('council');
    }
    setSpaceCreateOpen(false);
    setSpaceEditTargetId(null);
    setSpaceMenuOpen(false);
    resetSpaceDraft();
    await refreshLeftRail();
    if (!isEditing) setActiveSpaceId(nextActiveSpaceId);
  }

  function updateDraftThemeFromPoint(xValue: number, yValue: number, colorId?: string | null) {
    const { x, y } = clampThemePointToSquare(xValue, yValue);
    const nextColor = colorFromThemePoint(x, y);
    setSpaceColorPoint({ x, y });
    setSelectedThemePresetId(null);
    setSpaceDraft((current) => {
      const activeId = colorId || primaryGradientColor(current.theme).id;
      const colors = normalizeGradientColors(current.theme);
      const active = colors.find((color) => color.id === activeId) || primaryGradientColor(current.theme);
      const promoted = colors.map((color) => ({ ...color, isPrimary: color.id === active.id }));
      const moved = promoted.map((color) => color.id === active.id ? { ...color, x, y, color: nextColor, isPrimary: true } : color);
      const gradientColors = calculateHarmonyColors(moved, 'update', themeHarmony);
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function applyThemePreset(preset: ThemePreset) {
    setSpaceColorPoint(preset.point);
    setSelectedThemePresetId(preset.id);
    setThemeHarmony(preset.harmony);
    const gradientColors = buildPresetGradientColors(preset.colors, preset.point, preset.harmony, preset.type);
    setSpaceDraft((current) => {
      const nextPalette = syncThemeFromGradientColors({
        ...current.theme,
        accentColor: preset.colors[0],
        sidebarBg: mixHexWithWhite(preset.colors[0], current.theme.mode === 'crisp' ? 0.66 : 0.78),
        gradientColors,
      });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function applyDefaultThemePreset() {
    const theme = normalizeSpaceThemePalette(defaultProductSpaceTheme);
    const primary = primaryGradientColor(theme);
    setSpaceColorPoint({ x: primary.x, y: primary.y });
    setSelectedThemePresetId('frakio-default');
    setThemeHarmony('floating');
    setSpaceDraft((current) => ({ ...current, theme: withDraftThemePalette(current.theme, theme) }));
  }

  function changeThemePresetPage(direction: -1 | 1) {
    setThemePresetPage((current) => clampNumber(current + direction, 0, themePresetPages.length - 1));
  }

  function setDraftThemeMode(mode: SpaceTheme['mode']) {
    setSpaceDraft((current) => {
      const nextPalette = syncThemeFromGradientColors({
        ...current.theme,
        mode,
        sidebarBg: mixHexWithWhite(primaryGradientColor(current.theme).color, mode === 'crisp' ? 0.66 : 0.78),
      });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function setDraftThemeAppearance(appearance: SpaceThemeAppearance) {
    setSpaceDraft((current) => {
      const normalized = normalizeSpaceTheme({ ...current.theme, appearance });
      const palette = appearance === 'dark' || (appearance === 'auto' && isThemeNightTime())
        ? normalized.darkTheme!
        : normalized.lightTheme!;
      const primary = primaryGradientColor(palette);
      setSpaceColorPoint({ x: primary.x, y: primary.y });
      return { ...current, theme: { ...palette, colorMode: normalized.colorMode, appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme, renderVersion: normalized.renderVersion } };
    });
  }

  function addDraftThemeColor() {
    setSpaceDraft((current) => {
      const colors = normalizeGradientColors(current.theme);
      if (colors.length >= 3) return current;
      const nextHarmony: ThemeHarmony = colors.length === 1 ? 'complementary' : 'splitComplementary';
      setThemeHarmony(nextHarmony);
      setSelectedThemePresetId(null);
      const nextColors = calculateHarmonyColors(colors, 'add', nextHarmony);
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors: nextColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function removeDraftThemeColor() {
    setSpaceDraft((current) => {
      const colors = normalizeGradientColors(current.theme);
      if (colors.length <= 1) return current;
      const removable = [...colors].reverse().find((color) => !color.isPrimary);
      const remaining = colors.filter((color) => color.id !== removable?.id);
      const nextHarmony: ThemeHarmony = remaining.length === 2 ? 'singleAnalogous' : 'floating';
      setThemeHarmony(nextHarmony);
      setSelectedThemePresetId(null);
      const nextColors = calculateHarmonyColors(remaining, 'remove', nextHarmony);
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors: nextColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function promoteDraftThemeColor(colorId: string) {
    if (themeDragMovedRef.current) return;
    setSelectedThemePresetId(null);
    setSpaceDraft((current) => {
      const colors = normalizeGradientColors(current.theme).map((color) => ({ ...color, isPrimary: color.id === colorId }));
      const nextTheme = syncThemeFromGradientColors({ ...current.theme, gradientColors: calculateHarmonyColors(colors, 'update', themeHarmony) });
      const primary = primaryGradientColor(nextTheme);
      setSpaceColorPoint({ x: primary.x, y: primary.y });
      return { ...current, theme: withDraftThemePalette(current.theme, nextTheme) };
    });
  }

  function randomizeDraftThemeColors() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * 0.44;
    const x = 0.5 + Math.cos(angle) * radius;
    const y = 0.5 + Math.sin(angle) * radius;
    const count = Math.floor(Math.random() * 3) + 1;
    const harmony: ThemeHarmony = count === 1 ? 'floating' : count === 2 ? 'complementary' : 'splitComplementary';
    const primaryColor = colorFromThemePoint(x, y);
    const seedColors = [
      { id: 'primary', color: primaryColor, x, y, isPrimary: true },
      { id: 'secondary_a', color: primaryColor, x, y },
      { id: 'secondary_b', color: primaryColor, x, y },
    ].slice(0, count);
    const gradientColors = count === 1 ? seedColors : calculateHarmonyColors(seedColors, 'update', harmony);
    setSpaceColorPoint({ x, y });
    setThemeHarmony(harmony);
    setSelectedThemePresetId(null);
    setSpaceDraft((current) => {
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function renderDraftIcon(size = 18) {
    if (spaceDraft.iconKind === 'emoji') return <span>{spaceDraft.iconValue || '✨'}</span>;
    if (spaceDraft.iconKind === 'icon') {
      if (spaceDraft.iconValue === 'briefcase') return <Briefcase size={size} />;
      if (spaceDraft.iconValue === 'sparkles') return <Sparkles size={size} />;
      if (spaceDraft.iconValue === 'library') return <Library size={size} />;
      return <Folder size={size} />;
    }
    return <span className="field-dot" />;
  }

  function handleThemePanelPointer(event: React.PointerEvent<HTMLElement>, colorId?: string | null) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.theme-picker-toolbar, .theme-picker-controls, button, input, [role="slider"]')) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    updateDraftThemeFromPoint(x, y, colorId || themeDragColorRef.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleThemeDotPointer(event: React.PointerEvent<HTMLButtonElement>, colorId: string) {
    event.preventDefault();
    event.stopPropagation();
    themeDragColorRef.current = colorId;
    themeDragMovedRef.current = false;
    themeDragStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleThemeDotMove(event: React.PointerEvent<HTMLButtonElement>, colorId: string) {
    if (!themeDragColorRef.current || event.buttons !== 1) return;
    const start = themeDragStartRef.current;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 3) return;
    themeDragMovedRef.current = true;
    const panel = event.currentTarget.closest('.theme-dot-matrix') as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    updateDraftThemeFromPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, colorId);
  }

  function finishThemeDotPointer() {
    themeDragColorRef.current = null;
    themeDragStartRef.current = null;
    window.setTimeout(() => { themeDragMovedRef.current = false; }, 0);
  }

  function setDraftTextureFromPointer(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const rotation = Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2);
    let texture = (rotation * 180 / Math.PI + 90) / 360;
    if (texture < 0) texture += 1;
    texture = Math.round(texture * 16) / 16;
    if (texture === 1) texture = 0;
    setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, texture, noise: texture * 0.35 } }));
  }

  function handleTexturePointerDown(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    textureDragRef.current = true;
    setDraftTextureFromPointer(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleTexturePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!textureDragRef.current || event.buttons !== 1) return;
    setDraftTextureFromPointer(event);
  }

  function finishTexturePointer() {
    textureDragRef.current = false;
  }

  async function refreshArchivedThreads() {
    const data = await fetch('/api/threads/archived').then((res) => res.json()).catch(() => ({ threads: [] }));
    setArchivedThreads(data.threads || []);
  }

  async function refreshInbox() {
    setInboxLoading(true);
    try {
      const data = await requestJson<{ items: InboxItem[]; unreadCount: number; actionRequiredCount: number }>('/api/inbox');
      setInboxItems(data.items || []);
      setInboxUnreadCount(Number(data.unreadCount || 0));
      setInboxActionCount(Number(data.actionRequiredCount || 0));
      setInboxError('');
      return data.items || [];
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : '收件箱读取失败');
      return [];
    } finally {
      setInboxLoading(false);
    }
  }

  async function updateInboxItem(itemId: string, patch: { read?: boolean; resolved?: boolean }) {
    const data = await requestJson<{ item: InboxItem }>(`/api/inbox/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setInboxItems((current) => current.map((item) => item.id === itemId ? { ...item, ...data.item } : item));
    if (patch.read === true) setInboxUnreadCount((count) => Math.max(0, count - (inboxItems.find((item) => item.id === itemId)?.readAt ? 0 : 1)));
    if (patch.resolved === true) setInboxActionCount((count) => Math.max(0, count - (inboxItems.find((item) => item.id === itemId)?.resolvedAt ? 0 : 1)));
    return data.item;
  }

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    void refreshInbox().then((items) => {
      if (disposed) return;
      const cursor = Math.max(0, ...items.map((item) => Number(item.cursor || 0)));
      source = new EventSource(`/api/inbox/events?afterCursor=${cursor}`);
      source.addEventListener('inbox.item', () => { if (!disposed) void refreshInbox(); });
      source.onerror = () => { if (!disposed) setInboxError('收件箱实时连接正在重连…'); };
    });
    return () => {
      disposed = true;
      source?.close();
    };
  }, []);

  async function loadThreads(targetWorkspaceId = workspaceId, preferredThreadId?: string | null, options: { openPreferred?: boolean } = {}) {
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/threads`).then((res) => res.json());
    setThreads(data.threads);
    const targetId = preferredThreadId || data.threads[0]?.id;
    if (targetId && options.openPreferred !== false) await openThread(targetId);
  }

  async function openThread(threadId: string) {
    beginShellSurfaceTransition('council', 'thread', 'conversation');
    const requestRevision = ++openThreadRequestRef.current;
    openThreadAbortRef.current?.abort();
    const controller = new AbortController();
    openThreadAbortRef.current = controller;
    setSelectedThreadId(threadId);
    setOpeningThreadId(threadId);
    setThreadOpenError('');
    setInput('');
    setThreadFollowState(true);
    setActiveView('thread');
    closeMacSidebarOverlay();
    try {
      const response = await fetch(`/api/threads/${threadId}/runs/active`, { signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '对话加载失败');
      if (requestRevision !== openThreadRequestRef.current || controller.signal.aborted) return;
      const confirmedIds = new Set(((data.thread as Thread).messages || []).map((message) => message.id));
      for (const messageId of pendingMessageIds(threadId)) {
        if (confirmedIds.has(messageId)) confirmPendingMessage(threadId, messageId);
      }
      setActiveThread(mergeThreadWithPendingMessages(null, data.thread, pendingMessageIds(threadId)));
      syncThreadSummary(threadId, data.thread);
      applyThreadRunSnapshot(data as ThreadRunStateResponse, false);
      scheduleThreadScrollToLatest();
    } catch (error) {
      if (controller.signal.aborted || requestRevision !== openThreadRequestRef.current) return;
      setThreadOpenError(error instanceof Error ? error.message : '对话加载失败');
    } finally {
      if (requestRevision === openThreadRequestRef.current) setOpeningThreadId('');
      if (openThreadAbortRef.current === controller) openThreadAbortRef.current = null;
    }
  }

  async function loadVaultSummary(vaultId: string) {
    const data = await fetch(`/api/vaults/${vaultId}/summary`).then((res) => res.json());
    setVaultSummary(data);
  }

  async function loadWorkspaceArtifacts(targetWorkspaceId: string) {
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/artifacts`).then((res) => res.json()).catch(() => ({ artifacts: [] }));
    setWorkspaceArtifacts(data.artifacts || []);
  }

  async function persistUi(next: Partial<{ libraryCollapsed: boolean; pinnedNav: PinnedNav; sidebarCollapsed: boolean } & WorkbenchUiSettings>) {
    if ('libraryCollapsed' in next) setLibraryCollapsed(Boolean(next.libraryCollapsed));
    if ('sidebarCollapsed' in next) {
      const collapsed = Boolean(next.sidebarCollapsed);
      setSidebarCollapsed(collapsed);
    }
    const nextSidebarWidth = isMacDesktop ? next.macSidebarWidth : next.sidebarWidth;
    if (typeof nextSidebarWidth === 'number') setSidebarWidth(normalizePaneWidth(nextSidebarWidth, activeSidebarWidthBounds.min, activeSidebarWidthBounds.max));
    if (typeof next.contextWidth === 'number') setContextWidth(normalizePaneWidth(next.contextWidth, contextWidthBounds.min, contextWidthBounds.max));
    if ('pinnedNav' in next && next.pinnedNav) setPinnedNav(next.pinnedNav);
    setUiSettings((current) => ({ ...current, ...(next as WorkbenchUiSettings) }));
    if ('appearance' in next && window.frakioDesktop?.setAppearance) {
      const state = await window.frakioDesktop.setAppearance(next.appearance || 'system');
      setDesktopAppearanceDark(Boolean(state?.dark));
    }
    await fetch('/api/state/ui', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if ('telemetryEnabled' in next || 'telemetryNoticeSeenAt' in next) {
      const status = await fetch('/api/telemetry/status').then((res) => res.json()).catch(() => null);
      if (status) setTelemetryStatus(status);
    }
  }

  async function answerTelemetryConsent(enabled: boolean) {
    const seenAt = new Date().toISOString();
    setShowTelemetryNotice(false);
    await persistUi({ telemetryEnabled: enabled, telemetryNoticeSeenAt: seenAt });
  }

  function toggleDesktopSidebar() {
    if (macSidebarUsesOverlay) {
      if (macSidebarOverlayOpen) closeMacSidebarOverlay();
      else openMacSidebarOverlay();
      return;
    }
    const nextCollapsed = !effectiveSidebarCollapsed;
    void persistUi({ sidebarCollapsed: nextCollapsed });
  }

  function openRightRailTab(tab: RightRailTab) {
    if (!rightRailKind) return;
    setOpenRightRailTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setRightRailTab(tab);
    setNewTabMenuOpen(false);
    void persistUi({
      libraryCollapsed: false,
      contextWidth,
    });
  }

  useEffect(() => {
    const openCollaborationRail = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; workflowId?: string }>).detail;
      if (activeThread && detail?.threadId === activeThread.id && detail.workflowId) setCollaborationTaskRequest({ id: `${detail.workflowId}:${Date.now()}`, threadId: activeThread.id, workflowId: detail.workflowId });
      openRightRailTab('collaboration');
    };
    window.addEventListener('frakio:open-collaboration-rail', openCollaborationRail);
    return () => window.removeEventListener('frakio:open-collaboration-rail', openCollaborationRail);
  }, [rightRailKind, contextWidth, activeThread?.id]);

  useEffect(() => {
    const openTask = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; workflowId?: string; taskId?: string }>).detail;
      if (!detail?.threadId || !detail.taskId || detail.threadId !== activeThread?.id) return;
      setCollaborationTaskRequest({ id: `${detail.workflowId || ''}:${detail.taskId}:${Date.now()}`, threadId: detail.threadId, workflowId: detail.workflowId, taskId: detail.taskId });
      openRightRailTab('collaboration');
    };
    window.addEventListener('frakio:open-collaboration-task', openTask);
    return () => window.removeEventListener('frakio:open-collaboration-task', openTask);
  }, [activeThread?.id, rightRailKind, contextWidth]);

  function closeRightRailTab(tab: RightRailTab) {
    const index = openRightRailTabs.indexOf(tab);
    if (index < 0) return;
    const remaining = openRightRailTabs.filter((item) => item !== tab);
    setOpenRightRailTabs(remaining);
    if (rightRailTab !== tab) return;
    const next = remaining[index] || remaining[index - 1];
    if (next) {
      setRightRailTab(next);
      return;
    }
    setRightRailTab('collaboration');
  }

  function toggleRightRail() {
    if (!rightRailKind) return;
    setNewTabMenuOpen(false);
    void persistUi({ libraryCollapsed: rightRailOpen });
  }

  useEffect(() => {
    setOpenRightRailTabs([]);
    setLibraryCollapsed(true);
  }, [activeThread?.id]);

  function resizeContextWidth(width: number) {
    setContextWidth(normalizePaneWidth(width, contextWidthBounds.min, contextResizeMax));
  }

  function commitContextWidth(width: number) {
    void persistUi({ contextWidth: normalizePaneWidth(width, contextWidthBounds.min, contextResizeMax) });
  }

  function toggleWorkspaceCollapsed(workspaceId: string) {
    const currentIds = uiSettings.collapsedWorkspaceIds || [];
    const nextIds = currentIds.includes(workspaceId)
      ? currentIds.filter((id) => id !== workspaceId)
      : [...currentIds, workspaceId];
    void persistUi({ collapsedWorkspaceIds: nextIds });
  }

  function closeProfileInspector(force = false) {
    if (!force && profileInspectorDirty && !window.confirm('当前编辑内容还没有保存，确定关闭吗？')) return false;
    profileInspectorRequestRef.current += 1;
    setProfileInspector({ target: null, draft: '', original: '', loading: false, saving: false, error: '', errorStage: '', saved: false });
    return true;
  }

  async function openProfileInspector(target: ProfileInspectorTarget) {
    if (profileInspectorDirty && !window.confirm('当前编辑内容还没有保存，确定切换编辑对象吗？')) return;
    const requestId = profileInspectorRequestRef.current + 1;
    profileInspectorRequestRef.current = requestId;
    setProfileInspector({ target, draft: '', original: '', loading: true, saving: false, error: '', errorStage: '', saved: false });
    const query = new URLSearchParams({ kind: target.kind });
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(target.profileName)}/file?${query.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || '读取失败。');
      if (profileInspectorRequestRef.current !== requestId) return;
      setProfileInspector({ target, draft: payload.content || '', original: payload.content || '', loading: false, saving: false, error: '', errorStage: '', saved: false });
    } catch (error) {
      if (profileInspectorRequestRef.current !== requestId) return;
      setProfileInspector({ target, draft: '', original: '', loading: false, saving: false, error: error instanceof Error ? error.message : '读取失败。', errorStage: 'load', saved: false });
    }
  }

  async function saveProfileInspector() {
    const target = profileInspector.target;
    if (!target || profileInspector.saving || profileInspector.loading) return;
    setProfileInspector((current) => ({ ...current, saving: true, error: '', errorStage: '', saved: false }));
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(target.profileName)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: target.kind, content: profileInspector.draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '保存失败。');
      await refreshOrg().catch(() => undefined);
      closeProfileInspector(true);
    } catch (error) {
      setProfileInspector((current) => ({ ...current, saving: false, error: error instanceof Error ? error.message : '保存失败。', errorStage: 'save', saved: false }));
    }
  }

  function changeSettingsSection(section: SettingsSection) {
    if (section === settingsSection) return;
    if (!closeProfileInspector()) return;
    setSettingsSection(section);
  }

  function selectOrgAgent(agentId: string) {
    if (agentId === selectedOrgAgentId) return;
    if (!closeProfileInspector()) return;
    setSelectedOrgAgentId(agentId);
  }

  async function createThread() {
    const fallbackWorkspace = activeWorkspace || visibleWorkspaces[0];
    const targetWorkspaceId = activeThread?.mode === 'workspace' && activeThread.workspaceId ? activeThread.workspaceId : fallbackWorkspace?.id || workspaceId;
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '新的项目对话' }),
    }).then((res) => res.json());
    await refreshLeftRail();
    await loadThreads(targetWorkspaceId, data.thread.id);
  }

  function openProjectModal(mode: 'create' | 'existing' = 'create', purpose: 'create' | 'convert' = 'create') {
    setProjectModalPurpose(purpose);
    setProjectMode(mode);
    setProjectName(purpose === 'convert' && activeThread?.mode === 'direct' ? activeThread.title : '');
    setProjectRootPath('');
    setProjectParentPath('');
    setProjectError('');
    setProjectKnowledgeProfile('personal');
    setProjectModalOpen(true);
  }

  async function selectProjectFolder() {
    const picker = window.frakioDesktop?.selectFolder;
    if (picker) {
      const result = await picker();
      const selectedPath = String(result?.path || result?.filePaths?.[0] || '').trim();
      if (result?.canceled || !selectedPath) return null;
      return selectedPath;
    }
    return new Promise<string | null>((resolve) => {
      directoryPickerResolveRef.current = resolve;
      setDirectoryPicker({ open: true, current: '', parent: '', entries: [], loading: true, error: '' });
      void loadServerDirectory('');
    });
  }

  async function loadServerDirectory(targetPath: string) {
    setDirectoryPicker((current) => ({ ...current, open: true, loading: true, error: '' }));
    try {
      const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
      const response = await fetch(`/api/filesystem/directories${query}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法读取文件夹。');
      setDirectoryPicker({ open: true, current: payload.current, parent: payload.parent || '', entries: payload.entries || [], loading: false, error: '' });
    } catch (error) {
      setDirectoryPicker((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : '无法读取文件夹。' }));
    }
  }

  function closeServerDirectoryPicker(selectedPath: string | null = null) {
    const resolve = directoryPickerResolveRef.current;
    directoryPickerResolveRef.current = null;
    setDirectoryPicker((current) => ({ ...current, open: false }));
    resolve?.(selectedPath);
  }

  function projectNameFromPath(targetPath: string) {
    return targetPath.split(/[\\/]+/).filter(Boolean).at(-1) || '新的项目';
  }

  async function submitWorkspaceProject(payload: Record<string, unknown>) {
    setProjectError('');
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setProjectError(data.error || '项目创建失败。');
      return;
    }
    setProjectModalOpen(false);
    await refreshLeftRail();
    await loadThreads(data.workspace.id, data.thread.id);
  }

  async function submitConvertToProject(payload: Record<string, unknown>) {
    if (!activeThread || activeThread.mode !== 'direct') return;
    setProjectError('');
    const res = await fetch(`/api/threads/${activeThread.id}/convert-to-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setProjectError(data.error || '项目转换失败。');
      return;
    }
    setProjectModalOpen(false);
    await refreshLeftRail();
    await loadThreads(data.workspace.id, data.thread.id);
  }

  async function createWorkspaceProject() {
    const personalKnowledgeDefault = projectKnowledgeProfile === 'team' ? 'off' : 'on';
    const payload = projectMode === 'existing'
      ? { mode: projectMode, rootPath: projectRootPath.trim(), spaceId: activeSpaceId, personalKnowledgeDefault }
      : { mode: projectMode, name: projectName.trim(), parentPath: projectParentPath.trim() || undefined, spaceId: activeSpaceId, personalKnowledgeDefault };
    await submitWorkspaceProject(payload);
  }

  async function chooseExistingProjectFolder() {
    setProjectError('');
    setProjectMode('existing');
    const folderPath = await selectProjectFolder();
    if (!folderPath) {
      if (!window.frakioDesktop?.selectFolder) setProjectMode('existing');
      return;
    }
    setProjectRootPath(folderPath);
    setProjectName(projectNameFromPath(folderPath));
  }

  async function chooseProjectParentFolder() {
    setProjectError('');
    const folderPath = await selectProjectFolder();
    if (!folderPath) return;
    setProjectParentPath(folderPath);
  }

  async function createConversation(primaryAgentId: string | null = null) {
    const primary = agents.find((agent) => agent.id === primaryAgentId);
    const data = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryAgentId, title: primary ? `${primary.name} 对话` : '新的对话', agentModelOverrides: {}, spaceId: activeSpaceId }),
    }).then((res) => res.json());
    await refreshLeftRail();
    await openThread(data.thread.id);
  }

  async function deleteThread(threadId: string) {
    let res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
    let data = await res.json().catch(() => ({}));
    if (!res.ok && data.code === 'ACTIVE_WORKFLOW_EXISTS' && data.workflowId) {
      const shouldEndAndDelete = window.confirm('此对话仍有未结束的协作。是否结束协作并删除对话？');
      if (!shouldEndAndDelete) return;
      const stopped = await fetch(`/api/threads/${threadId}/collaboration/workflows/${data.workflowId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: `delete:${globalThis.crypto.randomUUID()}` }),
      });
      const stoppedData = await stopped.json().catch(() => ({}));
      if (!stopped.ok) {
        window.alert(stoppedData.error || '协作结束失败，对话尚未删除。');
        return;
      }
      res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok) {
      window.alert(data.error || '对话删除失败。');
      return;
    }
    setRailConfirm(null);
    await refreshLeftRail();
    if (activeThread?.id === threadId) {
      if (data.nextThreadId) await openThread(data.nextThreadId);
      else {
        setActiveThread(null);
        setActiveView('new-chat');
      }
    }
  }

  async function patchThread(threadId: string, payload: Record<string, unknown>, showError = true) {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (showError) window.alert(data.error || '对话操作失败。');
      return null;
    }
    await refreshLeftRail();
    if (settingsSection === 'archivedThreads') await refreshArchivedThreads();
    if (activeThread?.id === threadId) {
      if (payload.archived === true) {
        setActiveThread(null);
        setActiveView('new-chat');
      } else {
        setActiveThread(data.thread);
      }
    }
    return data.thread as Thread;
  }

  async function archiveThread(threadId: string) {
    setRailConfirm(null);
    await patchThread(threadId, { archived: true });
  }

  async function restoreThread(threadId: string) {
    await patchThread(threadId, { archived: false });
  }

  async function toggleThreadPinned(thread: ThreadSummary) {
    await patchThread(thread.id, { pinned: !thread.pinnedAt });
  }

  async function renameThread(thread: ThreadSummary) {
    setRailConfirm(null);
    setRenameDialogTarget({ kind: 'thread', id: thread.id, title: thread.title });
  }

  async function patchWorkspace(workspaceId: string, payload: Record<string, unknown>, showError = true) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (showError) window.alert(data.error || '项目操作失败。');
      return null;
    }
    await refreshLeftRail();
    if (activeThread?.workspaceId === workspaceId && payload.archived === true) {
      setActiveThread(null);
      setActiveView('new-chat');
    }
    return data.workspace as Workspace;
  }

  async function toggleWorkspacePinned(workspace: Workspace) {
    await patchWorkspace(workspace.id, { pinned: !workspace.pinnedAt });
  }

  async function renameWorkspace(workspace: Workspace) {
    setRailConfirm(null);
    setRenameDialogTarget({ kind: 'workspace', id: workspace.id, title: workspace.name });
  }

  async function submitRenameDialog(value: string) {
    const target = renameDialogTarget;
    const title = value.trim();
    if (!target || !title || title === target.title) {
      setRenameDialogTarget(null);
      return;
    }
    const renamed = target.kind === 'thread'
      ? await patchThread(target.id, { title }, false)
      : await patchWorkspace(target.id, { name: title }, false);
    if (!renamed) throw new Error(`${target.kind === 'thread' ? '对话' : '项目'}重命名失败，请重试。`);
    setRenameDialogTarget(null);
  }

  async function generateThreadTitle(threadId: string, apply: boolean) {
    const res = await fetch(`/api/threads/${threadId}/title-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.title) throw new Error(data.error || '自动生成标题失败。');
    if (apply) {
      await refreshLeftRail();
      if (activeThread?.id === threadId && data.thread) setActiveThread(data.thread);
    }
    return String(data.title);
  }

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
  }

  async function copyAgentMessage(message: ChatEvent) {
    try {
      await copyText(message.content);
      setMessageActionError(null);
      setCopiedMessageId(message.id);
      if (copiedMessageTimerRef.current !== null) window.clearTimeout(copiedMessageTimerRef.current);
      copiedMessageTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => current === message.id ? '' : current);
        copiedMessageTimerRef.current = null;
      }, 1400);
    } catch {
      setMessageActionError({ messageId: message.id, message: '复制失败，请重试。' });
    }
  }

  async function updateMessageFeedback(message: ChatEvent, value: 'up' | 'down') {
    if (!activeThread || feedbackMessageId) return;
    const threadId = activeThread.id;
    const previousValue = message.feedback ?? null;
    const nextValue = previousValue === value ? null : value;
    setFeedbackMessageId(message.id);
    setMessageActionError(null);
    setActiveThread((current) => current?.id === threadId ? {
      ...current,
      messages: current.messages.map((item) => item.id === message.id ? { ...item, feedback: nextValue } : item),
    } : current);
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(message.id)}/feedback`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: nextValue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.thread) throw new Error(data.error || '反馈保存失败。');
      setActiveThread((current) => current?.id === threadId ? data.thread : current);
    } catch (error) {
      setActiveThread((current) => current?.id === threadId ? {
        ...current,
        messages: current.messages.map((item) => item.id === message.id ? { ...item, feedback: previousValue } : item),
      } : current);
      setMessageActionError({ messageId: message.id, message: error instanceof Error ? error.message : '反馈保存失败。' });
    } finally {
      setFeedbackMessageId('');
    }
  }

  async function branchFromMessage(message: ChatEvent) {
    if (!activeThread || branchingMessageId) return;
    const sourceThreadId = activeThread.id;
    setBranchingMessageId(message.id);
    setMessageActionError(null);
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(sourceThreadId)}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.thread) throw new Error(data.error || '创建分支失败。');
      if (data.snapshot) window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      await refreshLeftRail();
      setInput('');
      setThreadFollowState(true);
      setActiveSpaceId(data.thread.spaceId || activeSpaceId);
      setActiveThread(data.thread);
      setActiveView('thread');
      requestAnimationFrame(() => {
        scrollThreadToLatest('auto');
        requestAnimationFrame(() => {
          document.querySelector<HTMLTextAreaElement>('.composer-shell .mention-textarea-wrap textarea')?.focus();
        });
      });
    } catch (error) {
      setMessageActionError({ messageId: message.id, message: error instanceof Error ? error.message : '创建分支失败。' });
    } finally {
      setBranchingMessageId('');
    }
  }

  async function showInFinder(targetPath: string) {
    if (!targetPath || !window.frakioDesktop?.showItemInFolder) return;
    await window.frakioDesktop.showItemInFolder(targetPath);
  }

  function openRailContextMenu(event: React.MouseEvent, target: RailContextMenuSource) {
    event.preventDefault();
    event.stopPropagation();
    setRailConfirm(null);
    const toMenuRect = (rect: DOMRect): RailContextMenuRect => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    railActionFocusRef.current = anchor?.matches('button') ? anchor : anchor?.querySelector('button') || null;
    const sidebar = anchor?.closest('.sidebar') as HTMLElement | null;
    setRailContextMenu({
      ...target,
      x: event.clientX,
      y: event.clientY,
      anchorRect: anchor ? toMenuRect(anchor.getBoundingClientRect()) : undefined,
      sidebarRect: sidebar ? toMenuRect(sidebar.getBoundingClientRect()) : undefined,
    } as RailContextMenuTarget);
  }

  function openRailDeleteConfirmFromMenu(target: Exclude<RailConfirm, null>) {
    setRailContextMenu(null);
    setRailConfirm(target);
  }

  function cancelRailConfirm() {
    setRailConfirm(null);
    window.requestAnimationFrame(() => railActionFocusRef.current?.focus());
  }

  async function archiveWorkspace(workspaceId: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '项目归档失败。');
      return;
    }
    setRailConfirm(null);
    await refreshLeftRail();
    if (activeThread?.workspaceId === workspaceId) {
      setActiveThread(null);
      setActiveView('new-chat');
    }
  }

  async function deleteWorkspace(workspaceId: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '项目删除失败。');
      return;
    }
    setRailConfirm(null);
    await refreshLeftRail();
    if (activeThread?.workspaceId === workspaceId) {
      setActiveThread(null);
      setActiveView('new-chat');
    }
  }

  function confirmRailAction(target: Exclude<RailConfirm, null>) {
    if (target.kind === 'thread') void deleteThread(target.id);
    else void deleteWorkspace(target.id);
  }

  async function syncHermesApprovalMode(permissionMode: PermissionMode, profileName?: string) {
    const approvalRes = await fetch('/api/hermes-bootstrap/approvals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: permissionMode, profileName: profileName || hermesBootstrap?.approval.profileName || 'default' }),
    });
    const approvalData = await approvalRes.json().catch(() => ({}));
    if (!approvalRes.ok) throw new Error(approvalData.error || '操作权限同步失败。');
    setHermesBootstrap((current) => current ? { ...current, approval: { ...current.approval, profileName: approvalData.approval?.profileName || current.approval.profileName, mode: permissionMode } } : current);
    return approvalData;
  }

  async function patchThreadPermission(threadId: string, permissionMode: PermissionMode, profileName?: string) {
    await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionMode }),
    });
    await syncHermesApprovalMode(permissionMode, profileName);
  }

  async function updateThreadFollowMode(followMode: FollowMode) {
    if (!activeThread) return;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followMode }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function migrateThreadAgentToNative(threadId: string, agentId: string) {
    const response = await fetch(`/api/threads/${threadId}/agents/${agentId}/harness-migration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetHarnessId: 'native', confirm: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      updateRunUi(threadId, (current) => ({ ...current, error: data.error || '迁移到 Frakio Native 失败。', errorCode: data.code || 'HARNESS_MIGRATION_FAILED' }));
      return;
    }
    if (data.thread) setActiveThread((current) => current?.id === threadId ? data.thread : current);
    updateRunUi(threadId, (current) => ({ ...current, error: '', errorCode: '' }));
    await refreshLeftRail();
  }

  async function convertActiveConversationToProject() {
    if (!activeThread || activeThread.mode !== 'direct') return;
    const fallbackName = activeThread.title && activeThread.title !== '新的对话' ? activeThread.title : '新的项目';
    const personalKnowledgeDefault = projectKnowledgeProfile === 'team' ? 'off' : 'on';
    const payload = projectMode === 'existing'
      ? { mode: projectMode, name: projectName.trim() || projectNameFromPath(projectRootPath.trim()) || fallbackName, rootPath: projectRootPath.trim(), spaceId: activeSpaceId, personalKnowledgeDefault }
      : { mode: projectMode, name: projectName.trim() || fallbackName, parentPath: projectParentPath.trim() || undefined, spaceId: activeSpaceId, personalKnowledgeDefault };
    await submitConvertToProject(payload);
  }

  async function runHermesAgentThread(
    threadId: string,
    text: string,
    selectedAgentsForRun: string[],
    startedAt: number,
    target: ChatRunTarget | null,
    runAttachments: Attachment[] = [],
    onAccepted?: () => void,
    options: { suppressUserMessage?: boolean; planExecutionId?: string; messageIntent?: 'chat' | 'collaboration'; messageContext?: MessageContext; clientMessageId?: string } = {},
  ): Promise<Thread | null> {
    resetRunUi(threadId, { isRunning: true, startPending: true, startedAt, target });
    setRunPresentationsByThreadId((current) => ({ ...current, [threadId]: {} }));
    const messageContext = options.messageContext || { browserAnnotations: [], reviewComments: [] };
    const hasMessageContext = Boolean(messageContext.browserAnnotations.length || messageContext.reviewComments.length);
    const clientMessageId = options.clientMessageId || `client-message-${startedAt}`;
    const userDraftMessage: ChatEvent = { id: clientMessageId, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text, attachments: runAttachments, ...(hasMessageContext ? { context: messageContext } : {}) };
    const targetAgent = target?.kind === 'agent' ? target.agent : activeComposerAgent;
    const runtimeId = targetAgent?.id === activeComposerAgent?.id
      ? activeComposerRuntimeId
      : effectiveRuntimeForAgentUi(targetAgent, activeThread);
    if (targetAgent && ['codex', 'claude'].includes(runtimeId)) {
      await requestJson('/api/runtime-preflight', {
        method: 'POST',
        body: JSON.stringify({
          runtimeId,
          agentId: targetAgent.id,
          permissionMode,
          planMode: Boolean(activeProposal),
          modelProfileId: activeThreadModelOverride.split('::')[0] || '',
          modelId: activeThreadModelOverride.split('::')[1] || '',
          attachmentKinds: runAttachments.map((attachment) => attachment.kind),
          workspaceId: activeThread?.workspaceId || '',
        }),
      });
    }
    let completedThread: Thread | null = null;
    let planDraftRun = false;
    const appendMissingRunMessages = (thread: Thread, runId: string, assistantDraft = '') => {
      let nextMessages = [...thread.messages];
      const attachmentIds = runAttachments.map((attachment) => attachment.id).sort().join(',');
      const contextIds = [...messageContext.browserAnnotations, ...messageContext.reviewComments].map((item) => item.id).sort().join(',');
      const hasUserMessage = nextMessages.some((message) => (
        message.agentId === 'user'
        && message.content.trim() === text.trim()
        && (message.attachments || []).map((attachment) => attachment.id).sort().join(',') === attachmentIds
        && [...(message.context?.browserAnnotations || []), ...(message.context?.reviewComments || [])].map((item) => item.id).sort().join(',') === contextIds
      ));
      if (!options.suppressUserMessage && !hasUserMessage) nextMessages = [...nextMessages, userDraftMessage];
      const finalDraft = assistantDraft.trim();
      const hasAssistantResult = nextMessages.some((message) => (
        message.agentId !== 'user'
        && message.agentId !== 'system'
        && (message.externalRunId === runId || (finalDraft && message.content.trim() === finalDraft))
        && message.content.trim()
      ));
      if (!hasAssistantResult && finalDraft && !planDraftRun) {
        const fallbackAgent = target?.agent || agents.find((agent) => selectedAgentsForRun.includes(agent.id)) || agents.find((agent) => agent.id === thread.defaultAgentId) || agents[0];
        nextMessages = [
          ...nextMessages,
          {
            id: `local-${runId || Date.now()}`,
            agentId: fallbackAgent?.id || 'iris',
            agentName: fallbackAgent?.name || 'Iris',
            role: `${fallbackAgent?.role || 'Agent'} / Hermes Agent`,
            content: assistantDraft,
            externalRunId: runId,
          },
        ];
      }
      return nextMessages === thread.messages ? thread : { ...thread, messages: nextMessages };
    };
    const createRes = await fetch(`/api/threads/${threadId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        attachmentIds: runAttachments.map((attachment) => attachment.id),
        browserAnnotationIds: messageContext.browserAnnotations.map((item) => item.id),
        reviewCommentIds: messageContext.reviewComments.map((item) => item.id),
        selectedAgents: selectedAgentsForRun,
        targetAgentId: target?.kind === 'agent' ? target.agent.id : '',
        turnId: `turn-${startedAt}`,
        clientMessageId,
        ...(options.suppressUserMessage ? { suppressUserMessage: true } : {}),
        ...(options.planExecutionId ? { planExecutionId: options.planExecutionId } : {}),
        messageIntent: options.messageIntent || 'chat',
      }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      const detail = [created.error || 'Runtime 运行创建失败。', created.remediation].filter(Boolean).join(' ');
      const error = new Error(formatHermesRuntimeError(detail, target?.agent ? resolveHermesProfileNameForAgent(target.agent, localProfilesForComposer) : activeComposerProfileName, created.details)) as Error & { code?: string; details?: Record<string, unknown> };
      error.code = created.code;
      error.details = created;
      throw error;
    }
    planDraftRun = created.kind === 'plan-drafting';
    updateRunUi(threadId, { startPending: false });
    onAccepted?.();
    if (created.kind === 'steer') {
      completedThread = created.thread as Thread;
      if (completedThread) setActiveThread((current) => current?.id === threadId ? completedThread : current);
      updateRunUi(threadId, { draft: '', isRunning: false, activeRun: null });
      return completedThread;
    }
    const turnId = String(created.turnId || `turn-${startedAt}`);
    const subscriptionKey = runSubscriptionKey(threadId, turnId, String(created.hostRunId || created.runId || ''));
    const acceptedIdentity = resolveRunEventIdentity(created, {
      runId: created.runId,
      hostRunId: created.runId,
      agentId: targetAgent?.id || '',
      agentName: targetAgent?.name || '',
      runtimeId,
    });
    const acceptedAgent = agents.find((agent) => agent.id === acceptedIdentity.agentId) || targetAgent || null;
    const acceptedTarget: ChatRunTarget | null = acceptedAgent ? { kind: 'agent', agent: acceptedAgent } : null;
    const run = { runId: acceptedIdentity.runId, hostRunId: acceptedIdentity.hostRunId, sessionId: created.sessionId, threadId, turnId, agentId: acceptedIdentity.agentId };
    const acceptedPresentation = {
      activeRun: run,
      target: acceptedTarget,
      agentId: acceptedIdentity.agentId,
      agentName: acceptedIdentity.agentName || acceptedAgent?.name || '',
      turnId,
      hostRunId: acceptedIdentity.hostRunId,
      hideStatus: false,
      isRunning: true,
      startPending: false,
      startedAt,
      presentationPhase: 'thinking' as const,
      completed: false,
    };
    ensureRunPresentation(threadId, acceptedIdentity.hostRunId, acceptedPresentation);
    updateRunUi(threadId, acceptedPresentation);
    await new Promise<void>((resolve, reject) => {
      liveRunSubscriptionKeysRef.current.add(subscriptionKey);
      clearRecoveredRunSubscription(subscriptionKey);
      const events = new EventSource(`/api/threads/${threadId}/turns/${turnId}/events`);
      const liveEventKeys = new Set<string>();
      liveRunEventKeysRef.current.set(subscriptionKey, liveEventKeys);
      let settled = false;
      let terminalReceived = false;
      let lastEventCursor = 0;
      let lastRuntimeCursor = 0;
      let finalizationTimer: number | null = null;
      let streamedDraft = '';
      let activeStreamRunId = run.runId;
      const pendingRunDeltas = new Map<string, { text: string; runtimeCursor: number }>();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (finalizationTimer !== null) window.clearTimeout(finalizationTimer);
        finalizationTimer = null;
        events.close();
        liveRunSubscriptionKeysRef.current.delete(subscriptionKey);
        liveRunEventKeysRef.current.delete(subscriptionKey);
        updateRunUi(threadId, {
          approval: null,
          approvalSubmitting: false,
          approvalError: '',
          clarification: null,
          clarificationSubmitting: false,
          clarificationError: '',
          stopping: false,
        });
        if (error) reject(error);
        else resolve();
      };
      const finishAfterReveal = (commit: () => void, error?: Error) => {
        terminalReceived = true;
        events.close();
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const delay = uiSettings.streamingResponses !== false && !reducedMotion && streamedDraft.trim()
          ? STREAM_REVEAL_MAX_LAG_MS
          : 0;
        if (delay === 0) {
          commit();
          finish(error);
          return;
        }
        finalizationTimer = window.setTimeout(() => {
          commit();
          finish(error);
        }, delay);
      };
      events.onerror = () => {
        if (terminalReceived) return;
        void reconcileThreadRun(threadId, true).then((snapshot) => {
          if (settled || !snapshot) return;
          const stillActive = Boolean(snapshot.run && ['queued', 'running', 'interrupting'].includes(snapshot.run.status));
          if (!stillActive) finish();
        });
      };
      const processTurnEvent = (data: any) => {
        if (terminalReceived) return;
        if (!shouldApplyRuntimeEvent(liveEventKeys, data)) return;
        if (data.event === 'run.started') {
          const rawIncomingRunId = String(data.runId || activeStreamRunId);
          const rootIdentityFallback = rawIncomingRunId === activeStreamRunId;
          const eventIdentity = resolveRunEventIdentity(data, {
            runId: rawIncomingRunId,
            hostRunId: rootIdentityFallback ? run.hostRunId : rawIncomingRunId,
            agentId: rootIdentityFallback ? acceptedIdentity.agentId : '',
            agentName: rootIdentityFallback ? acceptedIdentity.agentName : '',
            runtimeId: acceptedIdentity.runtimeId,
          });
          const incomingRunId = eventIdentity.runId;
          const incomingHostRunId = eventIdentity.hostRunId;
          const isRootRun = incomingRunId === activeStreamRunId;
          const routedAgent = agents.find((agent) => agent.id === eventIdentity.agentId);
          const fallbackAgent = routedAgent || (isRootRun ? acceptedAgent : null);
          const routedTarget: ChatRunTarget | null = fallbackAgent ? { kind: 'agent', agent: fallbackAgent } : null;
          const pending = pendingRunDeltas.get(incomingHostRunId);
          pendingRunDeltas.delete(incomingHostRunId);
          const identity = {
            activeRun: {
              runId: incomingRunId,
              hostRunId: incomingHostRunId,
              sessionId: String(data.sessionId || ''),
              threadId,
              turnId,
            },
            target: routedTarget,
            agentId: eventIdentity.agentId || fallbackAgent?.id || '',
            agentName: eventIdentity.agentName || fallbackAgent?.name || '',
            turnId,
            hostRunId: incomingHostRunId,
            hideStatus: false,
            isRunning: true,
            startPending: false,
            startedAt: Date.now(),
            presentationPhase: 'thinking' as const,
            completed: false,
          };
          ensureRunPresentation(threadId, incomingHostRunId, identity);
          if (pending?.text) updateRunPresentation(threadId, incomingHostRunId, (current) => ({
            ...current,
            draft: current.draft + pending.text,
            lastRuntimeCursor: Math.max(current.lastRuntimeCursor, pending.runtimeCursor),
            presentationPhase: 'responding',
          }));
          if (isRootRun) updateRunUi(threadId, (current) => ({ ...current, ...identity }));
          return;
        }
        if (data.event === 'context.compaction.started') {
          const operationId = String(data.operationId || `compaction:${data.runId || activeStreamRunId}`);
          updateRunUi(threadId, (current) => {
            const record = { operationId, status: 'running' as const, tokensBefore: Number(data.tokensBefore) || undefined };
            const records = current.compactionRecords.some((item) => item.operationId === operationId)
              ? current.compactionRecords.map((item) => item.operationId === operationId ? { ...item, ...record } : item)
              : [...current.compactionRecords, record];
            return { ...current, compaction: record, compactionRecords: records, presentationPhase: 'activity' };
          });
          return;
        }
        if (data.event === 'context.compaction.completed' || data.event === 'context.compaction.failed') {
          const operationId = String(data.operationId || `compaction:${data.runId || activeStreamRunId}`);
          const failed = data.event === 'context.compaction.failed';
          updateRunUi(threadId, (current) => {
            const record = {
              operationId,
              status: failed ? 'failed' as const : 'completed' as const,
              tokensBefore: Number(data.tokensBefore) || undefined,
              tokensAfterEstimate: Number(data.tokensAfterEstimate) || undefined,
              error: failed ? String(data.error || '上下文压缩失败。') : undefined,
              originalContextPreserved: failed ? data.originalContextPreserved !== false : undefined,
            };
            const records = current.compactionRecords.some((item) => item.operationId === operationId)
              ? current.compactionRecords.map((item) => item.operationId === operationId ? { ...item, ...record } : item)
              : [...current.compactionRecords, record];
            return { ...current, compaction: record, compactionRecords: records, presentationPhase: failed ? 'activity' : current.presentationPhase };
          });
          return;
        }
        if (data.event === 'message.delta') {
          const delta = String(data.delta || '');
          const rawIncomingRunId = String(data.runId || activeStreamRunId);
          const rootIdentityFallback = rawIncomingRunId === activeStreamRunId;
          const eventIdentity = resolveRunEventIdentity(data, {
            runId: rawIncomingRunId,
            hostRunId: rootIdentityFallback ? run.hostRunId : rawIncomingRunId,
            agentId: rootIdentityFallback ? acceptedIdentity.agentId : '',
            agentName: rootIdentityFallback ? acceptedIdentity.agentName : '',
            runtimeId: acceptedIdentity.runtimeId,
          });
          const incomingRunId = eventIdentity.runId;
          const incomingHostRunId = eventIdentity.hostRunId;
          const runtimeCursor = Math.max(0, Number(data.runtimeCursor || 0) || 0);
          const deltaAgent = agents.find((agent) => agent.id === eventIdentity.agentId) || (incomingRunId === activeStreamRunId ? acceptedAgent : null);
          if (!deltaAgent && incomingRunId !== activeStreamRunId) {
            const pending = pendingRunDeltas.get(incomingHostRunId) || { text: '', runtimeCursor: 0 };
            pendingRunDeltas.set(incomingHostRunId, { text: pending.text + delta, runtimeCursor: Math.max(pending.runtimeCursor, runtimeCursor) });
            return;
          }
          if (incomingRunId === activeStreamRunId) {
            if (runtimeCursor && runtimeCursor <= lastRuntimeCursor) return;
            if (runtimeCursor) lastRuntimeCursor = runtimeCursor;
            streamedDraft += delta;
            updateRunUi(threadId, (current) => ({
              ...current,
              draft: current.draft + delta,
              lastRuntimeCursor: Math.max(current.lastRuntimeCursor, runtimeCursor),
              presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { delta }),
            }));
          }
          updateRunPresentation(threadId, incomingHostRunId, (current) => {
            if (runtimeCursor && runtimeCursor <= current.lastRuntimeCursor) return current;
            return {
              ...current,
              target: current.target || (deltaAgent ? { kind: 'agent', agent: deltaAgent } : null),
              agentId: current.agentId || eventIdentity.agentId || deltaAgent?.id || '',
              agentName: current.agentName || eventIdentity.agentName || deltaAgent?.name || '',
              draft: current.draft + delta,
              lastRuntimeCursor: Math.max(current.lastRuntimeCursor, runtimeCursor),
              isRunning: true,
              presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { delta }),
            };
          });
          return;
        }
        if (data.event === 'tool.running') {
          const incomingRunId = String(data.runId || activeStreamRunId);
          const incomingHostRunId = String(data.hostRunId || (incomingRunId === activeStreamRunId ? run.hostRunId : incomingRunId));
          updateRunPresentation(threadId, incomingHostRunId, (current) => ({
            ...current,
            activityGroups: mergeRunActivityEvent(current.activityGroups, data),
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          if (incomingRunId !== activeStreamRunId) return;
          updateRunUi(threadId, (current) => ({
            ...current,
            activityGroups: mergeRunActivityEvent(current.activityGroups, data),
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          return;
        }
        if (data.event === 'tool.completed') {
          const incomingRunId = String(data.runId || activeStreamRunId);
          const incomingHostRunId = String(data.hostRunId || (incomingRunId === activeStreamRunId ? run.hostRunId : incomingRunId));
          updateRunPresentation(threadId, incomingHostRunId, (current) => ({
            ...current,
            activityGroups: mergeRunActivityEvent(current.activityGroups, data),
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          if (incomingRunId !== activeStreamRunId) return;
          updateRunUi(threadId, (current) => ({
            ...current,
            activityGroups: mergeRunActivityEvent(current.activityGroups, data),
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          return;
        }
        if (data.event === 'changes.updated' && data.changeSet) {
          updateRunUi(threadId, { changeSet: data.changeSet as RunChangeSet });
          return;
        }
        if (data.event === 'approval.request') {
          const normalized = normalizeApprovalPresentation(data);
          const approvalHostRunId = String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId);
          const approvalAgent = agents.find((agent) => agent.id === data.agentId) || null;
          updateRunPresentation(threadId, approvalHostRunId, {
            presentationPhase: 'waiting-input',
            approval: normalized.approval,
            approvalError: normalized.missingId ? '审批信息同步不完整，正在重新获取。' : '',
          });
          updateRunUi(threadId, {
            presentationPhase: 'waiting-input',
            activeRun: {
              runId: String(data.nativeRunId || data.runId || approvalHostRunId),
              hostRunId: approvalHostRunId,
              sessionId: String(data.sessionId || ''),
              threadId,
              turnId,
            },
            target: approvalAgent ? { kind: 'agent', agent: approvalAgent } : null,
            clarification: null,
            clarificationError: '',
            clarificationSubmitting: false,
            approval: normalized.approval,
            approvalError: normalized.missingId ? '审批信息同步不完整，正在重新获取。' : '',
            approvalSubmitting: false,
          });
          if (normalized.missingId) void reconcileThreadRun(threadId, true);
          return;
        }
        if (data.event === 'clarify.request') {
          const normalized = normalizeClarificationPresentation(data);
          const clarificationHostRunId = String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId);
          const clarificationAgent = agents.find((agent) => agent.id === data.agentId) || null;
          updateRunPresentation(threadId, clarificationHostRunId, {
            presentationPhase: 'waiting-input',
            clarification: normalized.clarification,
            clarificationError: normalized.missingId ? '提问信息同步不完整，正在重新获取。' : '',
          });
          updateRunUi(threadId, {
            presentationPhase: 'waiting-input',
            activeRun: {
              runId: String(data.nativeRunId || data.runId || clarificationHostRunId),
              hostRunId: clarificationHostRunId,
              sessionId: String(data.sessionId || ''),
              threadId,
              turnId,
            },
            target: clarificationAgent ? { kind: 'agent', agent: clarificationAgent } : null,
            approval: null,
            approvalError: '',
            approvalSubmitting: false,
            clarification: normalized.clarification,
            clarificationError: normalized.missingId ? '提问信息同步不完整，正在重新获取。' : '',
            clarificationSubmitting: false,
          });
          if (normalized.missingId) void reconcileThreadRun(threadId, true);
          return;
        }
        if (data.event === 'clarify.responded') {
          const clarificationHostRunId = String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId);
          updateRunPresentation(threadId, clarificationHostRunId, (current) => ({
            ...current,
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { hasActivity: current.activityGroups.length > 0 }),
            clarification: null,
            clarificationError: '',
            clarificationSubmitting: false,
          }));
          updateRunUi(threadId, (current) => ({
            ...current,
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { hasActivity: current.activityGroups.length > 0 }),
            clarification: null,
            clarificationError: '',
            clarificationSubmitting: false,
          }));
          return;
        }
        if (data.event === 'approval.responded') {
          const approvalHostRunId = String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId);
          updateRunPresentation(threadId, approvalHostRunId, (current) => ({
            ...current,
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { hasActivity: current.activityGroups.length > 0 }),
            approval: null,
            approvalError: '',
            approvalSubmitting: false,
          }));
          updateRunUi(threadId, (current) => ({
            ...current,
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { hasActivity: current.activityGroups.length > 0 }),
            approval: null,
            approvalError: '',
            approvalSubmitting: false,
          }));
          return;
        }
        if (data.event === 'run.completed') {
          const completedRunId = String(data.runId || activeStreamRunId);
          const completedHostRunId = String(data.hostRunId || (completedRunId === activeStreamRunId ? run.hostRunId : completedRunId));
          updateRunPresentation(threadId, completedHostRunId, (current) => ({ ...current, activityGroups: current.activityGroups.map((group) => ({
            ...group,
            status: group.status === 'running' ? 'completed' : group.status,
            items: group.items.map((item) => item.status === 'running' ? { ...item, status: 'completed' } : item),
            })), presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event), isRunning: false, completed: true, approval: null, approvalSubmitting: false, clarification: null, clarificationSubmitting: false }));
          if (completedRunId === activeStreamRunId) updateRunUi(threadId, (current) => ({ ...current, activityGroups: current.activityGroups.map((group) => ({
            ...group,
            status: group.status === 'running' ? 'completed' : group.status,
            items: group.items.map((item) => item.status === 'running' ? { ...item, status: 'completed' } : item),
          })), presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event) }));
          if (data.thread) {
            const threadFromServer = data.thread as Thread;
            // A successful terminal event is authoritative only after the
            // server has persisted its message. Do not create a second local
            // final message from the streamed draft here.
            const nextThread = appendMissingRunMessages(threadFromServer, completedRunId, '');
            completedThread = nextThread;
            adoptThreadSnapshot(threadId, nextThread);
            const group = (threadFromServer as any).activeRunGroup;
            const hasPendingRoute = Array.isArray(group?.routes) && group.routes.some((route: any) => ['pending', 'starting', 'running'].includes(route.status));
            const hasActiveRoute = Object.keys(group?.activeRuns || {}).length > 0;
            if (!hasPendingRoute && !hasActiveRoute) {
              applyTerminalRunUi(threadId, '', String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId), Number(data.runtimeCursor || 0));
            }
          }
          return;
        }
        if (data.event === 'turn.completed') {
          const finalThread = (data.thread as Thread | undefined) || completedThread;
          if (finalThread) completedThread = finalThread;
          finishAfterReveal(() => {
            if (finalThread) adoptThreadSnapshot(threadId, finalThread);
            applyTerminalRunUi(threadId, '', String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId), Number(data.runtimeCursor || 0));
            updateRunUi(threadId, { draft: '' });
          });
          return;
        }
        if (data.event === 'run.failed' || data.event === 'run.cancelled') {
          const failedRunId = String(data.runId || activeStreamRunId);
          const failedHostRunId = String(data.hostRunId || (failedRunId === activeStreamRunId ? run.hostRunId : failedRunId));
          const formatted = formatHermesRuntimeError(data.error || (data.event === 'run.cancelled' ? '已停止。' : '运行失败。'), activeComposerProfileName, data.details);
          updateRunPresentation(threadId, failedHostRunId, (current) => ({
            ...current,
            isRunning: false,
            completed: true,
            approval: null,
            approvalSubmitting: false,
            clarification: null,
            clarificationSubmitting: false,
            error: data.event === 'run.failed' ? formatted : '',
            errorCode: data.event === 'run.failed' ? String(data.code || data.failureClass || '') : '',
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          if (failedRunId !== activeStreamRunId) {
            if (data.thread) adoptThreadSnapshot(threadId, data.thread as Thread);
            return;
          }
          updateRunUi(threadId, (current) => ({ ...current, activityGroups: current.activityGroups.map((group) => ({
            ...group,
            status: group.status === 'running' ? (data.event === 'run.failed' ? 'failed' : 'cancelled') : group.status,
            items: group.items.map((item) => item.status === 'running' ? { ...item, status: data.event === 'run.failed' ? 'failed' : 'cancelled' } : item),
          })), presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event), error: data.event === 'run.failed' ? formatted : '', errorCode: data.event === 'run.failed' ? String(data.code || data.failureClass || '') : '' }));
          if (data.thread) {
            const nextThread = appendMissingRunMessages(data.thread as Thread, String(data.runId || activeStreamRunId), streamedDraft);
            completedThread = nextThread;
            adoptThreadSnapshot(threadId, nextThread);
          }
          return;
        }
        if (data.event === 'turn.failed' || data.event === 'turn.cancelled') {
          const finalThread = (data.thread as Thread | undefined) || completedThread;
          const formatted = data.event === 'turn.failed'
            ? formatHermesRuntimeError(data.error || '运行失败。', activeComposerProfileName, data.details)
            : '';
          finishAfterReveal(() => {
            if (finalThread) adoptThreadSnapshot(threadId, finalThread);
            applyTerminalRunUi(threadId, formatted, String(data.hostRunId || data.runId || run.hostRunId || activeStreamRunId), Number(data.runtimeCursor || 0), String(data.code || data.failureClass || ''));
            updateRunUi(threadId, { draft: '' });
          }, data.event === 'turn.failed' ? new Error(formatted) : undefined);
          return;
        }
        if (data.event === 'mention.failed') {
          if (data.thread) {
            const nextThread = data.thread as Thread;
            completedThread = nextThread;
            adoptThreadSnapshot(threadId, nextThread);
          }
          return;
        }
      };
      events.onmessage = (event) => {
        if (terminalReceived) return;
        const eventCursor = Math.max(0, Number(event.lastEventId || 0) || 0);
        if (eventCursor && eventCursor <= lastEventCursor) return;
        if (eventCursor) lastEventCursor = eventCursor;
        const data = JSON.parse(event.data || '{}');
        processTurnEvent(data);
      };
    });
    return completedThread;
  }

  async function approveActiveRun(choice: 'once' | 'session' | 'always' | 'deny') {
    if (!activeHermesRun) return;
    if (!runApproval?.id) {
      updateDecisionRunUi({ approvalError: '这次审批缺少 approval_id，请重新发起任务。' });
      return;
    }
    updateDecisionRunUi({ approvalSubmitting: true, approvalError: '' });
    try {
      const hostRunId = activeHermesRun.hostRunId || activeHermesRun.runId;
      const res = await fetch(`/api/runtime-runs/${hostRunId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: choice,
          approvalId: runApproval.id,
          hostRunId,
          sessionId: activeHermesRun.sessionId,
          turnId: activeHermesRun.turnId || '',
          harnessId: decisionRunUi?.target?.kind === 'agent' ? (decisionRunUi.target.agent.runtimePolicy?.defaultHarnessId || (decisionRunUi.target.agent.runtimePolicy?.defaultRuntimeId === 'pi' ? 'native' : decisionRunUi.target.agent.runtimePolicy?.defaultRuntimeId || 'native')) : 'native',
          presentationRevision: decisionRunUi?.presentationRevision || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        updateDecisionRunUi({ approvalError: data.error || '审批响应失败。' });
        return;
      }
      if (data.resolved === false) {
        updateDecisionRunUi({ approvalError: '这次审批已失效，请重新发起任务。' });
        return;
      }
      updateDecisionRunUi({ approval: null });
    } finally {
      updateDecisionRunUi({ approvalSubmitting: false });
    }
  }

  async function respondToActiveClarification(action: 'answer' | 'skip', response = '') {
    if (!activeHermesRun || !runClarification) return;
    if (!runClarification.id) {
      updateDecisionRunUi({ clarificationError: '这次提问缺少 clarify_id，请重新发起任务。' });
      return;
    }
    if (action === 'answer' && !response.trim()) {
      updateDecisionRunUi({ clarificationError: '请输入回答。' });
      return;
    }
    updateDecisionRunUi({ clarificationSubmitting: true, clarificationError: '' });
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clarifyId: runClarification.id, action, response: response.trim(), sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.resolved === false) {
        updateDecisionRunUi({ clarificationError: data.error || '这次提问已失效，请重新发起任务。' });
        return;
      }
      updateDecisionRunUi({ clarification: null });
    } finally {
      updateDecisionRunUi({ clarificationSubmitting: false });
    }
  }

  async function stopActiveRun() {
    if (!activeHermesRun || runStopping) return;
    const { threadId } = activeHermesRun;
    updateRunUi(threadId, { stopping: true, error: '' });
    try {
      const res = await fetch(`/api/threads/${threadId}/runs/${activeHermesRun.hostRunId || activeHermesRun.runId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.thread) setActiveThread((current) => current?.id === threadId ? data.thread as Thread : current);
      if (data.alreadyTerminal || data.run && ['completed', 'failed', 'cancelled'].includes(data.run.status)) {
        applyTerminalRunUi(threadId, data.run?.status === 'failed' ? String(data.run?.error || '运行失败。') : '');
        return;
      }
      if (!res.ok || data.resolved === false) {
        throw new Error(data.error || '这次运行已经结束或无法停止');
      }
    } catch (error) {
      const snapshot = await reconcileThreadRun(threadId, true);
      const stillActive = Boolean(snapshot?.run && ['queued', 'running', 'interrupting'].includes(snapshot.run.status));
      if (stillActive) updateRunUi(threadId, { stopping: snapshot?.run?.status === 'interrupting', error: error instanceof Error ? error.message : '停止运行失败，请重试。' });
    }
  }

  async function startNewChat() {
    const text = newChatInput.trim();
    const runAttachments = attachments.flatMap((item) => item.status === 'ready' && item.attachment ? [item.attachment] : []);
    if (!newChatAgent || !newChatProfileModelValue || newChatStarting || attachments.some((item) => item.status !== 'ready') || (!text && !runAttachments.length)) return;
    const startedAt = Date.now();
    const clientMessageId = typeof crypto.randomUUID === 'function' ? `client-message-${crypto.randomUUID()}` : `client-message-${startedAt}`;
    newChatInputRef.current = '';
    setNewChatInput('');
    setThreadFollowState(true);
    setNewChatStarting(true);
    const target = resolveRunTarget(text, agents, newChatAgent);
    let movedToThread = false;
    let createdThreadId = '';
    try {
      const draftModelOverrides = newChatModelOverride && newChatAgent
        ? { [newChatAgent.id]: newChatModelOverride }
        : {};
      const draftRuntimeOverrides = newChatAgent && newChatRuntimeId !== (newChatAgent.runtimePolicy?.defaultRuntimeId || 'hermes')
        ? { [newChatAgent.id]: newChatRuntimeId }
        : {};
      const draftRunOverrides = newChatAgent && (newChatRunOverride.reasoningEffort || newChatRunOverride.speedMode)
        ? { [newChatAgent.id]: newChatRunOverride }
        : {};
      const titleSeed = text || runAttachments[0]?.name || '新的对话';
      const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `new-work-${Date.now()}`;
      const createResponse = selectedNewChatWorkspaceId
        ? await fetch(`/api/workspaces/${selectedNewChatWorkspaceId}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: titleSeed.slice(0, 40), agentModelOverrides: draftModelOverrides, agentRuntimeOverrides: draftRuntimeOverrides, agentRunOverrides: draftRunOverrides, executionMode: newChatExecutionMode, collaborationMode: newChatPlanEnabled ? 'plan' : 'default', planEnabled: newChatPlanEnabled, messageIntent: newChatCollaborationEnabled ? 'collaboration' : 'chat', coordinatorAgentId: newChatAgent.id, requestId }),
        })
        : await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryAgentId: newChatAgent.id, title: titleSeed.slice(0, 40), agentModelOverrides: draftModelOverrides, agentRuntimeOverrides: draftRuntimeOverrides, agentRunOverrides: draftRunOverrides, spaceId: activeSpaceId, executionMode: newChatExecutionMode, collaborationMode: newChatPlanEnabled ? 'plan' : 'default', planEnabled: newChatPlanEnabled, messageIntent: newChatCollaborationEnabled ? 'collaboration' : 'chat', coordinatorAgentId: newChatAgent.id, requestId }),
        });
      const created = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok) {
        const failure = new Error(created.error || '新对话创建失败。') as Error & { code?: string; details?: Record<string, any> };
        failure.code = created.code;
        failure.details = created.details;
        throw failure;
      }
      const thread = created.thread as Thread;
      createdThreadId = thread.id;
      setCollaborationModeError(null);
      if (created.snapshot) window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: created.snapshot }));
      await patchThreadPermission(thread.id, newChatPermissionMode, newChatProfileName);
      const localUserMessage: ChatEvent = { id: clientMessageId, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text, attachments: runAttachments };
      const optimisticThread = { ...thread, messages: [...thread.messages, localUserMessage] };
      addPendingMessage(thread.id, clientMessageId);
      setInput(newChatInputRef.current);
      newChatInputRef.current = '';
      setNewChatInput('');
      setNewChatModelOverride('');
      setNewChatRunOverride({});
      setNewChatPlanEnabled(false);
      setNewChatCollaborationEnabled(false);
      setActiveView('thread');
      setActiveThread(optimisticThread);
      resetRunUi(thread.id, { isRunning: true, startPending: true, startedAt, target });
      movedToThread = true;
      setNewChatStarting(false);

      // Put the newly-created thread in the rail before the runtime stream starts.
      // The stream promise resolves only after the turn ends, so waiting for it
      // here makes a new conversation invisible during the whole first response.
      if (thread.mode === 'direct') {
        const summary = created.conversation as ThreadSummary | undefined;
        if (summary) {
          setConversations((current) => [{ ...summary, runStatus: 'running', preview: text || summary.preview }, ...current.filter((item) => item.id !== summary.id)]);
        }
      } else if (thread.workspaceId) {
        void loadThreads(thread.workspaceId, thread.id, { openPreferred: false });
      }
      const runAgents = thread.selectedAgents?.length ? thread.selectedAgents : [newChatAgent.id];
      let runAccepted = false;
      try {
        await runHermesAgentThread(thread.id, text, runAgents, startedAt, target, runAttachments, () => {
          runAccepted = true;
          clearAttachmentDrafts();
        }, { clientMessageId, messageIntent: newChatCollaborationEnabled ? 'collaboration' : 'chat' });
      } catch (error) {
        const failure = error as Error & { code?: string };
        if (!runAccepted) {
          confirmPendingMessage(thread.id, clientMessageId);
          applyTerminalRunUi(thread.id, error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。', '', 0, failure.code || '');
          setInput((current) => current || text);
        }
        updateRunUi(thread.id, { error: error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。', errorCode: failure.code || '' });
        await refreshHermesRuntime();
      }
      await refreshLeftRail();
      if (thread.mode === 'workspace' && thread.workspaceId) await loadThreads(thread.workspaceId, thread.id, { openPreferred: false });
    } catch (error) {
      if (!movedToThread) {
        setNewChatInput((current) => {
          const restored = current || text;
          newChatInputRef.current = restored;
          return restored;
        });
      }
      const failure = error as Error & { code?: string; details?: Record<string, any> };
      setCollaborationModeError({ message: failure?.message || '新对话创建失败。', code: failure?.code, details: failure?.details });
      await refreshHermesRuntime();
    } finally {
      setNewChatStarting(false);
    }
  }

  function shellSurfaceKindFor(nextNav: string, nextView: 'thread' | 'new-chat') {
    if (nextNav === 'settings' && nextView !== 'new-chat') return 'floating';
    if (workspaceSurfaceNavIds.has(nextNav) && nextView !== 'new-chat') return 'floating';
    if (nextView === 'new-chat') return 'conversation';
    if (!managementNavIds.has(nextNav) && (activeThread || openingThreadId)) return 'conversation';
    return 'other';
  }

  function clearShellSurfaceTransition() {
    if (shellSurfaceTransitionTimerRef.current !== null) {
      window.clearTimeout(shellSurfaceTransitionTimerRef.current);
      shellSurfaceTransitionTimerRef.current = null;
    }
    setShellSurfaceTransitioning(false);
  }

  function beginShellSurfaceTransition(nextNav: string, nextView: 'thread' | 'new-chat', forcedKind?: 'conversation' | 'floating') {
    const nextKind = forcedKind || shellSurfaceKindFor(nextNav, nextView);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const narrowLayout = window.matchMedia?.('(max-width: 760px)').matches;
    if (reduceMotion || narrowLayout || currentShellSurfaceKind === nextKind || currentShellSurfaceKind === 'other' || nextKind === 'other') {
      clearShellSurfaceTransition();
      return;
    }
    if (shellSurfaceTransitionTimerRef.current !== null) window.clearTimeout(shellSurfaceTransitionTimerRef.current);
    setShellSurfaceTransitioning(true);
    shellSurfaceTransitionTimerRef.current = window.setTimeout(() => {
      shellSurfaceTransitionTimerRef.current = null;
      setShellSurfaceTransitioning(false);
    }, 420);
  }

  function handleShellSurfaceTransitionEnd(event: React.TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'padding-top') return;
    clearShellSurfaceTransition();
  }

  function openNewChatLauncher() {
    if (!closeProfileInspector()) return;
    beginShellSurfaceTransition('council', 'new-chat');
    openThreadAbortRef.current?.abort();
    setSelectedThreadId('');
    setOpeningThreadId('');
    setThreadOpenError('');
    setActiveNav('council');
    setActiveView('new-chat');
    newChatInputRef.current = '';
    setNewChatInput('');
    setNewChatAgentId(globalDefaultAgentId);
    setNewChatRuntimeOverride('');
    setNewChatModelOverride('');
    setNewChatRunOverride({});
    setNewChatAgentPickerOpen(false);
    setSelectedNewChatWorkspaceId(null);
    setProjectPickerOpen(false);
    setNewChatPermissionMode(uiSettings.defaultPermissionMode || 'manual');
    setNewChatPlanEnabled(false);
    setNewChatCollaborationEnabled(false);
    setCollaborationModeError(null);
    void discardAttachmentDrafts();
  }

  function openNavSection(sectionId: string) {
    if (!closeProfileInspector()) return;
    beginShellSurfaceTransition(sectionId, 'thread');
    setActiveView('thread');
    setActiveNav(sectionId);
  }

  function openSettingsSection(section: SettingsSection = 'workbench') {
    if (!closeProfileInspector()) return;
    beginShellSurfaceTransition('settings', 'thread');
    setUserMenuOpen(false);
    setSettingsSection(section);
    setActiveView('thread');
    setActiveNav('settings');
  }

  function returnFromSettings() {
    if (!closeProfileInspector()) return;
    setUserMenuOpen(false);
    if (activeThread) {
      beginShellSurfaceTransition('council', 'thread');
      setActiveNav('council');
      setActiveView('thread');
      return;
    }
    openNewChatLauncher();
  }

  async function openWorkspace(workspace: Workspace) {
    if (!closeProfileInspector()) return;
    if (workspace.spaceId && workspace.spaceId !== activeSpaceId) await switchSpace(workspace.spaceId);
    beginShellSurfaceTransition('council', 'thread');
    setActiveNav('council');
    await loadThreads(workspace.id, workspace.activeThreadId);
  }

  async function openConversation(threadId: string) {
    if (!closeProfileInspector()) return;
    beginShellSurfaceTransition('council', 'thread');
    setActiveNav('council');
    await openThread(threadId);
  }

  async function updateThreadVault(vaultId: string | null) {
    await updateThreadContext({ vaultId });
  }

  async function updateThreadContext(patch: { vaultId?: string | null; personalKnowledgeMode?: 'inherit' | 'on' | 'off' }) {
    if (!activeThread) return;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
    if (data.thread.mode === 'workspace') await loadThreads(data.thread.workspaceId, data.thread.id);
  }

  async function retryHandoff(routeId: string) {
    if (!activeThread) return;
    const response = await fetch(`/api/threads/${activeThread.id}/handoffs/${encodeURIComponent(routeId)}/retry`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      setHermesError(data.error || '转交重试失败。');
      return;
    }
    if (data.thread) setActiveThread(data.thread);
  }

  async function updateThreadPermissionMode(permissionMode: PermissionMode) {
    if (!activeThread) return;
    const previousThread = activeThread;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionMode }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
    try {
      await syncHermesApprovalMode(permissionMode, activeComposerProfileName);
    } catch (error) {
      setActiveThread(previousThread);
      setHermesError(error instanceof Error ? error.message : '操作权限同步失败。');
      return;
    }
  }

  async function updateThreadExecutionMode(mode: 'chat' | 'work') {
    if (!activeThread || modeSwitching || (activeThread.executionMode || 'chat') === mode) return;
    setModeSwitching(true);
    setCollaborationModeError(null);
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, agentId: activeComposerAgent?.id || activeThread.activeAgentId || activeThread.defaultAgentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = new Error(data.error || '模式切换失败。') as Error & { code?: string; details?: Record<string, any> };
        failure.code = data.code;
        failure.details = data.details;
        throw failure;
      }
      setActiveThread(data.thread as Thread);
      if (data.snapshot) window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      await refreshLeftRail();
    } catch (error) {
      const failure = error as Error & { code?: string; details?: Record<string, any> };
      setCollaborationModeError({ message: failure?.message || '协作运行时未准备好。', code: failure?.code, details: failure?.details });
    } finally {
      setModeSwitching(false);
    }
  }

  async function setThreadPlanMode(enabled: boolean) {
    if (!activeThread || planAction) return;
    setPlanAction(enabled ? 'enable' : 'cancel');
    setPlanActionError('');
    try {
      const endpoint = !enabled && activeThread.activePlanId
        ? `/api/threads/${activeThread.id}/plans/${activeThread.activePlanId}/cancel`
        : `/api/threads/${activeThread.id}/collaboration-mode`;
      const res = await fetch(endpoint, {
        method: enabled ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enabled ? { mode: 'plan', authorAgentId: activeComposerAgent?.id || '' } : { source: 'mode_indicator' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '计划模式切换失败。');
      if (data.thread) setActiveThread(data.thread as Thread);
      setPlanFeedbackOpen(false);
      setPlanFeedbackDraft('');
      await refreshLeftRail();
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '计划模式切换失败。');
    } finally {
      setPlanAction('');
    }
  }

  async function answerPlanQuestion(batch: PlanQuestionBatch, answers: Record<string, { selectedLabel?: string; note?: string }>) {
    if (!activeThread || !activeProposal || planAction) return;
    setPlanAction('answer');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${activeProposal.id}/questions/${batch.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '回答提交失败。');
      setActiveThread((current) => current ? {
        ...current,
        planSessions: [...(current.planSessions || []).filter((plan) => plan.id !== data.plan.id), data.plan],
      } : current);
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '回答提交失败。');
    } finally {
      setPlanAction('');
    }
  }

  async function cancelPlanQuestion(batch: PlanQuestionBatch) {
    if (!activeThread || !activeProposal || planAction) return;
    setPlanAction('cancel-question');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${activeProposal.id}/questions/${batch.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'question_tray' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '问题取消失败。');
      setActiveThread((current) => current ? {
        ...current,
        planSessions: [...(current.planSessions || []).filter((plan) => plan.id !== data.plan.id), data.plan],
      } : current);
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '问题取消失败。');
    } finally {
      setPlanAction('');
    }
  }

  async function submitPlanFeedback() {
    if (!activeThread || !activeProposal || !planFeedbackDraft.trim() || planAction) return;
    const feedback = planFeedbackDraft.trim();
    setPlanAction('feedback');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${activeProposal.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '计划反馈提交失败。');
      const nextThread = data.thread as Thread;
      setActiveThread(nextThread);
      setPlanFeedbackDraft('');
      setPlanFeedbackOpen(false);
      const author = agents.find((agent) => agent.id === activeProposal.authorAgentId) || activeComposerAgent;
      const startedAt = Date.now();
      await runHermesAgentThread(
        activeThread.id,
        feedback,
        nextThread.selectedAgents || selectedAgentIds,
        startedAt,
        author ? { kind: 'agent', agent: author } : null,
        [],
        undefined,
        { suppressUserMessage: true },
      );
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '计划反馈提交失败。');
    } finally {
      setPlanAction('');
    }
  }

  async function requestCollaborationRevision(planId: string, feedback: string) {
    if (!activeThread || !feedback.trim() || planAction) return;
    const plan = activeThread.planSessions?.find((item) => item.id === planId);
    if (!plan) return;
    setPlanAction('feedback');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${planId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '协作方案调整失败。');
      const nextThread = data.thread as Thread;
      setActiveThread(nextThread);
      const author = agents.find((agent) => agent.id === plan.authorAgentId) || activeComposerAgent;
      await runHermesAgentThread(activeThread.id, feedback.trim(), nextThread.selectedAgents || selectedAgentIds, Date.now(), author ? { kind: 'agent', agent: author } : null, [], undefined, { suppressUserMessage: true });
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '协作方案调整失败。');
    } finally {
      setPlanAction('');
    }
  }

  async function executePlan(planId: string) {
    if (!activeThread || planAction) return;
    setPlanAction('execute');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${planId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '计划执行启动失败。');
      setActiveThread(data.thread as Thread);
      if (data.kind === 'chat-run') {
        const author = agents.find((agent) => agent.id === data.targetAgentId) || activeComposerAgent;
        const startedAt = Date.now();
        await runHermesAgentThread(
          activeThread.id,
          '',
          activeThread.selectedAgents || selectedAgentIds,
          startedAt,
          author ? { kind: 'agent', agent: author } : null,
          [],
          undefined,
          { suppressUserMessage: true, planExecutionId: planId },
        );
      } else if (data.snapshot) {
        window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      }
      await refreshLeftRail();
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '计划执行启动失败。');
      const latest = await fetch(`/api/threads/${activeThread.id}`).then((response) => response.ok ? response.json() : null).catch(() => null);
      if (latest?.thread) setActiveThread(latest.thread as Thread);
    } finally {
      setPlanAction('');
    }
  }

  async function cancelPlan(planId: string) {
    if (!activeThread || planAction) return;
    setPlanAction('cancel');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${planId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'plan_card' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '计划取消失败。');
      setActiveThread(data.thread as Thread);
      setPlanFeedbackOpen(false);
      setPlanFeedbackDraft('');
      await refreshLeftRail();
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '计划取消失败。');
    } finally {
      setPlanAction('');
    }
  }

  async function addVault(kind: 'personal' | 'project' = 'project', useDefault = false) {
    setVaultError('');
    const value = vaultPathInput.trim();
    if (!value && !(kind === 'personal' && useDefault)) {
      setVaultError('请选择资料库目录。');
      return;
    }
    const res = await fetch('/api/vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: useDefault ? '' : value, kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      setVaultError(data.error || '添加失败。');
      return;
    }
    setVaultPathInput('');
    const vaultData = await fetch('/api/vaults').then((r) => r.json());
    setVaults(vaultData.vaults);
    setDefaultVaultId(vaultData.defaultVaultId || null);
    if (kind === 'project' && activeThread) await updateThreadVault(data.vault.id);
  }

  async function reindexVault(vaultId: string) {
    setVaultError('');
    setVaultBusy((current) => ({ ...current, [vaultId]: 'index' }));
    try {
      const res = await fetch(`/api/vaults/${vaultId}/index`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '索引更新失败。');
      const vaultData = await fetch('/api/vaults').then((response) => response.json());
      setVaults(vaultData.vaults || []);
      setDefaultVaultId(vaultData.defaultVaultId || null);
      if (activeThread?.vaultId === vaultId) await loadVaultSummary(vaultId);
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : '索引更新失败。');
    } finally {
      setVaultBusy((current) => {
        const next = { ...current };
        delete next[vaultId];
        return next;
      });
    }
  }

  async function deleteVault(vault: Vault) {
    const confirmed = window.confirm(`移除 Obsidian 仓库「${vault.name}」？\n\n仅移除 Frakio Work 中的连接和索引，不会删除电脑上的任何文件。`);
    if (!confirmed) return;
    setVaultError('');
    setVaultBusy((current) => ({ ...current, [vault.id]: 'delete' }));
    try {
      const res = await fetch(`/api/vaults/${vault.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '仓库移除失败。');

      setVaults((current) => current.filter((item) => item.id !== vault.id));
      setDefaultVaultId(data.defaultVaultId || null);
      setWorkspaces((current) => current.map((workspace) => workspace.vaultId === vault.id ? { ...workspace, vaultId: null } : workspace));
      setConversations((current) => current.map((thread) => thread.vaultId === vault.id ? { ...thread, vaultId: null, vaultName: '未连接资料库' } : thread));
      setThreads((current) => current.map((thread) => thread.vaultId === vault.id ? { ...thread, vaultId: null, vaultName: '未连接资料库' } : thread));
      setArchivedThreads((current) => current.map((thread) => thread.vaultId === vault.id ? { ...thread, vaultId: null, vaultName: '未连接资料库' } : thread));
      setActiveThread((current) => current?.vaultId === vault.id ? { ...current, vaultId: null, vaultName: '未连接资料库' } : current);
      if (activeThread?.vaultId === vault.id) setVaultSummary(null);
      await refreshLeftRail();
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : '仓库移除失败。');
    } finally {
      setVaultBusy((current) => {
        const next = { ...current };
        delete next[vault.id];
        return next;
      });
    }
  }

  async function resolveLegacyVaultBinding(vault: Vault, action: 'keep' | 'detach') {
    if (action === 'detach' && !window.confirm(`解除「${vault.name}」与旧项目的连接？\n\n不会移动或删除资料库里的文件。`)) return;
    setVaultError('');
    setVaultBusy((current) => ({ ...current, [vault.id]: action }));
    try {
      const response = await fetch(`/api/vaults/${vault.id}/legacy-binding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '旧版绑定处理失败。');
      const vaultData = await fetch('/api/vaults').then((item) => item.json());
      setVaults(vaultData.vaults || []);
      setDefaultVaultId(vaultData.defaultVaultId || null);
      if (action === 'detach') setActiveThread((current) => current?.vaultId === vault.id ? { ...current, vaultId: null, vaultName: '未连接资料库' } : current);
      await refreshLeftRail();
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : '旧版绑定处理失败。');
    } finally {
      setVaultBusy((current) => {
        const next = { ...current };
        delete next[vault.id];
        return next;
      });
    }
  }

  async function saveModel(payload: ModelPayload, modelId?: string, persistedModels?: ModelProfile[]) {
    setModelError('');
    if (persistedModels) {
      setModels(persistedModels);
      const capabilityData = await fetch('/api/model-capabilities').then((response) => response.json()).catch(() => null);
      if (capabilityData?.capabilities) setModelCapabilities(capabilityData.capabilities);
      return true;
    }
    const res = await fetch(modelId ? `/api/models/${modelId}` : '/api/models', {
      method: modelId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setModelError(data.error || '模型添加失败。');
      return false;
    }
    setModels(data.models);
    const capabilityData = await fetch('/api/model-capabilities').then((response) => response.json()).catch(() => null);
    if (capabilityData?.capabilities) setModelCapabilities(capabilityData.capabilities);
    return true;
  }

  async function deleteModel(modelId: string) {
    setModelError('');
    const res = await fetch(`/api/models/${modelId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setModelError(data.error || '模型删除失败。');
      return false;
    }
    setModels(data.models || []);
    if (data.agents) setAgents(data.agents);
    return true;
  }

  async function fetchAvailableModels(baseUrl: string, apiKey: string, context: ModelFetchContext = {}) {
    const res = await fetch('/api/models/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, ...context }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '模型列表获取失败。');
    return { models: data.models as string[], capabilities: (data.capabilities || {}) as Record<string, ModelCapability>, catalog: data.catalog as CatalogInfo | undefined };
  }

  async function refreshHermesStatus() {
    setHermesError('');
    const [localData, bootstrapData] = await Promise.all([
      fetch('/api/hermes-local/status').then((res) => res.json()).catch(() => null),
      fetch('/api/hermes-bootstrap/status').then((res) => res.json()).catch(() => null),
    ]);
    if (!localData && !bootstrapData) {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行。请确认 127.0.0.1:8787 已启动。');
      return null;
    }
    setHermesApiAvailability('online');
    if (localData && !localData.error) setHermesStatus(localData);
    if (bootstrapData && !bootstrapData.error) setHermesBootstrap(bootstrapData);
    if (localData?.error || bootstrapData?.error) setHermesError(localData?.error || bootstrapData?.error || 'Hermes 检测失败。');
    return localData as HermesLocalStatus;
  }

  async function importHermesProfiles() {
    setHermesError('');
    setIsImportingHermes(true);
    try {
      const res = await fetch('/api/hermes-bootstrap/import', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setHermesError(data.error || '导入 Hermes Agent 失败。');
        return;
      }
      setAgents(data.agents || []);
      if (data.bootstrap) setHermesBootstrap(data.bootstrap);
      await refreshHermesStatus();
      await refreshOrg();
    } finally {
      setIsImportingHermes(false);
    }
  }

  async function prepareCollaborationIntent(thread: Thread) {
    const response = await fetch(`/api/threads/${thread.id}/collaboration-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'collaboration',
        purpose: 'collaboration',
        authorAgentId: activeComposerAgent?.id || thread.activeAgentId || thread.defaultAgentId || '',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '协作方案准备失败。');
    if (data.thread) setActiveThread(data.thread as Thread);
    return data.thread as Thread;
  }

  async function startSuggestedCollaboration(message: ChatEvent) {
    if (!activeThread || !message.collaborationSuggestion || collaborationSuggestionStartingId) return;
    setCollaborationSuggestionStartingId(message.id);
    setPlanActionError('');
    try {
      const prepared = await prepareCollaborationIntent(activeThread);
      const author = agents.find((agent) => agent.id === message.collaborationSuggestion?.sourceAgentId) || activeComposerAgent;
      await runHermesAgentThread(
        prepared.id,
        `请根据用户当前目标生成多 Agent 协作方案：${message.collaborationSuggestion.title}\n\n${message.collaborationSuggestion.reason}`,
        prepared.selectedAgents || selectedAgentIds,
        Date.now(),
        author ? { kind: 'agent', agent: author } : null,
        [],
        undefined,
        { suppressUserMessage: true, messageIntent: 'collaboration' },
      );
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '协作方案生成失败。');
    } finally {
      setCollaborationSuggestionStartingId('');
    }
  }

  async function sendMessage() {
    const text = input.trim();
    const runAttachments = attachments.flatMap((item) => item.status === 'ready' && item.attachment ? [item.attachment] : []);
    const runContext = draftContext;
    const hasRunContext = Boolean(runContext.browserAnnotations.length || runContext.reviewComments.length);
    if (isRunning || !activeThread || attachments.some((item) => item.status !== 'ready') || (!text && !runAttachments.length && !hasRunContext)) return;
    let sourceThread = activeThread;
    const collaborationEnabled = collaborationIntentEnabled && !activeWorkflowRunning;
    try {
      if (collaborationEnabled && !activeProposal) {
        sourceThread = await prepareCollaborationIntent(activeThread);
      }
    } catch (error) {
      setPlanActionError(error instanceof Error ? error.message : '协作方案准备失败。');
      return;
    }
    const startedAt = Date.now();
    const clientMessageId = typeof crypto.randomUUID === 'function' ? `client-message-${crypto.randomUUID()}` : `client-message-${startedAt}`;
    const threadId = sourceThread.id;
    const threadWorkspaceId = sourceThread.workspaceId;
    const threadMode = sourceThread.mode;
    setThreadFollowState(true);
    const target = resolveRunTarget(text, agents, activeComposerAgent);
    resetRunUi(threadId, { isRunning: true, startPending: true, startedAt, target });
    const optimisticThread = {
      ...sourceThread,
      messages: [...sourceThread.messages, { id: clientMessageId, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text, attachments: runAttachments, ...(hasRunContext ? { context: runContext } : {}) }],
    };
    addPendingMessage(threadId, clientMessageId);
    setActiveThread(optimisticThread);
    let runAccepted = false;
    try {
      try {
        const routedThread = await runHermesAgentThread(threadId, text, [...selectedAgentIds], startedAt, target, runAttachments, () => {
          runAccepted = true;
          setInput('');
          writeThreadDraft(sourceThread, '');
          clearAttachmentDrafts();
          setDraftContext({ browserAnnotations: [], reviewComments: [] });
          if (collaborationEnabled) setCollaborationIntentByThreadId((current) => ({ ...current, [threadId]: false }));
      }, { messageContext: runContext, clientMessageId, messageIntent: collaborationEnabled ? 'collaboration' : 'chat' });
        if (routedThread) setActiveThread((current) => current?.id === threadId ? routedThread : current);
      } catch (error) {
        const failure = error as Error & { code?: string };
        if (!runAccepted) {
          confirmPendingMessage(threadId, clientMessageId);
          applyTerminalRunUi(threadId, error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。', '', 0, failure.code || '');
          setInput((current) => current || text);
        }
        updateRunUi(threadId, { error: error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。', errorCode: failure.code || '' });
        await refreshHermesRuntime();
      }
      await refreshLeftRail();
      if (threadMode === 'workspace' && threadWorkspaceId) await loadThreads(threadWorkspaceId, threadId, { openPreferred: false });
    } finally { /* Host Run terminal events own composer unlock. */ }
  }

  function clearAttachmentDrafts() {
    attachments.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    setAttachments([]);
    setAttachmentNotice('');
  }

  async function discardAttachmentDrafts() {
    const current = [...attachments];
    clearAttachmentDrafts();
    await Promise.all(current.map((item) => item.attachment
      ? fetch(`/api/attachments/${item.attachment.id}`, { method: 'DELETE' }).catch(() => null)
      : null));
  }

  async function uploadAttachment(localId: string, file: File) {
    setAttachments((current) => current.map((item) => item.localId === localId ? { ...item, status: 'uploading', error: '' } : item));
    try {
      const response = await fetch(`/api/attachments?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.attachment) throw new Error(data.error || '附件上传失败。');
      setAttachments((current) => current.map((item) => item.localId === localId ? { ...item, status: 'ready', attachment: data.attachment, error: '' } : item));
    } catch (error) {
      setAttachments((current) => current.map((item) => item.localId === localId ? { ...item, status: 'error', error: error instanceof Error ? error.message : '附件上传失败。' } : item));
    }
  }

  function handleAttachmentChange(files: FileList | File[] | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const existing = new Set(attachments.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    const unique = selected.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
    const available = Math.max(0, 10 - attachments.length);
    const nextFiles = unique.slice(0, available);
    if (selected.length > nextFiles.length) setAttachmentNotice(available === 0 ? '每条消息最多添加 10 个附件。' : '已忽略重复文件或超出 10 个的附件。');
    else setAttachmentNotice('');
    const existingBytes = attachments.reduce((sum, item) => sum + item.file.size, 0);
    let acceptedBytes = existingBytes;
    const drafts = nextFiles.map((file) => {
      const tooLarge = file.size > 32 * 1024 * 1024;
      const totalTooLarge = acceptedBytes + file.size > 100 * 1024 * 1024;
      if (!tooLarge && !totalTooLarge) acceptedBytes += file.size;
      return {
      localId: crypto.randomUUID(),
      file,
      previewUrl: isBrowserPreviewableImage(file) ? URL.createObjectURL(file) : '',
      status: tooLarge || totalTooLarge ? 'error' as const : 'uploading' as const,
      error: tooLarge ? '单个附件不能超过 32 MiB。' : totalTooLarge ? '单条消息的附件总量不能超过 100 MiB。' : '',
    }; });
    setAttachments((current) => [...current, ...drafts]);
    drafts.filter((draft) => draft.status === 'uploading').forEach((draft) => void uploadAttachment(draft.localId, draft.file));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(localId: string) {
    const target = attachments.find((item) => item.localId === localId);
    if (!target) return;
    if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setAttachments((current) => current.filter((item) => item.localId !== localId));
    if (target.attachment) void fetch(`/api/attachments/${target.attachment.id}`, { method: 'DELETE' }).catch(() => null);
  }

  function retryAttachment(localId: string) {
    const target = attachments.find((item) => item.localId === localId);
    if (!target) return;
    if (target.file.size > 32 * 1024 * 1024) {
      setAttachmentNotice('单个附件不能超过 32 MiB。');
      return;
    }
    const otherBytes = attachments.reduce((sum, item) => item.localId === localId ? sum : sum + item.file.size, 0);
    if (otherBytes + target.file.size > 100 * 1024 * 1024) {
      setAttachmentNotice('单条消息的附件总量不能超过 100 MiB。');
      return;
    }
    void uploadAttachment(localId, target.file);
  }

  function handleAttachmentDragEnter(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    attachmentDragDepthRef.current += 1;
    setAttachmentDragActive(true);
  }

  function handleAttachmentDragOver(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleAttachmentDragLeave(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1);
    if (attachmentDragDepthRef.current === 0) setAttachmentDragActive(false);
  }

  function handleAttachmentDrop(event: React.DragEvent) {
    event.preventDefault();
    attachmentDragDepthRef.current = 0;
    setAttachmentDragActive(false);
    handleAttachmentChange(event.dataTransfer.files);
  }

  async function toggleAgent(agentId: string) {
    if (!activeThread || agentId === 'iris') return;
    const next = selectedAgentIds.includes(agentId)
      ? selectedAgentIds.filter((id) => id !== agentId)
      : [...selectedAgentIds, agentId];
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedAgents: next }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function updateThreadAgentModelOverride(agentId: string, modelId: string) {
    if (!activeThread || !agentId) return;
    const targetAgent = agents.find((agent) => agent.id === agentId);
    if (!targetAgent) return;
    const nextOverrides = { ...(activeThread.agentModelOverrides || {}) };
    if (modelId && resolveModelChoice(modelId, models).model) nextOverrides[agentId] = resolveModelChoice(modelId, models).value;
    else delete nextOverrides[agentId];
    const normalizedOverrides = pruneAgentModelOverrides(nextOverrides, agents, models);
    const currentRunOverride = activeThread.agentRunOverrides?.[agentId] || {};
    const nextChoice = modelId ? resolveModelChoice(modelId, models).value : modelValueForAgent(targetAgent, models, {}, uiSettings.defaultModel);
    const nextCapability = modelCapabilities[nextChoice];
    const nextRunOverride: AgentRunOverride = {
      ...(nextCapability?.reasoningEfforts.includes(currentRunOverride.reasoningEffort || '') ? { reasoningEffort: currentRunOverride.reasoningEffort } : {}),
      ...(currentRunOverride.speedMode === 'standard' || (currentRunOverride.speedMode && nextCapability?.serviceTiers.some((tier) => tier.id === currentRunOverride.speedMode || currentRunOverride.speedMode === 'fast')) ? { speedMode: currentRunOverride.speedMode } : {}),
    };
    const nextRunOverrides = { ...(activeThread.agentRunOverrides || {}) };
    if (nextRunOverride.reasoningEffort || nextRunOverride.speedMode) nextRunOverrides[agentId] = nextRunOverride;
    else delete nextRunOverrides[agentId];
    const response = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentModelOverrides: normalizedOverrides, agentRunOverrides: nextRunOverrides }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.thread) throw new Error(data?.error || '模型设置未保存');
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function updateThreadAgentRunOverride(agentId: string, override: AgentRunOverride) {
    if (!activeThread || !agentId) return;
    const next = { ...(activeThread.agentRunOverrides || {}) };
    if (override.reasoningEffort || override.speedMode) next[agentId] = override;
    else delete next[agentId];
    const response = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentRunOverrides: next }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.thread) throw new Error(data?.error || '运行参数未保存');
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function updateThreadAgentRuntimeOverride(agentId: string, runtimeId: RuntimeId) {
    if (!activeThread || !agentId) return;
    const next = { ...(activeThread.agentRuntimeOverrides || {}) };
    const targetAgent = agents.find((agent) => agent.id === agentId);
    const defaultRuntimeId = effectiveRuntimeForAgentUi(targetAgent, null);
    if (runtimeId && runtimeId !== defaultRuntimeId) next[agentId] = runtimeId;
    else delete next[agentId];
    const response = await fetch(`/api/threads/${activeThread.id}/agents/${agentId}/runtime-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '运行时切换失败');
    setActiveThread((current) => current ? {
      ...current,
      agentRuntimeOverrides: next,
      agentHarnessBindings: data.thread?.agentHarnessBindings || current.agentHarnessBindings,
    } : current);
    await refreshLeftRail();
    return data as { message?: string; resumeCandidate?: boolean };
  }

  function updateNewChatModelOverride(value: string) {
    setNewChatModelOverride(value);
    const effectiveValue = value || (newChatAgent ? modelValueForAgent(newChatAgent, models, {}, uiSettings.defaultModel) : '');
    const capability = modelCapabilities[resolveModelChoice(effectiveValue, models).value];
    setNewChatRunOverride((current) => ({
      ...(capability?.reasoningEfforts.includes(current.reasoningEffort || '') ? { reasoningEffort: current.reasoningEffort } : {}),
      ...(current.speedMode === 'standard' || (current.speedMode && capability?.serviceTiers.some((tier) => tier.id === current.speedMode || current.speedMode === 'fast')) ? { speedMode: current.speedMode } : {}),
    }));
  }

  async function refreshOrg() {
    const data = await fetch('/api/agents').then((res) => res.json());
    setAgents(data.agents);
  }

  async function createAgent(payload: Partial<Agent>) {
    const requestId = agentCreationRequestIdRef.current || crypto.randomUUID();
    agentCreationRequestIdRef.current = requestId;
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, requestId }),
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error || 'Agent 创建失败。');
      return;
    }
    setAgents(data.agents || [data.agent]);
    if (data.runtime) setHermesRuntime(data.runtime);
    setUiSettings((current) => ({ ...current, defaultAgentId: current.defaultAgentId || data.agent.id }));
    setSelectedOrgAgentId(data.agent.id);
    setNewChatAgentId(data.agent.id);
    if (data.gatewayWarning) setHermesError(data.gatewayWarning);
    agentCreationRequestIdRef.current = '';
    setNewAgentOpen(false);
  }

  async function deleteAgent(agentId: string) {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    const profileHint = agent.profileName ? `\n\n会同时删除本地 Profile：${agent.profileName}` : '';
    const ok = window.confirm(`删除 Agent「${agent.name}」？${profileHint}\n\n这个操作会删除本地资料，不能撤销。`);
    if (!ok) return;
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || 'Agent 删除失败。');
      return;
    }
    setEditingAgentId(null);
    if (profileInspector.target?.agentId === agentId) closeProfileInspector(true);
    setSelectedOrgAgentId((current) => current === agentId ? data.agents?.[0]?.id || '' : current);
    await refreshOrg();
  }

  async function updateAgent(agentId: string, payload: Partial<Agent>) {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Agent 保存失败。');
    await refreshOrg();
  }

  function jumpToThreadRound(roundId: string) {
    const targetRound = overviewRounds.find((round) => round.id === roundId);
    if (!targetRound) return;
    isFollowingLatestRef.current = false;
    setIsFollowingLatest(false);
    setHasNewThreadContent(true);
    setActiveOverviewRoundId(roundId);
    messageRefs.current[targetRound.startMessageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function requestWindowControl(action: 'close' | 'minimize' | 'zoom') {
    void window.frakioDesktop?.windowControl?.(action);
  }

  async function startDesktopUpdateDownload() {
    setDesktopUpdatePopoverOpen(false);
    const next = await window.frakioDesktop?.downloadUpdate?.();
    if (next) setDesktopUpdateState(next);
  }

  async function cancelDesktopUpdateDownload() {
    const next = await window.frakioDesktop?.cancelUpdateDownload?.();
    if (next) setDesktopUpdateState(next);
    setDesktopUpdatePopoverOpen(false);
  }

  async function openDownloadedDesktopUpdate() {
    const next = await window.frakioDesktop?.openDownloadedUpdate?.();
    if (next) setDesktopUpdateState(next);
  }

  function changeDesktopUpdatePopover(nextOpen: boolean) {
    if (nextOpen && (desktopUpdateState?.phase === 'available' || desktopUpdateState?.phase === 'error')) {
      void startDesktopUpdateDownload();
      return;
    }
    setDesktopUpdatePopoverOpen(nextOpen);
  }

  const cleanShell = launchPhase !== 'done';
  const workbenchLeftActions = (
    <div className="workbench-window-controls">
      <button
        type="button"
        className="desktop-window-control"
        onClick={toggleDesktopSidebar}
        aria-label={sidebarVisuallyOpen ? '收起侧边栏' : '展开侧边栏'}
        title={sidebarVisuallyOpen ? '收起侧边栏' : '展开侧边栏'}
      >
        {sidebarVisuallyOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
      </button>
      <button type="button" className="desktop-window-control" onClick={openNewChatLauncher} aria-label="新对话" title="新对话">
        <Pencil size={14} />
      </button>
    </div>
  );

  return (
    <>
    <div
      className="workspace-material-backdrop"
      data-appearance={workspaceMaterialDark ? 'dark' : 'light'}
      data-platform={isMacDesktop ? 'darwin' : isWindowsDesktop ? 'win32' : 'web'}
      data-space-color-mode={workspaceMaterialTheme.colorMode === 'native' ? 'native' : 'custom'}
      style={workspaceMaterialStyle}
      aria-hidden="true"
    />
    {isMacDesktop && (
      <header
        className={`mac-window-toolbar mac-global-window-toolbar ${isSettingsNav ? 'is-settings' : ''} ${cleanShell ? 'is-launching' : ''}`}
        data-appearance={effectiveAppDark ? 'dark' : 'light'}
        style={workspaceMaterialStyle}
      >
        <div className="mac-window-drag-region" aria-hidden="true" />
        {!cleanShell && !isSettingsNav && (
          <>
            {workbenchLeftActions}
            {rightRailKind && (
              <>
              {rightRailOpen && openRightRailTabs.length > 0 && <div className="mac-window-workspace-tabs" role="tablist" aria-label="已打开工具">
                {openRightRailTabs.map((tab) => <div className={rightRailTab === tab ? 'mac-window-workspace-tab active' : 'mac-window-workspace-tab'} key={tab} title={rightRailTabMeta[tab].detail}>
                  <button type="button" role="tab" aria-selected={rightRailTab === tab} onClick={() => openRightRailTab(tab)}><RightRailTabIcon tab={tab} /><span>{rightRailTabMeta[tab].title}</span></button>
                  <button type="button" aria-label={`关闭 ${rightRailTabMeta[tab].title}`} onClick={() => closeRightRailTab(tab)}><X size={12} /></button>
                </div>)}
              </div>}
              {rightRailOpen && openRightRailTabs.length > 0 && <div className="mac-window-add-tab">
                <IconTooltipButton
                  active={newTabMenuOpen}
                  ariaLabel="添加工具标签"
                  className="desktop-window-control"
                  onClick={() => setNewTabMenuOpen((open) => !open)}
                  tooltip="添加工具标签"
                >
                  <Plus size={15} />
                </IconTooltipButton>
                {newTabMenuOpen && <div className="mac-window-add-tab-menu" role="menu">
                  {rightRailTabs.map((tab) => <button type="button" key={tab} onClick={() => openRightRailTab(tab)}><RightRailTabIcon tab={tab} size={15} /><span>{rightRailTabMeta[tab].title}</span></button>)}
                </div>}
              </div>}
              {isMacConversationShell && activeThread && <ConversationExternalControls
                thread={activeThread}
                vaults={vaults}
                personalVaultId={personalVaultId}
                overviewOpen={overviewOpen}
                onOverview={() => setOverviewOpen((open) => !open)}
                onUpdate={updateThreadContext}
                onOpenSources={() => { setOverviewOpen(false); openRightRailTab('sources'); }}
                onOpenReview={() => { setOverviewOpen(false); openRightRailTab('review'); }}
              />}
              <div className="mac-window-rail-actions">
                <IconTooltipButton
                  active={rightRailOpen}
                  ariaLabel={rightRailOpen ? '收起右侧栏' : '展开右侧栏'}
                  className="desktop-window-control mac-window-rail-button"
                  onClick={toggleRightRail}
                  tooltip={rightRailOpen ? '收起右侧栏' : '展开右侧栏'}
                >
                  {rightRailOpen ? <PanelRightOpen size={15} /> : <PanelRight size={15} />}
                </IconTooltipButton>
              </div>
              </>
            )}
          </>
        )}
      </header>
    )}
    {!cleanShell && (
    <div data-appearance={effectiveAppDark ? 'dark' : 'light'} data-space-color-mode={activeSpaceTheme.colorMode || 'custom'} className={`app ${isWorkbenchShell ? 'workbench-shell desktop-shell mac-desktop-shell' : ''} ${isDesktopShell ? 'native-desktop-shell' : 'managed-web-shell'} ${isWindowsDesktop ? 'windows-shell' : ''} ${isMacConversationShell ? 'workbench-conversation-shell mac-conversation-shell' : ''} ${isMacDesktop && isWorkspaceSurfaceNav ? 'mac-workspace-surface-shell' : ''} ${['org', 'settings', 'models', 'channels', 'plugins', 'inbox', 'kanban', 'jobs', 'monitoring'].includes(activeNav) || activeView === 'new-chat' || spaceEditorReplacesPage ? 'management-mode' : ''} ${isSettingsNav ? 'settings-mode' : ''} ${isWorkspaceSurfaceNav ? 'workspace-surface-mode' : ''} ${shellSurfaceTransitioning ? 'shell-surface-transitioning' : ''} ${spaceEditorReplacesPage ? 'workspace-create-mode' : ''} ${macSpaceEditorOpen ? 'mac-space-editor-open' : ''} ${rightRailKind ? 'has-right-rail' : ''} ${rightRailOpen ? 'right-rail-open' : ''} ${rightRailOverlaysMain ? 'right-rail-overlay' : ''} ${browserFullWorkspace ? 'browser-full-workspace' : ''} ${activeView === 'new-chat' && !spaceEditorReplacesPage ? 'new-chat-mode' : ''} ${libraryCollapsed ? 'library-collapsed' : ''} ${autoSidebarCollapsed && !spaceEditorReplacesPage ? 'sidebar-auto-collapsed' : ''} ${(isWorkbenchShell || isSettingsNav) && sidebarUsesCollapsedLayout && !spaceEditorReplacesPage ? 'sidebar-collapsed' : ''} ${macSidebarOverlayVisible ? 'mac-sidebar-overlay-visible' : ''} ${macSidebarOverlayOpen ? 'mac-sidebar-overlay-open' : ''} ${macSidebarOverlayClosing ? 'mac-sidebar-overlay-closing' : ''} ${uiSettings.density === 'compact' ? 'compact-density' : ''}`} style={workspaceMaterialStyle} onTransitionEnd={handleShellSurfaceTransitionEnd}>
      {isDesktopShell && !isSettingsNav && (
        <>
          {!isMacWorkspaceSurfaceShell && workbenchLeftActions}
          {rightRailKind && (!isMacConversationShell || !isMacDesktop) && (
            <IconTooltipButton
              className={rightRailOpen ? 'desktop-window-control desktop-right-rail-toggle active' : 'desktop-window-control desktop-right-rail-toggle'}
              onClick={toggleRightRail}
              ariaLabel={rightRailOpen ? '收起资源' : '展开资源'}
              tooltip={rightRailOpen ? '收起资源' : '展开资源'}
            >
              {rightRailOpen ? <PanelRightOpen size={15} /> : <PanelRight size={15} />}
            </IconTooltipButton>
          )}
          {isWindowsDesktop && (
            <div className="desktop-caption-controls" aria-label="窗口控制">
              <button className="desktop-caption-button" type="button" onClick={() => requestWindowControl('minimize')} aria-label="最小化窗口" title="最小化">
                <Minus size={15} />
              </button>
              <button className="desktop-caption-button" type="button" onClick={() => requestWindowControl('zoom')} aria-label="最大化窗口" title="最大化">
                <Maximize2 size={13} />
              </button>
              <button className="desktop-caption-button close" type="button" onClick={() => requestWindowControl('close')} aria-label="关闭窗口" title="关闭">
                <X size={15} />
              </button>
            </div>
          )}
        </>
      )}
      {!isDesktopShell && !isSettingsNav && workbenchLeftActions}
      {isSettingsNav ? (
        <SettingsRail
          activeSection={settingsSection}
          onSectionChange={changeSettingsSection}
          onReturnToConversation={returnFromSettings}
        />
      ) : (
        <>
        <aside
          className={spaceEditorReplacesPage ? 'sidebar workspace-create-rail' : 'sidebar'}
          data-rail-tone={spaceEditorReplacesPage && hexLuminance(spaceDraft.theme.sidebarBg) > 0.72 ? 'light' : 'dark'}
          style={spaceEditorReplacesPage ? {
            '--draft-accent': spaceDraft.theme.accentColor,
            '--draft-sidebar-bg': spaceDraft.theme.sidebarBg,
            '--draft-secondary-a': normalizeGradientColors(spaceDraft.theme)[1]?.color || spaceDraft.theme.sidebarBg,
            '--draft-secondary-b': normalizeGradientColors(spaceDraft.theme)[2]?.color || spaceDraft.theme.accentColor,
            '--draft-theme-bg': themeGradientBackground(spaceDraft.theme),
            '--draft-stage-bg': themeStageBackground(spaceDraft.theme),
            '--draft-rail-bg': themeRailBackground(spaceDraft.theme),
            '--draft-noise': String(spaceDraft.theme.noise),
            '--draft-texture': String(spaceDraft.theme.texture ?? 0),
            '--draft-opacity': String(spaceDraft.theme.opacity),
            ...textureSurfaceVars(spaceDraft.theme, 'rail'),
          } as React.CSSProperties : undefined}
        >
          {spaceEditorReplacesPage ? (
            <>
              <div className="workspace-create-rail-head">
                <div className="workspace-create-window-dots" aria-hidden="true"><i /><i /><i /></div>
                <div className="workspace-create-window-tools">
                  <button onClick={closeSpaceEditor} aria-label="返回" title="返回"><ArrowLeft size={14} /></button>
                  <button onClick={() => setSpaceDraft((current) => ({ ...current, name: '' }))} aria-label="清空名称" title="清空名称"><RefreshCw size={13} /></button>
                </div>
                <span className="workspace-create-icon">
                  <img src={frakioBrandLogoUrl} alt="" />
                </span>
                <h2>{spaceEditTargetId ? 'Edit Space' : 'Create a Space'}</h2>
                <p>{spaceEditTargetId ? 'Adjust this space theme, icon, and identity.' : 'Separate your tabs for life, work, projects, and more.'}</p>
              </div>
              <div className="workspace-create-rail-body">
                <label className="workspace-name-field">
                  <button type="button" onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: current.iconKind === 'dot' ? 'emoji' : current.iconKind === 'emoji' ? 'icon' : 'dot', iconValue: current.iconKind === 'dot' ? '✨' : current.iconKind === 'emoji' ? 'folder' : '' }))} aria-label="切换工作区图标">{renderDraftIcon(14)}</button>
                  <input autoFocus value={spaceDraft.name} onChange={(event) => setSpaceDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Space name..." />
                </label>
                <div className="workspace-icon-picker">
                  <div className="workspace-picker-tabs">
                    <button className={spaceDraft.iconKind === 'dot' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'dot', iconValue: '' }))}>Dot</button>
                    <button className={spaceDraft.iconKind === 'emoji' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'emoji', iconValue: current.iconValue || '✨' }))}>Emoji</button>
                    <button className={spaceDraft.iconKind === 'icon' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'icon', iconValue: 'folder' }))}>Icon</button>
                  </div>
                  <div className={spaceDraft.iconKind === 'dot' ? 'dot-choice-grid' : spaceDraft.iconKind === 'emoji' ? 'emoji-grid' : 'emoji-grid icon-grid'}>
                    {spaceDraft.iconKind === 'dot' ? (
                      <button className="selected" onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'dot', iconValue: '' }))}><span className="field-dot" /></button>
                    ) : (spaceDraft.iconKind === 'emoji' ? spaceEmojiOptions : spaceIconOptions).map((item) => (
                      <button className={spaceDraft.iconValue === item ? 'selected' : ''} key={item} onClick={() => setSpaceDraft((current) => ({ ...current, iconValue: item }))} title={spaceDraft.iconKind === 'icon' ? spaceIconLabels[item] : item}>
                        {spaceDraft.iconKind === 'emoji' ? item : item === 'briefcase' ? <Briefcase size={17} /> : item === 'sparkles' ? <Sparkles size={17} /> : item === 'library' ? <Library size={17} /> : <Folder size={17} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="workspace-create-hint">
                  <Pencil size={14} />
                  <strong>Choose a Theme</strong>
                  <ChevronRight size={14} />
                </div>
              </div>
              <div className="workspace-create-rail-actions">
                <button className="send-btn workspace-create-submit" disabled={!spaceDraft.name.trim()} onClick={() => void submitSpaceDraft()}>{spaceEditTargetId ? 'Save Space' : 'Create Space'}</button>
                <button className="workspace-create-cancel" onClick={closeSpaceEditor}>Cancel</button>
                <div className="workspace-create-space-dots" aria-label="工作区位置预览">
                  {spaces.map((space) => {
                    const isEditingSpace = space.id === spaceEditTargetId;
                    const theme = isEditingSpace ? spaceDraft.theme : normalizeSpaceTheme(space.theme);
                    const kind = isEditingSpace ? spaceDraft.iconKind : spaceIconKind(space);
                    return (
                      <button
                        className={`${space.id === activeSpaceId ? 'active' : ''} ${kind === 'dot' ? 'dot-space' : ''}`}
                        key={space.id}
                        style={{ '--space-accent': theme.accentColor } as React.CSSProperties}
                        type="button"
                        aria-label={space.name}
                      >
                        {isEditingSpace ? renderDraftIcon(15) : <SpaceIconGlyph space={space} />}
                      </button>
                    );
                  })}
                  {!spaceEditTargetId && (
                    <button
                      className={`draft ${spaceDraft.iconKind === 'dot' ? 'dot-space' : ''}`}
                      type="button"
                      style={{ '--space-accent': spaceDraft.theme.accentColor } as React.CSSProperties}
                      aria-label="当前创建的工作区"
                    >
                      {renderDraftIcon(15)}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
          <>
          <div className="rail-actions">
            <button className={activeView === 'new-chat' ? 'rail-action active' : 'rail-action'} onClick={openNewChatLauncher} title="新对话"><Plus size={16} /><span>新对话</span></button>
            <button className="rail-action" title="搜索" onClick={() => setGlobalSearchOpen(true)}><Search size={16} /><span>搜索</span></button>
            {visiblePinnedNav.map((item) => {
              const Icon = item.icon;
              return (
                <button className={activeNav === item.id && activeView !== 'new-chat' ? 'rail-action active' : 'rail-action'} key={item.id} onClick={() => openNavSection(item.id)} title={item.label} aria-label={item.label}>
                  <Icon size={16} /><span>{item.label}</span>{item.id === 'inbox' && (inboxActionCount || inboxUnreadCount) > 0 && <em className={inboxActionCount ? 'rail-action-badge action' : 'rail-action-badge'}>{inboxActionCount || inboxUnreadCount}</em>}
                </button>
              );
            })}
          </div>
          <div className="space-divider" />
          <div className={`space-content-viewport switching-${spaceSwitchDirection}`}>
          <div className="sidebar-scroll" key={activeSpaceId}>
            <section className="rail-section">
              <div className="rail-section-head"><span>项目</span><button className="mini-add" onClick={() => openProjectModal('create')} aria-label="新建项目"><Plus size={14} /></button></div>
              <div className="rail-list">
                {visibleWorkspaces.length ? visibleWorkspaces.map((workspace) => {
                  const workspaceThreads = workspace.threads || [];
                  const hasThreads = workspaceThreads.length > 0;
                  const collapsed = (uiSettings.collapsedWorkspaceIds || []).includes(workspace.id);
                  const active = activeView !== 'new-chat' && workspace.id === activeThread?.workspaceId && activeThread?.mode === 'workspace';
                  return (
                    <div className="rail-item project" key={workspace.id}>
                      <div
                        className={active ? 'rail-project-row active' : 'rail-project-row'}
                        data-rail-hover-row
                        onContextMenu={(event) => openRailContextMenu(event, { kind: 'workspace', workspace })}
                      >
                        {hasThreads && (
                          <button
                            className="project-collapse-toggle"
                            onClick={(event) => { event.stopPropagation(); toggleWorkspaceCollapsed(workspace.id); }}
                            aria-label={collapsed ? `展开项目 ${workspace.name}` : `收起项目 ${workspace.name}`}
                            aria-expanded={!collapsed}
                            title={collapsed ? '展开项目' : '收起项目'}
                          >
                            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                        {!hasThreads && <Folder className="project-folder-icon" size={14} aria-hidden="true" />}
                        <button className="rail-main project-main" onClick={() => void openWorkspace(workspace)} aria-label={`项目 ${workspace.name}`}>
                          <RailScrollingTitle title={workspace.name} className="rail-project-title" />
                        </button>
                        <button
                          className="rail-more-button"
                          onClick={(event) => openRailContextMenu(event, { kind: 'workspace', workspace })}
                          aria-label={`更多项目操作：${workspace.name}`}
                          title="更多"
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      </div>
                      {hasThreads && !collapsed && (
                        <div className="project-thread-list">
                          {workspaceThreads.map((thread) => (
                            <div className={activeView !== 'new-chat' && thread.id === (selectedThreadId || activeThread?.id) ? 'rail-subitem active' : 'rail-subitem'} data-rail-hover-row key={thread.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'thread', thread })}>
                              <ThreadRailContent thread={thread} agents={agents} onOpen={() => void openConversation(thread.id)} onMore={(event) => openRailContextMenu(event, { kind: 'thread', thread })} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }) : <div className="empty-rail">这个工作区还没有项目。</div>}
              </div>
            </section>

            <section className="rail-section">
              <div className="rail-section-head"><span>对话</span><button className="mini-add" onClick={openNewChatLauncher} aria-label="新建单聊"><Plus size={14} /></button></div>
              <div className="rail-list">
                {visibleConversations.length ? visibleConversations.map((thread) => (
                  <div className={activeView !== 'new-chat' && thread.id === (selectedThreadId || activeThread?.id) ? 'rail-item active' : 'rail-item'} data-rail-hover-row key={thread.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'thread', thread })}>
                    <ThreadRailContent thread={thread} agents={agents} onOpen={() => void openConversation(thread.id)} onMore={(event) => openRailContextMenu(event, { kind: 'thread', thread })} />
                  </div>
                )) : <div className="empty-rail">这个工作区还没有单 Agent 对话。</div>}
              </div>
            </section>
          </div>
          </div>
          <div className="space-switcher">
            <div className="space-switcher-list">
              {spaces.map((space) => (
                <button
                  className={`${space.id === activeSpaceId ? 'space-pill active' : 'space-pill'} ${spaceIconKind(space) === 'dot' ? 'dot-space' : ''}`}
                  key={space.id}
                  onClick={() => void switchSpace(space.id)}
                  onContextMenu={(event) => openRailContextMenu(event, { kind: 'space', space })}
                  title={space.name}
                  aria-label={`切换到工作区 ${space.name}`}
                >
                  <SpaceIconGlyph space={space} />
                </button>
              ))}
              <div className="space-add-wrap">
                <AppMenu open={spaceMenuOpen} onOpenChange={setSpaceMenuOpen}>
                  <AppMenuTrigger asChild>
                    <button className="space-pill add" aria-label="新建工作区" title="新建工作区"><Plus size={15} /></button>
                  </AppMenuTrigger>
                  <AppMenuContent side="top" align="center" className="space-add-menu-v2">
                    <AppMenuItem onSelect={openSpaceCreate}><Plus /><span>新建工作区</span></AppMenuItem>
                  </AppMenuContent>
                </AppMenu>
              </div>
            </div>
          </div>
          <div className="sidebar-footer">
            <div className="user-menu-anchor">
              <AppMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                <AppMenuTrigger asChild>
                  <button className={userMenuOpen ? 'user-card active' : 'user-card'} aria-expanded={userMenuOpen} aria-label="打开用户菜单">
                    <span className="user-avatar">{userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : (userProfile.nickname || 'MG').slice(0, 2).toUpperCase()}</span>
                    <span><strong>{userProfile.nickname || 'Frakio User'}</strong><em>Local Web UI</em></span>
                  </button>
                </AppMenuTrigger>
                <AppMenuContent side="top" align="start" className="user-menu-popover-v2">
                  <AppMenuItem onSelect={() => openSettingsSection('profile')}><UserCircle /><span>个人资料</span></AppMenuItem>
                  <AppMenuItem onSelect={() => openSettingsSection('workbench')}><Settings /><span>设置</span></AppMenuItem>
                </AppMenuContent>
              </AppMenu>
              {desktopUpdateBadgeVisible && desktopUpdateState && (
                <DesktopUpdateBadge
                  state={desktopUpdateState}
                  open={desktopUpdatePopoverOpen}
                  onOpenChange={changeDesktopUpdatePopover}
                  onCancel={() => void cancelDesktopUpdateDownload()}
                  onInstall={() => void openDownloadedDesktopUpdate()}
                />
              )}
            </div>
          </div>
          </>
          )}
        </aside>
        </>
      )}
      {macSpaceEditorOpen && (
        <section
          className="mac-space-editor-popover"
          ref={macSpaceEditorRef}
          aria-label={spaceEditTargetId ? '编辑工作区' : '新建工作区'}
          style={{
            '--draft-accent': spaceDraft.theme.accentColor,
            '--draft-sidebar-bg': spaceDraft.theme.sidebarBg,
            '--draft-theme-bg': themeGradientBackground(spaceDraft.theme),
            '--draft-opacity': String(spaceDraft.theme.opacity),
          } as React.CSSProperties}
        >
          <header className="mac-space-editor-head">
            <div>
              <strong>{spaceEditTargetId ? '编辑工作区' : '新建工作区'}</strong>
              <small>名称、图标与窗口背景</small>
            </div>
            <button type="button" onClick={closeSpaceEditor} aria-label="关闭工作区编辑器" title="关闭"><X size={15} /></button>
          </header>

          <div className="mac-space-editor-scroll">
            <section className="mac-space-editor-section">
              <span className="mac-space-editor-label">应用外观</span>
              <div className="appearance-segmented mac-space-appearance" role="group" aria-label="应用外观">
                {(['system', 'light', 'dark'] as const).map((appearance) => (
                  <button type="button" className={(uiSettings.appearance || 'system') === appearance ? 'selected' : ''} key={appearance} onClick={() => void persistUi({ appearance })}>
                    {appearance === 'system' ? <><Monitor size={14} />系统</> : appearance === 'light' ? <><Sun size={14} />浅色</> : <><Moon size={14} />深色</>}
                  </button>
                ))}
              </div>
            </section>

            <section className="mac-space-editor-section mac-space-identity">
              <span className="mac-space-editor-label">工作区</span>
              <label className="workspace-name-field">
                <button type="button" onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: current.iconKind === 'dot' ? 'emoji' : current.iconKind === 'emoji' ? 'icon' : 'dot', iconValue: current.iconKind === 'dot' ? '✨' : current.iconKind === 'emoji' ? 'folder' : '' }))} aria-label="切换工作区图标">{renderDraftIcon(14)}</button>
                <input autoFocus value={spaceDraft.name} onChange={(event) => setSpaceDraft((current) => ({ ...current, name: event.target.value }))} placeholder="工作区名称" />
              </label>
              <div className="workspace-icon-picker">
                <div className="workspace-picker-tabs">
                  <button className={spaceDraft.iconKind === 'dot' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'dot', iconValue: '' }))}>圆点</button>
                  <button className={spaceDraft.iconKind === 'emoji' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'emoji', iconValue: current.iconValue || '✨' }))}>Emoji</button>
                  <button className={spaceDraft.iconKind === 'icon' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'icon', iconValue: 'folder' }))}>图标</button>
                </div>
                <div className={spaceDraft.iconKind === 'dot' ? 'dot-choice-grid' : spaceDraft.iconKind === 'emoji' ? 'emoji-grid' : 'emoji-grid icon-grid'}>
                  {spaceDraft.iconKind === 'dot' ? (
                    <button className="selected" onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'dot', iconValue: '' }))}><span className="field-dot" /></button>
                  ) : (spaceDraft.iconKind === 'emoji' ? spaceEmojiOptions : spaceIconOptions).map((item) => (
                    <button className={spaceDraft.iconValue === item ? 'selected' : ''} key={item} onClick={() => setSpaceDraft((current) => ({ ...current, iconValue: item }))} title={spaceDraft.iconKind === 'icon' ? spaceIconLabels[item] : item}>
                      {spaceDraft.iconKind === 'emoji' ? item : item === 'briefcase' ? <Briefcase size={17} /> : item === 'sparkles' ? <Sparkles size={17} /> : item === 'library' ? <Library size={17} /> : <Folder size={17} />}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="mac-space-editor-section">
              <span className="mac-space-editor-label">背景板</span>
              <div className="mac-space-color-mode" role="group" aria-label="工作区背景模式">
                <button type="button" className={(spaceDraft.theme.colorMode || 'custom') === 'native' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, colorMode: 'native' } }))}>
                  <Monitor size={14} /><span><strong>系统材质</strong><small>完整显示 macOS 透光</small></span>
                </button>
                <button type="button" className={(spaceDraft.theme.colorMode || 'custom') === 'custom' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, colorMode: 'custom' } }))}>
                  <Sparkles size={14} /><span><strong>自定义颜色</strong><small>为工作区增加身份色</small></span>
                </button>
              </div>
            </section>

            {(spaceDraft.theme.colorMode || 'custom') === 'custom' && (
              <section className="mac-space-editor-section mac-space-theme-controls">
                <div
                  className="theme-dot-matrix"
                  onPointerDown={handleThemePanelPointer}
                  onPointerMove={(event) => { if (event.buttons === 1) handleThemePanelPointer(event); }}
                  aria-label="选择工作区颜色"
                  role="application"
                >
                  {normalizeGradientColors(spaceDraft.theme).map((color) => (
                    <button
                      className={color.isPrimary ? 'theme-picker-cursor primary' : 'theme-picker-cursor'}
                      key={color.id}
                      onPointerDown={(event) => handleThemeDotPointer(event, color.id)}
                      onPointerMove={(event) => handleThemeDotMove(event, color.id)}
                      onPointerUp={finishThemeDotPointer}
                      onPointerCancel={finishThemeDotPointer}
                      onClick={(event) => { event.stopPropagation(); promoteDraftThemeColor(color.id); }}
                      style={{ left: `${color.x * 100}%`, top: `${color.y * 100}%`, background: color.color }}
                      aria-label={color.isPrimary ? '主色' : '设为主色'}
                      type="button"
                    />
                  ))}
                  <span className="theme-picker-controls" onPointerDown={(event) => event.stopPropagation()}>
                    <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); removeDraftThemeColor(); }} disabled={normalizeGradientColors(spaceDraft.theme).length <= 1} aria-label="减少颜色"><Minus size={13} /></button>
                    <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); addDraftThemeColor(); }} disabled={normalizeGradientColors(spaceDraft.theme).length >= 3} aria-label="增加颜色"><Plus size={13} /></button>
                    <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); randomizeDraftThemeColors(); }} aria-label="随机颜色"><Sparkles size={13} /></button>
                  </span>
                </div>
                <div className="theme-color-row">
                  <button className="theme-step-btn" onClick={() => changeThemePresetPage(-1)} aria-label="上一页颜色" disabled={themePresetPage === 0}><ChevronDown size={16} /></button>
                  <div className="theme-color-pages">
                    {themePresetPage === 0 && (
                      <button className={selectedThemePresetId === 'frakio-default' ? 'selected theme-default-preset' : 'theme-default-preset'} style={{ '--preset-1': defaultProductSpaceTheme.accentColor, '--preset-2': defaultProductSpaceTheme.sidebarBg, '--preset-3': '#ffffff', background: defaultProductSpaceTheme.sidebarBg } as React.CSSProperties} onClick={applyDefaultThemePreset} aria-label="选择默认主题" />
                    )}
                    {themePresetPages[themePresetPage].map((preset) => (
                      <button className={`${selectedThemePresetId === preset.id ? 'selected ' : ''}${preset.colors.length > 1 ? 'multi' : 'solid'}`} key={preset.id} style={{ '--preset-1': preset.colors[0], '--preset-2': preset.colors[1] || preset.colors[0], '--preset-3': preset.colors[2] || preset.colors[0], background: preset.colors[0] } as React.CSSProperties} onClick={() => applyThemePreset(preset)} aria-label={`选择 Zen 颜色 ${preset.id}`} />
                    ))}
                  </div>
                  <button className="theme-step-btn next" onClick={() => changeThemePresetPage(1)} aria-label="下一页颜色" disabled={themePresetPage === themePresetPages.length - 1}><ChevronDown size={16} /></button>
                </div>
                <div className="theme-controls-row">
                  <label className="theme-wave-slider" style={{ '--wave-progress': `${opacityProgress(spaceDraft.theme.opacity) * 100}%`, '--wave-thumb-height': `${40 + opacityProgress(spaceDraft.theme.opacity) * 15}px`, '--wave-thumb-width': `${10 + opacityProgress(spaceDraft.theme.opacity) * 15}px` } as React.CSSProperties}>
                    <span className="theme-wave-track">
                      <svg viewBox="0 -8 455 70" aria-hidden="true"><path d={wavePathForOpacity(spaceDraft.theme.opacity)} /></svg>
                      <input type="range" min="0.3" max="0.9" step="0.001" value={spaceDraft.theme.opacity} onChange={(event) => setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, opacity: Number(event.target.value) } }))} aria-label="颜色透明度" />
                    </span>
                  </label>
                  <div className="theme-noise-dial" onPointerDown={handleTexturePointerDown} onPointerMove={handleTexturePointerMove} onPointerUp={finishTexturePointer} onPointerCancel={finishTexturePointer} style={{ '--texture': String(spaceDraft.theme.texture ?? 0) } as React.CSSProperties} role="slider" aria-label="纹理" aria-valuemin={0} aria-valuemax={16} aria-valuenow={Math.round((spaceDraft.theme.texture ?? 0) * 16)}>
                    <div className="theme-texture-ring" aria-hidden="true">
                      {textureStepDots(spaceDraft.theme.texture).map((dot) => <i className={dot.active ? 'active' : ''} key={dot.id} style={{ left: `${dot.left}%`, top: `${dot.top}%` }} />)}
                      <b style={textureHandleStyle(spaceDraft.theme.texture)} />
                    </div>
                  </div>
                </div>
                <div className="theme-mode-toggle">
                  <button className={spaceDraft.theme.mode === 'soft' ? 'selected' : ''} onClick={() => setDraftThemeMode('soft')}>柔和</button>
                  <button className={spaceDraft.theme.mode === 'crisp' ? 'selected' : ''} onClick={() => setDraftThemeMode('crisp')}>清晰</button>
                </div>
              </section>
            )}
          </div>

          <footer className="mac-space-editor-actions">
            <button type="button" className="secondary-btn" onClick={closeSpaceEditor}>取消</button>
            <button type="button" className="send-btn" disabled={!spaceDraft.name.trim()} onClick={() => void submitSpaceDraft()}>{spaceEditTargetId ? '保存' : '创建'}</button>
          </footer>
        </section>
      )}
      {macSidebarOverlayOpen && <button className="mac-sidebar-overlay-backdrop" type="button" aria-label="收起侧边栏" onClick={() => closeMacSidebarOverlay()} />}
      {railContextMenu && (
        <RailContextMenu
          target={railContextMenu}
          canShowInFinder={Boolean(window.frakioDesktop?.showItemInFolder)}
          onClose={() => setRailContextMenu(null)}
          onToggleWorkspacePinned={toggleWorkspacePinned}
          onRenameWorkspace={renameWorkspace}
          onArchiveWorkspace={(workspace) => void archiveWorkspace(workspace.id)}
          onShowInFinder={showInFinder}
          onCopyText={copyText}
          onEditSpace={openSpaceEditor}
          onToggleThreadPinned={toggleThreadPinned}
          onRenameThread={renameThread}
          onArchiveThread={(thread) => void archiveThread(thread.id)}
          onDeleteWorkspace={(workspace) => openRailDeleteConfirmFromMenu({ kind: 'workspace', id: workspace.id, title: workspace.name })}
          onDeleteThread={(thread) => openRailDeleteConfirmFromMenu({ kind: 'thread', id: thread.id, title: thread.title })}
        />
      )}
      {railConfirm && <RailConfirmDialog target={railConfirm} onCancel={cancelRailConfirm} onConfirm={() => confirmRailAction(railConfirm)} />}
      {renameDialogTarget && (
        <RenameDialog
          target={renameDialogTarget}
          onClose={() => setRenameDialogTarget(null)}
          onSave={submitRenameDialog}
          onGenerateTitle={renameDialogTarget.kind === 'thread'
            ? () => generateThreadTitle(renameDialogTarget.id, false)
            : undefined}
        />
      )}
      {!isMacConversationShell && !isWorkspaceSurfaceNav && (
        <ResizeHandle
          side="left"
          currentWidth={sidebarWidth}
          minWidth={activeSidebarWidthBounds.min}
          maxWidth={activeSidebarWidthBounds.max}
          disabled={isDesktopShell && effectiveSidebarCollapsed}
          onResize={setSidebarWidth}
          onCommit={(width) => void persistUi(isMacDesktop
            ? { macSidebarWidth: width, macSidebarWidthVersion: SIDEBAR_WIDTH_VERSION }
            : { sidebarWidth: width })}
        />
      )}

      <main ref={mainPanelRef} className={conversationMainCompact ? 'main compact-conversation-main' : 'main'}>
        {isMacConversationShell && !effectiveSidebarCollapsed && !macSidebarUsesOverlay && !macSpaceEditorOpen && (
          <ResizeHandle
            side="left"
            edgeAligned
            currentWidth={sidebarWidth}
            minWidth={activeSidebarWidthBounds.min}
            maxWidth={macSidebarResizeMax}
            onResize={setSidebarWidth}
            onCommit={(width) => void persistUi({ macSidebarWidth: width, macSidebarWidthVersion: SIDEBAR_WIDTH_VERSION })}
          />
        )}
        {isMacConversationShell && rightRailOpen && !macSpaceEditorOpen && !browserFullWorkspace && (
          <ResizeHandle
            side="right"
            edgeAligned
            currentWidth={renderedContextWidth}
            minWidth={contextWidthBounds.min}
            maxWidth={contextResizeMax}
            onResize={resizeContextWidth}
            onCommit={commitContextWidth}
          />
        )}
        {activeView !== 'new-chat' && !isSettingsNav && !spaceEditorReplacesPage && !isMacWorkspaceSurfaceShell && <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-title-icon"><FileText size={17} /></span>
            <h1>{isManagementSection ? activeSection?.label : activeThread?.title || activeSection?.label || '新对话'}</h1>
          </div>
          {!isManagementSection && activeThread && (
            <div className="top-actions">
              <RuntimeSwitcher
                thread={activeThread}
                activeAgent={activeComposerAgent}
                agents={agents}
                isRunning={activeThread.runStatus === 'running'}
                onRuntimeChange={updateThreadAgentRuntimeOverride}
                onOpenRuntimeCenter={() => openSettingsSection('runtimes')}
              />
              <ThreadActionsMenu
                thread={activeThread}
                workspace={activeWorkspace}
                vaults={vaults}
                activeVault={activeVault}
                activeAgent={activeComposerAgent}
                onFollowModeChange={updateThreadFollowMode}
                onCreateProjectThread={createThread}
                onConvertToProject={() => openProjectModal('create', 'convert')}
                onVaultChange={updateThreadVault}
                onOpenAgents={() => setAgentPickerOpen(true)}
                onRenameThread={() => setRenameDialogTarget({ kind: 'thread', id: activeThread.id, title: activeThread.title })}
                onRegenerateTitle={() => generateThreadTitle(activeThread.id, true).then(() => undefined)}
              />
              {!isDesktopShell && rightRailKind && (
                <button
                  className={rightRailOpen ? 'top-icon-btn active' : 'top-icon-btn'}
                  onClick={toggleRightRail}
                  aria-label={rightRailOpen ? '收起资源' : '展开资源'}
                  title={rightRailOpen ? '收起资源' : '展开资源'}
                >
                  {rightRailOpen ? <PanelRightOpen size={17} /> : <PanelRight size={17} />}
                </button>
              )}
            </div>
          )}
        </header>}

        {spaceEditorReplacesPage ? (
          <section
            className="workspace-create-stage"
            style={{
              '--draft-accent': spaceDraft.theme.accentColor,
              '--draft-sidebar-bg': spaceDraft.theme.sidebarBg,
              '--draft-secondary-a': normalizeGradientColors(spaceDraft.theme)[1]?.color || spaceDraft.theme.sidebarBg,
              '--draft-secondary-b': normalizeGradientColors(spaceDraft.theme)[2]?.color || spaceDraft.theme.accentColor,
              '--draft-theme-bg': themeGradientBackground(spaceDraft.theme),
              '--draft-stage-bg': themeStageBackground(spaceDraft.theme),
              '--draft-rail-bg': themeRailBackground(spaceDraft.theme),
              '--draft-noise': String(spaceDraft.theme.noise),
              '--draft-texture': String(spaceDraft.theme.texture ?? 0),
              '--draft-opacity': String(spaceDraft.theme.opacity),
              ...textureSurfaceVars(spaceDraft.theme, 'stage'),
            } as React.CSSProperties}
          >
            <div className="workspace-theme-panel">
              <div className="workspace-theme-simple">
                <span style={{ background: primaryGradientColor(spaceDraft.theme).color }} />
                <div><strong>工作区颜色</strong><small>用于区分工作区，并以半透明方式融入 macOS 背景。</small></div>
                <button type="button" onClick={() => setSpaceThemeAdvancedOpen((open) => !open)}>{spaceThemeAdvancedOpen ? '收起高级外观' : '高级工作区外观'}</button>
              </div>
              {spaceThemeAdvancedOpen && <div className="workspace-theme-advanced">
              <div className="workspace-palette-toggle" aria-label="编辑工作区明暗配色">
                <button type="button" className={(spaceDraft.theme.appearance || 'light') === 'light' ? 'selected' : ''} onClick={() => setDraftThemeAppearance('light')}><Sun size={14} />浅色配色</button>
                <button type="button" className={(spaceDraft.theme.appearance || 'light') === 'dark' ? 'selected' : ''} onClick={() => setDraftThemeAppearance('dark')}><Moon size={14} />深色配色</button>
              </div>
              <div
                className="theme-dot-matrix"
                onPointerDown={handleThemePanelPointer}
                onPointerMove={(event) => { if (event.buttons === 1) handleThemePanelPointer(event); }}
                aria-label="选择工作区颜色"
                role="application"
              >
                {normalizeGradientColors(spaceDraft.theme).map((color) => (
                  <button
                    className={color.isPrimary ? 'theme-picker-cursor primary' : 'theme-picker-cursor'}
                    key={color.id}
                    onPointerDown={(event) => handleThemeDotPointer(event, color.id)}
                    onPointerMove={(event) => handleThemeDotMove(event, color.id)}
                    onPointerUp={finishThemeDotPointer}
                    onPointerCancel={finishThemeDotPointer}
                    onClick={(event) => { event.stopPropagation(); promoteDraftThemeColor(color.id); }}
                    style={{ left: `${color.x * 100}%`, top: `${color.y * 100}%`, background: color.color }}
                    aria-label={color.isPrimary ? '主色' : '设为主色'}
                    type="button"
                  />
                ))}
                <span className="theme-picker-controls" onPointerDown={(event) => event.stopPropagation()}>
                  <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); removeDraftThemeColor(); }} disabled={normalizeGradientColors(spaceDraft.theme).length <= 1} aria-label="减少颜色">-</button>
                  <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); addDraftThemeColor(); }} disabled={normalizeGradientColors(spaceDraft.theme).length >= 3} aria-label="增加颜色">+</button>
                  <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); randomizeDraftThemeColors(); }} aria-label="随机颜色"><Sparkles size={13} /></button>
                </span>
              </div>
              <div className="theme-color-row">
                <button className="theme-step-btn" onClick={() => changeThemePresetPage(-1)} aria-label="上一页颜色" disabled={themePresetPage === 0}><ChevronDown size={16} /></button>
                <div className="theme-color-pages">
                {themePresetPage === 0 && (
                  <button
                    className={selectedThemePresetId === 'frakio-default' ? 'selected theme-default-preset' : 'theme-default-preset'}
                    style={{ '--preset-1': defaultProductSpaceTheme.accentColor, '--preset-2': defaultProductSpaceTheme.sidebarBg, '--preset-3': '#ffffff', background: defaultProductSpaceTheme.sidebarBg } as React.CSSProperties}
                    onClick={applyDefaultThemePreset}
                    aria-label="选择默认主题"
                  />
                )}
                {themePresetPages[themePresetPage].map((preset) => (
                  <button
                    className={`${selectedThemePresetId === preset.id ? 'selected ' : ''}${preset.colors.length > 1 ? 'multi' : 'solid'}`}
                    key={preset.id}
                    style={{ '--preset-1': preset.colors[0], '--preset-2': preset.colors[1] || preset.colors[0], '--preset-3': preset.colors[2] || preset.colors[0], background: preset.colors[0] } as React.CSSProperties}
                    onClick={() => applyThemePreset(preset)}
                    aria-label={`选择 Zen 颜色 ${preset.id}`}
                  />
                ))}
                </div>
                <button className="theme-step-btn next" onClick={() => changeThemePresetPage(1)} aria-label="下一页颜色" disabled={themePresetPage === themePresetPages.length - 1}><ChevronDown size={16} /></button>
              </div>
              <div className="theme-controls-row">
                <label className="theme-wave-slider" style={{ '--wave-progress': `${opacityProgress(spaceDraft.theme.opacity) * 100}%`, '--wave-thumb-height': `${40 + opacityProgress(spaceDraft.theme.opacity) * 15}px`, '--wave-thumb-width': `${10 + opacityProgress(spaceDraft.theme.opacity) * 15}px` } as React.CSSProperties}>
                  <span className="theme-wave-track">
                    <svg viewBox="0 -8 455 70" aria-hidden="true"><path d={wavePathForOpacity(spaceDraft.theme.opacity)} /></svg>
                    <input type="range" min="0.3" max="0.9" step="0.001" value={spaceDraft.theme.opacity} onChange={(event) => setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, opacity: Number(event.target.value) } }))} />
                  </span>
                </label>
                <div
                  className="theme-noise-dial"
                  onPointerDown={handleTexturePointerDown}
                  onPointerMove={handleTexturePointerMove}
                  onPointerUp={finishTexturePointer}
                  onPointerCancel={finishTexturePointer}
                  style={{ '--texture': String(spaceDraft.theme.texture ?? 0) } as React.CSSProperties}
                  role="slider"
                  aria-label="噪点"
                  aria-valuemin={0}
                  aria-valuemax={16}
                  aria-valuenow={Math.round((spaceDraft.theme.texture ?? 0) * 16)}
                >
                  <div className="theme-texture-ring" aria-hidden="true">
                    {textureStepDots(spaceDraft.theme.texture).map((dot) => <i className={dot.active ? 'active' : ''} key={dot.id} style={{ left: `${dot.left}%`, top: `${dot.top}%` }} />)}
                    <b style={textureHandleStyle(spaceDraft.theme.texture)} />
                  </div>
                </div>
              </div>
              <div className="theme-mode-toggle">
                <button className={spaceDraft.theme.mode === 'soft' ? 'selected' : ''} onClick={() => setDraftThemeMode('soft')}>柔和</button>
                <button className={spaceDraft.theme.mode === 'crisp' ? 'selected' : ''} onClick={() => setDraftThemeMode('crisp')}>清晰</button>
              </div>
              </div>}
            </div>
          </section>
        ) : activeView === 'new-chat' ? (
          <section className="new-chat-page">
            <header className="new-chat-panel-header">
              <RuntimeSwitcher
                activeAgent={newChatAgent}
                agents={newChatAgent ? [newChatAgent] : []}
                currentRuntimeId={newChatRuntimeId}
                isRunning={newChatStarting}
                onRuntimeChange={async (_agentId, runtimeId) => { setNewChatRuntimeOverride(runtimeId); }}
                onOpenRuntimeCenter={() => openSettingsSection('runtimes')}
              />
            </header>
            <div className="new-chat-center">
              <h1>{uiSettings.newChatPrompt || '我们接下来做点什么？'}</h1>
              {newChatAgent && (
                <AppMenu open={newChatAgentPickerOpen} onOpenChange={setNewChatAgentPickerOpen} modal={false}>
                  <div className="new-chat-agent-wrap">
                    <AppMenuTrigger asChild>
                      <button className="new-chat-agent-chip">
                        <span className="agent-mention-symbol">@</span>
                        <AgentAvatar agent={newChatAgent} size="sm" />
                        <span><strong>{newChatAgent.name}</strong><small>{newChatAgent.role}</small></span>
                        <ChevronDown size={14} />
                      </button>
                    </AppMenuTrigger>
                    <AppMenuContent className="new-chat-agent-menu-v2" side="bottom" align="center" aria-label="选择 Agent">
                      {agents.map((agent) => (
                        <AppMenuItem className={agent.id === newChatAgent.id ? 'selected new-chat-agent-option' : 'new-chat-agent-option'} key={agent.id} onSelect={() => { setNewChatAgentId(agent.id); setNewChatRuntimeOverride(''); setNewChatModelOverride(''); setNewChatRunOverride({}); }}>
                          <AgentAvatar agent={agent} size="sm" />
                          <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                          <em>{agentDefaultModelLabel(agent, models)}</em>
                        </AppMenuItem>
                      ))}
                    </AppMenuContent>
                  </div>
                </AppMenu>
              )}
              {!newChatAgent && (
                <button className="secondary-btn new-chat-create-agent" type="button" onClick={() => setNewAgentOpen(true)}>
                  <Plus size={16} />新建 Agent
                </button>
              )}
              <div
                className={`composer new-chat-composer ${attachmentDragActive ? 'attachment-drag-active' : ''}`}
                onDragEnter={handleAttachmentDragEnter}
                onDragOver={handleAttachmentDragOver}
                onDragLeave={handleAttachmentDragLeave}
                onDrop={handleAttachmentDrop}
              >
                <AttachmentTray attachments={attachments} notice={attachmentNotice} onRemove={removeAttachment} onRetry={retryAttachment} />
                {attachmentDragActive && <div className="attachment-drop-overlay"><ArrowDownToLine size={22} /><strong>松开即可添加附件</strong></div>}
                <AnimatePresence initial={false}>
                  {newChatCollaborationEnabled && <CollaborationIntentIndicator key="new-chat-collaboration" />}
                </AnimatePresence>
                <MentionTextarea
                  value={newChatInput}
                  onChange={(value) => { newChatInputRef.current = value; setNewChatInput(value); }}
                  onSend={() => void startNewChat()}
                  sendKey={uiSettings.sendKey || 'enter'}
                  agents={agents}
                  selectedAgentIds={[newChatAgent?.id || globalDefaultAgentId].filter(Boolean)}
                  placeholder="随意输入，随意@"
                  collaborationEnabled={newChatCollaborationEnabled}
                  onCollaborationChange={(enabled) => { setNewChatCollaborationEnabled(enabled); if (enabled) setNewChatPlanEnabled(false); }}
                />
                <div className="composer-toolbar">
                  <div className="composer-left-tools">
                    <ComposerAddMenu
                      planEnabled={newChatPlanEnabled}
                      planBusy={newChatStarting || newChatCollaborationEnabled}
                      onAddFile={() => fileInputRef.current?.click()}
                      onEnablePlan={() => { setNewChatPlanEnabled(true); setNewChatCollaborationEnabled(false); }}
                    />
                      <input ref={fileInputRef} className="file-input" type="file" multiple accept={attachmentAcceptValue} onChange={(event) => handleAttachmentChange(event.target.files)} />
                      <PermissionModeControl compact={conversationMainCompact} value={newChatPermissionMode} onChange={setNewChatPermissionMode} />
                      <CollaborationIntentControl active={newChatCollaborationEnabled} disabled={newChatStarting || newChatPlanEnabled} onChange={(enabled) => { setNewChatCollaborationEnabled(enabled); if (enabled) setNewChatPlanEnabled(false); }} />
                    {newChatPlanEnabled && <PlanModeIndicator busy={newChatStarting} onClose={() => setNewChatPlanEnabled(false)} />}
                  </div>
                  <div className="composer-right-tools">
                    <ProviderModelPicker
                      className="composer-model composer-agent-model"
                      runtimeId={newChatRuntimeId}
                      agentName={newChatAgent?.name || ''}
                      value={newChatProfileModelValue}
                      models={hermesProfileModelOptions}
                      emptyLabel={newChatAgent ? '未配置模型' : '请先新建 Agent'}
                      ariaLabel={newChatAgent ? `${newChatAgent.name} 的 Frakio Model Center 模型` : 'Frakio Model Center 模型'}
                      title="Frakio Model Center"
                      allowDefault
                      usingDefault={!newChatModelOverride}
                      capabilities={modelCapabilities}
                      runOverride={newChatRunOverride}
                      onRunOverrideChange={setNewChatRunOverride}
                      onChange={updateNewChatModelOverride}
                    />
                    <ComposerRunButton
                      isRunning={newChatStarting}
                      hasActiveRun={false}
                      isStopping={false}
                      canSend={Boolean(newChatAgent && newChatProfileModelValue) && attachments.every((item) => item.status === 'ready') && Boolean(newChatInput.trim() || attachments.length)}
                      onSend={() => void startNewChat()}
                      onStop={() => undefined}
                    />
                  </div>
                </div>
              </div>
              {collaborationModeError && (
                <CollaborationRuntimeErrorCard error={collaborationModeError} loading={newChatStarting} onRetry={() => void startNewChat()} />
              )}
              <AppMenu open={projectPickerOpen} onOpenChange={setProjectPickerOpen} modal={false}>
                <div className="new-chat-project">
                  <AppMenuTrigger asChild>
                    <button className="new-chat-project-row">
                      <FolderOpen size={16} />
                      <span>{selectedNewChatWorkspaceId ? visibleWorkspaces.find((workspace) => workspace.id === selectedNewChatWorkspaceId)?.name || 'Choose project' : 'Choose project'}</span>
                      <ChevronDown size={14} />
                    </button>
                  </AppMenuTrigger>
                  <AppMenuContent className="project-picker-menu-v2" side="bottom" align="center" aria-label="选择项目">
                    <AppMenuItem className={!selectedNewChatWorkspaceId ? 'selected project-picker-option' : 'project-picker-option'} onSelect={() => setSelectedNewChatWorkspaceId(null)}>
                      <MessageSquare size={15} />
                      <span><strong>临时对话</strong><small>不绑定项目目录</small></span>
                    </AppMenuItem>
                    {visibleWorkspaces.map((workspace) => (
                      <AppMenuItem className={selectedNewChatWorkspaceId === workspace.id ? 'selected project-picker-option' : 'project-picker-option'} key={workspace.id} onSelect={() => setSelectedNewChatWorkspaceId(workspace.id)}>
                        <FolderOpen size={15} />
                        <span><strong>{workspace.name}</strong><small>{workspace.id === activeWorkspace?.id ? '当前项目 · ' : ''}{workspace.rootPath}</small></span>
                      </AppMenuItem>
                    ))}
                  </AppMenuContent>
                </div>
              </AppMenu>
            </div>
          </section>
        ) : activeNav === 'settings' ? (
          <SettingsPage
            vaults={vaults}
            models={models}
            modelCapabilities={modelCapabilities}
            agents={agents}
            hermesStatus={hermesStatus}
            hermesBootstrap={hermesBootstrap}
            hermesRuntime={hermesRuntime}
            hermesDiagnostics={hermesDiagnostics}
            hermesApiAvailability={hermesApiAvailability}
            hermesError={hermesError}
            updatesStatus={updatesStatus}
            updatesBusy={updatesBusy}
            updatesError={updatesError}
            updatesResult={updatesResult}
            desktopUpdateState={desktopUpdateState}
            onCheckDesktopUpdate={checkDesktopUpdate}
            onDownloadDesktopUpdate={startDesktopUpdateDownload}
            onCancelDesktopUpdate={cancelDesktopUpdateDownload}
            onOpenDesktopUpdate={openDownloadedDesktopUpdate}
            onCheckHermesRuntime={checkHermesRuntimeUpdate}
            onInstallHermesRuntime={installHermesRuntime}
            onActivateHermesRuntime={activateHermesRuntime}
            onUseBundledHermesRuntime={useBundledHermesRuntime}
            onDeleteHermesRuntime={deleteHermesRuntime}
            onCreateHermesBackup={createHermesBackup}
            onRollbackHermesBackup={rollbackHermesBackup}
            onDeleteHermesBackup={deleteHermesBackup}
            onCleanupHermesBackups={cleanupHermesBackups}
            userProfile={userProfile}
            uiSettings={uiSettings}
            telemetryStatus={telemetryStatus}
            isImportingHermes={isImportingHermes}
            vaultPathInput={vaultPathInput}
            setVaultPathInput={setVaultPathInput}
            vaultError={vaultError}
            vaultBusy={vaultBusy}
            addVault={addVault}
            reindexVault={reindexVault}
            deleteVault={deleteVault}
            resolveLegacyVaultBinding={resolveLegacyVaultBinding}
            onImportHermes={importHermesProfiles}
            onRunFirstUseGuide={() => runFirstUseGuide({ manual: true })}
            firstUseGuideRunning={launchPhase !== 'done' && launchOriginRef.current === 'manual'}
            onStartHermesRuntime={startHermesRuntime}
            onRefreshHermesRuntime={refreshHermesRuntime}
            onStartProfileGateway={startHermesProfileGateway}
            onStopProfileGateway={stopHermesProfileGateway}
            onUpdateUi={(next) => void persistUi(next)}
            onUserProfileSaved={(profile, nextAgents) => {
              setUserProfile(profile);
              if (nextAgents) setAgents(nextAgents);
            }}
            pinnedNav={pinnedNav}
            onTogglePinned={(id) => {
              const next = { ...pinnedNav, [id]: pinnedNav[id] === false };
              void persistUi({ pinnedNav: next });
            }}
            modelError={modelError}
            saveModel={saveModel}
            deleteModel={deleteModel}
            fetchAvailableModels={fetchAvailableModels}
            onCapabilityChanged={(modelId, modelName, capability) => setModelCapabilities((current) => ({ ...current, [`${modelId}::${modelName}`]: capability }))}
            activeSection={settingsSection}
            onSectionChange={setSettingsSection}
            archivedThreads={archivedThreads}
            onRefreshArchivedThreads={refreshArchivedThreads}
            onRestoreThread={restoreThread}
            onDeleteThread={deleteThread}
            selectedOrgAgentId={selectedOrgAgentId}
            onSelectAgent={selectOrgAgent}
            onProfilesChanged={refreshOrg}
            onUpdateAgent={updateAgent}
            onDeleteAgent={deleteAgent}
            onCreateAgent={() => setNewAgentOpen(true)}
            profileEditor={profileEditorControls}
            onUpdateDefaultAgent={(agentId) => {
              setNewChatAgentId(agentId);
              void persistUi({ defaultAgentId: agentId });
            }}
            onOpenMemorySource={(threadId, messageId) => {
              setActiveNav('council');
              void openThread(threadId).then(() => setTimeout(() => document.querySelector(`[data-message-id="${CSS.escape(messageId || '')}"]`)?.scrollIntoView({ block: 'center' }), 80));
            }}
          />
        ) : activeNav === 'models' ? (
          <ModelConfigPage models={models} profiles={localProfilesForComposer} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || 'default'} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} onCapabilityChanged={(modelId, modelName, capability) => setModelCapabilities((current) => ({ ...current, [`${modelId}::${modelName}`]: capability }))} />
        ) : activeNav === 'channels' ? (
          <ChannelsPage profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />
        ) : activeNav === 'plugins' ? (
          <PluginsPage agents={agents} profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} />
        ) : activeNav === 'inbox' ? (
          <WorkspaceSurface>
            <InboxPage items={inboxItems} loading={inboxLoading} error={inboxError} onRefresh={() => void refreshInbox()} onOpen={async (item) => {
              if (!item.readAt) await updateInboxItem(item.id, { read: true }).catch(() => null);
              setActiveNav('council');
              await openThread(item.threadId);
              window.setTimeout(() => window.dispatchEvent(new CustomEvent('frakio:open-collaboration-rail', { detail: { threadId: item.threadId, workflowId: item.workflowId } })), 80);
            }} />
          </WorkspaceSurface>
        ) : activeNav === 'kanban' ? (
          <WorkspaceSurface><CollaborationCenterPage agents={agents} /></WorkspaceSurface>
        ) : activeNav === 'jobs' ? (
          <JobsPage profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />
        ) : activeNav === 'monitoring' ? (
          <MonitoringPage />
        ) : activeNav === 'org' ? (
          <OrgPage
            agents={agents}
            models={models}
            modelCapabilities={modelCapabilities}
            selectedOrgAgentId={selectedOrgAgentId}
            onSelectAgent={selectOrgAgent}
            onProfilesChanged={refreshOrg}
            onUpdateAgent={updateAgent}
            onDeleteAgent={deleteAgent}
            onCreate={() => setNewAgentOpen(true)}
            profileEditor={profileEditorControls}
            defaultAgentId={globalDefaultAgentId}
            onUpdateDefaultAgent={(agentId) => {
              setNewChatAgentId(agentId);
              void persistUi({ defaultAgentId: agentId });
            }}
          />
        ) : (
          <>
            {!isMacConversationShell && activeThread && <ConversationExternalControls
              thread={activeThread}
              vaults={vaults}
              personalVaultId={personalVaultId}
              overviewOpen={overviewOpen}
              onOverview={() => setOverviewOpen((open) => !open)}
              onUpdate={updateThreadContext}
              onOpenSources={() => { setOverviewOpen(false); openRightRailTab('sources'); }}
              onOpenReview={() => { setOverviewOpen(false); openRightRailTab('review'); }}
            />}
            <section className="council">
              {isMacConversationShell && (
                <header className="conversation-panel-header">
                  {activeThread?.title?.trim() && activeThread.title.trim() !== '新对话' && (
                    <ThreadActionsMenu
                      thread={activeThread}
                      workspace={activeWorkspace}
                      vaults={vaults}
                      activeVault={activeVault}
                      activeAgent={activeComposerAgent}
                      triggerVariant="title"
                      triggerTitle={activeThread.title}
                      onFollowModeChange={updateThreadFollowMode}
                      onCreateProjectThread={createThread}
                      onConvertToProject={() => openProjectModal('create', 'convert')}
                      onVaultChange={updateThreadVault}
                      onOpenAgents={() => setAgentPickerOpen(true)}
                      onRenameThread={() => setRenameDialogTarget({ kind: 'thread', id: activeThread.id, title: activeThread.title })}
                      onRegenerateTitle={() => generateThreadTitle(activeThread.id, true).then(() => undefined)}
                    />
                  )}
                  {activeThread && <RuntimeSwitcher
                    thread={activeThread}
                    activeAgent={activeComposerAgent}
                    agents={agents}
                    isRunning={activeThread.runStatus === 'running'}
                    onRuntimeChange={updateThreadAgentRuntimeOverride}
                    onOpenRuntimeCenter={() => openSettingsSection('runtimes')}
                  />}
                </header>
              )}
              <div className="thread" ref={threadScrollRef}>
                <div className="thread-content" ref={threadContentRef}>
                {openingThreadId && <div className="thread-opening-skeleton" role="status" aria-live="polite">
                  <span /><span /><span /><span />
                  <small>正在打开对话…</small>
                </div>}
                {!openingThreadId && threadOpenError && <div className="thread-opening-error" role="alert"><TriangleAlert size={16} /><span>{threadOpenError}</span><button type="button" onClick={() => void openThread(selectedThreadId)}>重试</button></div>}
                {visibleMessages.map((message) => {
                  const transcript = activeThread?.runTranscripts?.find((item) => item.messageId === message.id || (message.externalRunId && item.runId === message.externalRunId));
                  const messageAgent = message.agentId === 'user' || message.agentId === 'system' ? null : agents.find((agent) => agent.id === message.agentId) || null;
                  const messageModelOverride = messageAgent ? activeThread?.agentModelOverrides?.[messageAgent.id] || '' : '';
                  const messageModelValue = messageAgent ? messageModelOverride || modelValueForAgent(messageAgent, models, {}, uiSettings.defaultModel) : '';
                  const messageRunOverride = messageAgent ? activeThread?.agentRunOverrides?.[messageAgent.id] || {} : {};
                  const messagePlan = message.planId ? activeThread?.planSessions?.find((plan) => plan.id === message.planId) : null;
                  const messagePlanDraft = messagePlan?.drafts.find((draft) => draft.revision === message.planRevision);
                  const collaborationPlanMessage = message.contentType === 'plan' && messagePlan?.purpose === 'collaboration';
                  const collaborationPlanResponse = message.contentType === 'collaboration_plan_response' && messagePlan?.purpose === 'collaboration';
                  const messageRunId = message.externalRunId || messagePlanDraft?.submittedByRunId || '';
                  const showMessageActions = message.agentId !== 'user'
                    && message.agentId !== 'system'
                    && !message.id.startsWith('local-')
                    && Boolean(message.content.trim())
                    && transcript?.status !== 'running'
                    && !(messageRunId && messageRunId === activeHermesRun?.runId);
                  return <div
                    className="message-anchor"
                    data-message-id={message.id}
                    key={message.id}
                    ref={(node) => { messageRefs.current[message.id] = node; }}
                  >
                    {!collaborationPlanMessage && <article className={message.agentId === 'user' ? 'message user has-user-identity' : 'message'}>
                      {message.agentId !== 'user' && (messageAgent ? <MessageAgentSessionConfig
                        message={message}
                        agent={messageAgent}
                        runtimeId={effectiveRuntimeForAgentUi(messageAgent, activeThread)}
                        models={hermesProfileModelOptions}
                        value={messageModelValue}
                        modelOverride={messageModelOverride}
                        runOverride={messageRunOverride}
                        capabilities={modelCapabilities}
                        open={messageAgentConfigOpenId === message.id}
                        onOpenChange={(open) => setMessageAgentConfigOpenId(open ? message.id : '')}
                        onChange={(value) => updateThreadAgentModelOverride(messageAgent.id, value)}
                        onRunOverrideChange={(override) => updateThreadAgentRunOverride(messageAgent.id, override)}
                      /> : <MessageAvatar message={message} agents={agents} />)}
                      <div className="message-body">
                        {message.agentId !== 'user' && <div className="message-meta">
                          <strong>{message.agentName}</strong>
                          {message.runtimeName && <span>{message.runtimeName}</span>}
                          {message.modelId && <span title={message.modelId}>{message.modelId}</span>}
                          {message.resumeStrategy === 'native_resumed' && <span title="已恢复该 Agent 在这套运行时中的原生 Session">原生续接</span>}
                          {message.resumeStrategy === 'handoff_resumed' && <span title="原生 Session 无法恢复，已通过 Frakio 交接包继续">交接续接</span>}
                          {message.routeReason === 'structured_handoff' && message.handoff?.objective && <span title={message.handoff.objective}>{`${message.handoff.sourceAgentName || message.handoff.sourceAgentId || 'Agent'} 交办`}</span>}
                          {message.permissionCoverage === 'partial' && <span title="该运行时只暴露了部分可裁决操作">部分权限覆盖</span>}
                          {Boolean(message.appliedSkillCount) && <span>{message.appliedSkillCount} 个 Skill 已生效</span>}
                        </div>}
                        {message.attachments && message.attachments.length > 0 && <MessageAttachments attachments={message.attachments} />}
                        {message.context && (message.context.browserAnnotations.length > 0 || message.context.reviewComments.length > 0) && (
                          <MessageContextSummary context={message.context} />
                        )}
                        {message.workArtifacts && message.workArtifacts.length > 0 && <WorkMessageArtifacts artifacts={message.workArtifacts} workspaceId={activeWorkspace?.id || activeThread?.workspaceId || ''} />}
                        {message.agentId === 'user' ? (
                          message.content ? <p className="message-text">{message.content}</p> : null
                        ) : message.contentType === 'collaboration_suggestion' && message.collaborationSuggestion ? (
                          <CollaborationSuggestionCard suggestion={message.collaborationSuggestion} busy={collaborationSuggestionStartingId === message.id} disabled={isRunning || Boolean(activeProposal)} onStart={() => void startSuggestedCollaboration(message)} />
                        ) : message.contentType === 'plan' && messagePlan && messagePlanDraft ? (
                          messagePlan.purpose === 'collaboration' ? null : <PlanCard
                            plan={messagePlan}
                            draft={messagePlanDraft}
                            agents={agents}
                            latest={messagePlan.currentRevision === messagePlanDraft.revision}
                            readOnly={Boolean(messagePlan.readOnly)}
                            busy={Boolean(planAction)}
                            feedbackOpen={planFeedbackOpen && messagePlan.id === activeProposal?.id}
                            feedback={planFeedbackDraft}
                            error={planActionError}
                            onFeedbackChange={setPlanFeedbackDraft}
                            onOpenFeedback={() => { setPlanFeedbackOpen(true); setPlanActionError(''); }}
                            onCloseFeedback={() => { setPlanFeedbackOpen(false); setPlanFeedbackDraft(''); }}
                            onSubmitFeedback={() => void submitPlanFeedback()}
                            onExecute={() => void executePlan(messagePlan.id)}
                            onCancel={() => void cancelPlan(messagePlan.id)}
                          />
                        ) : (
                          transcript?.groups.length
                            ? <RunTranscriptContent content={message.content} groups={transcript.groups} runFinished={transcript.status !== 'running'} threadId={activeThread?.id} workspaceId={activeThread?.workspaceId} />
                            : <MarkdownMessage content={message.content} threadId={activeThread?.id} workspaceId={activeThread?.workspaceId} />
                        )}
                        {collaborationPlanResponse && <InlineCollaborationBlock
                          thread={activeThread}
                          agents={agents}
                          anchorMessageId={message.id}
                          anchorPlanId={message.planId}
                          onAdjust={(planId, feedback) => void requestCollaborationRevision(planId, feedback)}
                        />}
                        {message.handoffs?.some((handoff) => handoff.status === 'failed') && <div className="message-handoffs" aria-label="Agent 转交失败">{message.handoffs.filter((handoff) => handoff.status === 'failed').map((handoff) => <span className="message-handoff failed" key={handoff.routeId}><Network size={13} />{`转交 ${handoff.targetAgentName} 失败`}<button onClick={() => void retryHandoff(handoff.routeId)}>重试</button></span>)}</div>}
                        {message.changeSetId && message.changeSummary && message.changeSummary.fileCount > 0 && (
                          <button className="message-change-summary" type="button" onClick={() => openRightRailTab('review')}>
                            <GitCompareArrows size={14} />
                            <span>{message.changeSummary.fileCount} 个文件</span>
                            <em>+{message.changeSummary.additions}</em>
                            <del>-{message.changeSummary.deletions}</del>
                          </button>
                        )}
                        {showMessageActions && (
                          <MessageActions
                            message={message}
                            copied={copiedMessageId === message.id}
                            feedbackBusy={feedbackMessageId === message.id}
                            branching={branchingMessageId === message.id}
                            error={messageActionError?.messageId === message.id ? messageActionError.message : ''}
                            onCopy={() => void copyAgentMessage(message)}
                            onFeedback={(value) => void updateMessageFeedback(message, value)}
                            onBranch={() => void branchFromMessage(message)}
                          />
                        )}
                      </div>
                      {message.agentId === 'user' && <MessageAvatar message={message} agents={agents} userProfile={userProfile} />}
                    </article>}
                    {message.agentId !== 'user' && !collaborationPlanResponse && <InlineCollaborationBlock
                      thread={activeThread}
                      agents={agents}
                      anchorMessageId={message.id}
                      anchorPlanId={message.planId}
                      onAdjust={(planId, feedback) => void requestCollaborationRevision(planId, feedback)}
                    />}
                  </div>;
                })}
                <InlineCollaborationBlock thread={activeThread} agents={agents} fallback={!visibleMessages.some((message) => message.contentType === 'collaboration_plan_response')} onAdjust={(planId, feedback) => void requestCollaborationRevision(planId, feedback)} />
                {!isRunning && <PersistedInterruptedRuns thread={activeThread} agents={agents} />}
                {activeRunUi?.compactionRecords?.map((record) => (
                  <ContextCompactionRecord key={record.operationId} record={record} />
                ))}
                {liveRunPresentations.length > 0 ? liveRunPresentations.map((presentation) => (
                  <ChatRunStatus
                    key={`run:${presentation.hostRunId}`}
                    target={presentation.target
                      || (agents.find((agent) => agent.id === presentation.agentId) ? { kind: 'agent', agent: agents.find((agent) => agent.id === presentation.agentId)! } : null)
                      || (presentation.hostRunId === (activeRunUi?.activeRun?.hostRunId || activeRunUi?.activeRun?.runId) ? runTarget : null)}
                    startedAt={presentation.startedAt || runStartedAt}
                    tick={runTick}
                    draft={presentation.draft}
                    activityGroups={presentation.activityGroups}
                    presentationPhase={presentation.presentationPhase}
                    error={presentation.error}
                    errorCode={presentation.errorCode}
                    onMigrateToNative={presentation.agentId && activeThread ? () => void migrateThreadAgentToNative(activeThread.id, presentation.agentId) : undefined}
                    streamingResponses={uiSettings.streamingResponses !== false}
                    threadId={activeThread?.id}
                    workspaceId={activeThread?.workspaceId}
                  />
                )) : isRunning && !activeRunUi?.hideStatus && (
                  <ChatRunStatus
                    target={runTarget || (activeComposerAgent ? { kind: 'agent', agent: activeComposerAgent } : null)}
                    startedAt={runStartedAt}
                    tick={runTick}
                    draft={runDraft}
                    activityGroups={runActivityGroups}
                    presentationPhase={runPresentationPhase}
                    error={runError}
                    errorCode={runErrorCode}
                    onMigrateToNative={activeThread && runTarget?.kind === 'agent' ? () => void migrateThreadAgentToNative(activeThread.id, runTarget.agent.id) : undefined}
                    streamingResponses={uiSettings.streamingResponses !== false}
                    threadId={activeThread?.id}
                    workspaceId={activeThread?.workspaceId}
                  />
                )}
                <div ref={threadBottomRef} />
                </div>
              </div>
              {!openingThreadId && <ThreadOverviewRail rounds={overviewRounds} activeRoundId={activeOverviewRoundId} onJumpToRound={jumpToThreadRound} />}
              <div className="composer-shell">
                {!isFollowingLatest && hasNewThreadContent && (
                  <button
                    className={isRunning ? 'thread-jump-latest is-running' : 'thread-jump-latest'}
                    type="button"
                    aria-label="回到最新消息"
                    onClick={() => scrollThreadToLatest('smooth')}
                  >
                    <ArrowDownToLine size={16} aria-hidden="true" />
                  </button>
                )}
                {pendingProposalQuestion ? (
                  <PlanQuestionPanel
                    batch={pendingProposalQuestion}
                    submitting={Boolean(planAction)}
                    error={planActionError}
                    onSubmit={(answers) => void answerPlanQuestion(pendingProposalQuestion, answers)}
                    onCancel={() => void cancelPlanQuestion(pendingProposalQuestion)}
                  />
                ) : runClarification || runApproval ? (
                  <RunDecisionPanel
                    clarification={runClarification}
                    approval={runApproval}
                    submitting={runClarification ? clarificationSubmitting : approvalSubmitting}
                    error={runClarification ? clarificationError : approvalError}
                    onAnswer={(answer) => void respondToActiveClarification('answer', answer)}
                    onSkip={() => void respondToActiveClarification('skip')}
                    onInterrupt={() => void stopActiveRun()}
                    onApprove={(choice) => void approveActiveRun(choice)}
                  />
                ) : (
                  <div
                    className={`composer ${attachmentDragActive ? 'attachment-drag-active' : ''}${openingThreadId ? ' thread-opening' : ''}`}
                    aria-busy={Boolean(openingThreadId)}
                    onDragEnter={handleAttachmentDragEnter}
                    onDragOver={handleAttachmentDragOver}
                    onDragLeave={handleAttachmentDragLeave}
                    onDrop={handleAttachmentDrop}
                  >
                  <AttachmentTray attachments={attachments} notice={attachmentNotice} onRemove={removeAttachment} onRetry={retryAttachment} />
                  <DraftContextTray context={draftContext} onRemove={(kind, id) => void removeDraftContextItem(kind, id)} />
                  {activeRunUi?.changeSet && activeRunUi.changeSet.fileCount > 0 && (
                    <button className="composer-change-summary" type="button" onClick={() => openRightRailTab('review')}>
                      <LoaderCircle className={activeRunUi.changeSet.status === 'running' ? 'spin' : ''} size={13} />
                      <span>{activeRunUi.changeSet.status === 'running' ? '正在修改' : '上一轮改动'} · {activeRunUi.changeSet.fileCount} 个文件</span>
                      <em>+{activeRunUi.changeSet.additions}</em><del>-{activeRunUi.changeSet.deletions}</del>
                    </button>
                  )}
                  {attachmentDragActive && <div className="attachment-drop-overlay"><ArrowDownToLine size={22} /><strong>松开即可添加附件</strong></div>}
                  {activeProposal
                    ? activeCollaborationProposal
                      ? <div className="work-mode-hint collaboration-mode-hint collaboration-plan-hint"><UsersRound size={13} /><span>正在整理多 Agent 协作方案，确认前不会创建任务</span></div>
                      : <div className="work-mode-hint plan-mode-hint"><Lightbulb size={14} /><span>先调查并整理计划，批准前不会修改项目或启动任务</span></div>
                    : activeWorkflowRunning && <div className="work-mode-hint collaboration-mode-hint"><UsersRound size={13} /><span>协作正在运行，发送内容将作为当前任务引导</span></div>}
                  <AnimatePresence initial={false}>
                    {collaborationIntentEnabled && <CollaborationIntentIndicator key="thread-collaboration" adjusting={Boolean(activeThread?.collaboration?.workflows?.some((workflow) => ['active', 'paused'].includes(workflow.status)))} />}
                  </AnimatePresence>
                  <MentionTextarea
                    value={input}
                    onChange={setInput}
                    onSend={() => void sendMessage()}
                    sendKey={uiSettings.sendKey || 'enter'}
                    agents={agents}
                    selectedAgentIds={selectedAgentIds}
                    placeholder="随意输入，随意@"
                    collaborationEnabled={collaborationIntentEnabled}
                    onCollaborationChange={(enabled) => setCollaborationIntentByThreadId((current) => ({ ...current, [activeThread!.id]: enabled }))}
                  />
	                  <div className="composer-toolbar">
	                    <div className="composer-left-tools">
	                      <ComposerAddMenu
	                        planEnabled={Boolean(activePlan)}
                        planBusy={Boolean(activeProposal) || Boolean(planAction) || isRunning || collaborationIntentEnabled || activeWorkflowRunning}
	                        onAddFile={() => fileInputRef.current?.click()}
	                        onEnablePlan={() => void setThreadPlanMode(true)}
	                      />
                      <input ref={fileInputRef} className="file-input" type="file" multiple accept={attachmentAcceptValue} onChange={(event) => handleAttachmentChange(event.target.files)} />
                      <PermissionModeControl compact={conversationMainCompact} value={permissionMode} onChange={(mode) => void updateThreadPermissionMode(mode)} />
                      <CollaborationIntentControl active={collaborationIntentEnabled} disabled={isRunning || Boolean(planAction) || Boolean(activePlan) || Boolean(activeProposal) || activeWorkflowRunning} adjusting={activeWorkflowRunning} onChange={(enabled) => setCollaborationIntentByThreadId((current) => ({ ...current, [activeThread!.id]: enabled }))} />
                      {activePlan && <PlanModeIndicator busy={Boolean(planAction)} onClose={() => void setThreadPlanMode(false)} />}
	                    </div>
	                    <div className="composer-right-tools">
                      <ProviderModelPicker
                        className="composer-model composer-agent-model"
                        runtimeId={activeComposerRuntimeId}
                        agentName={activeComposerAgent?.name || ''}
                        value={activeComposerProfileModelValue}
                        models={hermesProfileModelOptions}
                        emptyLabel="未配置模型"
                        ariaLabel={activeComposerAgent ? `${activeComposerAgent.name} 的 Frakio Model Center 模型` : 'Frakio Model Center 模型'}
                        title="Frakio Model Center"
                        allowDefault
                        usingDefault={!activeThreadModelOverride}
                        runOverride={activeThreadRunOverride}
                        capabilities={modelCapabilities}
                        onRunOverrideChange={(override) => activeComposerAgent ? updateThreadAgentRunOverride(activeComposerAgent.id, override) : undefined}
                        onChange={(value) => activeComposerAgent ? updateThreadAgentModelOverride(activeComposerAgent.id, value) : undefined}
                      />
	                      <ComposerRunButton
	                        isRunning={isRunning}
	                        hasActiveRun={Boolean(activeHermesRun)}
	                        isStopping={runStopping}
                        canSend={!openingThreadId && !workflowControlInProgress && attachments.every((item) => item.status === 'ready') && Boolean(input.trim() || attachments.length || draftContext.browserAnnotations.length || draftContext.reviewComments.length)}
                        runningLabel={activeThread?.collaboration?.workflows?.some((workflow) => workflow.status === 'active') ? '停止当前会话运行，不会暂停后台协作' : undefined}
	                        onSend={() => void sendMessage()}
	                        onStop={() => void stopActiveRun()}
	                      />
	                    </div>
	                  </div>
	                  {planActionError && !pendingProposalQuestion && <div className="plan-inline-error" role="alert">{planActionError}</div>}
	                </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {rightRailKind && (
        <>
          {!isMacConversationShell && !browserFullWorkspace && (
            <ResizeHandle
              side="right"
              currentWidth={renderedContextWidth}
              minWidth={contextWidthBounds.min}
              maxWidth={contextResizeMax}
              disabled={!rightRailOpen}
              onResize={resizeContextWidth}
              onCommit={commitContextWidth}
            />
          )}
          <aside className="context" aria-hidden={!rightRailOpen}>
            {rightRailOpen && (
            <CollaborationContextPanel
            contextPacket={activeThread?.contextPacket || null}
            proposals={activeThread?.proposals || []}
            workspaceArtifacts={workspaceArtifacts}
            thread={activeThread}
            agents={agents}
            workspace={activeWorkspace}
            activeVault={activeVault}
            isRunning={isRunning}
            runApproval={runApproval}
            runClarification={runClarification}
            runError={runError}
            runDraft={runDraft}
            liveChangeSet={activeRunUi?.changeSet || null}
            onDraftContextChanged={refreshDraftContext}
            onOpenVaultSettings={() => openSettingsSection('vaults')}
            fallbackDecisionAgentId={uiSettings.fallbackDecisionAgentId || globalDefaultAgentId}
            collaborationModeError={collaborationModeError}
            collaborationModeLoading={modeSwitching}
            onRetryCollaboration={() => void updateThreadExecutionMode('work')}
            panelTab={rightRailTab}
            hasOpenTabs={openRightRailTabs.length > 0}
            collaborationTaskRequest={collaborationTaskRequest}
            onOpenTab={openRightRailTab}
            onCloseTab={closeRightRailTab}
            />
            )}
          </aside>
        </>
      )}

      {agentPickerOpen && (
        <div className="modal-backdrop" onClick={() => setAgentPickerOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><h2>团队成员</h2><p>@Agent 会自动加入当前 Workspace，也可以在这里手动管理成员。</p></div>
              <button className="icon-btn" onClick={() => setAgentPickerOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <div className="agent-list">
              {agents.map((agent) => (
                <div
                  className={`agent-option ${agent.id === 'iris' ? 'locked' : ''}`}
                  key={agent.id}
                  onClick={() => void toggleAgent(agent.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void toggleAgent(agent.id); }}
                  role="button"
                  tabIndex={0}
                >
                  <AgentAvatar agent={agent} />
                  <span className="agent-option-main">
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                    <em>默认模型：{agentDefaultModelLabel(agent, models)} · 本会话：{agentSessionModelLabel(agent, models, activeThread?.agentModelOverrides || {}, uiSettings.defaultModel)}</em>
                  </span>
                  <button
                    className="agent-row-icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAgentModelEditorId(agent.id);
                    }}
                    aria-label={`编辑 ${agent.name} 本会话模型`}
                    title="编辑本会话模型"
                    type="button"
                  >
                    <Pencil size={15} />
                  </button>
                  <span className={selectedAgentIds.includes(agent.id) ? 'check on' : 'check'}><CheckCircle2 size={17} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {agentModelEditorId && activeThread && (
        <AgentSessionModelModal
          agent={agents.find((agent) => agent.id === agentModelEditorId) || null}
          models={models}
          value={agents.find((agent) => agent.id === agentModelEditorId) ? modelValueForAgent(agents.find((agent) => agent.id === agentModelEditorId)!, models, activeThread.agentModelOverrides || {}, uiSettings.defaultModel) : ''}
          onClose={() => setAgentModelEditorId(null)}
          onSave={async (agentId, modelId) => {
            await updateThreadAgentModelOverride(agentId, modelId);
            setAgentModelEditorId(null);
          }}
          onOpenModels={() => {
            setAgentModelEditorId(null);
            setAgentPickerOpen(false);
            setActiveView('thread');
            setActiveNav('models');
          }}
        />
      )}
      {projectModalOpen && (
        <div className="modal-backdrop" onClick={() => setProjectModalOpen(false)}>
          <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><h2>{projectModalPurpose === 'convert' ? '转为项目' : '新建项目'}</h2><p>{projectModalPurpose === 'convert' ? '选择一个文件夹作为项目目录，当前对话会保存到这里。' : '选择一个文件夹作为项目目录，项目对话和产物会保存在这里。'}</p></div>
              <button className="icon-btn" onClick={() => setProjectModalOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <div className="project-form">
              <div className="project-knowledge-profile" role="group" aria-label="项目资料库策略">
                <button type="button" className={projectKnowledgeProfile === 'personal' ? 'selected' : ''} onClick={() => setProjectKnowledgeProfile('personal')}><strong>个人项目</strong><small>默认使用个人资料库</small></button>
                <button type="button" className={projectKnowledgeProfile === 'team' ? 'selected' : ''} onClick={() => setProjectKnowledgeProfile('team')}><strong>团队项目</strong><small>默认隔离个人资料库文档</small></button>
              </div>
              <div className="project-choice-grid">
                <button className={projectMode === 'create' ? 'selected' : ''} onClick={() => setProjectMode('create')}>
                  <span><Plus size={17} /></span>
                  <strong>创建新文件夹</strong>
                  <small>输入项目名后，Frakio Work 会在选定位置创建目录。</small>
                </button>
                <button className={projectMode === 'existing' ? 'selected' : ''} onClick={() => void chooseExistingProjectFolder()}>
                  <span><FolderOpen size={17} /></span>
                  <strong>选择已有文件夹</strong>
                  <small>直接选择你已经准备好的项目文件夹。</small>
                </button>
              </div>
              {projectMode === 'create' ? (
                <>
                  <div className="project-location-row">
                    <span>保存位置</span>
                    <button className="secondary-btn" onClick={() => void chooseProjectParentFolder()}><FolderOpen size={14} />选择位置</button>
                  </div>
                  <div className="project-path-preview">{projectParentPath || '请先选择保存位置'}</div>
                  <label className="form-row">
                    <span>项目名称</span>
                    <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={projectModalPurpose === 'convert' ? '留空则使用当前对话标题' : '例如 Frakio Works'} disabled={!projectParentPath.trim()} />
                  </label>
                  {projectName.trim() && (
                    <div className="project-path-preview target">{projectParentPath}/{workspaceDirectoryPreview(projectName)}</div>
                  )}
                </>
              ) : (
                !canSelectFolder && (
                  <label className="form-row">
                    <span>已有文件夹路径</span>
                    <input value={projectRootPath} onChange={(event) => setProjectRootPath(event.target.value)} placeholder="/path/to/frakio-workspace" />
                  </label>
                )
              )}
              {projectError && <div className="form-error">{projectError}</div>}
              <div className="modal-actions">
                <button className="secondary-btn" onClick={() => setProjectModalOpen(false)}>取消</button>
                {projectMode === 'create' ? (
                  <button className="send-btn" disabled={!projectParentPath.trim() || !projectName.trim()} onClick={() => projectModalPurpose === 'convert' ? void convertActiveConversationToProject() : void createWorkspaceProject()}>{projectModalPurpose === 'convert' ? '转为项目' : '创建项目'}</button>
                ) : (
                  <button className="send-btn" disabled={!projectRootPath.trim()} onClick={() => projectModalPurpose === 'convert' ? void convertActiveConversationToProject() : void createWorkspaceProject()}>{projectModalPurpose === 'convert' ? '转为项目' : '创建项目'}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {directoryPicker.open && (
        <div className="modal-backdrop" onClick={() => closeServerDirectoryPicker(null)}>
          <div className="modal server-directory-picker" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><h2>选择运行主机上的文件夹</h2><p>{directoryPicker.current || '正在读取主目录…'}</p></div>
              <button className="icon-btn" onClick={() => closeServerDirectoryPicker(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <div className="server-directory-list">
              {directoryPicker.parent ? (
                <button onClick={() => void loadServerDirectory(directoryPicker.parent)}><FolderOpen size={16} /><span>返回上一级</span></button>
              ) : null}
              {directoryPicker.entries.map((entry) => (
                <button key={entry.path} onDoubleClick={() => closeServerDirectoryPicker(entry.path)} onClick={() => void loadServerDirectory(entry.path)}>
                  <FolderOpen size={16} /><span>{entry.name}</span>
                </button>
              ))}
              {!directoryPicker.loading && !directoryPicker.entries.length ? <p>这个文件夹中没有子文件夹。</p> : null}
              {directoryPicker.error ? <div className="form-error">{directoryPicker.error}</div> : null}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => closeServerDirectoryPicker(null)}>取消</button>
              <button className="send-btn" disabled={!directoryPicker.current || directoryPicker.loading} onClick={() => closeServerDirectoryPicker(directoryPicker.current)}>选择此文件夹</button>
            </div>
          </div>
        </div>
      )}
      {newAgentOpen && (
        <AgentEditorModal
          title="新建 Agent"
          models={models}
          agent={null}
          onClose={() => { agentCreationRequestIdRef.current = ''; setNewAgentOpen(false); }}
          onSave={createAgent}
        />
      )}
      {editingAgentId && (
        <AgentEditorModal
          title="Agent Profile"
          models={models}
          agent={agents.find((agent) => agent.id === editingAgentId) || null}
          onClose={() => setEditingAgentId(null)}
          onSave={async (payload) => {
            await updateAgent(editingAgentId, payload);
            setEditingAgentId(null);
          }}
        />
      )}
      {globalSearchOpen && (
        <GlobalSearchDialog
          conversations={conversations}
          agents={agents}
          onClose={() => setGlobalSearchOpen(false)}
          onOpenThread={async (threadId) => {
            setGlobalSearchOpen(false);
            await openThread(threadId);
          }}
          onOpenAgent={(agentId) => {
            setGlobalSearchOpen(false);
            setSelectedOrgAgentId(agentId);
            setActiveNav('org');
          }}
          onOpenSettings={() => {
            setGlobalSearchOpen(false);
            openSettingsSection('workbench');
          }}
        />
      )}
    </div>
    )}
    {showTelemetryNotice && launchPhase === 'done' && (
      <TelemetryNotice
        onAllow={() => void answerTelemetryConsent(true)}
        onDecline={() => void answerTelemetryConsent(false)}
      />
    )}
    {launchPhase !== 'done' && (
      <LaunchLoadingScreen
        phase={launchPhase}
        userAvatarUrl={launchWelcomeAvatarUrl}
        installJob={launchInstallJob}
        issue={launchIssue}
        appearance={workspaceMaterialDark ? 'dark' : 'light'}
        colorMode={workspaceMaterialTheme.colorMode === 'native' ? 'native' : 'custom'}
        style={workspaceMaterialStyle}
        hold={Boolean(launchQaMode)}
        onOpenSettings={(issue) => {
          setLaunchPhase('done');
          openSettingsSection(issue.settingsTarget);
        }}
      />
    )}
    </>
  );
}



// GlobalSearchDialog, Hermes 集成与工作区页面已解耦至 components/common/GlobalSearchDialog, components/settings/HermesIntegrationsPage 及 components/workspace/WorkspaceSurfaces


// RuntimeSwitcher, ThreadActionsMenu 已解耦至 components/layout/HeaderControls

// CollaborationCards, IconTooltipButton, RightRailPanels 已解耦至独立组件模块

type ProviderModelMenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  openAbove: boolean;
  submenuSide: 'left' | 'right';
};


// MessageAgentSessionConfig, RailScrollingTitle, ThreadRailContent, RenameDialog 已解耦至独立组件模块

// launch-storage 与 ResizeHandle 已解耦至独立组件模块

const richContentQa = new URLSearchParams(window.location.search).get('rich-content-qa') === '1';
const streamRevealQa = new URLSearchParams(window.location.search).get('stream-reveal-qa') === '1';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {streamRevealQa
      ? <StreamRevealQaPage />
      : richContentQa
        ? <RichContentQaPage />
        : <ManagedWebAuthGate><App /></ManagedWebAuthGate>}
  </React.StrictMode>,
);
