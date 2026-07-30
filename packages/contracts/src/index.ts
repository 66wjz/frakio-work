export type ApiError = {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
};

export type RuntimeId = 'hermes' | 'pi' | 'codex' | 'claude' | 'gemini' | (string & {});

export type RuntimeCapability = {
  streaming: boolean;
  tools: boolean;
  approvals: boolean;
  steering: boolean;
  cancellation: boolean;
  sessionResume: boolean;
  customModels: boolean;
  managedCredentials: boolean;
  workTasks: boolean;
};

export type RuntimeInstallation = {
  runtimeId: RuntimeId;
  kind: 'core' | 'channel';
  status: 'ready' | 'missing' | 'needs_login' | 'incompatible' | 'disabled' | 'error';
  installed: boolean;
  version: string;
  command?: string;
  authMode?: 'frakio-managed' | 'native' | 'none';
  detail?: string;
  checkedAt: string;
};

export type RuntimeDefinition = {
  id: RuntimeId;
  name: string;
  kind: 'core' | 'channel';
  bundled: boolean;
  enabled: boolean;
  capabilities: RuntimeCapability;
  installation?: RuntimeInstallation;
};

export type AgentRuntimePolicy = {
  defaultRuntimeId: RuntimeId;
  allowedRuntimeIds: RuntimeId[];
  permissionProfileId: string;
};

export type RuntimeModelCompatibility = {
  status: 'ready' | 'partial' | 'unsupported' | 'missing_credentials';
  credentialStatus: 'ready' | 'missing' | 'not_required';
  usableModelIds: string[];
  unsupportedModelIds: string[];
  reason: string;
};

export type RuntimeModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  defaultModelId: string;
  models: string[];
  compatibility: RuntimeModelCompatibility;
};

export type RuntimeModelCatalog = {
  runtimeId: RuntimeId;
  source: 'frakio-model-center' | 'native-account';
  models: RuntimeModelCatalogEntry[];
  usableModelCount?: number;
};

export type RuntimeFeatureFlags = {
  runtimeRouterV1: boolean;
  piRuntime: boolean;
  runtimeNeutralWork: boolean;
  memoryLedger: boolean;
  externalCliChannels: boolean;
};

export type AgentProfileSnapshot = {
  agentId: string;
  revision: string;
  name: string;
  role: string;
  soul: string;
  scope: string;
  userProfile: string;
  runtimePolicy: AgentRuntimePolicy;
  createdAt: string;
};

