export type ApiError = {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
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

export type RunActivityKind = 'read' | 'search' | 'edit' | 'write' | 'command' | 'web' | 'skill' | 'collaboration' | 'other';
export type RunActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type RunActivityItem = {
  id: string;
  kind: RunActivityKind;
  status: RunActivityStatus;
  toolName: string;
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
  installMode: 'desktop-release' | 'source';
  error?: string;
};

export type RuntimePlatform = 'mac-arm64' | 'mac-x64' | 'win-arm64' | 'win-x64' | 'linux-arm64' | 'linux-x64';
