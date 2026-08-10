export type ApiError = {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
};

export type RuntimeId = 'hermes' | 'pi' | 'codex' | 'claude' | (string & {});
export type HarnessId = 'native' | 'hermes' | 'codex' | 'claude';

export type AgentExecutionPolicy = {
  defaultHarnessId: HarnessId;
  permissionProfileId: string;
};

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
  contextUsage?: boolean;
  compaction?: boolean;
};

export type RuntimeControlCapability = 'native' | 'host' | 'unsupported' | 'unobservable';

export type RuntimeAdapterCapabilities = {
  contextUsage: RuntimeControlCapability;
  compaction: RuntimeControlCapability;
  recovery: RuntimeControlCapability;
  cancellation: RuntimeControlCapability;
  permissions: RuntimeControlCapability;
};

export type RuntimeCapabilitySupport = 'supported' | 'partial' | 'unsupported' | 'unknown';

export type RuntimeCapabilitySnapshot = {
  runtimeId: RuntimeId;
  capabilities: Record<keyof RuntimeCapability | string, RuntimeCapabilitySupport>;
  source: 'probe' | 'runtime_receipt' | 'static_fallback';
  evidence: Record<string, unknown>;
  runtimeVersion: string;
  runtimeBuildId?: string;
  runtimeSource?: RuntimeBinding['source'] | '';
  authFingerprint: string;
  checkedAt: string;
  expiresAt: string;
};

export type RuntimeInstallation = {
  runtimeId: RuntimeId;
  kind: 'core' | 'channel';
  status: 'ready' | 'missing' | 'discoverable' | 'broken' | 'incompatible' | 'disabled' | 'error';
  installed: boolean;
  version: string;
  command?: string;
  authMode?: 'frakio-managed' | 'none';
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
  activeBinding?: RuntimeBinding | null;
};

export type AgentRuntimePolicy = {
  defaultRuntimeId: RuntimeId;
  allowedRuntimeIds: RuntimeId[];
  permissionProfileId: string;
  defaultHarnessId?: HarnessId;
};

export type AgentDefaultRunSettings = {
  reasoningEffort?: string;
  speedMode?: string;
};

export type ThreadAgentHarnessBinding = {
  agentId: string;
  harnessId: HarnessId;
  boundAt: string;
  source: 'thread_created' | 'legacy_migration' | 'explicit_migration';
  bindingRevision: number;
};

export type AgentOwnership = {
  identity: 'frakio';
  memory: 'frakio';
  runtimeProfile: 'hermes' | 'none';
};

export type MemoryScope = 'user' | 'agent' | 'vault' | 'thread';
export type MemoryStatus = 'candidate' | 'accepted' | 'paused' | 'superseded' | 'rejected' | 'forgotten';

export type MemoryEvent = {
  id: string;
  idempotencyKey: string;
  memoryId: string;
  type: 'memory.proposed' | 'memory.accepted' | 'memory.updated' | 'memory.forgotten' | 'memory.purged' | 'projection.published' | string;
  actorType: 'user' | 'runtime' | 'policy' | 'system' | string;
  actorId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'completed' | 'failed';
  error: string;
  createdAt: string;
  processedAt: string | null;
};

export type ContextReceipt = {
  id: string;
  threadId: string;
  runId: string;
  runtimeId: RuntimeId | '';
  agentId: string;
  query: string;
  memoryRevision: string;
  included: Array<{ id: string; scope: MemoryScope; kind: MemoryEntry['kind']; reason: string }>;
  excluded: Array<{ id: string; reason: string }>;
  createdAt: string;
};

export type ThreadContextAuthority = 'user_confirmed' | 'tool_verified' | 'system_recorded' | 'agent_proposed' | 'inferred';

