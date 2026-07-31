import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  AppUpdateStatus,
  Attachment,
  CollaborationMode,
  HermesAgentTurn,
  HermesNetworkStatus,
  PlanDraft,
  PlanQuestionBatch,
  PlanSession,
  RunActivityGroup,
  RunActivityItem,
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
import { availablePaneMax, normalizePaneWidth, paneWidthFromKey, paneWidthFromPointer } from './pane-resize.mjs';
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
import { contrastForegroundForTint, workspaceTintAlpha } from './theme-contrast.mjs';
import { buildProfileActivity } from './profile-activity.mjs';
import type { ProfileActivityCell, ProfileActivityMode } from './profile-activity.mjs';
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
  Bot,
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
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  Hand,
  Image,
  Library,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Minus,
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
  X,
  Zap as ZapIcon,
} from 'lucide-react';
import frakioBrandLogoUrl from './assets/frakio-brand-logo.png';
import hermesRuntimeLogoUrl from './assets/runtime-logos/hermes.svg';
import piRuntimeLogoUrl from './assets/runtime-logos/pi.svg';
import codexRuntimeLogoUrl from './assets/runtime-logos/codex.svg';
import claudeRuntimeLogoUrl from './assets/runtime-logos/claude.svg';
import geminiRuntimeLogoUrl from './assets/runtime-logos/gemini.svg';
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
      openRelease?: (targetUrl: string) => Promise<{ ok?: boolean }>;
      openExternal?: (targetUrl: string) => Promise<{ ok?: boolean }>;
      getUpdateState?: () => Promise<DesktopUpdateState>;
      checkForUpdates?: () => Promise<DesktopUpdateState>;
      downloadUpdate?: () => Promise<DesktopUpdateState>;
      cancelUpdateDownload?: () => Promise<DesktopUpdateState>;
      openDownloadedUpdate?: () => Promise<DesktopUpdateState>;
      onUpdateStateChanged?: (listener: (state: DesktopUpdateState) => void) => () => void;
    };
  }
}

type ProfileModuleUsage = { useCount?: number; viewCount?: number; patchCount?: number; state?: string; lastUsedAt?: string | null };
type ProfileModuleEntry = string | { name: string; file?: string; description?: string; category?: string; enabled?: boolean; status?: string; statusLabel?: string; source?: string; usage?: ProfileModuleUsage };
type ManagedHermesModuleKind = 'skill' | 'plugin';
type ManagedHermesModule = {
  kind: ManagedHermesModuleKind;
  scope: 'global' | 'profile';
  name: string;
  profileName: string;
  agentId?: string;
  agentName?: string;
  avatarUrl?: string;
  color?: string;
  originProfileName?: string;
  originAgentId?: string;
  originAgentName?: string;
  originAvatarUrl?: string;
  originColor?: string;
  description: string;
  category: string;
  file: string;
  hash: string;
  enabled: boolean;
  promotedAt?: string | null;
  nativeGlobal?: boolean;
  duplicateProfileNames?: string[];
  archivedDuplicateProfiles?: string[];
};
type ManagedHermesModulesPayload = {
  kind: ManagedHermesModuleKind;
  profiles: Array<{ profileName: string; agentId: string; name: string; role: string; avatarUrl?: string; color?: string; inheritedGlobalCount: number }>;
  global: ManagedHermesModule[];
  profile: ManagedHermesModule[];
};
type RuntimeId = 'hermes' | 'pi' | 'codex' | 'claude' | 'gemini' | string;
type AgentRuntimePolicy = { defaultRuntimeId: RuntimeId; allowedRuntimeIds: RuntimeId[]; permissionProfileId: string };
type RuntimeModelCompatibility = { status: 'ready' | 'partial' | 'unsupported' | 'missing_credentials'; credentialStatus: 'ready' | 'missing' | 'not_required'; usableModelIds: string[]; unsupportedModelIds: string[]; reason: string };
type RuntimeModelCatalogEntry = { id: string; name: string; provider?: string; defaultModelId?: string; models: string[]; compatibility: RuntimeModelCompatibility };
type RuntimeModelCatalog = { runtimeId: string; source: string; models: RuntimeModelCatalogEntry[]; usableModelCount?: number };
type RuntimeDefinition = {
  id: RuntimeId;
  name: string;
  kind: 'core' | 'channel';
  bundled: boolean;
  enabled: boolean;
  capabilities: Record<string, boolean>;
  installation?: { status: string; installed: boolean; version: string; command?: string; authMode?: string; detail?: string; checkedAt: string };
};
const runtimeLabels: Record<string, string> = { hermes: 'Hermes', pi: 'Pi', codex: 'Codex', claude: 'Claude', gemini: 'Gemini' };
const runtimeVisuals: Record<string, { iconUrl: string; label: string }> = {
  hermes: { iconUrl: hermesRuntimeLogoUrl, label: 'Hermes' },
  pi: { iconUrl: piRuntimeLogoUrl, label: 'Pi' },
  codex: { iconUrl: codexRuntimeLogoUrl, label: 'Codex' },
  claude: { iconUrl: claudeRuntimeLogoUrl, label: 'Claude Code' },
  gemini: { iconUrl: geminiRuntimeLogoUrl, label: 'Gemini CLI' },
};
const runtimeSeed: RuntimeDefinition[] = [
  { id: 'hermes', name: 'Hermes Agent', kind: 'core', bundled: true, enabled: true, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'frakio-managed', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'pi', name: 'Pi', kind: 'core', bundled: true, enabled: true, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'frakio-managed', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'codex', name: 'Codex', kind: 'channel', bundled: false, enabled: false, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'native', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'claude', name: 'Claude Code', kind: 'channel', bundled: false, enabled: false, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'native', detail: '正在检测运行时。', checkedAt: '' } },
  { id: 'gemini', name: 'Gemini CLI', kind: 'channel', bundled: false, enabled: false, capabilities: {}, installation: { status: 'checking', installed: false, version: '', authMode: 'native', detail: '正在检测运行时。', checkedAt: '' } },
];

function mergeRuntimeDefinitions(current: RuntimeDefinition[], updates: RuntimeDefinition[]) {
  const updateById = new Map(updates.map((runtime) => [runtime.id, runtime]));
  return runtimeSeed.map((seed) => updateById.get(seed.id) || current.find((runtime) => runtime.id === seed.id) || seed);
}

function isRuntimeReady(runtime: RuntimeDefinition | undefined) {
  return runtime?.installation?.status === 'ready' && runtime.installation.installed;
}

function RuntimeLabel({ runtimeId, showName = true, className = '' }: { runtimeId: RuntimeId; showName?: boolean; className?: string }) {
  const visual = runtimeVisuals[runtimeId] || { iconUrl: '', label: runtimeLabels[runtimeId] || runtimeId };
  return <span className={`runtime-label ${className}`.trim()}>
    {visual.iconUrl ? <img src={visual.iconUrl} alt="" aria-hidden="true" /> : <Cpu size={16} aria-hidden="true" />}
    {showName && <span>{visual.label}</span>}
  </span>;
}
type MemoryLedgerEntry = {
  id: string;
  scope: 'user' | 'agent' | 'workspace';
  subjectId: string;
  fact: string;
  confidence: number;
  status: 'candidate' | 'accepted' | 'superseded' | 'rejected';
  provenance: Array<{ source?: string; runtimeId?: string; runId?: string; createdAt?: string }>;
  validFrom?: string | null;
  validUntil?: string | null;
  updatedAt: string;
};
type Agent = { id: string; name: string; role: string; model: string; color: string; soul: string; scope: string; profileName?: string; gatewayStatus?: string; source?: string; soulExcerpt?: string; userProfileExcerpt?: string; memoryExcerpt?: string; userProfile?: string; memory?: string; providerSummary?: HermesProviderSummary[]; skills?: ProfileModuleEntry[]; plugins?: ProfileModuleEntry[]; avatarUrl?: string; runtimePolicy?: AgentRuntimePolicy; profileRevision?: string };
type ModelKind = 'official' | 'relay' | 'local';
type ModelProtocol = 'OpenAI Compatible' | 'Anthropic Compatible' | 'Custom';
type ProviderApiMode = 'chat_completions' | 'openai_responses' | 'codex_responses' | 'anthropic_messages' | 'bedrock_converse' | 'codex_app_server' | '';
type ProviderApiModePreference = 'auto' | 'chat_completions' | 'openai_responses' | 'anthropic_messages';
type ProviderAuthType = 'codex-device' | 'claude-pkce' | 'gemini-loopback';
type DesktopUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
type DesktopUpdateState = {
  supported: boolean;
  packaged: boolean;
  platform: string;
  arch: string;
  phase: DesktopUpdatePhase;
  currentVersion: string;
  latestVersion: string;
  checkedAt: string;
  publishedAt?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  assetName?: string;
  downloadedFileName?: string;
  restartRequired?: boolean;
  error?: string;
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number };
};
type ModelPricing = { input: number | null; output: number | null; cacheRead: number | null; cacheCreation: number | null };
type FastMode = 'none' | 'openai_priority' | 'anthropic_fast';
type ServiceTier = { id: string; name: string; description?: string; requestValue: string; billingNotice?: string };
type ModelCompat = { thinkingFormat: string; requestOverrides: Record<string, unknown> };
type ModelCapabilityOverride = { reasoning: boolean; reasoningEfforts: string[]; reasoningMap?: Record<string, string | null>; defaultReasoning?: string; serviceTiers?: ServiceTier[]; apiMode?: ProviderApiMode; thinkingFormat?: string; requestOverrides?: Record<string, unknown>; fastMode: FastMode; status?: 'confirmed' | 'unsupported' | 'unknown' };
type ModelCapability = { modelId?: string; reasoning: boolean; reasoningType: 'none' | 'binary' | 'levels'; reasoningEfforts: string[]; reasoningMap: Record<string, string | null>; defaultReasoning?: string; serviceTiers: ServiceTier[]; speedModes: string[]; fastMode: FastMode; source: string; confidence: 'confirmed' | 'inferred' | 'unknown'; status: 'confirmed' | 'unsupported' | 'unknown' | 'verification_failed'; reasoningStatus?: 'confirmed' | 'unsupported' | 'unknown' | 'verification_failed'; serviceTierStatus?: 'confirmed' | 'unsupported' | 'unknown' | 'verification_failed'; apiMode?: ProviderApiMode; thinkingFormat?: string; requestOverrides?: Record<string, unknown>; updatedAt?: string | null; verificationError?: string };
type CapabilityProbeResult = { kind: 'connection' | 'reasoning' | 'service_tier'; option: string; mappedValue: string; status: 'accepted' | 'unsupported' | 'unknown'; error?: string };
type CatalogInfo = { source: string; rich: boolean; modelIds?: string[]; url?: string; lastRefreshAt?: string | null; lastSuccessAt?: string | null; refreshError?: string; stale?: boolean };
type ModelPayload = { name: string; provider: string; kind: ModelKind; protocol: ModelProtocol; model: string; models: string[]; baseUrl: string; apiKey: string; pricing: ModelPricing; providerKey?: string; oauthAccountId?: string; apiMode?: ProviderApiMode; apiModePreference?: ProviderApiModePreference; modelsUrl?: string; modelApiModes?: Record<string, ProviderApiMode>; compat?: ModelCompat; modelCompat?: Record<string, ModelCompat>; contextLimit?: number | null; capabilityMode: 'auto' | 'manual'; capabilityOverrides: Record<string, ModelCapabilityOverride>; runtimeRevision?: string };
type ModelProfile = Omit<ModelPayload, 'apiKey'> & { id: string; hasApiKey: boolean; oauthAccountBindingRequired?: boolean; source?: 'demo' | 'hermes-studio' | 'hermes-profile' | 'manual'; profileName?: string; providerKey?: string; apiMode?: ProviderApiMode; apiModePreference?: ProviderApiModePreference; contextLimit?: number | null; runtimeRevision?: string };
type ModelFetchResult = { models: string[]; capabilities: Record<string, ModelCapability>; catalog?: CatalogInfo };
type ModelFetchContext = Partial<ModelPayload> & { modelId?: string };
type FetchAvailableModels = (baseUrl: string, apiKey: string, context?: ModelFetchContext) => Promise<ModelFetchResult>;
type SaveModel = (payload: ModelPayload, modelId?: string, persistedModels?: ModelProfile[]) => Promise<boolean>;
type ProviderPreset = { label: string; value: string; baseUrl: string; models: string[]; builtin: boolean; apiMode?: ProviderApiMode; authType?: ProviderAuthType; authenticated?: boolean; catalog?: CatalogInfo };
type OAuthAccount = { id: string; providerKey: string; label: string; identity: string; email?: string; expiresAt?: number; updatedAt?: string; models?: Array<{ id: string; name: string }> };
const compatibilityRelayProviderKeys = new Set(['ikuncode', 'fun-codex', 'fun-claude']);
type OAuthProviderState = 'unauthenticated' | 'authorizing' | 'authorized_loading_catalog' | 'ready' | 'catalog_error';

async function openExternalUrl(targetUrl: string): Promise<boolean> {
  if (!targetUrl) return false;
  if (window.frakioDesktop?.openExternal) {
    const result = await window.frakioDesktop.openExternal(targetUrl);
    return result?.ok === true;
  }
  return Boolean(window.open(targetUrl, '_blank', 'noopener,noreferrer'));
}
type AuxiliaryModelTask = { key: string; label: string; default_timeout?: number; default_download_timeout?: number };
type AuxiliaryModelSettings = { provider?: string; model?: string; base_url?: string; timeout?: number; download_timeout?: number; extra_body?: Record<string, any> };
type AuxiliaryModelsConfig = Record<string, AuxiliaryModelSettings>;
type VaultDoc = { relativePath: string; name: string; category: string; excerpt?: string };
type Vault = {
  id: string;
  name: string;
  path: string;
  status: string;
  documentCount: number;
  productCount: number;
  lastIndexedAt: string | null;
  needsRefresh: boolean;
};
type VaultSummary = {
  vaultRoot: string;
  vaultExists: boolean;
  documentCount: number;
  categories: Record<string, number>;
  products: string[];
  highSignal: VaultDoc[];
  ruleDocs: VaultDoc[];
  sopDocs: VaultDoc[];
  status: string;
  lastIndexedAt?: string;
  needsRefresh: boolean;
};
type ChatEvent = { id: string; agentId: string; agentName: string; role: string; content: string; attachments?: Attachment[]; reasoning?: string; externalRunId?: string; turnId?: string; mentionDepth?: number; parentMessageId?: string; routeReason?: string; runtimeId?: string; runtimeName?: string; modelId?: string; profileRevision?: string; contentType?: 'plan' | 'plan_feedback' | string; planId?: string; planRevision?: number; processingDurationMs?: number; feedback?: 'up' | 'down' | null; createdAt?: string };
type AttachmentDraft = { localId: string; file: File; previewUrl: string; status: 'uploading' | 'ready' | 'error'; attachment?: Attachment; error?: string };
const attachmentAcceptValue = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.svg', '.ico',
  '.txt', '.md', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.sql', '.pdf', '.doc', '.docx', '.odt', '.rtf',
  '.xls', '.xlsx', '.ppt', '.pptx', '.odp', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus',
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.html', '.py', '.rb', '.php', '.java', '.go', '.rs', '.swift', '.c', '.h', '.cpp', '.sh', '.zsh', '.vue', '.svelte', '.astro',
].join(',');
type MentionOption = { key: string; type: 'all' | 'agent'; name: string; label: string; description: string; agent?: Agent };
type ChatRunTarget = { kind: 'agent'; agent: Agent } | { kind: 'all'; agent: Agent | null };
type Proposal = { id: string; type: string; title: string; risk: 'low' | 'medium' | 'high'; target: string; status: string };
type WorkArtifact = { id?: string; name: string; kind: string; target?: string; relativePath?: string; path?: string; updatedAt?: string; size?: number };
type WorkspaceFileEntry = { name: string; relativePath: string; kind: 'file' | 'directory'; size?: number; updatedAt?: string; previewable?: boolean };
type WorkspaceFileContent = { name: string; relativePath: string; mimeKind: 'markdown' | 'text' | 'json' | 'code' | 'pdf' | 'image' | 'binary'; content?: string; size: number; updatedAt?: string; truncated: boolean };
type WorkflowStep = { title: string; status: 'pending' | 'running' | 'completed' | 'failed'; source?: 'run' | 'tool' | 'approval' | 'clarify' | 'simulation'; agentName?: string; detail?: string; updatedAt?: string; callId?: string };
type FollowMode = 'default' | 'conversation';
type CollaborationPlanTask = { key: string; taskId?: string; title: string; description?: string; assigneeAgentId: string; expectedResult?: string; dependsOnKeys: string[]; cancelled?: boolean };
type CollaborationPlan = { revision: number; goal?: string; summary?: string; tasks: CollaborationPlanTask[]; publishedAt?: string };
type CollaborationWorkflowControl = { operationId: string; idempotencyKey: string; action: 'pause' | 'resume' | 'cancel' | ''; state: 'idle' | 'pausing' | 'paused' | 'resuming' | 'cancelling' | 'cancelled' | 'pause_failed'; affectedTaskIds: string[]; stoppedRuns: number; blockedTasks: number; preservedWaitingTasks: number; failedTaskIds: string[]; heldInterventionCount: number; startedAt: string | null; completedAt: string | null; error: string };
type CollaborationWorkflow = { id: string; name: string; boardSlug: string; status: 'active' | 'paused' | 'completed' | 'cancelled' | 'archived'; coordinatorAgentId: string; fallbackDecisionAgentId: string; rootTaskIds: string[]; currentRootTaskId?: string; planRevision?: number; plan?: CollaborationPlan | null; interventionQueue?: Array<{ id: string; status: string }>; control?: CollaborationWorkflowControl; capability?: { status: string; protocolVersion?: number; error?: string }; createdAt: string; updatedAt: string; completedAt?: string | null; pausedAt?: string | null; cancelledAt?: string | null; archivedAt?: string | null };
type CollaborationEvent = { id: string; cursor: number; type: string; workflowId: string; taskId?: string; actorAgentId?: string; title: string; detail?: string; payload?: Record<string, any>; createdAt: string };
type CollaborationWorkflowSnapshot = CollaborationWorkflow & { tasks: KanbanTask[]; error?: string };
type CollaborationSnapshot = { threadId: string; mode?: 'chat' | 'work'; workerOutputMode?: 'summary' | 'all'; activeWorkflowId: string; cursor: number; workflows: CollaborationWorkflowSnapshot[]; events: CollaborationEvent[]; fallbackDecisionAgentId: string };
type ThreadCollaboration = { kind: string; activeAgentId?: string | null; lastMentionedAgentId?: string | null; lastMentionedAgentName?: string; maxMentionDepth?: number | 'unlimited'; lastRoutedAt?: string | null; lastRouteReason?: string; workflows?: CollaborationWorkflow[]; activeWorkflowId?: string; eventCursor?: number; events?: CollaborationEvent[] };
type ContextPacket = {
  title: string;
  conversation: { userIntent: string; activeAgents: string[]; currentConclusion: string };
  vault: { connected: boolean; documentCount?: number; products?: string[]; activeRules: string[] };
  policy: string;
};
type ThreadMode = 'workspace' | 'direct';
type PermissionMode = 'manual' | 'smart' | 'off';
type AgentModelOverrides = Record<string, string>;
type AgentRunOverride = { reasoningEffort?: string; speedMode?: string };
type AgentRunOverrides = Record<string, AgentRunOverride>;
type AgentRuntimeOverrides = Record<string, RuntimeId>;
type UserProfile = { avatarUrl: string; nickname: string; bio: string; age: string; hobbies: string; occupation: string; defaultAgentAddress: string; otherAgentAddress: string; completedAt: string; updatedAt: string };
type Thread = {
  id: string;
  spaceId?: string | null;
  workspaceId: string | null;
  mode: ThreadMode;
  executionMode?: 'chat' | 'work';
  collaborationMode?: CollaborationMode;
  activePlanId?: string;
  planSessions?: PlanSession[];
  workerOutputMode?: 'summary' | 'all';
  primaryAgentId: string | null;
  defaultAgentId?: string | null;
  activeAgentId?: string | null;
  followMode?: FollowMode;
  title: string;
  vaultId: string | null;
  selectedAgents: string[];
  agentModelOverrides?: AgentModelOverrides;
  agentRunOverrides?: AgentRunOverrides;
  agentRuntimeOverrides?: AgentRuntimeOverrides;
  runtimeId?: RuntimeId;
  permissionMode: PermissionMode;
  updatedAt: string;
  workflow: string[];
  workflowState?: WorkflowStep[];
  runTranscripts?: RunTranscript[];
  proposals: Proposal[];
  artifacts?: WorkArtifact[];
  contextPacket: ContextPacket | null;
  messages: ChatEvent[];
  engine?: 'simulate' | 'hermes-studio' | 'model-provider' | 'workspace-group' | 'hermes-agent';
  collaboration?: ThreadCollaboration;
  externalSessionId?: string | null;
  runStatus?: 'idle' | 'running' | 'failed';
  activeRunGroup?: HermesAgentTurn;
  archivedAt?: string | null;
  pinnedAt?: string | null;
  forkedFromThreadId?: string | null;
  forkedFromMessageId?: string | null;
  branchRootThreadId?: string | null;
};
type ThreadSummary = { id: string; spaceId?: string | null; workspaceId: string | null; workspaceRootPath?: string; title: string; mode: ThreadMode; executionMode?: 'chat' | 'work'; collaborationMode?: CollaborationMode; activePlanId?: string; workerOutputMode?: 'summary' | 'all'; primaryAgentId: string | null; primaryAgentName?: string; defaultAgentId?: string | null; activeAgentId?: string | null; participantAgentIds: string[]; followMode?: FollowMode; permissionMode?: PermissionMode; agentModelOverrides?: AgentModelOverrides; agentRunOverrides?: AgentRunOverrides; agentRuntimeOverrides?: AgentRuntimeOverrides; runtimeId?: RuntimeId; vaultId: string | null; vaultName: string; updatedAt: string; preview: string; engine?: 'simulate' | 'hermes-studio' | 'model-provider' | 'workspace-group' | 'hermes-agent'; artifactCount?: number; lastArtifactName?: string; runStatus?: 'idle' | 'running' | 'failed'; archivedAt?: string | null; pinnedAt?: string | null; forkedFromThreadId?: string | null; forkedFromMessageId?: string | null; branchRootThreadId?: string | null };
type ActiveHermesRun = { runId: string; sessionId: string; threadId: string };
type HermesApprovalChoice = 'once' | 'session' | 'always' | 'deny';
type HermesRunApproval = {
  id?: string;
  title: string;
  command: string;
  cwd?: string;
  tool?: string;
  choices?: HermesApprovalChoice[];
  allowPermanent?: boolean;
  smartDenied?: boolean;
};
type HermesRunClarification = { id: string; question: string; choices: string[]; timeoutMs?: number };
type RunUiState = {
  isRunning: boolean;
  /** Keeps the composer locked while a completed reply has already been handed to history. */
  hideStatus: boolean;
  presentationPhase: RunPresentationPhase;
  startedAt: number | null;
  target: ChatRunTarget | null;
  activeRun: ActiveHermesRun | null;
  draft: string;
  activityGroups: RunActivityGroup[];
  approval: HermesRunApproval | null;
  approvalSubmitting: boolean;
  approvalError: string;
  clarification: HermesRunClarification | null;
  clarificationSubmitting: boolean;
  clarificationError: string;
  error: string;
  stopping: boolean;
};

function createRunUiState(overrides: Partial<RunUiState> = {}): RunUiState {
  return {
    isRunning: false,
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
    stopping: false,
    ...overrides,
  };
}

function mergeRunActivityEvent(groups: RunActivityGroup[], data: any): RunActivityGroup[] {
  const activity = data.activity as RunActivityItem | undefined;
  if (!activity?.id) return groups;
  const groupId = String(data.groupId || `activity:${data.contentOffset || 0}`);
  const existingGroupIndex = groups.findIndex((group) => group.id === groupId || group.items.some((item) => item.id === activity.id));
  if (existingGroupIndex < 0) {
    return [...groups, {
      id: groupId,
      contentOffset: Math.max(0, Number(data.contentOffset || 0)),
      status: data.groupStatus || activity.status,
      summary: String(data.groupSummary || activity.activeLabel || '正在执行操作'),
      items: [activity],
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    }];
  }
  return groups.map((group, groupIndex) => {
    if (groupIndex !== existingGroupIndex) return group;
    const itemIndex = group.items.findIndex((item) => item.id === activity.id);
    const items = itemIndex < 0
      ? [...group.items, activity]
      : group.items.map((item, index) => index === itemIndex ? { ...item, ...activity } : item);
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
type SpaceGradientColor = { id: string; color: string; x: number; y: number; isPrimary?: boolean };
type ThemeHarmony = 'floating' | 'singleAnalogous' | 'complementary' | 'splitComplementary' | 'analogous' | 'triadic';
type ThemePreset = { id: string; page: number; colors: string[]; point: { x: number; y: number }; harmony: ThemeHarmony; type?: 'color' | 'grayscale' };
type SpaceThemeAppearance = 'auto' | 'light' | 'dark';
type AppAppearance = 'system' | 'light' | 'dark';
type SpaceThemeColorMode = 'native' | 'custom';
type SpaceThemePalette = { accentColor: string; sidebarBg: string; opacity: number; noise: number; texture?: number; mode: 'soft' | 'crisp'; gradientColors?: SpaceGradientColor[] };
type SpaceTheme = SpaceThemePalette & { colorMode?: SpaceThemeColorMode; appearance?: SpaceThemeAppearance; lightTheme?: SpaceThemePalette; darkTheme?: SpaceThemePalette; renderVersion?: number };
type LaunchMaterialSnapshot = { activeSpaceId: string; theme: SpaceTheme; dark: boolean };
type SpaceDraft = { name: string; iconKind: SpaceIconKind; iconValue: string; theme: SpaceTheme };
type SpaceIconKind = 'dot' | 'emoji' | 'icon';
type Space = { id: string; name: string; iconKind: SpaceIconKind; iconValue: string; theme: SpaceTheme; createdAt: string; updatedAt: string; archivedAt?: string | null; lastOpenedAt?: string | null };
type Workspace = { id: string; spaceId?: string | null; name: string; rootPath: string; vaultId: string | null; primaryVaultId?: string | null; sharedVaultIds?: string[]; writableVaultIds?: string[]; environment: 'local'; activeThreadId: string | null; createdAt: string; updatedAt: string; archivedAt?: string | null; pinnedAt?: string | null; activeThread?: ThreadSummary | null; threads?: ThreadSummary[] };
type PinnedNav = Record<string, boolean>;
type RailConfirm = { kind: 'thread' | 'workspace'; id: string; title: string } | null;
type RenameDialogTarget = { kind: 'thread' | 'workspace'; id: string; title: string } | null;
type RailContextMenuSource = { kind: 'thread'; thread: ThreadSummary } | { kind: 'workspace'; workspace: Workspace } | { kind: 'space'; space: Space };
type RailContextMenuRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type RailContextMenuTarget = RailContextMenuSource & { x: number; y: number; anchorRect?: RailContextMenuRect; sidebarRect?: RailContextMenuRect };
type AppLaunchPhase = LaunchPhase | 'done';
type WorkbenchUiSettings = {
  defaultProfile?: string;
  defaultModel?: string;
  defaultAgentId?: string;
  fallbackDecisionAgentId?: string;
  newChatPrompt?: string;
  sendKey?: 'enter' | 'mod-enter';
  density?: 'comfortable' | 'compact';
  appearance?: AppAppearance;
  streamingResponses?: boolean;
  showReasoning?: boolean;
  richToolDescriptions?: boolean;
  defaultPermissionMode?: PermissionMode;
  contextTriggerTokens?: number;
  groupChatTriggerTokens?: number;
  historyTailMessages?: number;
  agentMentionMaxDepth?: number | 'unlimited';
  libraryCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  macSidebarWidth?: number;
  macSidebarWidthVersion?: number;
  contextWidth?: number;
  activeSpaceId?: string;
  collapsedWorkspaceIds?: string[];
  pinnedNav?: PinnedNav;
  telemetryEnabled?: boolean;
  telemetryNoticeSeenAt?: string;
};
type TelemetryStatus = { enabled: boolean; configured: boolean; queueSize: number; lastSentAt: string | null };
type HermesProviderSummary = { providerKey: string; providerName: string; baseUrl: string; model: string; hasApiKey: boolean; apiKeyState: 'stored' | 'missing' | string };
type HermesProfile = { name: string; path?: string; displayName?: string; model: string; provider: string; contextLimit?: number | null; hasConfig: boolean; hasEnv: boolean; hasAuth: boolean; soulExcerpt?: string; userExcerpt?: string; memoryExcerpt?: string; providers?: HermesProviderSummary[]; skills?: ProfileModuleEntry[]; plugins?: ProfileModuleEntry[]; avatarUrl?: string };
type HermesLocalStatus = {
  studio: { url: string; online: boolean; authMode: string; apiAuthorized: boolean; apiStatus: number; health?: { status?: string; webui_version?: string; gateway?: string; agent_bridge?: { status?: string } } | null };
  profiles: HermesProfile[];
  database: { exists: boolean; rooms: { id: string; name: string; totalTokens: number }[]; sessions: { profile: string; model: string; provider: string; title: string; messageCount: number }[] };
  checkedAt: string;
};
type HermesApiAvailability = 'unknown' | 'online' | 'offline';
type HermesBootstrapStatus = {
  status: 'connected' | 'installed' | 'missing';
  installed: boolean;
  installPath: string;
  sourcePath: string;
  sourceExists: boolean;
  rootConfigExists: boolean;
  api: { online: boolean; apiBaseUrl: string; apiStatus: number; models: string[]; authMode: string };
  profiles: HermesProfile[];
  approval: { profileName: string; configPath: string; mode: PermissionMode; raw?: Record<string, unknown> };
  checkedAt: string;
  nextAction: 'install' | 'start' | 'import';
};
type HermesRuntimeStatus = {
  bridge: { endpoint: string; running: boolean; ready: boolean; status: string; error?: string };
  profiles: HermesProfile[];
  gateways: Array<{ profileName: string; running: boolean; status: string; error?: string }>;
  hermesHome: string;
  frakioWorkHome?: string;
  agentRoot?: string;
  runtime?: HermesRuntimeInfo | null;
  manager?: HermesRuntimeManager | null;
  tools?: Record<string, { command: string; path: string; available: boolean }>;
  lastError?: string;
  autoStart?: {
    status: 'idle' | 'starting' | 'ready' | 'partial' | 'failed';
    startedAt: string | null;
    finishedAt: string | null;
    steps: Array<{ id: string; label: string; status: 'running' | 'ready' | 'failed' | 'warning' | 'skipped'; severity: 'core' | 'standard' | 'optional'; detail?: string; updatedAt?: string }>;
    logs?: string[];
    error?: string;
    warnings?: string[];
  };
  checkedAt: string;
};
type HermesRuntimeInfo = {
  source: 'bundled' | 'managed' | 'override' | string;
  runtimeDir: string;
  pythonRoot: string;
  python: string;
  node?: string;
  version?: string;
  platform?: string;
  bridgeProtocolVersion?: number;
  installedAt?: string;
  active?: boolean;
  verified?: boolean;
  compatible?: boolean;
  manifest?: { sourceTag?: string; sourceCommit?: string; builtAt?: string; hermesAgentVersion?: string } | null;
};
type HermesRuntimeManager = {
  activeRuntime: HermesRuntimeInfo | null;
  bundledRuntime: HermesRuntimeInfo | null;
  managedRuntimes: HermesRuntimeInfo[];
  officialLatest?: { tag?: string; version?: string; releaseDate?: string; label?: string; url?: string; commit?: string } | null;
  registryPath: string;
  managedRoot: string;
  sourcePath: string;
  activeVersion: string;
  previousVersion: string;
  bridgeProtocolVersion: number;
  fallbackReason?: string;
};
type HermesOfficialRelease = {
  tag: string;
  version?: string;
  releaseDate?: string;
  label?: string;
  url?: string;
  commit?: string;
};
type HermesRuntimeDiagnostics = {
  checkedAt: string;
  workbenchApi: { online: boolean; url: string; pid: number; port: number; version?: string; buildTime?: string; buildFingerprint?: string; packaged?: boolean };
  frakioWorkHome?: { path: string; exists: boolean; apiHome?: string; runtimeHome?: string };
  hermesHome: { path: string; exists: boolean; configExists: boolean; profileCount: number; profileNames: string[] };
  agentRoot: { path: string; exists: boolean };
  runtime?: HermesRuntimeStatus['runtime'];
  bridgeScript: { path: string; exists: boolean };
  python: { path: string; exists: boolean };
  tools?: HermesRuntimeStatus['tools'];
  bridge: HermesRuntimeStatus['bridge'];
  runtimeApi: HermesBootstrapStatus['api'];
  profileGateways: HermesRuntimeStatus['gateways'];
  autoStart?: HermesRuntimeStatus['autoStart'];
};
type UpdateModuleStatus = {
  path: string;
  packageVersion?: string;
  isGitRepo: boolean;
  installKind?: 'managed' | 'external' | 'unknown' | 'desktop-release' | 'source';
  currentCommit: string;
  currentBranch: string;
  currentTagDescription?: string;
  displayVersion?: string;
  version?: string;
  releaseDate?: string;
  latestVersion?: string;
  latestReleaseTag?: string;
  latestReleaseUrl?: string;
  remoteUrl: string;
  upstreamCommit: string;
  dirtyFiles: string[];
  dirtyKind?: 'none' | 'install-artifact' | 'source-or-files';
  updateAvailable: boolean;
  canFastForward: boolean;
  blockedReason: string;
  release?: AppUpdateStatus;
};
type HermesBackup = {
  id: string;
  createdAt: string;
  reason: string;
  status: string;
  path: string;
  size?: number;
  before?: { commit?: string; branch?: string; tagDescription?: string; version?: string; releaseDate?: string; displayVersion?: string };
  after?: { commit?: string; branch?: string; tagDescription?: string; version?: string; releaseDate?: string; displayVersion?: string } | null;
  dirtyFiles?: string[];
  patchSaved?: boolean;
  untrackedFiles?: string[];
  configFiles?: string[];
};
type UpdatesStatus = {
  checkedAt: string;
  hermesAgent: UpdateModuleStatus;
  frakioWork: UpdateModuleStatus;
  backups?: HermesBackup[];
  backupRoot?: string;
};
type UpdateActionResult = {
  ok?: boolean;
  target?: 'all' | 'hermes-agent' | 'frakio-work';
  phase?: string;
  logs?: string[];
  status?: UpdatesStatus | null;
  error?: string;
  restartRequired?: boolean;
  backup?: HermesBackup;
  currentBackup?: HermesBackup;
  restoredConfig?: string[];
  deleted?: string | string[];
  bootstrap?: HermesBootstrapStatus;
  runtime?: HermesRuntimeStatus;
};
type UpdateBusy = 'check' | 'runtime-check' | 'runtime-install' | 'runtime-bundled' | 'hermes-agent' | 'frakio-work' | 'backup' | `runtime-activate:${string}` | `runtime-delete:${string}` | `rollback:${string}` | `delete:${string}` | `cleanup:${string}` | '';
type RollbackScopes = { profiles?: boolean; mcp?: boolean; channels?: boolean; models?: boolean };
type HermesConfig = {
  display?: Record<string, any>;
  agent?: Record<string, any>;
  memory?: Record<string, any>;
  skills?: Record<string, any>;
  compression?: Record<string, any>;
  session_reset?: Record<string, any>;
  approvals?: Record<string, any>;
  proxy?: Record<string, any>;
  gatewayAutoStart?: Record<string, any>;
  platforms?: Record<string, Record<string, any>>;
  [key: string]: any;
};
type HermesJob = {
  id: string;
  job_id: string;
  name: string;
  prompt: string;
  prompt_preview?: string;
  schedule_display: string;
  enabled: boolean;
  state: string;
  deliver: string;
  skills: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
};
type UserProfileAgentUsage = { id: string; name: string; role?: string; color?: string; avatarUrl?: string; profileName?: string; conversationCount: number; messageCount: number; lastUsedAt?: string | null };
type UserProfileModuleUsage = { name: string; category?: string; profiles?: number; enabledProfiles?: number; useCount: number; viewCount: number; patchCount: number; lastUsedAt?: string | null };
type UserProfileSummary = {
  checkedAt: string;
  userProfile?: UserProfile;
  stats: { totalTokens: number; peakDayTokens: number; peakDay: string; requests: number; conversations: number; activeAgents: number };
  usage: { byDay: UsageDay[]; entries: UsageEntry[] };
  agents: UserProfileAgentUsage[];
  modules: {
    skills: { byName: UserProfileModuleUsage[] };
    plugins: { byName: UserProfileModuleUsage[] };
  };
};
type McpServer = {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth?: string;
  enabled: boolean;
  status: string;
  statusLabel: string;
  tools: string[];
  toolCount: number;
  availableToolCount?: number;
  timeout?: number | null;
  connectTimeout?: number | null;
  filter?: Record<string, any>;
  error?: string;
};
type McpServersPayload = {
  profile: string;
  configPath: string;
  servers: McpServer[];
  stats: { total: number; connected: number; disconnected: number; tools: number };
  runtime?: { bridgeReady?: boolean; lastError?: string };
};
type McpFormState = {
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  auth: string;
  enabled: boolean;
};
type KanbanTaskStatus = 'triage' | 'todo' | 'scheduled' | 'ready' | 'running' | 'blocked' | 'review' | 'done' | 'archived';
type KanbanTask = {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: KanbanTaskStatus;
  priority?: number;
  created_at?: number;
  tenant?: string | null;
  result?: string | null;
  skills?: string[] | null;
};
type KanbanBoard = {
  slug: string;
  name: string;
  icon?: string;
  total?: number;
  counts?: Record<string, number>;
  archived?: boolean;
};
type MonitoringLog = { source: string; file?: string; level: 'info' | 'warn' | 'error' | string; message: string };
type ModelUsageRow = { key: string; provider: string; modelId: string; modelName: string; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; realTotalTokens: number; totalCost: number; pricing?: ModelPricing & { source?: string }; pricingSource?: string; estimatedRequests: number; lastUsedAt?: string | null; dataSources?: Record<string, number> };
type UsageEntry = { id?: string; createdAt?: string; provider: string; modelId: string; modelName: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; realTotalTokens: number; totalCost: number; pricing?: ModelPricing & { source?: string }; pricingSource?: string; estimated?: boolean; dataSource?: string; threadTitle?: string; agentNames?: string[]; profileName?: string };
type UsageDay = { day: string; requests: number; totalTokens: number; realTotalTokens: number; totalCost: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
type UsageSource = { source: string; requests: number; totalTokens: number; realTotalTokens: number; totalCost: number };
type UsageProfile = { profileName: string; requests: number; totalTokens: number; realTotalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number };
type UsageRangeMode = 'today' | '7' | '15' | '30' | '90' | '180' | '365';
type AnalysisTab = 'cost' | 'trend' | 'requests' | 'ranking';
type UsageTrendPoint = { key: string; label: string; requests: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; realTotalTokens: number; cost: number };
type ModelMetricRow = { key: string; provider: string; modelName: string; requests: number; realTotalTokens: number; totalCost: number; share: number; color: string };
type DonutMetricRow = { key: string; modelName: string; requests: number; realTotalTokens: number; totalCost: number; share: number; displayShare: number; color: string };
type ModuleUsageRow = { name: string; category?: string; profiles?: number; enabledProfiles?: number; useCount: number; viewCount: number; patchCount: number; lastUsedAt?: string | null };
type ModelRunDiagnostic = { id: string; runId?: string; createdAt: string; updatedAt?: string; completedAt?: string; agentName?: string; profileName?: string; provider: string; providerKey?: string; model: string; transport: string; requestedReasoning: string; effectiveReasoning: string; requestedServiceTier: string; effectiveServiceTier: string; mappedParameters?: Record<string, unknown>; status: 'starting' | 'sent' | 'completed' | 'failed' | 'cancelled'; evidenceStatus: 'pending' | 'confirmed' | 'unconfirmed' | 'not_applicable'; reasoningTokens?: number; confirmedServiceTier?: string; durationMs?: number; error?: string };
type MonitoringSummary = {
  checkedAt: string;
  logs: MonitoringLog[];
  modelRuns: ModelRunDiagnostic[];
  usage: { totalRequests: number; totalTokens: number; realTotalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number; cacheHitRate: number; estimatedRequests: number; byModel: ModelUsageRow[]; byDay: UsageDay[]; bySource: UsageSource[]; byProfile?: UsageProfile[]; entries?: UsageEntry[]; recent: Array<ModelUsageRow & { createdAt?: string; agentNames?: string[]; threadTitle?: string }> };
  hermesStudio?: { databaseExists: boolean; roomCount: number; sessionCount: number; usageRowCount?: number; usageSource?: string };
  hermesAgent?: { databaseCount: number; usageRowCount: number; usageSource: string; profiles: Array<{ profileName: string; dbPath: string; sessionCount: number }> };
  modules: { skills: { total: number; enabled: number; byName: ModuleUsageRow[] }; plugins: { total: number; enabled: number; byName: ModuleUsageRow[] } };
};
type ProfileEditableKind = 'notes' | 'user' | 'soul';
type ProfileInspectorTarget = {
  agentId: string;
  agentName: string;
  profileName: string;
  kind: ProfileEditableKind;
  title: string;
};
type ProfileInspectorState = {
  target: ProfileInspectorTarget | null;
  draft: string;
  original: string;
  loading: boolean;
  saving: boolean;
  error: string;
  errorStage: '' | 'load' | 'save';
  saved: boolean;
};
type ProfileEditorControls = {
  state: ProfileInspectorState;
  dirty: boolean;
  open: (target: ProfileInspectorTarget) => Promise<void>;
  changeDraft: (draft: string) => void;
  save: () => Promise<void>;
  close: () => boolean;
  discard: () => boolean;
};

const workspaceId = 'workspace_default';
const defaultProjectParentPath = '';
const defaultSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
const defaultMacSidebarWidth = DEFAULT_MAC_SIDEBAR_WIDTH;
const defaultContextWidth = 344;
// These are viewport breakpoints, not a sum of pane widths. The old summed
// value put visually roomy desktop windows into the compact-layout path.
const autoCollapseSidebarWidth = 980;
const autoCollapseSidebarWithRightRailWidth = 1220;
const sidebarWidthBounds = SIDEBAR_WIDTH_BOUNDS;
const macSidebarWidthBounds = MAC_SIDEBAR_WIDTH_BOUNDS;
const contextWidthBounds = { min: 280, max: 520 };
const macConversationMinMainWidth = 520;
const macConversationChromeWidth = 72;
const threadFollowThreshold = 96;
const launchUserAvatarSnapshotKey = 'frakio-work.launchUserAvatarSnapshot';
const launchMaterialSnapshotKey = 'frakio-work.launchMaterialSnapshot';
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
  { id: 'kanban', label: '看板', icon: Boxes, placement: 'rail' },
  { id: 'jobs', label: '定时任务', icon: Clock3, placement: 'settings' },
  { id: 'monitoring', label: '监控', icon: Activity, placement: 'settings' },
  { id: 'models', label: '模型配置', icon: Bot, placement: 'settings' },
  { id: 'org', label: 'Agent 配置', icon: Network, placement: 'hidden' },
  { id: 'settings', label: '设置', icon: Settings, placement: 'system' },
];
const railNavItems = navItems.filter((item) => item.placement === 'rail');
const managementNavIds = new Set(['settings', 'org', 'models', 'channels', 'plugins', 'kanban', 'jobs', 'monitoring']);
const defaultProductSpaceTheme: SpaceThemePalette = {
  accentColor: '#dce8e3',
  sidebarBg: '#f3f7f5',
  opacity: 0.5,
  noise: 0.01,
  texture: 0.03,
  mode: 'soft',
  gradientColors: [{ id: 'primary', color: '#dce8e3', x: 0.5, y: 0.5, isPrimary: true }],
};
const zenPresetPositions = [[240, 240], [233, 157], [236, 111], [234, 173], [220, 187], [225, 237], [147, 195], [81, 84]] as const;
const zenPoint = ([x, y]: readonly [number, number]) => ({ x: x / 360, y: y / 360 });
const zenPresetPage = (page: number, prefix: string, palettes: string[][], harmony: ThemeHarmony): ThemePreset[] => palettes.map((colors, index) => ({
  id: `zen-${prefix}-${index + 1}`,
  page,
  colors,
  point: zenPoint(zenPresetPositions[index]),
  harmony,
}));
const themePresets: ThemePreset[] = [
  ...zenPresetPage(0, 'light-solid', [
    ['#f4efdf'], ['#f0b8cd'], ['#e9c3e3'], ['#da7682'], ['#eb8570'], ['#dcce7f'], ['#5becad'], ['#919bb5'],
  ], 'floating'),
  ...zenPresetPage(1, 'light-gradient', [
    ['#f5edd6', '#ddf3d8', '#f3d8e1'], ['#f3bede', '#f7deba', '#dfc3ee'], ['#e5b3e4', '#ecacb2', '#c5b9df'], ['#eb7a9f', '#efef76', '#d285e0'],
    ['#f2737b', '#aff273', '#e67de8'], ['#ddcd55', '#61d45e', '#d75b7c'], ['#4be7d2', '#54afde', '#3ef470'], ['#7a849e', '#8975a4', '#74a2a4'],
  ], 'analogous'),
  ...zenPresetPage(2, 'dark-solid', [
    ['#5d566a'], ['#997096'], ['#956066'], ['#9c6645'], ['#517b6c'], ['#576e75'], ['#836d5f'], ['#447464'],
  ], 'floating'),
  ...zenPresetPage(3, 'dark-gradient', [
    ['#171122', '#250e23', '#121621'], ['#804c7c', '#8d3f42', '#615874'], ['#7a3840', '#7e7934', '#6f446e'], ['#834116', '#408019', '#7a1f5b'],
    ['#2d6c55', '#345565', '#347623'], ['#2d4a53', '#2e3251', '#265a41'], ['#402f26', '#374026', '#3b2b34'], ['#16503d', '#1a3c4c', '#1b570f'],
  ], 'analogous'),
  ...[28, 33, 64, 97, 128, 161, 191, 224, 255].map((value, index): ThemePreset => ({
    id: `zen-grayscale-${index + 1}`,
    page: 4,
    colors: [`#${value.toString(16).padStart(2, '0').repeat(3)}`],
    point: { x: [340, 337.5, 315, 292.5, 270, 247.5, 225, 202.5, 180][index] / 360, y: 0.5 },
    harmony: 'floating',
    type: 'grayscale',
  })),
];
const themePresetPages = Array.from({ length: 5 }, (_, page) => themePresets.filter((preset) => preset.page === page));
const spaceEmojiOptions = ['✨', '💼', '🧠', '🚀', '🌿', '🎨', '📚', '🧩', '🛠️', '🪐', '🔥', '💎'];
const spaceIconOptions = ['folder', 'briefcase', 'sparkles', 'library'];
const spaceIconLabels: Record<string, string> = {
  folder: 'Folder',
  briefcase: 'Briefcase',
  sparkles: 'Sparkles',
  library: 'Library',
};

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
  const [newChatExecutionMode, setNewChatExecutionMode] = useState<'chat' | 'work'>('chat');
  const [newChatPlanEnabled, setNewChatPlanEnabled] = useState(false);
  const [planAction, setPlanAction] = useState('');
  const [planFeedbackDraft, setPlanFeedbackDraft] = useState('');
  const [planFeedbackOpen, setPlanFeedbackOpen] = useState(false);
  const [planActionError, setPlanActionError] = useState('');
  const [selectedNewChatWorkspaceId, setSelectedNewChatWorkspaceId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDragDepthRef = useRef(0);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
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
  const [activeOverviewRoundId, setActiveOverviewRoundId] = useState('');
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentModelEditorId, setAgentModelEditorId] = useState<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectModalPurpose, setProjectModalPurpose] = useState<'create' | 'convert'>('create');
  const [projectMode, setProjectMode] = useState<'create' | 'existing'>('create');
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('workbench');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [rightRailTab, setRightRailTab] = useState<'collaboration' | 'resources'>('resources');
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
  const [vaultBusy, setVaultBusy] = useState<Record<string, 'index' | 'delete'>>({});
  const [modelError, setModelError] = useState('');
  const [runUiByThreadId, setRunUiByThreadId] = useState<Record<string, RunUiState>>({});
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
  const activeHermesRun = activeRunUi?.activeRun || null;
  const runDraft = activeRunUi?.draft || '';
  const runActivityGroups = activeRunUi?.activityGroups || [];
  const runPresentationPhase = activeRunUi?.presentationPhase || 'thinking';
  const runApproval = activeRunUi?.approval || null;
  const approvalSubmitting = Boolean(activeRunUi?.approvalSubmitting);
  const approvalError = activeRunUi?.approvalError || '';
  const runClarification = activeRunUi?.clarification || null;
  const clarificationSubmitting = Boolean(activeRunUi?.clarificationSubmitting);
  const clarificationError = activeRunUi?.clarificationError || '';
  const runError = activeRunUi?.error || '';
  const runStopping = Boolean(activeRunUi?.stopping);

  function updateRunUi(threadId: string, update: Partial<RunUiState> | ((current: RunUiState) => RunUiState)) {
    if (!threadId) return;
    setRunUiByThreadId((current) => {
      const previous = current[threadId] || createRunUiState();
      const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
      return { ...current, [threadId]: next };
    });
  }

  function resetRunUi(threadId: string, overrides: Partial<RunUiState> = {}) {
    updateRunUi(threadId, createRunUiState(overrides));
  }

  useEffect(() => {
    const threadId = activeThread?.id;
    if (!threadId) return undefined;
    const refresh = (event: Event) => {
      const requestedThreadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (requestedThreadId && requestedThreadId !== threadId) return;
      void requestJson<{ thread: Thread }>(`/api/threads/${threadId}`).then((data) => setActiveThread(data.thread)).catch(() => {});
    };
    window.addEventListener('frakio:thread-refresh-request', refresh);
    return () => window.removeEventListener('frakio:thread-refresh-request', refresh);
  }, [activeThread?.id]);

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
    if (activeView !== 'thread' || !activeThread?.id || activeThread.collaborationMode !== 'plan') return undefined;
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
          collaborationMode: data.collaborationMode === 'plan' ? 'plan' : 'default',
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
  const activeComposerRuntimeId = (activeThread?.agentRuntimeOverrides?.[activeComposerAgent?.id || ''] || activeComposerAgent?.runtimePolicy?.defaultRuntimeId || 'hermes') as RuntimeId;
  const newChatRuntimeId = (newChatRuntimeOverride || newChatAgent?.runtimePolicy?.defaultRuntimeId || 'hermes') as RuntimeId;
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
  const visiblePinnedNav = railNavItems.filter((item) => pinnedNav[item.id] !== false);
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) || spaces[0] || null;
  const visibleWorkspaces = workspaces.filter((workspace) => (workspace.spaceId || activeSpaceId) === activeSpaceId);
  const visibleConversations = conversations.filter((thread) => (thread.spaceId || activeSpaceId) === activeSpaceId);
  const activeWorkspace = activeThread?.workspaceId ? workspaces.find((workspace) => workspace.id === activeThread.workspaceId) || null : null;
  const activePlan = activeThread?.planSessions?.find((plan) => plan.id === activeThread.activePlanId) || null;
  const pendingPlanQuestion = activePlan?.questions?.find((batch) => batch.status === 'pending') || null;
  const visibleMessages = (activeThread?.messages || []).filter(isVisibleChatMessage);
  const overviewRounds = buildThreadOverviewRounds(visibleMessages);
  const profileInspectorDirty = Boolean(profileInspector.target && profileInspector.draft !== profileInspector.original);
  const spaceEditorReplacesPage = spaceCreateOpen && !isMacDesktop;
  const macSpaceEditorOpen = spaceCreateOpen && isMacDesktop;
  const resourceRailAvailable = !spaceEditorReplacesPage && activeView !== 'new-chat' && !isManagementSection && Boolean(activeThread);
  const rightRailKind: 'resources' | null = resourceRailAvailable ? 'resources' : null;
  const rightRailOpen = Boolean(rightRailKind && !libraryCollapsed);
  const isMacConversationShell = !isSettingsNav && (activeView === 'new-chat' || (!isManagementSection && Boolean(activeThread)));
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
  const autoCollapseWidth = rightRailOpen ? autoCollapseSidebarWithRightRailWidth : autoCollapseSidebarWidth;
  const autoSidebarCollapsed = isDesktopShell && !isSettingsNav && viewportWidth < autoCollapseWidth;
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
    chromeWidth: macConversationChromeWidth,
    minWidth: activeSidebarWidthBounds.min,
    maxWidth: activeSidebarWidthBounds.max,
  });
  const macContextResizeMax = availablePaneMax({
    side: 'right',
    viewportWidth,
    sidebarWidth,
    contextWidth,
    leftVisible: !effectiveSidebarCollapsed,
    rightVisible: rightRailOpen,
    minMainWidth: macConversationMinMainWidth,
    chromeWidth: macConversationChromeWidth,
    minWidth: contextWidthBounds.min,
    maxWidth: contextWidthBounds.max,
  });

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
    setRightRailTab((activeThread?.executionMode || 'chat') === 'work' ? 'collaboration' : 'resources');
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
    '--context-width': `${contextWidth}px`,
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
      safeJson<{ vaults: Vault[]; defaultVaultId?: string | null }>('/api/vaults'),
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
      contextWidth: normalizePaneWidth(stateData?.ui?.contextWidth || defaultContextWidth, contextWidthBounds.min, contextWidthBounds.max),
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
    setContextWidth(normalizePaneWidth(stateData?.ui?.contextWidth || defaultContextWidth, contextWidthBounds.min, contextWidthBounds.max));
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

  async function loadThreads(targetWorkspaceId = workspaceId, preferredThreadId?: string | null) {
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/threads`).then((res) => res.json());
    setThreads(data.threads);
    const targetId = preferredThreadId || data.threads[0]?.id;
    if (targetId) await openThread(targetId);
  }

  async function openThread(threadId: string) {
    const data = await fetch(`/api/threads/${threadId}`).then((res) => res.json());
    setInput('');
    setThreadFollowState(true);
    setActiveThread(data.thread);
    setActiveView('thread');
    scheduleThreadScrollToLatest();
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

  function toggleRightRailTab(tab: 'collaboration' | 'resources') {
    if (!rightRailKind) return;
    if (rightRailOpen && rightRailTab === tab) {
      void persistUi({ libraryCollapsed: true });
      return;
    }
    setRightRailTab(tab);
    if (!rightRailOpen) void persistUi({ libraryCollapsed: false });
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
    setProjectParentPath(defaultProjectParentPath);
    setProjectError('');
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
    const payload = projectMode === 'existing'
      ? { mode: projectMode, rootPath: projectRootPath.trim(), spaceId: activeSpaceId }
      : { mode: projectMode, name: projectName.trim(), parentPath: projectParentPath.trim() || undefined, spaceId: activeSpaceId };
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
    const payload = { mode: 'existing', name: projectNameFromPath(folderPath), rootPath: folderPath, spaceId: activeSpaceId };
    if (projectModalPurpose === 'convert') await submitConvertToProject(payload);
    else await submitWorkspaceProject({ mode: 'existing', rootPath: folderPath, spaceId: activeSpaceId });
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
    const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
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

  async function convertActiveConversationToProject() {
    if (!activeThread || activeThread.mode !== 'direct') return;
    const fallbackName = activeThread.title && activeThread.title !== '新的对话' ? activeThread.title : '新的项目';
    const payload = projectMode === 'existing'
      ? { mode: projectMode, name: projectName.trim() || projectNameFromPath(projectRootPath.trim()) || fallbackName, rootPath: projectRootPath.trim(), spaceId: activeSpaceId }
      : { mode: projectMode, name: projectName.trim() || fallbackName, parentPath: projectParentPath.trim() || undefined, spaceId: activeSpaceId };
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
    options: { suppressUserMessage?: boolean; planExecutionId?: string } = {},
  ): Promise<Thread | null> {
    resetRunUi(threadId, { isRunning: true, startedAt, target });
    const userDraftMessage: ChatEvent = { id: `local-user-${startedAt}`, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text, attachments: runAttachments };
    let completedThread: Thread | null = null;
    let planDraftRun = false;
    const appendMissingRunMessages = (thread: Thread, runId: string, assistantDraft = '') => {
      let nextMessages = [...thread.messages];
      const attachmentIds = runAttachments.map((attachment) => attachment.id).sort().join(',');
      const hasUserMessage = nextMessages.some((message) => (
        message.agentId === 'user'
        && message.content.trim() === text.trim()
        && (message.attachments || []).map((attachment) => attachment.id).sort().join(',') === attachmentIds
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
        selectedAgents: selectedAgentsForRun,
        targetAgentId: target?.kind === 'agent' ? target.agent.id : '',
        turnId: `turn-${startedAt}`,
        ...(options.suppressUserMessage ? { suppressUserMessage: true } : {}),
        ...(options.planExecutionId ? { planExecutionId: options.planExecutionId } : {}),
      }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      throw new Error(formatHermesRuntimeError(created.error || 'Hermes Bridge run 创建失败。', target?.agent ? resolveHermesProfileNameForAgent(target.agent, localProfilesForComposer) : activeComposerProfileName, created.details));
    }
    planDraftRun = created.kind === 'plan-drafting';
    onAccepted?.();
    if (created.kind === 'steer') {
      completedThread = created.thread as Thread;
      if (completedThread) setActiveThread(completedThread);
      updateRunUi(threadId, { draft: '', isRunning: false, activeRun: null });
      return completedThread;
    }
    const run = { runId: created.runId, sessionId: created.sessionId, threadId };
    updateRunUi(threadId, { activeRun: run });
    await new Promise<void>((resolve, reject) => {
      const events = new EventSource(`/api/threads/${threadId}/turns/${created.turnId || `turn-${startedAt}`}/events`);
      let settled = false;
      let terminalReceived = false;
      let finalizationTimer: number | null = null;
      let handoffTimer: number | null = null;
      let streamedDraft = '';
      let activeStreamRunId = run.runId;
      let pendingHandoff: Thread | null = null;
      const bufferedTurnEvents: any[] = [];
      let drainingBufferedTurnEvents = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (finalizationTimer !== null) window.clearTimeout(finalizationTimer);
        if (handoffTimer !== null) window.clearTimeout(handoffTimer);
        finalizationTimer = null;
        handoffTimer = null;
        events.close();
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
        // EventSource reconnects with Last-Event-ID. The API owns the run, so a
        // temporary browser or network disconnect must not cancel the Turn.
      };
      const processTurnEvent = (data: any) => {
        if (terminalReceived) return;
        if (data.event === 'run.started') {
          activeStreamRunId = String(data.runId || activeStreamRunId);
          streamedDraft = '';
          const routedAgent = agents.find((agent) => agent.id === data.agentId);
          updateRunUi(threadId, {
            activeRun: {
              runId: activeStreamRunId,
              sessionId: String(data.sessionId || ''),
              threadId,
            },
            target: routedAgent ? { kind: 'agent', agent: routedAgent } : null,
            draft: '',
            activityGroups: [],
            hideStatus: false,
            presentationPhase: 'thinking',
          });
          return;
        }
        if (data.event === 'message.delta') {
          const delta = String(data.delta || '');
          if (data.runId && data.runId !== activeStreamRunId) {
            activeStreamRunId = String(data.runId);
            streamedDraft = '';
            updateRunUi(threadId, { draft: '', activityGroups: [], hideStatus: false });
          }
          streamedDraft += delta;
          updateRunUi(threadId, (current) => ({
            ...current,
            draft: current.draft + delta,
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event, { delta }),
          }));
          return;
        }
        if (data.event === 'tool.running') {
          updateRunUi(threadId, (current) => ({
            ...current,
            activityGroups: mergeRunActivityEvent(current.activityGroups, data),
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          return;
        }
        if (data.event === 'tool.completed') {
          updateRunUi(threadId, (current) => ({
            ...current,
            activityGroups: mergeRunActivityEvent(current.activityGroups, data),
            presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event),
          }));
          return;
        }
        if (data.event === 'approval.request') {
          updateRunUi(threadId, {
            presentationPhase: 'waiting-input',
            clarification: null,
            clarificationError: '',
            clarificationSubmitting: false,
            approval: {
              id: data.approvalId || data.approval_id || '',
              title: data.title || '需要确认',
              command: data.command || '',
              cwd: data.cwd || '',
              tool: data.tool || '',
              choices: Array.isArray(data.choices)
                ? data.choices.filter((choice: unknown): choice is HermesApprovalChoice => ['once', 'session', 'always', 'deny'].includes(String(choice)))
                : undefined,
              allowPermanent: typeof data.allowPermanent === 'boolean' ? data.allowPermanent : undefined,
              smartDenied: Boolean(data.smartDenied),
            },
            approvalError: '',
            approvalSubmitting: false,
          });
          return;
        }
        if (data.event === 'clarify.request') {
          updateRunUi(threadId, {
            presentationPhase: 'waiting-input',
            approval: null,
            approvalError: '',
            approvalSubmitting: false,
            clarification: {
            id: data.clarifyId || data.clarify_id || '',
            question: data.question || '需要你补充一个选择',
            choices: Array.isArray(data.choices) ? data.choices.map((choice: unknown) => String(choice)).filter(Boolean) : [],
            timeoutMs: Number(data.timeoutMs || data.timeout_ms || 0) || undefined,
            },
            clarificationError: '',
            clarificationSubmitting: false,
          });
          return;
        }
        if (data.event === 'clarify.responded') {
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
          updateRunUi(threadId, (current) => ({ ...current, activityGroups: current.activityGroups.map((group) => ({
            ...group,
            status: group.status === 'running' ? 'completed' : group.status,
            items: group.items.map((item) => item.status === 'running' ? { ...item, status: 'completed' } : item),
          })), presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event) }));
          if (data.thread) {
            const threadFromServer = data.thread as Thread;
            const completedRunId = String(data.runId || activeStreamRunId);
            const hasAssistantResult = threadFromServer.messages.some((message) => (
              message.agentId !== 'user'
              && message.agentId !== 'system'
              && (message.externalRunId === completedRunId || message.content.trim() === String(data.output || '').trim())
              && message.content.trim()
            ));
            const nextThread = appendMissingRunMessages(threadFromServer, completedRunId, hasAssistantResult ? '' : streamedDraft);
            completedThread = nextThread;
            scheduleHandoff(nextThread);
          }
          return;
        }
        if (data.event === 'turn.completed') {
          const finalThread = (data.thread as Thread | undefined) || completedThread;
          if (finalThread) completedThread = finalThread;
          finishAfterReveal(() => {
            if (finalThread) setActiveThread((current) => current?.id === finalThread.id ? finalThread : current);
            updateRunUi(threadId, {
              draft: '',
              isRunning: false,
              startedAt: null,
              target: null,
              stopping: false,
              activeRun: null,
            });
          });
          return;
        }
        if (data.event === 'run.failed' || data.event === 'run.cancelled') {
          const formatted = formatHermesRuntimeError(data.error || (data.event === 'run.cancelled' ? '已停止。' : '运行失败。'), activeComposerProfileName, data.details);
          updateRunUi(threadId, (current) => ({ ...current, activityGroups: current.activityGroups.map((group) => ({
            ...group,
            status: group.status === 'running' ? (data.event === 'run.failed' ? 'failed' : 'cancelled') : group.status,
            items: group.items.map((item) => item.status === 'running' ? { ...item, status: data.event === 'run.failed' ? 'failed' : 'cancelled' } : item),
          })), presentationPhase: nextRunPresentationPhase(current.presentationPhase, data.event), error: data.event === 'run.failed' ? formatted : '' }));
          if (data.thread) {
            const nextThread = appendMissingRunMessages(data.thread as Thread, String(data.runId || activeStreamRunId), streamedDraft);
            completedThread = nextThread;
            scheduleHandoff(nextThread);
          }
          return;
        }
        if (data.event === 'mention.failed') {
          if (data.thread) {
            const nextThread = data.thread as Thread;
            completedThread = nextThread;
            setActiveThread((current) => current?.id === nextThread.id ? nextThread : current);
          }
          return;
        }
      };
      const handoffDelay = () => {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return uiSettings.streamingResponses !== false && !reducedMotion && streamedDraft.trim()
          ? STREAM_REVEAL_MAX_LAG_MS
          : 0;
      };
      const flushBufferedTurnEvents = () => {
        if (pendingHandoff || drainingBufferedTurnEvents) return;
        drainingBufferedTurnEvents = true;
        while (bufferedTurnEvents.length && !pendingHandoff && !terminalReceived) {
          processTurnEvent(bufferedTurnEvents.shift());
        }
        drainingBufferedTurnEvents = false;
      };
      const publishHandoff = () => {
        const nextThread = pendingHandoff;
        pendingHandoff = null;
        handoffTimer = null;
        if (!nextThread) return;
        setActiveThread((current) => current?.id === nextThread.id ? nextThread : current);
        updateRunUi(threadId, {
          draft: '',
          hideStatus: true,
          isRunning: true,
        });
        streamedDraft = '';
        flushBufferedTurnEvents();
      };
      const scheduleHandoff = (nextThread: Thread) => {
        pendingHandoff = nextThread;
        if (handoffTimer !== null) window.clearTimeout(handoffTimer);
        const delay = handoffDelay();
        if (delay === 0) {
          publishHandoff();
          return;
        }
        handoffTimer = window.setTimeout(publishHandoff, delay);
      };
      events.onmessage = (event) => {
        if (terminalReceived) return;
        const data = JSON.parse(event.data || '{}');
        if (pendingHandoff) {
          bufferedTurnEvents.push(data);
          return;
        }
        processTurnEvent(data);
      };
    });
    return completedThread;
  }

  async function approveActiveRun(choice: 'once' | 'session' | 'always' | 'deny') {
    if (!activeHermesRun) return;
    if (!runApproval?.id) {
      updateRunUi(activeHermesRun.threadId, { approvalError: '这次审批缺少 approval_id，请重新发起任务。' });
      return;
    }
    updateRunUi(activeHermesRun.threadId, { approvalSubmitting: true, approvalError: '' });
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, approvalId: runApproval.id, sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        updateRunUi(activeHermesRun.threadId, { approvalError: data.error || '审批响应失败。' });
        return;
      }
      if (data.resolved === false) {
        updateRunUi(activeHermesRun.threadId, { approvalError: '这次审批已失效，请重新发起任务。' });
        return;
      }
      updateRunUi(activeHermesRun.threadId, { approval: null });
    } finally {
      updateRunUi(activeHermesRun.threadId, { approvalSubmitting: false });
    }
  }

  async function respondToActiveClarification(action: 'answer' | 'skip', response = '') {
    if (!activeHermesRun || !runClarification) return;
    if (!runClarification.id) {
      updateRunUi(activeHermesRun.threadId, { clarificationError: '这次提问缺少 clarify_id，请重新发起任务。' });
      return;
    }
    if (action === 'answer' && !response.trim()) {
      updateRunUi(activeHermesRun.threadId, { clarificationError: '请输入回答。' });
      return;
    }
    updateRunUi(activeHermesRun.threadId, { clarificationSubmitting: true, clarificationError: '' });
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clarifyId: runClarification.id, action, response: response.trim(), sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.resolved === false) {
        updateRunUi(activeHermesRun.threadId, { clarificationError: data.error || '这次提问已失效，请重新发起任务。' });
        return;
      }
      updateRunUi(activeHermesRun.threadId, { clarification: null });
    } finally {
      updateRunUi(activeHermesRun.threadId, { clarificationSubmitting: false });
    }
  }

  async function stopActiveRun() {
    if (!activeHermesRun || runStopping) return;
    updateRunUi(activeHermesRun.threadId, { stopping: true, error: '' });
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.resolved === false) {
        throw new Error(data.error || '这次运行已经结束或无法停止');
      }
    } catch (error) {
      updateRunUi(activeHermesRun.threadId, { stopping: false, error: error instanceof Error ? error.message : '停止运行失败，请重试。' });
    }
  }

  async function startNewChat() {
    const text = newChatInput.trim();
    const runAttachments = attachments.flatMap((item) => item.status === 'ready' && item.attachment ? [item.attachment] : []);
    if (!newChatAgent || !newChatProfileModelValue || newChatStarting || attachments.some((item) => item.status !== 'ready') || (!text && !runAttachments.length)) return;
    const startedAt = Date.now();
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
          body: JSON.stringify({ title: titleSeed.slice(0, 40), agentModelOverrides: draftModelOverrides, agentRuntimeOverrides: draftRuntimeOverrides, agentRunOverrides: draftRunOverrides, executionMode: newChatExecutionMode, collaborationMode: newChatPlanEnabled ? 'plan' : 'default', coordinatorAgentId: newChatAgent.id, requestId }),
        })
        : await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryAgentId: newChatAgent.id, title: titleSeed.slice(0, 40), agentModelOverrides: draftModelOverrides, agentRuntimeOverrides: draftRuntimeOverrides, agentRunOverrides: draftRunOverrides, spaceId: activeSpaceId, executionMode: newChatExecutionMode, collaborationMode: newChatPlanEnabled ? 'plan' : 'default', coordinatorAgentId: newChatAgent.id, requestId }),
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
      const localUserMessage: ChatEvent = { id: `local-${Date.now()}`, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text, attachments: runAttachments };
      const optimisticThread = { ...thread, messages: [...thread.messages, localUserMessage] };
      setInput(newChatInputRef.current);
      newChatInputRef.current = '';
      setNewChatInput('');
      setNewChatModelOverride('');
      setNewChatRunOverride({});
      setNewChatPlanEnabled(false);
      setActiveView('thread');
      setActiveThread(optimisticThread);
      resetRunUi(thread.id, { isRunning: true, startedAt, target });
      movedToThread = true;
      setNewChatStarting(false);
      const runAgents = thread.selectedAgents?.length ? thread.selectedAgents : [newChatAgent.id];
      let runAccepted = false;
      try {
        await runHermesAgentThread(thread.id, text, runAgents, startedAt, target, runAttachments, () => {
          runAccepted = true;
          clearAttachmentDrafts();
        });
      } catch (error) {
        if (!runAccepted) setInput((current) => current || text);
        updateRunUi(thread.id, { error: error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。' });
        await refreshHermesRuntime();
      }
      await refreshLeftRail();
      if (thread.mode === 'workspace' && thread.workspaceId) await loadThreads(thread.workspaceId, thread.id);
    } catch (error) {
      if (!movedToThread) {
        setNewChatInput((current) => {
          const restored = current || text;
          newChatInputRef.current = restored;
          return restored;
        });
      }
      if (newChatExecutionMode === 'work') {
        const failure = error as Error & { code?: string; details?: Record<string, any> };
        setCollaborationModeError({ message: failure?.message || '协作运行时未准备好。', code: failure?.code, details: failure?.details });
      } else {
        window.alert(error instanceof Error ? error.message : '新对话创建失败。');
      }
      await refreshHermesRuntime();
    } finally {
      setNewChatStarting(false);
      if (movedToThread && createdThreadId) updateRunUi(createdThreadId, { isRunning: false, startedAt: null, target: null, stopping: false, activeRun: null });
    }
  }

  function openNewChatLauncher() {
    if (!closeProfileInspector()) return;
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
    setNewChatExecutionMode('chat');
    setNewChatPlanEnabled(false);
    setCollaborationModeError(null);
    void discardAttachmentDrafts();
  }

  function openNavSection(sectionId: string) {
    if (!closeProfileInspector()) return;
    setActiveView('thread');
    setActiveNav(sectionId);
  }

  function openSettingsSection(section: SettingsSection = 'workbench') {
    if (!closeProfileInspector()) return;
    setUserMenuOpen(false);
    setSettingsSection(section);
    setActiveView('thread');
    setActiveNav('settings');
  }

  function returnFromSettings() {
    if (!closeProfileInspector()) return;
    setUserMenuOpen(false);
    if (activeThread) {
      setActiveNav('council');
      setActiveView('thread');
      return;
    }
    openNewChatLauncher();
  }

  async function openWorkspace(workspace: Workspace) {
    if (!closeProfileInspector()) return;
    if (workspace.spaceId && workspace.spaceId !== activeSpaceId) await switchSpace(workspace.spaceId);
    setActiveNav('council');
    await loadThreads(workspace.id, workspace.activeThreadId);
  }

  async function openConversation(threadId: string) {
    if (!closeProfileInspector()) return;
    setActiveNav('council');
    await openThread(threadId);
  }

  async function updateThreadVault(vaultId: string | null) {
    if (!activeThread) return;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultId }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
    if (data.thread.mode === 'workspace') await loadThreads(data.thread.workspaceId, data.thread.id);
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
    if (!activeThread || !activePlan || planAction) return;
    setPlanAction('answer');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${activePlan.id}/questions/${batch.id}/answer`, {
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
    if (!activeThread || !activePlan || planAction) return;
    setPlanAction('cancel-question');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${activePlan.id}/questions/${batch.id}/cancel`, {
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
    if (!activeThread || !activePlan || !planFeedbackDraft.trim() || planAction) return;
    const feedback = planFeedbackDraft.trim();
    setPlanAction('feedback');
    setPlanActionError('');
    try {
      const res = await fetch(`/api/threads/${activeThread.id}/plans/${activePlan.id}/feedback`, {
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
      const author = agents.find((agent) => agent.id === activePlan.authorAgentId) || activeComposerAgent;
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

  async function addVault() {
    setVaultError('');
    const value = vaultPathInput.trim();
    if (!value) {
      setVaultError('请输入 Obsidian 仓库路径。');
      return;
    }
    const res = await fetch('/api/vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: value }),
    });
    const data = await res.json();
    if (!res.ok) {
      setVaultError(data.error || '添加失败。');
      return;
    }
    setVaultPathInput('');
    const vaultData = await fetch('/api/vaults').then((r) => r.json());
    setVaults(vaultData.vaults);
    setDefaultVaultId(vaultData.defaultVaultId || data.vault.id);
    if (activeThread) await updateThreadVault(data.vault.id);
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

  async function sendMessage() {
    const text = input.trim();
    const runAttachments = attachments.flatMap((item) => item.status === 'ready' && item.attachment ? [item.attachment] : []);
    if (isRunning || !activeThread || attachments.some((item) => item.status !== 'ready') || (!text && !runAttachments.length)) return;
    const startedAt = Date.now();
    const threadId = activeThread.id;
    setInput('');
    setThreadFollowState(true);
    const target = resolveRunTarget(text, agents, activeComposerAgent);
    resetRunUi(threadId, { isRunning: true, startedAt, target });
    const optimisticThread = {
      ...activeThread,
      messages: [...activeThread.messages, { id: `local-user-${startedAt}`, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text, attachments: runAttachments }],
    };
    setActiveThread(optimisticThread);
    let runAccepted = false;
    try {
      try {
        const routedThread = await runHermesAgentThread(threadId, text, [...selectedAgentIds], startedAt, target, runAttachments, () => {
          runAccepted = true;
          clearAttachmentDrafts();
        });
        if (routedThread) setActiveThread(routedThread);
      } catch (error) {
        if (!runAccepted) setInput((current) => current || text);
        updateRunUi(threadId, { error: error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。' });
        await refreshHermesRuntime();
      }
      await refreshLeftRail();
      if (activeThread.mode === 'workspace' && activeThread.workspaceId) await loadThreads(activeThread.workspaceId, activeThread.id);
    } finally {
      updateRunUi(threadId, { isRunning: false, startedAt: null, target: null, stopping: false, activeRun: null });
    }
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
    const defaultRuntimeId = agents.find((agent) => agent.id === agentId)?.runtimePolicy?.defaultRuntimeId || 'hermes';
    if (runtimeId && runtimeId !== defaultRuntimeId) next[agentId] = runtimeId;
    else delete next[agentId];
    const response = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentRuntimeOverrides: next }),
    });
    const data = await response.json();
    if (response.ok) setActiveThread(data.thread);
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
  const desktopLeftActions = (
    <div className="desktop-window-controls">
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
      >
        <div className="mac-window-drag-region" aria-hidden="true" />
        {!cleanShell && !isSettingsNav && (
          <>
            {desktopLeftActions}
            {rightRailKind && (
              <div className="mac-window-rail-actions">
                <IconTooltipButton
                  active={rightRailOpen && rightRailTab === 'collaboration'}
                  ariaLabel="协作"
                  className="desktop-window-control mac-window-rail-button"
                  onClick={() => toggleRightRailTab('collaboration')}
                  tooltip="协作"
                >
                  <Network size={15} />
                </IconTooltipButton>
                <IconTooltipButton
                  active={rightRailOpen && rightRailTab === 'resources'}
                  ariaLabel="资源"
                  className="desktop-window-control mac-window-rail-button"
                  onClick={() => toggleRightRailTab('resources')}
                  tooltip="资源"
                >
                  <FolderOpen size={15} />
                </IconTooltipButton>
              </div>
            )}
          </>
        )}
      </header>
    )}
    {!cleanShell && (
    <div data-appearance={effectiveAppDark ? 'dark' : 'light'} data-space-color-mode={activeSpaceTheme.colorMode || 'custom'} className={`app ${isWorkbenchShell ? 'workbench-shell desktop-shell mac-desktop-shell' : ''} ${isDesktopShell ? 'native-desktop-shell' : 'managed-web-shell'} ${isWindowsDesktop ? 'windows-shell' : ''} ${isMacConversationShell ? 'workbench-conversation-shell mac-conversation-shell' : ''} ${['org', 'settings', 'models', 'channels', 'plugins', 'kanban', 'jobs', 'monitoring'].includes(activeNav) || activeView === 'new-chat' || spaceEditorReplacesPage ? 'management-mode' : ''} ${isSettingsNav ? 'settings-mode' : ''} ${spaceEditorReplacesPage ? 'workspace-create-mode' : ''} ${macSpaceEditorOpen ? 'mac-space-editor-open' : ''} ${rightRailKind ? 'has-right-rail' : ''} ${rightRailOpen ? 'right-rail-open' : ''} ${activeView === 'new-chat' && !spaceEditorReplacesPage ? 'new-chat-mode' : ''} ${libraryCollapsed ? 'library-collapsed' : ''} ${autoSidebarCollapsed && !spaceEditorReplacesPage ? 'sidebar-auto-collapsed' : ''} ${(isWorkbenchShell || isSettingsNav) && sidebarUsesCollapsedLayout && !spaceEditorReplacesPage ? 'sidebar-collapsed' : ''} ${macSidebarOverlayVisible ? 'mac-sidebar-overlay-visible' : ''} ${macSidebarOverlayOpen ? 'mac-sidebar-overlay-open' : ''} ${macSidebarOverlayClosing ? 'mac-sidebar-overlay-closing' : ''} ${uiSettings.density === 'compact' ? 'compact-density' : ''}`} style={workspaceMaterialStyle}>
      {isDesktopShell && !isSettingsNav && (
        <>
          {!isMacConversationShell && desktopLeftActions}
          {rightRailKind && !isMacConversationShell && (
            <IconTooltipButton
              className={rightRailOpen ? 'desktop-window-control desktop-right-rail-toggle active' : 'desktop-window-control desktop-right-rail-toggle'}
              onClick={() => void persistUi({ libraryCollapsed: rightRailOpen })}
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
                  <Icon size={16} /><span>{item.label}</span>
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
                            <div className={activeView !== 'new-chat' && thread.id === activeThread?.id ? 'rail-subitem active' : 'rail-subitem'} data-rail-hover-row key={thread.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'thread', thread })}>
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
                  <div className={activeView !== 'new-chat' && thread.id === activeThread?.id ? 'rail-item active' : 'rail-item'} data-rail-hover-row key={thread.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'thread', thread })}>
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
      {!isMacConversationShell && (
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

      <main className="main">
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
        {isMacConversationShell && rightRailOpen && !macSpaceEditorOpen && (
          <ResizeHandle
            side="right"
            edgeAligned
            currentWidth={contextWidth}
            minWidth={contextWidthBounds.min}
            maxWidth={macContextResizeMax}
            onResize={setContextWidth}
            onCommit={(width) => void persistUi({ contextWidth: width })}
          />
        )}
        {activeView !== 'new-chat' && !isSettingsNav && !spaceEditorReplacesPage && !isMacConversationShell && <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-title-icon"><FileText size={17} /></span>
            <h1>{isManagementSection ? activeSection?.label : activeThread?.title || activeSection?.label || '新对话'}</h1>
          </div>
          {!isManagementSection && activeThread && (
            <div className="top-actions">
              <RuntimeSwitcher
                thread={activeThread}
                activeAgent={activeComposerAgent}
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
                  onClick={() => void persistUi({ libraryCollapsed: rightRailOpen })}
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
                <MentionTextarea
                  value={newChatInput}
                  onChange={(value) => { newChatInputRef.current = value; setNewChatInput(value); }}
                  onSend={() => void startNewChat()}
                  sendKey={uiSettings.sendKey || 'enter'}
                  agents={agents}
                  selectedAgentIds={[newChatAgent?.id || globalDefaultAgentId].filter(Boolean)}
                  placeholder="随意输入，随意@"
                />
                <div className="composer-toolbar">
                  <div className="composer-left-tools">
                    <ComposerAddMenu
                      planEnabled={newChatPlanEnabled}
                      planBusy={newChatStarting}
                      onAddFile={() => fileInputRef.current?.click()}
                      onEnablePlan={() => setNewChatPlanEnabled(true)}
                    />
                    <input ref={fileInputRef} className="file-input" type="file" multiple accept={attachmentAcceptValue} onChange={(event) => handleAttachmentChange(event.target.files)} />
                    <PermissionModeControl value={newChatPermissionMode} onChange={setNewChatPermissionMode} />
                    <ExecutionModeControl value={newChatExecutionMode} disabled={newChatStarting || newChatPlanEnabled} onChange={(mode) => { setNewChatExecutionMode(mode); setCollaborationModeError(null); }} />
                    {newChatPlanEnabled && <PlanModeIndicator busy={newChatStarting} onClose={() => setNewChatPlanEnabled(false)} />}
                  </div>
                  <div className="composer-right-tools">
                    {['codex', 'claude', 'gemini'].includes(newChatRuntimeId) ? (
                      <span className="composer-native-runtime-model" title="模型由本机 CLI 或 CC Switch 管理">{runtimeLabels[newChatRuntimeId]} · 原生模型</span>
                    ) : <ProviderModelPicker
                      className="composer-model composer-agent-model"
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
                    />}
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
              {collaborationModeError && newChatExecutionMode === 'work' && (
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
          />
        ) : activeNav === 'models' ? (
          <ModelConfigPage models={models} profiles={localProfilesForComposer} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || 'default'} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} onCapabilityChanged={(modelId, modelName, capability) => setModelCapabilities((current) => ({ ...current, [`${modelId}::${modelName}`]: capability }))} />
        ) : activeNav === 'channels' ? (
          <ChannelsPage profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />
        ) : activeNav === 'plugins' ? (
          <PluginsPage agents={agents} profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} />
        ) : activeNav === 'kanban' ? (
          <KanbanPage agents={agents} />
        ) : activeNav === 'jobs' ? (
          <JobsPage profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />
        ) : activeNav === 'monitoring' ? (
          <MonitoringPage />
        ) : activeNav === 'org' ? (
          <OrgPage
            agents={agents}
            models={models}
            hermesRuntime={hermesRuntime}
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
            onRefreshHermesRuntime={refreshHermesRuntime}
            onStartProfileGateway={startHermesProfileGateway}
            onStopProfileGateway={stopHermesProfileGateway}
          />
        ) : (
          <>
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
                    isRunning={activeThread.runStatus === 'running'}
                    onRuntimeChange={updateThreadAgentRuntimeOverride}
                    onOpenRuntimeCenter={() => openSettingsSection('runtimes')}
                  />}
                </header>
              )}
              <div className="thread" ref={threadScrollRef}>
                <div className="thread-content" ref={threadContentRef}>
                {visibleMessages.map((message) => {
                  const transcript = activeThread?.runTranscripts?.find((item) => item.messageId === message.id || (message.externalRunId && item.runId === message.externalRunId));
                  const messagePlan = message.planId ? activeThread?.planSessions?.find((plan) => plan.id === message.planId) : null;
                  const messagePlanDraft = messagePlan?.drafts.find((draft) => draft.revision === message.planRevision);
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
                    <article className={message.agentId === 'user' ? 'message user has-user-identity' : 'message'}>
                      {message.agentId !== 'user' && <MessageAvatar message={message} agents={agents} />}
                      <div className="message-body">
                        {message.agentId !== 'user' && <div className="message-meta">
                          <strong>{message.agentName}</strong>
                          {message.runtimeName && <span>{message.runtimeName}</span>}
                          {message.modelId && <span title={message.modelId}>{message.modelId}</span>}
                        </div>}
                        {message.attachments && message.attachments.length > 0 && <MessageAttachments attachments={message.attachments} />}
                        {message.agentId === 'user' ? (
                          message.content ? <p className="message-text">{message.content}</p> : null
                        ) : message.contentType === 'plan' && messagePlan && messagePlanDraft ? (
                          <PlanCard
                            plan={messagePlan}
                            draft={messagePlanDraft}
                            agents={agents}
                            latest={messagePlan.currentRevision === messagePlanDraft.revision}
                            readOnly={Boolean(messagePlan.readOnly)}
                            busy={Boolean(planAction)}
                            feedbackOpen={planFeedbackOpen && messagePlan.id === activePlan?.id}
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
                    </article>
                  </div>;
                })}
                <ChatCollaborationEvents thread={activeThread} />
                {!isRunning && <PersistedInterruptedRuns thread={activeThread} agents={agents} />}
                {isRunning && !activeRunUi?.hideStatus && (
                    <ChatRunStatus
                    target={runTarget || (activeComposerAgent ? { kind: 'agent', agent: activeComposerAgent } : null)}
                    startedAt={runStartedAt}
                    tick={runTick}
                    draft={runDraft}
                    activityGroups={runActivityGroups}
                    presentationPhase={runPresentationPhase}
                    error={runError}
                    streamingResponses={uiSettings.streamingResponses !== false}
                    threadId={activeThread?.id}
                      workspaceId={activeThread?.workspaceId}
                    />
                )}
                <div ref={threadBottomRef} />
                </div>
              </div>
              <ThreadOverviewRail rounds={overviewRounds} activeRoundId={activeOverviewRoundId} onJumpToRound={jumpToThreadRound} />
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
                {pendingPlanQuestion ? (
                  <PlanQuestionPanel
                    batch={pendingPlanQuestion}
                    submitting={Boolean(planAction)}
                    error={planActionError}
                    onSubmit={(answers) => void answerPlanQuestion(pendingPlanQuestion, answers)}
                    onCancel={() => void cancelPlanQuestion(pendingPlanQuestion)}
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
                    className={`composer ${attachmentDragActive ? 'attachment-drag-active' : ''}`}
                    onDragEnter={handleAttachmentDragEnter}
                    onDragOver={handleAttachmentDragOver}
                    onDragLeave={handleAttachmentDragLeave}
                    onDrop={handleAttachmentDrop}
                  >
                  <AttachmentTray attachments={attachments} notice={attachmentNotice} onRemove={removeAttachment} onRetry={retryAttachment} />
                  {attachmentDragActive && <div className="attachment-drop-overlay"><ArrowDownToLine size={22} /><strong>松开即可添加附件</strong></div>}
                  {activePlan
                    ? <div className="work-mode-hint plan-mode-hint"><Lightbulb size={14} /><span>先调查并整理计划，批准前不会修改项目或启动任务</span></div>
                    : (activeThread?.executionMode || 'chat') === 'work' && <div className="work-mode-hint"><Briefcase size={14} /><span>{activeThread?.collaboration?.workflows?.some((workflow) => workflow.currentRootTaskId && workflow.status !== 'completed') ? '补充内容会交给协调 Agent 调整当前方案' : '发送任务后，协调 Agent 会拆解并发布执行方案'}</span></div>}
                  <MentionTextarea
                    value={input}
                    onChange={setInput}
                    onSend={() => void sendMessage()}
                    sendKey={uiSettings.sendKey || 'enter'}
                    agents={agents}
                    selectedAgentIds={selectedAgentIds}
                    placeholder={(activeThread?.executionMode || 'chat') === 'work' ? '描述要完成的任务，首条消息可 @ 指定协调 Agent' : '随意输入，随意@'}
                  />
	                  <div className="composer-toolbar">
	                    <div className="composer-left-tools">
	                      <ComposerAddMenu
	                        planEnabled={Boolean(activePlan)}
	                        planBusy={Boolean(planAction) || isRunning}
	                        onAddFile={() => fileInputRef.current?.click()}
	                        onEnablePlan={() => void setThreadPlanMode(true)}
	                      />
	                      <input ref={fileInputRef} className="file-input" type="file" multiple accept={attachmentAcceptValue} onChange={(event) => handleAttachmentChange(event.target.files)} />
	                      <PermissionModeControl value={permissionMode} onChange={(mode) => void updateThreadPermissionMode(mode)} />
	                      <ExecutionModeControl value={activeThread?.executionMode || 'chat'} disabled={isRunning || Boolean(activePlan)} switching={modeSwitching} onChange={(mode) => void updateThreadExecutionMode(mode)} />
	                      {activePlan && <PlanModeIndicator busy={Boolean(planAction)} onClose={() => void setThreadPlanMode(false)} />}
	                    </div>
	                    <div className="composer-right-tools">
	                      {['codex', 'claude', 'gemini'].includes(activeComposerRuntimeId) ? (
	                        <span className="composer-native-runtime-model" title="模型由本机 CLI 或 CC Switch 管理">{runtimeLabels[activeComposerRuntimeId]} · 原生模型</span>
	                      ) : <ProviderModelPicker
	                        className="composer-model composer-agent-model"
	                        agentName={activeComposerAgent?.name || ''}
	                        value={activeComposerProfileModelValue}
	                        models={hermesProfileModelOptions}
                        emptyLabel={activeComposerAgent ? '未配置模型' : '请先新建 Agent'}
                        ariaLabel={activeComposerAgent ? `${activeComposerAgent.name} 的 Frakio Model Center 模型` : 'Frakio Model Center 模型'}
                        title="Frakio Model Center"
	                        allowDefault
	                        usingDefault={!activeThreadModelOverride}
	                        capabilities={modelCapabilities}
	                        runOverride={activeThreadRunOverride}
	                        onRunOverrideChange={(override) => activeComposerAgent ? updateThreadAgentRunOverride(activeComposerAgent.id, override) : undefined}
	                        onChange={(value) => activeComposerAgent ? updateThreadAgentModelOverride(activeComposerAgent.id, value) : undefined}
	                      />}
	                      <ComposerRunButton
	                        isRunning={isRunning}
	                        hasActiveRun={Boolean(activeHermesRun)}
	                        isStopping={runStopping}
	                        canSend={!workflowControlInProgress && attachments.every((item) => item.status === 'ready') && Boolean(input.trim() || attachments.length)}
	                        runningLabel={(activeThread?.executionMode || 'chat') === 'work' ? '停止当前协调运行，不会暂停全部任务' : undefined}
	                        onSend={() => void sendMessage()}
	                        onStop={() => void stopActiveRun()}
	                      />
	                    </div>
	                  </div>
	                  {planActionError && !pendingPlanQuestion && <div className="plan-inline-error" role="alert">{planActionError}</div>}
	                </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {rightRailKind && (
        <>
          {!isMacConversationShell && (
            <ResizeHandle
              side="right"
              currentWidth={contextWidth}
              minWidth={contextWidthBounds.min}
              maxWidth={contextWidthBounds.max}
              disabled={!rightRailOpen}
              onResize={setContextWidth}
              onCommit={(width) => void persistUi({ contextWidth: width })}
            />
          )}
          <aside className="context" aria-hidden={!rightRailOpen}>
            <CollaborationContextPanel
            contextPacket={activeThread?.contextPacket || null}
            proposals={activeThread?.proposals || []}
            workspaceArtifacts={workspaceArtifacts}
            thread={activeThread}
            agents={agents}
            workspace={activeWorkspace}
            isRunning={isRunning}
            runApproval={runApproval}
            runClarification={runClarification}
            runError={runError}
            runDraft={runDraft}
            fallbackDecisionAgentId={uiSettings.fallbackDecisionAgentId || globalDefaultAgentId}
            collaborationModeError={collaborationModeError}
            collaborationModeLoading={modeSwitching}
            onRetryCollaboration={() => void updateThreadExecutionMode('work')}
            panelTab={rightRailTab}
            onPanelTabChange={setRightRailTab}
            />
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
                  <label className="form-row">
                    <span>项目名称</span>
                    <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={projectModalPurpose === 'convert' ? '留空则使用当前对话标题' : '例如 Frakio Blog Ops'} />
                  </label>
                  <div className="project-location-row">
                    <span>保存位置</span>
                    <button className="secondary-btn" onClick={() => void chooseProjectParentFolder()}><FolderOpen size={14} />选择位置</button>
                  </div>
                  <div className="project-path-preview">{projectParentPath || defaultProjectParentPath}</div>
                  {projectName.trim() && (
                    <div className="project-path-preview target">{projectParentPath || defaultProjectParentPath}/{slugText(projectName)}</div>
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
                  <button className="send-btn" onClick={() => projectModalPurpose === 'convert' ? void convertActiveConversationToProject() : void createWorkspaceProject()}>{projectModalPurpose === 'convert' ? '转为项目' : '创建项目'}</button>
                ) : !canSelectFolder ? (
                  <button className="send-btn" onClick={() => projectModalPurpose === 'convert' ? void convertActiveConversationToProject() : void createWorkspaceProject()}>选择项目</button>
                ) : null}
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

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || data?.error?.message || '请求失败') as Error & { code?: string; details?: Record<string, any> };
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data as T;
}

function GlobalSearchDialog({ conversations, agents, onClose, onOpenThread, onOpenAgent, onOpenSettings }: {
  conversations: ThreadSummary[];
  agents: Agent[];
  onClose: () => void;
  onOpenThread: (threadId: string) => Promise<void>;
  onOpenAgent: (agentId: string) => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const threads = conversations.filter((thread) => !normalized || `${thread.title} ${thread.preview} ${thread.primaryAgentName || ''}`.toLowerCase().includes(normalized)).slice(0, 8);
  const matchingAgents = agents.filter((agent) => !normalized || `${agent.name} ${agent.role} ${agent.profileName || ''}`.toLowerCase().includes(normalized)).slice(0, 6);
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onClose]);
  return (
    <div className="modal-backdrop global-search-backdrop" onClick={onClose}>
      <div className="global-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" onClick={(event) => event.stopPropagation()}>
        <label className="global-search-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话、Agent 或设置" /><button onClick={onClose} aria-label="关闭"><X size={16} /></button></label>
        <div className="global-search-results">
          <section><strong>对话</strong>{threads.length ? threads.map((thread) => <button key={thread.id} onClick={() => void onOpenThread(thread.id)}><MessageSquare size={16} /><span><b>{thread.title}</b><small>{thread.preview || '暂无内容'}</small></span></button>) : <p>没有匹配的对话</p>}</section>
          <section><strong>Agent</strong>{matchingAgents.length ? matchingAgents.map((agent) => <button key={agent.id} onClick={() => onOpenAgent(agent.id)}><Bot size={16} /><span><b>{agent.name}</b><small>{agent.role}</small></span></button>) : <p>没有匹配的 Agent</p>}</section>
          <section><strong>设置</strong><button onClick={onOpenSettings}><Settings size={16} /><span><b>打开设置</b><small>Runtime、模型、更新和工作台偏好</small></span></button></section>
        </div>
      </div>
    </div>
  );
}

const profileOptionFallback = [{ name: 'default', model: '', provider: '', hasConfig: true, hasEnv: false, hasAuth: false }];

function profileOptions(profiles: HermesProfile[]) {
  return profiles.length ? profiles : profileOptionFallback;
}

const settingsTabs = [
  { id: 'proxy', label: '代理' },
  { id: 'agent', label: '代理执行' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'memory', label: '记忆' },
  { id: 'compression', label: '上下文压缩' },
  { id: 'session', label: '会话' },
  { id: 'voice', label: '语音' },
];

const settingFields: Record<string, Array<{ section: string; key: string; label: string; type: 'toggle' | 'number' | 'text' | 'select' | 'csv'; options?: string[]; placeholder?: string }>> = {
  proxy: [
    { section: 'proxy', key: 'HTTPS_PROXY', label: 'HTTPS_PROXY', type: 'text', placeholder: 'http://127.0.0.1:7890' },
    { section: 'proxy', key: 'HTTP_PROXY', label: 'HTTP_PROXY', type: 'text' },
    { section: 'proxy', key: 'ALL_PROXY', label: 'ALL_PROXY', type: 'text' },
    { section: 'proxy', key: 'NO_PROXY', label: 'NO_PROXY', type: 'text', placeholder: 'localhost,127.0.0.1' },
  ],
  agent: [
    { section: 'agent', key: 'max_turns', label: '最大轮次', type: 'number' },
    { section: 'agent', key: 'gateway_timeout', label: '网关超时（秒）', type: 'number' },
    { section: 'agent', key: 'restart_drain_timeout', label: '重启排空超时（秒）', type: 'number' },
    { section: 'agent', key: 'tool_use_enforcement', label: '工具执行策略', type: 'select', options: ['auto', 'strict', 'off'] },
  ],
  gateway: [
    { section: 'gatewayAutoStart', key: 'enabled', label: 'Gateway 自动启动', type: 'toggle' },
    { section: 'gatewayAutoStart', key: 'management', label: '统一 Gateway', type: 'select', options: ['per_profile', 'unified'] },
    { section: 'gatewayAutoStart', key: 'include', label: '白名单 profiles', type: 'csv', placeholder: 'default, reviewer' },
    { section: 'gatewayAutoStart', key: 'exclude', label: '排除 profiles', type: 'csv', placeholder: 'default, reviewer' },
  ],
  memory: [
    { section: 'memory', key: 'memory_enabled', label: '启用记忆', type: 'toggle' },
    { section: 'memory', key: 'user_profile_enabled', label: '用户画像', type: 'toggle' },
    { section: 'memory', key: 'memory_char_limit', label: '记忆字符上限', type: 'number' },
    { section: 'memory', key: 'user_char_limit', label: '用户画像字符上限', type: 'number' },
    { section: 'memory', key: 'write_approval', label: '记忆写入审核', type: 'toggle' },
    { section: 'skills', key: 'write_approval', label: '技能写入审核', type: 'toggle' },
  ],
  compression: [
    { section: 'compression', key: 'enabled', label: '启用压缩', type: 'toggle' },
    { section: 'compression', key: 'threshold', label: '压缩阈值', type: 'number' },
    { section: 'compression', key: 'target_ratio', label: '目标比例', type: 'number' },
    { section: 'compression', key: 'protect_last_n', label: '保护最近消息', type: 'number' },
    { section: 'compression', key: 'protect_first_n', label: '保护开头消息', type: 'number' },
  ],
  session: [
    { section: 'approvals', key: 'mode', label: '操作权限', type: 'select', options: ['manual', 'smart', 'off'] },
    { section: 'session_reset', key: 'mode', label: '重置模式', type: 'select', options: ['off', 'idle', 'scheduled', 'idle+scheduled'] },
    { section: 'session_reset', key: 'idle_minutes', label: '空闲超时（分钟）', type: 'number' },
    { section: 'session_reset', key: 'at_hour', label: '定时重置时间', type: 'number' },
  ],
  voice: [
    { section: 'tts', key: 'provider', label: '当前 TTS API', type: 'select', options: ['edge', 'openai', 'elevenlabs', 'mistral', 'xai', 'neutts', 'piper'] },
    { section: 'tts', key: 'edge.voice', label: 'Edge TTS 音色', type: 'text', placeholder: 'zh-CN-XiaoxiaoNeural' },
    { section: 'stt', key: 'provider', label: '当前 STT API', type: 'select', options: ['local', 'browser', 'openai', 'mistral', 'elevenlabs'] },
  ],
};

function HermesProfileConfigEditor({ profileName, compact = false }: { profileName: string; compact?: boolean }) {
  const [activeTab, setActiveTab] = useState('agent_run');
  const [config, setConfig] = useState<HermesConfig>({});
  const [draft, setDraft] = useState<HermesConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  async function loadConfig(nextProfile = profileName) {
    if (!nextProfile) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<HermesConfig>(`/api/hermes/config?profile=${encodeURIComponent(nextProfile)}`);
      setConfig(data);
      setDraft(data);
    } catch (err: any) {
      setError(err.message || '配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setActiveTab('agent_run');
    setConfig({});
    setDraft({});
    setError('');
    setSaving('');
    void loadConfig(profileName);
  }, [profileName]);

  function fieldValue(section: string, key: string) {
    return getNestedValue(draft?.[section] || {}, key) ?? '';
  }

  function updateField(section: string, key: string, value: any) {
    setDraft((current) => ({
      ...current,
      [section]: setNestedDraft(current[section] || {}, key, value),
    }));
  }

  async function saveSection(section: string) {
    if (!profileName) return;
    setSaving(section);
    setError('');
    try {
      await requestJson(`/api/hermes/config?profile=${encodeURIComponent(profileName)}`, {
        method: 'PUT',
        body: JSON.stringify({ section, values: draft[section] || {} }),
      });
      await loadConfig(profileName);
    } catch (err: any) {
      setError(err.message || '配置保存失败');
    } finally {
      setSaving('');
    }
  }

  const fields = settingFields[activeTab] || [];
  const sections = Array.from(new Set(fields.map((field) => field.section)));

  return (
    <section className={compact ? 'studio-settings-panel agent-config-editor compact' : 'studio-settings-panel agent-config-editor'}>
      <div className="studio-toolbar agent-config-toolbar">
        <div>
          <h3>Hermes Profile 配置</h3>
          <p>正在编辑：{profileName}</p>
        </div>
      </div>
      <div className="module-matrix-tabs">
        {settingsTabs.map((tab) => <button className={activeTab === tab.id ? 'selected' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="empty-state">读取 Hermes 配置中...</div> : (
        <div className="settings-option-list">
          {fields.map((field) => (
            <label className="settings-option-row" key={`${field.section}.${field.key}`}>
              <span><strong>{field.label}</strong><small>{field.section}.{field.key}</small></span>
              {field.type === 'toggle' ? (
                <SettingsSwitch
                  ariaLabel={field.label}
                  checked={Boolean(fieldValue(field.section, field.key))}
                  onChange={(checked) => updateField(field.section, field.key, checked)}
                />
              ) : field.type === 'select' ? (
                <SettingsField>
                  <select value={String(fieldValue(field.section, field.key) || field.options?.[0] || '')} onChange={(event) => updateField(field.section, field.key, event.target.value)}>
                    {(field.options || []).map((option) => <option key={option} value={option}>{field.section === 'approvals' && field.key === 'mode' ? permissionLabel(option) : option}</option>)}
                  </select>
                </SettingsField>
              ) : (
                <SettingsField>
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    step={field.key.includes('ratio') || field.key.includes('threshold') ? '0.1' : '1'}
                    value={inputValue(fieldValue(field.section, field.key))}
                    placeholder={field.placeholder}
                    onChange={(event) => updateField(field.section, field.key, field.type === 'number' ? Number(event.target.value) : field.type === 'csv' ? csvValue(event.target.value) : event.target.value)}
                  />
                </SettingsField>
              )}
            </label>
          ))}
          <div className="settings-save-row">
            {sections.map((section) => (
              <button className="secondary-btn" key={section} onClick={() => void saveSection(section)} disabled={Boolean(saving)}>
                {saving === section ? '保存中' : `保存 ${section}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type PlatformField = { key: string; label: string; hint?: string; type?: 'toggle' | 'csv'; credential?: boolean; secret?: boolean; placeholder?: string };
type PlatformDefinition = { key: string; name: string; icon: React.ComponentType<{ size?: number }>; exclusive?: boolean; fields: PlatformField[] };
const exclusiveTokenHint = '此平台使用独占 token 锁。每个 profile 必须使用不同的身份 token，否则会与其他 profile 冲突导致 gateway 启动失败。';
const platformDefinitions: PlatformDefinition[] = [
  { key: 'telegram', name: 'Telegram', icon: Send, exclusive: true, fields: [{ key: 'token', label: 'Bot Token', hint: '开发者门户获取的 Bot Token', credential: true, placeholder: '123456:ABC-DEF...' }, { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理，支持 http://、https:// 和 socks5://', credential: true, placeholder: 'socks5://127.0.0.1:7890' }, { key: 'require_mention', label: '需要 @提及', hint: '群组中需要 @机器人 才会响应', type: 'toggle' }, { key: 'reactions', label: '表情回应', hint: '对消息添加表情回应', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要 @提及即响应的聊天 ID，逗号分隔', placeholder: 'chat_id1,chat_id2' }, { key: 'mention_patterns', label: '自定义提及模式', hint: '额外的触发模式列表', type: 'csv', placeholder: 'pattern1, pattern2' }] },
  { key: 'discord', name: 'Discord', icon: MessageSquare, exclusive: true, fields: [{ key: 'token', label: 'Bot Token', hint: 'Discord Bot Token', credential: true, placeholder: 'Bot token...' }, { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理', credential: true, placeholder: 'socks5://127.0.0.1:7890' }, { key: 'require_mention', label: '需要 @提及', hint: '频道中需要提及机器人', type: 'toggle' }, { key: 'auto_thread', label: '自动线程', hint: '自动把回复放入线程', type: 'toggle' }, { key: 'reactions', label: '表情回应', hint: '对消息添加表情回应', type: 'toggle' }, { key: 'free_response_channels', label: '自由响应频道', hint: '不需要提及即可响应的频道 ID', placeholder: 'channel_id1,channel_id2' }, { key: 'allowed_channels', label: '允许频道', hint: '限制可响应频道', placeholder: 'channel_id1,channel_id2' }, { key: 'ignored_channels', label: '忽略频道', hint: '忽略这些频道', placeholder: 'channel_id1,channel_id2' }, { key: 'no_thread_channels', label: '禁用线程频道', hint: '这些频道不自动开线程', placeholder: 'channel_id1,channel_id2' }] },
  { key: 'slack', name: 'Slack', icon: Network, exclusive: true, fields: [{ key: 'token', label: 'Bot Token', hint: 'Slack Bot Token', credential: true, placeholder: 'xoxb-...' }, { key: 'require_mention', label: '需要 @提及', hint: '频道中需要提及机器人', type: 'toggle' }, { key: 'allow_bots', label: '允许机器人消息', hint: '允许响应机器人消息', type: 'toggle' }, { key: 'free_response_channels', label: '自由响应频道', hint: '不需要提及即可响应的频道 ID', placeholder: 'channel_id1,channel_id2' }] },
  { key: 'whatsapp', name: 'WhatsApp', icon: MessageSquare, exclusive: true, fields: [{ key: 'enabled', label: '启用', hint: '启用 WhatsApp gateway', type: 'toggle', credential: true }, { key: 'require_mention', label: '需要 @提及', hint: '群组中需要提及机器人', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' }, { key: 'mention_patterns', label: '自定义提及模式', hint: '额外触发模式列表', type: 'csv', placeholder: 'pattern1, pattern2' }] },
  { key: 'matrix', name: 'Matrix', icon: Boxes, fields: [{ key: 'token', label: 'Access Token', hint: 'Matrix access token', credential: true, placeholder: 'syt_...' }, { key: 'extra.homeserver', label: 'Homeserver', hint: 'Matrix homeserver 地址', credential: true, placeholder: 'https://matrix.org' }, { key: 'extra.user_id', label: 'User ID', hint: 'Matrix 用户 ID', credential: true, placeholder: '@hermes:example.org' }, { key: 'extra.password', label: 'Password', hint: '没有 token 时可使用密码登录', credential: true, secret: true, placeholder: 'Matrix password' }, { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理', credential: true, placeholder: 'socks5://127.0.0.1:7890' }, { key: 'require_mention', label: '需要 @提及', hint: '房间中需要提及机器人', type: 'toggle' }, { key: 'auto_thread', label: '自动线程', hint: '自动创建线程', type: 'toggle' }, { key: 'dm_mention_threads', label: '私信提及线程', hint: '私信提及时创建线程', type: 'toggle' }, { key: 'free_response_rooms', label: '自由响应房间', hint: '不需要提及即可响应的房间 ID', placeholder: 'room_id1,room_id2' }] },
  { key: 'feishu', name: 'Feishu', icon: FileText, exclusive: true, fields: [{ key: 'extra.app_id', label: 'App ID', hint: '飞书应用 App ID', credential: true, placeholder: 'cli_...' }, { key: 'extra.app_secret', label: 'App Secret', hint: '飞书应用密钥', credential: true, secret: true, placeholder: 'App Secret' }, { key: 'extra.encrypt_key', label: 'Encrypt Key', hint: '事件订阅加密密钥', credential: true, secret: true, placeholder: 'Encrypt Key' }, { key: 'extra.verification_token', label: 'Verification Token', hint: '事件订阅校验 token', credential: true, secret: true, placeholder: 'Verification Token' }, { key: 'require_mention', label: '需要 @提及', hint: '群聊中需要提及机器人', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' }] },
  { key: 'dingtalk', name: 'DingTalk', icon: ZapIcon, exclusive: true, fields: [{ key: 'extra.client_id', label: 'Client ID', hint: '钉钉 Client ID', credential: true, placeholder: 'Client ID' }, { key: 'extra.client_secret', label: 'Client Secret', hint: '钉钉 Client Secret', credential: true, secret: true, placeholder: 'Client Secret' }, { key: 'extra.app_key', label: 'App Key', hint: '钉钉 App Key', credential: true, placeholder: 'App Key' }, { key: 'extra.card_template_id', label: 'AI Card Template ID', hint: 'AI 卡片模板 ID', credential: true, placeholder: 'AI Card Template ID' }, { key: 'allow_all_users', label: '允许所有用户', hint: '允许所有用户触发机器人', type: 'toggle', credential: true }, { key: 'allowed_users', label: '允许用户', hint: '允许的用户 ID，逗号分隔', credential: true, placeholder: 'user_id1,user_id2' }, { key: 'require_mention', label: '需要 @提及', hint: '群聊中需要提及机器人', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' }] },
  { key: 'qqbot', name: 'QQBot', icon: Bot, exclusive: true, fields: [{ key: 'extra.app_id', label: 'App ID', hint: 'QQ Bot App ID', credential: true, placeholder: 'App ID' }, { key: 'extra.client_secret', label: 'App Secret', hint: 'QQ Bot App Secret', credential: true, secret: true, placeholder: 'App Secret' }, { key: 'allowed_users', label: '允许用户', hint: '允许的 openid，逗号分隔', credential: true, placeholder: 'openid1,openid2' }, { key: 'allow_all_users', label: '允许所有用户', hint: '允许所有用户触发机器人', type: 'toggle', credential: true }, { key: 'extra.markdown_support', label: 'Markdown 支持', hint: '启用 QQ markdown 消息', type: 'toggle' }] },
  { key: 'weixin', name: 'Weixin', icon: MessageSquare, exclusive: true, fields: [{ key: 'token', label: 'Token', hint: '微信 iLink bot token', credential: true, secret: true, placeholder: 'Token' }, { key: 'extra.account_id', label: 'Account ID', hint: '微信 iLink bot account ID', credential: true, placeholder: 'Account ID' }, { key: 'extra.base_url', label: 'Base URL', hint: 'iLink API base URL', credential: true, placeholder: 'https://ilinkai.weixin.qq.com' }] },
  { key: 'wecom', name: 'WeCom', icon: Building2, fields: [{ key: 'extra.bot_id', label: 'Bot ID', hint: '企业微信 Bot ID', credential: true, placeholder: 'Bot ID' }, { key: 'extra.secret', label: 'Secret', hint: '企业微信 Secret', credential: true, secret: true, placeholder: 'Secret' }] },
];

function getNestedValue(source: Record<string, any>, keyPath: string) {
  return keyPath.split('.').reduce((value, key) => value?.[key], source);
}

function inputValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

function csvValue(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function setNestedDraft(source: Record<string, any>, keyPath: string, value: any) {
  const next = JSON.parse(JSON.stringify(source || {}));
  const parts = keyPath.split('.');
  let cursor = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor[parts[index]] = cursor[parts[index]] || {};
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {}));
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function pickPlatformValues(current: Record<string, any>, fields: PlatformField[]) {
  return fields
    .reduce((values, field) => {
      const value = getNestedValue(current, field.key);
      if (value !== undefined) return setNestedDraft(values, field.key, value);
      return values;
    }, {} as Record<string, any>);
}

function platformConfigured(platform: PlatformDefinition, credentials: Record<string, any>) {
  if (platform.key === 'matrix') {
    const extra = credentials.extra || {};
    const homeserver = String(extra.homeserver || '').trim();
    const token = String(credentials.token || '').trim();
    const userId = String(extra.user_id || '').trim();
    const password = String(extra.password || '').trim();
    return Boolean(homeserver && (token || (userId && password)));
  }
  const keys = ['token', 'api_key', 'app_id', 'client_id', 'secret', 'app_secret', 'client_secret', 'access_token', 'bot_id', 'account_id', 'enabled'];
  const targets = [credentials, credentials.extra].filter(Boolean);
  return targets.some((target) => keys.some((key) => {
    const value = target[key];
    return value !== undefined && value !== null && value !== '' && value !== false;
  }));
}

function qrStatusLabel(status: WeixinQrStatus['status']) {
  if (status === 'loading') return '正在获取二维码...';
  if (status === 'waiting') return '请使用微信扫码登录。';
  if (status === 'scaned') return '已扫码，请在微信中确认登录。';
  if (status === 'expired') return '二维码已过期，请重新登录。';
  if (status === 'confirmed') return '已确认，正在保存凭据。';
  if (status === 'error') return '扫码登录失败。';
  return '';
}

type WeixinQrStatus = { status: 'idle' | 'loading' | 'waiting' | 'scaned' | 'scaned_but_redirect' | 'expired' | 'confirmed' | 'error'; qrcode?: string; qrcodeUrl?: string; error?: string };

function WeixinQrDialog({ state, onClose, onRetry }: { state: WeixinQrStatus; onClose: () => void; onRetry: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop weixin-qr-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal weixin-qr-modal" role="dialog" aria-modal="true" aria-labelledby="weixin-qr-title">
        <div className="modal-head">
          <div><h2 id="weixin-qr-title">微信扫码登录</h2><p>使用微信扫描二维码，为当前 Profile 连接 Weixin。</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="weixin-qr-modal-body">
          <div className={`weixin-qr-code ${state.qrcodeUrl ? '' : 'placeholder'}`}>
            {state.qrcodeUrl
              ? <QRCodeSVG value={state.qrcodeUrl} size={232} level="M" marginSize={2} title="微信登录二维码" />
              : <LoaderCircle className="spin" size={30} aria-hidden="true" />}
          </div>
          <div className={`weixin-qr-status ${state.status === 'error' || state.status === 'expired' ? 'error' : ''}`} role="status">
            {state.error || qrStatusLabel(state.status)}
          </div>
          {(state.status === 'expired' || state.status === 'error') && (
            <button type="button" className="send-btn" onClick={onRetry}>重新获取二维码</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChannelsPage({ profiles, defaultProfile, embedded = false }: { profiles: HermesProfile[]; defaultProfile: string; embedded?: boolean }) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [config, setConfig] = useState<HermesConfig>({});
  const [configDrafts, setConfigDrafts] = useState<Record<string, Record<string, any>>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, Record<string, any>>>({});
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({});
  const [touchedConfig, setTouchedConfig] = useState<Record<string, boolean>>({});
  const [touchedCredentials, setTouchedCredentials] = useState<Record<string, boolean>>({});
  const [weixinQr, setWeixinQr] = useState<WeixinQrStatus>({ status: 'idle' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const weixinPollRef = useRef<number | null>(null);
  const weixinAttemptRef = useRef(0);

  const closeWeixinQrLogin = useCallback(() => {
    weixinAttemptRef.current += 1;
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
    weixinPollRef.current = null;
    setWeixinQr({ status: 'idle' });
  }, []);

  async function loadChannels(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<HermesConfig>(`/api/hermes/config?profile=${encodeURIComponent(nextProfile)}`);
      setConfig(data);
      setConfigDrafts(Object.fromEntries(platformDefinitions.map((platform) => [platform.key, pickPlatformValues(data.platforms?.[platform.key] || {}, platform.fields.filter((field) => !field.credential))])));
      setCredentialDrafts(Object.fromEntries(platformDefinitions.map((platform) => [platform.key, pickPlatformValues(data.platforms?.[platform.key] || {}, platform.fields.filter((field) => field.credential))])));
      setTouchedConfig({});
      setTouchedCredentials({});
      setExpandedPlatforms((current) => Object.keys(current).length ? current : Object.fromEntries(platformDefinitions.map((platform) => [platform.key, true])));
    } catch (err: any) {
      setError(err.message || '频道配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChannels(profile);
  }, [profile]);

  useEffect(() => {
    closeWeixinQrLogin();
  }, [profile, closeWeixinQrLogin]);

  useEffect(() => () => {
    weixinAttemptRef.current += 1;
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
  }, []);

  function updateConfigDraft(platform: string, field: PlatformField, value: any) {
    setConfigDrafts((items) => ({ ...items, [platform]: setNestedDraft(items[platform] || {}, field.key, value) }));
    setTouchedConfig((items) => ({ ...items, [platform]: true }));
  }

  function updateCredentialDraft(platform: string, field: PlatformField, value: any) {
    setCredentialDrafts((items) => ({ ...items, [platform]: setNestedDraft(items[platform] || {}, field.key, value) }));
    setTouchedCredentials((items) => ({ ...items, [platform]: true }));
  }

  function hasConfigChanges(platform: PlatformDefinition) {
    const original = pickPlatformValues(config.platforms?.[platform.key] || {}, platform.fields.filter((field) => !field.credential));
    return Boolean(touchedConfig[platform.key]) && !sameJson(configDrafts[platform.key], original);
  }

  function hasCredentialChanges(platform: PlatformDefinition) {
    const original = pickPlatformValues(config.platforms?.[platform.key] || {}, platform.fields.filter((field) => field.credential));
    return Boolean(touchedCredentials[platform.key]) && !sameJson(credentialDrafts[platform.key], original);
  }

  async function savePlatform(platform: string) {
    setSaving(platform);
    setError('');
    try {
      const definition = platformDefinitions.find((item) => item.key === platform);
      if (!definition) return;
      if (hasConfigChanges(definition)) {
        await requestJson(`/api/hermes/config?profile=${encodeURIComponent(profile)}`, {
          method: 'PUT',
          body: JSON.stringify({ section: platform, values: cloneRecord(configDrafts[platform] || {}) }),
        });
      }
      if (hasCredentialChanges(definition)) {
        await requestJson(`/api/hermes/config/credentials?profile=${encodeURIComponent(profile)}`, {
          method: 'PUT',
          body: JSON.stringify({ platform, values: cloneRecord(credentialDrafts[platform] || {}) }),
        });
      }
      await loadChannels(profile);
    } catch (err: any) {
      setError(err.message || '频道配置保存失败');
    } finally {
      setSaving('');
    }
  }

  async function pollWeixinStatus(qrcode: string, attempt: number) {
    try {
      const data = await requestJson<{ status: WeixinQrStatus['status'] | 'wait'; account_id?: string; token?: string; base_url?: string }>(`/api/hermes/weixin/qrcode/status?qrcode=${encodeURIComponent(qrcode)}`);
      if (attempt !== weixinAttemptRef.current) return;
      if (data.status === 'confirmed' && data.account_id && data.token) {
        setWeixinQr((current) => ({ ...current, status: 'confirmed', qrcode }));
        await requestJson(`/api/hermes/weixin/save?profile=${encodeURIComponent(profile)}`, {
          method: 'POST',
          body: JSON.stringify({ account_id: data.account_id, token: data.token, base_url: data.base_url }),
        });
        if (attempt !== weixinAttemptRef.current) return;
        await loadChannels(profile);
        if (attempt === weixinAttemptRef.current) closeWeixinQrLogin();
        return;
      }
      if (data.status === 'expired') {
        setWeixinQr((current) => ({ ...current, status: 'expired', qrcode }));
        return;
      }
      const nextStatus = data.status === 'wait' ? 'waiting' : data.status === 'scaned_but_redirect' ? 'scaned' : data.status;
      setWeixinQr((current) => ({ ...current, status: nextStatus, qrcode }));
      weixinPollRef.current = window.setTimeout(() => void pollWeixinStatus(qrcode, attempt), 3000);
    } catch (err: any) {
      if (attempt !== weixinAttemptRef.current) return;
      setWeixinQr((current) => ({ ...current, status: 'error', qrcode, error: err.message || '微信扫码状态读取失败' }));
    }
  }

  async function startWeixinQrLogin() {
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
    weixinPollRef.current = null;
    const attempt = weixinAttemptRef.current + 1;
    weixinAttemptRef.current = attempt;
    setWeixinQr({ status: 'loading' });
    setError('');
    try {
      const data = await requestJson<{ qrcode: string; qrcode_url: string }>('/api/hermes/weixin/qrcode');
      if (attempt !== weixinAttemptRef.current) return;
      if (!data.qrcode_url) throw new Error('微信二维码内容为空');
      setWeixinQr({ status: 'waiting', qrcode: data.qrcode, qrcodeUrl: data.qrcode_url });
      void pollWeixinStatus(data.qrcode, attempt);
    } catch (err: any) {
      if (attempt !== weixinAttemptRef.current) return;
      setWeixinQr({ status: 'error', error: err.message || '微信二维码获取失败' });
    }
  }

  return (
    <>
    <section className={embedded ? 'embedded-management-page channels-page' : 'management-page channels-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>频道</h2></div>
        <label>Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="empty-state">读取频道配置中...</div> : (
        <div className="platform-grid">
          {platformDefinitions.map((platform) => {
            const Icon = platform.icon;
            const configDraft = configDrafts[platform.key] || {};
            const credentialDraft = credentialDrafts[platform.key] || {};
            const configured = platformConfigured(platform, credentialDraft);
            const expanded = expandedPlatforms[platform.key] !== false;
            const hasChanges = hasConfigChanges(platform) || hasCredentialChanges(platform);
            return (
              <article className={configured ? 'platform-card configured' : 'platform-card'} key={platform.key}>
                <button className="platform-head" onClick={() => setExpandedPlatforms((items) => ({ ...items, [platform.key]: !expanded }))} aria-expanded={expanded}>
                  <span className="platform-title"><span className="platform-icon"><Icon size={16} /></span><strong>{platform.name}</strong><em className={configured ? 'configured' : ''}>{configured ? '已配置' : '未配置'}</em>{platform.exclusive && <small>独占 token</small>}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="platform-body">
                    {platform.exclusive && <div className="platform-warning"><ShieldAlert size={15} />{exclusiveTokenHint}</div>}
                    {platform.key === 'weixin' && (
                      <div className="weixin-qr-section">
                        <button className="secondary-btn" onClick={() => void startWeixinQrLogin()} disabled={weixinQr.status === 'loading' || weixinQr.status === 'waiting' || weixinQr.status === 'scaned'}>
                          {configured ? '重新扫码登录' : '扫码登录'}
                        </button>
                        {weixinQr.status !== 'idle' && <span className={weixinQr.status === 'error' || weixinQr.status === 'expired' ? 'error' : ''}>{weixinQr.error || qrStatusLabel(weixinQr.status)}</span>}
                      </div>
                    )}
                    <div className="platform-fields">
                      {platform.fields.map((field) => {
                        const draft = field.credential ? credentialDraft : configDraft;
                        const value = getNestedValue(draft, field.key);
                        const update = field.credential ? updateCredentialDraft : updateConfigDraft;
                        return (
                          <label className="platform-setting-row" key={field.key}>
                            <span><strong>{field.label}</strong>{field.hint && <small>{field.hint}</small>}</span>
                            {field.type === 'toggle' ? (
                              <button className={Boolean(value) ? 'toggle-switch on' : 'toggle-switch'} type="button" onClick={() => update(platform.key, field, !Boolean(value))} aria-pressed={Boolean(value)}><i /></button>
                            ) : (
                              <input type={field.secret ? 'password' : 'text'} value={inputValue(value)} onChange={(event) => update(platform.key, field, field.type === 'csv' ? csvValue(event.target.value) : event.target.value)} placeholder={field.placeholder || field.label} />
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <div className="platform-actions">
                      <button className="send-btn" onClick={() => void savePlatform(platform.key)} disabled={saving === platform.key || !hasChanges}>{saving === platform.key ? '保存中' : '保存'}</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
    {weixinQr.status !== 'idle' && <WeixinQrDialog state={weixinQr} onClose={closeWeixinQrLogin} onRetry={() => void startWeixinQrLogin()} />}
    </>
  );
}

const emptyMcpForm: McpFormState = { name: '', transport: 'stdio', command: '', argsText: '', envText: '', url: '', headersText: '', auth: '', enabled: true };

function textFromRecord(record?: Record<string, string>) {
  return Object.entries(record || {}).map(([key, value]) => `${key}=${value}`).join('\n');
}

function mcpFormFromServer(server: McpServer): McpFormState {
  return {
    name: server.name,
    transport: server.transport || (server.url ? 'http' : 'stdio'),
    command: server.command || '',
    argsText: (server.args || []).join('\n'),
    envText: textFromRecord(server.env),
    url: server.url || '',
    headersText: textFromRecord(server.headers),
    auth: server.auth || '',
    enabled: server.enabled !== false,
  };
}

function mcpPayloadFromForm(form: McpFormState) {
  return {
    name: form.name.trim(),
    transport: form.transport,
    command: form.command.trim(),
    args: form.argsText.split('\n').map((item) => item.trim()).filter(Boolean),
    env: form.envText,
    url: form.url.trim(),
    headers: form.headersText,
    auth: form.auth.trim(),
    enabled: form.enabled,
  };
}

function McpSettingsPage({ profiles, defaultProfile }: { profiles: HermesProfile[]; defaultProfile: string }) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [payload, setPayload] = useState<McpServersPayload | null>(null);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [form, setForm] = useState<McpFormState>(emptyMcpForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installingWorkbench, setInstallingWorkbench] = useState(false);
  const [testing, setTesting] = useState('');
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function loadServers(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/servers?profile=${encodeURIComponent(nextProfile)}`);
      setPayload(data);
    } catch (err: any) {
      setError(err.message || 'MCP 服务器读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadServers(profile);
  }, [profile]);

  function startCreate() {
    setEditingName('');
    setForm(emptyMcpForm);
    setFormOpen(true);
  }

  function startEdit(server: McpServer) {
    setEditingName(server.name);
    setForm(mcpFormFromServer(server));
    setFormOpen(true);
  }

  async function saveServer() {
    setSaving(true);
    setError('');
    try {
      const body = mcpPayloadFromForm(form);
      const url = editingName
        ? `/api/hermes/mcp/servers/${encodeURIComponent(editingName)}?profile=${encodeURIComponent(profile)}`
        : `/api/hermes/mcp/servers?profile=${encodeURIComponent(profile)}`;
      const data = await requestJson<McpServersPayload>(url, { method: editingName ? 'PATCH' : 'POST', body: JSON.stringify(editingName ? { config: body } : body) });
      setPayload(data);
      setFormOpen(false);
      setEditingName('');
      setForm(emptyMcpForm);
    } catch (err: any) {
      setError(err.message || 'MCP 服务器保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleServer(server: McpServer) {
    const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/servers/${encodeURIComponent(server.name)}?profile=${encodeURIComponent(profile)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    setPayload(data);
  }

  async function deleteServer(server: McpServer) {
    if (!window.confirm(`删除 MCP Server「${server.name}」？`)) return;
    const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/servers/${encodeURIComponent(server.name)}?profile=${encodeURIComponent(profile)}`, { method: 'DELETE' });
    setPayload(data);
  }

  async function testServer(server: McpServer) {
    setTesting(server.name);
    setTestResult((current) => ({ ...current, [server.name]: '' }));
    try {
      const data = await requestJson<{ ok: boolean; tools?: string[]; output?: string }>(`/api/hermes/mcp/servers/${encodeURIComponent(server.name)}/test?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
      setTestResult((current) => ({ ...current, [server.name]: `连接成功 · ${(data.tools || []).length} 个工具` }));
    } catch (err: any) {
      setTestResult((current) => ({ ...current, [server.name]: err.message || '测试失败' }));
    } finally {
      setTesting('');
    }
  }

  async function reloadMcp() {
    try {
      const data = await requestJson<{ runtime?: McpServersPayload; error?: string }>(`/api/hermes/mcp/reload?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
      if (data.runtime) setPayload(data.runtime);
      if (data.error) setError(data.error);
    } catch (err: any) {
      setError(err.message || 'MCP 重载失败');
    }
  }

  async function installWorkbenchMcp() {
    setInstallingWorkbench(true);
    setError('');
    try {
      const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/workbench/install?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
      setPayload(data);
      setTestResult((current) => ({ ...current, 'hermes-workbench-api': '已安装 Frakio Work 内置 MCP', 'hermes-workbench-use': '已安装 Frakio Work 内置 MCP' }));
    } catch (err: any) {
      setError(err.message || 'Frakio Work 内置 MCP 安装失败');
    } finally {
      setInstallingWorkbench(false);
    }
  }

  const stats = payload?.stats || { total: 0, connected: 0, disconnected: 0, tools: 0 };
  const normalizedQuery = query.trim().toLowerCase();
  const servers = (payload?.servers || []).filter((server) => {
    const haystack = [server.name, server.command, server.url, server.statusLabel, ...(server.tools || [])].join(' ').toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });

  return (
    <section className="embedded-management-page mcp-page">
      <div className="studio-toolbar settings-head">
        <div><h2>MCP 服务器</h2></div>
        <div className="mcp-toolbar-actions">
          <label>Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
          <button className="secondary-btn" onClick={() => void loadServers(profile)} disabled={loading}><RefreshCw size={15} />刷新</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="plugin-stats mcp-stats">
        <article><span>总计</span><strong>{stats.total}</strong><small>配置的服务器</small></article>
        <article><span>已连接</span><strong>{stats.connected}</strong><small>可识别工具</small></article>
        <article><span>未连接</span><strong>{stats.disconnected}</strong><small>停用或待重载</small></article>
        <article><span>工具</span><strong>{stats.tools}</strong><small>当前可展示工具</small></article>
      </div>
      <div className="plugin-toolbar">
        <label className="plugin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索服务器或工具" />
        </label>
        <div className="mcp-toolbar-actions">
          <button className="secondary-btn" onClick={() => void installWorkbenchMcp()} disabled={installingWorkbench}>{installingWorkbench ? '安装中' : '安装 Frakio Work 内置 MCP'}</button>
          <button className="secondary-btn" onClick={() => void reloadMcp()}>全部重载</button>
          <button className="send-btn" onClick={startCreate}><Plus size={15} />添加服务器</button>
        </div>
      </div>
      {formOpen && (
        <div className="mcp-form">
          <label>名称<input value={form.name} disabled={Boolean(editingName)} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="agentmail" /></label>
          <label>类型<select value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as 'stdio' | 'http' })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>
          {form.transport === 'stdio' ? <>
            <label>Command<input value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} placeholder="npx" /></label>
            <label className="wide">Args<textarea value={form.argsText} onChange={(event) => setForm({ ...form, argsText: event.target.value })} placeholder="-y&#10;agentmail-mcp" /></label>
            <label className="wide">Env<textarea value={form.envText} onChange={(event) => setForm({ ...form, envText: event.target.value })} placeholder="API_KEY=..." /></label>
          </> : <>
            <label className="wide">URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com/mcp" /></label>
            <label className="wide">Headers<textarea value={form.headersText} onChange={(event) => setForm({ ...form, headersText: event.target.value })} placeholder="Authorization=Bearer ..." /></label>
            <label>Auth<input value={form.auth} onChange={(event) => setForm({ ...form, auth: event.target.value })} placeholder="oauth" /></label>
          </>}
          <label className="mcp-check"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用</label>
          <div className="mcp-form-actions">
            <button className="secondary-btn" onClick={() => { setFormOpen(false); setEditingName(''); }}>取消</button>
            <button className="send-btn" onClick={() => void saveServer()} disabled={saving}>{saving ? '保存中' : '保存'}</button>
          </div>
        </div>
      )}
      {loading ? <div className="empty-state">读取 MCP 服务器中...</div> : servers.length ? (
        <div className="mcp-grid">
          {servers.map((server) => (
            <article className="mcp-card" key={server.name}>
              <div className="plugin-card-head">
                <div>
                  <strong>{server.name}</strong>
                  <span>{server.transport} · {server.command || server.url || '未配置入口'}</span>
                </div>
                <em className={server.enabled && server.status === 'connected' ? 'enabled' : ''}>{server.statusLabel}</em>
              </div>
              <div className="mcp-card-tools">
                <span>工具列表</span>
                <strong>{server.availableToolCount || server.toolCount}/{server.toolCount} 个工具</strong>
              </div>
              <div className="plugin-tags mcp-tools">
                {(server.tools || []).slice(0, 18).map((tool) => <span key={tool}>{tool}</span>)}
                {!server.tools?.length && <span>暂无工具列表</span>}
              </div>
              {(server.error || testResult[server.name]) && <p className="mcp-result">{testResult[server.name] || server.error}</p>}
              <div className="mcp-card-actions">
                <button onClick={() => startEdit(server)}>编辑</button>
                <button onClick={() => void testServer(server)} disabled={testing === server.name}>{testing === server.name ? '测试中' : '测试'}</button>
                <button onClick={() => void reloadMcp()}>重载</button>
                <button className="danger" onClick={() => void deleteServer(server)}>移除</button>
                <label className="mcp-switch"><input type="checkbox" checked={server.enabled} onChange={() => void toggleServer(server)} /><span /></label>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">暂无 MCP Server。</div>}
    </section>
  );
}

function JobsPage({ profiles, defaultProfile, embedded = false }: { profiles: HermesProfile[]; defaultProfile: string; embedded?: boolean }) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [jobs, setJobs] = useState<HermesJob[]>([]);
  const [form, setForm] = useState({ name: '', schedule: '', prompt: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadJobs(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ jobs: HermesJob[] }>(`/api/hermes/jobs?include_disabled=true&profile=${encodeURIComponent(nextProfile)}`);
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || '定时任务读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs(profile);
  }, [profile]);

  async function createJob() {
    if (!form.schedule.trim()) return;
    await requestJson(`/api/hermes/jobs?profile=${encodeURIComponent(profile)}`, { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', schedule: '', prompt: '' });
    await loadJobs(profile);
  }

  async function jobAction(job: HermesJob, action: 'run' | 'pause' | 'resume' | 'delete') {
    const method = action === 'delete' ? 'DELETE' : 'POST';
    const suffix = action === 'delete' ? '' : `/${action}`;
    await requestJson(`/api/hermes/jobs/${encodeURIComponent(job.job_id || job.id)}${suffix}?profile=${encodeURIComponent(profile)}`, { method });
    await loadJobs(profile);
  }

  const runHistory = jobs.filter((job) => job.last_run_at || job.last_status || job.last_error);

  return (
    <section className={embedded ? 'embedded-management-page' : 'management-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>定时任务</h2></div>
        <label>Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="create-strip">
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="任务名称" />
        <input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="30m / every 2h / 0 9 * * *" />
        <input value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} placeholder="执行提示词" />
        <button className="send-btn" onClick={() => void createJob()}>创建任务</button>
      </div>
      {loading ? <div className="empty-state">读取定时任务中...</div> : jobs.length ? (
        <div className="job-list">
          {jobs.map((job) => (
            <article className="job-card" key={job.job_id || job.id}>
              <div><strong>{job.name}</strong><span>{job.schedule_display || '未设置时间'} · {job.state}</span><p>{job.prompt_preview || job.prompt || '无提示词'}</p></div>
              <div className="job-actions">
                <button className="secondary-btn" onClick={() => void jobAction(job, 'run')}>运行</button>
                <button className="secondary-btn" onClick={() => void jobAction(job, job.enabled ? 'pause' : 'resume')}>{job.enabled ? '暂停' : '恢复'}</button>
                <button className="secondary-btn danger" onClick={() => void jobAction(job, 'delete')}>删除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">暂无定时任务。</div>}
      <section className="job-history-panel">
        <h3>运行历史</h3>
        {runHistory.length ? runHistory.map((job) => (
          <article className="job-history-row" key={`${job.job_id || job.id}-history`}>
            <strong>{job.name}</strong>
            <span>{job.last_status || 'unknown'} · {job.last_run_at || '未记录时间'}</span>
            {job.last_error && <p>{job.last_error}</p>}
          </article>
        )) : <div className="empty-state">暂无运行历史。</div>}
      </section>
    </section>
  );
}

const kanbanStatusLabels: Record<KanbanTaskStatus, string> = {
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
const kanbanStatusOrder = Object.keys(kanbanStatusLabels) as KanbanTaskStatus[];

function KanbanPage({ agents }: { agents: Agent[] }) {
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [board, setBoard] = useState('default');
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [boardForm, setBoardForm] = useState({ slug: '', name: '' });
  const [stats, setStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [boardComposerOpen, setBoardComposerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [taskComment, setTaskComment] = useState('');

  async function loadBoards() {
    try {
      const data = await requestJson<{ boards: KanbanBoard[] }>('/api/hermes/kanban/boards');
      setBoards(data.boards?.length ? data.boards : [{ slug: 'default', name: 'Default', total: 0 }]);
    } catch (err: any) {
      setError(err.message || '看板读取失败');
    }
  }

  async function loadTasks(nextBoard = board, silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const [taskData, statsData] = await Promise.all([
        requestJson<{ tasks: KanbanTask[] }>(`/api/hermes/kanban/tasks?board=${encodeURIComponent(nextBoard)}&includeArchived=true`),
        requestJson<{ stats: Record<string, any> }>(`/api/hermes/kanban/stats?board=${encodeURIComponent(nextBoard)}`),
      ]);
      const data = taskData;
      setTasks(data.tasks || []);
      setStats(statsData.stats || {});
    } catch (err: any) {
      if (!silent) setError(err.message || '任务读取失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadBoards();
  }, []);

  useEffect(() => {
    void loadTasks(board);
    const timer = window.setInterval(() => void loadTasks(board, true), 2000);
    return () => window.clearInterval(timer);
  }, [board]);

  useEffect(() => {
    if (!selectedTask) {
      setTaskDetail(null);
      return;
    }
    void requestJson<{ detail: any }>(`/api/hermes/kanban/tasks/${encodeURIComponent(selectedTask.id)}?board=${encodeURIComponent(board)}`)
      .then((data) => setTaskDetail(data.detail))
      .catch((err) => setError(err.message || '任务详情读取失败'));
  }, [selectedTask?.id, board]);

  async function createBoard() {
    if (!boardForm.slug.trim()) return;
    await requestJson('/api/hermes/kanban/boards', { method: 'POST', body: JSON.stringify(boardForm) });
    setBoard(boardForm.slug.trim());
    setBoardForm({ slug: '', name: '' });
    setBoardMenuOpen(false);
    setBoardComposerOpen(false);
    await loadBoards();
  }

  async function setTaskStatus(task: KanbanTask, status: KanbanTaskStatus) {
    await requestJson(`/api/hermes/kanban/tasks/${encodeURIComponent(task.id)}?board=${encodeURIComponent(board)}`, { method: 'PATCH', body: JSON.stringify({ board, status }) });
    await Promise.all([loadBoards(), loadTasks(board)]);
  }

  async function addTaskComment() {
    if (!selectedTask || !taskComment.trim()) return;
    await requestJson(`/api/hermes/kanban/tasks/${encodeURIComponent(selectedTask.id)}/comments`, { method: 'POST', body: JSON.stringify({ board, body: taskComment.trim(), author: 'user' }) });
    setTaskComment('');
    const data = await requestJson<{ detail: any }>(`/api/hermes/kanban/tasks/${encodeURIComponent(selectedTask.id)}?board=${encodeURIComponent(board)}`);
    setTaskDetail(data.detail);
  }

  async function archiveCurrentBoard() {
    if (board === 'default') return;
    await requestJson(`/api/hermes/kanban/boards/${encodeURIComponent(board)}`, { method: 'DELETE' });
    setBoard('default');
    await loadBoards();
  }

  const grouped = Object.fromEntries(kanbanStatusOrder.map((status) => [status, tasks.filter((task) => task.status === status)])) as Record<KanbanTaskStatus, KanbanTask[]>;
  const currentBoard = boards.find((item) => item.slug === board) || { slug: board, name: board === 'default' ? 'Default' : board, total: tasks.length };
  const boardTitle = currentBoard.name || currentBoard.slug;
  const visibleStatuses = kanbanStatusOrder.filter((status) => status !== 'archived' || grouped.archived.length > 0);
  const activeTaskCount = tasks.filter((task) => task.status !== 'archived').length;
  const statsEntries = kanbanStatusOrder
    .map((status) => ({ status, count: Number(stats.by_status?.[status] ?? grouped[status].length) }))
    .filter((item) => item.count > 0);

  return (
    <section className="management-page kanban-page">
      <div className="kanban-hero">
        <div className="kanban-title-stack">
          <span className="kanban-kicker">Hermes Kanban</span>
          <h2>{boardTitle}</h2>
        </div>
        <div className="kanban-top-actions">
          <AppPopover open={boardMenuOpen} onOpenChange={setBoardMenuOpen}>
            <div className="board-switcher">
              <AppPopoverTrigger asChild>
                <button className="notion-btn">
                  <Boxes size={15} /> 看板 <ChevronDown size={14} />
                </button>
              </AppPopoverTrigger>
              <AppPopoverContent className="board-popover-v2" side="bottom" align="end" aria-label="选择看板">
                <div className="board-popover-head">
                  <strong>所有看板</strong>
                  <span>{boards.length} 个</span>
                </div>
                <div className="board-list">
                  {boards.map((item) => {
                    const selected = item.slug === board;
                    return (
                      <button className={selected ? 'selected' : ''} key={item.slug} onClick={() => { setBoard(item.slug); setBoardMenuOpen(false); }}>
                        <span><Circle size={9} fill={selected ? 'currentColor' : 'none'} />{item.name || item.slug}</span>
                        <em>{item.total || 0}</em>
                      </button>
                    );
                  })}
                </div>
              </AppPopoverContent>
            </div>
          </AppPopover>
          <button className="send-btn kanban-new-board" onClick={() => setBoardComposerOpen((open) => !open)} aria-label="新建看板" title="新建看板"><Plus size={15} /> 新建看板</button>
          {board !== 'default' && <button className="secondary-btn" onClick={() => void archiveCurrentBoard()}><Archive size={14} />归档看板</button>}
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="kanban-status-strip">
        {statsEntries.length ? statsEntries.map((item) => <span className={`status-${item.status}`} key={item.status}><i />{kanbanStatusLabels[item.status]} {item.count}</span>) : <span><i />暂无任务</span>}
      </div>
      {boardComposerOpen && (
        <div className="kanban-board-composer">
          <input autoFocus value={boardForm.name} onChange={(event) => setBoardForm({ ...boardForm, name: event.target.value })} placeholder="看板名称" />
          <input value={boardForm.slug} onChange={(event) => setBoardForm({ ...boardForm, slug: event.target.value })} placeholder="board-slug" />
          <button className="send-btn" onClick={() => void createBoard()}>创建并进入</button>
          <button className="secondary-btn" onClick={() => { setBoardComposerOpen(false); setBoardForm({ slug: '', name: '' }); }}>取消</button>
        </div>
      )}
      {loading ? <div className="empty-state">读取看板中...</div> : (
        <div className="kanban-columns">
          {visibleStatuses.map((status) => (
            <section className={`kanban-column status-${status}`} key={status}>
              <header><strong><i />{kanbanStatusLabels[status]}</strong><span>{grouped[status].length}</span></header>
              {grouped[status].length ? grouped[status].map((task) => (
                <article className="kanban-card" key={task.id} onClick={() => setSelectedTask(task)} role="button" tabIndex={0}>
                  <strong>{task.title}</strong>
                  <p>{task.body || task.result || '无说明'}</p>
                  <div className="kanban-card-meta"><span>{task.assignee || '未分配'}</span><span>P{task.priority ?? 0}</span></div>
                  <div className="kanban-actions">
                    {task.status !== 'done' && <button onClick={(event) => { event.stopPropagation(); void setTaskStatus(task, 'done'); }}>完成</button>}
                    {task.status !== 'blocked' && <button onClick={(event) => { event.stopPropagation(); void setTaskStatus(task, 'blocked'); }}>阻塞</button>}
                    {task.status === 'blocked' && <button onClick={(event) => { event.stopPropagation(); void setTaskStatus(task, 'ready'); }}>恢复</button>}
                    {task.status !== 'archived' && <button onClick={(event) => { event.stopPropagation(); void setTaskStatus(task, 'archived'); }}>归档</button>}
                  </div>
                </article>
              )) : <div className="kanban-empty">暂无任务</div>}
            </section>
          ))}
        </div>
      )}
      {selectedTask && createPortal(
        <div className="modal-backdrop" onClick={() => setSelectedTask(null)}>
          <div className="modal kanban-task-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><h2>{selectedTask.title}</h2><p>{selectedTask.assignee || '未分配'} · {collaborationStatusLabel(selectedTask.status)}</p></div><button className="icon-btn" onClick={() => setSelectedTask(null)}><X size={18} /></button></div>
            <div className="kanban-task-detail-body">
              <section><h3>任务说明</h3><p>{selectedTask.body || taskDetail?.latest_summary || selectedTask.result || '暂无说明'}</p></section>
              <section className="kanban-task-relations"><h3>任务关系</h3><span>父任务：{taskDetail?.parents?.join('、') || '无'}</span><span>子任务：{taskDetail?.children?.join('、') || '无'}</span></section>
              <section><h3>运行历史</h3>{taskDetail?.runs?.length ? taskDetail.runs.slice(-8).reverse().map((run: any) => <div className="kanban-detail-row" key={run.id}><strong>{run.profile || 'worker'}</strong><span>{run.status} · {formatTime(run.started_at ? new Date(run.started_at * 1000).toISOString() : '')}</span><small>{run.summary || run.error || ''}</small></div>) : <div className="resource-empty">暂无运行记录</div>}</section>
              <section><h3>评论与交付</h3>{taskDetail?.comments?.map((comment: any) => <div className="kanban-detail-row" key={comment.id || `${comment.author}:${comment.created_at}`}><strong>{comment.author}</strong><span>{formatTime(comment.created_at ? new Date(comment.created_at * 1000).toISOString() : '')}</span><small>{comment.body}</small></div>)}<div className="kanban-comment-composer"><input value={taskComment} onChange={(event) => setTaskComment(event.target.value)} placeholder="添加评论…" /><button className="send-btn" onClick={() => void addTaskComment()} disabled={!taskComment.trim()}>发送</button></div></section>
            </div>
          </div>
        </div>, document.body)}
    </section>
  );
}

function RuntimeSwitcher({ thread, activeAgent, currentRuntimeId: runtimeIdOverride, isRunning, onRuntimeChange, onOpenRuntimeCenter }: {
  thread?: Pick<Thread, 'agentRuntimeOverrides'> | null;
  activeAgent: Agent | null;
  currentRuntimeId?: RuntimeId;
  isRunning: boolean;
  onRuntimeChange: (agentId: string, runtimeId: RuntimeId) => Promise<void>;
  onOpenRuntimeCenter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [runtimes, setRuntimes] = useState<RuntimeDefinition[]>(runtimeSeed);
  const policy = activeAgent?.runtimePolicy || { defaultRuntimeId: 'hermes', allowedRuntimeIds: ['hermes'], permissionProfileId: 'default' };
  const allowedRuntimeIdsKey = policy.allowedRuntimeIds.join('|');
  const currentRuntimeId = activeAgent ? runtimeIdOverride || thread?.agentRuntimeOverrides?.[activeAgent.id] || policy.defaultRuntimeId : 'hermes';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      const response = await fetch('/api/runtimes');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || cancelled) return;
      setRuntimes((current) => mergeRuntimeDefinitions(current, payload.runtimes || []));
      await Promise.all(allowedRuntimeIdsKey.split('|').filter(Boolean).map(async (runtimeId) => {
        const detected = await fetch(`/api/runtimes/${runtimeId}/detect`, { method: 'POST' }).then((item) => item.json()).catch(() => null);
        if (!cancelled && detected?.runtime) setRuntimes((current) => mergeRuntimeDefinitions(current, [detected.runtime]));
      }));
    };
    void refresh();
    return () => { cancelled = true; };
  }, [open, allowedRuntimeIdsKey]);

  const currentLabel = runtimeVisuals[currentRuntimeId]?.label || runtimeLabels[currentRuntimeId] || currentRuntimeId;
  const buttonLabel = activeAgent ? `切换 ${activeAgent.name} 的执行内核，当前为 ${currentLabel}` : '当前对话未选择 Agent';

  return <AppMenu open={open} onOpenChange={setOpen} modal={false}>
    <div className="runtime-switcher">
      <AppMenuTrigger asChild>
        <button className="runtime-switcher-trigger" disabled={!activeAgent} aria-expanded={open} aria-haspopup="dialog" aria-label={buttonLabel} title={buttonLabel}>
          <span className="runtime-switcher-mark">
            <RuntimeLabel runtimeId={currentRuntimeId} showName={false} />
            {isRunning && <LoaderCircle className="runtime-switcher-spinner spin" size={12} aria-label="运行中" />}
          </span>
        </button>
      </AppMenuTrigger>
    </div>
    <AppMenuContent className="runtime-switcher-popover" aria-label="切换执行内核" side="bottom" align="end">
      <div className="runtime-switcher-summary"><span>{activeAgent ? `${activeAgent.name} 的执行内核` : '执行内核'}</span></div>
      {activeAgent ? policy.allowedRuntimeIds.map((runtimeId) => {
        const runtime = runtimes.find((item) => item.id === runtimeId);
        const ready = isRuntimeReady(runtime);
        const selected = currentRuntimeId === runtimeId;
        return <AppMenuItem key={runtimeId} className={selected ? 'runtime-switcher-option selected' : 'runtime-switcher-option'} disabled={!ready} onSelect={() => {
          if (!ready || selected) return;
          void onRuntimeChange(activeAgent.id, runtimeId).then(() => setOpen(false));
        }} title={ready ? `切换到 ${runtimeLabels[runtimeId] || runtimeId}` : runtime?.installation?.detail || '请前往 Runtime Center 完成修复'}>
          <RuntimeLabel runtimeId={runtimeId} />
          {!ready && <em>{runtime?.installation?.status === 'checking' ? '检测中' : '不可用'}</em>}
          {ready && selected && <Check size={14} aria-hidden="true" />}
        </AppMenuItem>;
      }) : <span className="provider-model-empty">当前对话没有可切换的 Agent。</span>}
      <div className="runtime-switcher-footer">
        <small>切换会创建独立原生 Session，Frakio 对话保持连续。</small>
        <button onClick={() => { setOpen(false); onOpenRuntimeCenter(); }}>打开 Runtime Center</button>
      </div>
    </AppMenuContent>
  </AppMenu>;
}

function ThreadActionsMenu({ thread, workspace, vaults, activeVault, activeAgent, triggerVariant = 'icon', triggerTitle = '', onFollowModeChange, onCreateProjectThread, onConvertToProject, onVaultChange, onOpenAgents, onRenameThread, onRegenerateTitle }: {
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
    } catch (error) {
      setTitleError(error instanceof Error ? error.message : '自动生成标题失败。');
    } finally {
      setTitleBusy(false);
    }
  }

  return (
    <AppMenu open={open} onOpenChange={setOpen} modal={false}>
      <div className={triggerVariant === 'title' ? 'thread-actions-menu conversation-title-menu' : 'thread-actions-menu'}>
        <AppMenuTrigger asChild>
          <button className={triggerVariant === 'title' ? 'conversation-title-trigger' : 'top-icon-btn thread-actions-trigger'} aria-expanded={open} aria-controls={open ? popoverId : undefined} aria-haspopup="dialog" aria-label={triggerVariant === 'title' ? `对话设置：${triggerTitle}` : '对话设置'} title="对话设置">
            {triggerVariant === 'title' ? <><h1>{triggerTitle}</h1><ChevronDown size={14} aria-hidden="true" /></> : <MoreHorizontal size={18} />}
          </button>
        </AppMenuTrigger>
      </div>
      <AppMenuContent id={popoverId} className="thread-actions-popover-v2" aria-label="对话设置" side="bottom" align={triggerVariant === 'title' ? 'center' : 'end'}>
          <div className="thread-actions-summary">
            <strong>{followLabel} · {agentLabel}</strong>
            <span>{workspaceLabel}{activeVault ? ` · ${activeVault.name}` : ''}</span>
          </div>
          <div className="thread-menu-section thread-title-actions">
            <span>标题</span>
            <button onClick={() => { closeMenu(false); onRenameThread(); }}><span>重命名</span></button>
            <button disabled={titleBusy} onClick={() => void regenerateTitle()}><span>{titleBusy ? '正在生成…' : '重新生成标题'}</span></button>
            {titleError && <small className="thread-title-error" role="alert">{titleError}</small>}
          </div>
          <div className="thread-menu-section">
            <span>跟随</span>
            <button className={(thread.followMode || 'default') === 'default' ? 'selected' : ''} onClick={() => { closeMenu(false); void onFollowModeChange('default'); }}><span>默认跟随</span>{(thread.followMode || 'default') === 'default' && <Check size={14} aria-hidden="true" />}</button>
            <button className={thread.followMode === 'conversation' ? 'selected' : ''} onClick={() => { closeMenu(false); void onFollowModeChange('conversation'); }}><span>对话跟随</span>{thread.followMode === 'conversation' && <Check size={14} aria-hidden="true" />}</button>
          </div>
          <div className="thread-menu-section">
            <span>项目</span>
            {thread.mode === 'workspace' ? (
              <button onClick={() => { closeMenu(false); void onCreateProjectThread(); }}><Plus size={15} />新建项目对话</button>
            ) : (
              <button onClick={() => { closeMenu(false); onConvertToProject(); }}><FolderOpen size={15} />转为项目</button>
            )}
          </div>
          <label className="thread-menu-select">
            <span>资料库</span>
            <select value={thread.vaultId || ''} onChange={(event) => { closeMenu(false); void onVaultChange(event.target.value || null); }}>
              <option value="">不连接资料库</option>
              {vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
            </select>
          </label>
          <button className="thread-menu-wide" onClick={() => { closeMenu(false); onOpenAgents(); }}><UserPlus size={15} />团队成员</button>
      </AppMenuContent>
    </AppMenu>
  );
}

type ContextPanelProps = {
  contextPacket: ContextPacket | null;
  proposals: Proposal[];
  workspaceArtifacts: WorkArtifact[];
  thread: Thread | null;
  agents: Agent[];
  workspace: Workspace | null;
  isRunning: boolean;
  runApproval: HermesRunApproval | null;
  runClarification: HermesRunClarification | null;
  runError: string;
  runDraft: string;
};

function collaborationEventLabel(type: string) {
  const labels: Record<string, string> = {
    'workflow.created': '工作流已创建',
    'workflow.completed': '工作流已完成',
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
    'task.failed': '任务执行异常',
    'dependency.created': '新增任务依赖',
    'dependency.satisfied': '依赖已经满足',
    'artifact.published': '交付物已发布',
    'escalation.started': '阻塞已经升级',
    'escalation.resolved': '阻塞已经解决',
    'human.required': '需要人工介入',
    'intervention.sent': '用户已经介入',
    'mode.changed': '对话模式已切换',
    'plan.published': '执行方案已发布',
    'plan.revised': '执行方案已修订',
    'capability.blocked': '协作工具未加载',
  };
  return labels[type] || type;
}

function collaborationStatusLabel(status: KanbanTaskStatus) {
  return kanbanStatusLabels[status] || status;
}

function ChatCollaborationEvents({ thread }: { thread: Thread | null }) {
  const [events, setEvents] = useState<CollaborationEvent[]>(thread?.collaboration?.events || []);
  useEffect(() => {
    setEvents(thread?.collaboration?.events || []);
    if (!thread?.id) return undefined;
    void requestJson<{ snapshot: CollaborationSnapshot }>(`/api/threads/${thread.id}/collaboration`)
      .then((data) => setEvents(data.snapshot.events || []))
      .catch(() => {});
    const onSnapshot = (event: Event) => {
      const snapshot = (event as CustomEvent<CollaborationSnapshot>).detail;
      if (snapshot?.threadId === thread.id) setEvents(snapshot.events || []);
    };
    window.addEventListener('frakio:collaboration-snapshot', onSnapshot);
    return () => window.removeEventListener('frakio:collaboration-snapshot', onSnapshot);
  }, [thread?.id]);
  if ((thread?.executionMode || 'chat') !== 'work') return null;
  const highSignal = events.filter((event) => ['plan.published', 'plan.revised', 'workflow.paused', 'workflow.pause_failed', 'workflow.resumed', 'workflow.cancelled', 'task.waiting', 'task.resumed', 'task.completed', 'escalation.started', 'human.required', 'intervention.sent'].includes(event.type)).slice(-3);
  if (!highSignal.length) return null;
  return <div className="chat-collaboration-events">
    {highSignal.map((event) => <div className={event.type === 'human.required' || event.type === 'task.waiting' || event.type === 'workflow.pause_failed' ? 'waiting' : event.type === 'workflow.paused' ? 'paused' : event.type === 'workflow.cancelled' ? 'cancelled' : ''} key={event.id}>
      <span><Activity size={14} /></span>
      <span><strong>{event.title || collaborationEventLabel(event.type)}</strong><small>{event.type.startsWith('plan.') ? `${event.payload?.taskCount || 0} 项任务 · ${(event.payload?.agentIds || []).length} 位 Agent${event.detail ? ` · ${event.detail}` : ''}` : event.detail || collaborationEventLabel(event.type)}</small></span>
    </div>)}
  </div>;
}

function IconTooltipButton({
  active,
  ariaLabel,
  badge,
  children,
  className = '',
  hoverDelayMs = 0,
  onClick,
  placement = 'bottom',
  tooltip,
  ...buttonProps
}: {
  active?: boolean;
  ariaLabel: string;
  badge?: number;
  children: React.ReactNode;
  className?: string;
  hoverDelayMs?: number;
  placement?: 'top' | 'bottom';
  tooltip: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'className' | 'title'>) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const tooltipId = useId();
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);
  const shown = Boolean(tooltipPosition);

  const updateTooltipPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const resolvedPlacement = placement === 'top' && rect.top < 44 ? 'bottom' : placement;
    setTooltipPosition({
      left: Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2)),
      top: resolvedPlacement === 'top' ? rect.top - 8 : rect.bottom + 8,
      placement: resolvedPlacement,
    });
  }, [placement]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const hideTooltip = useCallback(() => {
    clearHoverTimer();
    setTooltipPosition(null);
  }, [clearHoverTimer]);

  const showTooltipAfterDelay = useCallback(() => {
    clearHoverTimer();
    if (hoverDelayMs <= 0) {
      updateTooltipPosition();
      return;
    }
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      updateTooltipPosition();
    }, hoverDelayMs);
  }, [clearHoverTimer, hoverDelayMs, updateTooltipPosition]);

  useEffect(() => {
    if (!shown) return undefined;
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    return () => {
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('scroll', hideTooltip, true);
    };
  }, [hideTooltip, shown]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node || !tooltipPosition) return;
    const halfWidth = node.offsetWidth / 2;
    const nextLeft = Math.min(window.innerWidth - 12 - halfWidth, Math.max(12 + halfWidth, tooltipPosition.left));
    if (Math.abs(nextLeft - tooltipPosition.left) < 0.5) return;
    setTooltipPosition((current) => current ? { ...current, left: nextLeft } : current);
  }, [tooltip, tooltipPosition]);

  return (
    <>
      <button
        {...buttonProps}
        ref={buttonRef}
        className={`${className}${active ? ' active' : ''}`}
        onBlur={hideTooltip}
        onClick={(event) => {
          hideTooltip();
          onClick?.(event);
        }}
        onFocus={updateTooltipPosition}
        onMouseEnter={showTooltipAfterDelay}
        onMouseLeave={hideTooltip}
        aria-label={ariaLabel}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        type="button"
      >
        {children}
        {badge ? <em>{badge}</em> : null}
      </button>
      {tooltipPosition && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className={`icon-tooltip placement-${tooltipPosition.placement}`}
          role="tooltip"
          style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
        >
          {tooltip}
        </div>,
        document.body,
      )}
    </>
  );
}

function CollaborationRuntimeErrorCard({ error, loading, onRetry }: {
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
  return <div className="collaboration-runtime-error" role="alert">
    <div><ShieldAlert size={18} /><span><strong>协作运行时未准备好</strong><small>{error.message}</small></span></div>
    <button type="button" disabled={loading} onClick={onRetry}>{loading ? '正在加载' : '重新加载'}</button>
    {(error.code || detailLines.length > 0) && <details><summary>技术详情</summary><pre>{[error.code || '', ...detailLines].filter(Boolean).join('\n')}</pre></details>}
  </div>;
}

function CollaborationContextPanel(props: ContextPanelProps & {
  fallbackDecisionAgentId: string;
  collaborationModeError: { message: string; code?: string; details?: Record<string, any> } | null;
  collaborationModeLoading: boolean;
  onRetryCollaboration: () => void;
  panelTab: 'collaboration' | 'resources';
  onPanelTabChange: (tab: 'collaboration' | 'resources') => void;
}) {
  const { thread, agents } = props;
  const panelTab = props.panelTab;
  const [view, setView] = useState<'relations' | 'activity'>('relations');
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [intervention, setIntervention] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState('');
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overview, setOverview] = useState<Array<CollaborationWorkflowSnapshot & { threadId: string; threadTitle: string }>>([]);
  const [controlMenuOpen, setControlMenuOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [workflowControlBusy, setWorkflowControlBusy] = useState<'pause' | 'resume' | 'cancel' | ''>('');
  const [workflowControlError, setWorkflowControlError] = useState('');
  const [workerOutputMode, setWorkerOutputMode] = useState<'summary' | 'all'>(thread?.workerOutputMode === 'all' ? 'all' : 'summary');
  const cursorRef = useRef(0);
  const activeWorkflow = snapshot?.workflows.find((item) => item.id === snapshot.activeWorkflowId) || snapshot?.workflows[0] || null;
  const selectedTask = activeWorkflow?.tasks.find((task) => task.id === selectedTaskId) || null;

  async function loadSnapshot() {
    if (!thread?.id) return;
    try {
      const data = await requestJson<{ snapshot: CollaborationSnapshot }>(`/api/threads/${thread.id}/collaboration`);
      setSnapshot(data.snapshot);
      window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      cursorRef.current = Math.max(cursorRef.current, Number(data.snapshot.cursor || 0));
      setError('');
    } catch (err: any) {
      setError(err.message || '协作状态读取失败');
    }
  }

  useEffect(() => {
    setSnapshot(null);
    setSelectedTaskId('');
    setTaskDetail(null);
    setControlMenuOpen(false);
    setCancelConfirmOpen(false);
    setWorkflowControlBusy('');
    setWorkflowControlError('');
    setWorkerOutputMode(thread?.workerOutputMode === 'all' ? 'all' : 'summary');
    cursorRef.current = 0;
    void loadSnapshot();
  }, [thread?.id, thread?.executionMode]);

  useEffect(() => {
    if (props.collaborationModeLoading || props.collaborationModeError) props.onPanelTabChange('collaboration');
  }, [props.collaborationModeLoading, props.collaborationModeError]);

  useEffect(() => {
    if (!controlMenuOpen && !cancelConfirmOpen) return undefined;
    const closeControls = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape' || workflowControlBusy) return;
      } else if ((event.target as HTMLElement | null)?.closest('.collaboration-workflow-more, .collaboration-cancel-modal')) {
        return;
      }
      setControlMenuOpen(false);
      if (!workflowControlBusy) setCancelConfirmOpen(false);
    };
    document.addEventListener('keydown', closeControls);
    document.addEventListener('pointerdown', closeControls);
    return () => {
      document.removeEventListener('keydown', closeControls);
      document.removeEventListener('pointerdown', closeControls);
    };
  }, [controlMenuOpen, cancelConfirmOpen, workflowControlBusy]);

  useEffect(() => {
    if (!thread?.id) return undefined;
    const query = new URLSearchParams({ afterCursor: String(cursorRef.current) });
    const stream = new EventSource(`/api/threads/${thread.id}/collaboration/events?${query.toString()}`);
    const onSnapshot = (event: MessageEvent) => {
      try {
        const next = JSON.parse(event.data) as CollaborationSnapshot;
        const previousCursor = cursorRef.current;
        setSnapshot(next);
        window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: next }));
        cursorRef.current = Math.max(cursorRef.current, Number(next.cursor || 0));
        if (next.cursor > previousCursor && next.events.some((item) => item.cursor > previousCursor && ['task.completed', 'workflow.completed', 'workflow.paused', 'workflow.resumed', 'workflow.cancelled'].includes(item.type))) {
          window.dispatchEvent(new CustomEvent('frakio:thread-refresh-request', { detail: { threadId: next.threadId } }));
        }
        setError('');
      } catch {
        setError('协作实时数据无法解析');
      }
    };
    stream.addEventListener('collaboration.snapshot', onSnapshot as EventListener);
    for (const type of ['workflow.created', 'workflow.completed', 'workflow.pause_started', 'workflow.paused', 'workflow.pause_failed', 'workflow.resume_started', 'workflow.resumed', 'workflow.cancelled', 'workflow.archived', 'mode.changed', 'plan.published', 'plan.revised', 'capability.blocked', 'task.created', 'task.started', 'task.waiting', 'task.resumed', 'task.completed', 'task.failed', 'dependency.created', 'dependency.satisfied', 'artifact.published', 'escalation.started', 'escalation.resolved', 'human.required', 'intervention.sent']) {
      stream.addEventListener(type, (event: MessageEvent) => {
        try {
          const next = JSON.parse(event.data) as CollaborationEvent;
          cursorRef.current = Math.max(cursorRef.current, Number(next.cursor || 0));
          setSnapshot((current) => current ? { ...current, cursor: Math.max(current.cursor, next.cursor), events: [...current.events.filter((item) => item.id !== next.id), next].slice(-200) } : current);
        } catch { /* the next snapshot repairs malformed event payloads */ }
      });
    }
    stream.onerror = () => setError('实时连接正在重连…');
    return () => stream.close();
  }, [thread?.id]);

  useEffect(() => {
    if (!selectedTaskId || !activeWorkflow) {
      setTaskDetail(null);
      return;
    }
    void requestJson<{ detail: any }>(`/api/hermes/kanban/tasks/${encodeURIComponent(selectedTaskId)}?board=${encodeURIComponent(activeWorkflow.boardSlug)}`)
      .then((data) => setTaskDetail(data.detail))
      .catch(() => setTaskDetail(null));
  }, [selectedTaskId, activeWorkflow?.boardSlug, activeWorkflow?.tasks.length]);

  useEffect(() => {
    if (!selectedTask) {
      setReassignAgentId('');
      return;
    }
    const assignedAgent = agents.find((agent) => [agent.id, agent.name, agent.profileName].some((value) => Boolean(value && value === selectedTask.assignee)));
    setReassignAgentId(assignedAgent?.id || activeWorkflow?.coordinatorAgentId || agents[0]?.id || '');
  }, [selectedTask?.id, selectedTask?.assignee, activeWorkflow?.coordinatorAgentId, agents]);

  async function selectWorkflow(workflowId: string) {
    if (!thread) return;
    await requestJson(`/api/threads/${thread.id}/collaboration/workflows/${workflowId}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
    setSnapshot((current) => current ? { ...current, activeWorkflowId: workflowId } : current);
    setSelectedTaskId('');
  }

  async function controlWorkflow(action: 'pause' | 'resume' | 'cancel') {
    if (!thread || !activeWorkflow || workflowControlBusy) return;
    setWorkflowControlBusy(action);
    setWorkflowControlError('');
    setControlMenuOpen(false);
    window.dispatchEvent(new CustomEvent('frakio:workflow-control-busy', { detail: { threadId: thread.id, busy: true } }));
    try {
      const data = await requestJson<{ snapshot: CollaborationSnapshot }>(`/api/threads/${thread.id}/collaboration/workflows/${activeWorkflow.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: `${action}:${globalThis.crypto.randomUUID()}` }),
      });
      setSnapshot(data.snapshot);
      window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: data.snapshot }));
      setCancelConfirmOpen(false);
    } catch (err: any) {
      setWorkflowControlError(err.message || '工作流控制失败');
      await loadSnapshot();
    } finally {
      setWorkflowControlBusy('');
      window.dispatchEvent(new CustomEvent('frakio:workflow-control-busy', { detail: { threadId: thread.id, busy: false } }));
    }
  }

  async function sendIntervention(action: 'message' | 'pause' | 'resume' | 'reassign' | 'human_required' = 'message', targetAgentId = '') {
    if (!thread || !activeWorkflow || !selectedTaskId) return;
    setBusy(action);
    try {
      await requestJson(`/api/threads/${thread.id}/collaboration/interventions`, {
        method: 'POST',
        body: JSON.stringify({ workflowId: activeWorkflow.id, taskId: selectedTaskId, action, message: intervention.trim(), reason: intervention.trim(), targetAgentId }),
      });
      setIntervention('');
      await loadSnapshot();
    } catch (err: any) {
      setError(err.message || '介入失败');
    } finally {
      setBusy('');
    }
  }

  async function openOverview() {
    setOverviewOpen(true);
    try {
      const data = await requestJson<{ workflows: Array<CollaborationWorkflowSnapshot & { threadId: string; threadTitle: string }> }>('/api/collaboration/overview');
      setOverview(data.workflows || []);
    } catch (err: any) {
      setError(err.message || '全局总览读取失败');
    }
  }

  async function toggleWorkerOutputMode() {
    if (!thread) return;
    const next = workerOutputMode === 'summary' ? 'all' : 'summary';
    try {
      await requestJson(`/api/threads/${thread.id}`, { method: 'PATCH', body: JSON.stringify({ workerOutputMode: next }) });
      setWorkerOutputMode(next);
    } catch (err: any) {
      setError(err.message || '成员输出设置失败');
    }
  }

  const activeTasks = activeWorkflow?.tasks.filter((task) => task.status !== 'archived') || [];
  const activeTaskCount = activeTasks.filter((task) => !['done', 'archived'].includes(task.status)).length;
  const doneCount = activeTasks.filter((task) => task.status === 'done').length;
  const dependencyByTask = new Map((snapshot?.events || []).filter((event) => event.type === 'dependency.created').map((event) => [event.taskId, event.payload?.parentTaskId]));
  const waitingCount = activeTasks.filter((task) => task.status === 'blocked' || task.status === 'todo' || (dependencyByTask.has(task.id) && task.status !== 'done')).length;
  const workflowControlState = activeWorkflow?.control?.state || 'idle';
  const workflowPaused = activeWorkflow?.status === 'paused';
  const workflowCancelled = activeWorkflow?.status === 'cancelled';
  const workflowCompleted = activeWorkflow?.status === 'completed';
  const workflowPauseFailed = workflowControlState === 'pause_failed';
  const workflowControlPending = Boolean(workflowControlBusy) || ['pausing', 'resuming', 'cancelling'].includes(workflowControlState);
  const taskControlsDisabled = workflowPaused || workflowCancelled || workflowControlPending || workflowPauseFailed;

  return (
    <div className="context-inner collaboration-context-panel">
      <div className="context-panel-tabs">
        <IconTooltipButton
          active={panelTab === 'collaboration'}
          ariaLabel="协作"
          badge={activeTaskCount}
          className="context-panel-tab"
          onClick={() => props.onPanelTabChange('collaboration')}
          tooltip="协作"
        >
          <Network size={15} />
        </IconTooltipButton>
        <IconTooltipButton
          active={panelTab === 'resources'}
          ariaLabel="资源"
          className="context-panel-tab"
          onClick={() => props.onPanelTabChange('resources')}
          tooltip="资源"
        >
          <FolderOpen size={15} />
        </IconTooltipButton>
      </div>
      {panelTab === 'resources' ? <CodexResourcePanel {...props} /> : (
        <div className="collaboration-panel-body">
          <div className="collaboration-panel-head">
            <div><small>{(thread?.executionMode || 'chat') === 'work' ? '协作执行' : activeWorkflow ? '后台 Work' : 'Chat 模式'}</small><strong>{activeWorkflow?.name || ((thread?.executionMode || 'chat') === 'work' ? '正在准备工作流' : '当前不接入任务看板')}</strong></div>
            <span className="collaboration-head-actions">{(thread?.executionMode || 'chat') === 'work' && <button className="worker-output-toggle" onClick={() => void toggleWorkerOutputMode()} title="切换成员输出展示">{workerOutputMode === 'summary' ? '摘要' : '全部'}</button>}<button className="top-icon-btn" onClick={() => void openOverview()} title="全局总览"><Boxes size={16} /></button></span>
          </div>
          {props.collaborationModeLoading && <div className="collaboration-runtime-loading"><LoaderCircle size={18} className="spin" /><span>正在准备协作运行时…</span></div>}
          {props.collaborationModeError && <CollaborationRuntimeErrorCard error={props.collaborationModeError} loading={props.collaborationModeLoading} onRetry={props.onRetryCollaboration} />}
          {snapshot?.workflows.length ? (
            <div className="collaboration-workflow-toolbar">
              <select className="collaboration-workflow-select" value={activeWorkflow?.id || ''} onChange={(event) => void selectWorkflow(event.target.value)} disabled={workflowControlPending}>
                {snapshot.workflows.filter((workflow) => workflow.status !== 'archived').map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name} · {workflow.status}</option>)}
              </select>
              {activeWorkflow && !workflowCancelled && !workflowCompleted && <button className={`collaboration-workflow-control ${workflowPaused ? 'resume' : ''}`} disabled={workflowControlPending} onClick={() => void controlWorkflow(workflowPaused ? 'resume' : 'pause')} aria-label={workflowPaused ? '恢复当前工作流的全部任务' : '暂停当前工作流的全部任务'} title={workflowPaused ? '恢复当前工作流的全部任务' : '暂停当前工作流的全部任务'}>
                {workflowControlPending && workflowControlBusy !== 'cancel' ? <LoaderCircle className="spin" size={15} /> : workflowPaused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
              </button>}
              {activeWorkflow && !workflowCancelled && <div className="collaboration-workflow-more">
                <button className="collaboration-workflow-control" disabled={workflowControlPending} onClick={() => setControlMenuOpen((open) => !open)} aria-label="更多工作流操作" title="更多工作流操作"><MoreHorizontal size={16} /></button>
                {controlMenuOpen && <div className="collaboration-workflow-menu"><button onClick={() => { setControlMenuOpen(false); setCancelConfirmOpen(true); }}>结束协作</button></div>}
              </div>}
            </div>
          ) : (
            <div className="collaboration-empty-start">
              {(thread?.executionMode || 'chat') === 'work' ? <Briefcase size={24} /> : <MessageSquare size={24} />}
              <strong>{(thread?.executionMode || 'chat') === 'work' ? '工作流正在准备' : '当前是 Chat 模式'}</strong>
              <p>{(thread?.executionMode || 'chat') === 'work' ? '创建完成后，发送第一条任务即可开始规划。' : '普通聊天和 @Agent 不会创建看板任务。需要协作执行时，在输入框下方切换到 Work。'}</p>
            </div>
          )}
          {activeWorkflow && <>
            {(workflowControlPending || workflowPaused || workflowPauseFailed || workflowCancelled) && <div className={`collaboration-workflow-state ${workflowPauseFailed ? 'failed' : workflowCancelled ? 'cancelled' : workflowPaused ? 'paused' : 'pending'}`}>
              {workflowControlPending && <LoaderCircle className="spin" size={15} />}
              <span><strong>{workflowControlBusy === 'pause' || workflowControlState === 'pausing' ? `正在停止 ${activeTasks.filter((task) => task.status === 'running').length} 个 Agent…` : workflowControlBusy === 'resume' || workflowControlState === 'resuming' ? '协调 Agent 正在应用你的补充' : workflowControlBusy === 'cancel' || workflowControlState === 'cancelling' ? '正在结束协作…' : workflowPauseFailed ? '暂停未完全生效' : workflowCancelled ? '协作已结束' : '全部任务已暂停'}</strong><small>{workflowPauseFailed ? `${activeWorkflow.control?.failedTaskIds.length || 0} 个任务仍未停止` : workflowPaused ? `${activeWorkflow.control?.heldInterventionCount || 0} 条补充指令已暂存` : workflowCancelled ? '已完成结果和运行记录仍可查看' : '正在保留任务现场'}</small></span>
              {workflowPauseFailed && <button disabled={Boolean(workflowControlBusy)} onClick={() => void controlWorkflow('pause')}>重试</button>}
            </div>}
            {workflowControlError && <div className="collaboration-workflow-control-error">{workflowControlError}</div>}
            <div className="collaboration-progress-copy"><strong>{doneCount} / {activeTasks.length} 已完成</strong><span>{waitingCount} 等待</span></div>
            <div className="collaboration-progress"><span style={{ width: `${activeTasks.length ? Math.round(doneCount / activeTasks.length * 100) : 0}%` }} /></div>
            <div className="collaboration-view-switch">
              <button className={view === 'relations' ? 'active' : ''} onClick={() => setView('relations')}>任务关系</button>
              <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>实时动态</button>
            </div>
            {view === 'relations' ? <>
              <div className="collaboration-task-list">
                {activeTasks.map((task) => {
                  const dependency = dependencyByTask.get(task.id);
                  const selected = task.id === selectedTaskId;
                  return <button className={`${selected ? 'selected ' : ''}${task.status === 'blocked' || dependency ? 'waiting ' : ''}${task.status === 'done' ? 'done' : ''}`} key={task.id} onClick={() => setSelectedTaskId(task.id)}>
                    <span className={`collaboration-task-dot status-${task.status}`} />
                    <span><strong>{task.title}</strong><small>{dependency ? `等待 ${dependency}` : `${task.assignee || '未分配'} · ${collaborationStatusLabel(task.status)}`}</small></span>
                    <ChevronRight size={14} />
                  </button>;
                })}
                {!activeTasks.length && <div className="resource-empty">发送任务后，协调 Agent 会在这里发布任务图。</div>}
              </div>
            </> : (
              <div className="collaboration-activity-list">
                {[...(snapshot?.events || [])].filter((event) => event.workflowId === activeWorkflow.id).reverse().map((event) => <button key={event.id} onClick={() => event.taskId && setSelectedTaskId(event.taskId)}>
                  <span className={`collaboration-event-dot ${event.type.includes('waiting') || event.type.includes('human') ? 'waiting' : event.type.includes('completed') || event.type.includes('resolved') ? 'done' : ''}`} />
                  <span><strong>{event.title || collaborationEventLabel(event.type)}</strong><small>{collaborationEventLabel(event.type)} · {formatTime(event.createdAt)}</small></span>
                </button>)}
                {!snapshot?.events.length && <div className="resource-empty">动态会在 Agent 开始协作后出现。</div>}
              </div>
            )}
            {selectedTask && <div className="collaboration-task-detail">
              <div className="collaboration-detail-title"><span><strong>{selectedTask.title}</strong><small>{collaborationStatusLabel(selectedTask.status)} · {selectedTask.assignee || '未分配'}</small></span><button className="top-icon-btn" onClick={() => setSelectedTaskId('')}><X size={14} /></button></div>
              {(taskDetail?.parents?.length || taskDetail?.children?.length) && <div className="collaboration-links"><span>依赖：{taskDetail.parents?.join('、') || '无'}</span><span>下游：{taskDetail.children?.join('、') || '无'}</span></div>}
              <p>{selectedTask.body || selectedTask.result || taskDetail?.latest_summary || '暂无任务说明'}</p>
              <textarea value={intervention} onChange={(event) => setIntervention(event.target.value)} placeholder="向当前任务发送指令…" rows={2} />
              <div className="collaboration-reassign">
                <select value={reassignAgentId} onChange={(event) => setReassignAgentId(event.target.value)} aria-label="转交给 Agent">
                  {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
                </select>
                <button disabled={!reassignAgentId || Boolean(busy) || taskControlsDisabled} onClick={() => void sendIntervention('reassign', reassignAgentId)}>转交</button>
              </div>
              <div className="collaboration-intervention-actions">
                {selectedTask.status === 'blocked' ? <button disabled={taskControlsDisabled} onClick={() => void sendIntervention('resume')}>恢复</button> : <button disabled={taskControlsDisabled} onClick={() => void sendIntervention('pause')}>暂停</button>}
                <button disabled={taskControlsDisabled} onClick={() => void sendIntervention('human_required')}>人工介入</button>
                <button className="send-btn" disabled={!intervention.trim() || Boolean(busy) || workflowCancelled} onClick={() => void sendIntervention('message')}><Send size={13} />发送</button>
              </div>
            </div>}
          </>}
          {error && <div className="resource-error">{error}</div>}
        </div>
      )}
      {overviewOpen && createPortal(
        <div className="modal-backdrop collaboration-overview-backdrop" onClick={() => setOverviewOpen(false)}>
          <div className="modal collaboration-overview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><h2>协作全局总览</h2><p>所有对话中的活动工作流和阻塞状态。</p></div><button className="icon-btn" onClick={() => setOverviewOpen(false)}><X size={18} /></button></div>
            <div className="collaboration-overview-grid">
              {overview.filter((workflow) => workflow.status !== 'archived').map((workflow) => {
                const tasks = workflow.tasks.filter((task) => task.status !== 'archived');
                const done = tasks.filter((task) => task.status === 'done').length;
                const blocked = tasks.filter((task) => task.status === 'blocked').length;
                const coordinator = agents.find((agent) => agent.id === workflow.coordinatorAgentId);
                return <article key={`${workflow.threadId}:${workflow.id}`}><header><span><small>{workflow.threadTitle}</small><strong>{workflow.name}</strong></span><em>{workflow.status}</em></header><div className="collaboration-overview-stats"><span>{done}/{tasks.length} 完成</span><span>{blocked} 阻塞</span><span>{coordinator?.name || '未指定协调人'}</span></div><div className="collaboration-progress"><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div></article>;
              })}
              {!overview.length && <div className="empty-state">暂无协作工作流。</div>}
            </div>
          </div>
        </div>, document.body)}
      {cancelConfirmOpen && activeWorkflow && createPortal(
        <div className="modal-backdrop nested" onClick={() => !workflowControlBusy && setCancelConfirmOpen(false)}>
          <div className="modal collaboration-cancel-modal" role="alertdialog" aria-modal="true" aria-labelledby="collaboration-cancel-title" onClick={(event) => event.stopPropagation()}>
            <div className="collaboration-cancel-body"><span className="collaboration-cancel-icon"><Square size={16} fill="currentColor" /></span><div><h2 id="collaboration-cancel-title">结束这次协作？</h2><p>所有未完成任务会被取消，工作流不能再次恢复。已完成结果、交付物和运行记录会保留。</p></div></div>
            <div className="collaboration-cancel-actions"><button disabled={Boolean(workflowControlBusy)} onClick={() => setCancelConfirmOpen(false)}>返回</button><button className="danger" disabled={Boolean(workflowControlBusy)} onClick={() => void controlWorkflow('cancel')}>{workflowControlBusy === 'cancel' && <LoaderCircle className="spin" size={14} />}结束协作</button></div>
          </div>
        </div>, document.body)}
    </div>
  );
}

function CodexResourcePanel({ contextPacket, proposals, workspaceArtifacts, thread, agents, workspace, isRunning, runApproval, runClarification, runError, runDraft }: ContextPanelProps) {
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
    ...proposals.slice(0, 4).map((proposal) => ({ id: proposal.id, kind: proposal.type, name: proposal.title, target: proposal.target, updatedAt: thread?.updatedAt })),
    ...(contextPacket ? [{ id: 'context-packet', kind: 'context', name: contextPacket.title || '上下文包', target: contextPacket.policy, updatedAt: thread?.updatedAt }] : []),
  ];
  const artifacts: WorkArtifact[] = [
    ...threadArtifacts,
    ...workspaceArtifacts.map((artifact) => ({ ...artifact, target: artifact.relativePath || artifact.path || artifact.target })),
  ].filter((artifact, index, all) => all.findIndex((item) => `${item.kind}:${item.name}:${item.target || ''}` === `${artifact.kind}:${artifact.name}:${artifact.target || ''}`) === index).slice(0, 10);

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
    const data = await fetch(`/api/workspaces/${workspace.id}/files/content?${query.toString()}`).then((res) => res.json()).catch((error) => ({ error: String(error) }));
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
          <button className="top-icon-btn" onClick={() => setPreview(null)} aria-label="返回资源列表" title="返回"><ArrowLeft size={17} /></button>
          <div>
            <strong>{preview?.name || '正在打开'}</strong>
            <span>{preview?.relativePath || '加载文件内容'}</span>
          </div>
          <button className="top-icon-btn" aria-label="打开外部文件" title="打开外部文件"><ExternalLink size={16} /></button>
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
        <div className="panel-title"><span><FileText size={15} />输出</span></div>
        <div className="artifact-list">
          {artifacts.length ? artifacts.map((artifact, index) => {
            const Icon = artifactIcon(artifact.kind);
            const previewPath = artifact.relativePath || artifact.target || '';
            return (
              <button className="artifact-row" key={`${artifact.name}-${index}`} aria-label={artifact.target || artifact.relativePath || artifact.path || artifact.name} title={artifact.target || artifact.relativePath || artifact.path || artifact.name} onClick={() => void openPreview(previewPath)}>
                <Icon size={15} />
                <span><strong>{artifact.name}</strong><small>{artifact.target || artifact.relativePath || artifact.path || '当前线程'}</small></span>
              </button>
            );
          }) : <div className="resource-empty">暂无产物</div>}
        </div>
      </section>

      {shouldShowTasks && (
        <section className="resource-section">
          <div className="panel-title"><span><PauseCircle size={15} />任务</span></div>
          <div className="task-list">
            {workflowState.map((item, index) => {
              const done = item.status === 'completed';
              const active = item.status === 'running';
              const failed = item.status === 'failed';
              const Icon = done ? CheckCircle2 : active ? Clock3 : Circle;
              return (
                <div className={`task-row ${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''}`} key={`${item.title}-${index}`}>
                  <Icon size={15} />
                  <span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="resource-section">
        <div className="panel-title"><span><FolderOpen size={15} />文件</span></div>
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
          ) : <div className="resource-empty">当前对话未绑定项目目录</div>}
        </div>
        {fileError && <div className="resource-error">{fileError}</div>}
      </section>

      {sourceDocs.length > 0 && (
        <section className="resource-section">
          <div className="panel-title"><span><Library size={15} />来源</span></div>
          <div className="source-list">
            {sourceDocs.map((doc) => <span key={doc}>{doc}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}

type ThreadOverviewRound = {
  id: string;
  startMessageId: string;
  title: string;
  summary: string;
  messageIds: string[];
  agentNames: string[];
};

function ThreadOverviewRail({ rounds, activeRoundId, onJumpToRound }: {
  rounds: ThreadOverviewRound[];
  activeRoundId: string;
  onJumpToRound: (roundId: string) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  if (!rounds.length) return null;
  const previewRound = hoveredIndex >= 0 ? rounds[hoveredIndex] || rounds[0] : null;

  return (
    <div className={`thread-overview-rail ${hoveredIndex >= 0 ? 'is-hovering' : ''}`} aria-label="对话概览" onMouseLeave={() => setHoveredIndex(-1)}>
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

function buildThreadOverviewRounds(messages: ChatEvent[]): ThreadOverviewRound[] {
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

function compactOverviewTitle(content: string) {
  const normalized = normalizeOverviewText(content);
  if (!normalized) return '新的问题';
  const sentence = normalized.split(/(?<=[。！？!?])\s*/)[0] || normalized;
  return sentence.length > 38 ? `${sentence.slice(0, 38)}...` : sentence;
}

function compactOverviewSnippet(content: string, maxLength = 86) {
  const normalized = normalizeOverviewText(content);
  if (!normalized) return '空消息';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function normalizeOverviewText(content: string) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' 代码片段 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function FileTree({ dir, depth, entriesByDir, expandedDirs, filter, onToggleDirectory, onOpenFile }: {
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
      {entries.filter((entry) => !normalizedFilter || entry.name.toLowerCase().includes(normalizedFilter) || entry.relativePath.toLowerCase().includes(normalizedFilter)).map((entry) => {
        const expanded = Boolean(expandedDirs[entry.relativePath]);
        const Icon = entry.kind === 'directory' ? Folder : iconForFileName(entry.name);
        return (
          <div className="file-tree-node" key={entry.relativePath}>
            <button className="file-tree-row" aria-label={entry.relativePath || entry.name} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => entry.kind === 'directory' ? void onToggleDirectory(entry) : void onOpenFile(entry.relativePath)} disabled={entry.kind === 'file' && !entry.previewable}>
              {entry.kind === 'directory' ? <ChevronRight className={expanded ? 'expanded' : ''} size={14} /> : <span className="file-indent" />}
              <Icon size={15} />
              <span>{entry.name}</span>
            </button>
            {entry.kind === 'directory' && expanded && <FileTree dir={entry.relativePath} depth={depth + 1} entriesByDir={entriesByDir} expandedDirs={expandedDirs} filter={filter} onToggleDirectory={onToggleDirectory} onOpenFile={onOpenFile} />}
          </div>
        );
      })}
    </>
  );
}

function FilePreview({ file }: { file: WorkspaceFileContent }) {
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

function artifactIcon(kind: string) {
  if (kind === 'context') return Library;
  if (kind === 'plan' || kind === 'document' || kind === 'report') return FileText;
  if (kind === 'data') return Boxes;
  if (kind === 'script') return Settings;
  if (kind === 'pdf') return FileText;
  return CheckCircle2;
}

function iconForFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return FileText;
  if (lower.endsWith('.json') || lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.py') || lower.endsWith('.css') || lower.endsWith('.html') || lower.endsWith('.yml') || lower.endsWith('.yaml')) return Code2;
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return Image;
  return File;
}

const defaultCouncilWorkflowTitles = ['Iris 接收需求', 'Max 拆解任务', '相关 Agent 协作', '生成待确认动作'];

function isLegacyDefaultWorkflow(steps: WorkflowStep[]) {
  if (steps.length !== defaultCouncilWorkflowTitles.length) return false;
  return steps.every((step, index) => step.title === defaultCouncilWorkflowTitles[index] && !step.source && !step.detail && !step.agentName);
}

function visibleWorkflowSteps(thread: Thread | null, live: { isRunning: boolean; runApproval: HermesRunApproval | null; runClarification: HermesRunClarification | null; runError: string; runDraft: string }): WorkflowStep[] {
  const liveSteps: WorkflowStep[] = [];
  if (live.isRunning) liveSteps.push({ title: 'Agent 正在执行', status: 'running', source: 'run', detail: live.runDraft ? '正在思考' : '' });
  if (live.runApproval) liveSteps.push({ title: live.runApproval.title || '等待确认', status: 'running', source: 'approval', detail: live.runApproval.command || live.runApproval.tool || '' });
  if (live.runClarification) liveSteps.push({ title: '等待你的选择', status: 'running', source: 'clarify', detail: live.runClarification.question, callId: live.runClarification.id });
  if (live.runError) liveSteps.push({ title: live.runError, status: 'failed', source: 'run' });
  if (liveSteps.length) return liveSteps;

  const steps = (Array.isArray(thread?.workflowState) ? thread.workflowState : []).filter((step) => step.source !== 'tool');
  if (!steps.length || isLegacyDefaultWorkflow(steps)) return [];
  const hasRealSignal = steps.some((step) => step.source || step.detail || step.agentName);
  if (!hasRealSignal && thread?.runStatus !== 'running') return [];
  return steps.map((step) => thread?.runStatus !== 'running' && step.status === 'running' ? { ...step, status: 'completed' } : step);
}

function PermissionModeControl({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }) {
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
            <span>{permissionLabel(value)}</span>
            <ChevronDown size={13} />
          </button>
        </AppMenuTrigger>
        <AppMenuContent id={menuId} className="permission-menu-v2" side="top" align="start" aria-label="操作权限选项">
          <div className="permission-menu-head">
            <strong>应如何批准 Hermes 操作？</strong>
            <a href="#settings" onClick={(event) => event.preventDefault()}>了解更多</a>
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
                <span><strong>{permissionLabel(mode)}</strong><small>{permissionDescription(mode)}</small></span>
                {selected && <CheckCircle2 size={18} />}
              </AppMenuItem>
            );
          })}
        </AppMenuContent>
      </div>
    </AppMenu>
  );
}

function ExecutionModeControl({ value, disabled, switching = false, onChange }: { value: 'chat' | 'work'; disabled?: boolean; switching?: boolean; onChange: (mode: 'chat' | 'work') => void }) {
  const [visualMode, setVisualMode] = useState<'chat' | 'work'>(value);
  const menuId = useId();
  const CurrentIcon = visualMode === 'work' ? Briefcase : MessageSquare;

  useEffect(() => {
    if (switching || visualMode === value) return;
    setVisualMode(value);
  }, [switching, value, visualMode]);

  function selectMode(mode: 'chat' | 'work') {
    if (disabled || switching) return;
    if (visualMode !== mode) setVisualMode(mode);
    if (value !== mode) onChange(mode);
  }

  return (
    <AppMenu modal={false}>
      <div className={`execution-mode-control is-${visualMode}${disabled ? ' is-disabled' : ''}`} data-mode={visualMode}>
        <AppMenuTrigger asChild>
          <button
            type="button"
            className="execution-mode-trigger"
            aria-label={`运行模式：${visualMode === 'work' ? 'Work' : 'Chat'}`}
            aria-busy={switching || undefined}
            disabled={disabled || switching}
            title={visualMode === 'work' ? 'Work：多 Agent 协作执行模式' : 'Chat：普通聊天模式'}
          >
            <CurrentIcon size={15} />
            <span>{visualMode === 'work' ? 'Work' : 'Chat'}</span>
            <ChevronDown size={13} />
          </button>
        </AppMenuTrigger>
        <AppMenuContent id={menuId} className="execution-mode-menu-v2" side="top" align="start" aria-label="选择对话运行模式">
          {(['chat', 'work'] as const).map((mode) => {
            const Icon = mode === 'work' ? Briefcase : MessageSquare;
            const selected = visualMode === mode;
            return (
              <AppMenuItem
                className={selected ? 'selected execution-mode-option' : 'execution-mode-option'}
                role="menuitemradio"
                aria-checked={selected}
                key={mode}
                onSelect={() => selectMode(mode)}
              >
                <Icon size={17} />
                <span><strong>{mode === 'work' ? 'Work' : 'Chat'}</strong><small>{mode === 'work' ? '多 Agent 协作执行' : '普通对话'}</small></span>
                {selected && <Check size={15} />}
              </AppMenuItem>
            );
          })}
        </AppMenuContent>
      </div>
    </AppMenu>
  );
}

function ComposerAddMenu({ planEnabled, planBusy, onAddFile, onEnablePlan }: {
  planEnabled: boolean;
  planBusy?: boolean;
  onAddFile: () => void;
  onEnablePlan: () => void;
}) {
  return (
    <AppMenu modal={false}>
      <AppMenuTrigger asChild>
        <button className="icon-btn composer-tool upload" type="button" aria-label="添加内容" title="添加内容"><Plus size={19} /></button>
      </AppMenuTrigger>
      <AppMenuContent className="composer-add-menu" side="top" align="start" aria-label="添加到对话">
        <AppMenuItem className="composer-add-option" onSelect={onAddFile}>
          <FileText size={14} />
          <span>添加文件</span>
        </AppMenuItem>
        <AppMenuItem className={planEnabled ? 'composer-add-option selected' : 'composer-add-option'} disabled={planEnabled || planBusy} onSelect={onEnablePlan}>
          <Lightbulb size={14} />
          <span>{planEnabled ? '计划模式已开启' : '计划模式'}</span>
          {planEnabled && <Check size={14} />}
        </AppMenuItem>
      </AppMenuContent>
    </AppMenu>
  );
}

function PlanModeIndicator({ busy, onClose }: { busy?: boolean; onClose: () => void }) {
  return (
    <span className="plan-mode-indicator">
      <Lightbulb size={14} aria-hidden="true" />
      <span>计划</span>
      <button type="button" disabled={busy} onClick={onClose} aria-label="关闭计划模式" title="关闭计划模式">
        {busy ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}
      </button>
    </span>
  );
}

function DecisionTray({
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
          {error ? <span className="decision-tray-error" role="alert">{error}</span> : <span />}
          {footer}
        </footer>
      )}
    </section>
  );
}

function DecisionPager({ index, count, disabled, onPrevious, onNext, onClose }: {
  index: number;
  count: number;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className="decision-pager" aria-label="问题导航">
      <button type="button" disabled={disabled || index <= 0} onClick={onPrevious} aria-label="上一题"><ChevronLeft size={15} /></button>
      <span>{index + 1} / {count}</span>
      <button type="button" disabled={disabled || index >= count - 1} onClick={onNext} aria-label="下一题"><ChevronRight size={15} /></button>
      <button type="button" disabled={disabled} onClick={onClose} aria-label="关闭当前问题"><X size={15} /></button>
    </div>
  );
}

function DecisionOptionRow({ number, label, description, recommended, active, selected, danger, disabled, role, onClick, onFocus }: {
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
      className={`decision-option-row${active ? ' active' : ''}${selected ? ' selected' : ''}${danger ? ' danger' : ''}`}
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

function DecisionOtherRow({ open, value, disabled, placeholder, onOpen, onChange, onSubmit, onClose }: {
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
        <span className="decision-other-icon"><Pencil size={14} /></span>
        <span>其他</span>
      </button>
    );
  }
  return (
    <div className="decision-other-input">
      <span className="decision-other-icon"><Pencil size={14} /></span>
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
      <button type="button" disabled={disabled || !value.trim()} onClick={onSubmit} aria-label="提交其他回答"><ChevronRight size={16} /></button>
    </div>
  );
}

function PlanQuestionPanel({ batch, submitting, error, onSubmit, onCancel }: {
  batch: PlanQuestionBatch;
  submitting: boolean;
  error?: string;
  onSubmit: (answers: Record<string, { selectedLabel?: string; note?: string }>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { selectedLabel?: string; note?: string }>>(batch.answers || {});
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
    const selectedIndex = Math.max(0, question.options.findIndex((option) => option.label === answer.selectedLabel));
    setActiveOptionIndex(selectedIndex);
    setOtherOpen(Boolean(answer.note && !answer.selectedLabel));
    const frame = window.requestAnimationFrame(() => {
      trayRef.current?.querySelectorAll<HTMLButtonElement>('.decision-option-row')[selectedIndex]?.focus();
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
    const firstUnanswered = batch.questions.findIndex((item) => {
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
    const option = question.options.find((item) => item.recommended) || question.options[0];
    if (option) commitAndAdvance({ selectedLabel: option.label });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
      const nextIndex = (activeOptionIndex + direction + question.options.length) % question.options.length;
      setActiveOptionIndex(nextIndex);
      trayRef.current?.querySelectorAll<HTMLButtonElement>('.decision-option-row')[nextIndex]?.focus();
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
      actions={(
        <DecisionPager
          index={index}
          count={batch.questions.length}
          disabled={submitting}
          onPrevious={() => setIndex((current) => Math.max(0, current - 1))}
          onNext={() => setIndex((current) => Math.min(batch.questions.length - 1, current + 1))}
          onClose={onCancel}
        />
      )}
      footer={<button type="button" className="decision-skip" disabled={submitting} onClick={skip}>{submitting ? '提交中…' : '跳过'}</button>}
    >
      {question.options.map((option, optionIndex) => (
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

function PlanCard({ plan, draft, agents, latest, readOnly = false, busy, feedbackOpen, feedback, error, onFeedbackChange, onOpenFeedback, onCloseFeedback, onSubmitFeedback, onExecute, onCancel }: {
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
  const waitingApproval = !readOnly && latest && plan.status === 'waiting_approval';
  const canExecute = !readOnly && latest && (plan.status === 'waiting_approval' || plan.status === 'failed');
  const visibleError = error || (plan.status === 'failed' ? plan.error : '');
  const statusLabel = readOnly ? '历史计划' : !latest ? '已被新版本替代' : ({
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
        <span className="plan-card-icon"><Lightbulb size={17} /></span>
        <div><small>{plan.targetExecutionMode === 'work' ? 'Work 计划' : 'Chat 计划'} · 第 {draft.revision} 版</small><h3>{draft.title}</h3></div>
        <span className={`plan-card-status status-${plan.status}`}>{statusLabel}</span>
      </header>
      <p className="plan-card-summary">{draft.summary}</p>
      <div className="plan-card-section">
        <strong>执行步骤</strong>
        <ol>
          {draft.steps.map((step) => {
            const assignee = step.assigneeAgentId ? agents.find((agent) => agent.id === step.assigneeAgentId) : null;
            return (
              <li key={step.key}>
                <div><b>{step.title}</b>{assignee && <span className="plan-assignee"><AgentAvatar agent={assignee} size="sm" />{assignee.name}</span>}</div>
                <p>{step.description}</p>
                {step.files.length > 0 && <small>{step.files.join(' · ')}</small>}
                {step.expectedResult && <em>结果：{step.expectedResult}</em>}
                {step.dependsOnKeys.length > 0 && <em>依赖：{step.dependsOnKeys.join('、')}</em>}
              </li>
            );
          })}
        </ol>
      </div>
      {draft.tests.length > 0 && <div className="plan-card-section compact"><strong>验证方式</strong><ul>{draft.tests.map((test) => <li key={test}>{test}</li>)}</ul></div>}
      {draft.assumptions.length > 0 && <div className="plan-card-section compact"><strong>假设</strong><ul>{draft.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>}
      {feedbackOpen && waitingApproval && (
        <div className="plan-feedback">
          <textarea autoFocus value={feedback} onChange={(event) => onFeedbackChange(event.target.value)} placeholder="说明需要调整的范围、顺序或取舍" rows={3} />
          <div>
            <button type="button" className="secondary-btn" disabled={busy} onClick={onCloseFeedback}>返回</button>
            <button type="button" className="send-btn" disabled={busy || !feedback.trim()} onClick={onSubmitFeedback}>提交修改</button>
          </div>
        </div>
      )}
      {visibleError && latest && <div className="plan-inline-error" role="alert">{visibleError}</div>}
      {canExecute && !feedbackOpen && (
        <footer>
          <button type="button" className="plan-cancel-btn" disabled={busy} onClick={onCancel}>取消</button>
          {waitingApproval && <button type="button" className="secondary-btn" disabled={busy} onClick={onOpenFeedback}>修改计划</button>}
          <button type="button" className="send-btn plan-execute-btn" disabled={busy} onClick={onExecute}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}{plan.status === 'failed' ? '重试执行' : '开始执行'}
          </button>
        </footer>
      )}
    </section>
  );
}

function modelRunReasoningLabel(value: string) {
  return ({ off: '关闭', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极致' } as Record<string, string>)[value] || value;
}

function MonitoringPage({ embedded = false }: { embedded?: boolean }) {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [moduleMode, setModuleMode] = useState<'skills' | 'plugins'>('skills');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('trend');
  const [loading, setLoading] = useState(false);
  const [providerFilter, setProviderFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [profileFilter, setProfileFilter] = useState('all');
  const [refreshMode, setRefreshMode] = useState<'30' | '0'>('30');
  const [rangeMode, setRangeMode] = useState<UsageRangeMode>('today');
  const allUsage = summary?.usage;
  const usageEntries = allUsage?.entries || [];
  const hasEntryData = usageEntries.length > 0;
  const rangeEntries = usageEntries.filter((entry) => {
    const time = new Date(entry.createdAt || '').getTime();
    return Number.isFinite(time) && time >= usageRangeStart(rangeMode);
  });
  const usageBySource = hasEntryData ? aggregateUsageSources(rangeEntries) : allUsage?.bySource || [];
  const usageByModel = hasEntryData ? aggregateUsageModels(rangeEntries) : allUsage?.byModel || [];
  const sourceOptions = usageBySource.map((row) => row.source).filter(Boolean);
  const modelOptions = usageByModel.filter((row) => row.requests > 0).map((row) => row.modelName).filter(Boolean);
  const profileOptions = Array.from(new Set((hasEntryData ? rangeEntries.map((entry) => entry.profileName || entry.agentNames?.[0] || '') : allUsage?.byProfile?.map((row) => row.profileName) || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const profileEntries = profileFilter === 'all' ? rangeEntries : rangeEntries.filter((entry) => (entry.profileName || entry.agentNames?.[0] || '') === profileFilter);
  const filteredEntries = filterEntriesBySelection(profileEntries, providerFilter, modelFilter);
  const filteredModels = (hasEntryData ? aggregateUsageModels(filteredEntries) : usageByModel.filter((row) => {
    const sourceMatched = providerFilter === 'all' || row.provider === providerFilter || Object.keys(row.dataSources || {}).includes(providerFilter);
    const modelMatched = modelFilter === 'all' || row.modelName === modelFilter;
    return sourceMatched && modelMatched;
  })).filter((row) => row.requests > 0 || Number(row.realTotalTokens || row.totalTokens || 0) > 0);
  const usage = {
    totalRequests: filteredModels.reduce((sum, row) => sum + row.requests, 0),
    realTotalTokens: filteredModels.reduce((sum, row) => sum + Number(row.realTotalTokens ?? row.totalTokens ?? 0), 0),
    inputTokens: filteredModels.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: filteredModels.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheReadTokens: filteredModels.reduce((sum, row) => sum + Number(row.cacheReadTokens || 0), 0),
    cacheCreationTokens: filteredModels.reduce((sum, row) => sum + Number(row.cacheCreationTokens || 0), 0),
    totalCost: filteredModels.reduce((sum, row) => sum + Number(row.totalCost || 0), 0),
    estimatedRequests: filteredModels.reduce((sum, row) => sum + row.estimatedRequests, 0),
  };
  const cacheableInput = usage.inputTokens + usage.cacheReadTokens;
  const cacheHitRate = cacheableInput > 0 ? usage.cacheReadTokens / cacheableInput : 0;
  const maxTokens = Math.max(1, ...filteredModels.map((row) => Number(row.realTotalTokens ?? row.totalTokens ?? 0)));
  const trendPoints = hasEntryData ? aggregateUsageTrendPoints(filteredEntries, rangeMode) : buildUsageTrendPointsFromDays(allUsage?.byDay || []);
  const modelMetricRows = aggregateUsageByModelMetric(filteredEntries, filteredModels);
  const requestSeries = buildModelBarSeries(modelMetricRows, 'requests');
  const donutRows = buildDonutRows(modelMetricRows);
  const donutSegments = buildDonutSegments(donutRows);
  const rangeLabel = usageRangeLabel(rangeMode);
  const latestTrendIndex = latestActiveTrendIndex(trendPoints);
  const latestTrend = trendPoints[latestTrendIndex];
  const previousTrend = latestTrendIndex > 0 ? trendPoints[latestTrendIndex - 1] : undefined;
  const latestTokens = Number(latestTrend?.realTotalTokens || 0);
  const previousTokens = Number(previousTrend?.realTotalTokens || 0);
  const tokenDelta = previousTrend ? latestTokens - previousTokens : latestTokens;
  const tokenDeltaRatio = previousTrend && previousTokens > 0 ? tokenDelta / previousTokens : null;

  async function loadMonitoring() {
    setLoading(true);
    try {
      const data = await fetch('/api/monitoring/summary').then((res) => res.json());
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMonitoring();
  }, []);

  useEffect(() => {
    if (refreshMode !== '30') return undefined;
    const timer = window.setInterval(() => void loadMonitoring(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshMode]);

  const modules = moduleMode === 'skills' ? summary?.modules.skills : summary?.modules.plugins;
  const modelRuns = summary?.modelRuns || [];
  return (
    <section className={embedded ? 'embedded-management-page monitoring-page' : 'settings-page monitoring-page'}>
      <div className="monitoring-shell">
        <div className="settings-head monitoring-head">
          <div>
            <h2>监控</h2>
          </div>
          <button className={`secondary-btn ${loading ? 'is-loading' : ''}`} onClick={() => void loadMonitoring()} disabled={loading}><RefreshCw size={15} />{loading ? '刷新中' : '刷新'}</button>
        </div>

      <div className="usage-toolbar" aria-label="监控筛选">
        <label><span>来源</span><select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="all">全部来源</option>{sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}</select><ChevronDown size={15} /></label>
        <label><span>模型</span><select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}><option value="all">全部模型</option>{modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select><ChevronDown size={15} /></label>
        <label><span>Profile</span><select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="all">全部 Profile</option>{profileOptions.map((profile) => <option key={profile} value={profile}>{profile}</option>)}</select><ChevronDown size={15} /></label>
        <label><RefreshCw size={15} /><select value={refreshMode} onChange={(event) => setRefreshMode(event.target.value as '30' | '0')}><option value="30">30s</option><option value="0">手动</option></select><ChevronDown size={15} /></label>
        <label><Clock3 size={15} /><select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as UsageRangeMode)}><option value="today">当天</option><option value="7">7 天</option><option value="15">15 天</option><option value="30">一个月</option><option value="90">3 个月</option><option value="180">6 个月</option><option value="365">1 年</option></select><ChevronDown size={15} /></label>
      </div>

      <section className="usage-summary-card">
        <div className="usage-summary-top">
          <div className="usage-total-block">
            <div className="usage-total-icon"><ZapIcon /></div>
            <div>
              <span>真实消耗 Tokens</span>
              <strong>{formatFullNumber(usage.realTotalTokens)}</strong>
              <small>≈ {formatChineseApproxNumber(usage.realTotalTokens)} · {summary?.hermesAgent ? `${summary.hermesAgent.usageSource} · ${summary.hermesAgent.databaseCount} profiles` : '兼容汇总'}</small>
            </div>
          </div>
          <div className="usage-cost-pill">
            <div><span>总请求数</span><strong><Activity size={15} />{formatFullNumber(usage.totalRequests)}</strong></div>
            <i />
            <div><span>总成本</span><strong className="money">{formatUsd(usage.totalCost)}</strong></div>
          </div>
        </div>

        <div className="usage-breakdown-grid">
          <UsageMiniStat icon={<ArrowDownToLine size={16} />} label="新增输入" value={formatWanNumber(usage.inputTokens)} />
          <UsageMiniStat icon={<ArrowUpFromLine size={16} />} label="Output" value={formatWanNumber(usage.outputTokens)} accent="purple" />
          <UsageMiniStat icon={<Sparkles size={16} />} label="命中" value={formatWanNumber(usage.cacheReadTokens)} accent="green" />
          <div className="cache-hit-card">
            <div><span>缓存命中率</span><strong>{(cacheHitRate * 100).toFixed(cacheHitRate > .999 ? 0 : 1)}%</strong></div>
            <span className="hit-track"><i style={{ width: `${Math.max(0, Math.min(100, cacheHitRate * 100))}%` }} /></span>
          </div>
        </div>
      </section>

      <section className="monitor-panel analysis-panel">
        <div className="panel-title analysis-title">
          <div><span>模型数据分析</span><small>{rangeMode === 'today' ? '当天按小时统计' : `${rangeLabel}按天统计`}</small></div>
          <div className="analysis-tabs" role="tablist" aria-label="模型数据分析">
            {[
              ['cost', '消耗分布'],
              ['trend', '调用趋势'],
              ['requests', '调用次数分布'],
              ['ranking', '调用次数排行'],
            ].map(([id, label]) => (
              <React.Fragment key={id}>
                <button className={analysisTab === id ? 'selected' : ''} onClick={() => setAnalysisTab(id as AnalysisTab)} type="button">{label}</button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {analysisTab === 'trend' && (
          <div className="analysis-chart">
            <div className="analysis-chart-head">
              <div><strong>调用趋势</strong><span>{latestTrend ? `${latestTrend.label} · ${formatCompactNumber(latestTokens)} tokens` : '等待数据进入'}</span></div>
              <em className={tokenDelta >= 0 ? 'growth-positive' : 'growth-negative'}>{rangeLabel} · {formatDelta(tokenDelta, tokenDeltaRatio)}</em>
            </div>
            <UsageTrendRechart points={trendPoints} hourly={rangeMode === 'today'} />
          </div>
        )}

        {analysisTab === 'cost' && (
          <div className="analysis-donut-view">
            <div className="donut-legend">
              <strong>模型消耗分布</strong>
              <span>总计：{formatCompactNumber(usage.realTotalTokens)} tokens</span>
              {donutRows.map((row) => (
                <div className="donut-legend-row" key={row.key}>
                  <i style={{ background: row.color }} />
                  <span>{row.modelName}</span>
                  <em>{formatDonutShare(row.displayShare)}</em>
                </div>
              ))}
            </div>
            <div className="donut-chart-wrap">
              <svg className="donut-chart" viewBox="0 0 120 120" aria-hidden="true">
                <circle className="donut-ring-base" cx="60" cy="60" r="38" pathLength="100" />
                {donutSegments.map((segment) => <circle className="donut-ring-segment" key={segment.key} cx="60" cy="60" r="38" pathLength="100" style={{ stroke: segment.color, strokeDasharray: `${segment.length} ${segment.gap}`, strokeDashoffset: segment.offset }} />)}
              </svg>
              <div><strong>{donutRows[0] ? formatDonutShare(donutRows[0].displayShare) : '0%'}</strong><span>{donutRows[0]?.modelName || '暂无模型'}</span></div>
            </div>
          </div>
        )}

        {analysisTab === 'requests' && (
          <div className="analysis-bar-view">
            <div className="analysis-chart-head"><div><strong>模型调用次数占比</strong><span>总计：{formatFullNumber(usage.totalRequests)} 次</span></div></div>
            <div className="analysis-bars-chart">
              {requestSeries.map((bar) => (
                <div className="analysis-model-bar" key={bar.key}>
                  <span>{bar.label}</span>
                  <i style={{ height: `${Math.max(2, bar.height)}%`, background: bar.color }} />
                  <em>{formatFullNumber(bar.value)}</em>
                </div>
              ))}
              {!requestSeries.length && <p className="muted-copy">暂无调用次数数据。</p>}
            </div>
          </div>
        )}

        {analysisTab === 'ranking' && (
          <div className="analysis-ranking">
            <div className="analysis-chart-head"><div><strong>调用次数排行</strong><span>按模型请求数降序</span></div></div>
            {modelMetricRows.slice(0, 8).map((row, index) => (
              <div className="analysis-rank-row" key={row.key}>
                <b>{index + 1}</b>
                <div><strong>{row.modelName}</strong><small>{row.provider} · {formatCompactNumber(row.realTotalTokens)} tokens · {formatUsd(row.totalCost)}</small></div>
                <span>{formatFullNumber(row.requests)}</span>
                <i><em style={{ width: `${Math.max(3, row.share)}%`, background: row.color }} /></i>
              </div>
            ))}
            {!modelMetricRows.length && <p className="muted-copy">暂无调用排行数据。</p>}
          </div>
        )}
      </section>

      <section className="monitor-panel wide monitor-model-panel">
        <div className="panel-title"><span>模型用量与成本</span><Bot size={15} /></div>
        <div className="usage-bars">
          {filteredModels.slice(0, 8).map((row) => (
            <div className="usage-bar-row" key={row.key}>
              <div><strong>{row.modelName}</strong><small>{row.provider} · {row.requests} requests · {pricingSourceLabel(row.pricingSource)}</small></div>
              <div className="usage-bar-track"><span style={{ width: `${Math.max(3, (Number(row.realTotalTokens ?? row.totalTokens ?? 0) / maxTokens) * 100)}%` }} /></div>
              <em>{formatCompactNumber(Number(row.realTotalTokens ?? row.totalTokens ?? 0))}<small>{formatUsd(Number(row.totalCost || 0))}</small></em>
            </div>
          ))}
          {!filteredModels.length && <p className="muted-copy">还没有匹配的模型调用记录。发起一次真实模型对话后这里会开始累计。</p>}
        </div>
      </section>

      <section className="monitor-panel model-run-diagnostics-panel">
        <details>
          <summary>
            <span><Activity size={15} /><strong>模型运行记录</strong><small>用于排查参数是否送达，不展示对话内容</small></span>
            <span className="model-run-count">最近 {Math.min(modelRuns.length, 200)} 条<ChevronDown size={15} /></span>
          </summary>
          <div className="model-run-list">
            {modelRuns.slice(0, 30).map((run) => (
              <details className={`model-run-row ${run.status}`} key={run.id}>
                <summary>
                  <i aria-hidden="true" />
                  <span><strong>{run.provider || run.providerKey || '未命名 Provider'} · {run.model || '未识别模型'}</strong><small>{new Date(run.createdAt).toLocaleString('zh-CN')} · {run.profileName || run.agentName || '默认 Profile'}</small></span>
                  <span className="model-run-settings">{run.effectiveReasoning === 'default' ? '默认推理' : `${modelRunReasoningLabel(run.effectiveReasoning)}推理`} · {run.effectiveServiceTier === 'standard' ? '标准速度' : '快速线路'}</span>
                  <em>{run.status === 'completed' ? (run.evidenceStatus === 'confirmed' ? '供应商已确认' : '已发送，供应商未确认') : run.status === 'failed' ? '运行失败' : run.status === 'cancelled' ? '已停止' : '发送中'}</em>
                </summary>
                <div className="model-run-detail">
                  <span>Transport：{run.transport}</span>
                  <span>耗时：{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</span>
                  <span>推理回执：{run.reasoningTokens ? `${run.reasoningTokens} tokens` : '未返回'}</span>
                  <span>速度回执：{run.confirmedServiceTier || '未返回'}</span>
                  {run.error && <p>{run.error}</p>}
                  {run.mappedParameters && Object.keys(run.mappedParameters).length > 0 && <pre>{JSON.stringify(run.mappedParameters, null, 2)}</pre>}
                </div>
              </details>
            ))}
            {!modelRuns.length && <p className="muted-copy">还没有模型运行记录。发起一次真实对话后，这里会显示脱敏后的参数送达状态。</p>}
          </div>
        </details>
      </section>

      <div className="monitor-grid">
        <section className="monitor-panel">
          <div className="panel-title"><span>系统日志</span><FileText size={15} /></div>
          <div className="log-list">
            {(summary?.logs || []).slice(0, 18).map((log, index) => (
              <div className={`log-row ${log.level}`} key={`${log.source}-${index}`}>
                <strong>{log.source}</strong>
                <span>{log.message}</span>
              </div>
            ))}
            {!summary?.logs.length && <p className="muted-copy">没有读取到 Hermes 日志文件。</p>}
          </div>
        </section>

        <section className="monitor-panel module-usage-panel">
          <div className="panel-title">
            <span>技能与插件用量</span>
            <div className="mini-segment">
              <button className={moduleMode === 'skills' ? 'selected' : ''} onClick={() => setModuleMode('skills')}>技能</button>
              <button className={moduleMode === 'plugins' ? 'selected' : ''} onClick={() => setModuleMode('plugins')}>插件</button>
            </div>
          </div>
          <div className="module-usage-list">
            {(modules?.byName || []).slice(0, 12).map((row) => (
              <div className="module-usage-row" key={row.name}>
                <span><strong>{row.name}</strong><small>{row.enabledProfiles || 0}/{row.profiles || 0} enabled</small></span>
                <em>{formatCompactNumber(row.useCount + row.viewCount + row.patchCount)}</em>
              </div>
            ))}
            {!modules?.byName.length && <p className="muted-copy">暂无{moduleMode === 'skills' ? '技能' : '插件'}用量记录。</p>}
          </div>
        </section>
      </div>
      </div>
    </section>
  );
}

function usageRangeStart(rangeMode: UsageRangeMode) {
  const nowDate = new Date();
  if (rangeMode === 'today') {
    const start = new Date(nowDate);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const start = new Date(nowDate);
  start.setDate(start.getDate() - (Number(rangeMode) - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function usageRangeLabel(rangeMode: UsageRangeMode) {
  if (rangeMode === 'today') return '当天';
  if (rangeMode === '30') return '一个月';
  if (rangeMode === '90') return '3 个月';
  if (rangeMode === '180') return '6 个月';
  if (rangeMode === '365') return '1 年';
  return `${rangeMode} 天`;
}

function latestActiveTrendIndex(points: UsageTrendPoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const row = points[index];
    if (Number(row.realTotalTokens || 0) > 0 || Number(row.requests || 0) > 0) return index;
  }
  return Math.max(0, points.length - 1);
}

function filterEntriesBySelection(entries: UsageEntry[], source: string, model: string) {
  return entries.filter((entry) => {
    const sourceValue = entry.dataSource || entry.provider || 'Frakio Work';
    const sourceMatched = source === 'all' || sourceValue === source || entry.provider === source;
    const modelMatched = model === 'all' || entry.modelName === model;
    return sourceMatched && modelMatched;
  });
}

function aggregateUsageModels(entries: UsageEntry[]): ModelUsageRow[] {
  const byModel = new Map<string, ModelUsageRow>();
  for (const entry of entries) {
    const key = `${entry.provider || 'unknown'}:${entry.modelId || entry.modelName || 'unknown'}`;
    const current = byModel.get(key) || {
      key,
      provider: entry.provider || 'unknown',
      modelId: entry.modelId || '',
      modelName: entry.modelName || entry.modelId || 'unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing: entry.pricing,
      pricingSource: entry.pricingSource,
      estimatedRequests: 0,
      lastUsedAt: entry.createdAt || null,
      dataSources: {},
    };
    current.requests += 1;
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    current.estimatedRequests += entry.estimated ? 1 : 0;
    current.pricing = entry.pricing || current.pricing;
    current.pricingSource = entry.pricingSource || current.pricingSource;
    current.lastUsedAt = entry.createdAt && (!current.lastUsedAt || entry.createdAt.localeCompare(current.lastUsedAt) > 0) ? entry.createdAt : current.lastUsedAt;
    const source = entry.dataSource || entry.provider || 'Frakio Work';
    current.dataSources = current.dataSources || {};
    current.dataSources[source] = (current.dataSources[source] || 0) + 1;
    byModel.set(key, current);
  }
  return Array.from(byModel.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
}

function aggregateUsageSources(entries: UsageEntry[]): UsageSource[] {
  const bySource = new Map<string, UsageSource>();
  for (const entry of entries) {
    const source = entry.dataSource || entry.provider || 'Frakio Work';
    const current = bySource.get(source) || { source, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0 };
    current.requests += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    bySource.set(source, current);
  }
  return Array.from(bySource.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
}

function aggregateUsageDays(entries: UsageEntry[]): UsageDay[] {
  const byDay = new Map<string, UsageDay>();
  for (const entry of entries) {
    const day = String(entry.createdAt || '').slice(0, 10);
    if (!day) continue;
    const current = byDay.get(day) || { day, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    current.requests += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
    byDay.set(day, current);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function aggregateUsageTrendPoints(entries: UsageEntry[], rangeMode: UsageRangeMode): UsageTrendPoint[] {
  if (rangeMode !== 'today') {
    return aggregateUsageDays(entries).map((row) => ({
      key: row.day,
      label: row.day.slice(5),
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      realTotalTokens: row.realTotalTokens,
      cost: row.totalCost,
    }));
  }
  const nowDate = new Date();
  const currentDay = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    key: `${currentDay}-${String(hour).padStart(2, '0')}`,
    label: `${String(nowDate.getMonth() + 1).padStart(2, '0')}/${String(nowDate.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00`,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    realTotalTokens: 0,
    cost: 0,
  }));
  for (const entry of entries) {
    const date = new Date(entry.createdAt || '');
    if (Number.isNaN(date.getTime())) continue;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (day !== currentDay) continue;
    const current = rows[date.getHours()];
    current.requests += 1;
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.cost += Number(entry.totalCost || 0);
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
  }
  return rows;
}

function buildUsageTrendPointsFromDays(rows: UsageDay[]): UsageTrendPoint[] {
  return rows.map((row) => {
    return {
      key: row.day,
      label: row.day.slice(5),
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      realTotalTokens: row.realTotalTokens,
      cost: row.totalCost,
    };
  });
}

function aggregateUsageByModelMetric(entries: UsageEntry[], fallbackModels: ModelUsageRow[]): ModelMetricRow[] {
  const sourceRows = entries.length ? aggregateUsageModels(entries) : fallbackModels;
  const totalTokens = sourceRows.reduce((sum, row) => sum + Number(row.realTotalTokens || row.totalTokens || 0), 0);
  const palette = ['#31527d', '#f2b705', '#0f766e', '#7c3aed', '#ef6f91', '#22a7c7', '#f97316', '#64748b'];
  return sourceRows
    .filter((row) => row.requests > 0 || Number(row.realTotalTokens || row.totalTokens || 0) > 0)
    .sort((a, b) => b.requests - a.requests || Number(b.realTotalTokens || b.totalTokens || 0) - Number(a.realTotalTokens || a.totalTokens || 0))
    .map((row, index) => {
      const realTotalTokens = Number(row.realTotalTokens || row.totalTokens || 0);
      return {
        key: row.key,
        provider: row.provider,
        modelName: row.modelName,
        requests: row.requests,
        realTotalTokens,
        totalCost: Number(row.totalCost || 0),
        share: totalTokens > 0 ? (realTotalTokens / totalTokens) * 100 : 0,
        color: palette[index % palette.length],
      };
    });
}

function buildModelBarSeries(rows: ModelMetricRow[], metric: keyof Pick<ModelMetricRow, 'requests' | 'realTotalTokens' | 'totalCost'>) {
  const visible = rows.slice(0, 8);
  const maxValue = Math.max(1, ...visible.map((row) => Number(row[metric] || 0)));
  return visible.map((row) => ({
    key: row.key,
    label: row.modelName,
    value: Number(row[metric] || 0),
    height: (Number(row[metric] || 0) / maxValue) * 100,
    color: row.color,
  }));
}

function buildDonutRows(rows: ModelMetricRow[]): DonutMetricRow[] {
  const palette = ['#31527d', '#f2b705', '#0f766e', '#7c3aed', '#ef6f91', '#22a7c7'];
  const sourceRows = rows
    .filter((row) => Number(row.realTotalTokens || 0) > 0)
    .sort((a, b) => b.realTotalTokens - a.realTotalTokens);
  const topRows = sourceRows.slice(0, 5).map((row, index) => ({ ...row, displayShare: 0, color: palette[index] }));
  const otherRows = sourceRows.slice(5);
  if (!otherRows.length) return normalizeDonutShares(topRows);
  const otherTokens = otherRows.reduce((sum, row) => sum + row.realTotalTokens, 0);
  const otherRequests = otherRows.reduce((sum, row) => sum + row.requests, 0);
  const otherCost = otherRows.reduce((sum, row) => sum + row.totalCost, 0);
  return normalizeDonutShares([
    ...topRows,
    {
      key: 'other',
      modelName: '其他',
      requests: otherRequests,
      realTotalTokens: otherTokens,
      totalCost: otherCost,
      share: 0,
      displayShare: 0,
      color: palette[5],
    },
  ]);
}

function normalizeDonutShares(rows: DonutMetricRow[]): DonutMetricRow[] {
  const totalTokens = rows.reduce((sum, row) => sum + row.realTotalTokens, 0);
  if (totalTokens <= 0) return [];
  let usedShare = 0;
  const normalized = rows.map((row, index) => {
    const isLast = index === rows.length - 1;
    const share = isLast ? Math.max(0, 100 - usedShare) : (row.realTotalTokens / totalTokens) * 100;
    usedShare += share;
    return { ...row, share };
  });
  const displayShares = normalized.map((row) => Math.round(row.share * 10) / 10);
  if (displayShares.length) {
    const displayedBeforeLast = displayShares.slice(0, -1).reduce((sum, share) => sum + share, 0);
    displayShares[displayShares.length - 1] = Math.max(0, Math.round((100 - displayedBeforeLast) * 10) / 10);
  }
  return normalized.map((row, index) => ({ ...row, displayShare: displayShares[index] || 0 }));
}

function buildDonutSegments(rows: DonutMetricRow[]) {
  const visible = rows.length ? rows : [{ key: 'empty', color: 'var(--settings-chart-empty)', share: 100, displayShare: 100 }] as DonutMetricRow[];
  let offset = 25;
  return visible.map((row) => {
    const length = rows.length ? row.share : 100;
    const segment = { key: row.key, color: row.color, length, gap: Math.max(0, 100 - length), offset: -offset };
    offset += length;
    return segment;
  });
}

function formatDonutShare(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatDelta(value: number, ratio: number | null) {
  const sign = value >= 0 ? '+' : '-';
  const amount = formatCompactNumber(Math.abs(value));
  if (ratio === null) return `${sign}${amount}`;
  return `${sign}${amount} · ${sign}${Math.abs(ratio * 100).toFixed(1)}%`;
}

function UsageTrendRechart({ points, hourly }: { points: UsageTrendPoint[]; hourly: boolean }) {
  if (!points.length) return <div className="usage-trend-scroll"><div className="usage-trend-rechart empty"><p className="muted-copy">暂无趋势数据。</p></div></div>;
  const timelineTicks = pickTimelineTicks(points, 12);
  const chartMinWidth = hourly
    ? Math.max(760, points.length * 42)
    : Math.min(1320, Math.max(720, points.length * 68));
  const tooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as UsageTrendPoint | undefined;
    return (
      <div className="usage-chart-tooltip">
        <strong>{label}</strong>
        <span>请求数：{formatFullNumber(row?.requests || 0)} 次</span>
        {payload.map((entry: { color?: string; name?: string | number; dataKey?: string | number; value?: unknown }) => (
          <em key={entry.dataKey} style={{ color: entry.color }}>
            <i style={{ background: entry.color }} />
            {entry.name}：{entry.dataKey === 'cost' ? formatUsd(Number(entry.value || 0)) : formatFullNumber(Number(entry.value || 0))}
          </em>
        ))}
      </div>
    );
  };
  return (
    <div className="usage-trend-scroll" aria-label="调用趋势时间线">
      <div className="usage-trend-rechart" style={{ minWidth: `${chartMinWidth}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="usageInputFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
              <linearGradient id="usageOutputFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              <linearGradient id="usageCacheCreationFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.18} /><stop offset="95%" stopColor="#f97316" stopOpacity={0} /></linearGradient>
              <linearGradient id="usageCacheReadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.18} /><stop offset="95%" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--settings-chart-grid)" opacity={0.72} />
            <XAxis dataKey="label" ticks={timelineTicks} axisLine={false} tickLine={false} interval={0} minTickGap={0} height={42} tick={{ fill: 'var(--settings-chart-axis)', fontSize: 12 }} dy={10} />
            <YAxis yAxisId="tokens" axisLine={false} tickLine={false} tick={{ fill: 'var(--settings-chart-axis)', fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} width={48} />
            <YAxis yAxisId="cost" orientation="right" axisLine={false} tickLine={false} tick={{ fill: 'var(--settings-chart-axis)', fontSize: 12 }} tickFormatter={(value) => `$${Number(value).toFixed(Number(value) >= 10 ? 0 : 2)}`} width={50} />
            <Tooltip content={tooltip} cursor={{ stroke: 'var(--settings-chart-cursor)', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.35 }} />
            <Legend verticalAlign="bottom" height={32} iconType="circle" wrapperStyle={{ color: 'var(--settings-chart-legend)', fontSize: 12, paddingTop: 10 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="inputTokens" name="输入 Tokens" stroke="#3b82f6" fill="url(#usageInputFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="outputTokens" name="输出 Tokens" stroke="#22c55e" fill="url(#usageOutputFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="cacheCreationTokens" name="缓存创建" stroke="#f97316" fill="url(#usageCacheCreationFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="cacheReadTokens" name="缓存命中" stroke="#a855f7" fill="url(#usageCacheReadFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="cost" type="monotone" dataKey="cost" name="成本" stroke="#f43f5e" fill="none" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function pickTimelineTicks(points: UsageTrendPoint[], maxTicks = 12) {
  const labels = points.map((point) => point.label);
  if (labels.length <= maxTicks) return labels;
  const selected = new Set<string>();
  const lastIndex = labels.length - 1;
  for (let index = 0; index < maxTicks; index += 1) {
    selected.add(labels[Math.round((index * lastIndex) / (maxTicks - 1))]);
  }
  return labels.filter((label) => selected.has(label));
}

function UsageMiniStat({ icon, label, value, accent = 'blue', muted = false }: { icon: React.ReactNode; label: string; value: string; accent?: 'blue' | 'purple' | 'green'; muted?: boolean }) {
  return (
    <div className={`usage-mini-stat ${accent} ${muted ? 'muted' : ''}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkbenchResponseSettings({ uiSettings, onUpdateUi }: { uiSettings: WorkbenchUiSettings; onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void }) {
  const rows = [
    {
      label: '流式响应',
      hint: 'Agent 回复按打字节奏展示。',
      checked: uiSettings.streamingResponses !== false,
      onChange: (checked: boolean) => onUpdateUi({ streamingResponses: checked }),
    },
    {
      label: '丰富的工具描述',
      hint: '让 Agent 为每个工具步骤生成简短动作名和执行意图。',
      checked: uiSettings.richToolDescriptions !== false,
      onChange: (checked: boolean) => onUpdateUi({ richToolDescriptions: checked }),
    },
  ];
  return (
    <>
      <div className="settings-section-head"><h3>响应体验</h3></div>
      <SettingsPanel className="workbench-display-panel" ariaLabel="响应体验">
        {rows.map((row) => (
          <SettingsToggleRow
            key={row.label}
            title={row.label}
            description={row.hint}
            checked={row.checked}
            onChange={row.onChange}
          />
        ))}
      </SettingsPanel>
    </>
  );
}

function AppearanceSettingsPage({ uiSettings, pinnedNav, onUpdateUi, onTogglePinned }: {
  uiSettings: WorkbenchUiSettings;
  pinnedNav: PinnedNav;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
  onTogglePinned: (id: string) => void;
}) {
  return (
    <>
      <div className="settings-head"><h2>外观</h2></div>
      <div className="settings-section-head"><h3>主题</h3></div>
      <SettingsPanel ariaLabel="主题设置">
        <SettingsRow title="应用外观" description="系统模式会跟随 macOS 的浅色与深色设置。">
          <div className="appearance-segmented" role="group" aria-label="应用外观">
            {(['system', 'light', 'dark'] as const).map((appearance) => (
              <button type="button" className={(uiSettings.appearance || 'system') === appearance ? 'selected' : ''} key={appearance} onClick={() => onUpdateUi({ appearance })}>
                {appearance === 'system' ? <><Monitor size={14} />系统</> : appearance === 'light' ? <><Sun size={14} />浅色</> : <><Moon size={14} />深色</>}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsPanel>
      <div className="settings-section-head"><h3>界面布局</h3></div>
      <SettingsPanel ariaLabel="界面布局">
        <SettingsToggleRow
          title="紧凑模式"
          description="压缩消息区和导航密度。"
          checked={uiSettings.density === 'compact'}
          onChange={(checked) => onUpdateUi({ density: checked ? 'compact' : 'comfortable' })}
        />
      </SettingsPanel>
      <div className="settings-section-head"><h3>左侧置顶</h3></div>
      <SettingsPanel ariaLabel="左侧置顶">
        {railNavItems.map((item) => (
          <SettingsToggleRow
            key={item.id}
            title={item.label}
            description="在主界面左侧导航中显示。"
            checked={pinnedNav[item.id] !== false}
            onChange={() => onTogglePinned(item.id)}
          />
        ))}
      </SettingsPanel>
    </>
  );
}

function TelemetrySettingsPanel({ uiSettings, status, onUpdateUi }: { uiSettings: WorkbenchUiSettings; status: TelemetryStatus | null; onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void }) {
  return (
    <>
      <div className="settings-section-head"><h3>使用统计</h3></div>
      <SettingsPanel className="telemetry-settings-panel" ariaLabel="隐私设置">
        <SettingsToggleRow
          title="匿名使用统计"
          description="用于统计日活、月活、留存、功能结果和粗略地区分布。"
          checked={uiSettings.telemetryEnabled === true}
          onChange={(checked) => onUpdateUi({ telemetryEnabled: checked, telemetryNoticeSeenAt: uiSettings.telemetryNoticeSeenAt || new Date().toISOString() })}
        />
        <SettingsInlineNote>
          公网 IP 只由 Umami 换算为国家、省份和城市。不会发送对话、文件内容、项目名称、路径、密钥或账户资料。
          <span className="telemetry-status-row">
            <span>{status?.configured ? 'Umami 已配置' : 'Umami 未配置'}</span>
            <span>待发送 {status?.queueSize || 0} 条</span>
            <span>{status?.lastSentAt ? `最近发送 ${formatTime(status.lastSentAt)}` : '尚未发送'}</span>
          </span>
        </SettingsInlineNote>
      </SettingsPanel>
    </>
  );
}

function TelemetryNotice({ onAllow, onDecline }: { onAllow: () => void; onDecline: () => void }) {
  return (
    <aside className="telemetry-notice" role="status" aria-live="polite">
      <div>
        <strong>是否允许匿名使用统计？</strong>
        <p>同意后才会统计功能使用和粗略地区。不会发送对话、文件、项目名称、路径、密钥或账户资料。</p>
      </div>
      <div className="telemetry-notice-actions">
        <button className="secondary-btn" onClick={onDecline}>不发送</button>
        <button className="send-btn" onClick={onAllow}>同意</button>
      </div>
    </aside>
  );
}

function DesktopUpdateBadge({ state, open, onOpenChange, onCancel, onInstall }: {
  state: DesktopUpdateState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onInstall: () => void;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(state.progress?.percent || 0))));
  const version = state.latestVersion ? `v${state.latestVersion.replace(/^v/i, '')}` : '新版';
  const label = state.phase === 'available'
    ? `下载 Frakio Work ${version}`
    : state.phase === 'downloading'
      ? `Frakio Work ${version} 正在下载，${percent}%`
      : state.phase === 'downloaded'
        ? `Frakio Work ${version} 已下载，点击安装`
        : `Frakio Work ${version} 下载失败，点击重试`;
  const Icon = state.phase === 'downloading'
    ? LoaderCircle
    : state.phase === 'downloaded'
      ? Check
      : state.phase === 'error'
        ? RefreshCw
        : ArrowDownToLine;
  return (
    <AppPopover open={open} onOpenChange={onOpenChange}>
      <AppPopoverTrigger asChild>
        <button
          type="button"
          className={`desktop-update-badge ${state.phase}`}
          aria-label={label}
          title={label}
        >
          <Icon size={13} aria-hidden="true" />
        </button>
      </AppPopoverTrigger>
      <AppPopoverContent side="top" align="end" className="desktop-update-popover">
        {state.phase === 'downloaded' ? (
          <>
            <div className="desktop-update-popover-copy">
              <strong>Frakio Work {version} 已准备好</strong>
              <small>打开安装包后，将新版拖入 Applications 替换当前版本。</small>
            </div>
            <button type="button" className="send-btn" onClick={onInstall}>退出并打开安装包</button>
          </>
        ) : (
          <>
            <div className="desktop-update-popover-copy">
              <strong>正在下载 Frakio Work {version}</strong>
              <small>{percent}%{state.progress.total > 0 ? ` · ${formatFileSize(state.progress.transferred)} / ${formatFileSize(state.progress.total)}` : ''}</small>
            </div>
            <div className="desktop-update-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
            <button type="button" className="secondary-btn" onClick={onCancel}>取消下载</button>
          </>
        )}
      </AppPopoverContent>
    </AppPopover>
  );
}

function ArchivedThreadsPanel({ threads, onRefresh, onRestore, onDelete }: { threads: ThreadSummary[]; onRefresh: () => Promise<void>; onRestore: (threadId: string) => Promise<void>; onDelete: (threadId: string) => Promise<void> }) {
  async function restore(thread: ThreadSummary) {
    await onRestore(thread.id);
    await onRefresh();
  }
  async function remove(thread: ThreadSummary) {
    const ok = window.confirm(`删除对话「${thread.title}」？\n\n删除后不会进入归档。`);
    if (!ok) return;
    await onDelete(thread.id);
    await onRefresh();
  }
  return (
    <>
      <div className="settings-head"><h2>归档对话</h2></div>
      <section className="studio-settings-panel archived-threads-panel">
        {threads.length ? threads.map((thread) => (
          <div className="archived-thread-row" key={thread.id}>
            <div>
              <strong>{thread.title}</strong>
              <span>{thread.workspaceRootPath ? thread.workspaceRootPath : '单聊对话'} · {thread.archivedAt ? formatTime(thread.archivedAt) : formatTime(thread.updatedAt)}</span>
            </div>
            <button className="secondary-btn compact" onClick={() => void restore(thread)}>恢复</button>
            <button className="secondary-btn compact danger" onClick={() => void remove(thread)}>删除</button>
          </div>
        )) : <p className="muted-copy">暂无归档对话。</p>}
      </section>
    </>
  );
}

function UserProfilePanel({ userProfile, defaultAgent, onSaved }: { userProfile: UserProfile; defaultAgent: Agent | null; onSaved: (profile: UserProfile, agents?: Agent[]) => void }) {
  const [summary, setSummary] = useState<UserProfileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [activityMode, setActivityMode] = useState<ProfileActivityMode>('daily');
  const [tokenTooltip, setTokenTooltip] = useState<{
    cell: ProfileActivityCell;
    left: number;
    top: number;
    placement: 'above' | 'below';
  } | null>(null);
  const tooltipId = useId();
  const reduceMotion = useReducedMotion();
  const displayName = userProfile.nickname || 'Frakio User';
  const initials = (displayName || 'MG').slice(0, 2).toUpperCase();
  const stats = summary?.stats || { totalTokens: 0, peakDayTokens: 0, peakDay: '', requests: 0, conversations: 0, activeAgents: 0 };
  const activity = useMemo(
    () => buildProfileActivity(summary?.usage?.byDay || [], summary?.usage?.entries || [], activityMode),
    [activityMode, summary],
  );
  const topAgents = (summary?.agents || []).filter((agent) => agent.conversationCount > 0 || agent.messageCount > 0).slice(0, 5);
  const topSkills = (summary?.modules.skills.byName || []).slice(0, 5);
  const topPlugins = (summary?.modules.plugins.byName || []).slice(0, 5);
  const skillRuns = topSkills.reduce((sum, item) => sum + moduleUsageTotal(item), 0);
  const pluginRuns = topPlugins.reduce((sum, item) => sum + moduleUsageTotal(item), 0);
  const insightRows = [
    { label: '对话总数', value: formatFullNumber(stats.conversations) },
    { label: '使用过的 Agent', value: formatFullNumber(stats.activeAgents) },
    { label: '模型请求', value: formatFullNumber(stats.requests) },
    { label: 'Skill 使用次数', value: formatFullNumber(skillRuns) },
    { label: '插件使用次数', value: formatFullNumber(pluginRuns) },
  ];

  async function loadSummary() {
    setLoading(true);
    try {
      const data = await fetch('/api/user-profile/summary').then((res) => res.json());
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    setTokenTooltip(null);
  }, [activityMode]);

  useEffect(() => {
    if (!editOpen) return;
    const settingsContent = document.querySelector<HTMLElement>('.settings-content');
    if (!settingsContent) return;
    const scrollTop = settingsContent.scrollTop;
    const scrollLeft = settingsContent.scrollLeft;
    const previousOverflow = settingsContent.style.overflow;
    settingsContent.style.overflow = 'hidden';
    // The fixed modal still lives under settings-content in the DOM. Restore
    // the frozen position after its first-field autofocus has settled.
    let settleFrame = 0;
    const restoreFrame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => {
        settingsContent.scrollTop = scrollTop;
        settingsContent.scrollLeft = scrollLeft;
      });
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(settleFrame);
      settingsContent.style.overflow = previousOverflow;
      settingsContent.scrollTop = scrollTop;
      settingsContent.scrollLeft = scrollLeft;
    };
  }, [editOpen]);

  function openEditor(trigger: HTMLButtonElement) {
    editTriggerRef.current = trigger;
    setEditOpen(true);
  }

  function closeEditor() {
    setEditOpen(false);
    window.requestAnimationFrame(() => editTriggerRef.current?.focus());
  }

  function handleSaved(profile: UserProfile, agents?: Agent[]) {
    onSaved(profile, agents);
    closeEditor();
    void loadSummary();
  }

  function showTokenTooltip(cell: ProfileActivityCell, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = Math.min(216, Math.max(148, window.innerWidth - 24));
    const maxLeft = Math.max(12, window.innerWidth - tooltipWidth - 12);
    const left = Math.min(maxLeft, Math.max(12, rect.left + (rect.width / 2) - (tooltipWidth / 2)));
    const placement = cell.row <= 2 || rect.top <= 92 ? 'below' : 'above';
    setTokenTooltip({
      cell,
      left,
      top: placement === 'above' ? rect.top - 9 : rect.bottom + 9,
      placement,
    });
  }

  return (
    <section className="profile-dashboard">
      <div className="profile-dashboard-actions">
        <button className="secondary-btn compact" onClick={(event) => openEditor(event.currentTarget)}><Pencil size={14} />编辑</button>
      </div>
      <section className="profile-hero">
        <button className="profile-avatar-button" onClick={(event) => openEditor(event.currentTarget)} aria-label="编辑个人资料">
          {userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : initials}
        </button>
        <h2>{displayName}</h2>
        <p>Frakio Work 用户 · 默认 Agent：{defaultAgent?.name || '未设置'}</p>
        <span className="visually-hidden" role="status" aria-live="polite">{loading ? '正在刷新资料数据' : summary ? '资料数据已更新' : ''}</span>
      </section>

      <section className="profile-stat-strip" aria-label="个人统计">
        <div><strong>{formatChineseApproxNumber(stats.totalTokens)}</strong><span>累计 Token 数</span></div>
        <div><strong>{formatChineseApproxNumber(stats.peakDayTokens)}</strong><span>峰值日 Token 数</span></div>
        <div><strong>{formatFullNumber(stats.requests)}</strong><span>模型请求</span></div>
        <div><strong>{formatFullNumber(stats.conversations)}</strong><span>对话数</span></div>
        <div><strong>{formatFullNumber(stats.activeAgents)}</strong><span>使用过的 Agent</span></div>
      </section>

      <section className="profile-activity-panel">
        <div className="profile-section-head">
          <h3>Token 活动</h3>
          <div className="mini-segment" aria-label="Token 活动范围">
            <button type="button" className={activityMode === 'daily' ? 'selected' : ''} aria-pressed={activityMode === 'daily'} onClick={() => setActivityMode('daily')}>每日</button>
            <button type="button" className={activityMode === 'weekly' ? 'selected' : ''} aria-pressed={activityMode === 'weekly'} onClick={() => setActivityMode('weekly')}>每周</button>
            <button type="button" className={activityMode === 'total' ? 'selected' : ''} aria-pressed={activityMode === 'total'} onClick={() => setActivityMode('total')}>累计</button>
          </div>
        </div>
        <div className="token-activity-scroll" onScroll={() => setTokenTooltip(null)}>
          <div className={`token-activity-grid${summary ? ' is-loaded' : ''}`} aria-label="Token 活动网格" aria-busy={!summary}>
            {activity.cells.map((cell) => (
              <button
                type="button"
                className={`token-activity-cell level-${cell.level}${cell.future ? ' is-future' : ''}`}
                data-day={cell.day}
                key={cell.day}
                aria-label={cell.ariaLabel}
                aria-describedby={tokenTooltip?.cell.day === cell.day ? tooltipId : undefined}
                style={{ animationDelay: reduceMotion ? '0ms' : `${Math.round(cell.index * 0.85)}ms` }}
                onPointerEnter={(event) => showTokenTooltip(cell, event.currentTarget)}
                onPointerLeave={() => setTokenTooltip(null)}
                onFocus={(event) => showTokenTooltip(cell, event.currentTarget)}
                onBlur={() => setTokenTooltip(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setTokenTooltip(null);
                }}
              />
            ))}
          </div>
          <div className="token-activity-months">{activity.months.map((month) => <span key={`${month.label}-${month.index}`} style={{ gridColumnStart: month.index + 1 }}>{month.label}</span>)}</div>
        </div>
      </section>

      <section className="profile-lower-grid">
        <ProfileInsightPanel title="活动洞察" empty="暂无活动记录。">
          <div className="profile-metric-list">
            {insightRows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
          </div>
        </ProfileInsightPanel>
        <section className="profile-insight-panel profile-top-list">
          <h3>最常用</h3>
          <div className="profile-top-section">
            <h4>Agent</h4>
            <div className="profile-insight-list">
              {topAgents.length ? topAgents.map((agent) => (
                <div className="profile-agent-row" key={agent.id}>
                  <span className="profile-agent-avatar" style={agent.avatarUrl ? undefined : { background: agent.color || '#0f766e' }}>{agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{agent.name}</strong><small>{agent.role || agent.profileName || 'Agent'}</small></span>
                  <em>{agent.conversationCount} 次对话<small>{agent.messageCount} 条消息</small></em>
                </div>
              )) : <p className="muted-copy">暂无 Agent 使用记录。</p>}
            </div>
          </div>
          <div className="profile-top-section">
            <h4>Skill</h4>
            <div className="profile-insight-list">
              {topSkills.length ? topSkills.map((item) => <ProfileModuleUsageRow item={item} key={item.name} />) : <p className="muted-copy">暂无 Skill 使用记录。</p>}
            </div>
          </div>
          <div className="profile-top-section">
            <h4>插件</h4>
            <div className="profile-insight-list">
              {topPlugins.length ? topPlugins.map((item) => <ProfileModuleUsageRow item={item} key={item.name} />) : <p className="muted-copy">暂无插件使用记录。</p>}
            </div>
          </div>
        </section>
      </section>

      {editOpen && (
        <div className="modal-backdrop profile-edit-modal">
          <div className="modal-card profile-edit-card">
            <UserProfileForm userProfile={userProfile} defaultAgent={defaultAgent} onSaved={handleSaved} onCancel={closeEditor} compact />
          </div>
        </div>
      )}
      {tokenTooltip && createPortal(
        <div
          className={`profile-token-tooltip is-${tokenTooltip.placement}`}
          id={tooltipId}
          role="tooltip"
          style={{ left: tokenTooltip.left, top: tokenTooltip.top }}
        >
          <strong>{tokenTooltip.cell.heading}</strong>
          <span>{tokenTooltip.cell.detail}</span>
        </div>,
        document.body,
      )}
    </section>
  );
}

function ProfileInsightPanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <section className="profile-insight-panel">
      <h3>{title}</h3>
      <div className="profile-insight-list">
        {hasChildren ? children : <p className="muted-copy">{empty}</p>}
      </div>
    </section>
  );
}

function ProfileModuleUsageRow({ item }: { item: UserProfileModuleUsage }) {
  const total = moduleUsageTotal(item);
  return (
    <div className="profile-module-row">
      <span><strong>{item.name}</strong><small>{item.enabledProfiles ?? 0}/{item.profiles ?? 0} enabled</small></span>
      <em>{formatFullNumber(total)} 次<small>{item.lastUsedAt ? formatTime(item.lastUsedAt) : '暂无最近记录'}</small></em>
    </div>
  );
}

function moduleUsageTotal(item: UserProfileModuleUsage) {
  return Number(item.useCount || 0) + Number(item.viewCount || 0) + Number(item.patchCount || 0);
}

function ManagedWebPasswordSettings() {
  const [managed, setManaged] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void fetch('/api/auth/status').then((response) => response.json()).then((status) => setManaged(status.managed === true)).catch(() => {});
  }, []);
  if (!managed) return null;
  async function savePassword() {
    setMessage('');
    if (nextPassword.length < 10) return setMessage('新密码至少需要 10 个字符。');
    if (nextPassword !== confirmation) return setMessage('两次输入的新密码不一致。');
    setSaving(true);
    try {
      await fetch('/api/session');
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Frakio-Request': '1' },
        body: JSON.stringify({ currentPassword, password: nextPassword }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '密码修改失败。');
      setCurrentPassword('');
      setNextPassword('');
      setConfirmation('');
      setMessage('管理员密码已更新，其他登录会话已退出。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密码修改失败。');
    } finally {
      setSaving(false);
    }
  }
  return <section className="managed-profile-password" aria-label="管理员密码">
    <div><strong>管理员密码</strong><small>修改后会退出其他设备的登录会话。</small></div>
    <label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
    <label>新密码<input type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label>
    <label>确认新密码<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    <button type="button" className="secondary-btn" disabled={saving || !currentPassword || !nextPassword || !confirmation} onClick={() => void savePassword()}>{saving ? '保存中' : '更新密码'}</button>
    {message && <div className={message.includes('已更新') ? 'settings-inline-message' : 'form-error'}>{message}</div>}
  </section>;
}

function UserProfileForm({ userProfile, defaultAgent, onSaved, onCancel, compact = false }: { userProfile: UserProfile; defaultAgent: Agent | null; onSaved: (profile: UserProfile, agents?: Agent[]) => void; onCancel?: () => void; compact?: boolean }) {
  const [draft, setDraft] = useState<UserProfile>(userProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setDraft(userProfile), [userProfile.updatedAt, userProfile.avatarUrl, userProfile.nickname]);
  const formName = String(draft.nickname || userProfile.nickname || 'Frakio User').trim();
  const formInitials = (formName || 'MG').slice(0, 2).toUpperCase();
  const busy = saving || avatarSaving;
  const isDirty = userProfileHasUnsavedChanges(draft, userProfile);

  useEffect(() => {
    if (!compact) return;
    const firstField = formRef.current?.querySelector<HTMLElement>('[data-profile-autofocus]');
    window.requestAnimationFrame(() => firstField?.focus({ preventScroll: true }));
  }, [compact]);

  function requestClose() {
    if (busy || avatarCropFile) return;
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onCancel?.();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== 'Tab' || !formRef.current) return;
    const focusable = Array.from(formRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    setError('');
    setAvatarCropFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  async function uploadAvatar(data: string) {
    setAvatarSaving(true);
    try {
      const res = await fetch('/api/user-profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: 'image/png', data }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '头像保存失败。');
      setDraft((current) => ({ ...current, avatarUrl: payload.avatarUrl || '' }));
      setAvatarCropFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像保存失败。');
    } finally {
      setAvatarSaving(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfile: draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '用户资料保存失败。');
      onSaved(payload.userProfile, payload.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户资料保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? 'user-profile-form compact' : 'user-profile-form'} ref={formRef} role={compact ? 'dialog' : undefined} aria-modal={compact || undefined} aria-labelledby={compact ? 'user-profile-editor-title' : undefined} onKeyDown={handleKeyDown}>
      <div className="user-profile-edit-hero">
        <button className="user-profile-avatar" type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving} aria-label="上传用户头像">
          {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : formInitials}
        </button>
        <input ref={avatarInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
        <div>
          <span id="user-profile-editor-title">编辑个人资料</span>
          <strong>{formName}</strong>
          <small>默认 Agent：{defaultAgent?.name || '未设置'} · 资料会同步给 Agent 使用</small>
          <button className="profile-avatar-upload-link" type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving}>{avatarSaving ? '上传中...' : draft.avatarUrl ? '更换头像' : '上传头像'}</button>
        </div>
        {onCancel && <button className="profile-edit-close icon-btn" type="button" onClick={requestClose} disabled={busy} aria-label="关闭"><X size={18} /></button>}
      </div>
      <div className="user-profile-edit-body">
        <div className="preference-grid user-profile-grid">
          <label>用户名/昵称<input data-profile-autofocus value={draft.nickname} onChange={(event) => setDraft({ ...draft, nickname: event.target.value })} placeholder="例如：Alex" /></label>
          <label>年龄<input value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} placeholder="选填" /></label>
          <label className="wide">个人简介<textarea value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} placeholder="简单介绍你自己" /></label>
          <label className="wide">爱好<textarea value={draft.hobbies} onChange={(event) => setDraft({ ...draft, hobbies: event.target.value })} placeholder="选填" /></label>
          <label className="wide">职业信息<textarea value={draft.occupation} onChange={(event) => setDraft({ ...draft, occupation: event.target.value })} placeholder="选填" /></label>
          <label>默认 Agent 对你的称呼<input value={draft.defaultAgentAddress} onChange={(event) => setDraft({ ...draft, defaultAgentAddress: event.target.value })} placeholder="例如：老板" /></label>
          <label>其他 Agent 对你的称呼<input value={draft.otherAgentAddress} onChange={(event) => setDraft({ ...draft, otherAgentAddress: event.target.value })} placeholder="例如：Alex" /></label>
        </div>
        <ManagedWebPasswordSettings />
        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="modal-actions">
        {onCancel && <button className="secondary-btn" onClick={requestClose} disabled={busy}>取消</button>}
        <button className="send-btn" onClick={() => void saveProfile()} disabled={busy}>{saving ? '保存中' : '保存并同步到 Agent'}</button>
      </div>
      {avatarCropFile && <AvatarCropModal file={avatarCropFile} title="裁剪个人头像" saving={avatarSaving} onCancel={() => setAvatarCropFile(null)} onSave={(data) => void uploadAvatar(data)} />}
      <AppAlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AppAlertDialogContent>
          <AppAlertDialogTitle className="app-alert-title">放弃未保存的修改？</AppAlertDialogTitle>
          <AppAlertDialogDescription className="app-alert-description">关闭后，本次尚未保存的个人资料修改将丢失。</AppAlertDialogDescription>
          <div className="app-alert-actions">
            <AppAlertDialogCancel className="cancel">继续编辑</AppAlertDialogCancel>
            <AppAlertDialogAction className="danger" onClick={() => onCancel?.()}>放弃修改</AppAlertDialogAction>
          </div>
        </AppAlertDialogContent>
      </AppAlertDialog>
    </div>
  );
}

function userProfileHasUnsavedChanges(draft: UserProfile, saved: UserProfile) {
  return ['avatarUrl', 'nickname', 'bio', 'age', 'hobbies', 'occupation', 'defaultAgentAddress', 'otherAgentAddress']
    .some((key) => draft[key as keyof UserProfile] !== saved[key as keyof UserProfile]);
}

function AvatarCropModal({ file, title, saving, onCancel, onSave }: { file: File; title: string; saving: boolean; onCancel: () => void; onSave: (dataUrl: string) => void }) {
  const [imageUrl, setImageUrl] = useState('');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function imageMetrics() {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image || !frame) return null;
    const size = frame.clientWidth || 280;
    const naturalWidth = image.naturalWidth || 1;
    const naturalHeight = image.naturalHeight || 1;
    const baseScale = Math.max(size / naturalWidth, size / naturalHeight);
    const drawWidth = naturalWidth * baseScale * scale;
    const drawHeight = naturalHeight * baseScale * scale;
    return { size, drawWidth, drawHeight };
  }

  function clampOffset(next: { x: number; y: number }) {
    const metrics = imageMetrics();
    if (!metrics) return next;
    const maxX = Math.max(0, (metrics.drawWidth - metrics.size) / 2);
    const maxY = Math.max(0, (metrics.drawHeight - metrics.size) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  }

  function saveCroppedAvatar() {
    const image = imageRef.current;
    const metrics = imageMetrics();
    if (!image || !metrics) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = 512 / metrics.size;
    const drawWidth = metrics.drawWidth * ratio;
    const drawHeight = metrics.drawHeight * ratio;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(image, (512 - drawWidth) / 2 + offset.x * ratio, (512 - drawHeight) / 2 + offset.y * ratio, drawWidth, drawHeight);
    onSave(canvas.toDataURL('image/png'));
  }

  return (
    <div className="modal-backdrop nested" onClick={onCancel}>
      <div className="modal avatar-crop-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{title}</h2><p>拖动位置，放大后保存为圆形安全区。</p></div>
          <button className="icon-btn" onClick={onCancel} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="avatar-crop-body">
          <div
            className="avatar-crop-frame"
            ref={frameRef}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y });
            }}
            onPointerMove={(event) => {
              if (!dragStart || dragStart.pointerId !== event.pointerId) return;
              setOffset(clampOffset({ x: dragStart.offsetX + event.clientX - dragStart.x, y: dragStart.offsetY + event.clientY - dragStart.y }));
            }}
            onPointerUp={() => setDragStart(null)}
            onPointerCancel={() => setDragStart(null)}
          >
            {imageUrl && <img ref={imageRef} src={imageUrl} alt="" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} onLoad={() => setOffset((current) => clampOffset(current))} draggable={false} />}
          </div>
          <label className="avatar-crop-slider">
            <span>缩放</span>
            <input type="range" min="1" max="2.6" step="0.01" value={scale} onChange={(event) => {
              setScale(Number(event.target.value));
              window.requestAnimationFrame(() => setOffset((current) => clampOffset(current)));
            }} />
          </label>
          <div className="modal-actions">
            <button className="secondary-btn" onClick={onCancel} disabled={saving}>取消</button>
            <button className="send-btn" onClick={saveCroppedAvatar} disabled={saving}>{saving ? '保存中' : '保存头像'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HermesRuntimePanel({ runtime, bootstrap, localStatus, diagnostics, apiAvailability, onStart, onRefresh }: { runtime: HermesRuntimeStatus | null; bootstrap: HermesBootstrapStatus | null; localStatus: HermesLocalStatus | null; diagnostics: HermesRuntimeDiagnostics | null; apiAvailability: HermesApiAvailability; onStart: () => Promise<void>; onRefresh: () => Promise<unknown> }) {
  const bridgeReady = Boolean(runtime?.bridge?.ready);
  const bundledRuntimeReady = Boolean(runtime?.runtime?.runtimeDir || diagnostics?.runtime?.runtimeDir);
  const autoStart = runtime?.autoStart;
  const runtimeTools = runtime?.tools || diagnostics?.tools || {};
  const missingRuntimeTools = Object.values(runtimeTools).filter((tool) => tool && !tool.available).map((tool) => tool.command);
  const autoStartWarnings = autoStart?.warnings || [];
  const autoStartLabel = autoStart?.status === 'starting' ? '工作台启动中' : autoStart?.status === 'ready' ? '工作台已就绪' : autoStart?.status === 'partial' ? '工作台已就绪，部分网关未启动' : autoStart?.status === 'failed' ? '工作台启动失败' : '等待启动';
  return (
    <SettingsPanel className="hermes-runtime-panel" ariaLabel="Hermes Agent Runtime">
      <div className="runtime-control-row">
        <div>
          <strong>{autoStartLabel}</strong>
          <small>{autoStart?.finishedAt ? `最近完成 ${formatTime(autoStart.finishedAt)}` : autoStart?.startedAt ? `开始于 ${formatTime(autoStart.startedAt)}` : '检测聊天桥接、外部兼容 API 和本地依赖。'}</small>
        </div>
        <div className="runtime-actions">
          <button className="secondary-btn" onClick={() => void onRefresh()}>重新检测</button>
          <button className="send-btn" onClick={() => void onStart()}>{bridgeReady ? '重新启动 Runtime' : '启动 Runtime'}</button>
        </div>
      </div>
      {autoStart?.steps?.length ? (
        <div className="runtime-step-strip" aria-label="Runtime 启动步骤">
          {autoStart.steps.map((step) => <span className={step.status} key={step.id}>{step.label}</span>)}
        </div>
      ) : null}
      {(autoStart?.error || autoStartWarnings.length > 0) && (
        <div className="runtime-log-list">
        {autoStart?.error && (
          <details className="runtime-autostart-log">
            <summary>查看启动日志</summary>
            <pre>{autoStart.error}</pre>
          </details>
        )}
        {autoStartWarnings.length > 0 && (
          <details className="runtime-autostart-log warning">
            <summary>查看启动警告</summary>
            <pre>{autoStartWarnings.join('\n')}</pre>
          </details>
        )}
        </div>
      )}
      <SettingsRow title="Frakio Work 内置 Runtime" description="工作台随应用提供的 Hermes Agent 运行环境。">
        <SettingsStatusValue
          state={bundledRuntimeReady ? '可用' : '未打包'}
          detail={runtime?.runtime?.runtimeDir || diagnostics?.runtime?.runtimeDir || '等待检测'}
          tone={bundledRuntimeReady ? 'ready' : 'warning'}
        />
      </SettingsRow>
      <SettingsRow title="Hermes 原生桥接" description="用于 Hermes Profile、网关与原生 Session 的通信。">
        <SettingsStatusValue
          state={bridgeReady ? '运行中' : '桥接未就绪'}
          detail={runtime?.bridge?.error || runtime?.bridge?.endpoint || '等待检测'}
          tone={bridgeReady ? 'ready' : 'warning'}
        />
      </SettingsRow>
      <SettingsRow title="Hermes Home" description={`${localStatus?.profiles?.length || 0} 个本地 Profile。`}>
        <SettingsStatusValue state={runtime?.hermesHome || diagnostics?.hermesHome?.path || '~/.hermes'} />
      </SettingsRow>
      <SettingsRow title="Frakio Work Home" description="Runtime、Bridge Socket 和本地运行缓存。">
        <SettingsStatusValue state={runtime?.frakioWorkHome || diagnostics?.frakioWorkHome?.path || '~/.frakio-work'} detail={runtime?.agentRoot || diagnostics?.agentRoot.path || ''} />
      </SettingsRow>
      <SettingsRow title="Runtime Tools" description="Hermes Agent 运行所需的本地命令。">
        <SettingsStatusValue
          state={missingRuntimeTools.length ? `缺少 ${missingRuntimeTools.join(', ')}` : '依赖可用'}
          detail={['node', 'npm', 'npx', 'uv', 'python3'].map((name) => runtimeTools[name]?.path || `${name}: missing`).join(' · ')}
          tone={missingRuntimeTools.length ? 'warning' : 'ready'}
        />
      </SettingsRow>
      {diagnostics && (
        <details className="runtime-parameters">
          <summary>运行参数</summary>
          <div>
            <span><strong>管理服务</strong>{diagnostics.workbenchApi.url} · PID {diagnostics.workbenchApi.pid}</span>
            <span><strong>当前构建</strong>v{diagnostics.workbenchApi.version || '未知'} · {diagnostics.workbenchApi.buildFingerprint || '无指纹'} · {diagnostics.workbenchApi.packaged ? '桌面安装包' : '源码开发版'}</span>
            <span><strong>构建时间</strong>{diagnostics.workbenchApi.buildTime ? new Date(diagnostics.workbenchApi.buildTime).toLocaleString() : '未知'}</span>
            <span><strong>运行 Runtime</strong>{diagnostics.agentRoot.path || '未定位'}</span>
            <span><strong>Bridge Script</strong>{diagnostics.bridgeScript.path || '未定位'}</span>
            <span><strong>Python</strong>{diagnostics.python.path || '未定位'}</span>
          </div>
        </details>
      )}
      <SettingsInlineNote>Profile Gateway 状态与操作继续由 Agent 配置中的 Agent 卡片管理。</SettingsInlineNote>
    </SettingsPanel>
  );
}

function UpdatesPanel({ runtime, status, busy, error, result, desktopUpdateState, onCheckDesktopUpdate, onDownloadDesktopUpdate, onCancelDesktopUpdate, onOpenDesktopUpdate, onCheckRuntime, onInstallRuntime, onActivateRuntime, onUseBundledRuntime, onDeleteRuntime }: {
  runtime: HermesRuntimeStatus | null;
  status: UpdatesStatus | null;
  busy: UpdateBusy;
  error: string;
  result: UpdateActionResult | null;
  desktopUpdateState: DesktopUpdateState | null;
  onCheckDesktopUpdate: () => Promise<void>;
  onDownloadDesktopUpdate: () => Promise<void>;
  onCancelDesktopUpdate: () => Promise<void>;
  onOpenDesktopUpdate: () => Promise<void>;
  onCheckRuntime: () => Promise<void>;
  onInstallRuntime: (tag?: string) => Promise<void>;
  onActivateRuntime: (version: string) => Promise<void>;
  onUseBundledRuntime: () => Promise<void>;
  onDeleteRuntime: (version: string) => Promise<void>;
}) {
  const [officialReleases, setOfficialReleases] = useState<HermesOfficialRelease[]>([]);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState('');
  const [releaseListError, setReleaseListError] = useState('');
  const manager = runtime?.manager;
  const active = manager?.activeRuntime || runtime?.runtime || null;
  const bundled = manager?.bundledRuntime || null;
  const latest = manager?.officialLatest || null;
  const managed = manager?.managedRuntimes || [];
  const latestBundled = Boolean(latest?.version && bundled?.version === latest.version);
  const selectedRelease = officialReleases.find((release) => release.tag === selectedReleaseTag) || null;
  const selectedInstalled = Boolean(selectedReleaseTag && managed.some((item) => item.manifest?.sourceTag === selectedReleaseTag));

  useEffect(() => {
    let activeRequest = true;
    void fetch('/api/hermes-runtime/releases')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '无法读取官方 Runtime 版本。');
        return Array.isArray(data.releases) ? data.releases as HermesOfficialRelease[] : [];
      })
      .then((releases) => {
        if (!activeRequest) return;
        setOfficialReleases(releases);
        setSelectedReleaseTag((current) => current || latest?.tag || releases[0]?.tag || '');
        setReleaseListError('');
      })
      .catch((loadError) => {
        if (!activeRequest) return;
        setReleaseListError(loadError instanceof Error ? loadError.message : '无法读取官方 Runtime 版本。');
        setSelectedReleaseTag((current) => current || latest?.tag || '');
      });
    return () => {
      activeRequest = false;
    };
  }, [latest?.tag]);

  return (
    <section className="updates-page-body">
      <div className="updates-page-toolbar">
        <div>
          <strong>产品版本</strong>
          <p>Frakio Work 在后台检查新版；Hermes Agent Runtime 始终由你手动安装和切换。</p>
        </div>
        <button className="secondary-btn" onClick={() => void Promise.all([onCheckDesktopUpdate(), onCheckRuntime()])} disabled={Boolean(busy) || desktopUpdateState?.phase === 'checking'}>{busy === 'runtime-check' || desktopUpdateState?.phase === 'checking' ? '检查中' : '检查更新'}</button>
      </div>
      <div className="settings-section-head"><h3>Frakio Work</h3></div>
      <SettingsPanel className="update-product-panel" ariaLabel="Frakio Work 版本更新">
        <FrakioUpdateCard
          status={status?.frakioWork || null}
          desktopState={desktopUpdateState}
          onCheck={onCheckDesktopUpdate}
          onDownload={onDownloadDesktopUpdate}
          onCancel={onCancelDesktopUpdate}
          onOpenInstaller={onOpenDesktopUpdate}
        />
      </SettingsPanel>
      <div className="settings-section-head"><h3>Hermes Agent Runtime</h3></div>
      <SettingsPanel className="update-product-panel" ariaLabel="Hermes Agent Runtime 版本管理">
        <div className="update-card runtime-update-card">
          <div className="update-card-head">
            <span><strong>Hermes Agent Runtime</strong><small>官方版本独立安装。安装完成后，需要确认“使用”才会切换。</small></span>
            <em>{active?.source === 'managed' ? '用户安装' : active?.source === 'override' ? '开发覆盖' : 'Frakio Work 内置'}</em>
          </div>
          <div className="update-meta">
            <span><strong>当前版本</strong>{active?.version || '未知'}</span>
            <span><strong>内置版本</strong>{bundled?.version || '未知'}</span>
            <span><strong>官方稳定版</strong>{latest?.label || latest?.tag || '等待检查'}</span>
            <span><strong>运行路径</strong>{active?.runtimeDir || '未定位'}</span>
          </div>
          {manager?.fallbackReason && <div className="update-blocked">{manager.fallbackReason}</div>}
          <div className="runtime-release-picker">
            <label htmlFor="runtime-official-release">官方稳定版本</label>
            <div>
              <select id="runtime-official-release" value={selectedReleaseTag} onChange={(event) => setSelectedReleaseTag(event.target.value)} disabled={Boolean(busy) || (!officialReleases.length && !latest?.tag)}>
                {!officialReleases.length && latest?.tag && <option value={latest.tag}>{latest.label || latest.tag}</option>}
                {!officialReleases.length && !latest?.tag && <option value="">等待检查</option>}
                {officialReleases.map((release) => <option value={release.tag} key={release.tag}>{release.label || release.tag}{release.releaseDate ? ` · ${release.releaseDate}` : ''}</option>)}
              </select>
              <button className="secondary-btn" onClick={() => void onInstallRuntime(selectedReleaseTag || undefined)} disabled={Boolean(busy) || !selectedReleaseTag || selectedInstalled || (latestBundled && selectedReleaseTag === latest?.tag)}>{busy === 'runtime-install' ? '安装中' : selectedInstalled ? '已安装' : latestBundled && selectedReleaseTag === latest?.tag ? '已内置' : '下载安装'}</button>
            </div>
            <small>{selectedRelease?.url ? <a href={selectedRelease.url} target="_blank" rel="noreferrer">查看此版本的官方说明</a> : '只提供 NousResearch 官方稳定版本。'}</small>
          </div>
          {releaseListError && !latest?.tag && <div className="update-blocked">{releaseListError}</div>}
          <div className="runtime-version-actions">
            {active?.source === 'managed' && <button className="secondary-btn" onClick={() => void onUseBundledRuntime()} disabled={Boolean(busy)}>{busy === 'runtime-bundled' ? '切换中' : '恢复内置版本'}</button>}
          </div>
          {managed.length > 0 && <div className="runtime-version-list">
            {managed.map((item) => {
              const isActive = active?.source === 'managed' && active.version === item.version;
              return <div className="runtime-version-row" key={`${item.version}-${item.platform}`}>
                <span><strong>{item.version}</strong><small>{item.manifest?.sourceTag || item.platform || ''}{item.compatible === false ? ' · Bridge 不兼容' : ''}</small></span>
                <div>
                  <button className="secondary-btn" onClick={() => void onActivateRuntime(item.version || '')} disabled={Boolean(busy) || isActive || item.compatible === false}>{busy === `runtime-activate:${item.version}` ? '切换中' : isActive ? '正在使用' : '使用'}</button>
                  <button className="icon-btn" aria-label={`删除 Runtime ${item.version}`} title="删除这个用户 Runtime" onClick={() => void onDeleteRuntime(item.version || '')} disabled={Boolean(busy) || isActive}><Trash2 size={15} /></button>
                </div>
              </div>;
            })}
          </div>}
        </div>
      </SettingsPanel>
      {error && <div className="form-error">{error}</div>}
      {result?.logs?.length ? <div className="updates-log"><strong>{result.target || 'update'} · {result.phase || 'status'}</strong><span>{result.logs.slice(-3).join(' · ')}</span>{result.backup?.path && <em>回滚点：{result.backup.path}</em>}{result.restartRequired && <em>更新已完成，重启当前 Frakio Work 服务后生效。</em>}</div> : null}
    </section>
  );
}

function FrakioUpdateCard({ status, desktopState, onCheck, onDownload, onCancel, onOpenInstaller }: {
  status: UpdateModuleStatus | null;
  desktopState: DesktopUpdateState | null;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenInstaller: () => Promise<void>;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const release = status?.release || null;
  const desktopSupported = desktopState?.supported === true;
  const phase = desktopSupported ? desktopState.phase : release?.updateAvailable ? 'available' : release?.latestVersion ? 'up-to-date' : 'idle';
  const percent = Math.max(0, Math.min(100, Math.round(Number(desktopState?.progress?.percent || 0))));
  const stateLabel = phase === 'checking'
    ? '检查中'
    : phase === 'available'
      ? '有可用更新'
      : phase === 'downloading'
        ? `下载中 ${percent}%`
        : phase === 'downloaded'
          ? '已下载'
          : phase === 'error'
            ? '下载失败'
            : phase === 'up-to-date'
              ? '已是最新'
              : '等待检查';
  const errorMessage = desktopSupported ? desktopState.error : release?.error;

  async function openRelease() {
    if (!release?.releaseUrl) return;
    if (window.frakioDesktop?.openRelease) await window.frakioDesktop.openRelease(release.releaseUrl);
    else window.open(release.releaseUrl, '_blank', 'noopener,noreferrer');
  }

  function primaryAction() {
    if (!desktopSupported) return { label: '查看 Release', disabled: !release?.releaseUrl, action: openRelease };
    if (phase === 'available' || phase === 'error') return { label: phase === 'error' ? '重新下载' : '下载更新', disabled: false, action: onDownload };
    if (phase === 'downloading') return { label: '取消下载', disabled: false, action: onCancel };
    if (phase === 'downloaded') return { label: '退出并打开安装包', disabled: false, action: onOpenInstaller };
    return { label: phase === 'checking' ? '检查中' : '检查更新', disabled: phase === 'checking', action: onCheck };
  }

  const primary = primaryAction();
  return (
    <div className={`update-card ${phase === 'available' || phase === 'downloaded' ? 'available' : phase === 'error' ? 'blocked' : ''}`}>
      <div className="update-card-head">
        <span><strong>Frakio Work</strong><small>更新桌面应用、Web UI、API、Frakio Bridge 和下一版内置 Runtime。</small></span>
        <em>{stateLabel}</em>
      </div>
      <div className="update-meta">
        <span><strong>当前版本</strong>v{desktopState?.currentVersion || release?.currentVersion || status?.packageVersion || '未知'}</span>
        <span><strong>最新版本</strong>{desktopState?.latestVersion || release?.latestVersion ? `v${(desktopState?.latestVersion || release?.latestVersion || '').replace(/^v/i, '')}` : '尚未发布'}</span>
        <span><strong>安装方式</strong>{desktopSupported ? '应用内下载 DMG' : '源码版'}</span>
        <span><strong>当前架构</strong>{desktopState?.assetName || release?.asset?.name || '使用 Release 升级说明'}</span>
        {desktopState?.checkedAt && <span><strong>最近检查</strong>{formatTime(desktopState.checkedAt)}</span>}
      </div>
      {phase === 'downloading' && <div className="settings-update-download-progress" aria-label={`下载进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>}
      {release?.notes && <p className="update-release-notes">{release.notes}</p>}
      {errorMessage && <div className="update-blocked">{errorMessage}</div>}
      <div className="settings-update-actions">
        <button className="secondary-btn" onClick={() => void primary.action()} disabled={primary.disabled}>{primary.label}</button>
        {release?.notes && <button className="secondary-btn quiet" onClick={() => setNotesOpen(true)}>查看完整更新日志</button>}
      </div>
      <AppDialog open={notesOpen} onOpenChange={setNotesOpen}>
        <AppDialogContent className="release-notes-dialog">
          <header className="release-notes-dialog-head">
            <div>
              <AppDialogTitle asChild><h2>Frakio Work {release?.latestVersion ? `v${release.latestVersion}` : '更新日志'}</h2></AppDialogTitle>
              <AppDialogDescription>{release?.publishedAt ? `发布于 ${formatTime(release.publishedAt)}` : '完整 GitHub Release 说明'}</AppDialogDescription>
            </div>
            <AppDialogClose asChild><button className="icon-btn" aria-label="关闭更新日志"><X size={16} /></button></AppDialogClose>
          </header>
          <div className="release-notes-dialog-body"><RichMarkdown content={release?.notes || '暂无更新日志。'} /></div>
          <footer className="release-notes-dialog-footer">
            <button className="secondary-btn" onClick={() => void openRelease()} disabled={!release?.releaseUrl}>在 GitHub 查看</button>
            <AppDialogClose asChild><button className="secondary-btn">关闭</button></AppDialogClose>
          </footer>
        </AppDialogContent>
      </AppDialog>
    </div>
  );
}

function HermesBackupRow({ backup, busy, onRollback, onDelete }: { backup: HermesBackup; busy: UpdateBusy; onRollback: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>; onDelete: (backup: HermesBackup) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<RollbackScopes>({});
  const rollbackBusy = busy === `rollback:${backup.id}`;
  const deleteBusy = busy === `delete:${backup.id}`;
  const before = backup.before?.displayVersion || backup.before?.tagDescription || shortCommit(backup.before?.commit || '') || '未知版本';
  const after = backup.after?.displayVersion || backup.after?.tagDescription || shortCommit(backup.after?.commit || '') || '未记录';
  const content = [
    backup.patchSaved ? '本地 patch' : '',
    backup.untrackedFiles?.length ? `${backup.untrackedFiles.length} 个未跟踪文件` : '',
    backup.configFiles?.length ? `${backup.configFiles.length} 个配置文件` : '',
  ].filter(Boolean).join(' · ') || '配置快照';
  return (
    <details className="backup-row" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span><strong>{backupReasonLabel(backup.reason)}</strong><small>{formatTime(backup.createdAt)} · {before} → {after}</small></span>
        <em>{formatFileSize(backup.size || 0)}</em>
      </summary>
      <div className="backup-row-body">
        <div className="backup-meta">
          <span><strong>路径</strong>{backup.path}</span>
          <span><strong>内容</strong>{content}</span>
          <span><strong>状态</strong>{backup.status || 'ready'}</span>
        </div>
        {backup.dirtyFiles?.length ? <div className="update-dirty">{backup.dirtyFiles.slice(0, 8).map((file) => <code key={file}>{file}</code>)}</div> : null}
        <div className="rollback-scopes">
          <span>回滚配置范围</span>
          <label><input type="checkbox" checked={scopes.profiles === true} onChange={(event) => setScopes((current) => ({ ...current, profiles: event.target.checked }))} /> Profiles</label>
          <label><input type="checkbox" checked={scopes.mcp === true} onChange={(event) => setScopes((current) => ({ ...current, mcp: event.target.checked }))} /> MCP</label>
          <label><input type="checkbox" checked={scopes.channels === true} onChange={(event) => setScopes((current) => ({ ...current, channels: event.target.checked }))} /> 频道</label>
          <label><input type="checkbox" checked={scopes.models === true} onChange={(event) => setScopes((current) => ({ ...current, models: event.target.checked }))} /> 模型</label>
        </div>
        <div className="backup-actions">
          <button className="secondary-btn" onClick={() => void onRollback(backup, scopes)} disabled={rollbackBusy || Boolean(busy && !rollbackBusy)}>{rollbackBusy ? '回滚中' : '回滚到此版本'}</button>
          <button className="secondary-btn danger" onClick={() => void onDelete(backup)} disabled={deleteBusy || Boolean(busy && !deleteBusy)}>{deleteBusy ? '删除中' : '删除备份'}</button>
        </div>
      </div>
    </details>
  );
}

function backupReasonLabel(reason?: string) {
  if (reason === 'update') return '更新前回滚点';
  if (reason === 'pre-rollback') return '回滚前快照';
  if (reason === 'manual') return '手动备份';
  return reason || '备份';
}

function shortCommit(value?: string) {
  return value ? value.slice(0, 7) : '';
}

type SettingsSection = 'localConnection' | 'runtimes' | 'memory' | 'knowledge' | 'tools' | 'hermesAgent' | 'updates' | 'appearance' | 'privacy' | 'agents' | 'skills' | 'profile' | 'workbench' | 'archivedThreads' | 'mcp' | 'models' | 'channels' | 'plugins' | 'jobs' | 'monitoring' | 'vaults';

const settingsGroups: Array<{ title: string; items: Array<{ id: SettingsSection; label: string; icon: React.ComponentType<{ size?: number }>; aliases?: string[] }> }> = [
  { title: '个人', items: [{ id: 'profile', label: '个人资料', icon: UserCircle }, { id: 'workbench', label: '工作台', icon: PanelRight }, { id: 'appearance', label: '外观', icon: Palette, aliases: ['主题', '浅色', '深色', '紧凑模式'] }, { id: 'privacy', label: '隐私', icon: ShieldCheck, aliases: ['匿名使用统计', 'Umami'] }, { id: 'archivedThreads', label: '归档对话', icon: Archive }] },
  { title: '协作基础', items: [{ id: 'agents', label: 'Agent 配置', icon: Network }, { id: 'memory', label: 'Memory', icon: Brain, aliases: ['长期记忆', 'Memory Ledger', '候选记忆'] }, { id: 'knowledge', label: 'Knowledge', icon: Library, aliases: ['知识库', 'Workspace Vault', 'Obsidian', '草稿'] }, { id: 'vaults', label: '仓库', icon: Database }, { id: 'skills', label: '技能', icon: Sparkles, aliases: ['Skill', '全局技能', 'Agent 技能'] }, { id: 'plugins', label: '插件', icon: Boxes, aliases: ['Plugin', '全局插件', 'Agent 插件'] }, { id: 'tools', label: '工具能力', icon: Cable, aliases: ['网页搜索', '网页浏览', '浏览器', '网络能力'] }] },
  { title: '运行时与模型', items: [{ id: 'runtimes', label: 'Runtime Center', icon: Cpu, aliases: ['Pi', 'Codex', 'Claude', 'Gemini', '运行时', '内核'] }, { id: 'models', label: '模型', icon: Bot }, { id: 'hermesAgent', label: 'Hermes 集成', icon: Sparkles, aliases: ['Hermes Agent', 'Hermes Runtime', '诊断', '备份', '回滚', 'Profile'] }] },
  { title: '集成', items: [{ id: 'mcp', label: 'MCP', icon: Boxes }, { id: 'channels', label: '频道', icon: MessageSquare }] },
  { title: '自动化', items: [{ id: 'jobs', label: '任务', icon: Clock3 }, { id: 'monitoring', label: '监控', icon: Activity }] },
  { title: '系统', items: [{ id: 'localConnection', label: '系统状态', icon: Cable, aliases: ['本地连接', '本地服务', 'Frakio Work Home', '外部兼容 API'] }, { id: 'updates', label: '版本更新', icon: RefreshCw, aliases: ['版本与更新', 'Frakio Work 更新', 'Hermes Agent Runtime 更新'] }] },
];

function SettingsRail({ activeSection, onSectionChange, onReturnToConversation }: { activeSection: SettingsSection; onSectionChange: (section: SettingsSection) => void; onReturnToConversation: () => void }) {
  const [settingsQuery, setSettingsQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const visibleSettingsGroups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !normalizedSettingsQuery || `${group.title} ${item.label} ${(item.aliases || []).join(' ')}`.toLowerCase().includes(normalizedSettingsQuery)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="settings-rail-sidebar">
      <div className="settings-rail-head">
        <button className="settings-return" onClick={onReturnToConversation}><ArrowLeft size={16} /><span>返回对话</span></button>
        <button className="settings-mobile-toggle" type="button" aria-label={mobileOpen ? '收起设置导航' : '展开设置导航'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((current) => !current)}>
          {mobileOpen ? <X size={16} /> : <Settings size={16} />}
        </button>
      </div>
      <div className={mobileOpen ? 'settings-rail-body open' : 'settings-rail-body'}>
        <label className="settings-search">
          <Search size={15} />
          <input value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="搜索设置..." />
        </label>
        <div className="settings-nav">
          {visibleSettingsGroups.map((group) => (
            <section className="settings-nav-group" key={group.title}>
              <span>{group.title}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={activeSection === item.id ? 'selected' : ''}
                    key={item.id}
                    aria-current={activeSection === item.id ? 'page' : undefined}
                    onClick={() => {
                      onSectionChange(item.id);
                      setMobileOpen(false);
                    }}
                  >
                    <Icon size={16} />
                    <strong>{item.label}</strong>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}

function SettingsStatusValue({ state, detail, tone = 'neutral' }: { state: string; detail?: string; tone?: 'neutral' | 'ready' | 'warning' }) {
  return (
    <span className={`settings-status-value ${tone}`}>
      <strong>{state}</strong>
      {detail && <small>{detail}</small>}
    </span>
  );
}

function RuntimeCenterPage({ onOpenHermes }: { onOpenHermes: () => void }) {
  const [runtimes, setRuntimes] = useState<RuntimeDefinition[]>(runtimeSeed);
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, RuntimeModelCatalog>>({});
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set(runtimeSeed.map((runtime) => runtime.id)));
  const [error, setError] = useState('');
  const detect = useCallback(async (runtimeId: string) => {
    setCheckingIds((current) => new Set(current).add(runtimeId));
    try {
      const response = await fetch(`/api/runtimes/${runtimeId}/detect`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '运行时检测失败。');
      setRuntimes((current) => mergeRuntimeDefinitions(current, [data.runtime]));
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(runtimeId);
        return next;
      });
    }
  }, []);
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/runtimes');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Runtime 状态读取失败。');
      setRuntimes((current) => mergeRuntimeDefinitions(current, data.runtimes || []));
      const catalogs = await Promise.all(['hermes', 'pi'].map(async (runtimeId) => {
        try {
          const catalogResponse = await fetch(`/api/runtimes/${runtimeId}/models`);
          const catalog = await catalogResponse.json().catch(() => ({}));
          return catalogResponse.ok ? [runtimeId, catalog as RuntimeModelCatalog] as const : null;
        } catch {
          return null;
        }
      }));
      setModelCatalogs(Object.fromEntries(catalogs.filter(Boolean) as Array<readonly [string, RuntimeModelCatalog]>));
      await Promise.all(runtimeSeed.map((runtime) => detect(runtime.id)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Runtime 状态读取失败。');
    }
  }, [detect]);
  useEffect(() => { void load(); }, [load]);
  const renderGroup = (kind: 'core' | 'channel', title: string) => (
    <>
      <div className="settings-section-head"><h3>{title}</h3></div>
      <SettingsPanel ariaLabel={title}>
        {runtimes.filter((runtime) => runtime.kind === kind).map((runtime) => {
          const installation = runtime.installation;
          const ready = installation?.status === 'ready';
          const description = runtime.id === 'pi'
            ? 'Frakio Work 内置 Pi Worker；使用 Frakio Model Center 的统一模型配置。'
            : runtime.id === 'hermes'
              ? '内置执行运行时；使用 Frakio Model Center。Profile、网关与备份在 Hermes 集成中管理。'
              : '使用本机 CLI 与原生账号；模型由 CLI 或 CC Switch 管理，不改写全局配置。';
          const catalog = modelCatalogs[runtime.id];
          const catalogDetail = runtime.kind === 'core' && catalog
            ? `${catalog.usableModelCount || 0} 个可用模型 · Frakio Model Center`
            : '';
          return <SettingsRow key={runtime.id} title={<RuntimeLabel runtimeId={runtime.id} />} description={description}>
            <span className="runtime-center-row-actions">
              <SettingsStatusValue
                state={checkingIds.has(runtime.id) ? '检测中' : ready ? '已就绪' : installation?.status === 'missing' ? '未安装' : installation?.status === 'error' ? '异常' : installation?.status || '等待检测'}
                detail={[installation?.version, catalogDetail, installation?.detail].filter(Boolean).join(' · ')}
                tone={ready && !checkingIds.has(runtime.id) ? 'ready' : 'warning'}
              />
              {runtime.id === 'hermes' && <button className="secondary-btn runtime-center-detail-link" onClick={onOpenHermes}>打开 Hermes 集成</button>}
            </span>
          </SettingsRow>;
        })}
      </SettingsPanel>
    </>
  );
  return (
    <>
      <div className="settings-head"><h2>Runtime Center</h2><button className="secondary-btn" onClick={() => void load()} disabled={checkingIds.size > 0}>{checkingIds.size > 0 ? '检测中' : '重新检测'}</button></div>
      {renderGroup('core', '内置内核')}
      {renderGroup('channel', '外部通道')}
      <SettingsInlineNote>这里是全部执行运行时的唯一总入口。切换运行时会创建独立原生 Session；Agent 人格、Frakio 对话、Memory 和 Workspace Vault 保持不变。</SettingsInlineNote>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function MemoryCenterPage() {
  const [entries, setEntries] = useState<MemoryLedgerEntry[]>([]);
  const [status, setStatus] = useState<MemoryLedgerEntry['status']>('accepted');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/memory?status=${encodeURIComponent(status)}&limit=200`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Memory Ledger 读取失败。');
      setEntries(data.entries || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Memory Ledger 读取失败。');
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  const resolve = async (entryId: string, action: 'accept' | 'reject') => {
    const response = await fetch(`/api/memory/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || '记忆状态更新失败。');
      return;
    }
    await load();
  };
  return (
    <>
      <div className="settings-head">
        <h2>Memory Ledger</h2>
        <select value={status} onChange={(event) => setStatus(event.target.value as MemoryLedgerEntry['status'])}>
          <option value="accepted">已确认</option>
          <option value="candidate">候选</option>
          <option value="superseded">已取代</option>
          <option value="rejected">已拒绝</option>
        </select>
      </div>
      <SettingsPanel ariaLabel="Memory Ledger">
        {entries.map((entry) => (
          <SettingsRow
            key={entry.id}
            title={entry.fact}
            description={`${entry.scope}:${entry.subjectId} · 置信度 ${Math.round(entry.confidence * 100)}% · ${entry.provenance?.[0]?.source || 'unknown source'} · ${formatTime(entry.updatedAt)}`}
          >
            {entry.status === 'candidate' ? (
              <span className="settings-inline-actions">
                <button className="secondary-btn" onClick={() => void resolve(entry.id, 'accept')}>确认</button>
                <button className="secondary-btn danger" onClick={() => void resolve(entry.id, 'reject')}>拒绝</button>
              </span>
            ) : <SettingsStatusValue state={entry.status === 'accepted' ? '已确认' : entry.status === 'superseded' ? '已取代' : '已拒绝'} />}
          </SettingsRow>
        ))}
        {!entries.length && !loading ? <SettingsInlineNote>当前分类没有记忆条目。</SettingsInlineNote> : null}
      </SettingsPanel>
      <SettingsInlineNote>这里只保存可解释的长期事实。聊天记录、技能、项目文档和 Work 状态不会写入 Memory Ledger。</SettingsInlineNote>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function KnowledgeCenterPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [summary, setSummary] = useState<{
    vault?: Vault;
    index?: { documentCount?: number; indexedAt?: string; files?: Array<{ relativePath: string; updatedAt: string }> };
    commits?: Array<{ id: string; operation: string; relativePath: string; runId: string; createdAt: string }>;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ relativePath: string; summary: string; vaultName?: string }>>([]);
  const [error, setError] = useState('');
  const loadSummary = useCallback(async (targetId: string) => {
    if (!targetId) {
      setSummary(null);
      return;
    }
    setError('');
    const response = await fetch(`/api/workspaces/${targetId}/knowledge`);
    const data = await response.json();
    if (!response.ok) {
      setSummary(null);
      setError(data.error || 'Knowledge Gateway 状态读取失败。');
      return;
    }
    setSummary(data);
  }, []);
  useEffect(() => {
    void fetch('/api/workspaces').then((response) => response.json()).then((data) => {
      const next = data.workspaces || [];
      setWorkspaces(next);
      setWorkspaceId((current) => current || next[0]?.id || '');
    }).catch(() => setError('Workspace 列表读取失败。'));
  }, []);
  useEffect(() => { void loadSummary(workspaceId); }, [workspaceId, loadSummary]);
  const initialize = async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/knowledge/initialize`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Workspace Vault 初始化失败。');
      return;
    }
    await loadSummary(workspaceId);
  };
  const searchKnowledge = async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const response = await fetch(`/api/workspaces/${workspaceId}/knowledge/search?q=${encodeURIComponent(query.trim())}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Knowledge 检索失败。');
      return;
    }
    setResults(data.results || []);
  };
  const draftCount = summary?.index?.files?.filter((file) => file.relativePath.startsWith('drafts/')).length || 0;
  return (
    <>
      <div className="settings-head">
        <h2>Knowledge</h2>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          {workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
        </select>
      </div>
      <SettingsPanel ariaLabel="Workspace Knowledge">
        <SettingsRow title="主 Vault" description={summary?.vault?.path || '当前 Workspace 尚未绑定主 Vault。'}>
          <SettingsStatusValue state={summary?.vault?.name || '未绑定'} tone={summary?.vault ? 'ready' : 'warning'} />
        </SettingsRow>
        <SettingsRow title="索引" description={summary?.index?.indexedAt ? `最近扫描 ${formatTime(summary.index.indexedAt)}` : '等待扫描'}>
          <SettingsStatusValue state={`${summary?.index?.documentCount || 0} 个 Markdown`} />
        </SettingsRow>
        <SettingsRow title="待合并草稿" description="Agent 运行只能先写入 drafts/<runId>/。">
          <SettingsStatusValue state={`${draftCount} 个草稿`} tone={draftCount ? 'warning' : 'ready'} />
        </SettingsRow>
        <SettingsRow title="初始化标准目录" description="补齐 index.md、AGENTS.md、sources、wiki、drafts、artifacts 和 log.md。">
          <button className="secondary-btn" disabled={!workspaceId} onClick={() => void initialize()}>初始化 / 校验</button>
        </SettingsRow>
      </SettingsPanel>
      <div className="settings-section-head"><h3>检索</h3></div>
      <SettingsPanel ariaLabel="Knowledge Search">
        <SettingsRow title="搜索主 Vault 与共享只读 Vault" description="结果保留来源 Vault，不跨 Workspace 写入。">
          <span className="settings-inline-actions">
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchKnowledge(); }} placeholder="输入关键词" />
            <button className="secondary-btn" disabled={!workspaceId || !query.trim()} onClick={() => void searchKnowledge()}>搜索</button>
          </span>
        </SettingsRow>
        {results.map((result, index) => <SettingsRow key={`${result.relativePath}-${index}`} title={result.relativePath} description={result.summary}><SettingsStatusValue state={result.vaultName || '主 Vault'} /></SettingsRow>)}
      </SettingsPanel>
      <div className="settings-section-head"><h3>最近发布</h3></div>
      <SettingsPanel ariaLabel="Knowledge Commits">
        {(summary?.commits || []).slice(0, 20).map((commit) => (
          <SettingsRow key={commit.id} title={commit.relativePath} description={`${commit.operation} · ${commit.runId || 'manual'} · ${formatTime(commit.createdAt)}`}>
            <SettingsStatusValue state={commit.operation === 'publish' ? '已发布' : '草稿'} tone={commit.operation === 'publish' ? 'ready' : 'neutral'} />
          </SettingsRow>
        ))}
        {!summary?.commits?.length ? <SettingsInlineNote>还没有 Knowledge 发布记录。</SettingsInlineNote> : null}
      </SettingsPanel>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function SystemStatusPage({ hermesBootstrap, hermesRuntime, hermesDiagnostics, hermesApiAvailability }: {
  hermesBootstrap: HermesBootstrapStatus | null;
  hermesRuntime: HermesRuntimeStatus | null;
  hermesDiagnostics: HermesRuntimeDiagnostics | null;
  hermesApiAvailability: HermesApiAvailability;
}) {
  const workbenchOnline = hermesApiAvailability !== 'offline';
  const bridgeReady = Boolean(hermesRuntime?.bridge?.ready);
  const externalApiOnline = Boolean(hermesBootstrap?.api?.online);
  const frakioHome = hermesRuntime?.frakioWorkHome || hermesDiagnostics?.frakioWorkHome?.path || '~/.frakio-work';
  return (
    <>
      <div className="settings-head"><h2>系统状态</h2></div>
      <div className="settings-section-head"><h3>Frakio Work</h3></div>
      <SettingsPanel ariaLabel="Frakio Work 系统状态">
        <SettingsRow title="本地管理服务" description="为桌面端提供本地状态、设置和运行管理。">
          <SettingsStatusValue
            state={workbenchOnline ? '已连接' : '未连接'}
            detail={hermesDiagnostics?.workbenchApi.url || 'http://127.0.0.1:8787'}
            tone={workbenchOnline ? 'ready' : 'warning'}
          />
        </SettingsRow>
        <SettingsRow title="Runtime Router" description="统一连接 Frakio 对话与全部执行运行时。">
          <SettingsStatusValue
            state={bridgeReady ? '运行中' : '未就绪'}
            detail={hermesRuntime?.bridge?.endpoint || '等待检测'}
            tone={bridgeReady ? 'ready' : 'warning'}
          />
        </SettingsRow>
        <SettingsRow title="外部兼容 API" description="供第三方 OpenAI-compatible 客户端使用，不影响工作台对话。">
          <SettingsStatusValue
            state={externalApiOnline ? '运行中' : '未运行'}
            detail={hermesBootstrap?.api?.apiBaseUrl || 'http://127.0.0.1:8642/v1'}
            tone={externalApiOnline ? 'ready' : 'neutral'}
          />
        </SettingsRow>
        <SettingsRow title="Frakio Work Home" description="运行状态、Bridge Socket 和应用缓存目录。">
          <SettingsStatusValue state={frakioHome} />
        </SettingsRow>
      </SettingsPanel>
    </>
  );
}

function ToolCapabilitiesPage({ profile, hermesRuntime }: { profile: string; hermesRuntime: HermesRuntimeStatus | null }) {
  const [networkStatus, setNetworkStatus] = useState<HermesNetworkStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/hermes/network-status?profile=${encodeURIComponent(profile || 'default')}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('network status unavailable')))
      .then(setNetworkStatus)
      .catch(() => { if (!controller.signal.aborted) setNetworkStatus(null); });
    return () => controller.abort();
  }, [profile, hermesRuntime?.bridge?.ready]);
  const detail = (capability: HermesNetworkStatus['search'] | HermesNetworkStatus['browser']) => {
    if (capability.detail === 'free_provider_ready') return '免费搜索可用，服务繁忙时可能限流';
    if (capability.detail === 'tool_disabled') return '工具未启用';
    if (capability.detail === 'provider_not_configured') return '搜索后端未配置';
    if (capability.detail === 'provider_unavailable') return '已配置后端当前不可用';
    if (capability.detail === 'browser_cli_missing') return '只读浏览器组件未就绪';
    return capability.provider ? `${capability.provider} 已就绪` : '已就绪';
  };
  return <>
    <div className="settings-head"><h2>工具能力</h2></div>
    <div className="settings-section-head"><h3>联网与浏览</h3></div>
    <SettingsPanel ariaLabel="联网与浏览工具能力">
      <SettingsRow title="网页搜索" description="实时信息优先使用搜索；单个免费服务限流不代表本机离线。"><SettingsStatusValue state={networkStatus?.search.ready ? '可用' : '未就绪'} detail={networkStatus ? detail(networkStatus.search) : '等待检测'} tone={networkStatus?.search.ready ? 'ready' : 'warning'} /></SettingsRow>
      <SettingsRow title="网页浏览" description="搜索失败时使用只读浏览器；目标网站拒绝或超时不代表本机离线。"><SettingsStatusValue state={networkStatus?.browser.ready ? '可用' : '未就绪'} detail={networkStatus ? detail(networkStatus.browser) : '等待检测'} tone={networkStatus?.browser.ready ? 'ready' : 'warning'} /></SettingsRow>
      <SettingsInlineNote>Plan 模式允许网页搜索和只读浏览。点击、输入、脚本控制或终端 curl 被拦截时，属于 Plan 安全策略，不是网络故障。</SettingsInlineNote>
    </SettingsPanel>
  </>;
}

function WorkbenchProfileSyncPanel({ title, detail, hint, canSync, busy, error, onSync }: {
  title: string;
  detail: string;
  hint: string;
  canSync: boolean;
  busy: boolean;
  error: string;
  onSync: () => Promise<void>;
}) {
  return (
    <>
      <div className="settings-section-head"><h3>本地配置同步</h3></div>
      <SettingsPanel ariaLabel="本地配置同步">
        <SettingsRow title="Hermes Agent Profiles" description={`${title}。${detail}`}>
          <button className="send-btn" onClick={() => void onSync()} disabled={busy || !canSync}>{busy ? '同步中' : '同步配置'}</button>
        </SettingsRow>
        <SettingsInlineNote>{hint}。模型仍需在 Frakio Work 中单独配置。</SettingsInlineNote>
      </SettingsPanel>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

function HermesBackupPanel({ status, busy, onCreate, onRollback, onDelete, onCleanup }: {
  status: UpdatesStatus | null;
  busy: UpdateBusy;
  onCreate: () => Promise<void>;
  onRollback: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>;
  onDelete: (backup: HermesBackup) => Promise<void>;
  onCleanup: (mode: 'older-than-30-days' | 'keep-latest-10') => Promise<void>;
}) {
  const backups = status?.backups || [];
  return (
    <>
      <div className="settings-section-head"><h3>配置保护</h3></div>
      <SettingsPanel className="hermes-backup-panel" ariaLabel="Hermes Agent 配置保护">
        <SettingsRow title="创建配置快照" description="保存当前 Hermes Agent 配置，供更新或排错后回滚。">
          <button className="secondary-btn" onClick={() => void onCreate()} disabled={Boolean(busy)}>{busy === 'backup' ? '备份中' : '立即备份'}</button>
        </SettingsRow>
        <SettingsRow title="清理旧备份" description="只清理备份缓存，不影响当前 Hermes Agent 配置。">
          <span className="settings-inline-actions">
            <button className="secondary-btn" onClick={() => void onCleanup('keep-latest-10')} disabled={Boolean(busy)}>保留最近 10 条</button>
            <button className="secondary-btn danger" onClick={() => void onCleanup('older-than-30-days')} disabled={Boolean(busy)}>清理 30 天前</button>
          </span>
        </SettingsRow>
        {backups.length
          ? backups.map((backup) => <HermesBackupRow backup={backup} busy={busy} onRollback={onRollback} onDelete={onDelete} key={backup.id} />)
          : <SettingsInlineNote>还没有配置快照。首次手动备份或执行更新时会在这里显示。</SettingsInlineNote>}
      </SettingsPanel>
    </>
  );
}

function SettingsPage({ vaults, models, agents, hermesStatus, hermesBootstrap, hermesRuntime, hermesDiagnostics, hermesApiAvailability, hermesError, updatesStatus, updatesBusy, updatesError, updatesResult, desktopUpdateState, onCheckDesktopUpdate, onDownloadDesktopUpdate, onCancelDesktopUpdate, onOpenDesktopUpdate, onCheckHermesRuntime, onInstallHermesRuntime, onActivateHermesRuntime, onUseBundledHermesRuntime, onDeleteHermesRuntime, onCreateHermesBackup, onRollbackHermesBackup, onDeleteHermesBackup, onCleanupHermesBackups, userProfile, uiSettings, telemetryStatus, isImportingHermes, vaultPathInput, setVaultPathInput, vaultError, vaultBusy, addVault, reindexVault, deleteVault, onImportHermes, onRunFirstUseGuide, firstUseGuideRunning, onStartHermesRuntime, onRefreshHermesRuntime, onStartProfileGateway, onStopProfileGateway, onUpdateUi, onUserProfileSaved, pinnedNav, onTogglePinned, modelError, saveModel, deleteModel, fetchAvailableModels, onCapabilityChanged, activeSection, onSectionChange, archivedThreads, onRefreshArchivedThreads, onRestoreThread, onDeleteThread, selectedOrgAgentId, onSelectAgent, onProfilesChanged, onUpdateAgent, onDeleteAgent, onCreateAgent, profileEditor, onUpdateDefaultAgent }: {
  vaults: Vault[];
  models: ModelProfile[];
  agents: Agent[];
  hermesStatus: HermesLocalStatus | null;
  hermesBootstrap: HermesBootstrapStatus | null;
  hermesRuntime: HermesRuntimeStatus | null;
  hermesDiagnostics: HermesRuntimeDiagnostics | null;
  hermesApiAvailability: HermesApiAvailability;
  hermesError: string;
  updatesStatus: UpdatesStatus | null;
  updatesBusy: UpdateBusy;
  updatesError: string;
  updatesResult: UpdateActionResult | null;
  desktopUpdateState: DesktopUpdateState | null;
  onCheckDesktopUpdate: () => Promise<void>;
  onDownloadDesktopUpdate: () => Promise<void>;
  onCancelDesktopUpdate: () => Promise<void>;
  onOpenDesktopUpdate: () => Promise<void>;
  onCheckHermesRuntime: () => Promise<void>;
  onInstallHermesRuntime: (tag?: string) => Promise<void>;
  onActivateHermesRuntime: (version: string) => Promise<void>;
  onUseBundledHermesRuntime: () => Promise<void>;
  onDeleteHermesRuntime: (version: string) => Promise<void>;
  onCreateHermesBackup: () => Promise<void>;
  onRollbackHermesBackup: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>;
  onDeleteHermesBackup: (backup: HermesBackup) => Promise<void>;
  onCleanupHermesBackups: (mode: 'older-than-30-days' | 'keep-latest-10') => Promise<void>;
  userProfile: UserProfile;
  uiSettings: WorkbenchUiSettings;
  telemetryStatus: TelemetryStatus | null;
  isImportingHermes: boolean;
  vaultPathInput: string;
  setVaultPathInput: (value: string) => void;
  vaultError: string;
  vaultBusy: Record<string, 'index' | 'delete'>;
  addVault: () => Promise<void>;
  reindexVault: (vaultId: string) => Promise<void>;
  deleteVault: (vault: Vault) => Promise<void>;
  onImportHermes: () => Promise<void>;
  onRunFirstUseGuide: () => void;
  firstUseGuideRunning: boolean;
  onStartHermesRuntime: () => Promise<void>;
  onRefreshHermesRuntime: () => Promise<unknown>;
  onStartProfileGateway: (profileName: string) => Promise<void>;
  onStopProfileGateway: (profileName: string) => Promise<void>;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
  onUserProfileSaved: (profile: UserProfile, agents?: Agent[]) => void;
  pinnedNav: PinnedNav;
  onTogglePinned: (id: string) => void;
  modelError: string;
  saveModel: SaveModel;
  deleteModel: (modelId: string) => Promise<boolean>;
  fetchAvailableModels: FetchAvailableModels;
  onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  archivedThreads: ThreadSummary[];
  onRefreshArchivedThreads: () => Promise<void>;
  onRestoreThread: (threadId: string) => Promise<void>;
  onDeleteThread: (threadId: string) => Promise<void>;
  selectedOrgAgentId: string;
  onSelectAgent: (id: string) => void;
  onProfilesChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onCreateAgent: () => void;
  profileEditor: ProfileEditorControls;
  onUpdateDefaultAgent: (agentId: string) => void;
}) {
  const localProfiles = hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || [];
  const detectedProfiles = localProfiles.length;
  const hermesPath = hermesBootstrap?.installPath || hermesStatus?.profiles?.[0]?.path?.replace(/\/profiles\/[^/]+$/, '') || '~/.hermes';
  const canSyncHermes = detectedProfiles > 0;
  const workbenchApiOffline = hermesApiAvailability === 'offline';
  const localHermesTitle = workbenchApiOffline ? 'Frakio Work 本地管理服务未运行' : canSyncHermes ? '已发现本地 Hermes 配置' : '未发现本地 Hermes 配置';
  const localHermesDetail = workbenchApiOffline ? '无法连接 127.0.0.1:8787，暂时不能检测本地 Profile' : `Hermes Home ${hermesPath} · ${detectedProfiles} 个 Profile`;
  const localHermesHint = workbenchApiOffline
    ? '请用 npm run dev 同时启动 Web 和 API，或单独运行 npm run dev:api。'
    : hermesBootstrap?.checkedAt || hermesStatus?.checkedAt
      ? `最近检测 ${formatTime(hermesBootstrap?.checkedAt || hermesStatus?.checkedAt || '')}`
      : '打开设置时会自动检测本地配置。';
  const defaultAgent = agents.find((agent) => agent.id === uiSettings.defaultAgentId) || agents.find((agent) => agent.id === 'iris') || agents[0] || null;
  const defaultAgentProfile = resolveHermesProfileNameForAgent(defaultAgent, localProfiles);
  return (
    <section className="settings-page codex-settings-page">
      <div className="settings-content">
          {activeSection === 'localConnection' && (
            <SystemStatusPage
              hermesBootstrap={hermesBootstrap}
              hermesRuntime={hermesRuntime}
              hermesDiagnostics={hermesDiagnostics}
              hermesApiAvailability={hermesApiAvailability}
            />
          )}

          {activeSection === 'runtimes' && <RuntimeCenterPage onOpenHermes={() => onSectionChange('hermesAgent')} />}
          {activeSection === 'memory' && <MemoryCenterPage />}
          {activeSection === 'knowledge' && <KnowledgeCenterPage />}
          {activeSection === 'tools' && <ToolCapabilitiesPage profile={defaultAgentProfile} hermesRuntime={hermesRuntime} />}

          {activeSection === 'hermesAgent' && <>
            <div className="settings-head"><h2>Hermes 集成</h2></div>
            <div className="settings-section-head"><h3>Profile 与连接</h3></div>
            <SettingsPanel ariaLabel="Hermes Profile 与连接">
              <SettingsRow title="初次使用引导" description="重新检查依赖并完成 Frakio Work 与 Hermes Agent 的连接。">
                <button className="secondary-btn" onClick={onRunFirstUseGuide} disabled={firstUseGuideRunning}>{firstUseGuideRunning ? '引导运行中' : '运行引导'}</button>
              </SettingsRow>
            </SettingsPanel>
            <div className="settings-section-head"><h3>Runtime 与诊断</h3></div>
            <HermesRuntimePanel runtime={hermesRuntime} bootstrap={hermesBootstrap} localStatus={hermesStatus} diagnostics={hermesDiagnostics} apiAvailability={hermesApiAvailability} onStart={onStartHermesRuntime} onRefresh={onRefreshHermesRuntime} />
            <HermesBackupPanel
              status={updatesStatus}
              busy={updatesBusy}
              onCreate={onCreateHermesBackup}
              onRollback={onRollbackHermesBackup}
              onDelete={onDeleteHermesBackup}
              onCleanup={onCleanupHermesBackups}
            />
            {(hermesError || updatesError) && <div className="form-error">{hermesError || updatesError}</div>}
          </>}

          {activeSection === 'updates' && <>
            <div className="settings-head"><h2>版本更新</h2></div>
            <UpdatesPanel
              runtime={hermesRuntime}
              status={updatesStatus}
              busy={updatesBusy}
              error={updatesError}
              result={updatesResult}
              desktopUpdateState={desktopUpdateState}
              onCheckDesktopUpdate={onCheckDesktopUpdate}
              onDownloadDesktopUpdate={onDownloadDesktopUpdate}
              onCancelDesktopUpdate={onCancelDesktopUpdate}
              onOpenDesktopUpdate={onOpenDesktopUpdate}
              onCheckRuntime={onCheckHermesRuntime}
              onInstallRuntime={onInstallHermesRuntime}
              onActivateRuntime={onActivateHermesRuntime}
              onUseBundledRuntime={onUseBundledHermesRuntime}
              onDeleteRuntime={onDeleteHermesRuntime}
            />
          </>}

          {activeSection === 'agents' && (
            <OrgPage
              agents={agents}
              models={models}
              hermesRuntime={hermesRuntime}
              selectedOrgAgentId={selectedOrgAgentId}
              onSelectAgent={onSelectAgent}
              onProfilesChanged={onProfilesChanged}
              onUpdateAgent={onUpdateAgent}
              onDeleteAgent={onDeleteAgent}
              onCreate={onCreateAgent}
              profileEditor={profileEditor}
              defaultAgentId={uiSettings.defaultAgentId || defaultAgent?.id || ''}
              onUpdateDefaultAgent={onUpdateDefaultAgent}
              onRefreshHermesRuntime={onRefreshHermesRuntime}
              onStartProfileGateway={onStartProfileGateway}
              onStopProfileGateway={onStopProfileGateway}
            />
          )}

          {activeSection === 'profile' && (
            <>
              <div className="settings-head"><h2>个人资料</h2></div>
              <UserProfilePanel
                userProfile={userProfile}
                defaultAgent={defaultAgent}
                onSaved={onUserProfileSaved}
              />
            </>
          )}

          {activeSection === 'workbench' && <>
            <div className="settings-head"><h2>工作台</h2></div>
            <div className="settings-section-head"><h3>工作台偏好</h3></div>
            <SettingsPanel ariaLabel="工作台偏好">
              <SettingsRow title="新对话标语" description="显示在新对话输入框上方的提示语。">
                <SettingsField><input value={uiSettings.newChatPrompt || '我们接下来做点什么？'} onChange={(event) => onUpdateUi({ newChatPrompt: event.target.value })} /></SettingsField>
              </SettingsRow>
              <SettingsRow title="发送键" description="选择在输入框中发送消息的快捷键。">
                <SettingsField><select value={uiSettings.sendKey || 'enter'} onChange={(event) => onUpdateUi({ sendKey: event.target.value as WorkbenchUiSettings['sendKey'] })}><option value="enter">Enter 发送</option><option value="mod-enter">Cmd/Ctrl + Enter 发送</option></select></SettingsField>
              </SettingsRow>
              <SettingsRow title="默认操作权限" description="新对话采用的外部操作审批方式。">
                <SettingsField><select value={uiSettings.defaultPermissionMode || 'manual'} onChange={(event) => onUpdateUi({ defaultPermissionMode: event.target.value as PermissionMode })}>{(['manual', 'smart', 'off'] as const).map((mode) => <option key={mode} value={mode}>{permissionLabel(mode)}</option>)}</select></SettingsField>
              </SettingsRow>
              <SettingsRow title="全局决策 Agent" description="在没有明确指定时负责全局决策的 Agent。">
                <SettingsField><select value={uiSettings.fallbackDecisionAgentId || uiSettings.defaultAgentId || ''} onChange={(event) => onUpdateUi({ fallbackDecisionAgentId: event.target.value })}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></SettingsField>
              </SettingsRow>
              <SettingsRow title="上下文压缩阈值" description="达到该 Token 数后开始压缩长对话。">
                <SettingsField><input type="number" value={uiSettings.contextTriggerTokens || 500000} onChange={(event) => onUpdateUi({ contextTriggerTokens: Number(event.target.value) })} /></SettingsField>
              </SettingsRow>
              <SettingsRow title="群聊触发 Token" description="群聊达到该长度后触发上下文处理。">
                <SettingsField><input type="number" value={uiSettings.groupChatTriggerTokens || 100000} onChange={(event) => onUpdateUi({ groupChatTriggerTokens: Number(event.target.value) })} /></SettingsField>
              </SettingsRow>
              <SettingsRow title="历史尾部消息数" description="压缩后始终保留的最近消息数量。">
                <SettingsField><input type="number" value={uiSettings.historyTailMessages || 10} onChange={(event) => onUpdateUi({ historyTailMessages: Number(event.target.value) })} /></SettingsField>
              </SettingsRow>
              <SettingsRow title="Agent 间 @ 路由上限" description="控制一轮对话中 Agent 之间允许继续转发的深度。">
                <SettingsField><select value={uiSettings.agentMentionMaxDepth === 'unlimited' ? 'unlimited' : 'fixed'} onChange={(event) => onUpdateUi({ agentMentionMaxDepth: event.target.value === 'unlimited' ? 'unlimited' : (typeof uiSettings.agentMentionMaxDepth === 'number' ? uiSettings.agentMentionMaxDepth : 2) })}><option value="fixed">固定次数</option><option value="unlimited">无限制</option></select></SettingsField>
              </SettingsRow>
              {uiSettings.agentMentionMaxDepth !== 'unlimited' && (
                <SettingsRow title="最多转发次数" description="设置固定路由模式下允许的转发次数。">
                  <SettingsField><input type="number" min="0" step="1" value={typeof uiSettings.agentMentionMaxDepth === 'number' ? uiSettings.agentMentionMaxDepth : 2} onChange={(event) => onUpdateUi({ agentMentionMaxDepth: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></SettingsField>
                </SettingsRow>
              )}
              <SettingsInlineNote>无限制模式仍会阻止重复循环，并在单轮达到 64 次 Agent 运行时自动停止。</SettingsInlineNote>
            </SettingsPanel>
            <WorkbenchResponseSettings uiSettings={uiSettings} onUpdateUi={onUpdateUi} />
            <WorkbenchProfileSyncPanel
              title={localHermesTitle}
              detail={localHermesDetail}
              hint={localHermesHint}
              canSync={canSyncHermes}
              busy={isImportingHermes}
              error={hermesError}
              onSync={onImportHermes}
            />
          </>}

          {activeSection === 'appearance' && <AppearanceSettingsPage uiSettings={uiSettings} pinnedNav={pinnedNav} onUpdateUi={onUpdateUi} onTogglePinned={onTogglePinned} />}

          {activeSection === 'privacy' && <>
            <div className="settings-head"><h2>隐私</h2></div>
            <TelemetrySettingsPanel uiSettings={uiSettings} status={telemetryStatus} onUpdateUi={onUpdateUi} />
          </>}

          {activeSection === 'models' && <ModelCenter models={models} profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || 'default'} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} onCapabilityChanged={onCapabilityChanged} />}
          {activeSection === 'skills' && <HermesModulesPage kind="skill" onStartProfileGateway={onStartProfileGateway} />}
          {activeSection === 'archivedThreads' && <ArchivedThreadsPanel threads={archivedThreads} onRefresh={onRefreshArchivedThreads} onRestore={onRestoreThread} onDelete={onDeleteThread} />}
          {activeSection === 'mcp' && <McpSettingsPage profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />}
          {activeSection === 'channels' && <ChannelsPage profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} embedded />}
          {activeSection === 'plugins' && <HermesModulesPage kind="plugin" onStartProfileGateway={onStartProfileGateway} />}
          {activeSection === 'jobs' && <JobsPage profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} embedded />}
          {activeSection === 'monitoring' && <MonitoringPage embedded />}
          {activeSection === 'vaults' && <>
            <div className="settings-head"><h2>Obsidian 仓库</h2></div>
            <div className="vault-form">
              <input value={vaultPathInput} onChange={(event) => setVaultPathInput(event.target.value)} placeholder="/Users/.../你的 Obsidian 仓库" />
              <button className="send-btn" onClick={() => void addVault()}>检测并添加</button>
            </div>
            {vaultError && <div className="form-error">{vaultError}</div>}
            <div className="vault-table">
              {vaults.map((vault) => (
                <div className="vault-row" key={vault.id}>
                  <div><strong>{vault.name}</strong><span>{vault.path}</span></div>
                  <div><strong>{vault.documentCount}</strong><span>Markdown</span></div>
                  <div><strong>{vault.productCount}</strong><span>产品文档</span></div>
                  <div><strong>{vault.lastIndexedAt ? formatTime(vault.lastIndexedAt) : '尚未索引'}</strong><span>{vault.needsRefresh ? '建议更新' : vault.status === 'not_indexed' ? '未建立索引' : '已建立索引'}</span></div>
                  <div className="vault-row-actions">
                    <button className="secondary-btn" onClick={() => void reindexVault(vault.id)} disabled={Boolean(vaultBusy[vault.id])}><RefreshCw className={vaultBusy[vault.id] === 'index' ? 'spin' : ''} size={15} />{vaultBusy[vault.id] === 'index' ? '更新中' : '更新索引'}</button>
                    <button className="icon-btn small danger vault-delete-btn" onClick={() => void deleteVault(vault)} disabled={Boolean(vaultBusy[vault.id])} aria-label={`删除仓库 ${vault.name}`} title="移除仓库连接"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </>}
      </div>
    </section>
  );
}

type ManagedModuleAction = { type: 'promote' | 'demote' | 'delete'; item: ManagedHermesModule };

function ManagedModuleAvatar({ name, avatarUrl, color }: { name: string; avatarUrl?: string; color?: string }) {
  return (
    <span className="managed-module-avatar" style={avatarUrl ? undefined : { background: color || '#64748b' }} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function HermesModulesPage({ kind, onStartProfileGateway }: { kind: ManagedHermesModuleKind; onStartProfileGateway: (profileName: string) => Promise<void> }) {
  const title = kind === 'skill' ? '技能' : '插件';
  const [payload, setPayload] = useState<ManagedHermesModulesPayload | null>(null);
  const [scope, setScope] = useState('global');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<ManagedModuleAction | null>(null);
  const [demoteTarget, setDemoteTarget] = useState('');
  const [restartProfiles, setRestartProfiles] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ item: ManagedHermesModule; content: string; loading: boolean; saving: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<ManagedHermesModulesPayload>(`/api/hermes-modules?kind=${kind}`);
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${title}读取失败。`);
    } finally {
      setLoading(false);
    }
  }, [kind, title]);

  useEffect(() => {
    setScope('global');
    setPayload(null);
    void load();
  }, [kind, load]);

  const selectedProfile = payload?.profiles.find((profile) => profile.profileName === scope) || null;
  const sourceItems = scope === 'global'
    ? payload?.global || []
    : (payload?.profile || []).filter((item) => item.profileName === scope);
  const normalizedQuery = query.trim().toLowerCase();
  const items = sourceItems.filter((item) => !normalizedQuery || `${item.name} ${item.description} ${item.category} ${item.originAgentName || ''}`.toLowerCase().includes(normalizedQuery));

  function acceptMutation(result: { modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }) {
    if (result.modules) setPayload(result.modules);
    if (result.restartRequiredProfiles?.length) setRestartProfiles(result.restartRequiredProfiles);
  }

  async function runAction(target: ManagedModuleAction) {
    const key = `${target.type}:${target.item.scope}:${target.item.name}`;
    setBusy(key);
    setError('');
    try {
      if (target.type === 'promote') {
        acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/scope', {
          method: 'POST',
          body: JSON.stringify({ action: 'promote', kind, name: target.item.name, profileName: target.item.profileName }),
        }));
        setScope('global');
      } else if (target.type === 'demote') {
        const targetProfileName = target.item.originProfileName || demoteTarget;
        acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/scope', {
          method: 'POST',
          body: JSON.stringify({ action: 'demote', kind, name: target.item.name, targetProfileName }),
        }));
        setScope(targetProfileName);
      } else {
        acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules', {
          method: 'DELETE',
          body: JSON.stringify({ kind, name: target.item.name, scope: target.item.scope, profileName: target.item.profileName }),
        }));
      }
      setAction(null);
      setDemoteTarget('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败。';
      const details = (err as Error & { details?: { conflicts?: Array<{ agentName?: string; profileName?: string }> } })?.details;
      const conflicts = details?.conflicts?.map((item) => item.agentName || item.profileName).filter(Boolean).join('、');
      setError(conflicts ? `${message} 冲突来源：${conflicts}` : message);
      setAction(null);
    } finally {
      setBusy('');
    }
  }

  async function toggle(item: ManagedHermesModule) {
    setBusy(`state:${item.name}`);
    setError('');
    try {
      acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/state', {
        method: 'PUT',
        body: JSON.stringify({ kind, name: item.name, profileName: item.profileName, enabled: !item.enabled }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态保存失败。');
    } finally {
      setBusy('');
    }
  }

  async function openEditor(item: ManagedHermesModule) {
    setEditor({ item, content: '', loading: true, saving: false });
    try {
      const params = new URLSearchParams({ kind, scope: item.scope, name: item.name, ...(item.profileName ? { profileName: item.profileName } : {}) });
      const result = await requestJson<{ content: string }>(`/api/hermes-modules/file?${params.toString()}`);
      setEditor({ item, content: result.content || '', loading: false, saving: false });
    } catch (err) {
      setEditor(null);
      setError(err instanceof Error ? err.message : '模块文件读取失败。');
    }
  }

  async function saveEditor() {
    if (!editor) return;
    setEditor({ ...editor, saving: true });
    try {
      const result = await requestJson<{ modules: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/file', {
        method: 'PUT',
        body: JSON.stringify({ kind, scope: editor.item.scope, name: editor.item.name, profileName: editor.item.profileName, content: editor.content }),
      });
      acceptMutation(result);
      setEditor(null);
    } catch (err) {
      setEditor((current) => current ? { ...current, saving: false } : current);
      setError(err instanceof Error ? err.message : '模块保存失败。');
    }
  }

  async function restartAffectedProfiles() {
    setBusy('restart');
    setError('');
    try {
      for (const profileName of restartProfiles) await onStartProfileGateway(profileName);
      setRestartProfiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent 网关重启失败。');
    } finally {
      setBusy('');
    }
  }

  function requestAction(next: ManagedModuleAction) {
    setAction(next);
    if (next.type === 'demote' && !next.item.originProfileName) setDemoteTarget(payload?.profiles[0]?.profileName || '');
  }

  const actionTitle = action?.type === 'promote' ? `将 ${action.item.name} 设为全局？`
    : action?.type === 'demote' ? `取消 ${action.item.name} 的全局共享？`
      : action ? `删除 ${action.item.name}？` : '';
  const actionDescription = action?.type === 'promote'
    ? `内容完全相同的副本会被归档，来源记录为 ${action.item.agentName || action.item.profileName}。`
    : action?.type === 'demote'
      ? '取消后只保留在接收它的 Agent 中，其他 Agent 将不再继承。'
      : '模块会移入可恢复归档，并从当前范围移除。';

  return (
    <section className="managed-modules-page" data-module-kind={kind}>
      <div className="settings-head managed-modules-head">
        <div><h2>{title}</h2><p>{kind === 'skill' ? '管理所有 Agent 的技能范围与启用状态。' : '管理所有 Agent 的插件范围与运行状态。'}</p></div>
        <button className="secondary-btn" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
      </div>

      <div className="managed-scope-strip" aria-label={`${title}范围`}>
        <button className={scope === 'global' ? 'selected' : ''} onClick={() => setScope('global')}>
          <span className="managed-global-avatar"><Sparkles size={16} /></span>
          <span><strong>全局</strong><small>{payload?.global.length || 0} 个共享{title}</small></span>
        </button>
        {(payload?.profiles || []).map((profile) => (
          <button className={scope === profile.profileName ? 'selected' : ''} key={profile.profileName} onClick={() => setScope(profile.profileName)}>
            <ManagedModuleAvatar name={profile.name} avatarUrl={profile.avatarUrl} color={profile.color} />
            <span><strong>{profile.name}</strong><small>{profile.role || profile.profileName}</small></span>
          </button>
        ))}
      </div>

      <div className="managed-module-toolbar">
        <div>
          <strong>{scope === 'global' ? `全局${title}` : `${selectedProfile?.name || scope} 的${title}`}</strong>
          <span>{scope === 'global' ? '所有 Agent 统一可用' : `另继承 ${payload?.global.length || 0} 个全局${title}`}</span>
        </div>
        <label className="managed-module-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${title}`} /></label>
      </div>

      {error && <div className="form-error managed-module-error">{error}</div>}
      {loading && !payload ? <div className="empty-state">正在读取{title}...</div> : items.length ? (
        <div className="managed-module-list">
          {items.map((item) => {
            const itemBusy = busy.includes(item.name);
            const duplicates = item.duplicateProfileNames || [];
            return (
              <article className="managed-module-row" key={`${item.scope}-${item.profileName}-${item.name}`}>
                <div className="managed-module-main">
                  <div className="managed-module-title">
                    <span className={item.enabled ? 'managed-state-dot enabled' : 'managed-state-dot'} />
                    <strong>{item.name}</strong>
                    <em className={item.enabled ? 'enabled' : ''}>{item.enabled ? '已启用' : '未启用'}</em>
                  </div>
                  <p>{item.description || `这个${title}暂时没有描述。`}</p>
                  <div className="managed-module-meta">
                    <span>{item.scope === 'global' ? '全局共享' : 'Agent 独有'}</span>
                    {item.category && <span>{item.category}</span>}
                    {duplicates.length > 0 && <span>{duplicates.length + 1} 个相同副本</span>}
                    {item.scope === 'global' && (
                      <span className="managed-module-origin">
                        {item.originAgentName ? <ManagedModuleAvatar name={item.originAgentName} avatarUrl={item.originAvatarUrl} color={item.originColor} /> : <span className="managed-origin-native"><Sparkles size={11} /></span>}
                        来源：{item.originAgentName || '原生全局'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="managed-module-actions">
                  {item.scope === 'profile' && (
                    <label className="module-switch" title={item.enabled ? '已启用' : '未启用'}>
                      <input type="checkbox" checked={item.enabled} disabled={itemBusy} onChange={() => void toggle(item)} />
                      <span />
                    </label>
                  )}
                  <button className="secondary-btn" onClick={() => void openEditor(item)} disabled={itemBusy}><Pencil size={14} />编辑</button>
                  {item.scope === 'profile'
                    ? <button className="secondary-btn" onClick={() => requestAction({ type: 'promote', item })} disabled={itemBusy}><ArrowUpFromLine size={14} />设为全局</button>
                    : <button className="secondary-btn" onClick={() => requestAction({ type: 'demote', item })} disabled={itemBusy}><ArrowDownToLine size={14} />取消全局</button>}
                  <button className="secondary-btn danger" onClick={() => requestAction({ type: 'delete', item })} disabled={itemBusy}><Trash2 size={14} />删除</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state">{normalizedQuery ? `没有匹配的${title}。` : scope === 'global' ? `还没有全局${title}。` : `这个 Agent 还没有独有${title}。`}</div>}

      {action && (
        <AppAlertDialog open onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
          <AppAlertDialogContent>
            <AppAlertDialogTitle className="app-alert-title">{actionTitle}</AppAlertDialogTitle>
            <AppAlertDialogDescription className="app-alert-description">
              <strong>{action.item.name}</strong>
              <span>{actionDescription}</span>
            </AppAlertDialogDescription>
            {action.type === 'demote' && !action.item.originProfileName && (
              <label className="managed-demote-target">接收 Agent<select value={demoteTarget} onChange={(event) => setDemoteTarget(event.target.value)}>{(payload?.profiles || []).map((profile) => <option value={profile.profileName} key={profile.profileName}>{profile.name}</option>)}</select></label>
            )}
            <div className="app-alert-actions">
              <AppAlertDialogCancel className="cancel" onClick={() => setAction(null)}>取消</AppAlertDialogCancel>
              <AppAlertDialogAction className={action.type === 'delete' ? 'danger' : ''} disabled={Boolean(busy) || (action.type === 'demote' && !action.item.originProfileName && !demoteTarget)} onClick={() => void runAction(action)}>
                {action.type === 'promote' ? '设为全局' : action.type === 'demote' ? '取消全局' : '删除'}
              </AppAlertDialogAction>
            </div>
          </AppAlertDialogContent>
        </AppAlertDialog>
      )}

      {restartProfiles.length > 0 && (
        <AppAlertDialog open onOpenChange={(open) => { if (!open && busy !== 'restart') setRestartProfiles([]); }}>
          <AppAlertDialogContent>
            <AppAlertDialogTitle className="app-alert-title">重启受影响的 Agent？</AppAlertDialogTitle>
            <AppAlertDialogDescription className="app-alert-description">
              <strong>{restartProfiles.map((profileName) => payload?.profiles.find((profile) => profile.profileName === profileName)?.name || profileName).join('、')}</strong>
              <span>插件配置已保存。重启这些网关后立即生效；取消则在下次启动时生效。</span>
            </AppAlertDialogDescription>
            <div className="app-alert-actions">
              <AppAlertDialogCancel className="cancel" onClick={() => setRestartProfiles([])}>下次启动生效</AppAlertDialogCancel>
              <AppAlertDialogAction disabled={busy === 'restart'} onClick={() => void restartAffectedProfiles()}>{busy === 'restart' ? '重启中' : '立即重启'}</AppAlertDialogAction>
            </div>
          </AppAlertDialogContent>
        </AppAlertDialog>
      )}

      {editor && (
        <AppDialog open onOpenChange={(open) => { if (!open && !editor.saving) setEditor(null); }}>
          <AppDialogContent className="managed-module-editor-dialog">
            <div className="modal-head"><div><AppDialogTitle>{editor.item.name}</AppDialogTitle><AppDialogDescription>{editor.item.scope === 'global' ? '全局' : editor.item.agentName || editor.item.profileName} · {kind === 'skill' ? 'SKILL.md' : '插件清单'}</AppDialogDescription></div><AppDialogClose className="icon-btn" aria-label="关闭"><X size={18} /></AppDialogClose></div>
            {editor.loading ? <div className="empty-state">正在读取文件...</div> : <textarea value={editor.content} onChange={(event) => setEditor((current) => current ? { ...current, content: event.target.value } : current)} disabled={editor.saving} spellCheck={false} />}
            <div className="modal-actions"><button className="secondary-btn" onClick={() => setEditor(null)} disabled={editor.saving}>取消</button><button className="send-btn" onClick={() => void saveEditor()} disabled={editor.loading || editor.saving}>{editor.saving ? '保存中' : '保存'}</button></div>
          </AppDialogContent>
        </AppDialog>
      )}
    </section>
  );
}

function HermesModuleMatrix({ agents, profiles }: { agents: Agent[]; profiles: HermesProfile[] }) {
  const [mode, setMode] = useState<'skills' | 'plugins'>('skills');
  const rows = profiles.length
    ? profiles.map((profile) => ({
      id: profile.name,
      name: profile.displayName || profile.name,
      color: profileColor(profile.name),
      source: profile.path || profile.name,
      skills: profile.skills || [],
      plugins: profile.plugins || [],
    }))
    : agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      color: agent.color,
      source: agent.profileName || agent.source || 'manual',
      skills: agent.skills || [],
      plugins: agent.plugins || [],
    }));
  return (
    <div className="module-matrix">
      <div className="module-matrix-tabs">
        <button className={mode === 'skills' ? 'selected' : ''} onClick={() => setMode('skills')}>技能</button>
        <button className={mode === 'plugins' ? 'selected' : ''} onClick={() => setMode('plugins')}>插件</button>
      </div>
      <div className="module-matrix-list">
        {rows.map((row) => {
          const items = mode === 'skills' ? row.skills : row.plugins;
          const enabledCount = items.filter((item) => moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled').length;
          return (
            <div className="module-matrix-row" key={row.id}>
              <div><span className="node-dot" style={{ background: row.color }} /><strong>{row.name}</strong><small>{row.source}</small></div>
              <div>
                {items.length ? <strong className="module-count">{enabledCount}/{items.length} 已启用</strong> : <em>未配置{mode === 'skills' ? '技能' : '插件'}</em>}
                {items.length ? items.slice(0, 12).map((item) => (
                  <span className={moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled' ? 'enabled' : 'disabled'} key={moduleEntryName(item)}>
                    {moduleEntryName(item)}
                  </span>
                )) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type PluginCenterFilter = 'all' | 'enabled' | 'disabled' | 'global' | 'profile';
type AggregatedPlugin = {
  name: string;
  sources: string[];
  files: string[];
  installedProfiles: string[];
  enabledProfiles: string[];
  categories: string[];
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt: string | null;
};

function PluginsPage({ agents, profiles, embedded = false }: { agents: Agent[]; profiles: HermesProfile[]; embedded?: boolean }) {
  const [filter, setFilter] = useState<PluginCenterFilter>('all');
  const [query, setQuery] = useState('');
  const rows = profiles.length
    ? profiles.map((profile) => ({
      id: profile.name,
      name: profile.displayName || profile.name,
      source: profile.path || profile.name,
      plugins: profile.plugins || [],
    }))
    : agents.map((agent) => ({
      id: agent.id,
      name: agent.profileName || agent.name,
      source: agent.source || agent.profileName || agent.name,
      plugins: agent.plugins || [],
    }));
  const plugins = aggregatePlugins(rows);
  const enabledCount = plugins.filter((plugin) => plugin.enabledProfiles.length > 0).length;
  const globalCount = plugins.filter((plugin) => plugin.sources.includes('global')).length;
  const profileCount = plugins.filter((plugin) => plugin.sources.includes('profile')).length;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = plugins.filter((plugin) => {
    const enabled = plugin.enabledProfiles.length > 0;
    const matchesFilter =
      filter === 'all'
      || (filter === 'enabled' && enabled)
      || (filter === 'disabled' && !enabled)
      || (filter === 'global' && plugin.sources.includes('global'))
      || (filter === 'profile' && plugin.sources.includes('profile'));
    const haystack = [
      plugin.name,
      ...plugin.sources,
      ...plugin.files,
      ...plugin.installedProfiles,
      ...plugin.categories,
    ].join(' ').toLowerCase();
    return matchesFilter && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  return (
    <section className={embedded ? 'embedded-management-page plugins-page' : 'management-page plugins-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>插件中心</h2></div>
      </div>

      <div className="plugin-stats">
        <article><span>插件总数</span><strong>{plugins.length}</strong><small>同名插件已合并</small></article>
        <article><span>已启用</span><strong>{enabledCount}</strong><small>至少一个 Profile 启用</small></article>
        <article><span>全局插件</span><strong>{globalCount}</strong><small>来自 Hermes 全局目录</small></article>
        <article><span>本地 Profile</span><strong>{profileCount}</strong><small>来自 Profile 插件目录</small></article>
      </div>

      <div className="plugin-toolbar">
        <div className="plugin-filter">
          {([
            ['all', '全部'],
            ['enabled', '已启用'],
            ['disabled', '未启用'],
            ['global', '全局'],
            ['profile', '本地 Profile'],
          ] as const).map(([value, label]) => (
            <button className={filter === value ? 'selected' : ''} key={value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <label className="plugin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索插件、来源、路径或 Profile" />
        </label>
      </div>

      {filtered.length ? (
        <div className="plugin-grid">
          {filtered.map((plugin) => {
            const enabled = plugin.enabledProfiles.length > 0;
            const usageTotal = plugin.useCount + plugin.viewCount + plugin.patchCount;
            return (
              <article className="plugin-card" key={plugin.name}>
                <div className="plugin-card-head">
                  <div>
                    <strong>{plugin.name}</strong>
                    <span>{plugin.sources.includes('global') ? 'global' : 'profile'} · {plugin.installedProfiles.length} profiles</span>
                  </div>
                  <em className={enabled ? 'enabled' : ''}>{enabled ? '已启用' : '未启用'}</em>
                </div>
                <div className="plugin-meta">
                  <span>启用 {plugin.enabledProfiles.length}/{plugin.installedProfiles.length}</span>
                  <span>使用 {formatCompactNumber(usageTotal)}</span>
                  {plugin.lastUsedAt && <span>最近 {formatTime(plugin.lastUsedAt)}</span>}
                </div>
                <p>{plugin.files[0] || '未提供插件清单路径'}</p>
                <div className="plugin-tags">
                  {plugin.sources.map((source) => <span key={source}>{source}</span>)}
                  {plugin.installedProfiles.slice(0, 5).map((profile) => <span key={profile}>{profile}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">当前没有匹配的插件。</div>
      )}
    </section>
  );
}

function aggregatePlugins(rows: Array<{ id: string; name: string; source: string; plugins: ProfileModuleEntry[] }>) {
  const byName = new Map<string, AggregatedPlugin>();
  for (const row of rows) {
    for (const item of row.plugins || []) {
      const name = moduleEntryName(item);
      if (!name) continue;
      const usage = moduleEntryUsage(item);
      const source = moduleEntrySource(item) || 'profile';
      const file = typeof item === 'string' ? '' : item.file || '';
      const category = moduleEntryCategory(item);
      const enabled = moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled';
      const current = byName.get(name) || {
        name,
        sources: [],
        files: [],
        installedProfiles: [],
        enabledProfiles: [],
        categories: [],
        useCount: 0,
        viewCount: 0,
        patchCount: 0,
        lastUsedAt: null,
      };
      if (!current.sources.includes(source)) current.sources.push(source);
      if (file && !current.files.includes(file)) current.files.push(file);
      if (category && !current.categories.includes(category)) current.categories.push(category);
      if (!current.installedProfiles.includes(row.name)) current.installedProfiles.push(row.name);
      if (enabled && !current.enabledProfiles.includes(row.name)) current.enabledProfiles.push(row.name);
      current.useCount += usage.useCount || 0;
      current.viewCount += usage.viewCount || 0;
      current.patchCount += usage.patchCount || 0;
      if (usage.lastUsedAt && (!current.lastUsedAt || usage.lastUsedAt.localeCompare(current.lastUsedAt) > 0)) current.lastUsedAt = usage.lastUsedAt;
      byName.set(name, current);
    }
  }
  return Array.from(byName.values()).sort((a, b) => {
    const scoreA = a.enabledProfiles.length * 1000 + a.useCount + a.viewCount + a.patchCount;
    const scoreB = b.enabledProfiles.length * 1000 + b.useCount + b.viewCount + b.patchCount;
    return scoreB - scoreA || a.name.localeCompare(b.name);
  });
}

function modelChoiceValue(model: ModelProfile, modelName = model.model) {
  return `${model.id}::${modelName || model.model}`;
}

function splitModelChoiceValue(value: string) {
  const separator = '::';
  if (!value.includes(separator)) return { modelId: value, modelName: '' };
  const [modelId, ...rest] = value.split(separator);
  return { modelId, modelName: rest.join(separator) };
}

function modelNamesForProvider(model: ModelProfile) {
  return Array.from(new Set([...(model.models || []), model.model].map((item) => String(item || '').trim()).filter(Boolean)));
}

function resolveModelChoice(value: string, models: ModelProfile[]) {
  const clean = String(value || '').trim();
  const { modelId, modelName } = splitModelChoiceValue(clean);
  const model = models.find((item) => item.id === modelId)
    || models.find((item) => [item.id, item.name, item.model].includes(clean))
    || models.find((item) => modelNamesForProvider(item).includes(modelName || clean));
  const resolvedName = modelName || (model && modelNamesForProvider(model).includes(clean) ? clean : model?.model) || '';
  return { model: model || null, modelName: resolvedName, value: model ? modelChoiceValue(model, resolvedName || model.model) : clean };
}

type ProviderModelMenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  openAbove: boolean;
  submenuSide: 'left' | 'right';
};

function calculateProviderModelMenuPlacement(trigger: DOMRect, viewportWidth: number, viewportHeight: number, advanced: boolean): ProviderModelMenuPlacement {
  const gap = 8;
  const margin = 12;
  const narrow = viewportWidth < 720;
  const rootPanelWidth = 260;
  const subPanelWidth = 300;
  const singlePanelWidth = Math.min(subPanelWidth, viewportWidth - margin * 2);
  const width = advanced && !narrow ? rootPanelWidth : singlePanelWidth;
  const minLeft = margin;
  const maxLeft = Math.max(minLeft, viewportWidth - width - margin);
  const desiredLeft = Math.max(minLeft, Math.min(maxLeft, trigger.right - width));
  let left = desiredLeft;
  let submenuSide: 'left' | 'right' = 'right';

  if (advanced && !narrow) {
    const rightLimit = viewportWidth - margin - rootPanelWidth - gap - subPanelWidth;
    const leftLimit = margin + subPanelWidth + gap;
    const rightFits = desiredLeft <= rightLimit;
    const leftFits = desiredLeft >= leftLimit;

    if (!rightFits && leftFits) {
      submenuSide = 'left';
    } else if (!rightFits && !leftFits) {
      const rightCandidate = Math.max(minLeft, Math.min(maxLeft, rightLimit));
      const leftCandidate = Math.max(minLeft, Math.min(maxLeft, leftLimit));
      const rightDistance = Math.abs(desiredLeft - rightCandidate);
      const leftDistance = Math.abs(desiredLeft - leftCandidate);
      if (rightDistance <= leftDistance) {
        left = rightCandidate;
      } else {
        left = leftCandidate;
        submenuSide = 'left';
      }
    }
  }

  const above = Math.max(0, trigger.top - gap - margin);
  const below = Math.max(0, viewportHeight - trigger.bottom - gap - margin);
  const openAbove = above >= Math.min(180, below) || above > below;
  return {
    left,
    width,
    maxHeight: Math.max(0, Math.min(460, openAbove ? above : below)),
    openAbove,
    submenuSide,
  };
}

function ProviderModelPicker({ models, value, onChange, agentName = '', emptyLabel = '未配置模型', className = '', ariaLabel = '切换模型', title = '切换模型', allowDefault = false, usingDefault = false, capabilities, runOverride, onRunOverrideChange }: { models: ModelProfile[]; value: string; onChange: (value: string) => void | Promise<void>; agentName?: string; emptyLabel?: string; className?: string; ariaLabel?: string; title?: string; allowDefault?: boolean; usingDefault?: boolean; capabilities?: Record<string, ModelCapability>; runOverride?: AgentRunOverride; onRunOverrideChange?: (override: AgentRunOverride) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'root' | 'model' | 'reasoning' | 'speed'>('model');
  const [saving, setSaving] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [submenuSide, setSubmenuSide] = useState<'left' | 'right'>('right');
  const [openAbove, setOpenAbove] = useState(true);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const providers = models.filter((model) => model.baseUrl && modelNamesForProvider(model).length);
  const selected = resolveModelChoice(value, providers);
  const selectedLabel = selected.modelName || selected.model?.model || emptyLabel;
  const advanced = Boolean(capabilities && runOverride && onRunOverrideChange);
  const selectedCapability = capabilities?.[selected.value];
  const reasoningLabels: Record<string, string> = { off: '关闭', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极致' };
  const reasoningLabel = runOverride?.reasoningEffort ? reasoningLabels[runOverride.reasoningEffort] || runOverride.reasoningEffort : '跟随 Agent';
  const selectedTier = selectedCapability?.serviceTiers.find((tier) => tier.id === runOverride?.speedMode || runOverride?.speedMode === 'fast');
  const speedLabel = selectedCapability?.serviceTiers.length
    ? selectedTier?.name || (runOverride?.speedMode === 'standard' ? '标准' : '跟随 Agent')
    : selectedCapability?.serviceTierStatus === 'unsupported' ? '该模型不支持' : '能力未确认';

  const positionMenu = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const gap = 8;
    const placement = calculateProviderModelMenuPlacement(trigger, window.innerWidth, window.innerHeight, advanced);
    setSubmenuSide(placement.submenuSide);
    setOpenAbove(placement.openAbove);
    setMenuStyle({
      left: placement.left,
      width: placement.width,
      maxHeight: placement.maxHeight,
      ...(placement.openAbove ? { bottom: window.innerHeight - trigger.top + gap, top: 'auto' } : { top: trigger.bottom + gap, bottom: 'auto' }),
    });
  }, [advanced]);

  useLayoutEffect(() => {
    if (open) positionMenu();
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('.provider-model-trigger')?.focus();
      }
    }
    function handleViewportChange() { positionMenu(); }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, positionMenu]);

  function openPicker() {
    setSection(advanced ? 'root' : 'model');
    setOpen((current) => !current);
  }

  async function commitChoice(action: () => void | Promise<void>, closeAfterSave = false) {
    if (saving) return;
    setSaving(true);
    try {
      await action();
      if (closeAfterSave) setOpen(false);
    } catch {
      // The persisted state remains visible; users can select again after a transient failure.
    } finally {
      setSaving(false);
    }
  }

  function chooseModel(nextValue: string) {
    void commitChoice(() => onChange(nextValue), !advanced);
  }

  function chooseRunOverride(nextOverride: AgentRunOverride) {
    if (!onRunOverrideChange) return;
    void commitChoice(() => onRunOverrideChange(nextOverride));
  }

  const modelPanel = (
    <section className="provider-model-subpanel provider-model-list-panel">
      <header><button type="button" onClick={() => setSection('root')} disabled={saving} aria-label="返回"><ArrowLeft size={15} /></button><strong>模型</strong></header>
      <div className="provider-model-scroll">
        {allowDefault && (
          <button type="button" className={`provider-model-follow-default ${usingDefault ? 'selected' : ''}`} onClick={() => chooseModel('')} disabled={saving} title="默认模型变化时同步更新">
            <span>跟随 Agent 默认模型</span>{usingDefault && <Check size={14} aria-hidden="true" />}
          </button>
        )}
        {providers.length ? providers.map((provider) => (
          <section className="provider-model-group" key={provider.id}>
            <strong>{provider.name || provider.provider}</strong>
            <div>{modelNamesForProvider(provider).map((modelName) => {
              const itemValue = modelChoiceValue(provider, modelName);
              const isSelected = selected.value === itemValue;
              return <button type="button" className={isSelected ? 'selected' : ''} key={itemValue} onClick={() => chooseModel(itemValue)} disabled={saving}><span>{modelName}</span>{isSelected && <Check size={14} aria-hidden="true" />}</button>;
            })}</div>
          </section>
        )) : <span className="provider-model-empty">{emptyLabel}</span>}
      </div>
    </section>
  );

  const reasoningPanel = (
    <section className="provider-model-subpanel">
      <header><button type="button" onClick={() => setSection('root')} disabled={saving} aria-label="返回"><ArrowLeft size={15} /></button><strong>推理强度</strong></header>
      <div className="provider-setting-options">
        <button className={!runOverride?.reasoningEffort ? 'selected' : ''} onClick={() => chooseRunOverride({ ...runOverride, reasoningEffort: undefined })} disabled={saving} title="不发送推理强度覆盖参数"><span>跟随 Agent</span>{!runOverride?.reasoningEffort && <Check size={14} aria-hidden="true" />}</button>
        {(selectedCapability?.reasoningEfforts || []).map((effort) => { const isSelected = runOverride?.reasoningEffort === effort; return <button className={isSelected ? 'selected' : ''} key={effort} onClick={() => chooseRunOverride({ ...runOverride, reasoningEffort: effort })} disabled={saving}><span>{reasoningLabels[effort] || effort}</span>{isSelected && <Check size={14} aria-hidden="true" />}</button>; })}
      </div>
    </section>
  );

  const speedPanel = (
    <section className="provider-model-subpanel">
      <header><button type="button" onClick={() => setSection('root')} disabled={saving} aria-label="返回"><ArrowLeft size={15} /></button><strong>速度</strong></header>
      <div className="provider-setting-options">
        <button className={!runOverride?.speedMode ? 'selected' : ''} onClick={() => chooseRunOverride({ ...runOverride, speedMode: undefined })} disabled={saving} title="不发送速度覆盖参数"><span>跟随 Agent</span>{!runOverride?.speedMode && <Check size={14} aria-hidden="true" />}</button>
        <button className={runOverride?.speedMode === 'standard' ? 'selected' : ''} onClick={() => chooseRunOverride({ ...runOverride, speedMode: 'standard' })} disabled={saving}><span>标准</span>{runOverride?.speedMode === 'standard' && <Check size={14} aria-hidden="true" />}</button>
        {(selectedCapability?.serviceTiers || []).map((tier) => { const isSelected = runOverride?.speedMode === tier.id || runOverride?.speedMode === 'fast'; return <button className={isSelected ? 'selected' : ''} key={tier.id} onClick={() => chooseRunOverride({ ...runOverride, speedMode: tier.id })} disabled={saving} title={tier.billingNotice || tier.description || tier.name}><span>{tier.name}</span>{isSelected && <Check size={14} aria-hidden="true" />}</button>; })}
      </div>
    </section>
  );

  const rootPanel = advanced ? (
    <section className="provider-model-root-panel">
      <button type="button" className={section === 'model' ? 'active' : ''} onClick={() => setSection('model')} disabled={saving}><span>模型</span><em>{selectedLabel}</em><ChevronRight size={14} /></button>
      <button type="button" className={section === 'reasoning' ? 'active' : ''} onClick={() => setSection('reasoning')} disabled={saving || !selectedCapability?.reasoning} title={selectedCapability?.reasoning ? '调整当前运行的推理强度' : selectedCapability?.reasoningStatus === 'unsupported' ? '该模型不支持' : '能力未确认'}><span>推理强度</span><em>{selectedCapability?.reasoning ? reasoningLabel : selectedCapability?.reasoningStatus === 'unsupported' ? '不支持' : '未确认'}</em><ChevronRight size={14} /></button>
      <button type="button" className={section === 'speed' ? 'active' : ''} onClick={() => setSection('speed')} disabled={saving || !selectedCapability?.serviceTiers.length} title={speedLabel}><span>速度</span><em>{selectedCapability?.serviceTiers.length ? speedLabel : selectedCapability?.serviceTierStatus === 'unsupported' ? '不支持' : '未确认'}</em><ChevronRight size={14} /></button>
    </section>
  ) : null;

  return (
    <div className={`provider-model-picker ${className}`} ref={rootRef}>
      <button type="button" className="provider-model-trigger" onClick={openPicker} disabled={!providers.length} aria-label={ariaLabel} title={title} aria-expanded={open} aria-controls={open ? menuId : undefined}>
        {agentName && <span>{agentName}</span>}
        <strong>{selectedLabel}{advanced && runOverride?.reasoningEffort ? ` · ${reasoningLabel}` : ''}</strong>
        <ChevronDown size={14} />
      </button>
      {open && createPortal(<div id={menuId} className={`provider-model-menu ${advanced ? 'advanced' : ''} ${section === 'root' ? 'root-only' : ''} submenu-${submenuSide} ${openAbove ? 'opens-above' : 'opens-below'}`} ref={menuRef} style={menuStyle} role="dialog" aria-label={title}>
        {rootPanel}
        {section === 'model' && modelPanel}
        {section === 'reasoning' && reasoningPanel}
        {section === 'speed' && speedPanel}
      </div>, document.body)}
    </div>
  );
}

type ModelSlotGroup = { provider: string; label: string; models: string[] };

function useModelSlotGroups(models: ModelProfile[]) {
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/model-providers/presets').then((res) => res.json()).then((data: { providers?: ProviderPreset[] }) => {
      if (!cancelled) setPresets(Array.isArray(data.providers) ? data.providers : []);
    }).catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => {
    const groups = new Map<string, ModelSlotGroup>();
    for (const preset of presets) {
      if (!preset.value || preset.value.toLowerCase() === 'moa') continue;
      groups.set(preset.value, { provider: preset.value, label: preset.label || preset.value, models: [...(preset.models || [])] });
    }
    for (const model of models) {
      const matchedPreset = presets.find((preset) => preset.value === model.providerKey || (model.baseUrl && preset.baseUrl === model.baseUrl));
      const provider = model.providerKey || matchedPreset?.value || '';
      if (!provider || provider.toLowerCase() === 'moa') continue;
      const current = groups.get(provider) || { provider, label: provider.startsWith('custom:') ? (model.name || model.provider || provider) : (matchedPreset?.label || model.provider || model.name || provider), models: [] };
      current.models = Array.from(new Set([...current.models, ...modelNamesForProvider(model)]));
      groups.set(provider, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [models, presets]);
}

function ModelIdCombobox({ value, options, onChange, placeholder = '选择或输入模型 ID' }: { value: string; options: string[]; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedOptions = Array.from(new Set(options.map((item) => String(item || '').trim()).filter(Boolean)));
  const filteredOptions = normalizedOptions.filter((item) => !value.trim() || item.toLowerCase().includes(value.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="model-id-combobox" ref={rootRef}>
      <div className="model-id-combobox-input">
        <input
          value={value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'ArrowDown') setOpen(true);
            if (event.key === 'Enter' && open && filteredOptions.length === 1) {
              event.preventDefault();
              onChange(filteredOptions[0]);
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <button type="button" onClick={() => setOpen((current) => !current)} aria-label="展开模型列表"><ChevronDown size={15} /></button>
      </div>
      {open && (
        <div className="model-id-combobox-menu" role="listbox">
          {filteredOptions.length ? filteredOptions.map((item) => (
            <button type="button" className={item === value ? 'selected' : ''} key={item} onClick={() => { onChange(item); setOpen(false); }}>{item}</button>
          )) : <span>没有匹配项，可直接输入模型 ID</span>}
        </div>
      )}
    </div>
  );
}

function AuxiliaryModelsPanel({ profile, groups }: { profile: string; groups: ModelSlotGroup[] }) {
  const [tasks, setTasks] = useState<AuxiliaryModelTask[]>([]);
  const [auxiliary, setAuxiliary] = useState<AuxiliaryModelsConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ task: AuxiliaryModelTask; settings: AuxiliaryModelSettings; extraBody: string } | null>(null);

  async function load() {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ tasks: AuxiliaryModelTask[]; auxiliary: AuxiliaryModelsConfig }>(`/api/hermes/config/auxiliary-models?profile=${encodeURIComponent(profile)}`);
      setTasks(data.tasks || []);
      setAuxiliary(data.auxiliary || {});
    } catch (err: any) {
      setError(err.message || '辅助模型配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [profile]);

  function openEditor(task: AuxiliaryModelTask) {
    const current = auxiliary[task.key] || {};
    setEditing({
      task,
      settings: {
        provider: current.provider || 'auto',
        model: current.model || '',
        timeout: current.timeout || task.default_timeout,
        download_timeout: task.key === 'vision' ? (current.download_timeout || task.default_download_timeout) : undefined,
      },
      extraBody: current.extra_body ? JSON.stringify(current.extra_body, null, 2) : '',
    });
  }

  async function persist(task: AuxiliaryModelTask, settings: AuxiliaryModelSettings) {
    setSaving(true);
    setError('');
    try {
      const data = await requestJson<{ auxiliary: AuxiliaryModelsConfig }>(`/api/hermes/config/auxiliary-models?profile=${encodeURIComponent(profile)}`, {
        method: 'PUT',
        body: JSON.stringify({ auxiliary: { [task.key]: settings } }),
      });
      setAuxiliary(data.auxiliary || {});
      setEditing(null);
    } catch (err: any) {
      setError(err.message || '辅助模型配置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveEditor() {
    if (!editing) return;
    let extraBody: Record<string, any> | undefined;
    if (editing.extraBody.trim()) {
      try {
        const parsed = JSON.parse(editing.extraBody);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        extraBody = parsed;
      } catch {
        setError('Extra body 必须是 JSON 对象。');
        return;
      }
    }
    await persist(editing.task, { ...editing.settings, ...(extraBody ? { extra_body: extraBody } : {}) });
  }

  function configLabel(settings: AuxiliaryModelSettings = {}) {
    if (settings.base_url) return `自定义端点${settings.model ? ` / ${settings.model}` : ''}`;
    const provider = settings.provider || 'auto';
    if (provider === 'auto') return '自动';
    if (provider === 'main') return '主模型';
    return `${provider}${settings.model ? ` / ${settings.model}` : ''}`;
  }

  function timeoutLabel(task: AuxiliaryModelTask, settings: AuxiliaryModelSettings = {}) {
    const values = [`${settings.timeout || task.default_timeout || '-'}s`];
    if (task.key === 'vision') values.push(`下载 ${settings.download_timeout || task.default_download_timeout || '-'}s`);
    return values.join(' / ');
  }

  const editingGroup = groups.find((group) => group.provider === editing?.settings.provider);
  return (
    <section className="model-routing-panel">
      <div className="model-routing-head"><div><h3>辅助模型</h3><p>为压缩、视觉、审批、MCP 和后台维护等任务单独指定模型。</p></div><button className="secondary-btn" onClick={() => void load()} disabled={loading}>{loading ? '刷新中' : '刷新'}</button></div>
      {error && <div className="form-error">{error}</div>}
      <div className="model-routing-table auxiliary-routing-table">
        <div className="model-routing-row head"><span>任务</span><span>Provider / 默认模型</span><span>超时</span><span>操作</span></div>
        {tasks.map((task) => <div className="model-routing-row" key={task.key}><strong>{task.label}</strong><span className="mono-cell">{configLabel(auxiliary[task.key])}</span><span className="mono-cell">{timeoutLabel(task, auxiliary[task.key])}</span><span className="row-actions"><button onClick={() => openEditor(task)}>编辑</button><button disabled={saving} onClick={() => void persist(task, { provider: 'auto', timeout: task.default_timeout, ...(task.key === 'vision' ? { download_timeout: task.default_download_timeout } : {}) })}>清除</button></span></div>)}
      </div>
      {editing && <div className="modal-backdrop" onClick={() => !saving && setEditing(null)}><div className="modal model-routing-modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><h2>{editing.task.label}</h2><p>正在编辑 Profile：{profile}</p></div><button className="icon-btn" onClick={() => setEditing(null)}><X size={18} /></button></div><div className="routing-form-grid">
        <label>Provider<select value={editing.settings.provider || 'auto'} onChange={(event) => setEditing((current) => current ? { ...current, settings: { ...current.settings, provider: event.target.value, model: '' } } : current)}><option value="auto">自动</option><option value="main">主模型</option>{groups.map((group) => <option value={group.provider} key={group.provider}>{group.label}</option>)}</select></label>
        <label>模型{['auto', 'main'].includes(editing.settings.provider || 'auto')
          ? <span className="auxiliary-model-inherited">{editing.settings.provider === 'main' ? '直接使用当前 Agent 的主模型，无需另选模型。' : '由 Hermes 自动选择当前任务的模型，无需另选模型。'}</span>
          : <ModelIdCombobox value={editing.settings.model || ''} options={editingGroup?.models || []} onChange={(value) => setEditing((current) => current ? { ...current, settings: { ...current.settings, model: value } } : current)} />}</label>
        <label>调用超时（秒）<input type="number" min="1" value={editing.settings.timeout || ''} onChange={(event) => setEditing((current) => current ? { ...current, settings: { ...current.settings, timeout: Number(event.target.value) } } : current)} /></label>
        {editing.task.key === 'vision' && <label>下载超时（秒）<input type="number" min="1" value={editing.settings.download_timeout || ''} onChange={(event) => setEditing((current) => current ? { ...current, settings: { ...current.settings, download_timeout: Number(event.target.value) } } : current)} /></label>}
        <label className="wide-field">Extra body JSON<textarea rows={5} value={editing.extraBody} onChange={(event) => setEditing((current) => current ? { ...current, extraBody: event.target.value } : current)} /></label>
      </div><div className="modal-actions"><button className="secondary-btn" onClick={() => setEditing(null)}>取消</button><button className="send-btn" disabled={saving} onClick={() => void saveEditor()}>{saving ? '保存中' : '保存'}</button></div></div></div>}
    </section>
  );
}

function ModelConfigPage({ models, profiles, defaultProfile, modelError, saveModel, deleteModel, fetchAvailableModels, onCapabilityChanged }: { models: ModelProfile[]; profiles: HermesProfile[]; defaultProfile: string; modelError: string; saveModel: SaveModel; deleteModel: (modelId: string) => Promise<boolean>; fetchAvailableModels: FetchAvailableModels; onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void }) {
  return (
    <section className="settings-page">
      <ModelCenter models={models} profiles={profiles} defaultProfile={defaultProfile} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} onCapabilityChanged={onCapabilityChanged} />
    </section>
  );
}

function ModelCenter({ models, profiles, defaultProfile, modelError, saveModel, deleteModel, fetchAvailableModels, onCapabilityChanged }: { models: ModelProfile[]; profiles: HermesProfile[]; defaultProfile: string; modelError: string; saveModel: SaveModel; deleteModel: (modelId: string) => Promise<boolean>; fetchAvailableModels: FetchAvailableModels; onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void }) {
  const [activeTab, setActiveTab] = useState<'general' | 'accounts' | 'auxiliary'>('general');
  const [profile, setProfile] = useState(defaultProfile || profiles[0]?.name || 'default');
  const [editingModel, setEditingModel] = useState<ModelProfile | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [runtimeCatalogs, setRuntimeCatalogs] = useState<Record<string, RuntimeModelCatalog>>({});
  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccount[]>([]);
  const [oauthAccountsApiError, setOauthAccountsApiError] = useState('');
  const slotGroups = useModelSlotGroups(models);
  useEffect(() => { if (!profiles.some((item) => item.name === profile)) setProfile(defaultProfile || profiles[0]?.name || 'default'); }, [profiles.map((item) => item.name).join(','), defaultProfile]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(['hermes', 'pi'].map(async (runtimeId) => {
      try {
        const response = await fetch(`/api/runtimes/${runtimeId}/models`);
        const data = await response.json().catch(() => ({}));
        return response.ok ? [runtimeId, data as RuntimeModelCatalog] as const : null;
      } catch {
        return null;
      }
    })).then((catalogs) => {
      if (!cancelled) setRuntimeCatalogs(Object.fromEntries(catalogs.filter(Boolean) as Array<readonly [string, RuntimeModelCatalog]>));
    });
    return () => { cancelled = true; };
  }, [models.map((model) => `${model.id}:${model.runtimeRevision || ''}`).join('|')]);
  const refreshAccounts = async () => {
    try {
      const response = await fetch('/api/oauth-accounts');
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setOauthAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        setOauthAccountsApiError('');
      } else if (response.status === 404) {
        setOauthAccountsApiError('本地 API 仍是旧版本。请重启开发桌面服务后再管理授权账户。');
      } else {
        setOauthAccountsApiError(data.error || '授权账户状态读取失败。');
      }
    } catch {
      setOauthAccountsApiError('无法连接 Frakio Work 本地 API。请重启开发桌面服务。');
    }
  };
  useEffect(() => { void refreshAccounts(); }, [models.map((model) => `${model.id}:${model.oauthAccountId || ''}`).join('|')]);
  async function handleSave(payload: ModelPayload, options: { close?: boolean; persistedModels?: ModelProfile[] } = {}) {
    const ok = await saveModel(payload, editingModel?.id, options.persistedModels);
    if (ok && options.close !== false) {
      setModalOpen(false);
      setEditingModel(null);
    }
    return ok;
  }
  async function handleDelete(model: ModelProfile) {
    const okToDelete = window.confirm(`删除模型配置「${model.name}」？这不会删除 Frakio Work 授权账户。`);
    if (!okToDelete) return;
    await deleteModel(model.id);
  }
  return (
    <>
      <div className="model-center-head settings-head">
        <div><h2>Frakio Work 模型中心</h2></div>
        <div className="top-actions">
          {activeTab === 'auxiliary' && <label className="model-profile-select">Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option value={item.name} key={item.name}>{String((item as HermesProfile).displayName || item.name)}</option>)}</select></label>}
          {activeTab === 'general' && <button className="secondary-btn" onClick={() => { setEditingModel(null); setModalOpen(true); }}><Plus size={16} />添加模型</button>}
        </div>
      </div>
      <div className="module-matrix-tabs model-center-tabs"><button className={activeTab === 'general' ? 'selected' : ''} onClick={() => setActiveTab('general')}>模型配置</button><button className={activeTab === 'accounts' ? 'selected' : ''} onClick={() => setActiveTab('accounts')}>授权账户</button><button className={activeTab === 'auxiliary' ? 'selected' : ''} onClick={() => setActiveTab('auxiliary')}>辅助模型</button></div>
      {modelError && <div className="form-error">{modelError}</div>}
      {activeTab === 'auxiliary' ? <AuxiliaryModelsPanel profile={profile} groups={slotGroups} /> : activeTab === 'accounts' ? <><p className="settings-description">全局授权账户。任意 Agent 的模型配置绑定后，Hermes 与 Pi 都能使用同一账户。</p>{oauthAccountsApiError ? <div className="form-error">{oauthAccountsApiError}</div> : <OAuthAccountsPanel accounts={oauthAccounts} onChanged={refreshAccounts} />}</> : <div className="model-grid">
        {models.map((model) => {
          const runtimeCompatibility = ['hermes', 'pi'].map((runtimeId) => ({
            runtimeId,
            compatibility: runtimeCatalogs[runtimeId]?.models.find((item) => item.id === model.id)?.compatibility,
          }));
          return <div className="model-card" key={model.id} role="button" tabIndex={0} onClick={() => { setEditingModel(model); setModalOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter') { setEditingModel(model); setModalOpen(true); } }}>
            <div className="model-card-top">
              <span>{modelKindLabel(model.kind)}</span>
              <small>{modelAuthorizationLabel(model)}</small>
              <button className="icon-btn small danger model-delete" onClick={(event) => { event.stopPropagation(); void handleDelete(model); }} aria-label={`删除 ${model.name}`}><Trash2 size={15} /></button>
            </div>
            <strong>{model.name}</strong>
            <p>Provider：{model.provider || '-'}</p>
            <p>Base URL：{model.baseUrl || '-'}</p>
            <p>模型列表：{model.models?.length || (model.model ? 1 : 0)} 个模型</p>
            <div className="model-runtime-compatibility" aria-label="运行时兼容状态">
              {runtimeCompatibility.map(({ runtimeId, compatibility }) => {
                const status = compatibility?.status || 'unsupported';
                const label = !compatibility
                  ? '检查中'
                  : status === 'ready' ? '可用' : status === 'partial' ? '部分可用' : status === 'missing_credentials' ? '缺少凭据' : /尚未开放/.test(compatibility.reason || '') ? '尚未开放' : '不兼容';
                return <span key={runtimeId} className={compatibility ? status : 'checking'} title={compatibility?.reason || '正在读取运行时兼容状态'}>{runtimeLabels[runtimeId]} · {label}</span>;
              })}
            </div>
            <div className="model-tags model-tags-models">{(model.models?.length ? model.models : [model.model].filter(Boolean)).map((item) => <span key={item} className={item === model.model ? 'default' : ''}>{item}{item === model.model ? ' 默认' : ''}</span>)}</div>
          </div>;
        })}
        <button className="model-card add" onClick={() => { setEditingModel(null); setModalOpen(true); }}>
          <Plus size={22} />
          <strong>添加模型</strong>
          <p>官方 API / 第三方中转站 / 本地模型</p>
        </button>
      </div>}
      {modalOpen && <ModelEditorModal model={editingModel} oauthAccounts={oauthAccounts} onAccountsChanged={refreshAccounts} onClose={() => { setModalOpen(false); setEditingModel(null); }} onSave={handleSave} fetchAvailableModels={fetchAvailableModels} onCapabilityChanged={onCapabilityChanged} />}
    </>
  );
}

function OAuthAccountsPanel({ accounts, onChanged }: { accounts: OAuthAccount[]; onChanged: () => Promise<void> }) {
  const [authType, setAuthType] = useState<ProviderAuthType | null>(null);
  const [newAccountId, setNewAccountId] = useState('');
  const providerLabel: Record<string, string> = { 'openai-codex': 'OpenAI Codex', 'claude-oauth': 'Claude', 'google-gemini-cli': 'Gemini' };
  async function remove(account: OAuthAccount) {
    if (!window.confirm(`删除授权账户「${account.label}」？关联模型必须先迁移或删除。`)) return;
    const response = await fetch(`/api/oauth-accounts/${encodeURIComponent(account.id)}?providerKey=${encodeURIComponent(account.providerKey)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { window.alert(data.error || '授权账户删除失败。'); return; }
    await onChanged();
  }
  async function rename(account: OAuthAccount) {
    const label = window.prompt('账户名称', account.label)?.trim();
    if (!label || label === account.label) return;
    const response = await fetch(`/api/oauth-accounts/${encodeURIComponent(account.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerKey: account.providerKey, label }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); window.alert(data.error || '账户重命名失败。'); return; }
    await onChanged();
  }
  return <div className="model-grid">
    {accounts.map((account) => <div className="model-card" key={`${account.providerKey}:${account.id}`}><div className="model-card-top"><span>授权账户</span><button className="icon-btn small danger" onClick={() => void remove(account)} aria-label={`删除 ${account.label}`}><Trash2 size={15} /></button></div><strong>{account.label}</strong><p>{providerLabel[account.providerKey] || account.providerKey}</p><p>{account.identity}</p><p>{account.models?.length ? `关联 ${account.models.length} 个模型配置` : '尚未关联模型配置'}</p><button className="secondary-btn" onClick={() => void rename(account)}>重命名</button></div>)}
    <button className="model-card add" onClick={() => { setNewAccountId(crypto.randomUUID()); setAuthType('codex-device'); }}><Plus size={22} /><strong>授权新 Codex 账号</strong><p>授权后可在模型配置中选择。</p></button>
    <button className="model-card add" onClick={() => { setNewAccountId(crypto.randomUUID()); setAuthType('claude-pkce'); }}><Plus size={22} /><strong>授权新 Claude 账号</strong><p>授权后可在模型配置中选择。</p></button>
    <button className="model-card add" onClick={() => { setNewAccountId(crypto.randomUUID()); setAuthType('gemini-loopback'); }}><Plus size={22} /><strong>授权新 Gemini 账号</strong><p>授权后可在模型配置中选择。</p></button>
    {authType && <ProviderAuthModal authType={authType} accountId={newAccountId} onClose={() => setAuthType(null)} onSuccess={() => { setAuthType(null); void onChanged(); }} />}
  </div>;
}

function ModelEditorModal({ model, oauthAccounts, onAccountsChanged, onClose, onSave, fetchAvailableModels, onCapabilityChanged }: { model: ModelProfile | null; oauthAccounts: OAuthAccount[]; onAccountsChanged: () => Promise<void>; onClose: () => void; onSave: (payload: ModelPayload, options?: { close?: boolean; persistedModels?: ModelProfile[] }) => Promise<boolean>; fetchAvailableModels: FetchAvailableModels; onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void }) {
  const emptyPricing: ModelPricing = { input: null, output: null, cacheRead: null, cacheCreation: null };
  const titleId = useId();
  const providerTypeForModel = (value: ModelProfile | null): 'preset' | 'custom' => value && (!value.providerKey || value.providerKey.startsWith('custom:') || compatibilityRelayProviderKeys.has(value.providerKey)) ? 'custom' : 'preset';
  const draftForModel = (value: ModelProfile | null): ModelPayload => ({
    name: value?.name || '', provider: value?.provider || '', kind: value?.kind || 'official', protocol: value?.protocol || 'OpenAI Compatible',
    model: value?.model || '', models: value?.models?.length ? value.models : [value?.model || ''].filter(Boolean), baseUrl: value?.baseUrl || '', apiKey: '',
    providerKey: value?.providerKey || '', oauthAccountId: value?.oauthAccountId || '', apiMode: value?.apiMode || '', apiModePreference: value?.apiModePreference || (value ? (value.apiMode === 'codex_responses' || value.apiMode === 'openai_responses' ? 'openai_responses' : value.apiMode === 'anthropic_messages' ? 'anthropic_messages' : 'chat_completions') : 'auto'), modelsUrl: value?.modelsUrl || '', modelApiModes: value?.modelApiModes || {},
    compat: value?.compat || { thinkingFormat: 'openai', requestOverrides: {} }, modelCompat: value?.modelCompat || {}, contextLimit: value?.contextLimit || null,
    pricing: value?.pricing || emptyPricing, capabilityMode: value?.capabilityMode || 'auto', capabilityOverrides: value?.capabilityOverrides || {},
  });
  const secureOrigin = (value: string) => {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.origin.toLowerCase() : ''; } catch { return ''; }
  };
  const comparableDraft = (value: ModelPayload) => JSON.stringify({ ...value, apiKey: value.apiKey || '' });
  const connectionSignature = (value: ModelPayload) => JSON.stringify({
    baseUrl: value.baseUrl.trim().replace(/\/+$/, '').toLowerCase(), apiModePreference: value.apiModePreference || 'auto', apiMode: value.apiMode || '', model: value.model,
    modelApiModes: value.modelApiModes || {}, capabilityMode: value.capabilityMode, capabilityOverrides: value.capabilityOverrides || {},
    compat: value.compat || {}, modelCompat: value.modelCompat || {}, apiKey: value.apiKey || '',
  });
  const [providerType, setProviderType] = useState<'preset' | 'custom'>(model ? providerTypeForModel(model) : 'preset');
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(model?.providerKey || '');
  const [providerQuery, setProviderQuery] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [authType, setAuthType] = useState<ProviderAuthType | null>(null);
  const [newAccountId, setNewAccountId] = useState('');
  const [authorizedProviders, setAuthorizedProviders] = useState<Record<string, boolean>>({});
  const [oauthState, setOauthState] = useState<OAuthProviderState>('unauthenticated');
  const [draft, setDraft] = useState<ModelPayload>(() => draftForModel(model));
  const [savedDraft, setSavedDraft] = useState<ModelPayload>(() => draftForModel(model));
  const [availableModels, setAvailableModels] = useState<string[]>(model?.models?.length ? model.models : [model?.model || ''].filter(Boolean));
  const [detectedCapabilities, setDetectedCapabilities] = useState<Record<string, ModelCapability>>({});
  const [catalogInfo, setCatalogInfo] = useState<CatalogInfo | null>(null);
  const [verifyState, setVerifyState] = useState<'idle' | 'running' | 'passed' | 'failed'>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [detectionStage, setDetectionStage] = useState('');
  const [baseHelpOpen, setBaseHelpOpen] = useState(false);
  const detectionAbortRef = useRef<AbortController | null>(null);
  const selectedPresetData = presets.find((preset) => preset.value === selectedPreset) || null;
  const selectedAuthType = selectedPresetData?.authType || null;
  const providerAccounts = oauthAccounts.filter((account) => account.providerKey === draft.providerKey);
  const filteredPresets = presets.filter((preset) => `${preset.label} ${preset.value}`.toLowerCase().includes(providerQuery.toLowerCase().trim()));
  const canFetchModels = Boolean(draft.baseUrl && !selectedAuthType && /^https?:\/\//i.test(draft.baseUrl));
  const fetchModelsVisible = providerType === 'custom' || canFetchModels;
  const savedCredentialReusable = Boolean(model?.hasApiKey && secureOrigin(savedDraft.baseUrl) && secureOrigin(savedDraft.baseUrl) === secureOrigin(draft.baseUrl));
  const hasUsableApiKey = Boolean(draft.apiKey || savedCredentialReusable || selectedAuthType);
  const fetchModelsDisabled = isFetching || !draft.baseUrl || !hasUsableApiKey || !/^https?:\/\//i.test(draft.baseUrl);
  const isDirty = comparableDraft(draft) !== comparableDraft(savedDraft);
  const connectionDirty = connectionSignature(draft) !== connectionSignature(savedDraft);
  const routeChanged = draft.apiMode !== savedDraft.apiMode || draft.baseUrl.trim().replace(/\/+$/, '').toLowerCase() !== savedDraft.baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  const verificationSignature = connectionSignature(draft);
  const previousVerificationSignature = useRef(verificationSignature);

  useEffect(() => {
    if (verifyState !== 'running') {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [verifyState]);

  useEffect(() => () => detectionAbortRef.current?.abort(), []);

  useEffect(() => {
    if (previousVerificationSignature.current === verificationSignature) return;
    previousVerificationSignature.current = verificationSignature;
    setVerifyState('idle');
    setVerifyMessage('');
    setDetectionStage('');
    detectionAbortRef.current?.abort();
    detectionAbortRef.current = null;
    setIsFetching(false);
  }, [verificationSignature]);

  useEffect(() => {
    const nextProviderType = model ? providerTypeForModel(model) : 'preset';
    setProviderType(nextProviderType);
    setSelectedPreset(model?.providerKey || '');
    setProviderQuery('');
    setAvailableModels(model?.models?.length ? model.models : [model?.model || ''].filter(Boolean));
    const nextDraft = draftForModel(model);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setDetectedCapabilities({});
    setCatalogInfo(null);
    setVerifyState('idle');
    setVerifyMessage('');
    if (model?.id) fetch('/api/model-capabilities').then((response) => response.json()).then((data) => {
      const prefix = `${model.id}::`;
      const next = Object.fromEntries(Object.entries(data.capabilities || {}).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
      setDetectedCapabilities(next as Record<string, ModelCapability>);
      setCatalogInfo(data.providers?.[model.id] || null);
    }).catch(() => {});
  }, [model?.id]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/model-providers/presets')
      .then((res) => res.json())
      .then((data: { providers?: ProviderPreset[] }) => {
        if (cancelled) return;
        const nextPresets = Array.isArray(data.providers) ? data.providers : [];
        setPresets(nextPresets);
        setAuthorizedProviders(Object.fromEntries(nextPresets.filter((preset) => preset.authenticated).map((preset) => [preset.value, true])));
        const current = nextPresets.find((preset) => preset.value === model?.providerKey);
        if (current) {
          setProviderQuery(current.label);
          setOauthState(current.authenticated ? (current.models.length ? 'ready' : 'catalog_error') : 'unauthenticated');
        }
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => { cancelled = true; };
  }, [model?.providerKey]);

  function protocolFromApiMode(apiMode?: ProviderApiMode): ModelProtocol {
    if (apiMode === 'anthropic_messages') return 'Anthropic Compatible';
    if (apiMode === 'openai_responses' || apiMode === 'codex_responses' || apiMode === 'chat_completions') return 'OpenAI Compatible';
    return apiMode ? 'Custom' : 'OpenAI Compatible';
  }
  function protocolLabel(apiMode?: ProviderApiMode) {
    if (apiMode === 'codex_responses' || apiMode === 'openai_responses') return 'OpenAI Responses';
    if (apiMode === 'anthropic_messages') return 'Anthropic Messages';
    return 'OpenAI Chat Completions';
  }
  function kindFromPreset(preset: ProviderPreset): ModelKind {
    if (preset.value === 'lmstudio') return 'local';
    if (preset.value.includes('fun') || preset.value.includes('gateway') || preset.value.includes('router')) return 'relay';
    return 'official';
  }
  function autoNameFromBaseUrl(baseUrl: string) {
    const clean = baseUrl.trim().replace(/^https?:\/\//, '').replace(/\/v\d+\/?$/i, '');
    const host = clean.split('/')[0];
    if (!host) return '';
    if (host.includes('localhost') || host.includes('127.0.0.1')) return `Local ${host}`;
    return host.charAt(0).toUpperCase() + host.slice(1);
  }
  function applyPreset(providerKey: string) {
    const preset = presets.find((item) => item.value === providerKey);
    detectionAbortRef.current?.abort();
    detectionAbortRef.current = null;
    setIsFetching(false);
    setSelectedPreset(providerKey);
    setProviderOpen(false);
    setFetchError('');
    if (!preset) return;
    const nextModels = preset.models || [];
    const nextAuthenticated = preset.authType ? Boolean(preset.authenticated || authorizedProviders[preset.value]) : false;
    setProviderQuery(preset.label);
    setAvailableModels(nextModels);
    setDetectedCapabilities({});
    setCatalogInfo(preset.catalog || null);
    setVerifyState('idle');
    setVerifyMessage('');
    setDetectionStage('');
    setOauthState(preset.authType ? (nextAuthenticated ? (nextModels.length ? 'ready' : 'catalog_error') : 'unauthenticated') : 'unauthenticated');
    setDraft((current) => ({
      ...current,
      name: preset.label,
      provider: preset.label,
      providerKey: preset.value,
      oauthAccountId: preset.value === model?.providerKey ? (model?.oauthAccountId || '') : '',
      apiMode: preset.apiMode || 'chat_completions',
      apiModePreference: preset.apiMode === 'codex_responses' || preset.apiMode === 'openai_responses' ? 'openai_responses' : preset.apiMode === 'anthropic_messages' ? 'anthropic_messages' : 'chat_completions',
      protocol: protocolFromApiMode(preset.apiMode || 'chat_completions'),
      kind: kindFromPreset(preset),
      baseUrl: preset.baseUrl,
      model: nextModels[0] || '',
      models: nextModels,
    }));
  }
  function resetForProviderType(nextType: 'preset' | 'custom') {
    detectionAbortRef.current?.abort();
    detectionAbortRef.current = null;
    setIsFetching(false);
    setProviderType(nextType);
    setSelectedPreset('');
    setProviderQuery('');
    setProviderOpen(false);
    setAvailableModels([]);
    setFetchError('');
    setDraft({
      name: '',
      provider: nextType === 'preset' ? '' : 'Custom',
      kind: 'official',
      protocol: 'OpenAI Compatible',
      model: '',
      models: [],
      baseUrl: '',
      apiKey: '',
      providerKey: '',
      apiMode: '',
      apiModePreference: 'auto',
      modelsUrl: '',
      modelApiModes: {},
      compat: { thinkingFormat: 'openai', requestOverrides: {} },
      modelCompat: {},
      contextLimit: null,
      pricing: emptyPricing,
      capabilityMode: 'auto',
      capabilityOverrides: {},
    });
    setDetectedCapabilities({});
    setCatalogInfo(null);
    setVerifyState('idle');
    setVerifyMessage('');
    setDetectionStage('');
  }
  function updateCustomBaseUrl(baseUrl: string) {
    setDraft((current) => ({
      ...current,
      baseUrl,
      name: current.name || autoNameFromBaseUrl(baseUrl),
    }));
  }
  async function handleFetchModels() {
    setFetchError('');
    if (!draft.baseUrl || !hasUsableApiKey || !/^https?:\/\//i.test(draft.baseUrl)) {
      setFetchError('请先填写有效的 Base URL 和 API Key。');
      return;
    }
    setIsFetching(true);
    setVerifyState('running');
    setVerifyMessage('');
    setDetectionStage('正在获取模型并验证连接');
    const controller = new AbortController();
    detectionAbortRef.current?.abort();
    detectionAbortRef.current = controller;
    try {
      const response = await fetch('/api/model-providers/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ ...currentPayload(), modelId: model?.id, apiKey: draft.apiKey, stream: true }),
      });
      if (!response.body) throw new Error('检测响应不可读取。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result: any = null;
      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === 'stage' && typeof event.stage === 'string') setDetectionStage(event.stage);
        if (event.type === 'result') result = event.data;
        if (event.type === 'error') {
          const detail = [event.protocol, event.path, event.status ? `HTTP ${event.status}` : '', event.error].filter(Boolean).join(' · ');
          throw new Error(detail || 'Provider 检测失败。');
        }
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) consumeLine(line);
        if (chunk.done) break;
      }
      if (buffer.trim()) consumeLine(buffer);
      if (!result) throw new Error('检测没有返回有效结果。');
      if (detectionAbortRef.current !== controller) return;
      const nextModels = Array.isArray(result.models) ? result.models as string[] : [];
      const nextModel = nextModels.includes(draft.model) ? draft.model : String(result.model || nextModels[0] || '');
      const nextDraft: ModelPayload = {
        ...draft,
        baseUrl: String(result.baseUrl || draft.baseUrl),
        apiMode: result.apiMode as ProviderApiMode,
        apiModePreference: result.apiModePreference as ProviderApiModePreference,
        protocol: protocolFromApiMode(result.apiMode as ProviderApiMode),
        models: nextModels,
        model: nextModel,
        capabilityMode: 'auto',
      };
      setDetectedCapabilities(result.capability && nextModel ? { [nextModel]: result.capability as ModelCapability } : {});
      setCatalogInfo(result.catalog || null);
      setAvailableModels(nextModels);
      setDraft(nextDraft);
      previousVerificationSignature.current = connectionSignature(nextDraft);
      setVerifyState('passed');
      setDetectionStage('检测完成');
      const capability = result.capability as ModelCapability | undefined;
      const reasoning = capability?.reasoningEfforts?.length ? `支持 ${capability.reasoningEfforts.length} 档推理` : '推理能力尚未确认';
      setVerifyMessage(result.autoCompletedV1
        ? `已自动补全 /v1，连接验证通过 · ${protocolLabel(result.apiMode)} · ${reasoning}`
        : `检测完成 · ${protocolLabel(result.apiMode)} · ${reasoning}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setVerifyState('failed');
      setDetectionStage('检测失败');
      setFetchError(error instanceof Error ? error.message : '模型列表获取失败。');
    } finally {
      if (detectionAbortRef.current === controller) {
        detectionAbortRef.current = null;
        setIsFetching(false);
      }
    }
  }
  function currentPayload(): ModelPayload {
    return {
      ...draft,
      name: draft.name || draft.provider || draft.model,
      provider: draft.provider || selectedPresetData?.label || 'Custom',
      protocol: protocolFromApiMode(draft.apiMode),
      kind: providerType === 'custom' ? 'relay' : draft.kind,
      models: availableModels.length ? availableModels : draft.models,
      pricing: draft.pricing || emptyPricing,
    };
  }
  async function saveDraft() {
    if (selectedAuthType && !draft.oauthAccountId) {
      setFetchError('请选择已有授权账户，或授权一个新账户。');
      return;
    }
    if (selectedAuthType && !authorizedProviders[draft.providerKey || '']) {
      setOauthState('authorizing');
      setAuthType(selectedAuthType);
      return;
    }
    if (!selectedAuthType && connectionDirty && verifyState !== 'passed') {
      setFetchError('连接参数已变化，请先完成获取并检测。');
      return;
    }
    await onSave(currentPayload());
  }
  function requestClose() {
    if (isDirty && !window.confirm('当前有未保存的更改，确定要放弃吗？')) return;
    detectionAbortRef.current?.abort();
    onClose();
  }
  async function handleAuthSuccess(result: { models?: string[]; catalog?: CatalogInfo; capabilities?: Record<string, ModelCapability>; authenticated?: boolean; accountId?: string }) {
    const providerKey = draft.providerKey || selectedPreset;
    setAuthorizedProviders((current) => ({ ...current, [providerKey]: true }));
    setAuthType(null);
    const nextModels = Array.isArray(result.models) ? result.models : [];
    setAvailableModels(nextModels);
    setCatalogInfo(result.catalog || null);
    setDetectedCapabilities(result.capabilities || {});
    setDraft((current) => ({ ...current, oauthAccountId: result.accountId || current.oauthAccountId, models: nextModels, model: nextModels.includes(current.model) ? current.model : nextModels[0] || '' }));
    setOauthState(nextModels.length ? 'ready' : 'catalog_error');
    setFetchError(nextModels.length ? '' : result.catalog?.refreshError || '授权已完成，但模型目录获取失败。请重新获取模型。');
  }
  async function refreshOAuthCatalog() {
    if (draft.providerKey !== 'openai-codex') return;
    setOauthState('authorized_loading_catalog');
    setIsFetching(true);
    setFetchError('');
    try {
      const response = await fetch('/api/auth/codex/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: draft.oauthAccountId || '' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Codex 模型目录获取失败。');
      await handleAuthSuccess(data);
    } catch (error) {
      setOauthState('catalog_error');
      setFetchError(error instanceof Error ? error.message : 'Codex 模型目录获取失败。');
    } finally {
      setIsFetching(false);
    }
  }
  async function selectOAuthAccount(accountId: string) {
    const isCodex = draft.providerKey === 'openai-codex';
    setDraft((current) => isCodex
      ? { ...current, oauthAccountId: accountId, model: '', models: [] }
      : { ...current, oauthAccountId: accountId });
    if (!isCodex || !accountId) return;
    setOauthState('authorized_loading_catalog');
    setIsFetching(true);
    setFetchError('');
    try {
      const response = await fetch('/api/auth/codex/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Codex 模型目录获取失败。');
      const nextModels = Array.isArray(data.models) ? data.models : [];
      setAvailableModels(nextModels);
      setCatalogInfo(data.catalog || null);
      setDetectedCapabilities(data.capabilities || {});
      setDraft((current) => ({ ...current, oauthAccountId: accountId, models: nextModels, model: nextModels[0] || '' }));
      setOauthState(nextModels.length ? 'ready' : 'catalog_error');
    } catch (error) {
      setOauthState('catalog_error');
      setFetchError(error instanceof Error ? error.message : 'Codex 模型目录获取失败。');
    } finally {
      setIsFetching(false);
    }
  }
  const needsAuthorization = Boolean(selectedAuthType && !draft.oauthAccountId);
  const saveDisabled = providerType === 'preset'
    ? !selectedPreset || (needsAuthorization ? true : (!draft.model || !(availableModels.length || draft.models.length) || (!selectedAuthType && !draft.baseUrl)))
    : isFetching || !draft.baseUrl || !hasUsableApiKey || !draft.model || !(availableModels.length || draft.models.length) || (connectionDirty && verifyState !== 'passed');
  const activeCapability = routeChanged && verifyState !== 'passed' ? undefined : detectedCapabilities[draft.model];
  const capabilitySummary = activeCapability
    ? `${activeCapability.reasoning ? `支持 ${activeCapability.reasoningEfforts.length} 档推理` : '推理能力尚未确认'} · ${activeCapability.serviceTiers.length ? '线路接受快速模式' : '快速模式尚未确认'}${activeCapability.confidence === 'inferred' ? ' · 推断结果' : ''}`
    : '获取模型后显示自动识别结果。';
  const effectiveProtocolLabel = draft.apiMode ? protocolLabel(draft.apiMode) : '';
  const baseUrlNeedsV1 = (() => {
    if (!['auto', 'chat_completions', 'openai_responses'].includes(draft.apiModePreference || 'auto')) return false;
    if (draft.apiMode === 'anthropic_messages') return false;
    try {
      const parsed = new URL(draft.baseUrl);
      if (parsed.hostname.toLowerCase() === 'api.anthropic.com' || /\/anthropic(?:\/v1)?\/?$/i.test(parsed.pathname)) return false;
      if (/\.openai\.azure\.com$/i.test(parsed.hostname) || /\/openai\/deployments\//i.test(parsed.pathname)) return false;
      const path = parsed.pathname.replace(/\/(?:models|responses|messages|chat\/completions)\/?$/i, '');
      return !path.split('/').filter(Boolean).some((part) => /^v\d+(?:beta\d*)?$/i.test(part));
    } catch {
      return false;
    }
  })();
  const detectionWaitMessage = elapsedSeconds >= 30
    ? '部分线路可能需要更长时间，检测仍在进行。'
    : elapsedSeconds >= 15
      ? '线路响应较慢，仍在继续探测，请耐心等待。'
      : '正在探测模型能力，通常需要 10–15 秒，请耐心等待。';

  return createPortal((
    <div className="modal-backdrop">
      <div className="modal agent-editor provider-editor" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head"><div><h2 id={titleId}>{model ? '编辑 Provider' : '添加 Provider'}</h2>{isDirty && <small className="provider-unsaved">有未保存更改</small>}</div><button type="button" className="icon-btn provider-modal-close" onClick={requestClose} aria-label="关闭"><X size={18} /></button></div>
        <div className="agent-editor-body provider-editor-body">
          {!model && (
            <label className="provider-field"><span>Provider 类型</span><div className="provider-mode-tabs"><button type="button" className={providerType === 'preset' ? 'selected' : ''} onClick={() => resetForProviderType('preset')}>预设</button><button type="button" className={providerType === 'custom' ? 'selected' : ''} onClick={() => resetForProviderType('custom')}>自定义</button></div></label>
          )}
          {providerType === 'preset' ? (
            <>
              <label className="provider-field provider-combobox-wrap"><span>选择 Provider <em>*</em></span><ProviderPresetCombobox query={providerQuery} open={providerOpen} presets={filteredPresets} onOpenChange={setProviderOpen} onQueryChange={(value) => { setProviderQuery(value); setProviderOpen(true); }} onSelect={applyPreset} /></label>
              <label className="provider-field"><span>Base URL <em>*</em></span><div className="provider-base-url-control"><input disabled={isFetching} value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="例如 https://api.example.com/v1" /><button type="button" className={baseUrlNeedsV1 ? 'provider-base-help warning' : 'provider-base-help'} aria-label="Base URL 帮助" aria-expanded={baseHelpOpen} onClick={() => setBaseHelpOpen((open) => !open)} onBlur={() => window.setTimeout(() => setBaseHelpOpen(false), 120)}>{baseUrlNeedsV1 ? <TriangleAlert size={15} /> : <CircleHelp size={15} />}</button><span className={baseHelpOpen ? 'provider-base-tooltip open' : 'provider-base-tooltip'} role="tooltip">{baseUrlNeedsV1 ? '当前地址可能缺少 /v1。检测时会同时尝试原地址和 /v1 地址，验证成功后自动使用正确地址。' : 'OpenAI 兼容接口通常以 /v1 结尾；Anthropic 官方地址无需添加。系统会在检测时确认并补全正确路径。'}</span></div></label>
              {!selectedAuthType && <label className="provider-field"><span>API Key <em>*</em></span><input disabled={isFetching} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={model?.hasApiKey ? '已保存，留空表示继续使用' : 'sk-...'} type="password" />{model?.hasApiKey && !savedCredentialReusable && !draft.apiKey && <small className="error">Base URL 地址已变化，请重新输入 API Key。</small>}</label>}
              {selectedAuthType && <label className="provider-field"><span>选择授权账户 <em>*</em></span><select value={draft.oauthAccountId || ''} onChange={(event) => void selectOAuthAccount(event.target.value)}><option value="">请选择账户</option>{providerAccounts.map((account) => <option value={account.id} key={account.id}>{account.label} · {account.identity}</option>)}</select><button type="button" className="secondary-btn provider-fetch" onClick={() => { setNewAccountId(crypto.randomUUID()); setAuthType(selectedAuthType); }}>授权新账号</button></label>}
              {selectedAuthType && <div className="auth-provider-note"><ShieldCheck size={16} /><span>{oauthState === 'ready' ? `${selectedPresetData?.label} 已授权到 Frakio Work，模型目录已就绪。` : oauthState === 'catalog_error' ? `${selectedPresetData?.label} 已授权到 Frakio Work，但模型目录尚不可用。` : oauthState === 'authorized_loading_catalog' ? '正在读取授权账号的模型目录。' : `${selectedPresetData?.label} 将授权给整个 Frakio Work。`}</span></div>}
              <label className="provider-field"><span>默认模型 <em>*</em></span>{availableModels.length ? <select disabled={isFetching} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>{availableModels.map((item) => <option key={item} value={item}>{item}</option>)}</select> : selectedAuthType ? <input value="" disabled placeholder="授权后获取模型" /> : <input disabled={isFetching} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />}</label>
            </>
          ) : (
            <>
              <label className="provider-field"><span>名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="根据 Base URL 自动生成" /></label>
              <label className="provider-field"><span>Base URL <em>*</em></span><div className="provider-base-url-control"><input disabled={isFetching} value={draft.baseUrl} onChange={(event) => updateCustomBaseUrl(event.target.value)} placeholder="例如 https://api.example.com/v1" /><button type="button" className={baseUrlNeedsV1 ? 'provider-base-help warning' : 'provider-base-help'} aria-label="Base URL 帮助" aria-expanded={baseHelpOpen} onClick={() => setBaseHelpOpen((open) => !open)} onBlur={() => window.setTimeout(() => setBaseHelpOpen(false), 120)}>{baseUrlNeedsV1 ? <TriangleAlert size={15} /> : <CircleHelp size={15} />}</button><span className={baseHelpOpen ? 'provider-base-tooltip open' : 'provider-base-tooltip'} role="tooltip">{baseUrlNeedsV1 ? '当前地址可能缺少 /v1。检测时会同时尝试原地址和 /v1 地址，验证成功后自动使用正确地址。' : 'OpenAI 兼容接口通常以 /v1 结尾；Anthropic 官方地址无需添加。系统会在检测时确认并补全正确路径。'}</span></div></label>
              <label className="provider-field"><span>API Key <em>*</em></span><input disabled={isFetching} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={model?.hasApiKey ? '已保存，留空表示继续使用' : 'sk-...'} type="password" />{model?.hasApiKey && !savedCredentialReusable && !draft.apiKey && <small className="error">Base URL 地址已变化，请重新输入 API Key。</small>}</label>
              <label className="provider-field"><span>默认模型 <em>*</em></span>{availableModels.length ? <select disabled={isFetching} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>{availableModels.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input disabled={isFetching} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />}</label>
              <label className="provider-field"><span>上下文长度</span><input value={draft.contextLimit ?? ''} onChange={(event) => { const parsed = Number(event.target.value); setDraft({ ...draft, contextLimit: event.target.value && Number.isFinite(parsed) ? Math.max(0, parsed) : null }); }} placeholder="例如 256000（可选）" inputMode="numeric" /></label>
              <label className="provider-field"><span>API 协议</span><div className="provider-protocol-control"><select disabled={isFetching} value={draft.apiModePreference || 'auto'} onChange={(event) => { const preference = event.target.value as ProviderApiModePreference; setDraft({ ...draft, apiModePreference: preference, apiMode: preference === 'auto' ? '' : preference }); }}><option value="auto">自动适配（推荐）</option><option value="chat_completions">OpenAI Chat Completions</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option></select><small>{draft.apiModePreference === 'auto' ? (effectiveProtocolLabel ? `当前使用 ${effectiveProtocolLabel}` : '检测后自动选择') : '手动指定'}</small></div></label>
            </>
          )}
          {fetchModelsVisible && <button type="button" className="secondary-btn provider-fetch" onClick={() => void handleFetchModels()} disabled={fetchModelsDisabled}>{isFetching ? <><LoaderCircle className="spin" size={15} />正在检测</> : verifyState === 'failed' ? '重新检测' : '获取并检测'}</button>}
          {selectedAuthType && draft.providerKey === 'openai-codex' && draft.oauthAccountId && <button type="button" className="secondary-btn provider-fetch" onClick={() => void refreshOAuthCatalog()} disabled={isFetching}>{isFetching ? '正在获取模型' : availableModels.length ? '刷新模型目录' : '获取模型目录'}</button>}
          {fetchError && <div className="form-error">{fetchError}</div>}
          {isFetching && <div className="provider-detection-status" aria-live="polite" aria-busy="true"><div className="provider-detection-line"><LoaderCircle className="spin" size={16} /><strong>{detectionStage}</strong><span>已等待 {elapsedSeconds} 秒</span></div><div className="provider-detection-progress" aria-hidden="true"><i /></div><small>{detectionWaitMessage}</small></div>}
          {!isFetching && verifyMessage && <div className={verifyState === 'failed' ? 'provider-detection-status failed' : 'provider-detection-status complete'} aria-live="polite" aria-busy="false"><strong>{verifyMessage}</strong></div>}
          {routeChanged && verifyState !== 'passed' && draft.baseUrl.trim().replace(/\/+$/, '').toLowerCase() !== savedDraft.baseUrl.trim().replace(/\/+$/, '').toLowerCase() ? <div className="provider-catalog-status"><strong>模型列表待重新检测</strong></div> : catalogInfo && <div className="provider-catalog-status"><strong>已找到 {availableModels.length} 个模型</strong><small>{catalogInfo.lastSuccessAt ? `最近检测 ${new Date(catalogInfo.lastSuccessAt).toLocaleString()}` : '本次检测已完成'}</small></div>}
          <section className="provider-capability-settings">
            <div className="provider-capability-head"><div><strong>能力识别</strong><small>{draft.model || '请先完成检测'}</small></div><span className="provider-auto-badge">自动</span></div>
            <p className="provider-capability-summary">{capabilitySummary}</p>
          </section>
        </div>
        <div className="provider-modal-footer"><button className="secondary-btn" onClick={requestClose}>取消</button><button className="send-btn" onClick={() => void saveDraft()} disabled={saveDisabled}>{needsAuthorization ? '授权' : model ? '保存' : '添加'}</button></div>
        {authType && <ProviderAuthModal authType={authType} accountId={newAccountId} onClose={() => { setAuthType(null); setOauthState('unauthenticated'); }} onSuccess={(result) => { void onAccountsChanged(); void handleAuthSuccess(result); }} />}
      </div>
    </div>
  ), document.body);
}

function ProviderPresetCombobox({ query, open, presets, onQueryChange, onOpenChange, onSelect }: { query: string; open: boolean; presets: ProviderPreset[]; onQueryChange: (value: string) => void; onOpenChange: (open: boolean) => void; onSelect: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenChange]);

  function selectPreset(value: string) {
    onOpenChange(false);
    inputRef.current?.blur();
    onSelect(value);
  }

  return (
    <div className="provider-combobox" ref={rootRef}>
      <div className="provider-combobox-input">
        <input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onFocus={() => onOpenChange(true)} onKeyDown={(event) => { if (event.key === 'Escape') { onOpenChange(false); event.currentTarget.blur(); } }} placeholder="选择一个 provider..." />
        <button type="button" onClick={() => onOpenChange(!open)} aria-label="展开 Provider 列表"><ChevronDown size={16} /></button>
      </div>
      {open && (
        <div className="provider-combobox-menu">
          {presets.map((preset) => <button type="button" key={preset.value} onMouseDown={(event) => { event.preventDefault(); selectPreset(preset.value); }}>{preset.label}</button>)}
          {!presets.length && <span>没有匹配的 Provider</span>}
        </div>
      )}
    </div>
  );
}

function ProviderAuthModal({ authType, accountId = '', accountLabel = '', onClose, onSuccess }: { authType: ProviderAuthType; accountId?: string; accountLabel?: string; onClose: () => void; onSuccess: (result: { models?: string[]; catalog?: CatalogInfo; capabilities?: Record<string, ModelCapability>; authenticated?: boolean; accountId?: string }) => void }) {
  const titleId = useId();
  const [status, setStatus] = useState<'loading' | 'waiting' | 'submitting' | 'approved' | 'expired' | 'error'>('loading');
  const [sessionId, setSessionId] = useState('');
  const [userCode, setUserCode] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const completionTimerRef = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    async function start() {
      try {
        const endpoint = authType === 'codex-device' ? '/api/auth/codex/start' : authType === 'claude-pkce' ? '/api/auth/claude/start' : '/api/auth/gemini/start';
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, accountLabel }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '授权启动失败。');
        if (cancelled) return;
        setSessionId(data.session_id || '');
        const nextAuthUrl = data.verification_url || data.authorization_url || '';
        setAuthUrl(nextAuthUrl);
        setUserCode(data.user_code || '');
        setStatus('waiting');
        if (nextAuthUrl) await openExternalUrl(nextAuthUrl);
        if (authType !== 'claude-pkce') {
          const poll = async () => {
            try {
              const pollEndpoint = authType === 'codex-device' ? `/api/auth/codex/${data.session_id}` : `/api/auth/gemini/${data.session_id}`;
              const pollRes = await fetch(pollEndpoint);
              const pollData = await pollRes.json();
              if (cancelled) return;
              if (pollData.status === 'pending') {
                timer = window.setTimeout(poll, authType === 'codex-device' ? 3000 : 2000);
              } else if (pollData.status === 'approved') {
                setStatus('approved');
                completionTimerRef.current = window.setTimeout(() => onSuccess({ ...pollData, accountId }), 700);
              } else {
                setStatus(pollData.status === 'expired' ? 'expired' : 'error');
                setErrorMessage(pollData.error || '授权失败。');
              }
            } catch {
              if (!cancelled) timer = window.setTimeout(poll, 3000);
            }
          };
          timer = window.setTimeout(poll, 1200);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '授权启动失败。');
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    };
  }, [authType, accountId, accountLabel, onSuccess]);
  async function submitClaudeCode() {
    if (!code.trim() || !sessionId) return;
    setStatus('submitting');
    try {
      const res = await fetch(`/api/auth/claude/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claude 授权失败。');
      if (data.status === 'approved') {
        setStatus('approved');
        completionTimerRef.current = window.setTimeout(() => onSuccess({ ...data, accountId }), 700);
      } else {
        setStatus(data.status === 'expired' ? 'expired' : 'error');
        setErrorMessage(data.error || 'Claude 授权失败。');
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Claude 授权失败。');
    }
  }
  const title = authType === 'codex-device' ? 'OpenAI Codex 授权' : authType === 'claude-pkce' ? 'Claude OAuth 授权' : 'Google Gemini OAuth 授权';
  return (
    <div className="modal-backdrop nested">
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head"><div><h2 id={titleId}>{title}</h2><p>{status === 'waiting' ? '浏览器会打开授权页面，完成后回到这里。' : '正在准备授权。'}</p></div><button type="button" className="icon-btn provider-modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
        <div className="auth-modal-body">
          {status === 'loading' && <div className="auth-state"><RefreshCw className="spin" size={22} /><span>正在启动授权...</span></div>}
          {status === 'waiting' && authType === 'codex-device' && <div className="auth-state"><strong className="auth-code">{userCode}</strong><button className="secondary-btn" onClick={() => navigator.clipboard?.writeText(userCode)}>复制授权码</button><button className="send-btn" onClick={() => void openExternalUrl(authUrl)}><ExternalLink size={15} />重新打开授权页面</button></div>}
          {status === 'waiting' && authType === 'gemini-loopback' && <div className="auth-state"><button className="send-btn" onClick={() => void openExternalUrl(authUrl)}><ExternalLink size={15} />重新打开 Google 授权</button><span>授权完成后会自动返回。</span></div>}
          {(status === 'waiting' || status === 'submitting') && authType === 'claude-pkce' && <div className="auth-state"><button className="send-btn" onClick={() => void openExternalUrl(authUrl)}><ExternalLink size={15} />重新打开 Claude 授权</button><textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="粘贴 Claude 返回的 code" /><button className="secondary-btn full" onClick={() => void submitClaudeCode()} disabled={!code.trim() || status === 'submitting'}>{status === 'submitting' ? '提交中' : '提交 code'}</button></div>}
          {status === 'approved' && <div className="auth-state success"><CheckCircle2 size={28} /><span>授权完成。</span></div>}
          {status === 'expired' && <div className="auth-state"><span>授权已过期，请重新发起。</span></div>}
          {status === 'error' && <div className="form-error">{errorMessage}</div>}
        </div>
      </div>
    </div>
  );
}

function modelKindLabel(kind: ModelKind) {
  if (kind === 'relay') return '第三方中转站';
  if (kind === 'local') return '本地模型';
  return '官方模型';
}

function modelAuthorizationLabel(model: ModelProfile) {
  const oauthLabels: Record<string, string> = {
    'openai-codex': '已授权 ChatGPT / Codex 账号',
    'claude-oauth': '已授权 Claude Pro / Max',
    'google-gemini-cli': '已授权 Gemini CLI / Code Assist',
  };
  if (oauthLabels[model.providerKey || '']) return model.oauthAccountBindingRequired ? '需要选择授权账户' : model.hasApiKey ? oauthLabels[model.providerKey || ''] : '未授权';
  return model.hasApiKey ? '已配置 Key' : '未配置 Key';
}

function modelPricingSummary(pricing?: ModelPricing) {
  if (!pricing || [pricing.input, pricing.output, pricing.cacheRead, pricing.cacheCreation].every((value) => value == null)) return '默认价格';
  return `in $${pricing.input ?? 0}/M · out $${pricing.output ?? 0}/M`;
}

function pricingSourceLabel(source?: string) {
  if (source === 'configured') return '配置价格';
  if (source === 'default') return '默认价格';
  return '未计价';
}

function OrgPage({ agents, models, hermesRuntime, selectedOrgAgentId, onSelectAgent, onProfilesChanged, onUpdateAgent, onDeleteAgent, onCreate, profileEditor, defaultAgentId, onUpdateDefaultAgent, onRefreshHermesRuntime, onStartProfileGateway, onStopProfileGateway }: {
  agents: Agent[];
  models: ModelProfile[];
  hermesRuntime: HermesRuntimeStatus | null;
  selectedOrgAgentId: string;
  onSelectAgent: (id: string) => void;
  onProfilesChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onCreate: () => void;
  profileEditor: ProfileEditorControls;
  defaultAgentId: string;
  onUpdateDefaultAgent: (agentId: string) => void;
  onRefreshHermesRuntime: () => Promise<unknown>;
  onStartProfileGateway: (profileName: string) => Promise<void>;
  onStopProfileGateway: (profileName: string) => Promise<void>;
}) {
  const selectedAgent = agents.find((agent) => agent.id === selectedOrgAgentId) || agents[0] || null;
  return (
    <section className="org-page">
      <div className="org-split-section">
        <div className="org-toolbar settings-head">
          <div><h2>Agent Profile</h2></div>
          {agents.length > 0 && <label className="org-default-agent">默认 Agent<select value={defaultAgentId} onChange={(event) => onUpdateDefaultAgent(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
        </div>
        <div className="profile-grid">
          {agents.map((agent) => {
            const gateway = gatewayForAgent(agent, hermesRuntime);
            return <button className={`profile-card ${selectedOrgAgentId === agent.id ? 'active' : ''}`} key={agent.id} onClick={() => onSelectAgent(agent.id)}><RuntimePulse gateway={gateway} /><AgentAvatar agent={agent} /><strong>{agent.name}</strong><small>{agent.role}</small><em>{agentDefaultModelLabel(agent, models)}</em><p>{agent.soulExcerpt || agent.soul || agent.scope}</p><span className={gatewayStatusClass(gateway)}>{gatewayStatusLabel(gateway)}</span></button>;
          })}
          <button className="profile-card profile-card-add" onClick={onCreate}><span className="profile-add-icon"><Plus size={22} /></span><strong>新建 Agent</strong><small>创建新的 Hermes Profile</small><p>填写基础资料后，可在下方继续编辑笔记、用户画像和灵魂。</p></button>
        </div>
        {selectedAgent && <AgentProfileDetail agent={selectedAgent} models={models} gateway={gatewayForAgent(selectedAgent, hermesRuntime)} onChanged={onProfilesChanged} onUpdateAgent={onUpdateAgent} onDelete={() => onDeleteAgent(selectedAgent.id)} profileEditor={profileEditor} onRefreshHermesRuntime={onRefreshHermesRuntime} onStartProfileGateway={onStartProfileGateway} onStopProfileGateway={onStopProfileGateway} />}
      </div>
    </section>
  );
}

function gatewayForAgent(agent: Agent, runtime: HermesRuntimeStatus | null) {
  const profileName = agent.profileName || agent.id;
  return runtime?.gateways?.find((gateway) => gateway.profileName === profileName) || null;
}

function gatewayStatusLabel(gateway: HermesRuntimeStatus['gateways'][number] | null) {
  if (gateway?.error) return '网关异常';
  if (gateway?.running) return '网关运行中';
  return '网关未运行';
}

function gatewayStatusClass(gateway: HermesRuntimeStatus['gateways'][number] | null) {
  if (gateway?.error) return 'gateway-status error';
  if (gateway?.running) return 'gateway-status running';
  return 'gateway-status idle';
}

function RuntimePulse({ gateway }: { gateway: HermesRuntimeStatus['gateways'][number] | null }) {
  return <span className={`runtime-pulse ${gateway?.error ? 'error' : gateway?.running ? 'running' : 'idle'}`} aria-label={gatewayStatusLabel(gateway)} title={gatewayStatusLabel(gateway)} />;
}

type GatewayOperation = 'refreshing' | 'starting' | 'restarting' | 'stopping';

function AgentRuntimePolicyPanel({ agent, onUpdateAgent }: { agent: Agent; onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void> }) {
  const [runtimes, setRuntimes] = useState<RuntimeDefinition[]>(runtimeSeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const policy = agent.runtimePolicy || { defaultRuntimeId: agent.profileName ? 'hermes' : 'pi', allowedRuntimeIds: agent.profileName ? ['hermes', 'pi'] : ['pi'], permissionProfileId: 'default' };
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch('/api/runtimes');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || cancelled) return;
      setRuntimes((current) => mergeRuntimeDefinitions(current, payload.runtimes || []));
      await Promise.all(runtimeSeed.map(async (runtime) => {
        const detected = await fetch(`/api/runtimes/${runtime.id}/detect`, { method: 'POST' }).then((item) => item.json()).catch(() => null);
        if (!cancelled && detected?.runtime) setRuntimes((current) => mergeRuntimeDefinitions(current, [detected.runtime]));
      }));
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  async function save(next: AgentRuntimePolicy) {
    setSaving(true);
    setError('');
    try {
      await onUpdateAgent(agent.id, { runtimePolicy: next });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '执行内核配置保存失败。');
    } finally {
      setSaving(false);
    }
  }
  return <section className="agent-runtime-policy" aria-label="执行内核">
    <div className="agent-runtime-policy-head"><div><strong>执行内核</strong><small>决定这个 Agent 可以使用哪些执行运行时。</small></div>{saving && <LoaderCircle className="spin" size={15} aria-label="正在保存" />}</div>
    <label className="agent-runtime-default">默认内核
      <select value={policy.defaultRuntimeId} disabled={saving} onChange={(event) => {
        const defaultRuntimeId = event.target.value;
        void save({ ...policy, defaultRuntimeId, allowedRuntimeIds: Array.from(new Set([...policy.allowedRuntimeIds, defaultRuntimeId])) });
      }}>
        {runtimeSeed.map((runtime) => <option key={runtime.id} value={runtime.id} disabled={!isRuntimeReady(runtimes.find((item) => item.id === runtime.id))}>{runtime.name}{isRuntimeReady(runtimes.find((item) => item.id === runtime.id)) ? '' : '（不可用）'}</option>)}
      </select>
    </label>
    <div className="agent-runtime-policy-list">
      {runtimeSeed.map((runtime) => {
        const current = runtimes.find((item) => item.id === runtime.id) || runtime;
        const enabled = policy.allowedRuntimeIds.includes(runtime.id);
        const isDefault = policy.defaultRuntimeId === runtime.id;
        const lockedHermes = runtime.id === 'hermes' && Boolean(agent.profileName);
        const available = isRuntimeReady(current);
        return <div className="agent-runtime-policy-item" key={runtime.id}>
          <label><input type="checkbox" checked={enabled} disabled={saving || isDefault || lockedHermes || (!available && !enabled)} onChange={(event) => {
            const allowedRuntimeIds = event.target.checked ? Array.from(new Set([...policy.allowedRuntimeIds, runtime.id])) : policy.allowedRuntimeIds.filter((runtimeId) => runtimeId !== runtime.id);
            void save({ ...policy, allowedRuntimeIds });
          }} /><span><strong><RuntimeLabel runtimeId={runtime.id} /></strong><small>{available ? `${current.installation?.version || '已就绪'}${runtime.kind === 'core' ? ' · 使用 Frakio Model Center' : ' · 模型由原生 CLI / CC Switch 管理'}` : current.installation?.status === 'checking' ? '正在检测' : current.installation?.detail || '请前往 Runtime Center 修复'}</small></span></label>
        </div>;
      })}
    </div>
    {error && <div className="inline-error">{error}</div>}
  </section>;
}

function AgentProfileDetail({ agent, models, gateway, onChanged, onUpdateAgent, onDelete, profileEditor, onRefreshHermesRuntime, onStartProfileGateway, onStopProfileGateway }: { agent: Agent; models: ModelProfile[]; gateway: HermesRuntimeStatus['gateways'][number] | null; onChanged: () => Promise<void>; onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>; onDelete: () => Promise<void>; profileEditor: ProfileEditorControls; onRefreshHermesRuntime: () => Promise<unknown>; onStartProfileGateway: (profileName: string) => Promise<void>; onStopProfileGateway: (profileName: string) => Promise<void> }) {
  const [tab, setTab] = useState<'notes' | 'user' | 'soul'>('notes');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [runtimeConfigOpen, setRuntimeConfigOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [gatewayOperations, setGatewayOperations] = useState<Record<string, GatewayOperation>>({});
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const tabs = [
    { id: 'notes', label: '笔记' },
    { id: 'user', label: '用户画像' },
    { id: 'soul', label: '灵魂' },
  ] as const;
  const editableProfileName = agent.source === 'hermes-profile' && agent.profileName ? agent.profileName : '';
  const runtimeProfileName = agent.profileName || agent.id;
  const gatewayOperation = gatewayOperations[runtimeProfileName] || null;
  const gatewayBusy = Boolean(gatewayOperation);
  const gatewayOperationLabel = gatewayOperation === 'refreshing' ? '正在刷新网关状态' : gatewayOperation === 'restarting' ? '网关重启中' : gatewayOperation === 'starting' ? '网关启动中' : gatewayOperation === 'stopping' ? '网关停止中' : '';
  useEffect(() => {
    setNameDraft(agent.name);
    setNameEditing(false);
    setNameError('');
  }, [agent.id, agent.name]);
  function openEditor(kind: ProfileEditableKind, title: string) {
    if (!editableProfileName) return;
    void profileEditor.open({ agentId: agent.id, agentName: agent.name, profileName: editableProfileName, kind, title });
  }
  function selectTab(nextTab: typeof tab) {
    if (nextTab === tab) return;
    if (profileEditor.state.target?.agentId === agent.id && !profileEditor.close()) return;
    setTab(nextTab);
  }
  function chooseAvatar(file: File | undefined) {
    if (!file || !editableProfileName) return;
    setAvatarError('');
    setAvatarCropFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  async function uploadAvatar(data: string) {
    if (!editableProfileName) return;
    setAvatarSaving(true);
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(editableProfileName)}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: 'image/png', data }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '头像保存失败。');
      setAvatarCropFile(null);
      await onChanged();
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : '头像保存失败。');
    } finally {
      setAvatarSaving(false);
    }
  }
  async function saveAgentModel(modelValue: string) {
    const persistedModelValue = agent.model ? resolveModelChoice(agent.model, models).value : '';
    if (!modelValue || modelValue === persistedModelValue || modelSaving) return;
    setModelError('');
    setModelSaving(true);
    try {
      await onUpdateAgent(agent.id, { model: modelValue });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '模型保存失败。');
    } finally {
      setModelSaving(false);
    }
  }
  async function saveAgentName() {
    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameError('Agent 名字不能为空。');
      return;
    }
    if (nextName === agent.name) {
      setNameEditing(false);
      return;
    }
    setNameSaving(true);
    setNameError('');
    try {
      await onUpdateAgent(agent.id, { name: nextName });
      setNameEditing(false);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : '名字保存失败。');
    } finally {
      setNameSaving(false);
    }
  }
  async function refreshGatewayStatus() {
    if (gatewayBusy) return;
    setGatewayOperations((current) => ({ ...current, [runtimeProfileName]: 'refreshing' }));
    try {
      await onRefreshHermesRuntime();
    } finally {
      setGatewayOperations((current) => {
        const next = { ...current };
        delete next[runtimeProfileName];
        return next;
      });
    }
  }
  async function startGateway() {
    if (gatewayBusy) return;
    const operation: GatewayOperation = gateway?.running ? 'restarting' : 'starting';
    setGatewayOperations((current) => ({ ...current, [runtimeProfileName]: operation }));
    try {
      await onStartProfileGateway(runtimeProfileName);
    } finally {
      setGatewayOperations((current) => {
        const next = { ...current };
        delete next[runtimeProfileName];
        return next;
      });
    }
  }
  async function stopGateway() {
    if (gatewayBusy) return;
    setGatewayOperations((current) => ({ ...current, [runtimeProfileName]: 'stopping' }));
    try {
      await onStopProfileGateway(runtimeProfileName);
      await onRefreshHermesRuntime();
    } finally {
      setGatewayOperations((current) => {
        const next = { ...current };
        delete next[runtimeProfileName];
        return next;
      });
    }
  }
  async function deleteAgent() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }
  return (
    <section className="agent-profile-detail">
      <div className="agent-profile-hero">
        <button className="agent-profile-avatar" style={agent.avatarUrl ? undefined : { background: agent.color }} onClick={() => avatarInputRef.current?.click()} disabled={!editableProfileName || avatarSaving} title={editableProfileName ? '上传头像' : '保存为 Hermes Profile 后可上传头像'} aria-label="上传头像">
          {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1)}
        </button>
        <input ref={avatarInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
        <div className="agent-profile-main">
          {nameEditing ? (
            <div className="agent-name-editor">
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveAgentName();
                  if (event.key === 'Escape') {
                    setNameDraft(agent.name);
                    setNameEditing(false);
                    setNameError('');
                  }
                }}
                autoFocus
              />
              <button className="secondary-btn" onClick={() => void saveAgentName()} disabled={nameSaving}>{nameSaving ? '保存中' : '保存'}</button>
              <button className="icon-btn" onClick={() => { setNameDraft(agent.name); setNameEditing(false); setNameError(''); }} aria-label="取消编辑名字"><X size={15} /></button>
            </div>
          ) : (
            <div className="agent-name-row">
              <h2>{agent.name}</h2>
              <button className="agent-name-edit" onClick={() => setNameEditing(true)} aria-label="编辑 Agent 名字" title="编辑 Agent 名字"><Pencil size={15} /></button>
            </div>
          )}
          <p>{agent.role}</p>
          {nameError && <div className="inline-error">{nameError}</div>}
          {avatarError && <div className="inline-error">{avatarError}</div>}
        </div>
        <button className="secondary-btn danger-btn agent-delete-btn" onClick={() => void deleteAgent()} disabled={deleting}><Trash2 size={15} />{deleting ? '正在删除' : '删除'}</button>
      </div>
      <div className="agent-profile-toolbar">
        <div className="agent-tabs">
          {tabs.map((item) => (
            <button className={tab === item.id ? 'selected' : ''} key={item.id} onClick={() => selectTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="agent-default-model" aria-label="Agent 默认模型">
          <span>默认模型</span>
          <ProviderModelPicker
            models={models}
            value={modelValueForAgent(agent, models)}
            onChange={(value) => void saveAgentModel(value)}
            emptyLabel={modelSaving ? '保存中' : '未配置模型'}
            className="agent-default-model-picker"
            ariaLabel="选择 Agent 默认模型"
            title="选择 Agent 默认模型"
          />
        </label>
      </div>
      {modelError && <div className="inline-error">{modelError}</div>}
      {avatarCropFile && <AvatarCropModal file={avatarCropFile} title={`裁剪 ${agent.name} 的头像`} saving={avatarSaving} onCancel={() => setAvatarCropFile(null)} onSave={(data) => void uploadAvatar(data)} />}
      <AgentRuntimePolicyPanel agent={agent} onUpdateAgent={onUpdateAgent} />
      <div className="agent-runtime-row" aria-live="polite">
        <span>
          {gatewayBusy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <RuntimePulse gateway={gateway} />}
          <strong>{gatewayOperationLabel || gatewayStatusLabel(gateway)}</strong>
          <small>{runtimeProfileName}</small>
          {!gatewayBusy && gateway?.error && <em>{gateway.error}</em>}
        </span>
        <div>
          <button className="secondary-btn" onClick={() => void refreshGatewayStatus()} disabled={gatewayBusy}>{gatewayOperation === 'refreshing' ? '刷新中' : '刷新状态'}</button>
          <button className="secondary-btn" onClick={() => void startGateway()} disabled={gatewayBusy}>{gatewayOperation === 'restarting' ? '重启中' : gatewayOperation === 'starting' ? '启动中' : gateway?.running ? '重启网关' : '启动网关'}</button>
          <button className="secondary-btn" onClick={() => void stopGateway()} disabled={gatewayBusy || !agent.profileName}>{gatewayOperation === 'stopping' ? '停止中' : '停止网关'}</button>
        </div>
      </div>
      <div className={runtimeConfigOpen ? 'agent-runtime-config open' : 'agent-runtime-config'}>
        <button className="agent-runtime-config-toggle" onClick={() => setRuntimeConfigOpen((value) => !value)} aria-expanded={runtimeConfigOpen}>
          <span>
            <strong>Hermes 原生配置</strong>
            <small>{runtimeProfileName ? `正在编辑：${runtimeProfileName}` : '这个 Agent 暂时没有绑定 Hermes Profile。'}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        {runtimeConfigOpen && (
          runtimeProfileName ? (
            <HermesProfileConfigEditor profileName={runtimeProfileName} compact />
          ) : (
            <div className="empty-state">这个 Agent 暂时没有绑定 Hermes Profile。</div>
          )
        )}
      </div>
      <div className="agent-tab-panel">
        {tab === 'notes' && <EditableTextPanel agentId={agent.id} title="笔记" kind="notes" profileName={editableProfileName} text={agent.memory || ''} fallback={agent.memoryExcerpt || '这个 Profile 暂时没有 MEMORY.md 可展示。'} onEdit={() => openEditor('notes', '笔记')} editor={profileEditor} />}
        {tab === 'user' && <EditableTextPanel agentId={agent.id} title="用户画像" kind="user" profileName={editableProfileName} text={agent.userProfile || ''} fallback={agent.userProfileExcerpt || '这个 Profile 暂时没有 USER.md 可展示。'} onEdit={() => openEditor('user', '用户画像')} editor={profileEditor} />}
        {tab === 'soul' && <EditableTextPanel agentId={agent.id} title="灵魂" kind="soul" profileName={editableProfileName} text={agent.soul || ''} fallback={agent.soulExcerpt || '这个 Profile 暂时没有 SOUL.md 可展示。'} onEdit={() => openEditor('soul', '灵魂')} editor={profileEditor} />}
      </div>
    </section>
  );
}

function EditableTextPanel({ agentId, title, kind, profileName, text, fallback, onEdit, editor }: { agentId: string; title: string; kind: 'notes' | 'user' | 'soul'; profileName: string; text: string; fallback: string; onEdit: () => void; editor: ProfileEditorControls }) {
  const isActive = editor.state.target?.agentId === agentId && editor.state.target.kind === kind;
  return (
    <div className="text-panel editable-panel">
      <div className="panel-edit-head">
        <strong>{title}</strong>
        {!isActive && (profileName ? <button className="secondary-btn" onClick={onEdit}><Pencil size={15} />编辑</button> : <span>保存为 Hermes Profile 后可编辑</span>)}
      </div>
      {isActive ? <InlineProfileEditor editor={editor} /> : <p>{text || fallback}</p>}
    </div>
  );
}

function InlineProfileEditor({ editor }: { editor: ProfileEditorControls }) {
  const { state, dirty } = editor;
  if (state.loading) return <div className="inline-profile-editor-state">正在读取文件...</div>;
  if (state.errorStage === 'load') {
    return (
      <div className="inline-profile-editor-state error">
        <span>{state.error}</span>
        <button className="secondary-btn" onClick={editor.discard}>关闭</button>
      </div>
    );
  }
  return (
    <div className="inline-profile-editor">
      <textarea
        className="inline-profile-editor-textarea"
        value={state.draft}
        onChange={(event) => editor.changeDraft(event.target.value)}
        disabled={state.saving}
        spellCheck={false}
        autoFocus
      />
      <div className="inline-profile-editor-footer">
        <div className="inline-profile-editor-status">
          {state.error ? <span className="error">{state.error}</span> : dirty ? <span>有未保存修改</span> : <span>已同步</span>}
        </div>
        <div className="panel-edit-actions">
          <button className="secondary-btn" onClick={editor.discard} disabled={state.saving}>取消</button>
          <button className="send-btn" onClick={() => void editor.save()} disabled={state.saving || !dirty}>{state.saving ? '保存中' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

function AgentAvatar({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' }) {
  return (
    <span className={`agent-avatar ${size}`} style={agent.avatarUrl ? undefined : { background: agent.color }}>
      {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1)}
    </span>
  );
}

function RailScrollingTitle({ title, className = '' }: { title: string; className?: string }) {
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

  return <strong ref={titleRef} className={`rail-scrolling-title ${className}`.trim()} title={title}>{title}</strong>;
}

function ThreadRailContent({ thread, agents, onOpen, onMore }: {
  thread: ThreadSummary;
  agents: Agent[];
  onOpen: () => void;
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const participantIds = [...new Set([
    ...(thread.participantAgentIds || []),
    thread.defaultAgentId,
    thread.activeAgentId,
    thread.primaryAgentId,
  ].filter((agentId): agentId is string => Boolean(agentId)))];
  const participants = participantIds.map((agentId) => agentById.get(agentId)).filter((agent): agent is Agent => Boolean(agent));
  const visibleParticipants = participants.slice(0, 3);
  const hiddenCount = Math.max(0, participants.length - visibleParticipants.length);
  const statusLabel = thread.runStatus === 'running' ? '运行中' : thread.runStatus === 'failed' ? '运行失败' : '就绪';
  const participantLabel = participants.length ? participants.map((agent) => agent.name).join('、') : (thread.primaryAgentName || 'Agent');
  const pinnedLabel = thread.pinnedAt ? '，已置顶' : '';

  return (
    <>
      <button className="rail-main rail-thread-main" onClick={onOpen} aria-label={`${thread.title}${pinnedLabel}，参与 Agent：${participantLabel}，${statusLabel}`}>
        <span className="rail-thread-line">
          {thread.pinnedAt && <span className="rail-thread-pin" title="已置顶" aria-hidden="true"><Pin size={12} fill="currentColor" /></span>}
          <RailScrollingTitle title={thread.title} className="rail-thread-title" />
          <span className={`rail-thread-participants ${thread.runStatus || 'idle'}`} title={participantLabel} aria-hidden="true">
            {visibleParticipants.map((agent) => {
              const isActive = agent.id === (thread.activeAgentId || thread.defaultAgentId || thread.primaryAgentId);
              return (
                <span className={`rail-thread-avatar ${thread.runStatus === 'running' && isActive ? 'active-running' : ''} ${thread.runStatus === 'failed' && isActive ? 'active-failed' : ''}`} key={agent.id} style={agent.avatarUrl ? undefined : { background: agent.color }}>
                  {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1).toUpperCase()}
                </span>
              );
            })}
            {hiddenCount > 0 && <span className="rail-thread-overflow">+{hiddenCount}</span>}
          </span>
        </span>
      </button>
      <button className="rail-more-button" onClick={onMore} aria-label={`更多对话操作：${thread.title}`} title="更多">
        <MoreHorizontal size={15} />
      </button>
    </>
  );
}

function RenameDialog({ target, onClose, onSave, onGenerateTitle }: {
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
    <AppDialog open onOpenChange={(nextOpen) => { if (!nextOpen && !saving && !generating) onClose(); }}>
      <AppDialogContent className="rename-dialog app-form-dialog" onEscapeKeyDown={(event) => { if (saving || generating) event.preventDefault(); }}>
        <form className="rename-dialog-form" onSubmit={(event) => void submit(event)}>
          <header className="rename-dialog-head">
            <AppDialogTitle asChild><h2>重命名{noun}</h2></AppDialogTitle>
            <AppDialogDescription className="visually-hidden">输入新的{noun}名称，或自动生成一个标题。</AppDialogDescription>
            <AppDialogClose asChild>
              <button type="button" className="rename-dialog-close" aria-label="关闭" disabled={saving || generating}><X size={15} /></button>
            </AppDialogClose>
          </header>
          <label className="rename-dialog-field">
            <span>{noun}名称</span>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={60} autoFocus disabled={saving || generating} />
          </label>
          {error && <div className="inline-error">{error}</div>}
          <footer className="rename-dialog-actions">
            {onGenerateTitle
              ? <button type="button" className="rename-title-generate" disabled={saving || generating} onClick={() => void generateTitle()}>{generating ? '生成中…' : '自动生成标题'}</button>
              : <span />}
            <div>
              <AppDialogClose asChild><button type="button" className="rename-dialog-cancel" disabled={saving || generating}>取消</button></AppDialogClose>
              <button type="submit" className="rename-dialog-save" disabled={saving || generating || !draft.trim()}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </footer>
        </form>
      </AppDialogContent>
    </AppDialog>
  );
}

function readLaunchUserAvatarSnapshot() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(launchUserAvatarSnapshotKey);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

function writeLaunchUserAvatarSnapshot(avatarUrl: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (avatarUrl) window.localStorage.setItem(launchUserAvatarSnapshotKey, avatarUrl);
    else window.localStorage.removeItem(launchUserAvatarSnapshotKey);
  } catch {
    // localStorage can be disabled; the launch screen still renders from live profile data.
  }
}

function readLaunchMaterialSnapshot(nativeMaterial: boolean): LaunchMaterialSnapshot {
  const fallbackDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const fallbackTheme = normalizeSpaceTheme({
    ...defaultProductSpaceTheme,
    colorMode: nativeMaterial ? 'native' : 'custom',
    appearance: fallbackDark ? 'dark' : 'light',
  });
  const fallback = { activeSpaceId: 'space_default', theme: fallbackTheme, dark: fallbackDark };
  if (typeof window === 'undefined') return fallback;
  try {
    const value = JSON.parse(window.localStorage.getItem(launchMaterialSnapshotKey) || 'null');
    if (!value || typeof value !== 'object') return fallback;
    return {
      activeSpaceId: String(value.activeSpaceId || 'space_default'),
      theme: normalizeSpaceTheme(value.theme),
      dark: Boolean(value.dark),
    };
  } catch {
    return fallback;
  }
}

function writeLaunchMaterialSnapshot(snapshot: LaunchMaterialSnapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(launchMaterialSnapshotKey, JSON.stringify(snapshot));
  } catch {
    // The live theme still takes over as soon as workspace data is available.
  }
}

function MessageAvatar({ message, agents, userProfile }: { message: ChatEvent; agents: Agent[]; userProfile?: UserProfile }) {
  if (message.agentId === 'user') {
    const nickname = String(userProfile?.nickname || '').trim();
    const avatarUrl = String(userProfile?.avatarUrl || '').trim();
    if (!nickname && !avatarUrl) return null;
    return (
      <span className="user-message-avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : nickname.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const agent = agents.find((item) => item.id === message.agentId);
  if (agent) return <AgentAvatar agent={agent} />;
  return <span className="agent-avatar" style={{ background: agentColor(agents, message.agentId) }}>{message.agentName.slice(0, 1)}</span>;
}

function isBrowserPreviewableImage(file: File) {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type.toLowerCase());
}

function isInlineAttachmentImage(attachment: Attachment) {
  return attachment.kind === 'image' && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mimeType.toLowerCase());
}

function attachmentKindLabel(kind: Attachment['kind']) {
  if (kind === 'image') return '图片';
  if (kind === 'text') return '文本';
  if (kind === 'document') return '文档';
  if (kind === 'audio') return '音频';
  if (kind === 'video') return '视频';
  return '压缩包';
}

function AttachmentTray({ attachments, notice, onRemove, onRetry }: { attachments: AttachmentDraft[]; notice: string; onRemove: (localId: string) => void; onRetry: (localId: string) => void }) {
  if (!attachments.length && !notice) return null;
  return (
    <div className="attachment-tray-wrap">
      {attachments.length > 0 && (
        <div className="attachment-tray" aria-label="已选择附件">
          {attachments.map((draft) => {
            const attachment = draft.attachment;
            const label = attachment ? attachmentKindLabel(attachment.kind) : '附件';
            if (draft.previewUrl) {
              return (
                <div className={`attachment-preview-card ${draft.status}`} key={draft.localId}>
                  <a href={draft.previewUrl} target="_blank" rel="noreferrer" aria-label={`查看 ${draft.file.name}`}><img src={draft.previewUrl} alt={draft.file.name} /></a>
                  <button className="attachment-remove" onClick={() => onRemove(draft.localId)} aria-label={`移除 ${draft.file.name}`}><X size={13} /></button>
                  <span>{draft.status === 'uploading' ? <><LoaderCircle className="spin" size={12} />上传中</> : draft.status === 'error' ? '上传失败' : draft.file.name}</span>
                  {draft.status === 'error' && <button className="attachment-retry" onClick={() => onRetry(draft.localId)}><RefreshCw size={12} />重试</button>}
                </div>
              );
            }
            return (
              <div className={`attachment-file-card ${draft.status}`} key={draft.localId}>
                <span className="attachment-file-icon">{attachment?.kind === 'image' ? <Image size={20} /> : <FileText size={20} />}</span>
                <span className="attachment-file-copy"><strong>{draft.file.name}</strong><small>{draft.status === 'uploading' ? '上传中…' : draft.status === 'error' ? draft.error || '上传失败' : `${label} · ${formatFileSize(draft.file.size)}`}</small></span>
                {draft.status === 'error' && <button className="attachment-retry" onClick={() => onRetry(draft.localId)} aria-label={`重试 ${draft.file.name}`}><RefreshCw size={13} /></button>}
                <button className="attachment-remove" onClick={() => onRemove(draft.localId)} aria-label={`移除 ${draft.file.name}`}><X size={13} /></button>
              </div>
            );
          })}
        </div>
      )}
      {notice && <div className="attachment-notice" role="alert">{notice}</div>}
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => isInlineAttachmentImage(attachment) ? (
        <MessageImageAttachment attachment={attachment} key={attachment.id} />
      ) : (
        <a className="message-attachment-file" href={attachment.contentUrl} target="_blank" rel="noreferrer" key={attachment.id}>
          <FileText size={20} />
          <span><strong>{attachment.name}</strong><small>{attachmentKindLabel(attachment.kind)} · {formatFileSize(attachment.size)}</small></span>
        </a>
      ))}
    </div>
  );
}

function MessageImageAttachment({ attachment }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  if (failed) {
    return (
      <a className="message-attachment-file message-attachment-image-error" href={attachment.contentUrl} target="_blank" rel="noreferrer">
        <Image size={20} />
        <span><strong>{attachment.name}</strong><small>图片加载失败 · 点击重试</small></span>
      </a>
    );
  }
  return (
    <>
      <button ref={triggerRef} className="message-attachment-image" type="button" aria-label={`预览 ${attachment.name}`} aria-haspopup="dialog" onClick={() => setPreviewOpen(true)}>
        <img src={attachment.contentUrl} alt="" onError={() => setFailed(true)} />
        <span>{attachment.name}</span>
      </button>
      {previewOpen && <ImageLightbox attachment={attachment} onClose={closePreview} />}
    </>
  );
}

function ImageLightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    closeTimerRef.current = window.setTimeout(onClose, reduceMotion ? 0 : 140);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.setAttribute('inert', '');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appRoot && !rootWasInert) appRoot.removeAttribute('inert');
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, [requestClose]);

  return createPortal(
    <div className={`image-lightbox ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={`预览 ${attachment.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <button className="image-lightbox-close" type="button" onClick={requestClose} aria-label="关闭图片预览" autoFocus><X size={22} /></button>
      <figure className="image-lightbox-stage" onMouseDown={(event) => event.stopPropagation()}>
        <img src={attachment.contentUrl} alt={attachment.name} />
        <figcaption>{attachment.name}</figcaption>
      </figure>
    </div>,
    document.body,
  );
}

function MentionTextarea({ value, onChange, onSend, sendKey, agents, selectedAgentIds, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sendKey: WorkbenchUiSettings['sendKey'];
  agents: Agent[];
  selectedAgentIds: string[];
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const options = buildMentionOptions(agents, selectedAgentIds, mentionQuery).slice(0, 8);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = Number.parseFloat(getComputedStyle(el).maxHeight);
    const nextHeight = Number.isFinite(maxHeight) ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!mentionActive) return;
      const target = event.target as HTMLElement;
      if (!target.closest('.mention-menu')) setMentionActive(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mentionActive]);

  useEffect(() => {
    const active = dropdownRef.current?.querySelector('.active') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function updateMentionState(nextValue = value) {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    let atPos = -1;
    for (let index = cursorPos - 1; index >= 0; index -= 1) {
      const char = nextValue[index];
      if (char === '@') {
        atPos = index;
        break;
      }
      if (/\s/.test(char || '')) break;
    }
    if (atPos === -1 || (atPos > 0 && /[A-Za-z0-9_]/.test(nextValue[atPos - 1] || ''))) {
      setMentionActive(false);
      return;
    }
    const query = nextValue.slice(atPos + 1, cursorPos);
    if (/\s/.test(query)) {
      setMentionActive(false);
      return;
    }
    const nextOptions = buildMentionOptions(agents, selectedAgentIds, query);
    setMentionQuery(query);
    setMentionStartIndex(atPos);
    setActiveIndex(0);
    setMentionActive(nextOptions.length > 0);
  }

  function selectMention(option: MentionOption) {
    const el = textareaRef.current;
    if (!el || mentionStartIndex < 0) return;
    const before = value.slice(0, mentionStartIndex);
    const after = value.slice(el.selectionStart);
    const insert = `@${option.name} `;
    const nextValue = `${before}${insert}${after}`;
    onChange(nextValue);
    setMentionActive(false);
    requestAnimationFrame(() => {
      const nextPos = before.length + insert.length;
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionActive && options.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectMention(options[activeIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionActive(false);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && (sendKey !== 'mod-enter' || event.metaKey || event.ctrlKey)) {
      if (isComposing || event.nativeEvent.isComposing) return;
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="mention-textarea-wrap">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (!isComposing) requestAnimationFrame(() => updateMentionState(event.target.value));
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => {
          setIsComposing(false);
          requestAnimationFrame(() => updateMentionState());
        }}
        onClick={() => updateMentionState()}
        placeholder={placeholder}
      />
      {mentionActive && options.length > 0 && (
        <div className="mention-menu" ref={dropdownRef}>
          {options.map((option, index) => (
            <button
              type="button"
              className={index === activeIndex ? 'mention-option active' : 'mention-option'}
              key={option.key}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMention(option);
              }}
            >
              {option.agent ? <AgentAvatar agent={option.agent} size="sm" /> : <span className="mention-all-avatar">@</span>}
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentSessionModelModal({ agent, models, value, onClose, onSave, onOpenModels }: { agent: Agent | null; models: ModelProfile[]; value: string; onClose: () => void; onSave: (agentId: string, modelId: string) => Promise<void>; onOpenModels: () => void }) {
  const availableModels = hermesProfileModels(models);
  const [draftModelId, setDraftModelId] = useState(value || (availableModels[0] ? modelChoiceValue(availableModels[0], availableModels[0].model) : ''));
  useEffect(() => setDraftModelId(value || (availableModels[0] ? modelChoiceValue(availableModels[0], availableModels[0].model) : '')), [value, models.length, agent?.id]);
  if (!agent) return null;
  const disabled = !availableModels.length || !draftModelId;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agent-model-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{agent.name} 的本会话模型</h2><p>只影响当前对话，不修改 Agent 默认模型。</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="agent-model-body">
          <div className="agent-model-target">
            <AgentAvatar agent={agent} />
            <span><strong>{agent.name}</strong><small>默认模型：{agentDefaultModelLabel(agent, models)}</small></span>
          </div>
          <label className="form-row">
            <span>本会话使用模型</span>
            <ProviderModelPicker models={availableModels} value={draftModelId} onChange={setDraftModelId} emptyLabel="未配置模型" />
          </label>
          {!availableModels.length && <div className="inline-error">还没有可选模型，请先进入模型中心配置。</div>}
          <div className="modal-actions">
            <button className="secondary-btn" onClick={onOpenModels}>进入模型中心</button>
            <button className="send-btn" disabled={disabled} onClick={() => void onSave(agent.id, draftModelId)}>保存本会话模型</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RailContextMenu({ target, canShowInFinder, onClose, onToggleWorkspacePinned, onRenameWorkspace, onArchiveWorkspace, onDeleteWorkspace, onShowInFinder, onCopyText, onEditSpace, onToggleThreadPinned, onRenameThread, onArchiveThread, onDeleteThread }: {
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
    <AppMenu open modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AppMenuTrigger asChild>
        <span className="rail-menu-virtual-anchor" style={anchorStyle} aria-hidden="true" />
      </AppMenuTrigger>
      <AppMenuContent className={space ? 'rail-menu-content compact' : 'rail-menu-content'} side="bottom" align="start" sideOffset={0}>
        {space ? (
          <>
            <AppMenuItem onSelect={() => void run(() => onEditSpace(space))}><Settings /><span>编辑工作区</span></AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem onSelect={() => void run(() => onCopyText(space.id))}><Copy /><span>复制工作区 ID</span></AppMenuItem>
          </>
        ) : workspace ? (
          <>
            <AppMenuItem onSelect={() => void run(() => onToggleWorkspacePinned(workspace))}><Pin /><span>{workspace.pinnedAt ? '取消置顶项目' : '置顶项目'}</span></AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onRenameWorkspace(workspace))}><Pencil /><span>重命名项目</span></AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onArchiveWorkspace(workspace))}><Archive /><span>归档项目</span></AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem disabled={!canShowInFinder || !rootPath} onSelect={() => void run(() => onShowInFinder(rootPath))}><FolderOpen /><span>在 Finder 中显示</span></AppMenuItem>
            <AppMenuItem disabled={!rootPath} onSelect={() => void run(() => onCopyText(rootPath))}><Copy /><span>复制项目路径</span></AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onCopyText(workspace.id))}><Copy /><span>复制项目 ID</span></AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem variant="destructive" onSelect={() => void run(() => onDeleteWorkspace(workspace))}><Trash2 /><span>删除项目</span></AppMenuItem>
          </>
        ) : thread ? (
          <>
            <AppMenuItem onSelect={() => void run(() => onToggleThreadPinned(thread))}><Pin /><span>{thread.pinnedAt ? '取消置顶对话' : '置顶对话'}</span></AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onRenameThread(thread))}><Pencil /><span>重命名对话</span></AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onArchiveThread(thread))}><Archive /><span>归档对话</span></AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem disabled={!canShowInFinder || !rootPath} onSelect={() => void run(() => onShowInFinder(rootPath))}><FolderOpen /><span>在 Finder 中显示</span></AppMenuItem>
            <AppMenuItem disabled={!rootPath} onSelect={() => void run(() => onCopyText(rootPath))}><Copy /><span>复制项目路径</span></AppMenuItem>
            <AppMenuItem onSelect={() => void run(() => onCopyText(thread.id))}><Copy /><span>复制会话 ID</span></AppMenuItem>
            <AppMenuSeparator />
            <AppMenuItem variant="destructive" onSelect={() => void run(() => onDeleteThread(thread))}><Trash2 /><span>删除对话</span></AppMenuItem>
          </>
        ) : null}
      </AppMenuContent>
    </AppMenu>
  );
}

function RailConfirmDialog({ target, onCancel, onConfirm }: { target: Exclude<RailConfirm, null>; onCancel: () => void; onConfirm: () => void }) {
  const noun = target.kind === 'workspace' ? '项目' : '对话';
  const hint = target.kind === 'workspace'
    ? '只移除 Frakio Work 记录，不删除本地文件夹。'
    : '删除后会从侧栏移除，不进入归档。';
  return (
    <AppAlertDialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AppAlertDialogContent>
        <AppAlertDialogTitle className="app-alert-title">删除{noun}？</AppAlertDialogTitle>
        <AppAlertDialogDescription className="app-alert-description">
          <strong>{target.title}</strong>
          <span>{hint}</span>
        </AppAlertDialogDescription>
        <div className="app-alert-actions">
          <AppAlertDialogCancel className="cancel" autoFocus onClick={onCancel}>取消</AppAlertDialogCancel>
          <AppAlertDialogAction className="danger" onClick={onConfirm}>删除</AppAlertDialogAction>
        </div>
      </AppAlertDialogContent>
    </AppAlertDialog>
  );
}

function trimMessageStart(content: string) {
  return String(content || '').replace(/^\s*\n+/, '').trimStart();
}

type StreamRevealFrame = {
  rawContent: string;
  displayedContent: string;
  appendedGraphemes: number;
  revision: number;
  settled: boolean;
};

function useStreamRevealFrame(rawContent: string, enabled: boolean, reduceMotion: boolean): StreamRevealFrame {
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
      setFrame((current) => ({
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
      setFrame((current) => ({
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
      setFrame((current) => ({
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
      setFrame((current) => ({
        rawContent: rawRef.current,
        displayedContent: rawRef.current,
        appendedGraphemes: 0,
        revision: current.revision,
        settled: true,
      }));
      return undefined;
    }
    if (rawRef.current !== displayedRef.current && queueStartedAtRef.current === 0) queueStartedAtRef.current = now;
    setFrame((current) => ({
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
      else setFrame((current) => current.settled && current.rawContent === rawRef.current
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

function MarkdownMessage({ content, streaming, streamReveal, threadId, workspaceId }: { content: string; streaming?: boolean; streamReveal?: StreamRevealFrame; threadId?: string | null; workspaceId?: string | null }) {
  return <RichMarkdown content={trimMessageStart(content)} streaming={streaming} streamReveal={streamReveal} threadId={threadId} workspaceId={workspaceId} />;
}

function useReplyPresenceHandoff(hasVisibleDraft: boolean, reduceMotion: boolean) {
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

const activityKindCopy: Record<RunActivityItem['kind'], { running: string; completed: string; unit: string }> = {
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

function activityGroupSummary(group: RunActivityGroup) {
  const counts = new Map<RunActivityItem['kind'], number>();
  group.items.forEach((item) => counts.set(item.kind, (counts.get(item.kind) || 0) + 1));
  const running = group.status === 'running';
  return [...counts.entries()].map(([kind, count]) => {
    const copy = activityKindCopy[kind] || activityKindCopy.other;
    return `${running ? copy.running : copy.completed} ${count} ${copy.unit}`;
  }).join(' · ') || group.summary;
}

function semanticActivityPreview(group: RunActivityGroup) {
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

function compactActivityTarget(item: RunActivityItem) {
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

function RunActivityStatusIcon({ item }: { item: RunActivityItem }) {
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

function RunActivityItemRow({ item, rowIndex }: { item: RunActivityItem; rowIndex: number }) {
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

function RunActivityGroupView({ group, hasFollowingText, runFinished, isCurrentGroup, showAwaiting }: { group: RunActivityGroup; hasFollowingText: boolean; runFinished: boolean; isCurrentGroup: boolean; showAwaiting: boolean }) {
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
                <span>正在思考下一步…</span>
              </div>
            )}
          </div>
        </div>
        </motion.div>}
      </AnimatePresence>
    </section>
  );
}

function RunTranscriptContent({ content, groups, streaming = false, streamReveal, runFinished = true, showAwaiting = false, threadId, workspaceId }: { content: string; groups: RunActivityGroup[]; streaming?: boolean; streamReveal?: StreamRevealFrame; runFinished?: boolean; showAwaiting?: boolean; threadId?: string | null; workspaceId?: string | null }) {
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

function PersistedInterruptedRuns({ thread, agents }: { thread: Thread | null; agents: Agent[] }) {
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

function ComposerRunButton({
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

function ChatRunStatus({
  target,
  startedAt,
  tick,
  draft,
  activityGroups,
  presentationPhase,
  error,
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
        {error && <div className="inline-error run-error">{error}</div>}
      </div>
    </article>
  );
}

function RunDecisionPanel({ clarification, approval, submitting, error, onAnswer, onSkip, onInterrupt, onApprove }: {
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

function MessageActions({ message, copied, feedbackBusy, branching, error, onCopy, onFeedback, onBranch }: {
  message: ChatEvent;
  copied: boolean;
  feedbackBusy: boolean;
  branching: boolean;
  error?: string;
  onCopy: () => void;
  onFeedback: (value: 'up' | 'down') => void;
  onBranch: () => void;
}) {
  const duration = Number(message.processingDurationMs || 0);
  return (
    <div className="message-actions-wrap">
      <div className="message-actions" aria-label="回复操作">
        <IconTooltipButton
          ariaLabel={copied ? '已复制回复' : '复制回复'}
          hoverDelayMs={180}
          placement="top"
          tooltip={copied ? '已复制' : '复制'}
          onClick={onCopy}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </IconTooltipButton>
        <IconTooltipButton
          active={message.feedback === 'up'}
          ariaLabel={message.feedback === 'up' ? '取消喜欢' : '喜欢'}
          disabled={feedbackBusy}
          aria-pressed={message.feedback === 'up'}
          hoverDelayMs={180}
          placement="top"
          tooltip={message.feedback === 'up' ? '取消喜欢' : '喜欢'}
          onClick={() => onFeedback('up')}
        >
          <ThumbsUp size={15} aria-hidden="true" />
        </IconTooltipButton>
        <IconTooltipButton
          active={message.feedback === 'down'}
          ariaLabel={message.feedback === 'down' ? '取消不喜欢' : '不喜欢'}
          disabled={feedbackBusy}
          aria-pressed={message.feedback === 'down'}
          hoverDelayMs={180}
          placement="top"
          tooltip={message.feedback === 'down' ? '取消不喜欢' : '不喜欢'}
          onClick={() => onFeedback('down')}
        >
          <ThumbsDown size={15} aria-hidden="true" />
        </IconTooltipButton>
        <IconTooltipButton
          ariaLabel="在新对话中继续"
          disabled={branching}
          aria-busy={branching || undefined}
          hoverDelayMs={180}
          placement="top"
          tooltip={branching ? '正在创建新对话' : '在新对话中继续'}
          onClick={onBranch}
        >
          {branching ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}
        </IconTooltipButton>
        {duration > 0 && <span className="message-processing-duration">已处理 {formatDuration(duration / 1000)}</span>}
      </div>
      {error && <span className="message-actions-error" role="alert">{error}</span>}
    </div>
  );
}

function AgentEditorModal({ title, models, agent, onClose, onSave }: { title: string; models: ModelProfile[]; agent: Agent | null; onClose: () => void; onSave: (payload: Partial<Agent>) => Promise<void> }) {
  const emptyAgent: Agent = { id: '', name: '', role: '', model: '', color: '#0f766e', soul: '', scope: '', runtimePolicy: { defaultRuntimeId: 'hermes', allowedRuntimeIds: ['hermes', 'pi'], permissionProfileId: 'default' } };
  const [draft, setDraft] = useState<Agent>(agent || emptyAgent);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(agent || emptyAgent);
  }, [agent?.id]);
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agent-editor" role="dialog" aria-modal="true" aria-labelledby="agent-editor-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><h2 id="agent-editor-title">{title}</h2><p>编辑 Agent 的人格、模型、职责和可用运行时。</p></div><button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
        <div className="agent-editor-body">
          <AgentFields draft={draft} setDraft={setDraft} models={models} />
        </div>
        <div className="agent-editor-footer"><button className="send-btn full" disabled={saving} onClick={() => void save()}>{saving ? '正在创建...' : '保存 Agent'}</button></div>
      </div>
    </div>
  );
}

function AgentFields({ draft, setDraft, models }: { draft: Agent; setDraft: (agent: Agent) => void; models: ModelProfile[] }) {
  const modelChoices = models.flatMap((model) => modelNamesForProvider(model).map((modelName) => ({ value: modelChoiceValue(model, modelName), label: `${model.name} · ${modelName}` })));
  const policy = draft.runtimePolicy || { defaultRuntimeId: draft.profileName ? 'hermes' : 'pi', allowedRuntimeIds: draft.profileName ? ['hermes', 'pi'] : ['pi'], permissionProfileId: 'default' };
  const runtimeOptions = [
    { id: 'hermes', name: 'Hermes Agent', description: '使用 Frakio Model Center' },
    { id: 'pi', name: 'Pi', description: '使用 Frakio Model Center' },
    { id: 'codex', name: 'Codex', description: '由原生 CLI 管理模型' },
    { id: 'claude', name: 'Claude Code', description: '由原生 CLI 管理模型' },
    { id: 'gemini', name: 'Gemini CLI', description: '由原生 CLI 管理模型' },
  ];
  const setRuntimePolicy = (next: AgentRuntimePolicy) => setDraft({ ...draft, runtimePolicy: next });
  return (
    <div className="agent-fields">
      <label>名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>角色<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label>
      <label>模型<select value={resolveModelChoice(draft.model, models).value} onChange={(event) => setDraft({ ...draft, model: event.target.value })}><option value="">未配置模型</option>{modelChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>
      <section className="agent-runtime-section" aria-labelledby="agent-runtime-title">
        <div className="agent-runtime-section-head">
          <div><strong id="agent-runtime-title">执行内核</strong><span>决定这个 Agent 可以使用哪些执行运行时。</span></div>
          <label className="agent-runtime-default"><span>默认内核</span><select value={policy.defaultRuntimeId} onChange={(event) => {
            const defaultRuntimeId = event.target.value;
            setRuntimePolicy({ ...policy, defaultRuntimeId, allowedRuntimeIds: Array.from(new Set([...policy.allowedRuntimeIds, defaultRuntimeId])) });
          }}>{runtimeOptions.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label>
        </div>
        <div className="agent-runtime-grid">
          {runtimeOptions.map((runtime) => {
            const checked = policy.allowedRuntimeIds.includes(runtime.id);
            const isDefault = runtime.id === policy.defaultRuntimeId;
            return <label className={`agent-runtime-card${checked ? ' selected' : ''}${isDefault ? ' default' : ''}`} key={runtime.id}>
              <input type="checkbox" checked={checked} disabled={isDefault} onChange={(event) => {
                const allowedRuntimeIds = event.target.checked
                  ? Array.from(new Set([...policy.allowedRuntimeIds, runtime.id]))
                  : policy.allowedRuntimeIds.filter((runtimeId) => runtimeId !== runtime.id);
                setRuntimePolicy({ ...policy, allowedRuntimeIds });
              }} />
              <span className="agent-runtime-card-icon"><RuntimeLabel runtimeId={runtime.id} showName={false} /></span>
              <span className="agent-runtime-card-copy"><strong>{runtime.name}</strong><small>{runtime.description}</small></span>
              {isDefault ? <span className="agent-runtime-default-badge">默认</span> : <span className="agent-runtime-check" aria-hidden="true">{checked ? <Check size={15} /> : null}</span>}
            </label>;
          })}
        </div>
      </section>
      <label>颜色<input value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
      <label>Soul<textarea value={draft.soul} onChange={(event) => setDraft({ ...draft, soul: event.target.value })} /></label>
      <label>职责范围<textarea value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} /></label>
    </div>
  );
}

function permissionCopy(mode: string) {
  return permissionDescription(mode);
}

function permissionLabel(mode: string) {
  if (mode === 'manual') return '请求批准';
  if (mode === 'smart') return '替我审批';
  return '完全访问';
}

function permissionDescription(mode: string) {
  if (mode === 'manual') return '编辑外部文件、执行命令和使用联网能力前先询问';
  if (mode === 'smart') return '仅对检测到的风险操作请求批准';
  return '跳过普通审批，硬性安全阻止和拒绝规则仍然生效';
}

function permissionTone(mode: string) {
  if (mode === 'manual') return 'manual';
  if (mode === 'smart') return 'smart';
  return 'full';
}

function permissionIcon(mode: string) {
  if (mode === 'manual') return Hand;
  if (mode === 'smart') return ShieldCheck;
  return ShieldAlert;
}

function isVisibleChatMessage(message: ChatEvent) {
  const content = String(message.content || '');
  if (message.agentId === 'system') return false;
  if (message.agentName === 'Hermes Bridge') return false;
  if (/Local Fallback|检测到 Hermes Studio|没有可用的模型 API Key|已回退到本地模拟/.test(`${message.role} ${content}`)) return false;
  if (/^(已开启普通对话|已开启与 .+ 的单 Agent 对话|已开启临时对话|项目已创建|新项目对话已创建|Workspace 已开启)/.test(content)) return false;
  return true;
}

function slugText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-').replace(/^-+|-+$/g, '') || 'new-project';
}

function normalizeSpaceThemePalette(theme?: Partial<SpaceThemePalette>, fallback: SpaceThemePalette = defaultProductSpaceTheme): SpaceThemePalette {
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(theme?.accentColor || '') ? theme!.accentColor! : fallback.accentColor;
  const sidebarBg = /^#[0-9a-fA-F]{6}$/.test(theme?.sidebarBg || '') ? theme!.sidebarBg! : fallback.sidebarBg;
  const texture = clampNumber(Number(theme?.texture ?? (theme?.noise == null ? fallback.texture || 0 : theme.noise / 0.35)), 0, 1);
  return {
    accentColor,
    sidebarBg,
    opacity: clampNumber(Number(theme?.opacity ?? fallback.opacity), 0.3, 0.9),
    noise: clampNumber(Number(theme?.noise ?? (texture * 0.35)), 0, 0.35),
    texture,
    mode: theme?.mode === 'crisp' ? 'crisp' : fallback.mode,
    gradientColors: normalizeGradientColors({ ...theme, accentColor, sidebarBg }),
  };
}

function deriveDarkThemePalette(theme: SpaceThemePalette): SpaceThemePalette {
  const colors = normalizeGradientColors(theme).map((color) => ({
    ...color,
    color: mixHexWithColor(color.color, '#11131a', 0.46),
  }));
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  return {
    ...theme,
    accentColor: primary?.color || mixHexWithColor(theme.accentColor, '#11131a', 0.46),
    sidebarBg: mixHexWithColor(theme.sidebarBg || theme.accentColor, '#12151c', 0.68),
    opacity: clampNumber(Math.max(theme.opacity, 0.76), 0.3, 0.9),
    mode: 'crisp',
    gradientColors: colors,
  };
}

function normalizeSpaceTheme(theme?: Partial<SpaceTheme>): SpaceTheme {
  const colorMode: SpaceThemeColorMode = theme?.colorMode === 'native' ? 'native' : 'custom';
  const appearance: SpaceThemeAppearance = theme?.appearance === 'auto' || theme?.appearance === 'dark' || theme?.appearance === 'light' ? theme.appearance : 'light';
  const legacyPalette = normalizeSpaceThemePalette(theme as Partial<SpaceThemePalette> | undefined);
  const lightTheme = normalizeSpaceThemePalette(theme?.lightTheme || legacyPalette, legacyPalette);
  const darkTheme = normalizeSpaceThemePalette(theme?.darkTheme || deriveDarkThemePalette(lightTheme), deriveDarkThemePalette(lightTheme));
  const activePalette = appearance === 'dark' ? darkTheme : legacyPalette;
  return { ...activePalette, colorMode, appearance, lightTheme, darkTheme, renderVersion: Math.max(3, Number(theme?.renderVersion) || 0) };
}

function isThemeNightTime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
}

function resolveEffectiveSpaceTheme(theme?: Partial<SpaceTheme>): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  if (normalized.appearance === 'dark') return { ...normalized.darkTheme!, colorMode: normalized.colorMode, appearance: normalized.appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme, renderVersion: normalized.renderVersion };
  if (normalized.appearance === 'auto' && isThemeNightTime()) return { ...normalized.darkTheme!, colorMode: normalized.colorMode, appearance: normalized.appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme, renderVersion: normalized.renderVersion };
  return { ...normalized.lightTheme!, colorMode: normalized.colorMode, appearance: normalized.appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme, renderVersion: normalized.renderVersion };
}

function resolveSpaceThemeForAppearance(theme: Partial<SpaceTheme> | undefined, dark: boolean): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  const palette = normalizeSpaceThemePalette(theme as Partial<SpaceThemePalette> | undefined);
  return { ...palette, colorMode: normalized.colorMode, appearance: dark ? 'dark' as const : 'light' as const, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme, renderVersion: normalized.renderVersion };
}

function withDraftThemePalette(theme: SpaceTheme, palette: SpaceThemePalette): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  const editsDark = normalized.appearance === 'dark' || (normalized.appearance === 'auto' && isThemeNightTime());
  const lightTheme = editsDark ? normalized.lightTheme! : palette;
  const darkTheme = editsDark ? palette : normalized.darkTheme || deriveDarkThemePalette(palette);
  return { ...palette, colorMode: normalized.colorMode, appearance: normalized.appearance, lightTheme, darkTheme, renderVersion: normalized.renderVersion };
}

function normalizeGradientColors(theme?: Partial<SpaceTheme>): SpaceGradientColor[] {
  const source = Array.isArray(theme?.gradientColors) ? theme!.gradientColors! : [];
  const valid = source
    .filter((color) => /^#[0-9a-fA-F]{6}$/.test(color.color || ''))
    .slice(0, 3)
    .map((color, index) => ({
      id: String(color.id || `color_${index}`),
      color: color.color,
      x: clampNumber(Number(color.x ?? (index === 0 ? 0.18 : index === 1 ? 0.62 : 0.38)), 0, 1),
      y: clampNumber(Number(color.y ?? (index === 0 ? 0.72 : index === 1 ? 0.28 : 0.27)), 0, 1),
      isPrimary: Boolean(color.isPrimary),
    }));
  if (!valid.length) {
    valid.push({
      id: 'primary',
      color: /^#[0-9a-fA-F]{6}$/.test(theme?.accentColor || '') ? theme!.accentColor! : '#8b8cf6',
      x: 0.18,
      y: 0.72,
      isPrimary: true,
    });
  }
  const primaryIndex = Math.max(0, valid.findIndex((color) => color.isPrimary));
  return valid.map((color, index) => ({ ...color, isPrimary: index === primaryIndex }));
}

function primaryGradientColor(theme?: Partial<SpaceTheme>) {
  const colors = normalizeGradientColors(theme);
  return colors.find((color) => color.isPrimary) || colors[0];
}

function syncThemeFromGradientColors(theme: SpaceTheme): SpaceTheme {
  const gradientColors = normalizeGradientColors(theme);
  const primary = gradientColors.find((color) => color.isPrimary) || gradientColors[0];
  return {
    ...theme,
    accentColor: primary.color,
    sidebarBg: mixHexWithWhite(primary.color, theme.mode === 'crisp' ? 0.66 : 0.78),
    noise: clampNumber(Number(theme.noise ?? (theme.texture ?? 0) * 0.35), 0, 0.35),
    texture: clampNumber(Number(theme.texture ?? (theme.noise == null ? 0 : theme.noise / 0.35)), 0, 1),
    gradientColors,
  };
}

function updateSpaceThemeColorPoint(theme: SpaceTheme, colorId: string, x: number, y: number, nextColor = colorFromThemePoint(x, y)): SpaceTheme {
  const currentColors = normalizeGradientColors(theme);
  const movedColor = currentColors.find((color) => color.id === colorId);
  const movedColors = currentColors.map((color) => color.id === colorId ? { ...color, x, y, color: nextColor } : color);
  const gradientColors = movedColor?.isPrimary ? calculateHarmonyColors(movedColors, 'update') : movedColors;
  return syncThemeFromGradientColors({ ...theme, gradientColors });
}

function promoteGradientColor(theme: SpaceTheme, colorId: string): SpaceTheme {
  const colors = normalizeGradientColors(theme);
  const promoted = colors.find((color) => color.id === colorId);
  if (!promoted?.id) return syncThemeFromGradientColors({ ...theme, gradientColors: colors });
  const gradientColors = calculateHarmonyColors(colors.map((color) => ({ ...color, isPrimary: color.id === colorId })), 'update');
  return syncThemeFromGradientColors({ ...theme, gradientColors });
}

function buildSpaceThemeFromPoint(x: number, y: number, color = colorFromThemePoint(x, y), mode: SpaceTheme['mode'] = 'soft'): SpaceTheme {
  return {
    accentColor: color,
    sidebarBg: mixHexWithWhite(color, mode === 'crisp' ? 0.66 : 0.78),
    opacity: 0.5,
    noise: 0,
    texture: 0,
    mode,
    gradientColors: [{ id: 'primary', color, x, y, isPrimary: true }],
    colorMode: 'custom',
    renderVersion: 3,
  };
}

function buildPresetGradientColors(colors: string[], point: { x: number; y: number }, harmony: ThemeHarmony, type: ThemePreset['type'] = 'color'): SpaceGradientColor[] {
  const primary = colors[0] || '#8d9bb8';
  if (colors.length === 1) return [{ id: 'primary', color: primary, x: point.x, y: point.y, isPrimary: true }];
  const positioned = calculateHarmonyColors([
    { id: 'primary', color: primary, x: point.x, y: point.y, isPrimary: true },
    { id: 'secondary_a', color: colors[1] || primary, x: point.x, y: point.y },
    { id: 'secondary_b', color: colors[2] || primary, x: point.x, y: point.y },
  ], 'update', harmony);
  return positioned.map((color, index) => ({ ...color, color: colors[index] || primary, id: index === 0 ? 'primary' : `secondary_${index}` }));
}

function clampThemePointToSquare(xValue: number, yValue: number) {
  return {
    x: clampNumber(Number.isFinite(xValue) ? xValue : 0.5, 0, 1),
    y: clampNumber(Number.isFinite(yValue) ? yValue : 0.5, 0, 1),
  };
}

function wavePathForOpacity(opacity: number) {
  const progress = opacityProgress(opacity);
  const startX = 51.373;
  const endX = 419.634;
  const centerY = 27.395;
  if (progress < 0.03) return 'M 51.373 27.395 L 419.634 27.395';
  const amp = 35.898 * progress;
  const segmentCount = 14;
  const segmentWidth = (endX - startX) / segmentCount;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const x0 = startX + segmentWidth * index;
    const x1 = startX + segmentWidth * (index + 1);
    const y = centerY + (index % 2 === 0 ? -amp : amp);
    return `C ${(x0 + segmentWidth / 3).toFixed(3)} ${y.toFixed(3)} ${(x0 + segmentWidth * 2 / 3).toFixed(3)} ${y.toFixed(3)} ${x1.toFixed(3)} ${centerY}`;
  });
  return `M ${startX} ${centerY} ${segments.join(' ')}`;
}

function opacityProgress(opacity: number) {
  return clampNumber((opacity - 0.3) / 0.6, 0, 1);
}

function calculateHarmonyColors(colors: SpaceGradientColor[], action: 'add' | 'remove' | 'update' = 'update', harmony?: ThemeHarmony) {
  const normalized = normalizeGradientColors({ gradientColors: colors });
  const targetCount = clampNumber(action === 'add' ? normalized.length + 1 : normalized.length, 1, 3);
  const primary = normalized.find((color) => color.isPrimary) || normalized[0];
  const center = { x: 0.5, y: 0.5 };
  const dx = primary.x - center.x;
  const dy = primary.y - center.y;
  const radius = clampNumber(Math.sqrt(dx * dx + dy * dy), 0, 0.5);
  const baseAngle = Math.atan2(dy, dx);
  const nextColors: SpaceGradientColor[] = [{ ...primary, isPrimary: true }];
  const secondaries = normalized.filter((color) => !color.isPrimary);
  const activeHarmony: ThemeHarmony = harmony || (targetCount === 1 ? 'floating' : targetCount === 2 ? 'complementary' : 'splitComplementary');
  const angleOffsets = targetCount === 2
    ? [activeHarmony === 'singleAnalogous' ? 310 : 180]
    : targetCount === 3
      ? activeHarmony === 'analogous' ? [50, 310] : activeHarmony === 'triadic' ? [120, 240] : [150, 210]
      : [];
  angleOffsets.forEach((offset, index) => {
    const angle = baseAngle + offset * Math.PI / 180;
    const point = clampThemePointToSquare(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    const existing = secondaries[index];
    nextColors.push({
      id: existing?.id || `secondary_${index + 1}`,
      color: colorFromThemePoint(point.x, point.y),
      x: point.x,
      y: point.y,
      isPrimary: false,
    });
  });
  return nextColors;
}

function textureStepDots(texture = 0) {
  const activeValue = Math.round(clampNumber(texture, 0, 1) * 16) / 16;
  return Array.from({ length: 16 }, (_, index) => {
    const angle = index / 16 * Math.PI * 2;
    let order = index + 4;
    if (order >= 16) order -= 16;
    return {
      id: index,
      left: 50 + Math.cos(angle) * 50,
      top: 50 + Math.sin(angle) * 50,
      active: activeValue > 0 && order > 0 && order / 16 <= activeValue,
    };
  });
}

function textureHandleStyle(texture = 0) {
  const value = clampNumber(texture, 0, 1);
  const rotation = value * 360 - 90;
  const top = Math.sin(rotation * Math.PI / 180) * 50 + 50;
  const left = Math.cos(rotation * Math.PI / 180) * 50 + 50;
  return { left: `${left}%`, top: `${top}%`, transform: `translate(-50%, -50%) rotate(${rotation + 90}deg)` };
}

function themeGradientBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'picker');
}

function themeStageBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'stage');
}

function themeShellBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'shell');
}

function macThemeBackground(theme: SpaceTheme) {
  const colors = normalizeGradientColors(theme);
  const strength = Math.round(workspaceTintAlpha(theme.opacity) * 100);
  const tint = (color: string) => `color-mix(in srgb, ${color} ${strength}%, transparent)`;
  if (colors.length <= 1) return `linear-gradient(${tint(colors[0]?.color || theme.accentColor)}, ${tint(colors[0]?.color || theme.accentColor)})`;
  if (colors.length === 2) {
    return `linear-gradient(-45deg, ${tint(colors[1].color)} 0%, transparent 100%), linear-gradient(135deg, ${tint(colors[0].color)} 0%, transparent 100%)`;
  }
  return `linear-gradient(-5deg, ${tint(colors[2].color)} 10%, transparent 80%), radial-gradient(circle at 95% 0%, ${tint(colors[1].color)} 0%, transparent 75%), radial-gradient(circle at 0% 0%, ${tint(colors[0].color)} 10%, transparent 70%)`;
}

function spaceRailContrastTokens(theme: SpaceTheme, dark: boolean) {
  if (theme.colorMode === 'native') {
    return dark
      ? { text: '#f1f1f1', muted: 'rgb(241 241 241 / 66%)' }
      : { text: '#202124', muted: 'rgb(32 33 36 / 60%)' };
  }
  const primary = primaryGradientColor(theme).color;
  const foreground = contrastForegroundForTint(primary, workspaceTintAlpha(theme.opacity), dark);
  return foreground === 'light'
    ? { text: '#ffffff', muted: 'rgb(255 255 255 / 70%)' }
    : { text: '#111214', muted: 'rgb(17 18 20 / 64%)' };
}

function themeZenGradientBackground(theme: SpaceTheme, surface: 'picker' | 'stage' | 'shell') {
  const colors = normalizeGradientColors(theme);
  if (isNeutralProductTheme(theme)) {
    if (surface === 'stage') return 'radial-gradient(circle at 68% 18%, rgb(225 232 255 / 34%) 0%, transparent 34%), radial-gradient(circle at 10% 4%, rgb(220 235 228 / 42%) 0%, transparent 38%), #fafbfa';
    if (surface === 'shell') return 'linear-gradient(135deg, #f2f7f4 0%, #fafbfa 48%, #f5f7fb 100%)';
    return 'radial-gradient(circle at 16% 10%, rgb(214 231 223 / 72%) 0%, transparent 54%), #f5f8f6';
  }
  const base = themeGradientBase(theme, surface);
  if (colors.length <= 1) {
    const primary = softenThemeGradientColor(colors[0]?.color || theme.accentColor, theme, surface);
    return [
      `radial-gradient(circle at 12% 0%, ${primary} 0%, transparent ${surface === 'stage' ? '74%' : '68%'})`,
      base,
    ].join(', ');
  }
  if (colors.length === 2) {
    const first = softenThemeGradientColor(colors[0].color, theme, surface);
    const second = softenThemeGradientColor(colors[1].color, theme, surface);
    return [
      `linear-gradient(-45deg, ${second} 0%, transparent 100%)`,
      `linear-gradient(135deg, ${first} 0%, transparent 100%)`,
      base,
    ].join(', ');
  }
  const first = softenThemeGradientColor(colors[0].color, theme, surface);
  const second = softenThemeGradientColor(colors[1].color, theme, surface);
  const third = softenThemeGradientColor(colors[2].color, theme, surface);
  return [
    `linear-gradient(-5deg, ${third} 10%, transparent 80%)`,
    `radial-gradient(circle at 95% 0%, ${second} 0%, transparent 75%)`,
    `radial-gradient(circle at 0% 0%, ${first} 10%, transparent 70%)`,
    base,
  ].join(', ');
}

function themeRailBackground(theme: SpaceTheme) {
  const colors = normalizeGradientColors(theme);
  if (isNeutralProductTheme(theme)) {
    return 'linear-gradient(180deg, rgb(249 252 250 / 76%), rgb(239 246 242 / 68%)), rgb(243 247 245 / 58%)';
  }
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const primaryColor = primary?.color || theme.accentColor;
  const progress = themeOpacityProgress(theme);
  const railPrimary = softenThemeGradientColor(primaryColor, theme, 'rail');
  const railChrome = mixHexWithColor(primaryColor, '#15181d', theme.mode === 'crisp' ? 0.24 : 0.3);
  const railMist = mixHexWithColor(theme.sidebarBg || primaryColor, '#f2ece3', 0.42);
  const railBase = mixHexWithColor(railMist, railChrome, 0.34 + progress * 0.52);
  const railLift = mixHexWithColor(railPrimary, progress < 0.5 ? '#fbf4ed' : '#ffffff', 0.3 - progress * 0.12);
  const glowStrength = Math.round(18 + progress * 20);
  const baseStrength = Math.round(42 + progress * 34);
  if (colors.length <= 1) {
    return [
      `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 8}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 16}%, transparent) 100%)`,
      `color-mix(in srgb, ${railPrimary} ${24 + Math.round(progress * 24)}%, transparent)`,
    ].join(', ');
  }
  if (colors.length === 2) {
    const secondary = mixHexWithColor(softenThemeGradientColor(colors[1].color, theme, 'rail'), railBase, 0.34 + progress * 0.2);
    return [
      `radial-gradient(circle at 88% 4%, color-mix(in srgb, ${secondary} ${glowStrength + 4}%, transparent) 0%, transparent 62%)`,
      `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 6}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 16}%, transparent) 100%)`,
      `color-mix(in srgb, ${railBase} ${baseStrength}%, transparent)`,
    ].join(', ');
  }
  const secondaryA = mixHexWithColor(softenThemeGradientColor(colors[1].color, theme, 'rail'), railBase, 0.38 + progress * 0.18);
  const secondaryB = mixHexWithColor(softenThemeGradientColor(colors[2].color, theme, 'rail'), railBase, 0.42 + progress * 0.16);
  return [
    `radial-gradient(circle at 86% 0%, color-mix(in srgb, ${secondaryA} ${glowStrength + 4}%, transparent) 0%, transparent 58%)`,
    `radial-gradient(circle at 4% 92%, color-mix(in srgb, ${secondaryB} ${glowStrength}%, transparent) 0%, transparent 56%)`,
    `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 6}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 14}%, transparent) 100%)`,
    `color-mix(in srgb, ${railBase} ${baseStrength}%, transparent)`,
  ].join(', ');
}

function isNeutralProductTheme(theme: Partial<SpaceTheme>) {
  const colors = normalizeGradientColors(theme);
  return colors.length === 1
    && String(colors[0]?.color || '').toLowerCase() === '#dce8e3'
    && String(theme.sidebarBg || '').toLowerCase() === '#f3f7f5';
}

function themeGradientBase(theme: SpaceTheme, surface: 'picker' | 'stage' | 'shell') {
  const colors = normalizeGradientColors(theme);
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const anchor = primary?.color || theme.accentColor;
  const progress = themeOpacityProgress(theme);
  const warmBase = surface === 'stage' ? '#f7f2ee' : surface === 'shell' ? '#f4efe7' : '#f1ebe2';
  const tintSource = mixHexWithColor(anchor, theme.sidebarBg || anchor, surface === 'picker' ? 0.24 : 0.34);
  const lowTint = surface === 'picker' ? 0.18 : surface === 'shell' ? 0.14 : 0.1;
  const highTint = surface === 'picker' ? 0.74 : surface === 'shell' ? 0.66 : 0.5;
  const tintRatio = lowTint + progress * (highTint - lowTint);
  const colorBase = mixHexWithColor(warmBase, tintSource, tintRatio);
  const percent = Math.round((surface === 'picker' ? 72 : surface === 'shell' ? 82 : 60) + progress * (surface === 'stage' ? 12 : 8));
  return `color-mix(in srgb, ${colorBase} ${percent}%, ${warmBase})`;
}

function softenThemeGradientColor(color: string, theme: SpaceTheme, surface: 'picker' | 'stage' | 'rail' | 'shell') {
  const opacityProgress = themeOpacityProgress(theme);
  const isCrisp = theme.mode === 'crisp';
  const strength = surface === 'rail'
    ? 0.34 + opacityProgress * 0.48 + (isCrisp ? 0.06 : 0)
    : surface === 'stage'
      ? 0.18 + opacityProgress * 0.5 + (isCrisp ? 0.06 : 0)
      : surface === 'shell'
        ? 0.24 + opacityProgress * 0.54 + (isCrisp ? 0.06 : 0)
        : 0.38 + opacityProgress * 0.5 + (isCrisp ? 0.08 : 0);
  const base = surface === 'rail'
    ? mixHexWithColor(theme.sidebarBg || color, opacityProgress > 0.55 ? '#16191f' : '#f1e9df', 0.5 - opacityProgress * 0.18)
    : mixHexWithColor(theme.sidebarBg || color, surface === 'stage' ? '#f8f2ee' : '#f5eee6', surface === 'picker' ? 0.62 : 0.72);
  return mixHexWithColor(color, base, 1 - clampNumber(strength, 0.12, 0.9));
}

function themeOpacityProgress(theme: Pick<SpaceTheme, 'opacity'>) {
  return clampNumber((Number(theme.opacity) - 0.3) / 0.6, 0, 1);
}

function spaceIconKind(space: Space): SpaceIconKind {
  if (space.iconKind === 'dot') return 'dot';
  if (space.id === 'space_default' && space.iconKind === 'emoji' && space.iconValue === '✨') return 'dot';
  return space.iconKind;
}

function SpaceIconGlyph({ space }: { space: Space }) {
  const kind = spaceIconKind(space);
  if (kind === 'dot') return <span className="space-dot-glyph" />;
  if (kind === 'emoji') return <span>{space.iconValue || '✨'}</span>;
  return <Folder size={15} />;
}

function colorFromThemePoint(x: number, y: number) {
  const cx = clampNumber(x, 0, 1) - 0.5;
  const cy = clampNumber(y, 0, 1) - 0.5;
  const distance = Math.min(Math.sqrt(cx * cx + cy * cy) / 0.5, 1);
  let angle = Math.atan2(cy, cx) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  const hue = Math.round(angle);
  const saturation = Math.round(48 + distance * 44);
  const lightness = Math.round(76 - distance * 32);
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];
  return `#${[r1, g1, b1].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function mixHexWithWhite(hex: string, whiteRatio: number) {
  return mixHexWithColor(hex, '#ffffff', whiteRatio);
}

function mixHexWithColor(hex: string, targetHex: string, targetRatio: number) {
  const clean = String(hex || '').replace('#', '');
  const target = String(targetHex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean) || !/^[0-9a-fA-F]{6}$/.test(target)) return '#f3f4ff';
  const ratio = clampNumber(targetRatio, 0, 1);
  const rgb = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  const targetRgb = [target.slice(0, 2), target.slice(2, 4), target.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  const mixed = rgb.map((channel, index) => Math.round(channel * (1 - ratio) + targetRgb[index] * ratio));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function textureSurfaceVars(theme: SpaceTheme, surface: 'rail' | 'stage') {
  const colors = normalizeGradientColors(theme);
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const anchor = surface === 'rail' ? mixHexWithColor(primary?.color || theme.accentColor, '#171a1f', theme.mode === 'crisp' ? 0.34 : 0.42) : mixHexWithWhite(primary?.color || theme.accentColor, 0.68);
  const luminance = hexLuminance(anchor);
  const lightBias = clampNumber((luminance - 0.48) / 0.52, 0, 1);
  const darkBias = clampNumber((0.56 - luminance) / 0.56, 0, 1);
  const base = surface === 'rail' ? 0.48 : 0.38;
  return {
    '--texture-grain-opacity': String(base + lightBias * 0.2 + darkBias * 0.16),
    '--texture-grain-contrast': String(1.2 + lightBias * 0.55 + darkBias * 0.36),
    '--texture-haze-opacity': String((surface === 'rail' ? 0.36 : 0.28) + darkBias * 0.14),
  };
}

function hexLuminance(hex: string) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0.7;
  const channels = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function hexToRgb(value: string) {
  const clean = String(value || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '243 244 255';
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function agentColor(agents: Agent[], id: string) {
  if (id === 'user') return '#0f172a';
  return agents.find((agent) => agent.id === id)?.color || '#64748b';
}

function modelForAgent(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = '') {
  const override = overrides[agent.id];
  return resolveModelChoice(override || '', models).model
    || resolveModelChoice(agent.model || '', models).model
    || resolveModelChoice(fallbackModelId || '', models).model
    || models[0]
    || null;
}

function hermesProfileModels(models: ModelProfile[]) {
  return models.filter((model) => model.baseUrl && modelNamesForProvider(model).length);
}

function resolveHermesProfileNameForAgent(agent: Agent | null, profiles: HermesProfile[]) {
  if (!agent) return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
  if (agent.profileName && profiles.some((profile) => profile.name === agent.profileName)) return agent.profileName;
  if (profiles.some((profile) => profile.name === agent.id)) return agent.id;
  const normalizedName = agent.name.trim().toLowerCase();
  const byName = profiles.find((profile) => profile.name.toLowerCase() === normalizedName);
  if (byName) return byName.name;
  return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
}

function modelValueForHermesProfile(profileName: string, profiles: HermesProfile[], models: ModelProfile[]) {
  const profile = profiles.find((item) => item.name === profileName);
  const provider = profile?.provider || '';
  const model = profile?.model || '';
  const exact = hermesProfileModels(models).find((item) => {
    const providerMatch = item.providerKey === provider || item.provider === provider || item.providerKey === provider.replace(/^custom:/, '') || `custom:${item.providerKey}` === provider;
    return providerMatch && modelNamesForProvider(item).includes(model);
  });
  if (exact) return modelChoiceValue(exact, model);
  const sameModel = hermesProfileModels(models).find((item) => modelNamesForProvider(item).includes(model));
  if (sameModel) return modelChoiceValue(sameModel, model);
  return '';
}

function profileModelLabel(profileName: string, profiles: HermesProfile[]) {
  const profile = profiles.find((item) => item.name === profileName);
  if (!profile) return `${profileName} · 未发现 Profile`;
  return `${profile.name} · ${profile.provider || 'provider default'} / ${profile.model || 'provider default'}`;
}

function formatHermesRuntimeError(message: string, profileName = 'default', details?: { command?: string; serverName?: string; missingExecutable?: boolean }) {
  if (/No Codex credentials stored|hermes auth/i.test(message)) {
    return `当前 Hermes Profile「${profileName}」使用 openai-codex，但本机未完成 hermes auth。请在右下角切换到 DeepSeek 等已配置模型，或运行 hermes auth 后重试。`;
  }
  const missingCommand = details?.command
    || message.match(/找不到命令「([^」]+)」/)?.[1]
    || message.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || message.match(/requires\s+([A-Za-z0-9_.-]+), but/i)?.[1]
    || '';
  if (missingCommand) {
    const server = details?.serverName || message.match(/MCP server[「'\s]+([^」'\s]+)[」']?/i)?.[1] || message.match(/MCP server「([^」]+)」/)?.[1] || '';
    return `当前 Hermes Profile「${profileName}」的${server ? ` ${server} ` : ' '}MCP 启动失败：找不到 ${missingCommand}。请安装 Node/npm，或把 MCP command 改成绝对路径。`;
  }
  if (details?.missingExecutable || /FileNotFoundError|No such file or directory|\[Errno 2\]/i.test(message)) {
    const server = details?.serverName ? ` ${details.serverName} ` : ' ';
    return `当前 Hermes Profile「${profileName}」的${server}MCP 启动失败：找不到运行依赖。请检查 Node/npm/npx 或 MCP command 绝对路径。`;
  }
  return message;
}

function modelValueForAgent(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = '') {
  const override = overrides[agent.id];
  if (override && resolveModelChoice(override, models).model) return resolveModelChoice(override, models).value;
  const direct = resolveModelChoice(agent.model || '', models);
  if (direct.model) return direct.value;
  const fallback = resolveModelChoice(fallbackModelId || '', models);
  if (fallback.model) return fallback.value;
  const first = models[0];
  return first ? modelChoiceValue(first, first.model) : '';
}

function agentDefaultModelLabel(agent: Agent, models: ModelProfile[]) {
  const value = modelValueForAgent(agent, models);
  const choice = resolveModelChoice(value, models);
  return choice.modelName || choice.model?.model || agent.model || '未配置模型';
}

function agentSessionModelLabel(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = '') {
  const override = overrides[agent.id];
  if (override) {
    const resolved = resolveModelChoice(override, models);
    return resolved.model ? `${resolved.model.name} · ${resolved.modelName || resolved.model.model}` : '已覆盖';
  }
  const resolved = modelForAgent(agent, models, overrides, fallbackModelId);
  const value = modelValueForAgent(agent, models, overrides, fallbackModelId);
  const choice = resolveModelChoice(value, models);
  return choice.model ? `${choice.model.name} · ${choice.modelName || choice.model.model}` : resolved?.name || agent.model || '未配置模型';
}

function buildMentionOptions(agents: Agent[], selectedAgentIds: string[], query: string): MentionOption[] {
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

function isMentionBeforeBoundary(char: string | undefined) {
  return char === undefined || !/[A-Za-z0-9_]/.test(char);
}

function mentionIndex(content: string, mentionName: string) {
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

function resolveRunTarget(message: string, agents: Agent[], fallbackAgent: Agent | null): ChatRunTarget | null {
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

function pruneAgentModelOverrides(overrides: AgentModelOverrides, agents: Agent[], models: ModelProfile[]) {
  const agentIds = new Set(agents.map((agent) => agent.id));
  return Object.fromEntries(Object.entries(overrides).filter(([agentId, modelId]) => agentIds.has(agentId) && Boolean(resolveModelChoice(modelId, models).model)));
}

function moduleEntryName(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? entry : entry.name;
}

function moduleEntryDescription(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? '' : entry.description || '';
}

function moduleEntryCategory(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? '' : entry.category || '';
}

function moduleEntryEnabled(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? true : entry.enabled !== false;
}

function moduleEntryStatus(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return 'installed';
  return entry.status || (entry.enabled === false ? 'disabled' : 'enabled');
}

function moduleEntryStatusLabel(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return '已安装';
  return entry.statusLabel || (entry.enabled === false ? '未启用' : '已启用');
}

function moduleEntrySource(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return '';
  return entry.source || '';
}

function moduleEntryUsage(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? {} : entry.usage || {};
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsDataURL(file);
  });
}

function profileColor(profile: string) {
  const palette = ['#111827', '#0f766e', '#7c3aed', '#b45309', '#2563eb', '#475569', '#be123c', '#0369a1'];
  const total = String(profile || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return palette[total % palette.length];
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value || 0));
}

function formatFullNumber(value: number) {
  return Math.round(value || 0).toLocaleString('en-US');
}

function formatWanNumber(value: number) {
  const next = Number(value || 0);
  if (next >= 10_000) return `${(next / 10_000).toFixed(next >= 1_000_000 ? 2 : 1)} 万`;
  if (next >= 1_000) return `${(next / 1_000).toFixed(1)}K`;
  return String(Math.round(next));
}

function formatChineseApproxNumber(value: number) {
  const next = Number(value || 0);
  if (next >= 100_000_000) return `${trimTrailingZero(next / 100_000_000)} 亿`;
  if (next >= 10_000) return `${trimTrailingZero(next / 10_000)} 万`;
  return String(Math.round(next));
}

function trimTrailingZero(value: number) {
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatUsd(value: number) {
  return `$${Number(value || 0).toFixed(value >= 10 ? 2 : 4)}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function ResizeHandle({
  side,
  currentWidth,
  minWidth,
  maxWidth,
  edgeAligned = false,
  disabled,
  onResize,
  onCommit,
}: {
  side: 'left' | 'right';
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  edgeAligned?: boolean;
  disabled?: boolean;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const latestWidthRef = useRef(currentWidth);
  const keyboardWidthRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const effectiveMaxWidth = Math.max(minWidth, maxWidth);

  useEffect(() => () => {
    dragCleanupRef.current?.();
    document.body.classList.remove('resizing-columns');
  }, []);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const startWidth = clampNumber(currentWidth, minWidth, effectiveMaxWidth);
    latestWidthRef.current = startWidth;
    document.body.classList.add('resizing-columns');
    target.classList.add('is-resizing');
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; window listeners still keep the drag stable.
    }
    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = paneWidthFromPointer({ side, startWidth, startX, currentX: moveEvent.clientX, minWidth, maxWidth: effectiveMaxWidth });
      latestWidthRef.current = nextWidth;
      onResize(nextWidth);
    };
    let finished = false;
    const cleanup = () => {
      document.body.classList.remove('resizing-columns');
      target.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already have been released by the operating system.
      }
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      onCommit(latestWidthRef.current);
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    window.addEventListener('blur', finish, { once: true });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const nextWidth = paneWidthFromKey({
      side,
      currentWidth: keyboardWidthRef.current ?? currentWidth,
      key: event.key,
      shiftKey: event.shiftKey,
      minWidth,
      maxWidth: effectiveMaxWidth,
    });
    keyboardWidthRef.current = nextWidth;
    latestWidthRef.current = nextWidth;
    onResize(nextWidth);
  }

  function commitKeyboardWidth() {
    if (keyboardWidthRef.current === null) return;
    const width = keyboardWidthRef.current;
    keyboardWidthRef.current = null;
    onCommit(width);
  }

  return (
    <div
      className={`resize-handle ${side} ${edgeAligned ? 'card-edge' : ''} ${disabled ? 'disabled' : ''}`}
      role="separator"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={effectiveMaxWidth}
      aria-valuenow={clampNumber(currentWidth, minWidth, effectiveMaxWidth)}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={startDrag}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') commitKeyboardWidth();
      }}
      onBlur={commitKeyboardWidth}
    />
  );
}

function RichContentQaPage() {
  const params = new URLSearchParams(window.location.search);
  const qaRoot = params.get('qaRoot') || '/tmp/frakio-rich-content-qa';
  const file = (name: string) => `${qaRoot.replace(/\/$/, '')}/${name}`;
  const content = [
    '# Frakio 富内容验收',
    '',
    '- **今天（7/26）**是 CJK 相邻粗体测试',
    '- [x] GFM 任务列表 ~~删除线~~',
    '',
    '| 中文列 | 很长的英文列 | 状态 |',
    '| --- | --- | --- |',
    '| 金沙洲 | SupercalifragilisticexpialidociousWithoutBreak | 正常 |',
    '',
    '```typescript',
    'const greeting: string = "Frakio Work rich content";',
    '```',
    '',
    '```diff',
    '--- a/example.ts',
    '+++ b/example.ts',
    '@@ -1 +1 @@',
    '-const ready = false;',
    '+const ready = true;',
    '```',
    '',
    '```json',
    '{"workspace":{"name":"Frakio","features":["markdown","mermaid"]}}',
    '```',
    '',
    '```mermaid',
    'graph LR',
    '  A["用户提出任务"] --> B["Frakio 路由"] --> C["Agent 执行"] --> D["富内容结果"]',
    '```',
    '',
    '$$E = mc^2$$',
    '',
    '```datatable',
    JSON.stringify({ title: 'Craft 协议数据表', columns: [{ key: 'city', label: '城市', type: 'text' }, { key: 'revenue', label: '营收', type: 'currency' }, { key: 'growth', label: '增长', type: 'percent' }, { key: 'tier', label: '等级', type: 'badge' }], rows: [{ city: '佛山', revenue: 4200, growth: 0.152, tier: 'A' }, { city: '广州', revenue: 3600, growth: -0.03, tier: 'B' }] }, null, 2),
    '```',
    '',
    '```spreadsheet',
    JSON.stringify({ filename: 'qa.xlsx', sheetName: 'Sheet 1', columns: [{ key: 'month', label: '月份', type: 'text' }, { key: 'value', label: '数值', type: 'number' }], rows: [{ month: '7月', value: 1280 }, { month: '8月', value: 1530 }] }, null, 2),
    '```',
    '',
    '```html-preview',
    JSON.stringify({ title: 'HTML 标签', items: [{ src: file('one.html'), label: '报告一' }, { src: file('two.html'), label: '报告二' }] }, null, 2),
    '```',
    '',
    '```image-preview',
    JSON.stringify({ title: '图片标签', items: [{ src: file('one.svg'), label: '图片一' }, { src: file('two.svg'), label: '图片二' }] }, null, 2),
    '```',
    '',
    '```pdf-preview',
    JSON.stringify({ src: file('sample.pdf'), title: 'PDF 阅读器' }, null, 2),
    '```',
    '',
    '```markdown-preview',
    JSON.stringify({ title: 'Markdown 标签', items: [{ src: file('one.md'), label: '文档一' }, { src: file('two.md'), label: '文档二' }] }, null, 2),
    '```',
  ].join('\n');
  return <main className="app desktop-shell mac-desktop-shell mac-conversation-shell rich-qa-shell" data-appearance="light"><article className="rich-qa-page"><RichMarkdown content={content} threadId="rich-content-qa" /></article></main>;
}

function StreamRevealQaPage() {
  const params = new URLSearchParams(window.location.search);
  const streamingResponses = params.get('streaming') !== 'off';
  const appearance = params.get('appearance') === 'dark' ? 'dark' : 'light';
  const startDelay = Math.max(0, Math.min(2_000, Number(params.get('startDelay') || 120) || 120));
  const handoffDelay = Math.max(0, Math.min(2_000, Number(params.get('handoffDelay') || 150) || 150));
  const [draft, setDraft] = useState('');
  const [groups, setGroups] = useState<RunActivityGroup[]>([]);
  const [phase, setPhase] = useState<RunPresentationPhase>('thinking');
  const [running, setRunning] = useState(true);
  const [persisted, setPersisted] = useState('');
  const finalContent = '先确认当前状态。工具调用完成后，继续补充 Markdown **结论**，以及一段突发到达但仍需柔和呈现的正文。';
  const agent = useMemo<Agent>(() => ({
    id: 'iris',
    name: 'Iris',
    role: '助理',
    model: 'qa',
    color: '#0f766e',
    soul: '',
    scope: 'qa',
  }), []);

  useEffect(() => {
    setDraft('');
    setGroups([]);
    setPhase('thinking');
    setRunning(true);
    setPersisted('');
    const timers = [
      window.setTimeout(() => { setDraft('先'); setPhase('responding'); }, startDelay),
      window.setTimeout(() => setDraft('先确认当前状态。'), startDelay + 52),
      window.setTimeout(() => {
        const now = new Date().toISOString();
        setGroups([{
          id: 'qa-tool',
          contentOffset: '先确认当前状态。'.length,
          status: 'completed',
          summary: '读取了当前状态',
          items: [{
            id: 'qa-tool-item',
            kind: 'read',
            status: 'completed',
            toolName: 'qa_read',
            displayName: '读取当前状态',
            intent: '确认工具摘要与正文保持时间线顺序。',
            activeLabel: '正在读取',
            completedLabel: '读取完成',
            target: '/tmp/qa',
            durationMs: 42,
            resultPreview: 'ok',
            createdAt: now,
            updatedAt: now,
          }],
          createdAt: now,
          updatedAt: now,
        }]);
        setPhase('activity');
      }, startDelay + 102),
      window.setTimeout(() => { setDraft('先确认当前状态。工具调用完成后，继续补充'); setPhase('responding'); }, startDelay + 156),
      window.setTimeout(() => setDraft(finalContent), startDelay + 194),
      window.setTimeout(() => setPhase('finished'), startDelay + 256),
      window.setTimeout(() => {
        setPersisted(finalContent);
        setDraft('');
        setRunning(false);
      }, startDelay + 256 + handoffDelay),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [finalContent, handoffDelay, startDelay]);

  return (
    <main className="app desktop-shell mac-desktop-shell mac-conversation-shell rich-qa-shell" data-appearance={appearance}>
      <section className="rich-qa-page" data-testid="stream-output">
        {persisted ? (
          <article className="message" data-testid="persisted-message">
            <span className="agent-avatar" style={{ background: agent.color }}>I</span>
            <div className="message-body"><div className="message-meta"><strong>Iris</strong></div><MarkdownMessage content={persisted} /></div>
          </article>
        ) : running ? (
          <div data-testid="run-status">
            <ChatRunStatus
              target={{ kind: 'agent', agent }}
              startedAt={Date.now()}
              tick={0}
              draft={draft}
              activityGroups={groups}
              presentationPhase={phase}
              error=""
              streamingResponses={streamingResponses}
            />
          </div>
        ) : null}
        <textarea aria-label="QA 输入框" defaultValue="" />
      </section>
    </main>
  );
}

function ManagedWebAuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'change-password'>('loading');
  const [password, setPassword] = useState('');
  const [defaultPasswordHint, setDefaultPasswordHint] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/status')
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取 Web 服务登录状态。');
        const status = await response.json();
        if (cancelled) return;
        setDefaultPasswordHint(status.defaultPasswordHint || '');
        setState(status.managed && !status.authenticated ? 'login' : status.passwordChangeRequired ? 'change-password' : 'ready');
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setState('login');
        }
      });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '登录失败。');
      setPassword('');
      setDefaultPasswordHint('');
      setState(result.passwordChangeRequired ? 'change-password' : 'ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'ready') return <>{children}</>;
  if (state === 'loading') return <main className="managed-web-auth-shell" aria-label="正在连接 Frakio Work" />;
  if (state === 'change-password') return <FirstManagedPasswordChange onComplete={() => setState('ready')} />;
  return (
    <main className="managed-web-auth-shell">
      <form className="managed-web-auth-card" onSubmit={submit}>
        <img src={frakioBrandLogoUrl} alt="" />
        <div>
          <h1>Frakio Work</h1>
          <p>输入这台工作台的管理员密码。</p>
        </div>
        <label>
          <span>管理员密码</span>
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {defaultPasswordHint && <small className="managed-web-default-password">首次登录密码：<strong>{defaultPasswordHint}</strong>。登录后需要立即修改。</small>}
        {error ? <p className="managed-web-auth-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={!password || submitting}>{submitting ? '正在登录…' : '进入工作台'}</button>
        <small>仅限可信局域网使用。不要把此 HTTP 地址直接暴露到公网。</small>
      </form>
    </main>
  );
}

function FirstManagedPasswordChange({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 10) return setError('新密码至少需要 10 个字符。');
    if (password !== confirmation) return setError('两次输入的新密码不一致。');
    setSaving(true);
    try {
      await fetch('/api/session');
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Frakio-Request': '1' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '密码修改失败。');
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }
  return <main className="managed-web-auth-shell">
    <form className="managed-web-auth-card" onSubmit={submit}>
      <img src={frakioBrandLogoUrl} alt="" />
      <div><h1>设置管理员密码</h1><p>首次登录需要设置新的管理员密码。</p></div>
      <label><span>新密码</span><input autoFocus type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label><span>确认新密码</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {error ? <p className="managed-web-auth-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={!password || !confirmation || saving}>{saving ? '正在保存…' : '保存并进入工作台'}</button>
    </form>
  </main>;
}

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
