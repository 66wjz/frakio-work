import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;

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

function placeholders(values) {
  return values.map(() => '?').join(',');
}

export function createRuntimeStore(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
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
      native_session_id TEXT NOT NULL DEFAULT '',
      profile_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(thread_id, agent_id, runtime_id, workspace_id)
    );
    CREATE INDEX IF NOT EXISTS runtime_sessions_thread_idx ON runtime_sessions(thread_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      profile_revision TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
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
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, cursor),
      FOREIGN KEY(run_id) REFERENCES runtime_runs(id),
      FOREIGN KEY(session_id) REFERENCES runtime_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS runtime_events_run_idx ON runtime_events(run_id, cursor);
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
      status TEXT NOT NULL DEFAULT 'planned',
      attempt INTEGER NOT NULL DEFAULT 0,
      lease_expires_at TEXT,
      idempotency_key TEXT NOT NULL,
      worktree_path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workflow_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS work_tasks_workflow_idx ON work_tasks(workflow_id, status, updated_at);
  `);
  db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));

  const mapSession = (row) => row && ({
    id: row.id,
    runtimeId: row.runtime_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    nativeSessionId: row.native_session_id,
    profileRevision: row.profile_revision,
    status: row.status,
    metadata: json(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const mapRun = (row) => row && ({
    id: row.id,
    sessionId: row.session_id,
    runtimeId: row.runtime_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    turnId: row.turn_id,
    profileRevision: row.profile_revision,
    modelId: row.model_id,
    status: row.status,
    error: row.error,
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
    type: row.type,
    payload: json(row.payload_json),
    createdAt: row.created_at,
  });

  const api = {
    filePath,
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
      const existing = db.prepare(`
        SELECT * FROM runtime_sessions
        WHERE thread_id = ? AND agent_id = ? AND runtime_id = ? AND workspace_id = ?
      `).get(input.threadId, input.agentId, input.runtimeId, input.workspaceId || '');
      const id = existing?.id || input.id || `runtime_session_${randomUUID()}`;
      const createdAt = existing?.created_at || input.createdAt || current;
      db.prepare(`
        INSERT INTO runtime_sessions(
          id, runtime_id, thread_id, agent_id, workspace_id, native_session_id,
          profile_revision, status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          native_session_id=excluded.native_session_id,
          profile_revision=excluded.profile_revision,
          status=excluded.status,
          metadata_json=excluded.metadata_json,
          updated_at=excluded.updated_at
      `).run(
        id, input.runtimeId, input.threadId, input.agentId, input.workspaceId || '',
        input.nativeSessionId || existing?.native_session_id || '',
        input.profileRevision || existing?.profile_revision || '',
        input.status || existing?.status || 'idle',
        encode({ ...json(existing?.metadata_json), ...(input.metadata || {}) }),
        createdAt, current,
      );
      return api.getSession(id);
    },
    getSession(id) {
      return mapSession(db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(id));
    },
    findSession({ threadId, agentId, runtimeId, workspaceId = '' }) {
      return mapSession(db.prepare(`
        SELECT * FROM runtime_sessions
        WHERE thread_id = ? AND agent_id = ? AND runtime_id = ? AND workspace_id = ?
      `).get(threadId, agentId, runtimeId, workspaceId));
    },
    listSessions({ threadId = '', agentId = '', runtimeId = '', limit = 100 } = {}) {
      const clauses = [];
      const args = [];
      if (threadId) { clauses.push('thread_id = ?'); args.push(threadId); }
      if (agentId) { clauses.push('agent_id = ?'); args.push(agentId); }
      if (runtimeId) { clauses.push('runtime_id = ?'); args.push(runtimeId); }
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM runtime_sessions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`)
        .all(...args).map(mapSession);
    },
    createRun(input) {
      const startedAt = input.startedAt || timestamp();
      const id = input.id || `runtime_run_${randomUUID()}`;
      db.prepare(`
        INSERT INTO runtime_runs(
          id, session_id, runtime_id, thread_id, agent_id, turn_id, profile_revision,
          model_id, status, error, metadata_json, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.sessionId, input.runtimeId, input.threadId, input.agentId, input.turnId,
        input.profileRevision || '', input.modelId || '', input.status || 'starting',
        input.error || '', encode(input.metadata), startedAt, input.completedAt || null,
      );
      return api.getRun(id);
    },
    getRun(id) {
      return mapRun(db.prepare('SELECT * FROM runtime_runs WHERE id = ?').get(id));
    },
    updateRun(id, patch) {
      const current = api.getRun(id);
      if (!current) return null;
      const status = patch.status || current.status;
      const completedAt = patch.completedAt === undefined
        ? (['completed', 'failed', 'cancelled'].includes(status) ? current.completedAt || timestamp() : current.completedAt)
        : patch.completedAt;
      db.prepare(`
        UPDATE runtime_runs SET status=?, error=?, metadata_json=?, completed_at=? WHERE id=?
      `).run(
        status, patch.error === undefined ? current.error : String(patch.error || ''),
        encode({ ...current.metadata, ...(patch.metadata || {}) }), completedAt || null, id,
      );
      return api.getRun(id);
    },
    appendEvent(input) {
      const run = api.getRun(input.runId);
      if (!run) throw new Error(`Runtime run does not exist: ${input.runId}`);
      const nextCursor = Number(input.cursor) || Number(db.prepare('SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM runtime_events WHERE run_id = ?').get(input.runId)?.cursor || 1);
      const event = {
        id: input.id || `runtime_event_${randomUUID()}`,
        cursor: nextCursor,
        runId: input.runId,
        sessionId: input.sessionId || run.sessionId,
        runtimeId: input.runtimeId || run.runtimeId,
        type: input.type,
        payload: input.payload || {},
        createdAt: input.createdAt || timestamp(),
      };
      db.prepare(`
        INSERT OR IGNORE INTO runtime_events(id, cursor, run_id, session_id, runtime_id, type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event.id, event.cursor, event.runId, event.sessionId, event.runtimeId, event.type, encode(event.payload), event.createdAt);
      return mapEvent(db.prepare('SELECT * FROM runtime_events WHERE run_id = ? AND cursor = ?').get(event.runId, event.cursor));
    },
    eventsAfter(runId, cursor = 0, limit = 1000) {
      return db.prepare('SELECT * FROM runtime_events WHERE run_id = ? AND cursor > ? ORDER BY cursor ASC LIMIT ?')
        .all(runId, Math.max(0, Number(cursor) || 0), Math.max(1, Math.min(2000, Number(limit) || 1000))).map(mapEvent);
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
    listMemory({ scope = '', subjectId = '', status = '', query = '', limit = 100 } = {}) {
      const clauses = [];
      const args = [];
      if (scope) { clauses.push('scope = ?'); args.push(scope); }
      if (subjectId) { clauses.push('subject_id = ?'); args.push(subjectId); }
      if (status) { clauses.push('status = ?'); args.push(status); }
      if (query) { clauses.push('(fact LIKE ? OR normalized_fact LIKE ?)'); args.push(`%${query}%`, `%${String(query).toLowerCase()}%`); }
      args.push(Math.max(1, Math.min(500, Number(limit) || 100)));
      return db.prepare(`SELECT * FROM memory_entries ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`)
        .all(...args).map((row) => ({
          id: row.id,
          scope: row.scope,
          subjectId: row.subject_id,
          fact: row.fact,
          provenance: json(row.provenance_json, []),
          confidence: Number(row.confidence),
          status: row.status,
          validFrom: row.valid_from,
          validUntil: row.valid_until,
          supersedesId: row.supersedes_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },
    putMemory(input) {
      const current = timestamp();
      const normalizedFact = String(input.fact || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!normalizedFact) throw new Error('Memory fact is required.');
      const duplicate = db.prepare(`
        SELECT * FROM memory_entries
        WHERE scope = ? AND subject_id = ? AND normalized_fact = ? AND status IN ('candidate', 'accepted')
        ORDER BY updated_at DESC LIMIT 1
      `).get(input.scope, input.subjectId, normalizedFact);
      if (duplicate && !input.forceNew) {
        const provenance = [...json(duplicate.provenance_json, []), ...(input.provenance || [])].slice(-50);
        db.prepare('UPDATE memory_entries SET provenance_json=?, confidence=?, updated_at=? WHERE id=?')
          .run(encode(provenance), Math.max(Number(duplicate.confidence), Number(input.confidence || 0.5)), current, duplicate.id);
        return api.listMemory({ scope: input.scope, subjectId: input.subjectId, limit: 500 }).find((item) => item.id === duplicate.id);
      }
      const id = input.id || `memory_${randomUUID()}`;
      db.prepare(`
        INSERT INTO memory_entries(
          id, scope, subject_id, normalized_fact, fact, provenance_json, confidence, status,
          valid_from, valid_until, supersedes_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.scope, input.subjectId, normalizedFact, String(input.fact).trim(),
        encode(input.provenance || []), Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))),
        input.status || 'candidate', input.validFrom || null, input.validUntil || null,
        input.supersedesId || null, current, current,
      );
      return api.listMemory({ scope: input.scope, subjectId: input.subjectId, limit: 500 }).find((item) => item.id === id);
    },
    updateMemory(id, patch) {
      const current = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
      if (!current) return null;
      const nextStatus = ['candidate', 'accepted', 'superseded', 'rejected'].includes(patch.status) ? patch.status : current.status;
      db.prepare(`
        UPDATE memory_entries SET status=?, confidence=?, valid_from=?, valid_until=?, supersedes_id=?, updated_at=? WHERE id=?
      `).run(
        nextStatus,
        patch.confidence === undefined ? current.confidence : Math.max(0, Math.min(1, Number(patch.confidence))),
        patch.validFrom === undefined ? current.valid_from : patch.validFrom || null,
        patch.validUntil === undefined ? current.valid_until : patch.validUntil || null,
        patch.supersedesId === undefined ? current.supersedes_id : patch.supersedesId || null,
        timestamp(), id,
      );
      return api.listMemory({ scope: current.scope, subjectId: current.subject_id, limit: 500 }).find((item) => item.id === id);
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
    upsertWorkTask(input) {
      const current = timestamp();
      const existing = db.prepare('SELECT * FROM work_tasks WHERE workflow_id = ? AND idempotency_key = ?')
        .get(input.workflowId, input.idempotencyKey);
      const id = existing?.id || input.id || `work_task_${randomUUID()}`;
      db.prepare(`
        INSERT INTO work_tasks(
          id, workflow_id, title, description, assignee_agent_id, runtime_id, runtime_session_id,
          dependencies_json, status, attempt, lease_expires_at, idempotency_key, worktree_path,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, assignee_agent_id=excluded.assignee_agent_id,
          runtime_id=excluded.runtime_id, runtime_session_id=excluded.runtime_session_id,
          dependencies_json=excluded.dependencies_json, status=excluded.status, attempt=excluded.attempt,
          lease_expires_at=excluded.lease_expires_at, worktree_path=excluded.worktree_path,
          metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
      `).run(
        id, input.workflowId, input.title, input.description || '', input.assigneeAgentId || null,
        input.runtimeId || null, input.runtimeSessionId || null, encode(input.dependencies || []),
        input.status || 'planned', Number(input.attempt || 0), input.leaseExpiresAt || null,
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
        attempt: Number(row.attempt),
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
    claimWorkTask(id, { leaseMs = 120000, runtimeSessionId = null, worktreePath = null } = {}) {
      const current = timestamp();
      const leaseExpiresAt = new Date(Date.now() + Math.max(30000, Number(leaseMs) || 120000)).toISOString();
      const result = db.prepare(`
        UPDATE work_tasks
        SET status='running', attempt=attempt + 1, lease_expires_at=?,
            runtime_session_id=COALESCE(?, runtime_session_id),
            worktree_path=COALESCE(?, worktree_path), updated_at=?
        WHERE id=? AND (
          status='ready'
          OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
        )
      `).run(leaseExpiresAt, runtimeSessionId, worktreePath, current, id, current);
      return Number(result.changes || 0) === 1 ? api.getWorkTask(id) : null;
    },
    heartbeatWorkTask(id, { leaseMs = 120000 } = {}) {
      const current = timestamp();
      const leaseExpiresAt = new Date(Date.now() + Math.max(30000, Number(leaseMs) || 120000)).toISOString();
      const result = db.prepare(`
        UPDATE work_tasks SET lease_expires_at=?, updated_at=?
        WHERE id=? AND status='running'
      `).run(leaseExpiresAt, current, id);
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
        UPDATE work_tasks SET status='ready', runtime_session_id=NULL, lease_expires_at=NULL, updated_at=?
        WHERE workflow_id=? AND status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
      `).run(timestamp(), workflowId, at);
      return ids.map((id) => api.getWorkTask(id)).filter(Boolean);
    },
  };

  return api;
}