export type ThreadContextEvent = {
  id: string;
  threadId: string;
  cursor: number;
  eventType: 'message.created' | 'message.corrected' | 'message.tombstoned' | 'tool.completed' | 'task.changed' | 'artifact.changed' | 'handoff.created' | 'handoff.completed' | 'handoff.failed' | string;
  actorType: 'user' | 'agent' | 'tool' | 'system';
  actorId: string;
  sourceId: string;
  sourceRevision: number;
  parentEventId: string;
  visibility: 'public' | 'internal';
  scope: 'thread' | 'workspace' | 'personal';
  authority: ThreadContextAuthority;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ThreadStateItem = {
  id: string;
  type: 'goal' | 'decision' | 'requirement' | 'constraint' | 'task' | 'artifact' | 'finding' | 'risk' | 'open_question';
  status: 'active' | 'resolved' | 'superseded' | 'tombstoned';
  statement: string;
  authority: ThreadContextAuthority;
  scope: 'thread' | 'workspace';
  sourceEventIds: string[];
  sourceMessageIds: string[];
  relatedTaskIds: string[];
  relatedArtifactIds: string[];
  supersedes: string[];
  ownerAgentId: string;
  revision: number;
  updatedAt: string;
};

export type HandoffEnvelope = {
  id: string;
  routeId: string;
  turnId: string;
  sourceAgentId: string;
  sourceAgentName?: string;
  targetAgentId: string;
  sourceMessageId: string;
  parentMessageId: string;
  reason: 'agent_mention' | 'structured_handoff';
  handoffReason?: string;
  objective: string;
  requestedOutput: string;
  constraints: string[];
  relevantStateIds: string[];
  relevantTaskIds: string[];
  relevantArtifactIds: string[];
  sourceExcerpt: string;
  depth: number;
  createdAt: string;
};

export type ContextReceiptV2 = {
  id: string;
  packetId: string;
  packetHash: string;
  threadId: string;
  runId: string;
  runtimeId: RuntimeId | '';
  agentId: string;
  schemaVersion: 2;
  stateRevision: number;
  cursor: { from: number; to: number };
  deliveryMode: 'native_session' | 'frakio_full' | 'frakio_delta';
  budget: Record<string, unknown>;
  included: Array<{ kind: string; count: number }>;
  excluded: Array<{ kind?: string; id?: string; reason: string }>;
  conflicts: Array<Record<string, unknown>>;
  warnings: Array<{ code: string; message: string }>;
  sourceReceiptIds: string[];
  createdAt: string;
};

export type HermesProjectionState = {
  profileName: string;
  agentId: string;
  agentRevision: string;
  memoryRevision: string;
  contentHash: string;
  files: Record<string, string>;
  status: 'pending' | 'ready' | 'failed';
  error: string;
  generatedAt: string | null;
  updatedAt: string;
};

export type RuntimeModelCompatibility = {
  status: 'ready' | 'partial' | 'unsupported' | 'missing_credentials';
  credentialStatus: 'ready' | 'missing' | 'not_required';
  compatibility: 'direct' | 'bridged' | 'unsupported';
  bridgeId: string;
  harnessApiMode: string;
  upstreamApiMode: string;
  capabilities: Record<string, 'native' | 'bridge' | 'auxiliary' | 'unsupported'>;
  degradations: string[];
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
  modelCompatibilities: Record<string, RuntimeModelCompatibility>;
};

export type RuntimeModelCatalog = {
  runtimeId: RuntimeId;
  source: 'frakio-model-center';
  models: RuntimeModelCatalogEntry[];
  usableModelCount?: number;
};

export type RuntimeFeatureFlags = {
  runtimePlatformV2: boolean;
  runtimeSessionLanes: boolean;
  runtimeContextDelta: boolean;
  runtimeSkillProjection: boolean;
  runtimePermissionBroker: boolean;
  runtimeRouterV1: boolean;
  piRuntime: boolean;
  runtimeNeutralWork: boolean;
  collaborationV2?: boolean;
  memoryLedger: boolean;
  externalCliChannels: boolean;
  runtimePackageManager?: boolean;
  runtimeVersionBindings?: boolean;
  managedPiRuntime?: boolean;
  piBridgePool?: boolean;
  piVersionHandoff?: boolean;
};

export type RuntimeBinding = {
  runtimeId: RuntimeId;
  runtimeVersion: string;
  runtimeBuildId: string;
  source: 'bundled' | 'managed' | 'override' | 'native';
  runtimeDir: string;
  executablePath: string;
  packageRoot: string;
  fingerprint: string;
  platform: string;
  arch: string;
  artifactDigest?: string;
  adapterProtocolVersion: number;
  activationRevision: string;
  verificationState: 'verified' | 'incompatible' | 'failed' | 'unverified';
  availability: 'unavailable' | 'discoverable' | 'ready' | 'broken';
  lastVerifiedAt: string | null;
};

export type RuntimeDiscoveryCandidate = {
  runtimeId: RuntimeId;
  path: string;
  realPath: string;
  packageRoot: string;
  version: string;
  platform: string;
  arch: string;
  fingerprint: string;
  compatibility: 'compatible' | 'incompatible';
  detail: string;
};

export type RuntimeModelRoute = {
  runtimeId: RuntimeId;
  providerId: string;
  providerName?: string;
  modelProfileId?: string;
  modelId: string;
  apiMode: 'anthropic_messages' | 'codex_responses' | 'openai_responses' | 'chat_completions' | 'bedrock_converse' | string;
  protocol?: 'anthropic-messages' | 'openai-responses' | 'openai-chat';
  compatibility: 'direct' | 'bridged' | 'unsupported';
  harnessApiMode?: string;
  upstreamApiMode?: string;
  bridgeId?: string;
  capabilities?: Record<string, 'native' | 'bridge' | 'auxiliary' | 'unsupported'>;
  degradations?: string[];
  credentialRevision: string;
  providerCredentialRevision?: string;
  routeRevision: string;
  baseUrl?: string;
  endpoint: string;
  targetUrl?: string;
  authType?: 'api_key' | 'oauth' | 'none';
  contextWindow?: number;
  maxOutputTokens?: number;
  reason: string;
};

export type RuntimeExecutionRealm = {
  id: string;
  revision: string;
  runtimeId: RuntimeId;
  runtimeBuildId: string;
  providerId: string;
  providerCredentialRevision: string;
  agentId: string;
  skillSetRevision: string;
  runtimeConfigRevision: string;
};

export type RuntimePackage = Omit<RuntimeBinding, 'activationRevision'> & {
  installationState: 'available' | 'installing' | 'installed' | 'failed';
  verificationReceipt: Record<string, unknown>;
  metadata: Record<string, unknown>;
  installedAt: string;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
};

export type RuntimeActivation = {
  runtimeId: RuntimeId;
  activeBuildId: string;
  previousBuildId: string;
  activationRevision: string;
  updatedAt: string;
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
  runtimeVersion: string;
  runtimeBuildId: string;
  activationRevision: string;
  threadId: string;
  agentId: string;
  workspaceId: string;
  nativeSessionId: string;
  executionRealmRevision: string;
  modelRouteRevision: string;
  profileRevision: string;
  laneType: 'chat' | 'work_task';
  laneId: string;
  worktreeId: string;
  lifecycleState: 'opening' | 'active' | 'parked' | 'restoring' | 'recovering' | 'stale' | 'closed' | 'failed';
  contextWatermark: string;
  skillSetRevision: string;
  permissionPolicyRevision: string;
  capabilitySnapshot: RuntimeCapabilitySnapshot | Record<string, unknown>;
  resumeStrategy: 'native_resumed' | 'handoff_resumed' | 'new_session' | 'unsupported' | 'failed' | '';
  checkpoint: Record<string, unknown>;
  lastError: string;
  /** @deprecated Use lifecycleState. */
  status: 'active' | 'idle' | 'closed' | 'failed';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeRunStatus =
  | 'queued'
  | 'running'
  | 'interrupting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** @deprecated Compatibility with Runtime v2 records written before Host Run Controller. */
  | 'starting'
  /** @deprecated Approval is represented by phase=approval. */
  | 'waiting_approval';

export type RuntimeRunPhase = 'opening' | 'model' | 'tool' | 'compaction' | 'approval';

export type RuntimeRun = {
  id: string;
  sessionId: string;
  runtimeId: RuntimeId;
  runtimeVersion: string;
  runtimeBuildId: string;
  activationRevision: string;
  threadId: string;
  agentId: string;
  turnId: string;
  nativeRunId: string;
  nativeTurnId: string;
  lastNativeEventSequence: number;
  executionRealmRevision: string;
  modelRouteRevision: string;
  profileRevision: string;
  modelId: string;
  status: RuntimeRunStatus;
  phase: RuntimeRunPhase;
  stopRequestedAt?: string | null;
  error: string;
  contextWatermarkFrom: string;
  contextWatermarkTo: string;
  skillSetRevision: string;
  permissionPolicyRevision: string;
  permissionCoverage: PermissionCoverage;
  receipt: RunReceipt | Record<string, unknown>;
  startedAt: string;
  completedAt?: string | null;
};

export type RunPresentation = {
  runId: string;
  revision: number;
  lastCursor: number;
  status: RuntimeRunStatus;
  phase: RuntimeRunPhase;
  content: string;
  activityGroups: RunActivityGroup[];
  approval: Record<string, unknown> | null;
  clarification: Record<string, unknown> | null;
  compaction: Record<string, unknown> | null;
  error: string;
  updatedAt: string;
};

export type RuntimeLaunchSpec = {
  runId: string;
  sessionId: string;
  runtimeId: RuntimeId;
  runtimeBinding: RuntimeBinding | null;
  executionRealm: RuntimeExecutionRealm;
  modelRoute: RuntimeModelRoute;
  mcpServers?: Record<string, { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }>;
  cwd: string;
  prompt: string;
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; attachmentId: string; name: string; mimeType: string; filePath: string; source?: 'native' | 'auxiliary' }
    | { type: 'document'; attachmentId: string; name: string; mimeType: string; filePath: string; source?: 'native' | 'auxiliary' }
    | { type: 'file_reference'; attachmentId: string; name: string; mimeType: string; filePath: string }
  >;
  permissionMode: string;
};

export type CanonicalRuntimeEventEnvelope = {
  runId: string;
  nativeEventKey: string;
  nativeSequence: number;
  event: { type: RuntimeEventType; payload: Record<string, unknown> };
};

export type RuntimeEventType =
  | 'run.accepted'
  | 'run.started'
  | 'session.opening'
  | 'session.parked'
  | 'session.resume_started'
  | 'session.resumed'
  | 'session.resume_failed'
  | 'context.delta_applied'
  | 'context.usage.updated'
  | 'context.compaction.started'
  | 'context.compaction.completed'
  | 'context.compaction.failed'
  | 'session.checkpoint.created'
  | 'session.recovered'
  | 'skill.application_started'
  | 'skill.applied'
  | 'skill.apply_failed'
  | 'permission.coverage_changed'
  | 'message.delta'
  | 'reasoning.summary'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'artifact.published'
  | 'artifact.conflict'
  | 'run.interrupting'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export type RuntimeEvent = {
  id: string;
  cursor: number;
  runId: string;
  sessionId: string;
  runtimeId: RuntimeId;
  runtimeVersion: string;
  runtimeBuildId: string;
  nativeEventKey?: string;
  type: RuntimeEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ContextCompactionTrigger = 'threshold' | 'model_switch' | 'runtime_switch' | 'overflow' | 'manual';

export type ContextCheckpoint = {
  id: string;
  threadId: string;
  throughCursor: number;
  retainedFromCursor: number;
  summary: string;
  sourceRuntimeId: RuntimeId;
  sourceModelId: string;
  trigger: ContextCompactionTrigger;
  tokensBefore?: number;
  tokensAfterEstimate?: number;
  version: 1;
  createdAt: string;
};

export type RuntimeLane = {
  type: 'chat' | 'work_task';
  id: string;
  worktreeId: string;
};

export type ContextDelta = {
  fromWatermark: string;
  toWatermark: string;
  changed: boolean;
  hash: string;
  sourceIds: string[];
  packet: Record<string, unknown>;
};

export type SkillScope = 'agent' | 'workspace' | 'team';
export type SkillApplicationStatus = 'available' | 'projecting' | 'applied' | 'pending_restart' | 'incompatible' | 'failed';

export type SkillManifest = {
  id: string;
  name: string;
  version: string;
  contentHash: string;
  scope: SkillScope;
  subjectId: string;
  sourceAgentId: string;
  compatibleRuntimeIds: RuntimeId[];
  dependencies: string[];
  permissionIntents: string[];
  entryPath: string;
  createdAt: string;
};

export type SkillApplicationReceipt = {
  id: string;
  skillId: string;
  skillVersion: string;
  runtimeId: RuntimeId;
  agentId: string;
  sessionId: string;
  status: SkillApplicationStatus;
  loadMethod: string;
  error: string;
  appliedAt: string | null;
  updatedAt: string;
};

export type PermissionModeInternal = 'ask_all' | 'risk_based' | 'full_access';
export type PermissionCoverage = 'host_enforced' | 'native_enforced' | 'partial' | 'unobservable' | '';

export type ToolIntent = {
  id: string;
  agentId: string;
  runtimeId: RuntimeId;
  runId: string;
  action: string;
  category: 'read' | 'write' | 'command' | 'network' | 'publish' | 'delete' | 'payment' | 'authorization' | 'other';
  target: string;
  workspaceRoot: string;
  effect: 'observe' | 'research_interaction' | 'persistent_mutation';
  mutating: boolean;
  networked: boolean;
  externalPublish: boolean;
  irreversible: boolean;
  summary: string;
};

export type PermissionDecision = {
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
  source: 'hard_boundary' | 'plan_mode' | 'workspace_policy' | 'agent_policy' | 'user_grant' | 'smart_review' | 'default';
  effect: 'observe' | 'research_interaction' | 'persistent_mutation';
  scope: 'once' | 'run' | 'agent_workspace';
  coverage: PermissionCoverage;
  expiresAt: string | null;
  policyRevision: string;
};

export type RunReceipt = {
  runId: string;
  sessionId: string;
  threadId: string;
  agentId: string;
  runtimeId: RuntimeId;
  runtimeVersion: string;
  runtimeBuildId: string;
  runtimeSource: RuntimeBinding['source'] | '';
  activationRevision: string;
  versionSwitchReason: string;
  modelId: string;
  lane: RuntimeLane;
  worktreePath: string;
  profileRevision: string;
  contextWatermarkFrom: string;
  contextWatermarkTo: string;
  skillSetRevision: string;
  permissionPolicyRevision: string;
  permissionCoverage: PermissionCoverage;
  resumeStrategy: RuntimeSession['resumeStrategy'];
  memoryEntryIds: string[];
  memoryExclusions: Array<{ id: string; reason: string }>;
  skillApplications: Array<Pick<SkillApplicationReceipt, 'skillId' | 'skillVersion' | 'status' | 'loadMethod'>>;
  toolSummary: Record<string, number>;
  status: RuntimeRunStatus;
  error: string;
  startedAt: string;
  completedAt: string | null;
};

export type MemoryEntryStatus = MemoryStatus;

export type MemoryProvenance = {
  runtimeId?: RuntimeId;
  runId?: string;
  threadId?: string;
  source: string;
  createdAt: string;
};

export type MemoryEntry = {
  id: string;
  scope: MemoryScope;
  subjectId: string;
  kind: 'personal_fact' | 'preference' | 'agent_experience' | 'project_fact' | 'project_decision' | 'project_rule' | 'fact';
  fact: string;
  origin: string;
  sourceAgentId: string;
  sourceSessionId: string;
  sourceMessageId: string;
  threadId: string;
  vaultId: string;
  provenance: MemoryProvenance[];
  confidence: number;
  status: MemoryEntryStatus;
  reason?: string;
  statusReason?: string;
  pausedAt?: string | null;
  validFrom: string | null;
  validUntil: string | null;
  supersedesId: string | null;
  createdRevision: string;
  lastRecalledAt: string | null;
  recallCount: number;
  deletedAt: string | null;
  deletionReason: string;
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

export type BrowserAnnotationTarget = 'element' | 'region';

export type BrowserAnnotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

export type BrowserAnnotation = {
  id: string;
  threadId: string;
  target: BrowserAnnotationTarget;
  url: string;
  pageTitle: string;
  comment: string;
  selector?: string;
  tagName?: string;
  accessibleName?: string;
  text?: string;
  domExcerpt?: string;
  rect: BrowserAnnotationRect;
  evidenceAttachmentId?: string;
  createdAt: string;
};

export type ReviewComment = {
  id: string;
  threadId: string;
  changeSetId: string;
  filePath: string;
  side: 'old' | 'new';
  line: number;
  hunk?: string;
  comment: string;
  createdAt: string;
};

export type MessageContext = {
  browserAnnotations: BrowserAnnotation[];
  reviewComments: ReviewComment[];
};

export type ConversationSource = {
  id: string;
  kind: 'attachment' | 'link';
  label: string;
  detail: string;
  url?: string;
  attachment?: Attachment;
  messageId: string;
  createdAt?: string;
};

export type RunChangeFile = {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  additions: number;
  deletions: number;
  binary?: boolean;
  patch?: string;
  truncated?: boolean;
};

export type RunChangeSet = {
  id: string;
  threadId: string;
  runId: string;
  workspaceId: string;
  scope: 'last-turn' | 'uncommitted';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  fileCount: number;
  additions: number;
  deletions: number;
  files: RunChangeFile[];
  createdAt: string;
  completedAt?: string;
  error?: string;
};

export type ConversationOverview = {
  threadId: string;
  environment: {
    kind: 'local' | 'unbound';
    workspaceName: string;
    workspaceRoot: string;
    gitBranch: string;
    gitAvailable: boolean;
  };
  context?: {
    personal: { enabled: boolean; source: 'thread' | 'workspace' | 'direct'; label: string; name: string };
    project: { name: string; ruleCount: number } | null;
  };
  plan: { title: string; status: string; taskCount: number } | null;
  sources: ConversationSource[];
  artifacts: Array<{ id: string; name: string; kind: string; path?: string; updatedAt?: string }>;
  lastChangeSet: RunChangeSet | null;
};

export type CollaborationMode = 'default' | 'plan' | 'collaboration';

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
  displayTitle: string;
  description: string;
  files: string[];
  assigneeAgentId?: string;
  expectedResult: string;
  dependsOnKeys: string[];
};

export type PlanDraft = {
  revision: number;
  title: string;
  displayTitle: string;
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
  purpose?: 'plan' | 'collaboration';
  targetExecutionMode: 'chat' | 'work' | 'collaboration';
  postApprovalIntent?: 'collaboration';
  workflowId?: string;
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

export type ComposerMessageIntent = 'chat' | 'collaboration';

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
  reason?: 'agent_mention' | 'structured_handoff';
  handoff?: HandoffEnvelope;
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

export type AutonomyMode = 'fully_autonomous' | 'tiered' | 'all_review';

export type ManagementMode = 'managed' | 'read_only';

export type VaultConfig = {
  type: 'personal' | 'project';
  version: 2;
  indexVersion: number;
  managementMode: ManagementMode;
  autonomy: AutonomyMode;
  onboardingStatus: 'ready' | 'needs_upgrade_confirmation' | string;
  trustedRulePaths: string[];
  maintenanceRulePaths: string[];
  writableRoots: string[];
  immutableRoots: string[];
  tagTaxonomy: string[];
  templateId: string;
  maintenanceModel: { profile: string; fallback: string };
  curatorPresentation: { displayName: string; avatarAssetPath: string };
  curatorExecution: { mode: 'auto' | 'explicit_model' | 'follow_agent'; provider: string; model: string; timeout: number; source: string };
  curatorReferenceAgentId: string;
  search: { engine: 'fts5' | string; confidenceThreshold: number };
  updatedAt: string;
};

export type KnowledgeSource = {
  id: string;
  vaultId: string;
  kind: 'url' | 'web' | 'file' | 'text' | 'markdown' | 'pdf' | 'conversation' | 'asset' | string;
  title: string;
  origin: string;
  relativePath: string;
  contentHash: string;
  status: 'pending' | 'accepted' | 'rejected' | 'duplicate' | 'drifted';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
};

export type KnowledgeJob = {
  id: string;
  vaultId: string;
  triggerKey: string;
  kind: 'ingest' | 'query' | 'lint' | 'maintenance' | string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  modelSnapshot: Record<string, unknown>;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type KnowledgeOperationFile = {
  operationId: string;
  relativePath: string;
  action: 'write' | 'delete';
  baseHash: string;
  beforeHash: string;
  afterHash: string;
  beforeContent: string | null;
  afterContent: string | null;
  metadata: Record<string, unknown>;
};

export type KnowledgeOperation = {
  id: string;
  vaultId: string;
  jobId: string;
  kind: 'change_set' | 'rule_change' | 'rollback' | string;
  status: 'proposed' | 'awaiting_review' | 'published' | 'rejected' | 'conflict';
  summary: string;
  risk: string;
  requiresReview: boolean;
  actor: Record<string, unknown>;
  metadata: Record<string, unknown>;
  files: KnowledgeOperationFile[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  rejectedAt: string | null;
  rolledBackAt: string | null;
};

export type KnowledgeIssue = {
  id: string;
  vaultId: string;
  code: 'broken_link' | 'orphan' | 'index_missing' | 'frontmatter' | 'illegal_tag' | 'low_confidence' | 'contradiction' | 'source_drift' | 'oversized' | string;
  severity: 'error' | 'warning' | 'info';
  relativePath: string;
  message: string;
  metadata: Record<string, unknown>;
  status: 'open' | 'resolved' | 'ignored';
  createdAt: string;
  updatedAt: string;
};

export type RuleChangeProposal = {
  summary: string;
  changes: Array<{ relativePath: string; action?: 'write' | 'delete'; content?: string; baseHash?: string }>;
  reason?: string;
  actor?: Record<string, unknown>;
};

export type VaultDetail = {
  vault: {
    id: string;
    name: string;
    path: string;
    kind: 'personal' | 'project';
    managementMode: ManagementMode;
    autonomy: AutonomyMode;
    onboardingStatus: string;
  };
  config: VaultConfig;
  curator?: {
    actorId: 'frakio-knowledge-curator';
    displayName: string;
    avatarUrl: string;
    runtime: 'hermes';
    modelLabel: string;
    modelSource: 'vault_model' | 'reference_agent' | 'global_curator' | 'default_agent';
    referenceAgentId: string;
    referenceAgentName: string;
  };
  stats: { documents: number; sources: number; pending: number; issues: number };
  recentOperations: KnowledgeOperation[];
  recentJobs: KnowledgeJob[];
  sources: KnowledgeSource[];
  issues: KnowledgeIssue[];
};

export type HermesNetworkStatus = {
  profile: string;
  onlineReadReady: boolean;
  search: HermesNetworkCapabilityStatus;
  extract: HermesNetworkCapabilityStatus;
  browser: HermesNetworkCapabilityStatus;
  checkedAt: string;
  configurationRevision?: string;
  verificationState?: 'verified';
};

export type CollaborationWorkflowStatus = 'draft' | 'pending_confirmation' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'archived';
export type CollaborationTaskStatus = 'pending_confirmation' | 'ready' | 'waiting_dependency' | 'running' | 'waiting_input' | 'review' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type CollaborationTaskActivityPhase = 'queued' | 'waiting_dependency' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type CollaborationRunStatus = 'queued' | 'starting' | 'running' | 'parked' | 'ended' | 'failed' | 'aborted';
export type CollaborationInterventionStatus = 'queued' | 'delivered' | 'injected' | 'deferred_to_next_run' | 'consumed' | 'cancelled';
export type WorkflowProposalStatus = 'draft' | 'pending_confirmation' | 'confirmed' | 'cancelled' | 'failed';

export type WorkflowProposal = {
  id: string;
  conversationId: string;
  workflowId?: string | null;
  sourcePlanId?: string | null;
  proposalMessageId?: string | null;
  revision: number;
  purpose: 'collaboration';
  status: WorkflowProposalStatus;
  title: string;
  summary: string;
  content: PlanDraft | Record<string, unknown>;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollaborationWorkflowControl = {
  operationId: string;
  idempotencyKey: string;
  action: 'pause' | 'resume' | 'cancel' | '';
  state: 'idle' | 'pausing' | 'paused' | 'resuming' | 'cancelling' | 'cancelled' | 'pause_failed';
  affectedTaskIds: string[];
  stoppedRuns: number;
  pendingRunIds: string[];
  deferredRunIds: string[];
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
  | 'task.review'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'dependency.created'
  | 'dependency.satisfied'
  | 'artifact.published'
  | 'escalation.started'
  | 'escalation.resolved'
  | 'human.required'
  | 'intervention.sent'
  | 'workflow.created'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.finalization_requested'
  | 'workflow.finalization_started'
  | 'workflow.delivery_ready'
  | 'workflow.finalization_failed'
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
  nativeOnly?: boolean;
  status: CollaborationWorkflowStatus;
  coordinatorAgentId: string;
  fallbackDecisionAgentId: string;
  rootTaskIds: string[];
  currentRootTaskId?: string;
  approvedPlanId?: string;
  approvedPlanRevision?: number;
  planRevision?: number;
  plan?: {
    revision: number;
    goal?: string;
    summary?: string;
    tasks: Array<{ key: string; taskId?: string; title: string; description?: string; assigneeAgentId: string; expectedResult?: string; dependsOnKeys: string[]; cancelled?: boolean }>;
    publishedAt?: string;
  } | null;
  control?: CollaborationWorkflowControl;
  finalization?: {
    state: 'idle' | 'requested' | 'running' | 'delivered' | 'failed';
    requestedAt?: string | null;
    startedAt?: string | null;
    deliveredAt?: string | null;
    failedAt?: string | null;
    deliveryMessageId?: string;
    runId?: string;
    error?: string;
  };
  finalDelivery?: {
    status: 'pending' | 'ready' | 'failed';
    summary: string;
    content: string;
    coordinatorAgentId: string;
    sourceTaskIds: string[];
    runId: string;
    messageId?: string;
    createdAt?: string | null;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  pausedAt?: string | null;
  cancelledAt?: string | null;
  archivedAt?: string | null;
  conversationId?: string;
  activePlanRevisionId?: string | null;
};

export type CollaborationTask = {
  id: string;
  workflowId: string;
  assigneeAgentId?: string | null;
  status: CollaborationTaskStatus;
  activity?: {
    phase: CollaborationTaskActivityPhase;
    revision: number;
    kind?: RunActivityKind;
    displayName?: string;
    target?: string;
    upstreamAgentNames?: string[];
    changedAt: string;
    waitingSince?: string;
    sourceEventId?: string;
    runId?: string;
  };
  acceptanceState?: 'pending' | 'accepted' | 'rejected';
  leaseToken?: string;
  leaseExpiresAt?: string | null;
};

export type CollaborationIntervention = {
  id: string;
  workflowId: string;
  taskId?: string;
  targetAgentId?: string;
  status: CollaborationInterventionStatus;
  message: string;
  idempotencyKey?: string;
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
