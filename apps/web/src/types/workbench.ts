// wjz新建文件，新建原因：解耦 main.tsx 中的前端核心类型定义，修改时间：2026-08-17。
// 文件内容概述：Workbench 前端全量 UI 类型契约、主题、会话、Agent、Run 状态与辅助类型。
// wjz新建文件结束。

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
  CollaborationTask as ContractCollaborationTask,
  CollaborationRunStatus as ContractCollaborationRunStatus,
} from '@frakio/contracts';
export type {
  PlanDraft,
  PlanQuestionBatch,
  PlanSession,
  ContractCollaborationTask,
  ContractCollaborationRunStatus,
  ConversationOverview,
  MessageContext,
  RunChangeSet,
  BrowserAnnotation,
  ReviewComment,
  RunPresentationPhase,
};
import type { LaunchPhase } from '../features/launch/LaunchLoadingScreen';

import type { RunPresentationPhase } from '../run-presence.mjs';

export type StreamRevealFrame = {
  rawContent: string;
  displayedContent: string;
  appendedGraphemes: number;
  revision: number;
  settled: boolean;
};

export type BrowserAnnotationMode = 'none' | 'element' | 'region';

export type BrowserViewState = {
  url: string;
  title?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  visible: boolean;
  annotationMode: BrowserAnnotationMode;
  error?: string;
};

export type RightRailTab = 'collaboration' | 'sources' | 'browser' | 'files' | 'review';

export type ProfileModuleUsage = { useCount?: number; viewCount?: number; patchCount?: number; state?: string; lastUsedAt?: string | null };
export type ProfileModuleEntry = string | { name: string; file?: string; description?: string; category?: string; enabled?: boolean; status?: string; statusLabel?: string; source?: string; usage?: ProfileModuleUsage };
export type ManagedHermesModuleKind = 'skill' | 'plugin';
export type ManagedHermesModule = {
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

export type ManagedHermesModulesPayload = {
  kind: ManagedHermesModuleKind;
  profiles: Array<{ profileName: string; agentId: string; name: string; role: string; avatarUrl?: string; color?: string; inheritedGlobalCount: number }>;
  global: ManagedHermesModule[];
  profile: ManagedHermesModule[];
};

export type RuntimeId = 'hermes' | 'pi' | 'codex' | 'claude' | string;
export type HarnessId = 'native' | 'hermes' | 'codex' | 'claude';
export type AgentRuntimePolicy = { defaultRuntimeId: RuntimeId; allowedRuntimeIds: RuntimeId[]; permissionProfileId: string; defaultHarnessId?: HarnessId };

export type RuntimeModelCompatibility = {
  status: 'ready' | 'partial' | 'unsupported' | 'missing_credentials';
  credentialStatus: 'ready' | 'missing' | 'not_required';
  compatibility?: 'direct' | 'bridged' | 'unsupported';
  bridgeId?: string;
  harnessApiMode?: string;
  upstreamApiMode?: string;
  capabilities?: Record<string, 'native' | 'bridge' | 'auxiliary' | 'unsupported'>;
  degradations?: string[];
  usableModelIds: string[];
  unsupportedModelIds: string[];
  reason: string;
};

export type RuntimeModelCatalogEntry = {
  id: string;
  name: string;
  provider?: string;
  defaultModelId?: string;
  models: string[];
  compatibility: RuntimeModelCompatibility;
  modelCompatibilities?: Record<string, RuntimeModelCompatibility>;
};

export type RuntimeModelCatalog = { runtimeId: string; source: string; models: RuntimeModelCatalogEntry[]; usableModelCount?: number };

export type RuntimeDefinition = {
  id: RuntimeId;
  name: string;
  kind: 'core' | 'channel';
  bundled: boolean;
  enabled: boolean;
  capabilities: Record<string, boolean>;
  capabilitySnapshot?: {
    capabilities: Record<string, 'supported' | 'partial' | 'unsupported' | 'unknown'>;
    source: string;
    runtimeVersion: string;
    runtimeBuildId?: string;
    runtimeSource?: string;
    checkedAt: string;
    expiresAt: string;
  } | null;
  verificationState?: 'verified' | 'unverified';
  installation?: { status: string; installed: boolean; version: string; command?: string; authMode?: string; detail?: string; checkedAt: string };
};

export type MemoryLedgerEntry = {
  id: string;
  scope: 'user' | 'agent' | 'vault' | 'thread' | 'workspace';
  subjectId: string;
  kind?: 'personal_fact' | 'preference' | 'agent_experience' | 'project_fact' | 'project_decision' | 'project_rule' | 'fact';
  origin?: string;
  sourceAgentId?: string;
  threadId?: string;
  vaultId?: string;
  fact: string;
  reason?: string;
  statusReason?: string;
  confidence: number;
  status: 'candidate' | 'accepted' | 'paused' | 'superseded' | 'rejected' | 'forgotten';
  provenance: Array<{ source?: string; runtimeId?: string; runId?: string; messageId?: string; quote?: string; createdAt?: string }>;
  validFrom?: string | null;
  validUntil?: string | null;
  pausedAt?: string | null;
  sourceRuntimeId?: string;
  sourceSessionId?: string;
  sourceMessageId?: string;
  recallCount?: number;
  lastRecalledAt?: string | null;
  deletedAt?: string | null;
  deletionReason?: string;
  sync?: { vaultId?: string; relativePath?: string; blockHash?: string; state?: string; syncedAt?: string | null };
  createdAt: string;
  updatedAt: string;
};

export type MemoryReviewConfig = { enabled: boolean; provider: string; model: string; timeout: number; extraBody?: Record<string, unknown> };

export type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  color: string;
  soul: string;
  scope: string;
  defaultReasoningEffort?: string;
  defaultSpeedMode?: string;
  profileName?: string;
  gatewayStatus?: string;
  source?: string;
  soulExcerpt?: string;
  userProfileExcerpt?: string;
  memoryExcerpt?: string;
  userProfile?: string;
  memory?: string;
  notes?: string;
  communicationStyle?: string;
  providerSummary?: HermesProviderSummary[];
  skills?: ProfileModuleEntry[];
  plugins?: ProfileModuleEntry[];
  avatarUrl?: string;
  runtimePolicy?: AgentRuntimePolicy;
  profileRevision?: string;
  ownership?: { identity: 'frakio'; memory: 'frakio'; runtimeProfile: 'hermes' | 'none' };
  projection?: { status: string; generatedAt?: string; error?: string } | null;
};