export type RuntimeSession = {
  id: string;
  runtimeId: RuntimeId;
  threadId: string;
  agentId: string;
  workspaceId: string;
  nativeSessionId: string;
  profileRevision: string;
  status: 'active' | 'idle' | 'closed' | 'failed';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeRunStatus = 'starting' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export type RuntimeRun = {
  id: string;
  sessionId: string;
  runtimeId: RuntimeId;
  threadId: string;
  agentId: string;
  turnId: string;
  profileRevision: string;
  modelId: string;
  status: RuntimeRunStatus;
  error: string;
  startedAt: string;
  completedAt?: string | null;
};

export type RuntimeEventType =
  | 'run.started'
  | 'message.delta'
  | 'reasoning.summary'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'artifact.published'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export type RuntimeEvent = {
  id: string;
  cursor: number;
  runId: string;
  sessionId: string;
  runtimeId: RuntimeId;
  type: RuntimeEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MemoryEntryStatus = 'candidate' | 'accepted' | 'superseded' | 'rejected';

export type MemoryProvenance = {
  runtimeId?: RuntimeId;
  runId?: string;
  threadId?: string;
  source: string;
  createdAt: string;
};

export type MemoryEntry = {
  id: string;
  scope: 'user' | 'agent' | 'workspace';
  subjectId: string;
  fact: string;
  provenance: MemoryProvenance[];
  confidence: number;
  status: MemoryEntryStatus;
  validFrom: string | null;
  validUntil: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttachmentKind = 'image' | 'text' | 'document' | 'audio' | 'video' | 'archive';

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  createdAt: string;
  contentUrl: string;
};

export type CollaborationMode = 'default' | 'plan';

export type PlanSessionStatus =
  | 'drafting'
  | 'waiting_input'
  | 'waiting_approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type PlanOption = {
  label: string;
  description: string;
  recommended: boolean;
};

export type PlanQuestion = {
  id: string;
  header: string;
  question: string;
  options: PlanOption[];
};

export type PlanQuestionAnswer = {
  selectedLabel?: string;
  note?: string;
};

export type PlanQuestionBatch = {
  id: string;
  questions: PlanQuestion[];
  answers: Record<string, PlanQuestionAnswer>;
  status: 'pending' | 'resolved' | 'cancelled' | 'auto_resolved';
  autoResolutionMs?: number;
  createdAt: string;
  resolvedAt?: string;
};

export type PlanStep = {
  key: string;
  title: string;
  description: string;
  files: string[];
  assigneeAgentId?: string;
  expectedResult: string;
  dependsOnKeys: string[];
};

export type PlanDraft = {
  revision: number;
  title: string;
  summary: string;
  steps: PlanStep[];
  tests: string[];
  assumptions: string[];
  submittedByRunId: string;
  createdAt: string;
};

export type PlanSession = {
  id: string;
  readOnly?: boolean;
  targetExecutionMode: 'chat' | 'work';
  authorAgentId: string;
  status: PlanSessionStatus;
  currentRevision: number;
  drafts: PlanDraft[];
  questions: PlanQuestionBatch[];
  sourceRunId?: string;
  executionRunId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type RunActivityKind = 'read' | 'search' | 'edit' | 'write' | 'command' | 'web' | 'skill' | 'collaboration' | 'other';
export type RunActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type RunActivityItem = {
  id: string;
  kind: RunActivityKind;
  status: RunActivityStatus;
  toolName: string;
  displayName?: string;
  intent?: string;
  activeLabel: string;
  completedLabel: string;
  target: string;
  durationMs: number;
  resultPreview: string;
  createdAt: string;
  updatedAt: string;
};

export type RunActivityGroup = {
  id: string;
  contentOffset: number;
  status: RunActivityStatus;
  summary: string;
  items: RunActivityItem[];
  createdAt: string;
  updatedAt: string;
};

export type RunTranscript = {
  runId: string;
  turnId: string;
  messageId: string;
  agentId: string;
  status: RunActivityStatus;
  groups: RunActivityGroup[];
  partialContent?: string;
  createdAt: string;
  updatedAt: string;
};

export type HermesMentionRouteStatus = 'pending' | 'starting' | 'running' | 'completed' | 'failed';

export type HermesMentionRoute = {
  id: string;
  edge: string;
  sourceAgentId: string;
  sourceAgentName: string;
  sourceMessageId: string;
  targetAgentId: string;
  targetAgentName: string;
  mentionDepth: number;
  text: string;
  status: HermesMentionRouteStatus;
  runId: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

export type HermesAgentTurn = {
  turnId: string;
  maxMentionDepth: number | 'unlimited';
  depth: number;
  routedEdges: string[];
  routes: HermesMentionRoute[];
  activeRuns: Record<string, {
    runId: string;
    sessionId: string;
    agentId: string;
    agentName: string;
    mentionDepth: number;
    parentMessageId: string;
    status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  }>;
  totalRoutedRuns: number;
  status: 'running' | 'routing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type HermesTurnEvent = {
  event: string;
  cursor: number;
  timestamp: number;
  threadId: string;
  turnId: string;
  runId?: string;
  sessionId?: string;
  agentId?: string;
  agentName?: string;
  mentionDepth?: number;
  parentMessageId?: string;
  delta?: string;
  output?: string;
  error?: string;
  route?: HermesMentionRoute;
  thread?: unknown;
  [key: string]: unknown;
};

export type HermesNetworkCapabilityStatus = {
  enabled: boolean;
  ready: boolean;
  provider?: string | null;
  source?: 'configured' | 'automatic' | 'free' | 'unconfigured';
  chromiumReady?: boolean;
  detail:
    | 'ready'
    | 'free_provider_ready'
    | 'tool_disabled'
    | 'provider_not_configured'
    | 'provider_unavailable'
    | 'provider_probe_failed'
    | 'browser_cli_missing'
    | 'chromium_missing';
};

export type HermesNetworkStatus = {
  profile: string;
  onlineReadReady: boolean;
  search: HermesNetworkCapabilityStatus;
  extract: HermesNetworkCapabilityStatus;
  browser: HermesNetworkCapabilityStatus;
  checkedAt: string;
};

export type CollaborationWorkflowStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'archived';

export type CollaborationWorkflowControl = {
  operationId: string;
  idempotencyKey: string;
  action: 'pause' | 'resume' | 'cancel' | '';
  state: 'idle' | 'pausing' | 'paused' | 'resuming' | 'cancelling' | 'cancelled' | 'pause_failed';
  affectedTaskIds: string[];
  stoppedRuns: number;
  blockedTasks: number;
  preservedWaitingTasks: number;
  failedTaskIds: string[];
  heldInterventionCount: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string;
};

export type CollaborationEventType =
  | 'task.created'
  | 'task.started'
  | 'task.waiting'
  | 'task.resumed'
  | 'task.completed'
  | 'task.failed'
  | 'dependency.created'
  | 'dependency.satisfied'
  | 'artifact.published'
  | 'escalation.started'
  | 'escalation.resolved'
  | 'human.required'
  | 'intervention.sent'
  | 'workflow.created'
  | 'workflow.completed'
  | 'workflow.pause_started'
  | 'workflow.paused'
  | 'workflow.pause_failed'
  | 'workflow.resume_started'
  | 'workflow.resumed'
  | 'workflow.cancelled'
  | 'workflow.archived'
  | 'mode.changed'
  | 'plan.published'
  | 'plan.revised'
  | 'capability.blocked';

export type CollaborationWorkflow = {
  id: string;
  name: string;
  boardSlug: string;
  status: CollaborationWorkflowStatus;
  coordinatorAgentId: string;
  fallbackDecisionAgentId: string;
  rootTaskIds: string[];
  currentRootTaskId?: string;
  planRevision?: number;
  plan?: {
    revision: number;
    goal?: string;
    summary?: string;
    tasks: Array<{ key: string; taskId?: string; title: string; description?: string; assigneeAgentId: string; expectedResult?: string; dependsOnKeys: string[]; cancelled?: boolean }>;
    publishedAt?: string;
  } | null;
  control?: CollaborationWorkflowControl;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  pausedAt?: string | null;
  cancelledAt?: string | null;
  archivedAt?: string | null;
};

export type CollaborationEvent = {
  id: string;
  cursor: number;
  type: CollaborationEventType;
  workflowId: string;
  taskId?: string;
  actorAgentId?: string;
  title: string;
  detail?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
};

export type AppUpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  channel: 'beta' | 'stable';
  repositoryUrl: string;
  releaseUrl: string;
  notes?: string;
  publishedAt?: string;
  asset?: ReleaseAsset | null;
  checksumAsset?: ReleaseAsset | null;
  installMode: 'desktop-release' | 'source';
  error?: string;
};

export type RuntimePlatform = 'mac-arm64' | 'mac-x64' | 'win-arm64' | 'win-x64' | 'linux-arm64' | 'linux-x64';
