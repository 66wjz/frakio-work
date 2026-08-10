import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { reduceRunPresentation } from './presentation.mjs';

const SCHEMA_VERSION = 19;
const MAX_RUNTIME_EVENT_BYTES = 256 * 1024;
const WORK_TASK_STATUSES = new Set([
  'pending_confirmation', 'ready', 'waiting_dependency', 'running', 'waiting_input',
  'review', 'completed', 'failed', 'paused', 'cancelled',
]);

function canonicalWorkTaskStatus(value) {
  const requested = String(value || 'pending_confirmation');
  const legacy = {
    planned: 'pending_confirmation',
    triage: 'pending_confirmation',
    todo: 'ready',
    scheduled: 'ready',
    blocked: 'waiting_dependency',
    needs_input: 'waiting_input',
    done: 'completed',
  }[requested];
  const status = legacy || requested;
  if (!WORK_TASK_STATUSES.has(status)) {
    throw Object.assign(new Error(`Unsupported Work Task status: ${requested}`), {
      status: 400,
      code: 'WORK_TASK_STATUS_INVALID',
    });
  }
  return status;
}

function timestamp() {
  return new Date().toISOString();
}

function json(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

function encode(value) {
  return JSON.stringify(value ?? {});
}

function boundedRuntimeEventPayload(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const encoded = encode(payload);
  if (Buffer.byteLength(encoded) <= MAX_RUNTIME_EVENT_BYTES) return payload;
  const next = { ...payload, truncated: true, originalBytes: Buffer.byteLength(encoded) };
  for (const key of ['delta', 'output', 'content', 'result', 'detail']) {
    if (typeof next[key] === 'string') next[key] = next[key].slice(0, 180000);
  }
  const bounded = encode(next);
  return Buffer.byteLength(bounded) <= MAX_RUNTIME_EVENT_BYTES
    ? next
    : { truncated: true, originalBytes: Buffer.byteLength(encoded), preview: bounded.slice(0, 180000) };
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

export function createRuntimeStore(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  const legacySessionColumns = new Set(db.prepare('PRAGMA table_info(runtime_sessions)').all().map((column) => column.name));
  const hasSchemaMeta = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").get());
  const storedSchemaVersion = hasSchemaMeta
    ? Number(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value || 0)
    : legacySessionColumns.size ? 4 : 0;
  let migrationBackupPath = '';
  if (storedSchemaVersion > 0 && storedSchemaVersion < SCHEMA_VERSION) {
    migrationBackupPath = `${filePath}.schema-v${storedSchemaVersion}-${Date.now()}.bak`;
    db.exec(`VACUUM INTO '${migrationBackupPath.replaceAll("'", "''")}'`);
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_sessions (
      id TEXT PRIMARY KEY,
      runtime_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '',
      lane_type TEXT NOT NULL DEFAULT 'chat',
      lane_id TEXT NOT NULL DEFAULT '',
      worktree_id TEXT NOT NULL DEFAULT '',
      native_session_id TEXT NOT NULL DEFAULT '',
      execution_realm_revision TEXT NOT NULL DEFAULT '',
      model_route_revision TEXT NOT NULL DEFAULT '',
      profile_revision TEXT NOT NULL DEFAULT '',
      lifecycle_state TEXT NOT NULL DEFAULT 'parked',
      context_watermark TEXT NOT NULL DEFAULT '',
      skill_set_revision TEXT NOT NULL DEFAULT '',
      permission_policy_revision TEXT NOT NULL DEFAULT '',
      capability_snapshot_json TEXT NOT NULL DEFAULT '{}',
      resume_strategy TEXT NOT NULL DEFAULT '',
      checkpoint_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(thread_id, agent_id, runtime_id, workspace_id, lane_type, lane_id)
    );
    CREATE INDEX IF NOT EXISTS runtime_sessions_thread_idx ON runtime_sessions(thread_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      native_run_id TEXT NOT NULL DEFAULT '',
      native_turn_id TEXT NOT NULL DEFAULT '',
      last_native_event_sequence INTEGER NOT NULL DEFAULT 0,
      execution_realm_revision TEXT NOT NULL DEFAULT '',
      model_route_revision TEXT NOT NULL DEFAULT '',
      profile_revision TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      engine_id TEXT NOT NULL DEFAULT '',
      harness_id TEXT NOT NULL DEFAULT '',
      parent_run_id TEXT NOT NULL DEFAULT '',
      route_id TEXT NOT NULL DEFAULT '',
      failure_class TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'opening',
      stop_requested_at TEXT,
      error TEXT NOT NULL DEFAULT '',
      context_watermark_from TEXT NOT NULL DEFAULT '',
      context_watermark_to TEXT NOT NULL DEFAULT '',
      skill_set_revision TEXT NOT NULL DEFAULT '',
      permission_policy_revision TEXT NOT NULL DEFAULT '',
      permission_coverage TEXT NOT NULL DEFAULT '',
      receipt_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(session_id) REFERENCES runtime_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS runtime_runs_thread_idx ON runtime_runs(thread_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_events (
      id TEXT PRIMARY KEY,
      cursor INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      native_event_key TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, cursor),
      FOREIGN KEY(run_id) REFERENCES runtime_runs(id),
      FOREIGN KEY(session_id) REFERENCES runtime_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS runtime_events_run_idx ON runtime_events(run_id, cursor);
    CREATE TABLE IF NOT EXISTS runtime_run_presentations (
      run_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      last_cursor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'opening',
      content TEXT NOT NULL DEFAULT '',
      activity_groups_json TEXT NOT NULL DEFAULT '[]',
      approval_json TEXT,
      clarification_json TEXT,
      compaction_json TEXT,
      error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runtime_runs(id)
    );
    CREATE TABLE IF NOT EXISTS context_checkpoints (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      operation_id TEXT NOT NULL DEFAULT '',
      through_cursor INTEGER NOT NULL DEFAULT 0,
      retained_from_cursor INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      source_runtime_id TEXT NOT NULL,
      source_model_id TEXT NOT NULL DEFAULT '',
      trigger TEXT NOT NULL,
      tokens_before INTEGER,
      tokens_after_estimate INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS context_checkpoints_thread_idx ON context_checkpoints(thread_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_capability_snapshots (
      runtime_id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      checked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_build_capability_snapshots (
      runtime_id TEXT NOT NULL,
      runtime_build_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      checked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY(runtime_id, runtime_build_id)
    );
    CREATE TABLE IF NOT EXISTS runtime_packages (
      runtime_id TEXT NOT NULL,
      runtime_version TEXT NOT NULL,
      runtime_build_id TEXT NOT NULL PRIMARY KEY,
      source TEXT NOT NULL,
      runtime_dir TEXT NOT NULL DEFAULT '',
      executable_path TEXT NOT NULL DEFAULT '',
      package_root TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      arch TEXT NOT NULL DEFAULT '',
      artifact_digest TEXT NOT NULL DEFAULT '',
      adapter_protocol_version INTEGER NOT NULL DEFAULT 1,
      installation_state TEXT NOT NULL DEFAULT 'available',
      verification_state TEXT NOT NULL DEFAULT 'unverified',
      availability TEXT NOT NULL DEFAULT 'unavailable',
      last_verified_at TEXT,
      verification_receipt_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      installed_at TEXT NOT NULL,
      verified_at TEXT,
      last_used_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runtime_packages_runtime_idx ON runtime_packages(runtime_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_activations (
      runtime_id TEXT PRIMARY KEY,
      active_build_id TEXT NOT NULL DEFAULT '',
      previous_build_id TEXT NOT NULL DEFAULT '',
      activation_revision TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_capability_snapshots (
      profile TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      configuration_revision TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_packages (
      id TEXT NOT NULL,
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      scope TEXT NOT NULL,
      subject_id TEXT NOT NULL DEFAULT '',
      source_agent_id TEXT NOT NULL DEFAULT '',
      compatible_runtime_ids_json TEXT NOT NULL DEFAULT '[]',
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      permission_intents_json TEXT NOT NULL DEFAULT '[]',
      entry_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY(id, version)
    );
    CREATE TABLE IF NOT EXISTS skill_bindings (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      skill_version TEXT NOT NULL,
      scope TEXT NOT NULL,
      subject_id TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(skill_id, scope, subject_id)
    );
    CREATE TABLE IF NOT EXISTS skill_applications (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      skill_version TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      load_method TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(skill_id, skill_version, runtime_id, agent_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS skill_applications_session_idx ON skill_applications(session_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS permission_grants (
      id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      action_pattern TEXT NOT NULL DEFAULT '',
      target_prefix TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'agent_workspace',
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      normalized_fact TEXT NOT NULL,
      fact TEXT NOT NULL,
      provenance_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'candidate',
      valid_from TEXT,
      valid_until TEXT,
      supersedes_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_entries_lookup_idx ON memory_entries(scope, subject_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS memory_review_jobs (
      id TEXT PRIMARY KEY,
      trigger_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'chat_turn',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      model_snapshot_json TEXT NOT NULL DEFAULT '{}',
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_review_jobs_status_idx ON memory_review_jobs(status, next_attempt_at, updated_at);
    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'system',
      actor_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'completed',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_events_memory_idx ON memory_events(memory_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS memory_context_receipts (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      runtime_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      query TEXT NOT NULL DEFAULT '',
      memory_revision TEXT NOT NULL DEFAULT '',
      included_json TEXT NOT NULL DEFAULT '[]',
      excluded_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_context_receipts_thread_idx ON memory_context_receipts(thread_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS thread_context_events (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      cursor INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'system',
      actor_id TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      source_revision INTEGER NOT NULL DEFAULT 1,
      parent_event_id TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public',
      scope TEXT NOT NULL DEFAULT 'thread',
      authority TEXT NOT NULL DEFAULT 'inferred',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, cursor),
      UNIQUE(thread_id, source_id, event_type, source_revision)
    );
    CREATE INDEX IF NOT EXISTS thread_context_events_thread_idx ON thread_context_events(thread_id, cursor);
    CREATE TABLE IF NOT EXISTS thread_state_snapshots (
      thread_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      through_cursor INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_receipts (
      id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL DEFAULT '',
      packet_hash TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      runtime_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      schema_version INTEGER NOT NULL DEFAULT 2,
      state_revision INTEGER NOT NULL DEFAULT 0,
      cursor_from INTEGER NOT NULL DEFAULT 0,
      cursor_to INTEGER NOT NULL DEFAULT 0,
      delivery_mode TEXT NOT NULL DEFAULT 'frakio_full',
      budget_json TEXT NOT NULL DEFAULT '{}',
      included_json TEXT NOT NULL DEFAULT '[]',
      excluded_json TEXT NOT NULL DEFAULT '[]',
      conflicts_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      source_receipt_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS context_receipts_thread_idx ON context_receipts(thread_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS hermes_projections (
      profile_name TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT '',
      agent_revision TEXT NOT NULL DEFAULT '',
      memory_revision TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      files_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      generated_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_commits (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      vault_id TEXT NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      operation TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_commits_workspace_idx ON knowledge_commits(workspace_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS work_tasks (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_agent_id TEXT,
      runtime_id TEXT,
      runtime_session_id TEXT,
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending_confirmation',
      acceptance_state TEXT NOT NULL DEFAULT 'pending',
      attempt INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT,
      idempotency_key TEXT NOT NULL,
      worktree_path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workflow_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS work_tasks_workflow_idx ON work_tasks(workflow_id, status, updated_at);
    CREATE TABLE IF NOT EXISTS collaboration_workflows (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      coordinator_agent_id TEXT NOT NULL DEFAULT '',
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      active_plan_revision_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collaboration_workflows_conversation_idx ON collaboration_workflows(conversation_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS collaboration_dependencies (
      parent_task_id TEXT NOT NULL,
      child_task_id TEXT NOT NULL,
      created_by_task_id TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY(parent_task_id, child_task_id)
    );
    CREATE INDEX IF NOT EXISTS collaboration_dependencies_child_idx ON collaboration_dependencies(child_task_id, created_at);
    CREATE TABLE IF NOT EXISTS collaboration_plan_revisions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(workflow_id, revision)
    );
    CREATE TABLE IF NOT EXISTS workflow_proposals (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      workflow_id TEXT,
      source_plan_id TEXT,
      proposal_message_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      purpose TEXT NOT NULL DEFAULT 'collaboration',
      status TEXT NOT NULL DEFAULT 'pending_confirmation',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL,
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS workflow_proposals_conversation_idx ON workflow_proposals(conversation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS workflow_proposals_workflow_idx ON workflow_proposals(workflow_id, revision, updated_at DESC);
    CREATE TABLE IF NOT EXISTS collaboration_interventions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      task_id TEXT,
      target_agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      message TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workflow_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS collaboration_artifacts (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      task_id TEXT,
      path TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      published_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(workflow_id, task_id, path)
    );
    CREATE TABLE IF NOT EXISTS collaboration_events (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      task_id TEXT,
      run_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collaboration_events_workflow_idx ON collaboration_events(workflow_id, cursor);
    CREATE TABLE IF NOT EXISTS inbox_items (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL,
      workflow_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal',
      action_required INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      resolved_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inbox_items_workspace_idx ON inbox_items(workspace_id, action_required DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS inbox_items_thread_idx ON inbox_items(thread_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS task_run_bindings (
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      lease_token TEXT NOT NULL DEFAULT '',
      bound_at TEXT NOT NULL,
      ended_at TEXT,
      PRIMARY KEY(task_id, run_id)
    );
    CREATE TABLE IF NOT EXISTS vault_documents (
      vault_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      document_type TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      frontmatter_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(vault_id, relative_path)
    );
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '',
      relative_path TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS knowledge_sources_vault_idx ON knowledge_sources(vault_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS knowledge_jobs (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      trigger_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'maintenance',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      model_snapshot_json TEXT NOT NULL DEFAULT '{}',
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(vault_id, trigger_key)
    );
    CREATE INDEX IF NOT EXISTS knowledge_jobs_queue_idx ON knowledge_jobs(vault_id, status, next_attempt_at, updated_at);
    CREATE TABLE IF NOT EXISTS knowledge_operations (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'change_set',
      status TEXT NOT NULL DEFAULT 'proposed',
      summary TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT 'normal',
      requires_review INTEGER NOT NULL DEFAULT 1,
      actor_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      rejected_at TEXT,
      rolled_back_at TEXT
    );
    CREATE INDEX IF NOT EXISTS knowledge_operations_vault_idx ON knowledge_operations(vault_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS knowledge_operation_files (
      operation_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'write',
      base_hash TEXT NOT NULL DEFAULT '',
      before_hash TEXT NOT NULL DEFAULT '',
      after_hash TEXT NOT NULL DEFAULT '',
      before_content TEXT,
      after_content TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(operation_id, relative_path),
      FOREIGN KEY(operation_id) REFERENCES knowledge_operations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS vault_links (
      vault_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'wikilink',
      PRIMARY KEY(vault_id, source_path, target_path, link_type)
    );
    CREATE INDEX IF NOT EXISTS vault_links_target_idx ON vault_links(vault_id, target_path);
    CREATE TABLE IF NOT EXISTS knowledge_issues (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      relative_path TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_issues_vault_idx ON knowledge_issues(vault_id, status, severity, updated_at DESC);
  `);
  const vaultDocumentColumns = new Set(db.prepare('PRAGMA table_info(vault_documents)').all().map((column) => column.name));
  const workTaskColumns = new Set(db.prepare('PRAGMA table_info(work_tasks)').all().map((column) => column.name));
  const workflowProposalColumns = new Set(db.prepare('PRAGMA table_info(workflow_proposals)').all().map((column) => column.name));
  if (!workflowProposalColumns.has('proposal_message_id')) db.exec("ALTER TABLE workflow_proposals ADD COLUMN proposal_message_id TEXT");
  if (!workTaskColumns.has('acceptance_state')) db.exec("ALTER TABLE work_tasks ADD COLUMN acceptance_state TEXT NOT NULL DEFAULT 'pending'");
  if (!workTaskColumns.has('lease_token')) db.exec("ALTER TABLE work_tasks ADD COLUMN lease_token TEXT NOT NULL DEFAULT ''");
  for (const [column, definition] of Object.entries({
    title: "TEXT NOT NULL DEFAULT ''",
    document_type: "TEXT NOT NULL DEFAULT ''",
    content_hash: "TEXT NOT NULL DEFAULT ''",
    frontmatter_json: "TEXT NOT NULL DEFAULT '{}'",
    tags_json: "TEXT NOT NULL DEFAULT '[]'",
    confidence: "TEXT NOT NULL DEFAULT ''",
    sources_json: "TEXT NOT NULL DEFAULT '[]'",
  })) {
    if (!vaultDocumentColumns.has(column)) db.exec(`ALTER TABLE vault_documents ADD COLUMN ${column} ${definition}`);
  }
  const sessionColumns = new Set(db.prepare('PRAGMA table_info(runtime_sessions)').all().map((column) => column.name));
  if (!sessionColumns.has('lane_type')) {
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS runtime_sessions_v5;
        CREATE TABLE runtime_sessions_v5 (
          id TEXT PRIMARY KEY,
          runtime_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT '',
          lane_type TEXT NOT NULL DEFAULT 'chat',
          lane_id TEXT NOT NULL DEFAULT '',
          worktree_id TEXT NOT NULL DEFAULT '',
          native_session_id TEXT NOT NULL DEFAULT '',
          profile_revision TEXT NOT NULL DEFAULT '',
          lifecycle_state TEXT NOT NULL DEFAULT 'parked',
          context_watermark TEXT NOT NULL DEFAULT '',
          skill_set_revision TEXT NOT NULL DEFAULT '',
          permission_policy_revision TEXT NOT NULL DEFAULT '',
          capability_snapshot_json TEXT NOT NULL DEFAULT '{}',
          resume_strategy TEXT NOT NULL DEFAULT '',
          checkpoint_json TEXT NOT NULL DEFAULT '{}',
          last_error TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'idle',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(thread_id, agent_id, runtime_id, workspace_id, lane_type, lane_id)
        );
        INSERT INTO runtime_sessions_v5(
          id, runtime_id, thread_id, agent_id, workspace_id, lane_type, lane_id, native_session_id,
          profile_revision, lifecycle_state, status, metadata_json, created_at, updated_at
        )
        SELECT id, runtime_id, thread_id, agent_id, workspace_id, 'chat', thread_id, native_session_id,
          profile_revision,
          CASE status WHEN 'active' THEN 'recovering' WHEN 'closed' THEN 'closed' WHEN 'failed' THEN 'failed' ELSE 'parked' END,
          status, metadata_json, created_at, updated_at
        FROM runtime_sessions;
        DROP TABLE runtime_sessions;
        ALTER TABLE runtime_sessions_v5 RENAME TO runtime_sessions;
        CREATE INDEX runtime_sessions_thread_idx ON runtime_sessions(thread_id, updated_at DESC);
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }
  const runColumns = new Set(db.prepare('PRAGMA table_info(runtime_runs)').all().map((column) => column.name));
  const runColumnMigrations = [
    ['context_watermark_from', "TEXT NOT NULL DEFAULT ''"],
    ['context_watermark_to', "TEXT NOT NULL DEFAULT ''"],
    ['skill_set_revision', "TEXT NOT NULL DEFAULT ''"],
    ['permission_policy_revision', "TEXT NOT NULL DEFAULT ''"],
    ['permission_coverage', "TEXT NOT NULL DEFAULT ''"],
    ['receipt_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['runtime_version', "TEXT NOT NULL DEFAULT ''"],
    ['runtime_build_id', "TEXT NOT NULL DEFAULT ''"],
    ['activation_revision', "TEXT NOT NULL DEFAULT ''"],
    ['native_run_id', "TEXT NOT NULL DEFAULT ''"],
    ['native_turn_id', "TEXT NOT NULL DEFAULT ''"],
    ['last_native_event_sequence', 'INTEGER NOT NULL DEFAULT 0'],
    ['execution_realm_revision', "TEXT NOT NULL DEFAULT ''"],
    ['model_route_revision', "TEXT NOT NULL DEFAULT ''"],
    ['phase', "TEXT NOT NULL DEFAULT 'opening'"],
    ['stop_requested_at', 'TEXT'],
    ['engine_id', "TEXT NOT NULL DEFAULT ''"],
    ['harness_id', "TEXT NOT NULL DEFAULT ''"],
    ['parent_run_id', "TEXT NOT NULL DEFAULT ''"],
    ['route_id', "TEXT NOT NULL DEFAULT ''"],
    ['failure_class', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [column, definition] of runColumnMigrations) {
    if (!runColumns.has(column)) db.exec(`ALTER TABLE runtime_runs ADD COLUMN ${column} ${definition}`);
  }
  const sessionVersionColumns = new Set(db.prepare('PRAGMA table_info(runtime_sessions)').all().map((column) => column.name));
  for (const [column, definition] of [
    ['runtime_version', "TEXT NOT NULL DEFAULT ''"],
    ['runtime_build_id', "TEXT NOT NULL DEFAULT ''"],
    ['activation_revision', "TEXT NOT NULL DEFAULT ''"],
    ['execution_realm_revision', "TEXT NOT NULL DEFAULT ''"],
    ['model_route_revision', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!sessionVersionColumns.has(column)) db.exec(`ALTER TABLE runtime_sessions ADD COLUMN ${column} ${definition}`);
  }
  const eventColumns = new Set(db.prepare('PRAGMA table_info(runtime_events)').all().map((column) => column.name));
  if (!eventColumns.has('native_event_key')) db.exec("ALTER TABLE runtime_events ADD COLUMN native_event_key TEXT NOT NULL DEFAULT ''");
  if (!eventColumns.has('runtime_version')) db.exec("ALTER TABLE runtime_events ADD COLUMN runtime_version TEXT NOT NULL DEFAULT ''");
  if (!eventColumns.has('runtime_build_id')) db.exec("ALTER TABLE runtime_events ADD COLUMN runtime_build_id TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS runtime_events_native_key_idx ON runtime_events(run_id, native_event_key) WHERE native_event_key != '';");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_run_presentations (
      run_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      last_cursor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'opening',
      content TEXT NOT NULL DEFAULT '',
      activity_groups_json TEXT NOT NULL DEFAULT '[]',
      approval_json TEXT,
      clarification_json TEXT,
      compaction_json TEXT,
      error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runtime_runs(id)
    );
  `);
  const runtimePackageVersionIndex = db.prepare('PRAGMA index_list(runtime_packages)').all().find((index) => {
    if (!index.unique) return false;
    const columns = db.prepare(`PRAGMA index_info('${String(index.name).replaceAll("'", "''")}')`).all().map((entry) => entry.name);
    return columns.join(',') === 'runtime_id,runtime_version,source,platform,arch';
  });
  if (runtimePackageVersionIndex) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE runtime_packages_v8 (
        runtime_id TEXT NOT NULL,
        runtime_version TEXT NOT NULL,
        runtime_build_id TEXT NOT NULL PRIMARY KEY,
        source TEXT NOT NULL,
        runtime_dir TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        arch TEXT NOT NULL DEFAULT '',
        artifact_digest TEXT NOT NULL DEFAULT '',
        adapter_protocol_version INTEGER NOT NULL DEFAULT 1,
        installation_state TEXT NOT NULL DEFAULT 'available',
        verification_state TEXT NOT NULL DEFAULT 'unverified',
        verification_receipt_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        installed_at TEXT NOT NULL,
        verified_at TEXT,
        last_used_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO runtime_packages_v8 SELECT * FROM runtime_packages;
      DROP TABLE runtime_packages;
      ALTER TABLE runtime_packages_v8 RENAME TO runtime_packages;
      CREATE INDEX runtime_packages_runtime_idx ON runtime_packages(runtime_id, updated_at DESC);
      COMMIT;
    `);
  }
  const packageColumns = new Set(db.prepare('PRAGMA table_info(runtime_packages)').all().map((column) => column.name));
  for (const [column, definition] of [
    ['executable_path', "TEXT NOT NULL DEFAULT ''"],
    ['package_root', "TEXT NOT NULL DEFAULT ''"],
    ['fingerprint', "TEXT NOT NULL DEFAULT ''"],
    ['availability', "TEXT NOT NULL DEFAULT 'unavailable'"],
    ['last_verified_at', 'TEXT'],
  ]) {
    if (!packageColumns.has(column)) db.exec(`ALTER TABLE runtime_packages ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vault_documents_fts USING fts5(vault_id UNINDEXED, relative_path, content, updated_at UNINDEXED, tokenize='unicode61');`);
  const memoryColumns = new Set(db.prepare('PRAGMA table_info(memory_entries)').all().map((column) => column.name));
  const memoryColumnMigrations = [
    ['kind', "TEXT NOT NULL DEFAULT 'fact'"],
    ['origin', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['source_agent_id', "TEXT NOT NULL DEFAULT ''"],
    ['thread_id', "TEXT NOT NULL DEFAULT ''"],
    ['vault_id', "TEXT NOT NULL DEFAULT ''"],
    ['source_hash', "TEXT NOT NULL DEFAULT ''"],
    ['reason', "TEXT NOT NULL DEFAULT ''"],
    ['status_reason', "TEXT NOT NULL DEFAULT ''"],
    ['paused_at', 'TEXT'],
    ['sync_vault_id', "TEXT NOT NULL DEFAULT ''"],
    ['sync_relative_path', "TEXT NOT NULL DEFAULT ''"],
    ['sync_block_hash', "TEXT NOT NULL DEFAULT ''"],
    ['sync_state', "TEXT NOT NULL DEFAULT 'none'"],
    ['synced_at', 'TEXT'],
    ['source_runtime_id', "TEXT NOT NULL DEFAULT ''"],
    ['source_session_id', "TEXT NOT NULL DEFAULT ''"],
    ['source_message_id', "TEXT NOT NULL DEFAULT ''"],
    ['created_revision', "TEXT NOT NULL DEFAULT ''"],
    ['last_recalled_at', 'TEXT'],
    ['recall_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['deleted_at', 'TEXT'],
    ['deletion_reason', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [column, definition] of memoryColumnMigrations) {
    if (!memoryColumns.has(column)) db.exec(`ALTER TABLE memory_entries ADD COLUMN ${column} ${definition}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS memory_entries_source_hash_idx ON memory_entries(source_hash, status, updated_at DESC);');
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_agent_harness_bindings (
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'thread_created',
      binding_revision INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(thread_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS thread_agent_harness_bindings_thread_idx ON thread_agent_harness_bindings(thread_id);
    CREATE TABLE IF NOT EXISTS agent_context_cursors (
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      event_cursor INTEGER NOT NULL DEFAULT 0,
      state_revision INTEGER NOT NULL DEFAULT 0,
      profile_revision TEXT NOT NULL DEFAULT '',
      memory_revision TEXT NOT NULL DEFAULT '',
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(thread_id, agent_id, harness_id)
    );
  `);
  if (storedSchemaVersion > 0 && storedSchemaVersion < 18) {
    db.exec(`
      UPDATE work_tasks SET status='pending_confirmation' WHERE status IN ('planned', 'triage');
      UPDATE work_tasks SET status='waiting_dependency' WHERE status='blocked';
      UPDATE work_tasks SET status='waiting_input' WHERE status='needs_input';
      UPDATE work_tasks SET status='ready' WHERE status IN ('todo', 'scheduled');
      UPDATE work_tasks SET status='completed' WHERE status='done';
    `);
  }
  db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));

  const mapSession = (row) => row && ({
    id: row.id,
    runtimeId: row.runtime_id,
    runtimeVersion: row.runtime_version || '',
    runtimeBuildId: row.runtime_build_id || '',
    activationRevision: row.activation_revision || '',
    threadId: row.thread_id,
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    laneType: row.lane_type || 'chat',
    laneId: row.lane_id || row.thread_id,
    worktreeId: row.worktree_id || '',
    nativeSessionId: row.native_session_id,
    executionRealmRevision: row.execution_realm_revision || '',
    modelRouteRevision: row.model_route_revision || '',
    profileRevision: row.profile_revision,
    lifecycleState: row.lifecycle_state || (row.status === 'active' ? 'active' : row.status === 'failed' ? 'failed' : row.status === 'closed' ? 'closed' : 'parked'),
    contextWatermark: row.context_watermark || '',
    skillSetRevision: row.skill_set_revision || '',
    permissionPolicyRevision: row.permission_policy_revision || '',
    capabilitySnapshot: json(row.capability_snapshot_json),
    resumeStrategy: row.resume_strategy || '',
    checkpoint: json(row.checkpoint_json),
    lastError: row.last_error || '',
    status: row.status,
    metadata: json(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const mapRun = (row) => row && ({
    id: row.id,
    sessionId: row.session_id,
    runtimeId: row.runtime_id,
    runtimeVersion: row.runtime_version || '',
    runtimeBuildId: row.runtime_build_id || '',
    activationRevision: row.activation_revision || '',
    threadId: row.thread_id,
    agentId: row.agent_id,
    turnId: row.turn_id,
    nativeRunId: row.native_run_id || '',
    nativeTurnId: row.native_turn_id || '',
    lastNativeEventSequence: Number(row.last_native_event_sequence || 0),
    executionRealmRevision: row.execution_realm_revision || '',
    modelRouteRevision: row.model_route_revision || '',
    profileRevision: row.profile_revision,
    modelId: row.model_id,
    engineId: row.engine_id || row.runtime_id,
    harnessId: row.harness_id || (row.runtime_id === 'pi' ? 'native' : row.runtime_id),
    parentRunId: row.parent_run_id || '',
    routeId: row.route_id || '',
    failureClass: row.failure_class || '',
    status: row.status,
    phase: row.phase || 'opening',
    stopRequestedAt: row.stop_requested_at || null,
    error: row.error,
    contextWatermarkFrom: row.context_watermark_from || '',
    contextWatermarkTo: row.context_watermark_to || '',
    skillSetRevision: row.skill_set_revision || '',
    permissionPolicyRevision: row.permission_policy_revision || '',
    permissionCoverage: row.permission_coverage || '',
    receipt: json(row.receipt_json),
    metadata: json(row.metadata_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  });

  const mapEvent = (row) => row && ({
    id: row.id,
    cursor: Number(row.cursor),
    runId: row.run_id,
    sessionId: row.session_id,
    runtimeId: row.runtime_id,
    runtimeVersion: row.runtime_version || '',
    runtimeBuildId: row.runtime_build_id || '',
    nativeEventKey: row.native_event_key || '',
    type: row.type,
    payload: json(row.payload_json),
    createdAt: row.created_at,
  });

  const mapCheckpoint = (row) => row && ({
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id || '',
    operationId: row.operation_id || '',
    throughCursor: Number(row.through_cursor || 0),
    retainedFromCursor: Number(row.retained_from_cursor || 0),
    summary: row.summary,
    sourceRuntimeId: row.source_runtime_id,
    sourceModelId: row.source_model_id || '',
    trigger: row.trigger,
    tokensBefore: row.tokens_before === null ? undefined : Number(row.tokens_before),
    tokensAfterEstimate: row.tokens_after_estimate === null ? undefined : Number(row.tokens_after_estimate),
    version: Number(row.version || 1),
    createdAt: row.created_at,
  });

  const mapMemory = (row) => row && ({
    id: row.id,
    scope: row.scope,
    subjectId: row.subject_id,
    kind: row.kind || 'fact',
    origin: row.origin || 'unknown',
    sourceAgentId: row.source_agent_id || '',
    threadId: row.thread_id || '',
    vaultId: row.vault_id || '',
    sourceHash: row.source_hash || '',
    sourceRuntimeId: row.source_runtime_id || '',
    sourceSessionId: row.source_session_id || '',
    sourceMessageId: row.source_message_id || '',
    createdRevision: row.created_revision || '',
    fact: row.fact,
    reason: row.reason || '',
    statusReason: row.status_reason || '',
    provenance: json(row.provenance_json, []),
    confidence: Number(row.confidence),
    status: row.status,
    pausedAt: row.paused_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    supersedesId: row.supersedes_id,
    lastRecalledAt: row.last_recalled_at,
    recallCount: Number(row.recall_count || 0),
    deletedAt: row.deleted_at,
    deletionReason: row.deletion_reason || '',
    sync: {
      vaultId: row.sync_vault_id || '',
      relativePath: row.sync_relative_path || '',
      blockHash: row.sync_block_hash || '',
      state: row.sync_state || 'none',
      syncedAt: row.synced_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const mapMemoryReview = (row) => row && ({
    id: row.id,
    triggerKey: row.trigger_key,
    threadId: row.thread_id,
    turnId: row.turn_id,
    workflowId: row.workflow_id,
    taskId: row.task_id,
    kind: row.kind,
    status: row.status,
    attempts: Number(row.attempts || 0),
    modelSnapshot: json(row.model_snapshot_json),
    input: json(row.input_json),
    result: json(row.result_json),
    error: row.error || '',
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });

  const mapMemoryEvent = (row) => row && ({
    id: row.id,
    idempotencyKey: row.idempotency_key,
    memoryId: row.memory_id || '',
    type: row.type,
    actorType: row.actor_type || 'system',
    actorId: row.actor_id || '',
    payload: json(row.payload_json),
    status: row.status,
    error: row.error || '',
    createdAt: row.created_at,
    processedAt: row.processed_at,
  });

  const mapMemoryReceipt = (row) => row && ({
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id || '',
    runtimeId: row.runtime_id || '',
    agentId: row.agent_id || '',
    query: row.query || '',
    memoryRevision: row.memory_revision || '',
    included: json(row.included_json, []),
    excluded: json(row.excluded_json, []),
    createdAt: row.created_at,
  });

  const mapThreadContextEvent = (row) => row && ({
    id: row.id,
    threadId: row.thread_id,
    cursor: Number(row.cursor || 0),
    eventType: row.event_type,
    actorType: row.actor_type || 'system',
    actorId: row.actor_id || '',
    sourceId: row.source_id || '',
    sourceRevision: Number(row.source_revision || 1),
    parentEventId: row.parent_event_id || '',
    visibility: row.visibility || 'public',
    scope: row.scope || 'thread',
    authority: row.authority || 'inferred',
    payload: json(row.payload_json),
    createdAt: row.created_at,
  });

  const mapThreadStateSnapshot = (row) => row && ({
    threadId: row.thread_id,
    revision: Number(row.revision || 0),
    throughCursor: Number(row.through_cursor || 0),
    state: json(row.state_json),
    contentHash: row.content_hash || '',
    status: row.status || 'ready',
    error: row.error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const mapContextReceipt = (row) => row && ({
    id: row.id,
    packetId: row.packet_id || '',
    packetHash: row.packet_hash || '',
    threadId: row.thread_id,
    runId: row.run_id || '',
    runtimeId: row.runtime_id || '',
    agentId: row.agent_id || '',
    schemaVersion: Number(row.schema_version || 2),
    stateRevision: Number(row.state_revision || 0),
    cursor: { from: Number(row.cursor_from || 0), to: Number(row.cursor_to || 0) },
    deliveryMode: row.delivery_mode || 'frakio_full',
    budget: json(row.budget_json),
    included: json(row.included_json, []),
    excluded: json(row.excluded_json, []),
    conflicts: json(row.conflicts_json, []),
    warnings: json(row.warnings_json, []),
    sourceReceiptIds: json(row.source_receipt_ids_json, []),
    createdAt: row.created_at,
  });

  const mapHermesProjection = (row) => row && ({
    profileName: row.profile_name,
    agentId: row.agent_id || '',
    agentRevision: row.agent_revision || '',
    memoryRevision: row.memory_revision || '',
    contentHash: row.content_hash || '',
    files: json(row.files_json),
    status: row.status,
    error: row.error || '',
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  });

  const mapKnowledgeSource = (row) => row && ({
    id: row.id,
    vaultId: row.vault_id,
    kind: row.kind,
    title: row.title,
    origin: row.origin,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    status: row.status,
    metadata: json(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
  });

  const mapKnowledgeJob = (row) => row && ({
    id: row.id,
    vaultId: row.vault_id,
    triggerKey: row.trigger_key,
    kind: row.kind,
    status: row.status,
    attempts: Number(row.attempts || 0),
    modelSnapshot: json(row.model_snapshot_json),
    input: json(row.input_json),
    result: json(row.result_json),
    error: row.error,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });

  const mapKnowledgeOperation = (row) => row && ({
    id: row.id,
    vaultId: row.vault_id,
    jobId: row.job_id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    risk: row.risk,
    requiresReview: Boolean(row.requires_review),
    actor: json(row.actor_json),
    metadata: json(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    rejectedAt: row.rejected_at,
    rolledBackAt: row.rolled_back_at,
  });

  const mapKnowledgeOperationFile = (row) => row && ({
    operationId: row.operation_id,
    relativePath: row.relative_path,
    action: row.action,
    baseHash: row.base_hash,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    beforeContent: row.before_content,
    afterContent: row.after_content,
    metadata: json(row.metadata_json),
  });

  const mapKnowledgeIssue = (row) => row && ({
    id: row.id,
    vaultId: row.vault_id,
    code: row.code,
    severity: row.severity,
    relativePath: row.relative_path,
    message: row.message,
    metadata: json(row.metadata_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const api = {
    filePath,
    migrationBackupPath,
    schemaVersion: SCHEMA_VERSION,
    close() {
      db.close();
    },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(api);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    upsertSession(input) {
      const current = timestamp();
      const laneType = input.laneType === 'work_task' ? 'work_task' : 'chat';
      const laneId = String(input.laneId || (laneType === 'chat' ? input.threadId : ''));
      const existing = db.prepare(`
        SELECT * FROM runtime_sessions
        WHERE thread_id = ? AND agent_id = ? AND runtime_id = ? AND workspace_id = ? AND lane_type = ? AND lane_id = ?
      `).get(input.threadId, input.agentId, input.runtimeId, input.workspaceId || '', laneType, laneId);
      const id = existing?.id || input.id || `runtime_session_${randomUUID()}`;
      const createdAt = existing?.created_at || input.createdAt || current;
      db.prepare(`
        INSERT INTO runtime_sessions(
          id, runtime_id, thread_id, agent_id, workspace_id, lane_type, lane_id, worktree_id, native_session_id,
          execution_realm_revision, model_route_revision,
          profile_revision, lifecycle_state, context_watermark, skill_set_revision, permission_policy_revision,
          capability_snapshot_json, resume_strategy, checkpoint_json, last_error, status, metadata_json,
          runtime_version, runtime_build_id, activation_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          worktree_id=excluded.worktree_id,
          native_session_id=excluded.native_session_id,
          execution_realm_revision=excluded.execution_realm_revision,
          model_route_revision=excluded.model_route_revision,
          profile_revision=excluded.profile_revision,
          lifecycle_state=excluded.lifecycle_state,
          context_watermark=excluded.context_watermark,
          skill_set_revision=excluded.skill_set_revision,
          permission_policy_revision=excluded.permission_policy_revision,
          capability_snapshot_json=excluded.capability_snapshot_json,
          resume_strategy=excluded.resume_strategy,
          checkpoint_json=excluded.checkpoint_json,
          last_error=excluded.last_error,
          status=excluded.status,
          metadata_json=excluded.metadata_json,
          runtime_version=excluded.runtime_version,
          runtime_build_id=excluded.runtime_build_id,
          activation_revision=excluded.activation_revision,
          updated_at=excluded.updated_at
      `).run(
        id, input.runtimeId, input.threadId, input.agentId, input.workspaceId || '', laneType, laneId,
        input.worktreeId === undefined ? existing?.worktree_id || '' : String(input.worktreeId || ''),
        input.nativeSessionId === undefined ? existing?.native_session_id || '' : String(input.nativeSessionId || ''),
        input.executionRealmRevision === undefined ? existing?.execution_realm_revision || '' : String(input.executionRealmRevision || ''),
        input.modelRouteRevision === undefined ? existing?.model_route_revision || '' : String(input.modelRouteRevision || ''),
        input.profileRevision || existing?.profile_revision || '',
        input.lifecycleState || existing?.lifecycle_state || (input.status === 'active' ? 'active' : 'parked'),
        input.contextWatermark === undefined ? existing?.context_watermark || '' : String(input.contextWatermark || ''),
        input.skillSetRevision === undefined ? existing?.skill_set_revision || '' : String(input.skillSetRevision || ''),
        input.permissionPolicyRevision === undefined ? existing?.permission_policy_revision || '' : String(input.permissionPolicyRevision || ''),
        encode(input.capabilitySnapshot === undefined ? json(existing?.capability_snapshot_json) : input.capabilitySnapshot),
        input.resumeStrategy === undefined ? existing?.resume_strategy || '' : String(input.resumeStrategy || ''),
        encode(input.checkpoint === undefined ? json(existing?.checkpoint_json) : input.checkpoint),
        input.lastError === undefined ? existing?.last_error || '' : String(input.lastError || ''),
        input.status || existing?.status || 'idle',
        encode({ ...json(existing?.metadata_json), ...(input.metadata || {}) }),
        input.runtimeVersion === undefined ? existing?.runtime_version || '' : String(input.runtimeVersion || ''),
        input.runtimeBuildId === undefined ? existing?.runtime_build_id || '' : String(input.runtimeBuildId || ''),
        input.activationRevision === undefined ? existing?.activation_revision || '' : String(input.activationRevision || ''),
        createdAt, current,
      );
      return api.getSession(id);
    },
    getSession(id) {
      return mapSession(db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(id));
    },
    findSession({ threadId, agentId, runtimeId, workspaceId = '', laneType = 'chat', laneId = '' }) {
      const resolvedLaneId = String(laneId || (laneType === 'chat' ? threadId : ''));
      return mapSession(db.prepare(`
        SELECT * FROM runtime_sessions
        WHERE thread_id = ? AND agent_id = ? AND runtime_id = ? AND workspace_id = ? AND lane_type = ? AND lane_id = ?
      `).get(threadId, agentId, runtimeId, workspaceId, laneType, resolvedLaneId));
    },
    listSessions({ threadId = '', agentId = '', runtimeId = '', laneType = '', laneId = '', limit = 100 } = {}) {
      const clauses = [];
      const args = [];
      if (threadId) { clauses.push('thread_id = ?'); args.push(threadId); }
      if (agentId) { clauses.push('agent_id = ?'); args.push(agentId); }
      if (runtimeId) { clauses.push('runtime_id = ?'); args.push(runtimeId); }
      if (laneType) { clauses.push('lane_type = ?'); args.push(laneType); }
      if (laneId) { clauses.push('lane_id = ?'); args.push(laneId); }
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM runtime_sessions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`)
        .all(...args).map(mapSession);
    },
    createRun(input) {
      const startedAt = input.startedAt || timestamp();
      const id = input.id || `runtime_run_${randomUUID()}`;
      db.prepare(`
        INSERT INTO runtime_runs(
          id, session_id, runtime_id, thread_id, agent_id, turn_id, native_run_id, native_turn_id,
          last_native_event_sequence, execution_realm_revision, model_route_revision, profile_revision,
          model_id, engine_id, harness_id, parent_run_id, route_id, failure_class, status, phase, stop_requested_at, error, context_watermark_from, context_watermark_to, skill_set_revision,
          permission_policy_revision, permission_coverage, receipt_json, metadata_json,
          runtime_version, runtime_build_id, activation_revision, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.sessionId, input.runtimeId, input.threadId, input.agentId, input.turnId,
        input.nativeRunId || '', input.nativeTurnId || '', Math.max(0, Number(input.lastNativeEventSequence || 0)),
        input.executionRealmRevision || '', input.modelRouteRevision || '',
        input.profileRevision || '', input.modelId || '', input.engineId || input.runtimeId || '', input.harnessId || (input.runtimeId === 'pi' ? 'native' : input.runtimeId) || '',
        input.parentRunId || '', input.routeId || '', input.failureClass || '', input.status || 'queued', input.phase || 'opening', input.stopRequestedAt || null,
        input.error || '', input.contextWatermarkFrom || '', input.contextWatermarkTo || '', input.skillSetRevision || '',
        input.permissionPolicyRevision || '', input.permissionCoverage || '', encode(input.receipt), encode(input.metadata),
        input.runtimeVersion || '', input.runtimeBuildId || '', input.activationRevision || '', startedAt, input.completedAt || null,
      );
      return api.getRun(id);
    },
    getRun(id) {
      return mapRun(db.prepare('SELECT * FROM runtime_runs WHERE id = ?').get(id));
    },
    getRunPresentation(runId) {
      const row = db.prepare('SELECT * FROM runtime_run_presentations WHERE run_id = ?').get(runId);
      if (!row) return null;
      return {
        runId: row.run_id,
        revision: Number(row.revision || 0),
        lastCursor: Number(row.last_cursor || 0),
        status: row.status,
        phase: row.phase,
        content: row.content || '',
        activityGroups: json(row.activity_groups_json, []),
        approval: row.approval_json ? json(row.approval_json, null) : null,
        clarification: row.clarification_json ? json(row.clarification_json, null) : null,
        compaction: row.compaction_json ? json(row.compaction_json, null) : null,
        error: row.error || '',
        updatedAt: row.updated_at,
      };
    },
    upsertRunPresentation(input) {
      const run = api.getRun(input.runId);
      if (!run) throw new Error(`Runtime run does not exist: ${input.runId}`);
      const current = api.getRunPresentation(input.runId);
      const next = {
        runId: input.runId,
        revision: Math.max(Number(input.revision ?? ((current?.revision || 0) + 1)), current?.revision || 0),
        lastCursor: Math.max(Number(input.lastCursor ?? current?.lastCursor ?? 0), current?.lastCursor || 0),
        status: input.status || current?.status || run.status,
        phase: input.phase || current?.phase || run.phase,
        content: input.content ?? current?.content ?? '',
        activityGroups: input.activityGroups ?? current?.activityGroups ?? [],
        approval: input.approval === undefined ? current?.approval ?? null : input.approval,
        clarification: input.clarification === undefined ? current?.clarification ?? null : input.clarification,
        compaction: input.compaction === undefined ? current?.compaction ?? null : input.compaction,
        error: input.error ?? current?.error ?? '',
        updatedAt: input.updatedAt || timestamp(),
      };
      db.prepare(`
        INSERT INTO runtime_run_presentations(
          run_id, revision, last_cursor, status, phase, content, activity_groups_json,
          approval_json, clarification_json, compaction_json, error, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          revision=excluded.revision, last_cursor=excluded.last_cursor, status=excluded.status,
          phase=excluded.phase, content=excluded.content, activity_groups_json=excluded.activity_groups_json,
          approval_json=excluded.approval_json, clarification_json=excluded.clarification_json,
          compaction_json=excluded.compaction_json, error=excluded.error, updated_at=excluded.updated_at
      `).run(
        next.runId, next.revision, next.lastCursor, next.status, next.phase, next.content,
        encode(next.activityGroups), next.approval == null ? null : encode(next.approval),
        next.clarification == null ? null : encode(next.clarification),
        next.compaction == null ? null : encode(next.compaction), next.error, next.updatedAt,
      );
      return api.getRunPresentation(input.runId);
    },
    listRuns({ runtimeId = '', runtimeBuildId = '', threadId = '', status = '', limit = 100 } = {}) {
      const clauses = [];
      const args = [];
      if (runtimeId) { clauses.push('runtime_id = ?'); args.push(runtimeId); }
      if (runtimeBuildId) { clauses.push('runtime_build_id = ?'); args.push(runtimeBuildId); }
      if (threadId) { clauses.push('thread_id = ?'); args.push(threadId); }
      if (status) { clauses.push('status = ?'); args.push(status); }
      args.push(Math.max(1, Math.min(1000, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM runtime_runs ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ?`)
        .all(...args).map(mapRun);
    },
    updateRun(id, patch) {
      const current = api.getRun(id);
      if (!current) return null;
      const status = patch.status || current.status;
      const completedAt = patch.completedAt === undefined
        ? (['completed', 'failed', 'cancelled'].includes(status) ? current.completedAt || timestamp() : current.completedAt)
        : patch.completedAt;
      db.prepare(`
        UPDATE runtime_runs SET status=?, phase=?, stop_requested_at=?, error=?, context_watermark_from=?, context_watermark_to=?, skill_set_revision=?,
          permission_policy_revision=?, permission_coverage=?, receipt_json=?, metadata_json=?, native_run_id=?, native_turn_id=?,
          last_native_event_sequence=?, execution_realm_revision=?, model_route_revision=?, completed_at=? WHERE id=?
      `).run(
        status, patch.phase === undefined ? current.phase : String(patch.phase || 'model'),
        patch.stopRequestedAt === undefined ? current.stopRequestedAt : patch.stopRequestedAt || null,
        patch.error === undefined ? current.error : String(patch.error || ''),
        patch.contextWatermarkFrom === undefined ? current.contextWatermarkFrom : String(patch.contextWatermarkFrom || ''),
        patch.contextWatermarkTo === undefined ? current.contextWatermarkTo : String(patch.contextWatermarkTo || ''),
        patch.skillSetRevision === undefined ? current.skillSetRevision : String(patch.skillSetRevision || ''),
        patch.permissionPolicyRevision === undefined ? current.permissionPolicyRevision : String(patch.permissionPolicyRevision || ''),
        patch.permissionCoverage === undefined ? current.permissionCoverage : String(patch.permissionCoverage || ''),
        encode(patch.receipt === undefined ? current.receipt : patch.receipt),
        encode({ ...current.metadata, ...(patch.metadata || {}) }),
        patch.nativeRunId === undefined ? current.nativeRunId : String(patch.nativeRunId || ''),
        patch.nativeTurnId === undefined ? current.nativeTurnId : String(patch.nativeTurnId || ''),
        patch.lastNativeEventSequence === undefined ? current.lastNativeEventSequence : Math.max(0, Number(patch.lastNativeEventSequence || 0)),
        patch.executionRealmRevision === undefined ? current.executionRealmRevision : String(patch.executionRealmRevision || ''),
        patch.modelRouteRevision === undefined ? current.modelRouteRevision : String(patch.modelRouteRevision || ''),
        completedAt || null, id,
      );
      return api.getRun(id);
    },
    requestRunInterrupt(id, requestedAt = timestamp()) {
      db.prepare(`
        UPDATE runtime_runs
        SET status='interrupting', stop_requested_at=?, metadata_json=json_patch(metadata_json, json(?))
        WHERE id=? AND status NOT IN ('completed', 'failed', 'cancelled')
      `).run(requestedAt, encode({ stopRequested: true }), id);
      return api.getRun(id);
    },
    transitionRunTerminal(id, status, patch = {}) {
      if (!['completed', 'failed', 'cancelled'].includes(status)) throw new Error(`Invalid terminal Run status: ${status}`);
      const current = api.getRun(id);
      if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) return { run: current, changed: false };
      const completedAt = patch.completedAt || timestamp();
      const result = db.prepare(`
        UPDATE runtime_runs SET status=?, error=?, completed_at=?, metadata_json=json_patch(metadata_json, json(?))
        WHERE id=? AND status NOT IN ('completed', 'failed', 'cancelled')
      `).run(status, patch.error === undefined ? current.error : String(patch.error || ''), completedAt, encode(patch.metadata || {}), id);
      return { run: api.getRun(id), changed: Number(result.changes || 0) === 1 };
    },
    appendEvent(input) {
      const run = api.getRun(input.runId);
      if (!run) throw new Error(`Runtime run does not exist: ${input.runId}`);
      db.exec('BEGIN IMMEDIATE;');
      try {
        const nextCursor = Number(input.cursor) || Number(db.prepare('SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM runtime_events WHERE run_id = ?').get(input.runId)?.cursor || 1);
        const event = {
          id: input.id || `runtime_event_${randomUUID()}`,
          cursor: nextCursor,
          runId: input.runId,
          sessionId: input.sessionId || run.sessionId,
          runtimeId: input.runtimeId || run.runtimeId,
          nativeEventKey: String(input.nativeEventKey || ''),
          type: input.type,
          payload: boundedRuntimeEventPayload(input.payload),
          createdAt: input.createdAt || timestamp(),
        };
        const result = db.prepare(`
          INSERT OR IGNORE INTO runtime_events(
            id, cursor, run_id, session_id, runtime_id, runtime_version, runtime_build_id, native_event_key, type, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id, event.cursor, event.runId, event.sessionId, event.runtimeId,
          input.runtimeVersion || run.runtimeVersion || '', input.runtimeBuildId || run.runtimeBuildId || '',
          event.nativeEventKey, event.type, encode(event.payload), event.createdAt,
        );
        const row = event.nativeEventKey
          ? db.prepare('SELECT * FROM runtime_events WHERE run_id = ? AND native_event_key = ?').get(event.runId, event.nativeEventKey)
          : db.prepare('SELECT * FROM runtime_events WHERE run_id = ? AND cursor = ?').get(event.runId, event.cursor);
        if (Number(result.changes || 0) > 0 && row) {
          const storedEvent = mapEvent(row);
          const presentation = reduceRunPresentation(api.getRunPresentation(run.id), storedEvent, api.getRun(run.id));
          api.upsertRunPresentation(presentation);
        }
        db.exec('COMMIT;');
        return mapEvent(row);
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
    },
    eventsAfter(runId, cursor = 0, limit = 1000) {
      return db.prepare('SELECT * FROM runtime_events WHERE run_id = ? AND cursor > ? ORDER BY cursor ASC LIMIT ?')
        .all(runId, Math.max(0, Number(cursor) || 0), Math.max(1, Math.min(2000, Number(limit) || 1000))).map(mapEvent);
    },
    putContextCheckpoint(input) {
      const checkpoint = {
        id: String(input.id || `context_checkpoint_${randomUUID()}`),
        threadId: String(input.threadId || ''),
        runId: String(input.runId || ''),
        operationId: String(input.operationId || ''),
        throughCursor: Math.max(0, Number(input.throughCursor || 0)),
        retainedFromCursor: Math.max(0, Number(input.retainedFromCursor || 0)),
        summary: String(input.summary || '').trim(),
        sourceRuntimeId: String(input.sourceRuntimeId || ''),
        sourceModelId: String(input.sourceModelId || ''),
        trigger: String(input.trigger || 'threshold'),
        tokensBefore: Number.isFinite(Number(input.tokensBefore)) ? Math.max(0, Number(input.tokensBefore)) : null,
        tokensAfterEstimate: Number.isFinite(Number(input.tokensAfterEstimate)) ? Math.max(0, Number(input.tokensAfterEstimate)) : null,
        version: 1,
        createdAt: input.createdAt || timestamp(),
      };
      if (!checkpoint.threadId || !checkpoint.summary || !checkpoint.sourceRuntimeId) throw new Error('Context checkpoint identity and summary are required.');
      db.prepare(`
        INSERT OR IGNORE INTO context_checkpoints(
          id, thread_id, run_id, operation_id, through_cursor, retained_from_cursor, summary,
          source_runtime_id, source_model_id, trigger, tokens_before, tokens_after_estimate, version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpoint.id, checkpoint.threadId, checkpoint.runId, checkpoint.operationId,
        checkpoint.throughCursor, checkpoint.retainedFromCursor, checkpoint.summary,
        checkpoint.sourceRuntimeId, checkpoint.sourceModelId, checkpoint.trigger,
        checkpoint.tokensBefore, checkpoint.tokensAfterEstimate, checkpoint.version, checkpoint.createdAt,
      );
      return api.getContextCheckpoint(checkpoint.id);
    },
    getContextCheckpoint(id) {
      return mapCheckpoint(db.prepare('SELECT * FROM context_checkpoints WHERE id = ?').get(id));
    },
    latestContextCheckpoint(threadId) {
      return mapCheckpoint(db.prepare('SELECT * FROM context_checkpoints WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(threadId));
    },
    listContextCheckpoints(threadId, limit = 100) {
      return db.prepare('SELECT * FROM context_checkpoints WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(threadId, Math.max(1, Math.min(500, Number(limit) || 100))).map(mapCheckpoint);
    },
    putCapabilitySnapshot(snapshot) {
      const checkedAt = snapshot.checkedAt || timestamp();
      const expiresAt = snapshot.expiresAt || new Date(Date.parse(checkedAt) + 5 * 60_000).toISOString();
      db.prepare(`
        INSERT INTO runtime_capability_snapshots(runtime_id, snapshot_json, checked_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(runtime_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, checked_at=excluded.checked_at, expires_at=excluded.expires_at
      `).run(snapshot.runtimeId, encode({ ...snapshot, checkedAt, expiresAt }), checkedAt, expiresAt);
      return api.getCapabilitySnapshot(snapshot.runtimeId);
    },
    getCapabilitySnapshot(runtimeId) {
      const row = db.prepare('SELECT * FROM runtime_capability_snapshots WHERE runtime_id = ?').get(runtimeId);
      return row ? { ...json(row.snapshot_json), runtimeId: row.runtime_id, checkedAt: row.checked_at, expiresAt: row.expires_at } : null;
    },
    putBuildCapabilitySnapshot(snapshot) {
      const checkedAt = snapshot.checkedAt || timestamp();
      const expiresAt = snapshot.expiresAt || new Date(Date.parse(checkedAt) + 5 * 60_000).toISOString();
      const buildId = String(snapshot.runtimeBuildId || '');
      if (!buildId) return api.putCapabilitySnapshot(snapshot);
      db.prepare(`
        INSERT INTO runtime_build_capability_snapshots(runtime_id, runtime_build_id, snapshot_json, checked_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(runtime_id, runtime_build_id) DO UPDATE SET
          snapshot_json=excluded.snapshot_json, checked_at=excluded.checked_at, expires_at=excluded.expires_at
      `).run(snapshot.runtimeId, buildId, encode({ ...snapshot, checkedAt, expiresAt }), checkedAt, expiresAt);
      return api.getBuildCapabilitySnapshot(snapshot.runtimeId, buildId);
    },
    getBuildCapabilitySnapshot(runtimeId, runtimeBuildId = '') {
      if (!runtimeBuildId) return api.getCapabilitySnapshot(runtimeId);
      const row = db.prepare('SELECT * FROM runtime_build_capability_snapshots WHERE runtime_id = ? AND runtime_build_id = ?')
        .get(runtimeId, runtimeBuildId);
      return row ? {
        ...json(row.snapshot_json), runtimeId: row.runtime_id, runtimeBuildId: row.runtime_build_id,
        checkedAt: row.checked_at, expiresAt: row.expires_at,
      } : null;
    },
    putRuntimePackage(input) {
      const current = timestamp();
      const record = {
        runtimeId: String(input.runtimeId || ''),
        runtimeVersion: String(input.runtimeVersion || ''),
        runtimeBuildId: String(input.runtimeBuildId || ''),
        source: String(input.source || 'managed'),
        runtimeDir: String(input.runtimeDir || ''),
        executablePath: String(input.executablePath || ''),
        packageRoot: String(input.packageRoot || ''),
        fingerprint: String(input.fingerprint || ''),
        platform: String(input.platform || process.platform),
        arch: String(input.arch || process.arch),
        artifactDigest: String(input.artifactDigest || ''),
        adapterProtocolVersion: Math.max(1, Number(input.adapterProtocolVersion || 1)),
        installationState: String(input.installationState || 'available'),
        verificationState: String(input.verificationState || 'unverified'),
        availability: String(input.availability || (input.verificationState === 'verified' ? 'ready' : 'unavailable')),
        verificationReceipt: input.verificationReceipt || {},
        metadata: input.metadata || {},
        installedAt: input.installedAt || current,
        verifiedAt: input.verifiedAt || null,
        lastVerifiedAt: input.lastVerifiedAt || input.verifiedAt || null,
        lastUsedAt: input.lastUsedAt || null,
      };
      if (!record.runtimeId || !record.runtimeVersion || !record.runtimeBuildId) throw new Error('Runtime package identity is required.');
      db.prepare(`
        INSERT INTO runtime_packages(
          runtime_id, runtime_version, runtime_build_id, source, runtime_dir, executable_path, package_root, fingerprint,
          platform, arch, artifact_digest,
          adapter_protocol_version, installation_state, verification_state, verification_receipt_json,
          availability, metadata_json, installed_at, verified_at, last_verified_at, last_used_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(runtime_build_id) DO UPDATE SET
          runtime_dir=excluded.runtime_dir, executable_path=excluded.executable_path, package_root=excluded.package_root,
          fingerprint=excluded.fingerprint, artifact_digest=excluded.artifact_digest,
          adapter_protocol_version=excluded.adapter_protocol_version, installation_state=excluded.installation_state,
          verification_state=excluded.verification_state, verification_receipt_json=excluded.verification_receipt_json,
          availability=excluded.availability, metadata_json=excluded.metadata_json, verified_at=excluded.verified_at,
          last_verified_at=excluded.last_verified_at,
          last_used_at=COALESCE(excluded.last_used_at, runtime_packages.last_used_at), updated_at=excluded.updated_at
      `).run(
        record.runtimeId, record.runtimeVersion, record.runtimeBuildId, record.source, record.runtimeDir,
        record.executablePath, record.packageRoot, record.fingerprint, record.platform, record.arch, record.artifactDigest,
        record.adapterProtocolVersion, record.installationState, record.verificationState, encode(record.verificationReceipt),
        record.availability, encode(record.metadata), record.installedAt, record.verifiedAt, record.lastVerifiedAt,
        record.lastUsedAt, current,
      );
      return api.getRuntimePackage(record.runtimeBuildId);
    },
    getRuntimePackage(runtimeBuildId) {
      const row = db.prepare('SELECT * FROM runtime_packages WHERE runtime_build_id = ?').get(runtimeBuildId);
      return row && ({
        runtimeId: row.runtime_id, runtimeVersion: row.runtime_version, runtimeBuildId: row.runtime_build_id,
        source: row.source, runtimeDir: row.runtime_dir, executablePath: row.executable_path || '',
        packageRoot: row.package_root || '', fingerprint: row.fingerprint || '', platform: row.platform, arch: row.arch,
        artifactDigest: row.artifact_digest, adapterProtocolVersion: Number(row.adapter_protocol_version || 1),
        installationState: row.installation_state, verificationState: row.verification_state,
        availability: row.availability || (row.verification_state === 'verified' ? 'ready' : 'unavailable'),
        verificationReceipt: json(row.verification_receipt_json), metadata: json(row.metadata_json),
        installedAt: row.installed_at, verifiedAt: row.verified_at, lastVerifiedAt: row.last_verified_at || row.verified_at,
        lastUsedAt: row.last_used_at, updatedAt: row.updated_at,
      });
    },
    listRuntimePackages(runtimeId = '') {
      const rows = runtimeId
        ? db.prepare('SELECT runtime_build_id FROM runtime_packages WHERE runtime_id = ? ORDER BY updated_at DESC').all(runtimeId)
        : db.prepare('SELECT runtime_build_id FROM runtime_packages ORDER BY updated_at DESC').all();
      return rows.map((row) => api.getRuntimePackage(row.runtime_build_id));
    },
    deleteRuntimePackage(runtimeBuildId) {
      const current = api.getRuntimePackage(runtimeBuildId);
      if (!current) return null;
      db.prepare('DELETE FROM runtime_packages WHERE runtime_build_id = ?').run(runtimeBuildId);
      return current;
    },
    putRuntimeActivation(input) {
      const current = timestamp();
      const previous = api.getRuntimeActivation(input.runtimeId);
      const revision = String(input.activationRevision || `activation_${randomUUID()}`);
      db.prepare(`
        INSERT INTO runtime_activations(runtime_id, active_build_id, previous_build_id, activation_revision, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(runtime_id) DO UPDATE SET active_build_id=excluded.active_build_id,
          previous_build_id=excluded.previous_build_id, activation_revision=excluded.activation_revision, updated_at=excluded.updated_at
      `).run(
        input.runtimeId, String(input.activeBuildId || ''),
        input.previousBuildId === undefined ? previous?.activeBuildId || '' : String(input.previousBuildId || ''),
        revision, current,
      );
      return api.getRuntimeActivation(input.runtimeId);
    },
    getRuntimeActivation(runtimeId) {
      const row = db.prepare('SELECT * FROM runtime_activations WHERE runtime_id = ?').get(runtimeId);
      return row && ({
        runtimeId: row.runtime_id, activeBuildId: row.active_build_id, previousBuildId: row.previous_build_id,
        activationRevision: row.activation_revision, updatedAt: row.updated_at,
      });
    },
    putToolCapabilitySnapshot(profile, snapshot) {
      const checkedAt = snapshot.checkedAt || timestamp();
      const configurationRevision = String(snapshot.configurationRevision || '');
      db.prepare(`
        INSERT INTO tool_capability_snapshots(profile, snapshot_json, configuration_revision, checked_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile) DO UPDATE SET snapshot_json=excluded.snapshot_json, configuration_revision=excluded.configuration_revision, checked_at=excluded.checked_at
      `).run(profile, encode({ ...snapshot, checkedAt, configurationRevision }), configurationRevision, checkedAt);
      return api.getToolCapabilitySnapshot(profile);
    },
    getToolCapabilitySnapshot(profile) {
      const row = db.prepare('SELECT * FROM tool_capability_snapshots WHERE profile = ?').get(profile);
      return row ? { ...json(row.snapshot_json), profile: row.profile, configurationRevision: row.configuration_revision, checkedAt: row.checked_at } : null;
    },
    putSkillPackage(input) {
      const skill = input.skill || input;
      const createdAt = skill.createdAt || timestamp();
      const version = skill.version || '1';
      const immutable = db.prepare('SELECT content_hash FROM skill_packages WHERE id = ? AND version = ?').get(skill.id, version);
      if (immutable && immutable.content_hash !== String(skill.contentHash || '')) {
        const error = new Error(`Skill ${skill.id}@${version} is immutable and already has different content.`);
        error.code = 'SKILL_VERSION_IMMUTABLE';
        throw error;
      }
      db.prepare(`
        INSERT INTO skill_packages(
          id, version, name, content_hash, scope, subject_id, source_agent_id,
          compatible_runtime_ids_json, dependencies_json, permission_intents_json, entry_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, version) DO UPDATE SET
          name=excluded.name, scope=excluded.scope, subject_id=excluded.subject_id, source_agent_id=excluded.source_agent_id,
          compatible_runtime_ids_json=excluded.compatible_runtime_ids_json, dependencies_json=excluded.dependencies_json,
          permission_intents_json=excluded.permission_intents_json, entry_path=excluded.entry_path
      `).run(
        skill.id, version, skill.name || skill.id, skill.contentHash || '', skill.scope || 'agent', skill.subjectId || '', skill.sourceAgentId || '',
        encode(skill.compatibleRuntimeIds || []), encode(skill.dependencies || []), encode(skill.permissionIntents || []), skill.entryPath || '', createdAt,
      );
      const row = db.prepare('SELECT * FROM skill_packages WHERE id = ? AND version = ?').get(skill.id, version);
      return row && {
        id: row.id, version: row.version, name: row.name, contentHash: row.content_hash, scope: row.scope, subjectId: row.subject_id,
        sourceAgentId: row.source_agent_id, compatibleRuntimeIds: json(row.compatible_runtime_ids_json, []), dependencies: json(row.dependencies_json, []),
        permissionIntents: json(row.permission_intents_json, []), entryPath: row.entry_path, createdAt: row.created_at,
      };
    },
    listSkillPackages({ scope = '', subjectId = '', id = '' } = {}) {
      const clauses = [];
      const args = [];
      if (scope) { clauses.push('scope = ?'); args.push(scope); }
      if (subjectId) { clauses.push('subject_id = ?'); args.push(subjectId); }
      if (id) { clauses.push('id = ?'); args.push(id); }
      return db.prepare(`SELECT * FROM skill_packages ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id, created_at DESC`).all(...args).map((row) => ({
        id: row.id, version: row.version, name: row.name, contentHash: row.content_hash, scope: row.scope, subjectId: row.subject_id,
        sourceAgentId: row.source_agent_id, compatibleRuntimeIds: json(row.compatible_runtime_ids_json, []), dependencies: json(row.dependencies_json, []),
        permissionIntents: json(row.permission_intents_json, []), entryPath: row.entry_path, createdAt: row.created_at,
      }));
    },
    putSkillBinding(input) {
      const current = timestamp();
      const existing = db.prepare('SELECT * FROM skill_bindings WHERE skill_id = ? AND scope = ? AND subject_id = ?')
        .get(input.skillId, input.scope, input.subjectId || '');
      const id = existing?.id || input.id || `skill_binding_${randomUUID()}`;
      db.prepare(`
        INSERT INTO skill_bindings(id, skill_id, skill_version, scope, subject_id, pinned, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET skill_version=excluded.skill_version, pinned=excluded.pinned,
          enabled=excluded.enabled, updated_at=excluded.updated_at
      `).run(
        id, input.skillId, input.skillVersion || '1', input.scope || 'agent', input.subjectId || '',
        input.pinned ? 1 : 0, input.enabled === false ? 0 : 1, existing?.created_at || input.createdAt || current, current,
      );
      return api.listSkillBindings({ skillId: input.skillId, scope: input.scope, subjectId: input.subjectId }).find((item) => item.id === id);
    },
    listSkillBindings({ skillId = '', scope = '', subjectId = '', enabledOnly = false } = {}) {
      const clauses = [];
      const args = [];
      if (skillId) { clauses.push('skill_id = ?'); args.push(skillId); }
      if (scope) { clauses.push('scope = ?'); args.push(scope); }
      if (subjectId) { clauses.push('subject_id = ?'); args.push(subjectId); }
      if (enabledOnly) clauses.push('enabled = 1');
      return db.prepare(`SELECT * FROM skill_bindings ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC`)
        .all(...args).map((row) => ({
          id: row.id, skillId: row.skill_id, skillVersion: row.skill_version, scope: row.scope, subjectId: row.subject_id,
          pinned: Boolean(row.pinned), enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at,
        }));
    },
    putSkillApplication(input) {
      const current = timestamp();
      const skill = input.skill || {};
      const skillId = input.skillId || skill.id;
      const skillVersion = input.skillVersion || skill.version || '1';
      const existing = db.prepare(`
        SELECT * FROM skill_applications WHERE skill_id = ? AND skill_version = ? AND runtime_id = ? AND agent_id = ? AND session_id = ?
      `).get(skillId, skillVersion, input.runtimeId, input.agentId, input.sessionId);
      const id = existing?.id || input.id || `skill_application_${randomUUID()}`;
      const status = input.status || existing?.status || 'available';
      db.prepare(`
        INSERT INTO skill_applications(
          id, skill_id, skill_version, runtime_id, agent_id, session_id, status, load_method, error, applied_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, load_method=excluded.load_method, error=excluded.error, applied_at=excluded.applied_at, updated_at=excluded.updated_at
      `).run(
        id, skillId, skillVersion, input.runtimeId, input.agentId, input.sessionId, status, input.loadMethod || '', input.error || '',
        status === 'applied' ? input.appliedAt || current : existing?.applied_at || null, existing?.created_at || current, current,
      );
      return api.listSkillApplications({ sessionId: input.sessionId }).find((item) => item.id === id);
    },
    listSkillApplications({ skillId = '', runtimeId = '', agentId = '', sessionId = '' } = {}) {
      const clauses = [];
      const args = [];
      if (skillId) { clauses.push('skill_id = ?'); args.push(skillId); }
      if (runtimeId) { clauses.push('runtime_id = ?'); args.push(runtimeId); }
      if (agentId) { clauses.push('agent_id = ?'); args.push(agentId); }
      if (sessionId) { clauses.push('session_id = ?'); args.push(sessionId); }
      return db.prepare(`SELECT * FROM skill_applications ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC`).all(...args).map((row) => ({
        id: row.id, skillId: row.skill_id, skillVersion: row.skill_version, runtimeId: row.runtime_id, agentId: row.agent_id,
        sessionId: row.session_id, status: row.status, loadMethod: row.load_method, error: row.error, appliedAt: row.applied_at,
        createdAt: row.created_at, updatedAt: row.updated_at,
      }));
    },
    putPermissionGrant(input) {
      const current = timestamp();
      const id = input.id || `permission_grant_${randomUUID()}`;
      db.prepare(`
        INSERT INTO permission_grants(id, decision, agent_id, workspace_id, action_pattern, target_prefix, scope, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET decision=excluded.decision, action_pattern=excluded.action_pattern, target_prefix=excluded.target_prefix,
          scope=excluded.scope, expires_at=excluded.expires_at, updated_at=excluded.updated_at
      `).run(id, input.decision || 'allow', input.agentId || '', input.workspaceId || '', input.actionPattern || '', input.targetPrefix || '', input.scope || 'agent_workspace', input.expiresAt || null, input.createdAt || current, current);
      return api.listPermissionGrants({ agentId: input.agentId, workspaceId: input.workspaceId }).find((grant) => grant.id === id);
    },
    listPermissionGrants({ agentId = '', workspaceId = '', activeOnly = true } = {}) {
      const clauses = [];
      const args = [];
      if (agentId) { clauses.push("(agent_id = '' OR agent_id = ?)"); args.push(agentId); }
      if (workspaceId) { clauses.push("(workspace_id = '' OR workspace_id = ?)"); args.push(workspaceId); }
      if (activeOnly) clauses.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');
      return db.prepare(`SELECT * FROM permission_grants ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC`).all(...args).map((row) => ({
        id: row.id, decision: row.decision, agentId: row.agent_id, workspaceId: row.workspace_id, actionPattern: row.action_pattern,
        targetPrefix: row.target_prefix, scope: row.scope, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
      }));
    },
    migrateRuntimeBinding(binding) {
      if (!binding?.runtimeId || !binding.runtimeVersion || !binding.runtimeBuildId) return 0;
      let count = 0;
      api.transaction(() => {
        const sessionResult = db.prepare(`
          UPDATE runtime_sessions SET runtime_version = ?, runtime_build_id = ?, activation_revision = ?
          WHERE runtime_id = ? AND runtime_build_id = ''
        `).run(binding.runtimeVersion, binding.runtimeBuildId, binding.activationRevision || '', binding.runtimeId);
        const runResult = db.prepare(`
          UPDATE runtime_runs SET runtime_version = ?, runtime_build_id = ?, activation_revision = ?
          WHERE runtime_id = ? AND runtime_build_id = ''
        `).run(binding.runtimeVersion, binding.runtimeBuildId, binding.activationRevision || '', binding.runtimeId);
        const eventResult = db.prepare(`
          UPDATE runtime_events SET runtime_version = ?, runtime_build_id = ?
          WHERE runtime_id = ? AND runtime_build_id = ''
        `).run(binding.runtimeVersion, binding.runtimeBuildId, binding.runtimeId);
        count = Number(sessionResult.changes || 0) + Number(runResult.changes || 0) + Number(eventResult.changes || 0);
      });
      return count;
    },
    migrateHermesSessions(threads = []) {
      let count = 0;
      api.transaction(() => {
        for (const thread of threads) {
          for (const [agentId, nativeSessionId] of Object.entries(thread.agentSessionIds || {})) {
            if (!agentId || !nativeSessionId) continue;
            const existing = api.findSession({
              threadId: thread.id,
              agentId,
              runtimeId: 'hermes',
              workspaceId: thread.workspaceId || '',
            });
            api.upsertSession({
              threadId: thread.id,
              agentId,
              runtimeId: 'hermes',
              workspaceId: thread.workspaceId || '',
              nativeSessionId: String(nativeSessionId),
              status: thread.activeSessionId === nativeSessionId && thread.runStatus === 'running' ? 'active' : 'idle',
              metadata: { migratedFrom: 'agentSessionIds' },
            });
            if (!existing) count += 1;
          }
        }
      });
      return count;
    },
    migrateWorkspaceMemoryScopes(workspaces = []) {
      const vaultByWorkspace = new Map(
        workspaces
          .filter((workspace) => workspace?.id && workspace?.vaultId)
          .map((workspace) => [String(workspace.id), String(workspace.vaultId)]),
      );
      if (!vaultByWorkspace.size) return 0;
      let count = 0;
      api.transaction(() => {
        const legacyEntries = db.prepare("SELECT id, subject_id FROM memory_entries WHERE scope = 'workspace'").all();
        const update = db.prepare("UPDATE memory_entries SET scope = 'vault', subject_id = ?, vault_id = ?, updated_at = ? WHERE id = ?");
        for (const entry of legacyEntries) {
          const vaultId = vaultByWorkspace.get(String(entry.subject_id || ''));
          if (!vaultId) continue;
          update.run(vaultId, vaultId, timestamp(), entry.id);
          count += 1;
        }
      });
      return count;
    },
    listMemory({ scope = '', subjectId = '', status = '', query = '', limit = 100 } = {}) {
      const clauses = [];
      const args = [];
      if (scope) { clauses.push('scope = ?'); args.push(scope); }
      if (subjectId) { clauses.push('subject_id = ?'); args.push(subjectId); }
      if (status) { clauses.push('status = ?'); args.push(status); }
      if (query) { clauses.push('(fact LIKE ? OR normalized_fact LIKE ?)'); args.push(`%${query}%`, `%${String(query).toLowerCase()}%`); }
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM memory_entries ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`)
        .all(...args).map(mapMemory);
    },
    getMemory(id) {
      return mapMemory(db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id));
    },
    putMemory(input) {
      const current = timestamp();
      const normalizedFact = String(input.fact || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!normalizedFact) throw new Error('Memory fact is required.');
      const duplicate = db.prepare(`
        SELECT * FROM memory_entries
        WHERE scope = ? AND subject_id = ? AND (normalized_fact = ? OR (? != '' AND source_hash = ?)) AND status IN ('candidate', 'accepted', 'paused')
        ORDER BY updated_at DESC LIMIT 1
      `).get(input.scope, input.subjectId, normalizedFact, String(input.sourceHash || ''), String(input.sourceHash || ''));
      if (duplicate && !input.forceNew) {
        const provenance = [...json(duplicate.provenance_json, []), ...(input.provenance || [])].slice(-50);
        db.prepare('UPDATE memory_entries SET provenance_json=?, confidence=?, updated_at=? WHERE id=?')
          .run(encode(provenance), Math.max(Number(duplicate.confidence), Number(input.confidence || 0.5)), current, duplicate.id);
        return api.listMemory({ scope: input.scope, subjectId: input.subjectId, limit: 500 }).find((item) => item.id === duplicate.id);
      }
      const id = input.id || `memory_${randomUUID()}`;
      db.prepare(`
        INSERT INTO memory_entries(
          id, scope, subject_id, normalized_fact, kind, origin, source_agent_id, thread_id, vault_id, source_hash, fact, reason, status_reason,
          provenance_json, confidence, status, paused_at, valid_from, valid_until, supersedes_id,
          sync_vault_id, sync_relative_path, sync_block_hash, sync_state, synced_at,
          source_runtime_id, source_session_id, source_message_id, created_revision, deleted_at, deletion_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.scope, input.subjectId, normalizedFact, input.kind || 'fact', input.origin || 'unknown',
        input.sourceAgentId || '', input.threadId || '', input.vaultId || '', input.sourceHash || '', String(input.fact).trim(),
        input.reason || '', input.statusReason || '', encode(input.provenance || []), Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))),
        input.status || 'candidate', input.pausedAt || null, input.validFrom || null, input.validUntil || null,
        input.supersedesId || null, input.sync?.vaultId || '', input.sync?.relativePath || '', input.sync?.blockHash || '', input.sync?.state || 'none', input.sync?.syncedAt || null,
        input.sourceRuntimeId || '', input.sourceSessionId || '', input.sourceMessageId || '', input.createdRevision || '', input.deletedAt || null, input.deletionReason || '',
        current, current,
      );
      return api.getMemory(id);
    },
    updateMemory(id, patch) {
      const current = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
      if (!current) return null;
      const nextStatus = ['candidate', 'accepted', 'paused', 'superseded', 'rejected', 'forgotten'].includes(patch.status) ? patch.status : current.status;
      const nextFact = patch.fact === undefined ? current.fact : String(patch.fact || '').trim();
      if (!nextFact) throw new Error('Memory fact is required.');
      const nextNormalized = nextFact.toLowerCase().replace(/\s+/g, ' ');
      const nextKind = ['personal_fact', 'preference', 'agent_experience', 'project_fact', 'project_decision', 'project_rule', 'fact'].includes(patch.kind) ? patch.kind : current.kind;
      const nextScope = ['user', 'agent', 'vault', 'thread'].includes(patch.scope) ? patch.scope : current.scope;
      const nextSubjectId = patch.subjectId === undefined ? current.subject_id : String(patch.subjectId || '').trim();
      if (!nextSubjectId) throw new Error('Memory subject is required.');
      const sync = patch.sync && typeof patch.sync === 'object' ? patch.sync : {};
      db.prepare(`
        UPDATE memory_entries SET scope=?, subject_id=?, fact=?, normalized_fact=?, kind=?, origin=?, source_agent_id=?, thread_id=?, vault_id=?,
          reason=?, status_reason=?, status=?, confidence=?, paused_at=?, valid_from=?, valid_until=?, supersedes_id=?,
          sync_vault_id=?, sync_relative_path=?, sync_block_hash=?, sync_state=?, synced_at=?,
          source_runtime_id=?, source_session_id=?, source_message_id=?, created_revision=?, deleted_at=?, deletion_reason=?, updated_at=? WHERE id=?
      `).run(
        nextScope,
        nextSubjectId,
        nextFact,
        nextNormalized,
        nextKind,
        patch.origin === undefined ? current.origin : String(patch.origin || 'unknown'),
        patch.sourceAgentId === undefined ? current.source_agent_id : String(patch.sourceAgentId || ''),
        patch.threadId === undefined ? current.thread_id : String(patch.threadId || ''),
        patch.vaultId === undefined ? current.vault_id : String(patch.vaultId || ''),
        patch.reason === undefined ? current.reason : String(patch.reason || ''),
        patch.statusReason === undefined ? current.status_reason : String(patch.statusReason || ''),
        nextStatus,
        patch.confidence === undefined ? current.confidence : Math.max(0, Math.min(1, Number(patch.confidence))),
        patch.pausedAt === undefined ? current.paused_at : patch.pausedAt || null,
        patch.validFrom === undefined ? current.valid_from : patch.validFrom || null,
        patch.validUntil === undefined ? current.valid_until : patch.validUntil || null,
        patch.supersedesId === undefined ? current.supersedes_id : patch.supersedesId || null,
        sync.vaultId === undefined ? current.sync_vault_id : String(sync.vaultId || ''),
        sync.relativePath === undefined ? current.sync_relative_path : String(sync.relativePath || ''),
        sync.blockHash === undefined ? current.sync_block_hash : String(sync.blockHash || ''),
        sync.state === undefined ? current.sync_state : String(sync.state || 'none'),
        sync.syncedAt === undefined ? current.synced_at : sync.syncedAt || null,
        patch.sourceRuntimeId === undefined ? current.source_runtime_id : String(patch.sourceRuntimeId || ''),
        patch.sourceSessionId === undefined ? current.source_session_id : String(patch.sourceSessionId || ''),
        patch.sourceMessageId === undefined ? current.source_message_id : String(patch.sourceMessageId || ''),
        patch.createdRevision === undefined ? current.created_revision : String(patch.createdRevision || ''),
        patch.deletedAt === undefined ? current.deleted_at : patch.deletedAt || null,
        patch.deletionReason === undefined ? current.deletion_reason : String(patch.deletionReason || ''),
        timestamp(), id,
      );
      return api.getMemory(id);
    },
    touchMemoryRecall(ids = [], recalledAt = timestamp()) {
      const unique = [...new Set(ids.map(String).filter(Boolean))];
      if (!unique.length) return 0;
      const update = db.prepare('UPDATE memory_entries SET last_recalled_at=?, recall_count=recall_count+1 WHERE id=?');
      api.transaction(() => unique.forEach((id) => update.run(recalledAt, id)));
      return unique.length;
    },
    deleteMemory(id) {
      return db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id).changes > 0;
    },
    putMemoryEvent(input) {
      const key = String(input.idempotencyKey || '').trim();
      if (!key) throw new Error('Memory event idempotency key is required.');
      const existing = db.prepare('SELECT * FROM memory_events WHERE idempotency_key = ?').get(key);
      if (existing) return mapMemoryEvent(existing);
      const createdAt = input.createdAt || timestamp();
      db.prepare(`INSERT INTO memory_events(id,idempotency_key,memory_id,type,actor_type,actor_id,payload_json,status,error,created_at,processed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.id || `memory_event_${randomUUID()}`, key, input.memoryId || '', input.type, input.actorType || 'system', input.actorId || '', encode(input.payload), input.status || 'completed', input.error || '', createdAt, input.processedAt || (input.status === 'pending' ? null : createdAt),
      );
      return mapMemoryEvent(db.prepare('SELECT * FROM memory_events WHERE idempotency_key = ?').get(key));
    },
    listMemoryEvents({ memoryId = '', status = '', limit = 100 } = {}) {
      const clauses = []; const args = [];
      if (memoryId) { clauses.push('memory_id=?'); args.push(memoryId); }
      if (status) { clauses.push('status=?'); args.push(status); }
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM memory_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...args).map(mapMemoryEvent);
    },
    putMemoryReceipt(input) {
      const createdAt = input.createdAt || timestamp();
      const id = input.id || `memory_receipt_${randomUUID()}`;
      db.prepare(`INSERT INTO memory_context_receipts(id,thread_id,run_id,runtime_id,agent_id,query,memory_revision,included_json,excluded_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        id, input.threadId, input.runId || '', input.runtimeId || '', input.agentId || '', input.query || '', input.memoryRevision || '', encode(input.included || []), encode(input.excluded || []), createdAt,
      );
      return mapMemoryReceipt(db.prepare('SELECT * FROM memory_context_receipts WHERE id=?').get(id));
    },
    listMemoryReceipts({ threadId = '', limit = 100 } = {}) {
      const args = []; const where = threadId ? (args.push(threadId), 'WHERE thread_id=?') : '';
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM memory_context_receipts ${where} ORDER BY created_at DESC LIMIT ?`).all(...args).map(mapMemoryReceipt);
    },
    putThreadContextEvent(input) {
      const existing = db.prepare('SELECT * FROM thread_context_events WHERE thread_id=? AND source_id=? AND event_type=? AND source_revision=?')
        .get(input.threadId, input.sourceId || '', input.eventType, Number(input.sourceRevision || 1));
      if (existing) return mapThreadContextEvent(existing);
      return api.transaction(() => {
        const repeated = db.prepare('SELECT * FROM thread_context_events WHERE thread_id=? AND source_id=? AND event_type=? AND source_revision=?')
          .get(input.threadId, input.sourceId || '', input.eventType, Number(input.sourceRevision || 1));
        if (repeated) return mapThreadContextEvent(repeated);
        const cursor = Number(db.prepare('SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM thread_context_events WHERE thread_id=?').get(input.threadId)?.cursor || 1);
        const id = input.id || `thread_event_${randomUUID()}`;
        db.prepare(`INSERT INTO thread_context_events(id,thread_id,cursor,event_type,actor_type,actor_id,source_id,source_revision,parent_event_id,visibility,scope,authority,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, input.threadId, cursor, input.eventType, input.actorType || 'system', input.actorId || '', input.sourceId || '', Number(input.sourceRevision || 1), input.parentEventId || '', input.visibility || 'public', input.scope || 'thread', input.authority || 'inferred', encode(input.payload), input.createdAt || timestamp(),
        );
        return mapThreadContextEvent(db.prepare('SELECT * FROM thread_context_events WHERE id=?').get(id));
      });
    },
    putThreadContextEvents(inputs = []) {
      if (!inputs.length) return [];
      const threadIds = [...new Set(inputs.map((input) => String(input.threadId || '')).filter(Boolean))];
      if (threadIds.length !== 1) throw new Error('Thread context event batches must target one thread.');
      const threadId = threadIds[0];
      const existingKeys = new Set(db.prepare('SELECT source_id,event_type,source_revision FROM thread_context_events WHERE thread_id=?').all(threadId).map((row) => `${row.source_id}\u0000${row.event_type}\u0000${row.source_revision}`));
      const pending = inputs.filter((input) => {
        const key = `${input.sourceId || ''}\u0000${input.eventType}\u0000${Number(input.sourceRevision || 1)}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });
      if (!pending.length) return [];
      return api.transaction(() => {
        let cursor = Number(db.prepare('SELECT COALESCE(MAX(cursor), 0) AS cursor FROM thread_context_events WHERE thread_id=?').get(threadId)?.cursor || 0);
        const insert = db.prepare(`INSERT OR IGNORE INTO thread_context_events(id,thread_id,cursor,event_type,actor_type,actor_id,source_id,source_revision,parent_event_id,visibility,scope,authority,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        const ids = [];
        for (const input of pending) {
          const id = input.id || `thread_event_${randomUUID()}`;
          const result = insert.run(id, threadId, cursor + 1, input.eventType, input.actorType || 'system', input.actorId || '', input.sourceId || '', Number(input.sourceRevision || 1), input.parentEventId || '', input.visibility || 'public', input.scope || 'thread', input.authority || 'inferred', encode(input.payload), input.createdAt || timestamp());
          if (result.changes) { cursor += 1; ids.push(id); }
        }
        if (!ids.length) return [];
        return db.prepare(`SELECT * FROM thread_context_events WHERE id IN (${placeholders(ids)}) ORDER BY cursor`).all(...ids).map(mapThreadContextEvent);
      });
    },
    listThreadContextEvents(threadId, { afterCursor = 0, limit = 10000, visibility = '' } = {}) {
      const capped = Math.max(1, Math.min(50000, Number(limit) || 10000));
      const rows = visibility
        ? db.prepare('SELECT * FROM thread_context_events WHERE thread_id=? AND cursor>? AND visibility=? ORDER BY cursor LIMIT ?').all(threadId, Number(afterCursor || 0), visibility, capped)
        : db.prepare('SELECT * FROM thread_context_events WHERE thread_id=? AND cursor>? ORDER BY cursor LIMIT ?').all(threadId, Number(afterCursor || 0), capped);
      return rows.map(mapThreadContextEvent);
    },
    getThreadStateSnapshot(threadId) {
      return mapThreadStateSnapshot(db.prepare('SELECT * FROM thread_state_snapshots WHERE thread_id=?').get(threadId));
    },
    putThreadStateSnapshot(input, expectedRevision = null) {
      const current = db.prepare('SELECT * FROM thread_state_snapshots WHERE thread_id=?').get(input.threadId);
      if (expectedRevision !== null && Number(current?.revision || 0) !== Number(expectedRevision)) return null;
      const updatedAt = timestamp();
      const revision = Number(input.revision ?? Number(current?.revision || 0) + 1);
      db.prepare(`INSERT INTO thread_state_snapshots(thread_id,revision,through_cursor,state_json,content_hash,status,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET revision=excluded.revision,through_cursor=excluded.through_cursor,state_json=excluded.state_json,content_hash=excluded.content_hash,status=excluded.status,error=excluded.error,updated_at=excluded.updated_at`).run(
        input.threadId, revision, Number(input.throughCursor || 0), encode(input.state), input.contentHash || '', input.status || 'ready', input.error || '', current?.created_at || updatedAt, updatedAt,
      );
      return api.getThreadStateSnapshot(input.threadId);
    },
    deleteThreadStateSnapshot(threadId) {
      return db.prepare('DELETE FROM thread_state_snapshots WHERE thread_id=?').run(threadId).changes > 0;
    },
    putContextReceipt(input) {
      const id = input.id || `context_receipt_${randomUUID()}`;
      const cursor = input.cursor || {};
      db.prepare(`INSERT INTO context_receipts(id,packet_id,packet_hash,thread_id,run_id,runtime_id,agent_id,schema_version,state_revision,cursor_from,cursor_to,delivery_mode,budget_json,included_json,excluded_json,conflicts_json,warnings_json,source_receipt_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, input.packetId || '', input.packetHash || '', input.threadId, input.runId || '', input.runtimeId || '', input.agentId || '', Number(input.schemaVersion || 2), Number(input.stateRevision || 0), Number(cursor.from || 0), Number(cursor.to || 0), input.deliveryMode || 'frakio_full', encode(input.budget), encode(input.included || []), encode(input.excluded || []), encode(input.conflicts || []), encode(input.warnings || []), encode(input.sourceReceiptIds || []), input.createdAt || timestamp(),
      );
      return api.getContextReceipt(id);
    },
    getContextReceipt(id) {
      return mapContextReceipt(db.prepare('SELECT * FROM context_receipts WHERE id=?').get(id));
    },
    updateContextReceiptDelivery(id, deliveryMode) {
      db.prepare('UPDATE context_receipts SET delivery_mode=? WHERE id=?').run(deliveryMode, id);
      return api.getContextReceipt(id);
    },
    listContextReceipts({ threadId = '', limit = 100 } = {}) {
      const capped = Math.max(1, Math.min(500, Number(limit) || 100));
      return (threadId
        ? db.prepare('SELECT * FROM context_receipts WHERE thread_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(threadId, capped)
        : db.prepare('SELECT * FROM context_receipts ORDER BY created_at DESC, rowid DESC LIMIT ?').all(capped)).map(mapContextReceipt);
    },
    memoryRevision({ scope = '', subjectId = '' } = {}) {
      const clauses = []; const args = [];
      if (scope) { clauses.push('scope=?'); args.push(scope); }
      if (subjectId) { clauses.push('subject_id=?'); args.push(subjectId); }
      const row = db.prepare(`SELECT COUNT(*) AS count, COALESCE(MAX(updated_at),'') AS updated_at FROM memory_entries ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`).get(...args);
      return `${Number(row?.count || 0)}:${row?.updated_at || ''}`;
    },
    putHermesProjection(input) {
      const updatedAt = timestamp();
      db.prepare(`INSERT INTO hermes_projections(profile_name,agent_id,agent_revision,memory_revision,content_hash,files_json,status,error,generated_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_name) DO UPDATE SET agent_id=excluded.agent_id,agent_revision=excluded.agent_revision,memory_revision=excluded.memory_revision,content_hash=excluded.content_hash,files_json=excluded.files_json,status=excluded.status,error=excluded.error,generated_at=excluded.generated_at,updated_at=excluded.updated_at`).run(
        input.profileName, input.agentId || '', input.agentRevision || '', input.memoryRevision || '', input.contentHash || '', encode(input.files), input.status || 'ready', input.error || '', input.generatedAt || updatedAt, updatedAt,
      );
      return mapHermesProjection(db.prepare('SELECT * FROM hermes_projections WHERE profile_name=?').get(input.profileName));
    },
    getHermesProjection(profileName) { return mapHermesProjection(db.prepare('SELECT * FROM hermes_projections WHERE profile_name=?').get(profileName)); },
    listHermesProjections() { return db.prepare('SELECT * FROM hermes_projections ORDER BY updated_at DESC').all().map(mapHermesProjection); },
    putMemoryReview(input) {
      const current = timestamp();
      const triggerKey = String(input.triggerKey || '').trim();
      if (!triggerKey) throw new Error('Memory review trigger key is required.');
      const existing = db.prepare('SELECT * FROM memory_review_jobs WHERE trigger_key = ?').get(triggerKey);
      if (existing) return mapMemoryReview(existing);
      const id = input.id || `memory_review_${randomUUID()}`;
      db.prepare(`
        INSERT INTO memory_review_jobs(
          id, trigger_key, thread_id, turn_id, workflow_id, task_id, kind, status, attempts,
          model_snapshot_json, input_json, result_json, error, next_attempt_at, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, triggerKey, String(input.threadId || ''), String(input.turnId || ''), String(input.workflowId || ''), String(input.taskId || ''),
        String(input.kind || 'chat_turn'), String(input.status || 'queued'), Number(input.attempts || 0), encode(input.modelSnapshot || {}),
        encode(input.input || {}), encode(input.result || {}), String(input.error || ''), input.nextAttemptAt || null, current, current, input.completedAt || null,
      );
      return api.getMemoryReview(id);
    },
    getMemoryReview(id) {
      return mapMemoryReview(db.prepare('SELECT * FROM memory_review_jobs WHERE id = ?').get(id));
    },
    getMemoryReviewByTrigger(triggerKey) {
      return mapMemoryReview(db.prepare('SELECT * FROM memory_review_jobs WHERE trigger_key = ?').get(triggerKey));
    },
    listMemoryReviews({ threadId = '', status = '', limit = 100 } = {}) {
      const clauses = [];
      const args = [];
      if (threadId) { clauses.push('thread_id = ?'); args.push(threadId); }
      if (status) { clauses.push('status = ?'); args.push(status); }
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM memory_review_jobs ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`).all(...args).map(mapMemoryReview);
    },
    updateMemoryReview(id, patch = {}) {
      const current = db.prepare('SELECT * FROM memory_review_jobs WHERE id = ?').get(id);
      if (!current) return null;
      const status = ['queued', 'running', 'completed', 'failed'].includes(patch.status) ? patch.status : current.status;
      db.prepare(`
        UPDATE memory_review_jobs SET status=?, attempts=?, model_snapshot_json=?, input_json=?, result_json=?, error=?, next_attempt_at=?, completed_at=?, updated_at=? WHERE id=?
      `).run(
        status,
        patch.attempts === undefined ? current.attempts : Math.max(0, Number(patch.attempts || 0)),
        patch.modelSnapshot === undefined ? current.model_snapshot_json : encode(patch.modelSnapshot || {}),
        patch.input === undefined ? current.input_json : encode(patch.input || {}),
        patch.result === undefined ? current.result_json : encode(patch.result || {}),
        patch.error === undefined ? current.error : String(patch.error || ''),
        patch.nextAttemptAt === undefined ? current.next_attempt_at : patch.nextAttemptAt || null,
        patch.completedAt === undefined ? current.completed_at : patch.completedAt || null,
        timestamp(), id,
      );
      return api.getMemoryReview(id);
    },
    recoverMemoryReviews() {
      const current = timestamp();
      db.prepare("UPDATE memory_review_jobs SET status='queued', error='', next_attempt_at=NULL, updated_at=? WHERE status='running'").run(current);
      return api.listMemoryReviews({ status: 'queued', limit: 500 });
    },
    putKnowledgeSource(input) {
      const current = timestamp();
      const id = input.id || `knowledge_source_${randomUUID()}`;
      db.prepare(`
        INSERT INTO knowledge_sources(id, vault_id, kind, title, origin, relative_path, content_hash, status, metadata_json, created_at, updated_at, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, origin=excluded.origin, relative_path=excluded.relative_path,
          content_hash=excluded.content_hash, status=excluded.status, metadata_json=excluded.metadata_json,
          updated_at=excluded.updated_at, accepted_at=excluded.accepted_at
      `).run(
        id, String(input.vaultId), String(input.kind || 'text'), String(input.title || ''), String(input.origin || ''),
        String(input.relativePath || ''), String(input.contentHash || ''), String(input.status || 'pending'),
        encode(input.metadata || {}), input.createdAt || current, current, input.acceptedAt || null,
      );
      return api.getKnowledgeSource(id);
    },
    getKnowledgeSource(id) {
      return mapKnowledgeSource(db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id));
    },
    findKnowledgeSource({ vaultId, origin = '', contentHash = '' }) {
      const row = origin
        ? db.prepare('SELECT * FROM knowledge_sources WHERE vault_id=? AND origin=? ORDER BY updated_at DESC LIMIT 1').get(vaultId, origin)
        : db.prepare('SELECT * FROM knowledge_sources WHERE vault_id=? AND content_hash=? ORDER BY updated_at DESC LIMIT 1').get(vaultId, contentHash);
      return mapKnowledgeSource(row);
    },
    listKnowledgeSources(vaultId, { status = '', limit = 100 } = {}) {
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      const rows = status
        ? db.prepare('SELECT * FROM knowledge_sources WHERE vault_id=? AND status=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, status, safeLimit)
        : db.prepare('SELECT * FROM knowledge_sources WHERE vault_id=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, safeLimit);
      return rows.map(mapKnowledgeSource);
    },
    updateKnowledgeSource(id, patch = {}) {
      const current = db.prepare('SELECT * FROM knowledge_sources WHERE id=?').get(id);
      if (!current) return null;
      db.prepare(`UPDATE knowledge_sources SET title=?, relative_path=?, content_hash=?, status=?, metadata_json=?, accepted_at=?, updated_at=? WHERE id=?`).run(
        patch.title === undefined ? current.title : String(patch.title || ''),
        patch.relativePath === undefined ? current.relative_path : String(patch.relativePath || ''),
        patch.contentHash === undefined ? current.content_hash : String(patch.contentHash || ''),
        patch.status === undefined ? current.status : String(patch.status || 'pending'),
        patch.metadata === undefined ? current.metadata_json : encode(patch.metadata || {}),
        patch.acceptedAt === undefined ? current.accepted_at : patch.acceptedAt || null,
        timestamp(), id,
      );
      return api.getKnowledgeSource(id);
    },
    putKnowledgeJob(input) {
      const current = timestamp();
      const existing = db.prepare('SELECT * FROM knowledge_jobs WHERE vault_id=? AND trigger_key=?').get(input.vaultId, input.triggerKey);
      if (existing) return mapKnowledgeJob(existing);
      const id = input.id || `knowledge_job_${randomUUID()}`;
      db.prepare(`INSERT INTO knowledge_jobs(
        id, vault_id, trigger_key, kind, status, attempts, model_snapshot_json, input_json, result_json,
        error, next_attempt_at, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, String(input.vaultId), String(input.triggerKey), String(input.kind || 'maintenance'), String(input.status || 'queued'),
        Number(input.attempts || 0), encode(input.modelSnapshot || {}), encode(input.input || {}), encode(input.result || {}),
        String(input.error || ''), input.nextAttemptAt || null, current, current, input.completedAt || null,
      );
      return api.getKnowledgeJob(id);
    },
    getKnowledgeJob(id) {
      return mapKnowledgeJob(db.prepare('SELECT * FROM knowledge_jobs WHERE id=?').get(id));
    },
    listKnowledgeJobs(vaultId, { status = '', limit = 100 } = {}) {
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      const rows = status
        ? db.prepare('SELECT * FROM knowledge_jobs WHERE vault_id=? AND status=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, status, safeLimit)
        : db.prepare('SELECT * FROM knowledge_jobs WHERE vault_id=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, safeLimit);
      return rows.map(mapKnowledgeJob);
    },
    updateKnowledgeJob(id, patch = {}) {
      const current = db.prepare('SELECT * FROM knowledge_jobs WHERE id=?').get(id);
      if (!current) return null;
      db.prepare(`UPDATE knowledge_jobs SET status=?, attempts=?, model_snapshot_json=?, input_json=?, result_json=?, error=?, next_attempt_at=?, completed_at=?, updated_at=? WHERE id=?`).run(
        patch.status === undefined ? current.status : String(patch.status),
        patch.attempts === undefined ? current.attempts : Number(patch.attempts || 0),
        patch.modelSnapshot === undefined ? current.model_snapshot_json : encode(patch.modelSnapshot || {}),
        patch.input === undefined ? current.input_json : encode(patch.input || {}),
        patch.result === undefined ? current.result_json : encode(patch.result || {}),
        patch.error === undefined ? current.error : String(patch.error || ''),
        patch.nextAttemptAt === undefined ? current.next_attempt_at : patch.nextAttemptAt || null,
        patch.completedAt === undefined ? current.completed_at : patch.completedAt || null,
        timestamp(), id,
      );
      return api.getKnowledgeJob(id);
    },
    recoverKnowledgeJobs() {
      db.prepare("UPDATE knowledge_jobs SET status='queued', error='', next_attempt_at=NULL, updated_at=? WHERE status='running'").run(timestamp());
      return db.prepare("SELECT * FROM knowledge_jobs WHERE status='queued' ORDER BY updated_at").all().map(mapKnowledgeJob);
    },
    putKnowledgeOperation(input) {
      const current = timestamp();
      const id = input.id || `knowledge_operation_${randomUUID()}`;
      api.transaction(() => {
        db.prepare(`INSERT INTO knowledge_operations(
          id, vault_id, job_id, kind, status, summary, risk, requires_review, actor_json, metadata_json,
          created_at, updated_at, published_at, rejected_at, rolled_back_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, String(input.vaultId), String(input.jobId || ''), String(input.kind || 'change_set'), String(input.status || 'proposed'),
            String(input.summary || ''), String(input.risk || 'normal'), input.requiresReview === false ? 0 : 1,
            encode(input.actor || {}), encode(input.metadata || {}), current, current, input.publishedAt || null, input.rejectedAt || null, input.rolledBackAt || null);
        const insert = db.prepare(`INSERT INTO knowledge_operation_files(
          operation_id, relative_path, action, base_hash, before_hash, after_hash, before_content, after_content, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const file of input.files || []) insert.run(
          id, String(file.relativePath), String(file.action || 'write'), String(file.baseHash || ''), String(file.beforeHash || ''),
          String(file.afterHash || ''), file.beforeContent ?? null, file.afterContent ?? null, encode(file.metadata || {}),
        );
      });
      return api.getKnowledgeOperation(id);
    },
    getKnowledgeOperation(id) {
      const operation = mapKnowledgeOperation(db.prepare('SELECT * FROM knowledge_operations WHERE id=?').get(id));
      if (!operation) return null;
      operation.files = db.prepare('SELECT * FROM knowledge_operation_files WHERE operation_id=? ORDER BY relative_path').all(id).map(mapKnowledgeOperationFile);
      return operation;
    },
    listKnowledgeOperations(vaultId, { status = '', limit = 100 } = {}) {
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      const rows = status
        ? db.prepare('SELECT * FROM knowledge_operations WHERE vault_id=? AND status=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, status, safeLimit)
        : db.prepare('SELECT * FROM knowledge_operations WHERE vault_id=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, safeLimit);
      return rows.map((row) => api.getKnowledgeOperation(row.id));
    },
    updateKnowledgeOperation(id, patch = {}) {
      const current = db.prepare('SELECT * FROM knowledge_operations WHERE id=?').get(id);
      if (!current) return null;
      db.prepare(`UPDATE knowledge_operations SET status=?, summary=?, risk=?, requires_review=?, metadata_json=?, published_at=?, rejected_at=?, rolled_back_at=?, updated_at=? WHERE id=?`).run(
        patch.status === undefined ? current.status : String(patch.status),
        patch.summary === undefined ? current.summary : String(patch.summary || ''),
        patch.risk === undefined ? current.risk : String(patch.risk || 'normal'),
        patch.requiresReview === undefined ? current.requires_review : patch.requiresReview ? 1 : 0,
        patch.metadata === undefined ? current.metadata_json : encode(patch.metadata || {}),
        patch.publishedAt === undefined ? current.published_at : patch.publishedAt || null,
        patch.rejectedAt === undefined ? current.rejected_at : patch.rejectedAt || null,
        patch.rolledBackAt === undefined ? current.rolled_back_at : patch.rolledBackAt || null,
        timestamp(), id,
      );
      return api.getKnowledgeOperation(id);
    },
    replaceVaultLinks(vaultId, links = []) {
      api.transaction(() => {
        db.prepare('DELETE FROM vault_links WHERE vault_id=?').run(vaultId);
        const insert = db.prepare('INSERT OR IGNORE INTO vault_links(vault_id, source_path, target_path, link_type) VALUES (?, ?, ?, ?)');
        for (const link of links) insert.run(vaultId, link.from, link.to, link.type || 'wikilink');
      });
      return links.length;
    },
    listVaultLinks(vaultId, { sourcePath = '', targetPath = '' } = {}) {
      let rows;
      if (sourcePath) rows = db.prepare('SELECT * FROM vault_links WHERE vault_id=? AND source_path=? ORDER BY target_path').all(vaultId, sourcePath);
      else if (targetPath) rows = db.prepare('SELECT * FROM vault_links WHERE vault_id=? AND target_path=? ORDER BY source_path').all(vaultId, targetPath);
      else rows = db.prepare('SELECT * FROM vault_links WHERE vault_id=? ORDER BY source_path, target_path').all(vaultId);
      return rows.map((row) => ({ vaultId: row.vault_id, from: row.source_path, to: row.target_path, type: row.link_type }));
    },
    replaceKnowledgeIssues(vaultId, issues = []) {
      const current = timestamp();
      api.transaction(() => {
        db.prepare('DELETE FROM knowledge_issues WHERE vault_id=?').run(vaultId);
        const insert = db.prepare('INSERT INTO knowledge_issues(id, vault_id, code, severity, relative_path, message, metadata_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const issue of issues) insert.run(issue.id || `knowledge_issue_${randomUUID()}`, vaultId, issue.code, issue.severity, issue.relativePath || '', issue.message, encode(issue.metadata || {}), issue.status || 'open', current, current);
      });
      return api.listKnowledgeIssues(vaultId);
    },
    listKnowledgeIssues(vaultId, { status = 'open', limit = 500 } = {}) {
      const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
      const rows = status
        ? db.prepare('SELECT * FROM knowledge_issues WHERE vault_id=? AND status=? ORDER BY severity, updated_at DESC LIMIT ?').all(vaultId, status, safeLimit)
        : db.prepare('SELECT * FROM knowledge_issues WHERE vault_id=? ORDER BY updated_at DESC LIMIT ?').all(vaultId, safeLimit);
      return rows.map(mapKnowledgeIssue);
    },
    replaceVaultDocuments(vaultId, documents = []) {
      const cleanVaultId = String(vaultId || '').trim();
      if (!cleanVaultId) throw new Error('Vault id is required.');
      api.transaction(() => {
        db.prepare('DELETE FROM vault_documents WHERE vault_id = ?').run(cleanVaultId);
        db.prepare('DELETE FROM vault_documents_fts WHERE vault_id = ?').run(cleanVaultId);
        const insert = db.prepare(`INSERT INTO vault_documents(
          vault_id, relative_path, content, title, document_type, content_hash, frontmatter_json, tags_json, confidence, sources_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertFts = db.prepare('INSERT INTO vault_documents_fts(vault_id, relative_path, content, updated_at) VALUES (?, ?, ?, ?)');
        for (const document of documents) {
          const values = [cleanVaultId, String(document.relativePath || ''), String(document.content || ''), String(document.updatedAt || timestamp())];
          insert.run(
            cleanVaultId, String(document.relativePath || ''), String(document.content || ''), String(document.title || ''),
            String(document.type || ''), String(document.contentHash || ''), encode(document.frontmatter || {}), encode(document.tags || []),
            String(document.confidence || ''), encode(document.sources || []), String(document.updatedAt || timestamp()),
          );
          insertFts.run(...values);
        }
      });
      return documents.length;
    },
    upsertVaultDocument(vaultId, document) {
      const cleanVaultId = String(vaultId || '').trim();
      const relativePath = String(document.relativePath || '');
      if (!cleanVaultId || !relativePath) throw new Error('Vault document identity is required.');
      api.transaction(() => {
        db.prepare('DELETE FROM vault_documents WHERE vault_id=? AND relative_path=?').run(cleanVaultId, relativePath);
        db.prepare('DELETE FROM vault_documents_fts WHERE vault_id=? AND relative_path=?').run(cleanVaultId, relativePath);
        db.prepare(`INSERT INTO vault_documents(
          vault_id, relative_path, content, title, document_type, content_hash, frontmatter_json, tags_json, confidence, sources_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          cleanVaultId, relativePath, String(document.content || ''), String(document.title || ''), String(document.type || ''),
          String(document.contentHash || ''), encode(document.frontmatter || {}), encode(document.tags || []), String(document.confidence || ''),
          encode(document.sources || []), String(document.updatedAt || timestamp()),
        );
        db.prepare('INSERT INTO vault_documents_fts(vault_id, relative_path, content, updated_at) VALUES (?, ?, ?, ?)')
          .run(cleanVaultId, relativePath, String(document.content || ''), String(document.updatedAt || timestamp()));
      });
      return api.getVaultDocument(cleanVaultId, relativePath);
    },
    removeVaultDocument(vaultId, relativePath) {
      api.transaction(() => {
        db.prepare('DELETE FROM vault_documents WHERE vault_id=? AND relative_path=?').run(vaultId, relativePath);
        db.prepare('DELETE FROM vault_documents_fts WHERE vault_id=? AND relative_path=?').run(vaultId, relativePath);
        db.prepare('DELETE FROM vault_links WHERE vault_id=? AND source_path=?').run(vaultId, relativePath);
      });
    },
    getVaultDocument(vaultId, relativePath) {
      const row = db.prepare('SELECT * FROM vault_documents WHERE vault_id=? AND relative_path=?').get(vaultId, relativePath);
      return row && ({ vaultId: row.vault_id, relativePath: row.relative_path, content: row.content, title: row.title, type: row.document_type,
        contentHash: row.content_hash, frontmatter: json(row.frontmatter_json), tags: json(row.tags_json, []), confidence: row.confidence,
        sources: json(row.sources_json, []), updatedAt: row.updated_at });
    },
    listVaultDocuments(vaultId) {
      return db.prepare('SELECT relative_path FROM vault_documents WHERE vault_id=? ORDER BY relative_path').all(vaultId)
        .map((row) => api.getVaultDocument(vaultId, row.relative_path));
    },
    replaceVaultDocumentLinks(vaultId, sourcePath, links = []) {
      api.transaction(() => {
        db.prepare('DELETE FROM vault_links WHERE vault_id=? AND source_path=?').run(vaultId, sourcePath);
        const insert = db.prepare('INSERT OR IGNORE INTO vault_links(vault_id, source_path, target_path, link_type) VALUES (?, ?, ?, ?)');
        for (const link of links) insert.run(vaultId, sourcePath, link.to, link.type || 'wikilink');
      });
      return links.length;
    },
    searchVaultDocuments(vaultId, query, limit = 20) {
      const terms = String(query || '').trim().split(/\s+/).filter(Boolean).slice(0, 8).map((term) => `"${term.replaceAll('"', '""')}"`);
      if (!vaultId || !terms.length) return [];
      return db.prepare(`
        SELECT relative_path, snippet(vault_documents_fts, 2, '', '', ' … ', 24) AS summary, updated_at,
          bm25(vault_documents_fts, 2.0, 1.0) AS raw_rank
        FROM vault_documents_fts
        WHERE vault_id = ? AND vault_documents_fts MATCH ?
        ORDER BY rank LIMIT ?
      `).all(String(vaultId), terms.join(' OR '), Math.max(1, Math.min(100, Number(limit) || 20))).map((row) => {
        const score = Math.max(0, Math.min(1, 1 / (1 + Math.abs(Number(row.raw_rank || 0)) * 100000)));
        return { relativePath: row.relative_path, sourcePath: row.relative_path, citation: `[[${row.relative_path.replace(/\.md$/i, '')}]]`, summary: row.summary, updatedAt: row.updated_at, score, rawRank: Number(row.raw_rank || 0) };
      });
    },
    appendKnowledgeCommit(input) {
      const record = {
        id: input.id || `knowledge_commit_${randomUUID()}`,
        workspaceId: input.workspaceId,
        vaultId: input.vaultId,
        runId: input.runId || '',
        operation: input.operation,
        relativePath: input.relativePath,
        sourcePath: input.sourcePath || '',
        metadata: input.metadata || {},
        createdAt: input.createdAt || timestamp(),
      };
      db.prepare(`
        INSERT INTO knowledge_commits(id, workspace_id, vault_id, run_id, operation, relative_path, source_path, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.workspaceId, record.vaultId, record.runId, record.operation, record.relativePath, record.sourcePath, encode(record.metadata), record.createdAt);
      return record;
    },
    listKnowledgeCommits(workspaceId, limit = 100) {
      return db.prepare('SELECT * FROM knowledge_commits WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(workspaceId, Math.max(1, Math.min(500, Number(limit) || 100))).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          vaultId: row.vault_id,
          runId: row.run_id,
          operation: row.operation,
          relativePath: row.relative_path,
          sourcePath: row.source_path,
          metadata: json(row.metadata_json),
          createdAt: row.created_at,
      }));
    },
    upsertThreadHarnessBinding(input) {
      const record = {
        threadId: String(input.threadId || ''),
        agentId: String(input.agentId || ''),
        harnessId: input.harnessId === 'pi' ? 'native' : String(input.harnessId || 'native'),
        boundAt: String(input.boundAt || timestamp()),
        source: String(input.source || 'thread_created'),
        bindingRevision: Math.max(1, Number(input.bindingRevision || 1)),
      };
      db.prepare(`INSERT INTO thread_agent_harness_bindings(thread_id, agent_id, harness_id, bound_at, source, binding_revision)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, agent_id) DO UPDATE SET harness_id=excluded.harness_id, bound_at=excluded.bound_at,
          source=excluded.source, binding_revision=excluded.binding_revision`)
        .run(record.threadId, record.agentId, record.harnessId, record.boundAt, record.source, record.bindingRevision);
      return record;
    },
    listThreadHarnessBindings(threadId) {
      return db.prepare('SELECT * FROM thread_agent_harness_bindings WHERE thread_id=? ORDER BY agent_id').all(threadId).map((row) => ({
        threadId: row.thread_id, agentId: row.agent_id, harnessId: row.harness_id, boundAt: row.bound_at,
        source: row.source, bindingRevision: Number(row.binding_revision),
      }));
    },
    getAgentContextCursor(threadId, agentId, harnessId) {
      const row = db.prepare('SELECT * FROM agent_context_cursors WHERE thread_id=? AND agent_id=? AND harness_id=?').get(threadId, agentId, harnessId === 'pi' ? 'native' : harnessId);
      return row && ({ threadId: row.thread_id, agentId: row.agent_id, harnessId: row.harness_id, sessionId: row.session_id,
        eventCursor: Number(row.event_cursor), stateRevision: Number(row.state_revision), profileRevision: row.profile_revision,
        memoryRevision: row.memory_revision, sourceIds: json(row.source_ids_json, []), updatedAt: row.updated_at });
    },
    upsertAgentContextCursor(input) {
      const harnessId = input.harnessId === 'pi' ? 'native' : String(input.harnessId || 'native');
      const updatedAt = String(input.updatedAt || timestamp());
      db.prepare(`INSERT INTO agent_context_cursors(thread_id, agent_id, harness_id, session_id, event_cursor, state_revision, profile_revision, memory_revision, source_ids_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, agent_id, harness_id) DO UPDATE SET session_id=excluded.session_id,
          event_cursor=MAX(agent_context_cursors.event_cursor, excluded.event_cursor), state_revision=excluded.state_revision,
          profile_revision=excluded.profile_revision, memory_revision=excluded.memory_revision,
          source_ids_json=excluded.source_ids_json, updated_at=excluded.updated_at`)
        .run(input.threadId, input.agentId, harnessId, input.sessionId || '', Number(input.eventCursor || 0), Number(input.stateRevision || 0),
          input.profileRevision || '', input.memoryRevision || '', encode(input.sourceIds || []), updatedAt);
      return api.getAgentContextCursor(input.threadId, input.agentId, harnessId);
    },
    upsertWorkTask(input) {
      const current = timestamp();
      const status = canonicalWorkTaskStatus(input.status);
      const existing = db.prepare('SELECT * FROM work_tasks WHERE workflow_id = ? AND idempotency_key = ?')
        .get(input.workflowId, input.idempotencyKey);
      const id = existing?.id || input.id || `work_task_${randomUUID()}`;
      const dependencies = Array.isArray(input.dependencies) ? input.dependencies.map(String).filter(Boolean) : [];
      const visited = new Set();
      const reaches = (candidateId) => {
        if (candidateId === id) return true;
        if (visited.has(candidateId)) return false;
        visited.add(candidateId);
        const candidate = api.getWorkTask(candidateId);
        return Boolean(candidate?.dependencies?.some((parentId) => reaches(String(parentId))));
      };
      if (dependencies.some((dependencyId) => reaches(dependencyId))) {
        throw Object.assign(new Error('工作流任务依赖形成循环。'), { code: 'WORKFLOW_DEPENDENCY_CYCLE', status: 409 });
      }
      db.prepare(`
        INSERT INTO work_tasks(
          id, workflow_id, title, description, assignee_agent_id, runtime_id, runtime_session_id,
          dependencies_json, status, acceptance_state, attempt, lease_token, lease_expires_at, idempotency_key, worktree_path,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, assignee_agent_id=excluded.assignee_agent_id,
          runtime_id=excluded.runtime_id, runtime_session_id=excluded.runtime_session_id,
          dependencies_json=excluded.dependencies_json, status=excluded.status, acceptance_state=excluded.acceptance_state, attempt=excluded.attempt,
          lease_token=excluded.lease_token,
          lease_expires_at=excluded.lease_expires_at, worktree_path=excluded.worktree_path,
          metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
      `).run(
        id, input.workflowId, input.title, input.description || '', input.assigneeAgentId || null,
        input.runtimeId || null, input.runtimeSessionId || null, encode(dependencies),
        status, input.acceptanceState || (status === 'completed' ? 'accepted' : 'pending'), Number(input.attempt || 0), input.leaseToken || '', input.leaseExpiresAt || null,
        input.idempotencyKey, input.worktreePath || null,
        encode({ ...json(existing?.metadata_json), ...(input.metadata || {}) }),
        existing?.created_at || current, current,
      );
      return api.getWorkTask(id);
    },
    getWorkTask(id) {
      const row = db.prepare('SELECT * FROM work_tasks WHERE id = ?').get(id);
      return row && ({
        id: row.id,
        workflowId: row.workflow_id,
        title: row.title,
        description: row.description,
        assigneeAgentId: row.assignee_agent_id,
        runtimeId: row.runtime_id,
        runtimeSessionId: row.runtime_session_id,
        dependencies: json(row.dependencies_json, []),
        status: row.status,
        acceptanceState: row.acceptance_state || 'pending',
        attempt: Number(row.attempt),
        leaseToken: row.lease_token || '',
        leaseExpiresAt: row.lease_expires_at,
        idempotencyKey: row.idempotency_key,
        worktreePath: row.worktree_path,
        metadata: json(row.metadata_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    },
    listWorkTasks(workflowId, statuses = []) {
      const safeStatuses = statuses.filter(Boolean);
      const rows = safeStatuses.length
        ? db.prepare(`SELECT id FROM work_tasks WHERE workflow_id = ? AND status IN (${placeholders(safeStatuses)}) ORDER BY created_at`).all(workflowId, ...safeStatuses)
        : db.prepare('SELECT id FROM work_tasks WHERE workflow_id = ? ORDER BY created_at').all(workflowId);
      return rows.map((row) => api.getWorkTask(row.id));
    },
    claimWorkTask(id, { leaseMs = 120000, runtimeSessionId = null, worktreePath = null, leaseToken = randomUUID() } = {}) {
      const current = timestamp();
      const leaseExpiresAt = new Date(Date.now() + Math.max(30000, Number(leaseMs) || 120000)).toISOString();
      const result = db.prepare(`
        UPDATE work_tasks
        SET status='running', acceptance_state='pending', attempt=attempt + 1, lease_token=?, lease_expires_at=?,
            runtime_session_id=COALESCE(?, runtime_session_id),
            worktree_path=COALESCE(?, worktree_path), updated_at=?
        WHERE id=? AND (
          status='ready'
          OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM work_tasks AS sibling
          WHERE sibling.workflow_id = work_tasks.workflow_id
            AND sibling.id <> work_tasks.id
            AND sibling.assignee_agent_id IS work_tasks.assignee_agent_id
            AND sibling.status IN ('running', 'waiting_input')
            AND sibling.lease_expires_at IS NOT NULL
            AND sibling.lease_expires_at >= ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM json_each(work_tasks.dependencies_json) AS dependency
          LEFT JOIN work_tasks AS parent ON parent.id = dependency.value
          WHERE COALESCE(parent.status, '') NOT IN ('completed', 'done')
        )
      `).run(leaseToken, leaseExpiresAt, runtimeSessionId, worktreePath, current, id, current, current);
      return Number(result.changes || 0) === 1 ? api.getWorkTask(id) : null;
    },
    heartbeatWorkTask(id, { leaseMs = 120000, leaseToken = '' } = {}) {
      const current = timestamp();
      const leaseExpiresAt = new Date(Date.now() + Math.max(30000, Number(leaseMs) || 120000)).toISOString();
      const result = db.prepare(`
        UPDATE work_tasks SET lease_expires_at=?, updated_at=?
        WHERE id=? AND status='running' AND (? = '' OR lease_token = ?)
      `).run(leaseExpiresAt, current, id, leaseToken, leaseToken);
      return Number(result.changes || 0) === 1 ? api.getWorkTask(id) : null;
    },
    recoverExpiredWorkTasks(workflowId, at = timestamp()) {
      const ids = db.prepare(`
        SELECT id FROM work_tasks
        WHERE workflow_id=? AND status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
        ORDER BY created_at
      `).all(workflowId, at).map((row) => row.id);
      if (!ids.length) return [];
      db.prepare(`
        UPDATE work_tasks SET status='ready', runtime_session_id=NULL, lease_token='', lease_expires_at=NULL, updated_at=?
        WHERE workflow_id=? AND status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
      `).run(timestamp(), workflowId, at);
      return ids.map((id) => api.getWorkTask(id)).filter(Boolean);
    },
    upsertCollaborationWorkflow(input) {
      const current = timestamp();
      const id = String(input.id || `workflow_${randomUUID()}`);
      db.prepare(`INSERT INTO collaboration_workflows(id, conversation_id, coordinator_agent_id, project_id, status, active_plan_revision_id, revision, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id, coordinator_agent_id=excluded.coordinator_agent_id,
          project_id=excluded.project_id, status=excluded.status, active_plan_revision_id=excluded.active_plan_revision_id,
          revision=MAX(collaboration_workflows.revision, excluded.revision), metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`)
        .run(id, input.conversationId, input.coordinatorAgentId || '', input.projectId || null, input.status || 'draft', input.activePlanRevisionId || null,
          Number(input.revision || 0), encode(input.metadata || {}), input.createdAt || current, current);
      return api.getCollaborationWorkflow(id);
    },
    getCollaborationWorkflow(id) {
      const row = db.prepare('SELECT * FROM collaboration_workflows WHERE id=?').get(id);
      return row && ({ id: row.id, conversationId: row.conversation_id, coordinatorAgentId: row.coordinator_agent_id, projectId: row.project_id,
        status: row.status, activePlanRevisionId: row.active_plan_revision_id, revision: Number(row.revision), metadata: json(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at });
    },
    listCollaborationWorkflows(conversationId, statuses = []) {
      const safeStatuses = statuses.filter(Boolean);
      const rows = safeStatuses.length
        ? db.prepare(`SELECT id FROM collaboration_workflows WHERE conversation_id=? AND status IN (${placeholders(safeStatuses)}) ORDER BY updated_at DESC`).all(conversationId, ...safeStatuses)
        : db.prepare('SELECT id FROM collaboration_workflows WHERE conversation_id=? ORDER BY updated_at DESC').all(conversationId);
      return rows.map((row) => api.getCollaborationWorkflow(row.id));
    },
    putCollaborationDependency(input) {
      const parentTaskId = String(input.parentTaskId || '');
      const childTaskId = String(input.childTaskId || '');
      if (!parentTaskId || !childTaskId) throw Object.assign(new Error('任务依赖缺少父任务或子任务。'), { status: 400, code: 'WORKFLOW_DEPENDENCY_REQUIRED' });
      const visited = new Set();
      const reachesParent = (taskId) => {
        if (taskId === parentTaskId) return true;
        if (visited.has(taskId)) return false;
        visited.add(taskId);
        return db.prepare('SELECT child_task_id FROM collaboration_dependencies WHERE parent_task_id=?').all(taskId).some((row) => reachesParent(row.child_task_id));
      };
      if (parentTaskId === childTaskId || reachesParent(childTaskId)) throw Object.assign(new Error('工作流任务依赖形成循环。'), { status: 409, code: 'WORKFLOW_DEPENDENCY_CYCLE' });
      db.prepare(`INSERT INTO collaboration_dependencies(parent_task_id, child_task_id, created_by_task_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(parent_task_id, child_task_id) DO NOTHING`)
        .run(parentTaskId, childTaskId, input.createdByTaskId || null, input.reason || '', input.createdAt || timestamp());
      return { parentTaskId, childTaskId, createdByTaskId: input.createdByTaskId || null, reason: input.reason || '' };
    },
    listCollaborationDependencies(taskId) {
      return db.prepare('SELECT * FROM collaboration_dependencies WHERE parent_task_id=? OR child_task_id=? ORDER BY created_at').all(taskId, taskId).map((row) => ({
        parentTaskId: row.parent_task_id, childTaskId: row.child_task_id, createdByTaskId: row.created_by_task_id, reason: row.reason, createdAt: row.created_at,
      }));
    },
    removeCollaborationDependency(parentTaskId, childTaskId) {
      const result = db.prepare('DELETE FROM collaboration_dependencies WHERE parent_task_id=? AND child_task_id=?').run(parentTaskId, childTaskId);
      return Number(result.changes || 0) > 0;
    },
    putPlanRevision(input) {
      const id = String(input.id || `plan_revision_${randomUUID()}`);
      db.prepare(`INSERT INTO collaboration_plan_revisions(id, workflow_id, revision, content_json, status, confirmed_by, confirmed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workflow_id, revision) DO NOTHING`)
        .run(id, input.workflowId, Number(input.revision), encode(input.content || {}), input.status || 'draft', input.confirmedBy || null, input.confirmedAt || null, input.createdAt || timestamp());
      const row = db.prepare('SELECT * FROM collaboration_plan_revisions WHERE workflow_id=? AND revision=?').get(input.workflowId, Number(input.revision));
      return row && ({ id: row.id, workflowId: row.workflow_id, revision: Number(row.revision), content: json(row.content_json), status: row.status, confirmedBy: row.confirmed_by, confirmedAt: row.confirmed_at, createdAt: row.created_at });
    },
    upsertWorkflowProposal(input) {
      const current = timestamp();
      const id = String(input.id || `workflow_proposal_${randomUUID()}`);
      const conversationId = String(input.conversationId || '');
      const idempotencyKey = String(input.idempotencyKey || id);
      if (!conversationId) throw Object.assign(new Error('协作提案缺少会话。'), { status: 400, code: 'WORKFLOW_PROPOSAL_CONVERSATION_REQUIRED' });
      db.prepare(`INSERT INTO workflow_proposals(
        id, conversation_id, workflow_id, source_plan_id, proposal_message_id, revision, purpose, status,
        title, summary, content_json, idempotency_key, confirmed_by, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, idempotency_key) DO UPDATE SET
        workflow_id=COALESCE(excluded.workflow_id, workflow_proposals.workflow_id),
        source_plan_id=COALESCE(excluded.source_plan_id, workflow_proposals.source_plan_id),
        proposal_message_id=COALESCE(excluded.proposal_message_id, workflow_proposals.proposal_message_id),
        revision=MAX(workflow_proposals.revision, excluded.revision),
        purpose=excluded.purpose,
        status=CASE
          WHEN workflow_proposals.status IN ('confirmed','cancelled') THEN workflow_proposals.status
          ELSE excluded.status
        END,
        title=excluded.title,
        summary=excluded.summary,
        content_json=excluded.content_json,
        confirmed_by=COALESCE(excluded.confirmed_by, workflow_proposals.confirmed_by),
        confirmed_at=COALESCE(excluded.confirmed_at, workflow_proposals.confirmed_at),
        updated_at=excluded.updated_at`).run(
        id, conversationId, input.workflowId || null, input.sourcePlanId || null, input.proposalMessageId || null, Math.max(1, Number(input.revision || 1)),
        input.purpose === 'collaboration' ? 'collaboration' : 'collaboration', input.status || 'pending_confirmation',
        String(input.title || '').slice(0, 240), String(input.summary || '').slice(0, 4000), encode(input.content || {}),
        idempotencyKey, input.confirmedBy || null, input.confirmedAt || null, input.createdAt || current, current,
      );
      const row = db.prepare('SELECT * FROM workflow_proposals WHERE conversation_id=? AND idempotency_key=?').get(conversationId, idempotencyKey);
      return row && ({
        id: row.id,
        conversationId: row.conversation_id,
        workflowId: row.workflow_id,
        sourcePlanId: row.source_plan_id,
        proposalMessageId: row.proposal_message_id,
        revision: Number(row.revision),
        purpose: row.purpose,
        status: row.status,
        title: row.title,
        summary: row.summary,
        content: json(row.content_json),
        idempotencyKey: row.idempotency_key,
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    },
    getWorkflowProposal(id) {
      const row = db.prepare('SELECT * FROM workflow_proposals WHERE id=?').get(String(id || ''));
      return row && ({
        id: row.id,
        conversationId: row.conversation_id,
        workflowId: row.workflow_id,
        sourcePlanId: row.source_plan_id,
        proposalMessageId: row.proposal_message_id,
        revision: Number(row.revision),
        purpose: row.purpose,
        status: row.status,
        title: row.title,
        summary: row.summary,
        content: json(row.content_json),
        idempotencyKey: row.idempotency_key,
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    },
    listWorkflowProposals(conversationId, statuses = []) {
      const safeStatuses = statuses.filter(Boolean);
      const rows = safeStatuses.length
        ? db.prepare(`SELECT id FROM workflow_proposals WHERE conversation_id=? AND status IN (${placeholders(safeStatuses)}) ORDER BY updated_at DESC`).all(conversationId, ...safeStatuses)
        : db.prepare('SELECT id FROM workflow_proposals WHERE conversation_id=? ORDER BY updated_at DESC').all(conversationId);
      return rows.map((row) => api.getWorkflowProposal(row.id)).filter(Boolean);
    },
    confirmWorkflowProposal(id, { revision = 1, confirmedBy = 'user', workflowId = undefined } = {}) {
      const current = timestamp();
      const proposalId = String(id || '');
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT * FROM workflow_proposals WHERE id=?').get(proposalId);
        if (!row) throw Object.assign(new Error('协作提案不存在。'), { status: 404, code: 'WORKFLOW_PROPOSAL_NOT_FOUND' });
        if (Number(row.revision) !== Number(revision)) throw Object.assign(new Error('协作提案版本已过期。'), { status: 409, code: 'WORKFLOW_PROPOSAL_REVISION_STALE' });
        if (row.status === 'confirmed') {
          db.exec('COMMIT');
          return api.getWorkflowProposal(proposalId);
        }
        if (!['pending_confirmation','draft'].includes(row.status)) throw Object.assign(new Error('协作提案当前不能确认。'), { status: 409, code: 'WORKFLOW_PROPOSAL_NOT_CONFIRMABLE' });
        db.prepare("UPDATE workflow_proposals SET status='confirmed', workflow_id=COALESCE(?, workflow_id), confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=? AND revision=? AND status IN ('pending_confirmation','draft')").run(workflowId || null, String(confirmedBy || 'user'), current, current, proposalId, Number(revision));
        db.exec('COMMIT');
        return api.getWorkflowProposal(proposalId);
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    },
    cancelWorkflowProposal(id) {
      const result = db.prepare("UPDATE workflow_proposals SET status='cancelled', updated_at=? WHERE id=? AND status NOT IN ('confirmed','cancelled')").run(timestamp(), String(id || ''));
      return Number(result.changes || 0) > 0 ? api.getWorkflowProposal(id) : null;
    },
    confirmPlanRevision(workflowId, revision, confirmedBy = 'user') {
      const current = timestamp();
      db.exec('BEGIN IMMEDIATE');
      try {
        const workflow = api.getCollaborationWorkflow(workflowId);
        const plan = db.prepare('SELECT * FROM collaboration_plan_revisions WHERE workflow_id=? AND revision=?').get(workflowId, Number(revision));
        if (!workflow || !plan) throw Object.assign(new Error('执行计划版本不存在。'), { status: 404, code: 'PLAN_REVISION_NOT_FOUND' });
        if (Number(workflow.revision) > Number(revision)) throw Object.assign(new Error('执行计划确认已经过期。'), { status: 409, code: 'PLAN_REVISION_STALE' });
        db.prepare("UPDATE collaboration_plan_revisions SET status='confirmed', confirmed_by=?, confirmed_at=? WHERE id=? AND status IN ('draft','pending_confirmation')").run(confirmedBy, current, plan.id);
        db.prepare("UPDATE collaboration_workflows SET active_plan_revision_id=?, revision=?, status='active', updated_at=? WHERE id=?").run(plan.id, Number(revision), current, workflowId);
        db.exec('COMMIT');
        return api.getCollaborationWorkflow(workflowId);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    putCollaborationIntervention(input) {
      const current = timestamp();
      const id = String(input.id || `intervention_${randomUUID()}`);
      db.prepare(`INSERT INTO collaboration_interventions(id, workflow_id, task_id, target_agent_id, status, message, idempotency_key, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workflow_id, idempotency_key) DO UPDATE SET updated_at=excluded.updated_at`)
        .run(id, input.workflowId, input.taskId || null, input.targetAgentId || null, input.status || 'queued', input.message || '', input.idempotencyKey, encode(input.metadata || {}), input.createdAt || current, current);
      const row = db.prepare('SELECT * FROM collaboration_interventions WHERE workflow_id=? AND idempotency_key=?').get(input.workflowId, input.idempotencyKey);
      return row && ({ id: row.id, workflowId: row.workflow_id, taskId: row.task_id, targetAgentId: row.target_agent_id, status: row.status, message: row.message, idempotencyKey: row.idempotency_key, metadata: json(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at });
    },
    updateCollaborationIntervention(id, status, metadata = {}) {
      const row = db.prepare('SELECT * FROM collaboration_interventions WHERE id=?').get(id);
      if (!row) return null;
      db.prepare('UPDATE collaboration_interventions SET status=?, metadata_json=?, updated_at=? WHERE id=?').run(status, encode({ ...json(row.metadata_json), ...metadata }), timestamp(), id);
      return api.putCollaborationIntervention({ id: row.id, workflowId: row.workflow_id, taskId: row.task_id, targetAgentId: row.target_agent_id, status, message: row.message, idempotencyKey: row.idempotency_key, metadata: { ...json(row.metadata_json), ...metadata }, createdAt: row.created_at });
    },
    listCollaborationInterventions({ workflowId = '', taskId = '', statuses = [] } = {}) {
      const clauses = [];
      const values = [];
      if (workflowId) { clauses.push('workflow_id=?'); values.push(String(workflowId)); }
      if (taskId) { clauses.push('task_id=?'); values.push(String(taskId)); }
      if (statuses.length) {
        clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
        values.push(...statuses.map(String));
      }
      const rows = db.prepare(`SELECT * FROM collaboration_interventions${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at, id`).all(...values);
      return rows.map((row) => ({ id: row.id, workflowId: row.workflow_id, taskId: row.task_id, targetAgentId: row.target_agent_id, status: row.status, message: row.message, idempotencyKey: row.idempotency_key, metadata: json(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at }));
    },
    putCollaborationArtifact(input) {
      const id = String(input.id || `artifact_${randomUUID()}`);
      db.prepare(`INSERT INTO collaboration_artifacts(id, workflow_id, task_id, path, content_hash, status, metadata_json, published_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workflow_id, task_id, path) DO UPDATE SET content_hash=excluded.content_hash,
          status=excluded.status, metadata_json=excluded.metadata_json, published_at=excluded.published_at`)
        .run(id, input.workflowId, input.taskId || null, input.path, input.contentHash || '', input.status || 'draft', encode(input.metadata || {}), input.publishedAt || null, input.createdAt || timestamp());
      const row = db.prepare('SELECT * FROM collaboration_artifacts WHERE workflow_id=? AND task_id IS ? AND path=?').get(input.workflowId, input.taskId || null, input.path);
      return row ? {
        id: row.id,
        workflowId: row.workflow_id,
        taskId: row.task_id,
        path: row.path,
        contentHash: row.content_hash || '',
        status: row.status,
        metadata: json(row.metadata_json, {}),
        publishedAt: row.published_at,
        createdAt: row.created_at,
      } : { id, workflowId: input.workflowId, taskId: input.taskId || null, path: input.path, contentHash: input.contentHash || '', status: input.status || 'draft', publishedAt: input.publishedAt || null };
    },
    listCollaborationArtifacts({ workflowId = '', path = '' } = {}) {
      const clauses = [];
      const args = [];
      if (workflowId) { clauses.push('workflow_id=?'); args.push(workflowId); }
      if (path) { clauses.push('path=?'); args.push(path); }
      return db.prepare(`SELECT * FROM collaboration_artifacts ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at`).all(...args).map((row) => ({
        id: row.id,
        workflowId: row.workflow_id,
        taskId: row.task_id,
        path: row.path,
        contentHash: row.content_hash || '',
        status: row.status,
        metadata: json(row.metadata_json, {}),
        publishedAt: row.published_at,
        createdAt: row.created_at,
      }));
    },
    appendCollaborationEvent(input) {
      const id = String(input.id || `collaboration_event_${randomUUID()}`);
      db.prepare(`INSERT INTO collaboration_events(id, type, workflow_id, task_id, run_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .run(id, input.type, input.workflowId, input.taskId || null, input.runId || null, encode(input.payload || {}), input.createdAt || timestamp());
      const row = db.prepare('SELECT * FROM collaboration_events WHERE id=?').get(id);
      return row && ({ id: row.id, cursor: Number(row.cursor), type: row.type, workflowId: row.workflow_id, taskId: row.task_id, runId: row.run_id, payload: json(row.payload_json), createdAt: row.created_at });
    },
    collaborationEventsAfter(workflowId, cursor = 0) {
      return db.prepare('SELECT * FROM collaboration_events WHERE workflow_id=? AND cursor>? ORDER BY cursor').all(workflowId, Number(cursor || 0)).map((row) => ({
        id: row.id, cursor: Number(row.cursor), type: row.type, workflowId: row.workflow_id, taskId: row.task_id, runId: row.run_id, payload: json(row.payload_json), createdAt: row.created_at,
      }));
    },
    putInboxItem(input) {
      const current = timestamp();
      const id = String(input.id || `inbox_${randomUUID()}`);
      const idempotencyKey = String(input.idempotencyKey || id);
      db.prepare(`INSERT INTO inbox_items(
        id, idempotency_key, workspace_id, thread_id, workflow_id, task_id, type, title, summary,
        priority, action_required, read_at, resolved_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        title=excluded.title, summary=excluded.summary, priority=excluded.priority,
        action_required=excluded.action_required,
        resolved_at=CASE WHEN excluded.action_required=0 THEN COALESCE(inbox_items.resolved_at, excluded.updated_at) ELSE inbox_items.resolved_at END,
        metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).run(
        id, idempotencyKey, input.workspaceId || '', input.threadId, input.workflowId || null, input.taskId || null,
        input.type, String(input.title || '').slice(0, 240), String(input.summary || '').slice(0, 4000),
        ['normal', 'important', 'urgent'].includes(input.priority) ? input.priority : 'normal', input.actionRequired ? 1 : 0,
        input.readAt || null, input.resolvedAt || null, encode(input.metadata || {}), input.createdAt || current, current,
      );
      const row = db.prepare('SELECT * FROM inbox_items WHERE idempotency_key=?').get(idempotencyKey);
      return row && ({
        id: row.id, cursor: Number(row.cursor), idempotencyKey: row.idempotency_key, workspaceId: row.workspace_id,
        threadId: row.thread_id, workflowId: row.workflow_id, taskId: row.task_id, type: row.type, title: row.title,
        summary: row.summary, priority: row.priority, actionRequired: Boolean(row.action_required), readAt: row.read_at,
        resolvedAt: row.resolved_at, metadata: json(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at,
      });
    },
    listInboxItems({ workspaceId = '', threadId = '', unresolvedOnly = false, unreadOnly = false, limit = 200 } = {}) {
      const clauses = [];
      const args = [];
      if (workspaceId) { clauses.push('workspace_id=?'); args.push(workspaceId); }
      if (threadId) { clauses.push('thread_id=?'); args.push(threadId); }
      if (unresolvedOnly) clauses.push('action_required=1 AND resolved_at IS NULL');
      if (unreadOnly) clauses.push('read_at IS NULL');
      args.push(Math.max(1, Math.min(500, Number(limit || 200))));
      return db.prepare(`SELECT * FROM inbox_items${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY (action_required=1 AND resolved_at IS NULL) DESC, updated_at DESC LIMIT ?`).all(...args).map((row) => ({
        id: row.id, cursor: Number(row.cursor), idempotencyKey: row.idempotency_key, workspaceId: row.workspace_id,
        threadId: row.thread_id, workflowId: row.workflow_id, taskId: row.task_id, type: row.type, title: row.title,
        summary: row.summary, priority: row.priority, actionRequired: Boolean(row.action_required), readAt: row.read_at,
        resolvedAt: row.resolved_at, metadata: json(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at,
      }));
    },
    inboxItemsAfter(cursor = 0, workspaceId = '') {
      const rows = workspaceId
        ? db.prepare('SELECT * FROM inbox_items WHERE cursor>? AND workspace_id=? ORDER BY cursor').all(Number(cursor || 0), workspaceId)
        : db.prepare('SELECT * FROM inbox_items WHERE cursor>? ORDER BY cursor').all(Number(cursor || 0));
      return rows.map((row) => ({
        id: row.id, cursor: Number(row.cursor), idempotencyKey: row.idempotency_key, workspaceId: row.workspace_id,
        threadId: row.thread_id, workflowId: row.workflow_id, taskId: row.task_id, type: row.type, title: row.title,
        summary: row.summary, priority: row.priority, actionRequired: Boolean(row.action_required), readAt: row.read_at,
        resolvedAt: row.resolved_at, metadata: json(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at,
      }));
    },
    updateInboxItem(id, patch = {}) {
      const row = db.prepare('SELECT * FROM inbox_items WHERE id=?').get(String(id || ''));
      if (!row) return null;
      const readAt = patch.read === true ? timestamp() : patch.read === false ? null : row.read_at;
      const resolvedAt = patch.resolved === true ? timestamp() : patch.resolved === false ? null : row.resolved_at;
      db.prepare('UPDATE inbox_items SET read_at=?, resolved_at=?, updated_at=? WHERE id=?').run(readAt, resolvedAt, timestamp(), row.id);
      return api.listInboxItems({ limit: 500 }).find((item) => item.id === row.id) || null;
    },
    bindTaskRun(input) {
      db.prepare(`INSERT INTO task_run_bindings(task_id, run_id, lease_token, bound_at, ended_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(task_id, run_id) DO UPDATE SET lease_token=excluded.lease_token, ended_at=excluded.ended_at`)
        .run(input.taskId, input.runId, input.leaseToken || '', input.boundAt || timestamp(), input.endedAt || null);
      return { taskId: input.taskId, runId: input.runId, leaseToken: input.leaseToken || '', boundAt: input.boundAt || timestamp(), endedAt: input.endedAt || null };
    },
    getTaskRunBinding(taskId, runId) {
      const row = db.prepare('SELECT * FROM task_run_bindings WHERE task_id=? AND run_id=?').get(taskId, runId);
      return row && ({ taskId: row.task_id, runId: row.run_id, leaseToken: row.lease_token || '', boundAt: row.bound_at, endedAt: row.ended_at });
    },
  };

  return api;
}