export type ModelKind = 'official' | 'relay' | 'local';
export type ModelProtocol = 'OpenAI Compatible' | 'Anthropic Compatible' | 'Custom';
export type ProviderApiMode = 'chat_completions' | 'openai_responses' | 'codex_responses' | 'anthropic_messages' | 'bedrock_converse' | 'codex_app_server' | '';
export type ProviderApiModePreference = 'auto' | 'chat_completions' | 'openai_responses' | 'anthropic_messages';
export type ProviderAuthType = 'codex-device' | 'claude-pkce' | 'gemini-loopback';

export type DesktopUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
export type DesktopUpdateState = {
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

export type ModelPricing = { input: number | null; output: number | null; cacheRead: number | null; cacheCreation: number | null };
export type FastMode = 'none' | 'openai_priority' | 'anthropic_fast';
export type ServiceTier = { id: string; name: string; description?: string; requestValue: string; billingNotice?: string };
export type ModelCompat = { thinkingFormat: string; requestOverrides: Record<string, unknown> };

export type ModelCapabilityOverride = {
  reasoning: boolean;
  reasoningEfforts: string[];
  reasoningMap?: Record<string, string | null>;
  defaultReasoning?: string;
  serviceTiers?: ServiceTier[];
  apiMode?: ProviderApiMode;
  thinkingFormat?: string;
  requestOverrides?: Record<string, unknown>;
  fastMode: FastMode;
  status?: 'confirmed' | 'unsupported' | 'unknown';
};

export type ModelCapability = {
  modelId?: string;
  reasoning: boolean;
  reasoningType: 'none' | 'binary' | 'levels';
  reasoningEfforts: string[];
  reasoningMap: Record<string, string | null>;
  defaultReasoning?: string;
  serviceTiers: ServiceTier[];
  speedModes: string[];
  fastMode: FastMode;
  source: string;
  confidence: 'confirmed' | 'inferred' | 'unknown';
  status: 'confirmed' | 'unsupported' | 'unknown' | 'verification_failed';
  reasoningStatus?: 'confirmed' | 'unsupported' | 'unknown' | 'verification_failed';
  serviceTierStatus?: 'confirmed' | 'unsupported' | 'unknown' | 'verification_failed';
  apiMode?: ProviderApiMode;
  thinkingFormat?: string;
  requestOverrides?: Record<string, unknown>;
  updatedAt?: string | null;
  verificationError?: string;
};

export type CapabilityProbeResult = { kind: 'connection' | 'reasoning' | 'service_tier'; option: string; mappedValue: string; status: 'accepted' | 'unsupported' | 'unknown'; error?: string };
export type CatalogInfo = { source: string; rich: boolean; modelIds?: string[]; url?: string; lastRefreshAt?: string | null; lastSuccessAt?: string | null; refreshError?: string; stale?: boolean };

export type ModelPayload = {
  name: string;
  provider: string;
  kind: ModelKind;
  protocol: ModelProtocol;
  model: string;
  models: string[];
  baseUrl: string;
  apiKey: string;
  pricing: ModelPricing;
  providerKey?: string;
  oauthAccountId?: string;
  apiMode?: ProviderApiMode;
  apiModePreference?: ProviderApiModePreference;
  modelsUrl?: string;
  modelApiModes?: Record<string, ProviderApiMode>;
  compat?: ModelCompat;
  modelCompat?: Record<string, ModelCompat>;
  contextLimit?: number | null;
  capabilityMode: 'auto' | 'manual';
  capabilityOverrides: Record<string, ModelCapabilityOverride>;
  runtimeRevision?: string;
};

export type ModelProfile = Omit<ModelPayload, 'apiKey'> & {
  id: string;
  hasApiKey: boolean;
  oauthAccountBindingRequired?: boolean;
  source?: 'demo' | 'hermes-studio' | 'hermes-profile' | 'manual';
  profileName?: string;
  providerKey?: string;
  apiMode?: ProviderApiMode;
  apiModePreference?: ProviderApiModePreference;
  contextLimit?: number | null;
  runtimeRevision?: string;
};

export type ModelFetchResult = { models: string[]; capabilities: Record<string, ModelCapability>; catalog?: CatalogInfo };
export type ModelFetchContext = Partial<ModelPayload> & { modelId?: string };
export type FetchAvailableModels = (baseUrl: string, apiKey: string, context?: ModelFetchContext) => Promise<ModelFetchResult>;
export type SaveModel = (payload: ModelPayload, modelId?: string, persistedModels?: ModelProfile[]) => Promise<boolean>;

export type ProviderPreset = { label: string; value: string; baseUrl: string; models: string[]; builtin: boolean; apiMode?: ProviderApiMode; authType?: ProviderAuthType; authenticated?: boolean; catalog?: CatalogInfo };
export type OAuthAccount = { id: string; providerKey: string; label: string; identity: string; email?: string; expiresAt?: number; updatedAt?: string; models?: Array<{ id: string; name: string }> };
export type OAuthProviderState = 'unauthenticated' | 'authorizing' | 'authorized_loading_catalog' | 'ready' | 'catalog_error';

export type AuxiliaryModelTask = { key: string; label: string; default_timeout?: number; default_download_timeout?: number };
export type AuxiliaryModelSettings = { provider?: string; model?: string; base_url?: string; timeout?: number; download_timeout?: number; extra_body?: Record<string, any> };
export type AuxiliaryModelsConfig = Record<string, AuxiliaryModelSettings>;

export type VaultDoc = { relativePath: string; name: string; category: string; excerpt?: string };
export type Vault = {
  id: string;
  name: string;
  path: string;
  status: string;
  documentCount: number;
  productCount: number;
  lastIndexedAt: string | null;
  needsRefresh: boolean;
  kind: 'personal' | 'project';
  manifestPath?: string;
  trustedRulePaths?: string[];
  indexVersion?: number;
  obsidianAvailable?: boolean;
  legacyWorkspaceBinding?: boolean;
  legacyBindingResolved?: boolean;
  managementMode?: 'managed' | 'read_only';
  autonomy?: 'fully_autonomous' | 'tiered' | 'all_review';
  onboardingStatus?: string;
  avatarUrl?: string;
};

export type KnowledgeOperation = { id: string; status: string; summary: string; kind: string; risk: string; requiresReview: boolean; files: Array<{ relativePath: string; action: string; beforeContent?: string | null; afterContent?: string | null }>; createdAt: string; publishedAt?: string | null; rolledBackAt?: string | null };
export type KnowledgeSource = { id: string; title: string; kind: string; origin: string; relativePath: string; status: string; createdAt: string; acceptedAt?: string | null };
export type KnowledgeIssue = { id: string; code: string; severity: 'error' | 'warning' | 'info'; relativePath: string; message: string };
export type KnowledgeJob = { id: string; kind: string; status: string; attempts: number; error: string; createdAt: string; updatedAt: string };
export type CuratorInfo = { actorId: 'frakio-knowledge-curator'; displayName: string; avatarUrl: string; runtime: 'hermes'; modelLabel: string; modelSource: 'vault_model' | 'reference_agent' | 'global_curator' | 'default_agent'; referenceAgentId: string; referenceAgentName: string };
export type VaultDetail = { vault: Vault; config: { managementMode: 'managed' | 'read_only'; autonomy: 'fully_autonomous' | 'tiered' | 'all_review'; onboardingStatus: string; trustedRulePaths: string[]; maintenanceRulePaths: string[]; immutableRoots: string[]; curatorPresentation: { displayName: string; avatarAssetPath: string }; curatorExecution: { mode: 'auto' | 'explicit_model' | 'follow_agent'; provider: string; model: string; timeout: number; source: string }; curatorReferenceAgentId: string }; curator?: CuratorInfo; stats: { documents: number; sources: number; pending: number; issues: number }; recentOperations: KnowledgeOperation[]; recentJobs: KnowledgeJob[]; sources: KnowledgeSource[]; issues: KnowledgeIssue[] };

export type VaultSummary = {
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

export type WorkMessageArtifact = { id: string; name: string; kind?: string; path: string; relativePath?: string; size?: number };

export type ChatEvent = {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatarUrl?: string;
  agentProfileRevision?: string;
  role: string;
  content: string;
  attachments?: Attachment[];
  context?: MessageContext;
  changeSetId?: string;
  changeSummary?: { fileCount: number; additions: number; deletions: number };
  workArtifacts?: WorkMessageArtifact[];
  workFinalWorkflowId?: string;
  memoryIds?: string[];
  handoffs?: Array<{ routeId: string; targetAgentId: string; targetAgentName: string; reason?: string; objective?: string; handoffReason?: string; status: 'pending' | 'starting' | 'running' | 'completed' | 'failed' | 'recorded'; error?: string }>;
  handoff?: { sourceAgentId?: string; sourceAgentName?: string; targetAgentId?: string; objective?: string; handoffReason?: string; reason?: string; sourceMessageId?: string };
  reasoning?: string;
  externalRunId?: string;
  turnId?: string;
  mentionDepth?: number;
  parentMessageId?: string;
  routeReason?: string;
  runtimeId?: string;
  runtimeName?: string;
  modelId?: string;
  profileRevision?: string;
  resumeStrategy?: 'native_resumed' | 'handoff_resumed' | 'new_session' | 'unsupported' | 'failed' | '';
  permissionCoverage?: 'host_enforced' | 'native_enforced' | 'partial' | 'unobservable' | '';
  appliedSkillCount?: number;
  contentType?: 'plan' | 'plan_feedback' | 'collaboration_suggestion' | 'collaboration_plan_intro' | 'collaboration_plan_response' | 'workflow_final_delivery' | string;
  collaborationSuggestion?: { title: string; reason: string; sourceAgentId?: string };
  planId?: string;
  planIntroForId?: string;
  planRevision?: number;
  processingDurationMs?: number;
  feedback?: 'up' | 'down' | null;
  createdAt?: string;
};

export type RuntimeSessionSummary = { id: string; runtimeId: RuntimeId; agentId?: string; laneType: 'chat' | 'work_task'; laneId: string; lifecycleState: 'opening' | 'active' | 'parked' | 'restoring' | 'recovering' | 'stale' | 'closed' | 'failed'; nativeSessionId?: string; resumeStrategy?: string; lastError?: string };
export type AttachmentDraft = { localId: string; file: File; previewUrl: string; status: 'uploading' | 'ready' | 'error'; attachment?: Attachment; error?: string };

export type MentionOption = { key: string; type: 'all' | 'agent'; name: string; label: string; description: string; agent?: Agent };
export type ChatRunTarget = { kind: 'agent'; agent: Agent } | { kind: 'all'; agent: Agent | null };
export type Proposal = { id: string; type: string; title: string; risk: 'low' | 'medium' | 'high'; target: string; status: string };
export type WorkArtifact = { id?: string; name: string; kind: string; target?: string; relativePath?: string; path?: string; updatedAt?: string; size?: number };
export type WorkspaceFileEntry = { name: string; relativePath: string; kind: 'file' | 'directory'; size?: number; updatedAt?: string; previewable?: boolean };
export type WorkspaceFileContent = { name: string; relativePath: string; mimeKind: 'markdown' | 'text' | 'json' | 'code' | 'pdf' | 'image' | 'binary'; content?: string; size: number; updatedAt?: string; truncated: boolean };
export type WorkflowStep = { title: string; status: 'pending' | 'running' | 'completed' | 'failed'; source?: 'run' | 'tool' | 'approval' | 'clarify' | 'simulation'; agentName?: string; detail?: string; updatedAt?: string; callId?: string };
export type FollowMode = 'default' | 'conversation';

export type CollaborationPlanTask = { key: string; taskId?: string; title: string; description?: string; assigneeAgentId: string; expectedResult?: string; dependsOnKeys: string[]; cancelled?: boolean };
export type CollaborationPlan = { revision: number; goal?: string; summary?: string; tasks: CollaborationPlanTask[]; publishedAt?: string };
export type CollaborationWorkflowControl = { operationId: string; idempotencyKey: string; action: 'pause' | 'resume' | 'cancel' | ''; state: 'idle' | 'pausing' | 'paused' | 'resuming' | 'cancelling' | 'cancelled' | 'pause_failed'; affectedTaskIds: string[]; stoppedRuns: number; pendingRunIds?: string[]; deferredRunIds?: string[]; blockedTasks: number; preservedWaitingTasks: number; failedTaskIds: string[]; heldInterventionCount: number; startedAt: string | null; completedAt: string | null; error: string };

export type CollaborationWorkflow = {
  id: string;
  name: string;
  boardSlug: string;
  nativeOnly?: boolean;
  status: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'archived';
  coordinatorAgentId: string;
  fallbackDecisionAgentId: string;
  rootTaskIds: string[];
  currentRootTaskId?: string;
  approvedPlanId?: string;
  approvedPlanRevision?: number;
  planRevision?: number;
  plan?: CollaborationPlan | null;
  interventionQueue?: Array<{ id: string; status: string }>;
  control?: CollaborationWorkflowControl;
  capability?: { status: string; protocolVersion?: number; error?: string };
  finalization?: { state: 'idle' | 'requested' | 'running' | 'delivered' | 'failed'; requestedAt?: string | null; startedAt?: string | null; deliveredAt?: string | null; failedAt?: string | null; deliveryMessageId?: string; runId?: string; error?: string };
  finalDelivery?: { status: 'pending' | 'ready' | 'failed'; summary: string; content: string; coordinatorAgentId: string; sourceTaskIds: string[]; runId: string; messageId?: string; createdAt?: string | null; error?: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  pausedAt?: string | null;
  cancelledAt?: string | null;
  archivedAt?: string | null;
};

export type CollaborationEvent = { id: string; cursor: number; type: string; workflowId: string; taskId?: string; actorAgentId?: string; title: string; detail?: string; payload?: Record<string, any>; createdAt: string };
export type CollaborationWorkflowSnapshot = CollaborationWorkflow & { tasks: CollaborationTask[]; error?: string };
export type CollaborationProposal = { id: string; workflowId?: string | null; sourcePlanId?: string | null; proposalMessageId?: string | null; revision: number; status: 'draft' | 'pending_confirmation' | 'confirmed' | 'cancelled' | 'failed'; title: string; summary: string; content: PlanDraft | Record<string, any>; createdAt?: string; updatedAt?: string };
export type CollaborationSnapshot = { threadId: string; mode?: 'chat' | 'work'; workerOutputMode?: 'summary' | 'all'; activeWorkflowId: string; cursor: number; workflows: CollaborationWorkflowSnapshot[]; proposals?: CollaborationProposal[]; events: CollaborationEvent[]; fallbackDecisionAgentId: string };

export type CollaborationTaskDetail = {
  task: CollaborationTask & { description?: string; assigneeAgentId?: string; runtimeId?: string; metadata?: Record<string, any> };
  parents: string[];
  children: string[];
  comments: Array<{ id: string; body: string; createdAt: string }>;
  runs: Array<Omit<ThreadRunState, 'status'> & { id: string; runtimeId: string; status: CollaborationRunStatus; runtimeStatus?: ThreadRunState['status']; presentation?: RunPresentationSnapshot | null }>;
  runtimeEvents: Array<{ id: string; cursor: number; runId: string; type: string; payload?: Record<string, any>; createdAt: string }>;
  events: CollaborationEvent[];
  artifacts: Array<{ id: string; taskId?: string; path: string; status: string; metadata?: Record<string, any>; publishedAt?: string | null; createdAt: string }>;
  interventions: Array<{ id: string; status: string; message: string; createdAt: string }>;
};

export type InboxItem = { id: string; cursor: number; workspaceId: string; threadId: string; threadTitle?: string; workflowId?: string | null; taskId?: string | null; type: 'workflow_completed' | 'workflow_failed' | 'finalization_failed' | 'approval_required' | 'answer_required'; title: string; summary: string; priority: 'normal' | 'important' | 'urgent'; actionRequired: boolean; readAt?: string | null; resolvedAt?: string | null; createdAt: string; updatedAt: string };
export type ThreadCollaboration = { kind: string; activeAgentId?: string | null; lastMentionedAgentId?: string | null; lastMentionedAgentName?: string; maxMentionDepth?: number | 'unlimited'; lastRoutedAt?: string | null; lastRouteReason?: string; workflows?: CollaborationWorkflow[]; activeWorkflowId?: string; eventCursor?: number; events?: CollaborationEvent[] };

export type ContextPacket = {
  title: string;
  conversation: { userIntent: string; activeAgents: string[]; currentConclusion: string };
  vault: { connected: boolean; documentCount?: number; products?: string[]; activeRules: string[] };
  policy: string;
};

export type ThreadMode = 'workspace' | 'direct';
export type ConversationContext = { personal: { enabled: boolean; mode: 'inherit' | 'on' | 'off'; source: 'thread' | 'workspace' | 'direct'; label: string; vaultId?: string | null; vaultName?: string }; project: { id: string; name: string } | null; label: string };
export type PermissionMode = 'manual' | 'smart' | 'off';
export type AgentModelOverrides = Record<string, string>;
export type AgentRunOverride = { reasoningEffort?: string; speedMode?: string };
export type AgentRunOverrides = Record<string, AgentRunOverride>;
export type AgentRuntimeOverrides = Record<string, RuntimeId>;
export type UserProfile = { avatarUrl: string; nickname: string; bio: string; age: string; hobbies: string; occupation: string; defaultAgentAddress: string; otherAgentAddress: string; completedAt: string; updatedAt: string };

export type Thread = {
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
  personalKnowledgeMode?: 'inherit' | 'on' | 'off';
  context?: ConversationContext;
  selectedAgents: string[];
  agentModelOverrides?: AgentModelOverrides;
  agentRunOverrides?: AgentRunOverrides;
  agentRuntimeOverrides?: AgentRuntimeOverrides;
  agentHarnessBindings?: Record<string, { harnessId: HarnessId; boundAt?: string; bindingRevision?: number; source?: string }>;
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
  draftContext?: MessageContext;
  changeSets?: RunChangeSet[];
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

export type ThreadSummary = {
  id: string;
  spaceId?: string | null;
  workspaceId: string | null;
  workspaceRootPath?: string;
  title: string;
  mode: ThreadMode;
  executionMode?: 'chat' | 'work';
  collaborationMode?: CollaborationMode;
  activePlanId?: string;
  workerOutputMode?: 'summary' | 'all';
  primaryAgentId: string | null;
  primaryAgentName?: string;
  defaultAgentId?: string | null;
  activeAgentId?: string | null;
  participantAgentIds: string[];
  followMode?: FollowMode;
  permissionMode?: PermissionMode;
  agentModelOverrides?: AgentModelOverrides;
  agentRunOverrides?: AgentRunOverrides;
  agentRuntimeOverrides?: AgentRuntimeOverrides;
  agentHarnessBindings?: Record<string, { harnessId: HarnessId }>;
  runtimeId?: RuntimeId;
  vaultId: string | null;
  vaultName: string;
  personalKnowledgeMode?: 'inherit' | 'on' | 'off';
  context?: ConversationContext;
  updatedAt: string;
  preview: string;
  engine?: 'simulate' | 'hermes-studio' | 'model-provider' | 'workspace-group' | 'hermes-agent';
  artifactCount?: number;
  lastArtifactName?: string;
  runStatus?: 'idle' | 'running' | 'failed';
  archivedAt?: string | null;
  pinnedAt?: string | null;
  forkedFromThreadId?: string | null;
  forkedFromMessageId?: string | null;
  branchRootThreadId?: string | null;
};

export type ActiveHermesRun = { runId: string; hostRunId?: string; sessionId: string; threadId: string; turnId?: string };
export type ThreadRunState = {
  runId: string;
  nativeRunId?: string;
  sessionId: string;
  turnId: string;
  agentId?: string;
  runtimeId?: string;
  status: 'queued' | 'running' | 'interrupting' | 'completed' | 'failed' | 'cancelled';
  phase?: 'opening' | 'model' | 'tool' | 'approval' | 'compaction';
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string;
};

export type HermesApprovalChoice = 'once' | 'session' | 'always' | 'deny';
export type HermesRunApproval = {
  id?: string;
  title: string;
  command: string;
  cwd?: string;
  tool?: string;
  choices?: HermesApprovalChoice[];
  allowPermanent?: boolean;
  smartDenied?: boolean;
};

export type HermesRunClarification = { id: string; question: string; choices: string[]; timeoutMs?: number };

export type RunUiState = {
  isRunning: boolean;
  startPending: boolean;
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
  errorCode: string;
  stopping: boolean;
  changeSet: RunChangeSet | null;
  compaction: { operationId: string; status: 'running' | 'completed' | 'failed'; tokensBefore?: number; tokensAfterEstimate?: number; error?: string; originalContextPreserved?: boolean } | null;
  compactionRecords: Array<{ operationId: string; status: 'running' | 'completed' | 'failed'; tokensBefore?: number; tokensAfterEstimate?: number; error?: string; originalContextPreserved?: boolean }>;
  presentationRevision: number;
  lastRuntimeCursor: number;
  terminalRunId: string;
};

export type RunPresentationSnapshot = {
  runId: string;
  revision: number;
  lastCursor: number;
  status: ThreadRunState['status'];
  phase?: ThreadRunState['phase'];
  content: string;
  activityGroups: RunActivityGroup[];
  approval: HermesRunApproval | null;
  clarification: HermesRunClarification | null;
  compaction: RunUiState['compaction'];
  error?: string;
};

export type ThreadRunStateResponse = { threadId: string; run: ThreadRunState | null; presentation?: RunPresentationSnapshot | null; thread: Thread };
export type ActiveRunsResponse = { runs: Array<Omit<ThreadRunStateResponse, 'thread'>> };

export type RunPresentationUi = RunUiState & {
  hostRunId: string;
  turnId: string;
  agentId: string;
  agentName: string;
  completed: boolean;
};

export type SpaceGradientColor = { id: string; color: string; x: number; y: number; isPrimary?: boolean };
export type ThemeHarmony = 'floating' | 'singleAnalogous' | 'complementary' | 'splitComplementary' | 'analogous' | 'triadic';
export type ThemePreset = { id: string; page: number; colors: string[]; point: { x: number; y: number }; harmony: ThemeHarmony; type?: 'color' | 'grayscale' };
export type SpaceThemeAppearance = 'auto' | 'light' | 'dark';
export type AppAppearance = 'system' | 'light' | 'dark';
export type SpaceThemeColorMode = 'native' | 'custom';
export type SpaceThemePalette = { accentColor: string; sidebarBg: string; opacity: number; noise: number; texture?: number; mode: 'soft' | 'crisp'; gradientColors?: SpaceGradientColor[] };
export type SpaceTheme = SpaceThemePalette & { colorMode?: SpaceThemeColorMode; appearance?: SpaceThemeAppearance; lightTheme?: SpaceThemePalette; darkTheme?: SpaceThemePalette; renderVersion?: number };
export type LaunchMaterialSnapshot = { activeSpaceId: string; theme: SpaceTheme; dark: boolean };
export type SpaceDraft = { name: string; iconKind: SpaceIconKind; iconValue: string; theme: SpaceTheme };
export type SpaceIconKind = 'dot' | 'emoji' | 'icon';
export type Space = { id: string; name: string; iconKind: SpaceIconKind; iconValue: string; theme: SpaceTheme; createdAt: string; updatedAt: string; archivedAt?: string | null; lastOpenedAt?: string | null };
export type Workspace = { id: string; spaceId?: string | null; name: string; rootPath: string; vaultId: string | null; primaryVaultId?: string | null; sharedVaultIds?: string[]; writableVaultIds?: string[]; personalKnowledgeDefault?: 'on' | 'off'; environment: 'local'; activeThreadId: string | null; createdAt: string; updatedAt: string; archivedAt?: string | null; pinnedAt?: string | null; activeThread?: ThreadSummary | null; threads?: ThreadSummary[] };
export type PinnedNav = Record<string, boolean>;
export type RailConfirm = { kind: 'thread' | 'workspace'; id: string; title: string } | null;
export type RenameDialogTarget = { kind: 'thread' | 'workspace'; id: string; title: string } | null;
export type RailContextMenuSource = { kind: 'thread'; thread: ThreadSummary } | { kind: 'workspace'; workspace: Workspace } | { kind: 'space'; space: Space };
export type RailContextMenuRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type RailContextMenuTarget = RailContextMenuSource & { x: number; y: number; anchorRect?: RailContextMenuRect; sidebarRect?: RailContextMenuRect };
export type AppLaunchPhase = LaunchPhase | 'done';

export type WorkbenchUiSettings = {
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
  contextCompactWidth?: number;
  contextWorkWidth?: number;
  activeSpaceId?: string;
  collapsedWorkspaceIds?: string[];
  pinnedNav?: PinnedNav;
  telemetryEnabled?: boolean;
  telemetryNoticeSeenAt?: string;
};

export type TelemetryStatus = { enabled: boolean; configured: boolean; queueSize: number; lastSentAt: string | null };
export type HermesProviderSummary = { providerKey: string; providerName: string; baseUrl: string; model: string; hasApiKey: boolean; apiKeyState: 'stored' | 'missing' | string };
export type HermesProfile = { name: string; path?: string; displayName?: string; model: string; provider: string; contextLimit?: number | null; hasConfig: boolean; hasEnv: boolean; hasAuth: boolean; soulExcerpt?: string; userExcerpt?: string; memoryExcerpt?: string; providers?: HermesProviderSummary[]; skills?: ProfileModuleEntry[]; plugins?: ProfileModuleEntry[]; avatarUrl?: string };
export type HermesLocalStatus = {
  studio: { url: string; online: boolean; authMode: string; apiAuthorized: boolean; apiStatus: number; health?: { status?: string; webui_version?: string; gateway?: string; agent_bridge?: { status?: string } } | null };
  profiles: HermesProfile[];
  database: { exists: boolean; rooms: { id: string; name: string; totalTokens: number }[]; sessions: { profile: string; model: string; provider: string; title: string; messageCount: number }[] };
  checkedAt: string;
};
export type HermesApiAvailability = 'unknown' | 'online' | 'offline';

export type HermesBootstrapStatus = {
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

export type HermesGatewayRepair = {
  version: 1;
  status: 'completed' | 'completed_with_warnings';
  repairedAt: string;
  stoppedServices: string[];
  archivedProfiles: string[];
  cleanedAutoStartNames: string[];
  unresolved: Array<{ profileName: string; reason: string }>;
  backupPath?: string;
};

export type HermesRuntimeInfo = {
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

export type HermesRuntimeManager = {
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

export type HermesOfficialRelease = {
  tag: string;
  version?: string;
  releaseDate?: string;
  label?: string;
  url?: string;
  commit?: string;
};

export type HermesRuntimeDiagnostics = {
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

export type HermesRuntimeStatus = {
  bridge: { endpoint: string; running: boolean; ready: boolean; status: string; error?: string };
  profiles: HermesProfile[];
  gateways: Array<{ profileName: string; running: boolean; status: string; error?: string }>;
  gatewayRepair?: HermesGatewayRepair | null;
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

export type UpdateModuleStatus = {
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

export type HermesBackup = {
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

export type UpdatesStatus = {
  checkedAt: string;
  hermesAgent: UpdateModuleStatus;
  frakioWork: UpdateModuleStatus;
  backups?: HermesBackup[];
  backupRoot?: string;
};

export type RuntimePackageBinding = {
  runtimeId: string;
  runtimeVersion: string;
  runtimeBuildId: string;
  source: 'bundled' | 'managed' | 'override' | 'native' | string;
  runtimeDir: string;
  executablePath?: string;
  packageRoot?: string;
  fingerprint?: string;
  availability?: 'ready' | 'broken' | 'unavailable' | string;
  platform: string;
  arch: string;
  adapterProtocolVersion: number;
  activationRevision: string;
  verificationState: 'verified' | 'incompatible' | 'failed' | 'unverified' | string;
};

export type RuntimePackageRecord = RuntimePackageBinding & {
  artifactDigest?: string;
  installationState: string;
  verificationReceipt?: { error?: string; checkedAt?: string; [key: string]: unknown };
  installedAt?: string;
  verifiedAt?: string | null;
  updatedAt?: string;
};

export type PiRuntimePackageStatus = {
  runtimeId: RuntimeId;
  activation: { activeBuildId: string; previousBuildId?: string; activationRevision: string; updatedAt?: string } | null;
  activeBinding: RuntimePackageBinding | null;
  previousBinding: RuntimePackageBinding | null;
  bundledBinding: RuntimePackageBinding | null;
  packages: RuntimePackageRecord[];
  releases: {
    verified: Array<{ version: string; verifiedAt?: string; node?: string; integrity?: string }>;
    upstreamLatest?: { version: string; publishedAt?: string } | null;
    checkedAt?: string;
    source?: string;
    catalogSource?: string;
  };
};

export type RuntimeDiscoveryCandidate = {
  runtimeId: RuntimeId;
  path: string;
  realPath: string;
  packageRoot?: string;
  version: string;
  platform: string;
  arch: string;
  fingerprint: string;
  compatibility: 'compatible' | 'incompatible' | 'unknown';
  detail: string;
};

export type UpdateActionResult = {
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

export type UpdateBusy = 'check' | 'runtime-check' | 'runtime-install' | 'runtime-bundled' | 'hermes-agent' | 'frakio-work' | 'backup' | `runtime-activate:${string}` | `runtime-delete:${string}` | `rollback:${string}` | `delete:${string}` | `cleanup:${string}` | '';
export type RollbackScopes = { profiles?: boolean; mcp?: boolean; channels?: boolean; models?: boolean };

export type HermesConfig = {
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

export type HermesJob = {
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

export type UserProfileAgentUsage = { id: string; name: string; role?: string; color?: string; avatarUrl?: string; profileName?: string; conversationCount: number; messageCount: number; lastUsedAt?: string | null };
export type UserProfileModuleUsage = { name: string; category?: string; profiles?: number; enabledProfiles?: number; useCount: number; viewCount: number; patchCount: number; lastUsedAt?: string | null };

export type UsageDay = { day: string; requests: number; totalTokens: number; realTotalTokens: number; totalCost: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
export type UsageEntry = { id?: string; createdAt?: string; provider: string; modelId: string; modelName: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; realTotalTokens: number; totalCost: number; pricing?: ModelPricing & { source?: string }; pricingSource?: string; estimated?: boolean; dataSource?: string; threadTitle?: string; agentNames?: string[]; profileName?: string };

export type UserProfileSummary = {
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

export type McpServer = {
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

export type McpServersPayload = {
  profile: string;
  configPath: string;
  servers: McpServer[];
  stats: { total: number; connected: number; disconnected: number; tools: number };
  runtime?: { bridgeReady?: boolean; lastError?: string };
};

export type McpFormState = {
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

export type KanbanTaskStatus = 'triage' | 'todo' | 'scheduled' | 'ready' | 'running' | 'blocked' | 'review' | 'done' | 'archived';
export type CollaborationTaskStatus = KanbanTaskStatus | 'pending_confirmation' | 'waiting_dependency' | 'waiting_input' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type CollaborationRunStatus = 'queued' | 'starting' | 'running' | 'parked' | 'ended' | 'failed' | 'aborted';
export type CollaborationTaskActivity = { phase: 'queued' | 'waiting_dependency' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'paused' | 'cancelled'; revision: number; kind?: RunActivityItem['kind']; displayName?: string; target?: string; upstreamAgentNames?: string[]; changedAt: string; waitingSince?: string; sourceEventId?: string; runId?: string };

export type KanbanTask = {
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

export type CollaborationTask = Omit<KanbanTask, 'status'> & { status: CollaborationTaskStatus; dependencies?: string[]; activity?: CollaborationTaskActivity };

export type KanbanBoard = {
  slug: string;
  name: string;
  icon?: string;
  total?: number;
  counts?: Record<string, number>;
  archived?: boolean;
};

export type MonitoringLog = { source: string; file?: string; level: 'info' | 'warn' | 'error' | string; message: string };
export type ModelUsageRow = { key: string; provider: string; modelId: string; modelName: string; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; realTotalTokens: number; totalCost: number; pricing?: ModelPricing & { source?: string }; pricingSource?: string; estimatedRequests: number; lastUsedAt?: string | null; dataSources?: Record<string, number> };
export type UsageSource = { source: string; requests: number; totalTokens: number; realTotalTokens: number; totalCost: number };
export type UsageProfile = { profileName: string; requests: number; totalTokens: number; realTotalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number };
export type UsageRangeMode = 'today' | '7' | '15' | '30' | '90' | '180' | '365';
export type AnalysisTab = 'cost' | 'trend' | 'requests' | 'ranking';
export type UsageTrendPoint = { key: string; label: string; requests: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; realTotalTokens: number; cost: number };
export type ModelMetricRow = { key: string; provider: string; modelName: string; requests: number; realTotalTokens: number; totalCost: number; share: number; color: string };
export type DonutMetricRow = { key: string; modelName: string; requests: number; realTotalTokens: number; totalCost: number; share: number; displayShare: number; color: string };
export type ModuleUsageRow = { name: string; category?: string; profiles?: number; enabledProfiles?: number; useCount: number; viewCount: number; patchCount: number; lastUsedAt?: string | null };
export type ModelRunDiagnostic = { id: string; runId?: string; createdAt: string; updatedAt?: string; completedAt?: string; agentName?: string; profileName?: string; provider: string; providerKey?: string; model: string; transport: string; requestedReasoning: string; effectiveReasoning: string; requestedServiceTier: string; effectiveServiceTier: string; mappedParameters?: Record<string, unknown>; status: 'starting' | 'sent' | 'completed' | 'failed' | 'cancelled'; evidenceStatus: 'pending' | 'confirmed' | 'unconfirmed' | 'not_applicable'; reasoningTokens?: number; confirmedServiceTier?: string; durationMs?: number; error?: string };

export type MonitoringSummary = {
  checkedAt: string;
  logs: MonitoringLog[];
  modelRuns: ModelRunDiagnostic[];
  usage: { totalRequests: number; totalTokens: number; realTotalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number; cacheHitRate: number; estimatedRequests: number; byModel: ModelUsageRow[]; byDay: UsageDay[]; bySource: UsageSource[]; byProfile?: UsageProfile[]; entries?: UsageEntry[]; recent: Array<ModelUsageRow & { createdAt?: string; agentNames?: string[]; threadTitle?: string }> };
  hermesStudio?: { databaseExists: boolean; roomCount: number; sessionCount: number; usageRowCount?: number; usageSource?: string };
  hermesAgent?: { databaseCount: number; usageRowCount: number; usageSource: string; profiles: Array<{ profileName: string; dbPath: string; sessionCount: number }> };
  modules: { skills: { total: number; enabled: number; byName: ModuleUsageRow[] }; plugins: { total: number; enabled: number; byName: ModuleUsageRow[] } };
};

export type ProfileEditableKind = 'notes' | 'user' | 'soul';
export type ProfileInspectorTarget = {
  agentId: string;
  agentName: string;
  profileName: string;
  kind: ProfileEditableKind;
  title: string;
};

export type ProfileInspectorState = {
  target: ProfileInspectorTarget | null;
  draft: string;
  original: string;
  loading: boolean;
  saving: boolean;
  error: string;
  errorStage: '' | 'load' | 'save';
  saved: boolean;
};

export type ProfileEditorControls = {
  state: ProfileInspectorState;
  dirty: boolean;
  open: (target: ProfileInspectorTarget) => Promise<void>;
  changeDraft: (draft: string) => void;
  save: () => Promise<void>;
  close: () => boolean;
  discard: () => boolean;
};
