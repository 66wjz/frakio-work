// wjz新建文件，新建原因：解耦记忆中心设置页面组件（MemoryCenterPage, MemoryLedger 等），修改时间：2026-08-17。
// 文件内容概述：多 Runtime 共享长期记忆管理、记忆生成状态、手动添加记忆、记忆同步审查与归属流转。
import React, { useCallback, useEffect, useState } from 'react';
import { Brain, X } from 'lucide-react';
import {
  SettingsInlineNote,
  SettingsPanel,
  SettingsRow,
  SettingsStatusValue,
} from '../../settings-ui';
import { requestJson } from '../../utils/api-client';
import { formatTime } from '../../utils/formatters';
import { MemoryReviewModelSettings } from './ModelCenter';
import type {
  Agent,
  MemoryLedgerEntry,
  MemoryReviewConfig,
  ModelProfile,
  Vault,
} from '../../types/workbench';

export function MemoryCenterPage({
  vaults,
  agents,
  models,
  onOpenModels,
  onOpenSource,
}: {
  vaults: Vault[];
  agents: Agent[];
  models: ModelProfile[];
  onOpenModels: () => void;
  onOpenSource: (threadId: string, messageId?: string) => void;
}) {
  const [entries, setEntries] = useState<MemoryLedgerEntry[]>([]);
  const [view, setView] = useState<'recent' | 'active' | 'history'>('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{
    config: MemoryReviewConfig;
    status: { running: number; queued: number; failed: number; lastRunAt?: string | null };
  } | null>(null);
  const [moving, setMoving] = useState<string>('');
  const [moveTarget, setMoveTarget] = useState('user:default');
  const [syncPreview, setSyncPreview] = useState<{
    entry: MemoryLedgerEntry;
    relativePath: string;
    diff: string;
    drifted: boolean;
  } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [migration, setMigration] = useState<{
    candidates: Array<{ id: string; profileName: string; file: string; excerpt: string }>;
    projectVaults: Vault[];
  } | null>(null);
  const [migrationSelection, setMigrationSelection] = useState<Set<string>>(new Set());
  const [migrationVaultId, setMigrationVaultId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createFact, setCreateFact] = useState('');
  const [createScope, setCreateScope] = useState<'user' | 'agent' | 'vault'>('user');
  const [createTargetId, setCreateTargetId] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [memoryData, configData] = await Promise.all([
        requestJson<{ entries: MemoryLedgerEntry[] }>(
          `/api/memory?view=${view}&limit=200`,
        ),
        requestJson<{
          config: MemoryReviewConfig;
          status: {
            running: number;
            queued: number;
            failed: number;
            lastRunAt?: string | null;
          };
        }>('/api/memory/config'),
      ]);
      setEntries(memoryData.entries || []);
      setReview(configData);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Memory Ledger 读取失败。',
      );
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (
    entryId: string,
    action: 'accept' | 'reject' | 'pause' | 'resume' | 'forget',
  ) => {
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

  const editEntry = async (entry: MemoryLedgerEntry) => {
    const fact = window.prompt('修正记忆内容', entry.fact)?.trim();
    if (!fact || fact === entry.fact) return;
    const response = await fetch(`/api/memory/${entry.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || '记忆修正失败。');
    else await load();
  };

  const moveEntry = async (entryId: string) => {
    const [scope, subjectId] = moveTarget.split(':');
    const response = await fetch(`/api/memory/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', scope, subjectId }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || '记忆归属调整失败。');
    else {
      setMoving('');
      await load();
    }
  };

  const previewSync = async (entry: MemoryLedgerEntry) => {
    try {
      const data = await requestJson<{
        preview: { relativePath: string; diff: string; drifted: boolean };
      }>(`/api/memory/${entry.id}/sync-preview`, { method: 'POST' });
      setSyncPreview({ entry, ...data.preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步预览失败。');
    }
  };

  const applySync = async (resolution = '') => {
    if (!syncPreview) return;
    try {
      await requestJson(`/api/memory/${syncPreview.entry.id}/sync`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      setSyncPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库同步失败。');
    }
  };

  const inspectMigration = async () => {
    const data = await requestJson<{
      candidates: Array<{ id: string; profileName: string; file: string; excerpt: string }>;
      projectVaults: Vault[];
    }>('/api/memory/migrations/hermes-project-rules');
    setMigration(data);
    setMigrationSelection(new Set());
    setMigrationVaultId(data.projectVaults[0]?.id || '');
  };

  const applyMigration = async () => {
    if (
      !migrationVaultId ||
      !migrationSelection.size ||
      !window.confirm(
        '所选内容会先完整备份，再移入项目资料库并从原 Profile 删除。确认继续？',
      )
    )
      return;
    try {
      setError('');
      await requestJson('/api/memory/migrations/hermes-project-rules', {
        method: 'POST',
        body: JSON.stringify({
          vaultId: migrationVaultId,
          candidateIds: [...migrationSelection],
        }),
      });
      await inspectMigration();
    } catch (err) {
      setError(err instanceof Error ? err.message : '旧项目规则迁移失败。');
    }
  };

  const createMemory = async () => {
    const fact = createFact.trim();
    const subjectId = createScope === 'user' ? 'default' : createTargetId;
    if (!fact) {
      setError('请先写下一条可复用的事实、规则或偏好。');
      return;
    }
    if (!subjectId) {
      setError(
        createScope === 'agent'
          ? '请选择这条经验归属的 Agent。'
          : '请选择这条规则归属的项目资料库。',
      );
      return;
    }
    setCreating(true);
    setError('');
    try {
      await requestJson<{ entry: MemoryLedgerEntry }>('/api/memory/proposals', {
        method: 'POST',
        body: JSON.stringify({
          fact,
          scope: createScope,
          userConfirmed: true,
          origin: 'user',
          userId: createScope === 'user' ? subjectId : '',
          sourceAgentId: createScope === 'agent' ? subjectId : '',
          vaultId: createScope === 'vault' ? subjectId : '',
          confidence: 0.99,
          kind:
            createScope === 'user'
              ? 'personal_fact'
              : createScope === 'agent'
                ? 'agent_experience'
                : 'project_fact',
          reason: '用户在记忆中心手动创建',
        }),
      });
      setCreateFact('');
      setCreateScope('user');
      setCreateTargetId('');
      setShowCreate(false);
      setView('active');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '新建记忆失败。');
    } finally {
      setCreating(false);
    }
  };

  const groupForEntry = (entry: MemoryLedgerEntry) =>
    entry.scope === 'user'
      ? '个人'
      : entry.scope === 'vault'
        ? `项目资料库 · ${vaults.find((vault) => vault.id === entry.subjectId)?.name || entry.subjectId}`
        : entry.scope === 'agent'
          ? 'Agent 经验'
          : '其他';

  const visibleEntries =
    view === 'active'
      ? [...entries].sort(
          (left, right) =>
            groupForEntry(left).localeCompare(groupForEntry(right)) ||
            right.updatedAt.localeCompare(left.updatedAt),
        )
      : entries;

  return (
    <>
      <div className="settings-head">
        <div>
          <h2>
            记忆中心 <span className="feature-beta">Beta</span>
          </h2>
          <p className="settings-description">
            Frakio 是正式记忆的唯一来源。Hermes、Pi、Codex 和 Claude 读取同一份记忆。
          </p>
        </div>
        <span className="settings-inline-actions">
          <button
            className="send-btn"
            onClick={() => setShowCreate((current) => !current)}
          >
            {showCreate ? '收起新建' : '新建记忆'}
          </button>
          <button className="secondary-btn quiet" onClick={onOpenModels}>
            模型设置
          </button>
        </span>
      </div>
      <section className="memory-automation-panel">
        <MemoryReviewModelSettings models={models} compact onOpenModels={onOpenModels} />
        <SettingsPanel className="memory-automation-status" ariaLabel="记忆整理状态">
          <SettingsRow
            title="整理状态"
            description={
              review?.config.enabled
                ? `当前模型：${review.config.model || '自动使用全局默认模型'} · 超时 ${review.config.timeout}s`
                : '已关闭自动整理'
            }
          >
            <SettingsStatusValue
              state={
                !review?.config.enabled
                  ? '已关闭'
                  : review.status.running
                    ? '整理中'
                    : review.status.queued
                      ? `${review.status.queued} 条等待`
                      : review.status.failed
                        ? `${review.status.failed} 条失败`
                        : '运行正常'
              }
              tone={review?.status.failed ? 'warning' : 'ready'}
            />
          </SettingsRow>
        </SettingsPanel>
      </section>
      {showCreate && (
        <SettingsPanel ariaLabel="新建记忆">
          <SettingsRow
            title="新建共享记忆"
            description="只记录以后需要复用的事实、规则或偏好；它不会写入 Hermes 的私有记忆。"
          >
            <div className="memory-create-form">
              <textarea
                value={createFact}
                onChange={(event) => setCreateFact(event.target.value)}
                placeholder="例如：项目发布前必须由 Victor 复核迁移说明。"
                aria-label="记忆内容"
                autoFocus
              />
              <div className="memory-create-controls">
                <label>
                  归属{' '}
                  <select
                    value={createScope}
                    onChange={(event) => {
                      const scope = event.target.value as 'user' | 'agent' | 'vault';
                      setCreateScope(scope);
                      setCreateTargetId('');
                    }}
                  >
                    <option value="user">个人记忆</option>
                    <option value="agent">Agent 经验</option>
                    <option value="vault">项目资料库</option>
                  </select>
                </label>
                {createScope === 'agent' && (
                  <label>
                    Agent{' '}
                    <select
                      value={createTargetId}
                      onChange={(event) => setCreateTargetId(event.target.value)}
                    >
                      <option value="">请选择</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {createScope === 'vault' && (
                  <label>
                    项目{' '}
                    <select
                      value={createTargetId}
                      onChange={(event) => setCreateTargetId(event.target.value)}
                    >
                      <option value="">请选择</option>
                      {vaults
                        .filter((vault) => vault.kind === 'project')
                        .map((vault) => (
                          <option key={vault.id} value={vault.id}>
                            {vault.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button
                  className="send-btn"
                  disabled={
                    creating ||
                    !createFact.trim() ||
                    (createScope !== 'user' && !createTargetId)
                  }
                  onClick={() => void createMemory()}
                >
                  {creating ? '保存中' : '保存为长期记忆'}
                </button>
                <button
                  className="secondary-btn"
                  disabled={creating}
                  onClick={() => {
                    setShowCreate(false);
                    setCreateFact('');
                    setCreateScope('user');
                    setCreateTargetId('');
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </SettingsRow>
        </SettingsPanel>
      )}
      <section className="memory-ledger-section">
        <div className="memory-ledger-head">
          <div>
            <h3>记忆列表</h3>
            <span>
              {view === 'recent'
                ? '自动整理出的内容会先等待确认。'
                : view === 'active'
                  ? '这些记忆会在合适的 Runtime Context 中生效。'
                  : '保留所有历史变更，便于回溯。'}
            </span>
          </div>
          <div className="module-matrix-tabs memory-center-tabs">
            <button
              className={view === 'recent' ? 'selected' : ''}
              onClick={() => setView('recent')}
            >
              最近产生
            </button>
            <button
              className={view === 'active' ? 'selected' : ''}
              onClick={() => setView('active')}
            >
              已生效
            </button>
            <button
              className={view === 'history' ? 'selected' : ''}
              onClick={() => setView('history')}
            >
              历史
            </button>
          </div>
        </div>
        <SettingsPanel className="memory-ledger-list" ariaLabel="Memory Ledger">
          {visibleEntries.map((entry, index) => (
            <React.Fragment key={entry.id}>
              {view === 'active' &&
                (index === 0 ||
                  groupForEntry(visibleEntries[index - 1]) !==
                    groupForEntry(entry)) && (
                  <div className="memory-group-label">{groupForEntry(entry)}</div>
                )}
              <SettingsRow
                title={entry.fact}
                description={`${entry.reason || '由 Frakio 记忆整理器识别'} · ${entry.scope === 'user' ? '个人' : entry.scope === 'agent' ? `Agent 经验：${agents.find((agent) => agent.id === entry.subjectId)?.name || entry.subjectId}` : entry.scope === 'vault' ? `项目资料库：${vaults.find((vault) => vault.id === entry.subjectId)?.name || entry.subjectId}` : '等待确认归属'} · 来源 ${entry.origin || entry.provenance?.[0]?.source || 'unknown'} · ${formatTime(entry.createdAt || entry.updatedAt)}`}
              >
                <span className="settings-inline-actions memory-actions">
                  {entry.status === 'candidate' && (
                    <button
                      className="secondary-btn"
                      onClick={() => void resolve(entry.id, 'accept')}
                    >
                      保留
                    </button>
                  )}
                  {['candidate', 'accepted', 'paused'].includes(entry.status) && (
                    <button
                      className="secondary-btn"
                      onClick={() => void editEntry(entry)}
                    >
                      {entry.status === 'candidate' ? '修改后保留' : '编辑'}
                    </button>
                  )}
                  {['candidate', 'accepted', 'paused'].includes(entry.status) && (
                    <button
                      className="secondary-btn"
                      onClick={() => {
                        setMoving(entry.id);
                        setMoveTarget(
                          entry.scope === 'vault' ||
                            entry.scope === 'agent' ||
                            entry.scope === 'user'
                            ? `${entry.scope}:${entry.subjectId}`
                            : 'user:default',
                        );
                      }}
                    >
                      调整归属
                    </button>
                  )}
                  {entry.status === 'accepted' && (
                    <button
                      className="secondary-btn"
                      onClick={() => void resolve(entry.id, 'pause')}
                    >
                      暂停
                    </button>
                  )}
                  {entry.status === 'paused' && (
                    <button
                      className="secondary-btn"
                      onClick={() => void resolve(entry.id, 'resume')}
                    >
                      恢复
                    </button>
                  )}
                  {entry.scope === 'vault' &&
                    ['project_fact', 'project_decision', 'project_rule'].includes(
                      entry.kind || '',
                    ) &&
                    entry.status === 'accepted' && (
                      <button
                        className="secondary-btn"
                        onClick={() => void previewSync(entry)}
                      >
                        同步资料库规则
                      </button>
                    )}
                  {entry.threadId && (
                    <button
                      className="secondary-btn"
                      onClick={() =>
                        onOpenSource(
                          entry.threadId || '',
                          entry.provenance?.find((item) => item.messageId)?.messageId,
                        )
                      }
                    >
                      查看来源
                    </button>
                  )}
                  {['candidate', 'accepted', 'paused'].includes(entry.status) && (
                    <button
                      className="secondary-btn danger"
                      onClick={() =>
                        void resolve(
                          entry.id,
                          entry.status === 'candidate' ? 'reject' : 'forget',
                        )
                      }
                    >
                      {entry.status === 'candidate' ? '不记住' : '遗忘'}
                    </button>
                  )}
                  <SettingsStatusValue
                    state={
                      entry.status === 'accepted'
                        ? '已生效'
                        : entry.status === 'candidate'
                          ? '等待确认'
                          : entry.status === 'paused'
                            ? '已暂停'
                            : entry.status === 'superseded'
                              ? '已取代'
                              : '已遗忘'
                    }
                  />
                </span>
              </SettingsRow>
            </React.Fragment>
          ))}
          {!entries.length && !loading ? (
            <div className="settings-empty-state memory-empty-state">
              <Brain size={22} aria-hidden="true" />
              <strong>还没有可治理记忆</strong>
              <span>完整对话结束后，Frakio 会在后台整理值得复用的内容。</span>
            </div>
          ) : null}
        </SettingsPanel>
      </section>
      {moving && (
        <SettingsPanel ariaLabel="调整记忆归属">
          <SettingsRow
            title="选择新的归属"
            description="项目规则必须进入明确的项目资料库。"
          >
            <span className="settings-inline-actions">
              <select
                value={moveTarget}
                onChange={(event) => setMoveTarget(event.target.value)}
              >
                <option value="user:default">个人记忆</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={`agent:${agent.id}`}>
                    {agent.name} 的 Agent 经验
                  </option>
                ))}
                {vaults
                  .filter((vault) => vault.kind === 'project')
                  .map((vault) => (
                    <option key={vault.id} value={`vault:${vault.id}`}>
                      项目资料库：{vault.name}
                    </option>
                  ))}
              </select>
              <button
                className="send-btn"
                onClick={() => void moveEntry(moving)}
              >
                保存归属
              </button>
              <button className="secondary-btn" onClick={() => setMoving('')}>
                取消
              </button>
            </span>
          </SettingsRow>
        </SettingsPanel>
      )}
      <details
        className="memory-import-tools"
        open={showImport}
        onToggle={(event) =>
          setShowImport((event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>次级操作</summary>
        <button
          className="secondary-btn"
          onClick={() => {
            void inspectMigration();
            setShowImport(true);
          }}
        >
          从 Agent 旧规则导入
        </button>
      </details>
      {migration && showImport && (
        <SettingsPanel ariaLabel="旧项目规则迁移审查">
          <SettingsRow
            title="目标项目资料库"
            description="迁移前会在 Frakio Work 备份目录保存原文件。"
          >
            <select
              value={migrationVaultId}
              onChange={(event) => setMigrationVaultId(event.target.value)}
            >
              <option value="">请选择</option>
              {migration.projectVaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
          </SettingsRow>
          {migration.candidates.map((candidate) => (
            <SettingsRow
              key={candidate.id}
              title={`${candidate.profileName} · ${candidate.file}`}
              description={candidate.excerpt}
            >
              <input
                type="checkbox"
                checked={migrationSelection.has(candidate.id)}
                onChange={(event) =>
                  setMigrationSelection((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(candidate.id);
                    else next.delete(candidate.id);
                    return next;
                  })
                }
              />
            </SettingsRow>
          ))}
          {!migration.candidates.length && (
            <SettingsInlineNote>没有发现待整理的旧项目规则。</SettingsInlineNote>
          )}
          {migration.candidates.length > 0 && (
            <button
              className="secondary-btn"
              disabled={!migrationVaultId || !migrationSelection.size}
              onClick={() => void applyMigration()}
            >
              备份并迁移所选规则
            </button>
          )}
        </SettingsPanel>
      )}
      {syncPreview && (
        <div className="modal-backdrop" onClick={() => setSyncPreview(null)}>
          <div
            className="modal memory-sync-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2>同步资料库规则</h2>
                <p>{syncPreview.relativePath}</p>
              </div>
              <button className="icon-btn" onClick={() => setSyncPreview(null)}>
                <X size={18} />
              </button>
            </div>
            <pre className="memory-sync-diff">
              {syncPreview.diff || '文档内容没有变化。'}
            </pre>
            {syncPreview.drifted && (
              <SettingsInlineNote>
                文件中的受管区块已被修改。请选择以哪一边为准。
              </SettingsInlineNote>
            )}
            <div className="modal-actions">
              <button
                className="secondary-btn"
                onClick={() => setSyncPreview(null)}
              >
                取消
              </button>
              {syncPreview.drifted && (
                <button
                  className="secondary-btn"
                  onClick={() => void applySync('document')}
                >
                  以文档更新记忆
                </button>
              )}
              <button
                className="send-btn"
                onClick={() => void applySync(syncPreview.drifted ? 'memory' : '')}
              >
                以记忆更新文档
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </>
  );
}
// wjz新建文件结束。
