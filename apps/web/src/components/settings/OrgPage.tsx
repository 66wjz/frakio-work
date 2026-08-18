// wjz新建文件，新建原因：解耦 Agent 团队组织管理与 Profile 详情编辑页面组件（OrgPage, AgentProfileDetail, AgentProfileCard 等），修改时间：2026-08-17。
// 文件内容概述：团队 Agent 列表卡片、默认 Agent 切换、Profile 弹窗详情编辑、头像裁剪上传、Soul 与笔记修改、Harness 执行内核策略配置。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BaseIcon,
  BaseButton,
  BaseInput,
  BaseSelect,
  BaseBadge,
  BaseCard,
  BaseAvatar,
  BaseModal,
  BaseAlert,
} from '../base';
import { AgentAvatar } from '../common/AgentAvatar';
import { AvatarCropModal } from '../common/AvatarCropModal';

const LoaderCircle = (p: any) => <BaseIcon name="loader-circle" {...p} />;
const Pencil = (p: any) => <BaseIcon name="pencil" {...p} />;
const Plus = (p: any) => <BaseIcon name="plus" {...p} />;
const Trash2 = (p: any) => <BaseIcon name="trash-2" {...p} />;
const X = (p: any) => <BaseIcon name="x" {...p} />;
import { ProviderModelPicker } from '../chat/ProviderModelPicker';
import { HarnessChoiceGrid } from '../layout/HarnessChoiceGrid';
import { RuntimeLabel } from '../layout/RuntimeLabel';
import {
  agentDefaultModelLabel,
  modelValueForAgent,
  resolveModelChoice,
} from '../../utils/model-helpers';
import {
  effectiveRuntimeForAgentUi,
  harnessChoices,
  isRuntimeReady,
  mergeRuntimeDefinitions,
  runtimeSeed,
} from '../../utils/workbench-helpers';
import type {
  Agent,
  AgentRunOverride,
  AgentRuntimePolicy,
  HarnessId,
  ModelCapability,
  ModelProfile,
  ProfileEditableKind,
  ProfileEditorControls,
  RuntimeDefinition,
  RuntimeId,
} from '../../types/workbench';

export function OrgPage({
  agents,
  models,
  modelCapabilities,
  selectedOrgAgentId,
  onSelectAgent,
  onProfilesChanged,
  onUpdateAgent,
  onDeleteAgent,
  onCreate,
  profileEditor,
  defaultAgentId,
  onUpdateDefaultAgent,
}: {
  agents: Agent[];
  models: ModelProfile[];
  modelCapabilities: Record<string, ModelCapability>;
  selectedOrgAgentId: string;
  onSelectAgent: (id: string) => void;
  onProfilesChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onCreate: () => void;
  profileEditor: ProfileEditorControls;
  defaultAgentId: string;
  onUpdateDefaultAgent: (agentId: string) => void;
}) {
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const openAgent = agents.find((agent) => agent.id === openAgentId) || null;

  useEffect(() => {
    if (openAgentId && !openAgent) {
      setOpenAgentId(null);
      setDetailDirty(false);
    }
  }, [openAgentId, openAgent]);

  useEffect(() => {
    if (!openAgentId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openAgentId, detailDirty, profileEditor]);

  function closeDetail() {
    const profileDirty =
      profileEditor.state.target?.agentId === openAgentId && profileEditor.dirty;
    if (profileDirty && !profileEditor.close()) return;
    if (detailDirty && !window.confirm('当前编辑内容还没有保存，确定关闭吗？')) return;
    setOpenAgentId(null);
    setDetailDirty(false);
  }

  function openDetail(agentId: string) {
    const profileDirty =
      profileEditor.state.target?.agentId === openAgentId && profileEditor.dirty;
    if (openAgentId && openAgentId !== agentId && profileDirty && !profileEditor.close())
      return;
    if (
      openAgentId &&
      openAgentId !== agentId &&
      detailDirty &&
      !window.confirm('当前编辑内容还没有保存，确定切换 Agent 吗？')
    )
      return;
    onSelectAgent(agentId);
    setDetailDirty(false);
    setOpenAgentId(agentId);
  }

  return (
    <section className="org-page">
      <div className="org-split-section">
        <div className="org-toolbar settings-head">
          <div>
            <h2>Agent Profile</h2>
          </div>
          {agents.length > 0 && (
            <label className="org-default-agent">
              默认 Agent
              <select
                value={defaultAgentId}
                onChange={(event) => onUpdateDefaultAgent(event.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="profile-grid">
          {agents.map((agent) => (
            <AgentProfileCard
              agent={agent}
              models={models}
              selected={selectedOrgAgentId === agent.id}
              key={agent.id}
              onSelect={openDetail}
            />
          ))}
          <button className="profile-card profile-card-add" onClick={onCreate}>
            <span className="profile-add-icon">
              <Plus size={22} />
            </span>
            <strong>新建 Agent</strong>
            <small>创建一个新的团队成员</small>
          </button>
        </div>
        {openAgent &&
          createPortal(
            <div
              className="modal-backdrop agent-profile-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeDetail();
              }}
            >
              <div
                className="modal agent-profile-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="agent-profile-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="modal-head">
                  <div>
                    <h2 id="agent-profile-modal-title">Agent Profile</h2>
                    <p>{openAgent.name} · 配置详情</p>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={closeDetail}
                    aria-label="关闭 Agent 详情"
                  >
                    <X size={18} />
                  </button>
                </div>
                <AgentProfileDetail
                  agent={openAgent}
                  models={models}
                  modelCapabilities={modelCapabilities}
                  canDelete={agents.length > 1}
                  onChanged={onProfilesChanged}
                  onUpdateAgent={onUpdateAgent}
                  onDelete={() => onDeleteAgent(openAgent.id)}
                  profileEditor={profileEditor}
                  onDirtyChange={setDetailDirty}
                />
              </div>
            </div>,
            document.body,
          )}
      </div>
    </section>
  );
}

export function AgentProfileCard({
  agent,
  models,
  selected,
  onSelect,
}: {
  agent: Agent;
  models: ModelProfile[];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const policy = agent.runtimePolicy || {
    defaultRuntimeId: 'pi' as RuntimeId,
    defaultHarnessId: 'native' as HarnessId,
  };
  const runtimeId = policy.defaultHarnessId || policy.defaultRuntimeId || 'native';
  return (
    <button
      className={`profile-card ${selected ? 'active' : ''}`}
      onClick={() => onSelect(agent.id)}
      aria-pressed={selected}
    >
      <div className="profile-card-identity">
        <AgentAvatar agent={agent} />
        <strong>{agent.name}</strong>
      </div>
      <small className="profile-card-role">{agent.role || '未定义角色'}</small>
      <div className="profile-card-meta">
        <span
          className="profile-card-model"
          title={agentDefaultModelLabel(agent, models)}
        >
          {agentDefaultModelLabel(agent, models)}
        </span>
        <span className="profile-card-runtime" title="当前运行内核">
          <RuntimeLabel runtimeId={runtimeId} />
        </span>
      </div>
    </button>
  );
}

export function AgentRuntimePolicyPanel({
  agent,
  onUpdateAgent,
}: {
  agent: Agent;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
}) {
  const [runtimes, setRuntimes] = useState<RuntimeDefinition[]>(runtimeSeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const policy = agent.runtimePolicy || {
    defaultRuntimeId: 'pi',
    defaultHarnessId: 'native',
    allowedRuntimeIds: ['pi'],
    permissionProfileId: 'default',
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch('/api/runtimes');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || cancelled) return;
      setRuntimes((current) => mergeRuntimeDefinitions(current, payload.runtimes || []));
      await Promise.all(
        runtimeSeed.map(async (runtime) => {
          const detected = await fetch(`/api/runtimes/${runtime.id}/detect`, {
            method: 'POST',
          })
            .then((item) => item.json())
            .catch(() => null);
          if (!cancelled && detected?.runtime)
            setRuntimes((current) =>
              mergeRuntimeDefinitions(current, [detected.runtime]),
            );
        }),
      );
    };
    void load();
    return () => {
      cancelled = true;
    };
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

  const selectedHarness = (policy.defaultHarnessId ||
    (policy.defaultRuntimeId === 'pi' ? 'native' : policy.defaultRuntimeId)) as HarnessId;
  const unavailable = Object.fromEntries(
    harnessChoices
      .filter((choice) => choice.id !== 'native')
      .map((choice) => [
        choice.id,
        !isRuntimeReady(runtimes.find((item) => item.id === choice.runtimeId)),
      ]),
  ) as Partial<Record<HarnessId, boolean>>;

  return (
    <section className="agent-runtime-policy" aria-label="默认 Harness">
      <div className="agent-runtime-policy-head">
        <div>
          <strong>默认 Harness</strong>
          <small>只影响之后创建的会话。已有会话继续使用原来的 Harness。</small>
        </div>
        {saving && (
          <LoaderCircle className="spin" size={15} aria-label="正在保存" />
        )}
      </div>
      <HarnessChoiceGrid
        value={selectedHarness}
        disabled={saving}
        unavailable={unavailable}
        onChange={(defaultHarnessId) => {
          const defaultRuntimeId =
            defaultHarnessId === 'native' ? 'pi' : defaultHarnessId;
          void save({
            ...policy,
            defaultHarnessId,
            defaultRuntimeId,
            allowedRuntimeIds: [defaultRuntimeId],
          });
        }}
      />
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

export function AgentProfileDetail({
  agent,
  models,
  modelCapabilities,
  canDelete,
  onChanged,
  onUpdateAgent,
  onDelete,
  profileEditor,
  onDirtyChange,
}: {
  agent: Agent;
  models: ModelProfile[];
  modelCapabilities: Record<string, ModelCapability>;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDelete: () => Promise<void>;
  profileEditor: ProfileEditorControls;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<'notes' | 'user' | 'soul' | 'runtime'>('notes');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [defaultRunSaving, setDefaultRunSaving] = useState(false);
  const [modelError, setModelError] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const tabs = [
    { id: 'notes', label: '笔记' },
    { id: 'user', label: '用户画像' },
    { id: 'soul', label: '灵魂' },
    { id: 'runtime', label: '内核' },
  ] as const;
  const editableProfileName =
    agent.source === 'hermes-profile' && agent.profileName ? agent.profileName : '';

  useEffect(() => {
    setNameDraft(agent.name);
    setNameEditing(false);
    setNameError('');
  }, [agent.id, agent.name]);

  useEffect(() => {
    setTab('notes');
  }, [agent.id]);

  function selectTab(nextTab: typeof tab) {
    if (nextTab === tab) return;
    if (profileEditor.state.target?.agentId === agent.id && !profileEditor.close()) return;
    setTab(nextTab);
  }

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError('');
    setAvatarCropFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  async function uploadAvatar(data: string) {
    setAvatarSaving(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/avatar`, {
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
    const persistedModelValue = agent.model
      ? resolveModelChoice(agent.model, models).value
      : '';
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

  async function saveAgentDefaultRunOverride(override: AgentRunOverride) {
    if (defaultRunSaving) return;
    setDefaultRunSaving(true);
    try {
      await onUpdateAgent(agent.id, {
        defaultReasoningEffort: override.reasoningEffort || '',
        defaultSpeedMode: override.speedMode || '',
      });
    } finally {
      setDefaultRunSaving(false);
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
    <>
      <section className="agent-profile-overview">
        <div className="agent-profile-hero">
          <button
            className="agent-profile-avatar"
            style={agent.avatarUrl ? undefined : { background: agent.color }}
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarSaving}
            title="上传头像"
            aria-label="上传头像"
          >
            {agent.avatarUrl ? (
              <img src={agent.avatarUrl} alt="" />
            ) : (
              agent.name.slice(0, 1)
            )}
          </button>
          <input
            ref={avatarInputRef}
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => chooseAvatar(event.target.files?.[0])}
          />
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
                <button
                  className="secondary-btn"
                  onClick={() => void saveAgentName()}
                  disabled={nameSaving}
                >
                  {nameSaving ? '保存中' : '保存'}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setNameDraft(agent.name);
                    setNameEditing(false);
                    setNameError('');
                  }}
                  aria-label="取消编辑名字"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="agent-name-row">
                <h2>{agent.name}</h2>
                <button
                  className="agent-name-edit"
                  onClick={() => setNameEditing(true)}
                  aria-label="编辑 Agent 名字"
                  title="编辑 Agent 名字"
                >
                  <Pencil size={15} />
                </button>
              </div>
            )}
            <p>{agent.role}</p>
            {nameError && <div className="inline-error">{nameError}</div>}
            {avatarError && <div className="inline-error">{avatarError}</div>}
          </div>
          <button
            className="secondary-btn danger-btn agent-delete-btn"
            onClick={() => void deleteAgent()}
            disabled={deleting || !canDelete}
            title={canDelete ? '删除 Agent' : '至少需要保留一个 Agent'}
          >
            <Trash2 size={15} />
            {deleting ? '正在删除' : '删除'}
          </button>
        </div>
        <div className="agent-profile-toolbar">
          <div className="agent-tabs">
            {tabs.map((item) => (
              <button
                className={tab === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => selectTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label
            className="agent-default-model"
            aria-label="Agent 默认模型与运行配置"
          >
            <span>默认模型</span>
            <ProviderModelPicker
              models={models}
              value={modelValueForAgent(agent, models)}
              runtimeId={effectiveRuntimeForAgentUi(agent, null)}
              onChange={(value) => void saveAgentModel(value)}
              emptyLabel={modelSaving ? '保存中' : '未配置模型'}
              className="agent-default-model-picker"
              ariaLabel="选择 Agent 默认模型"
              title="选择 Agent 默认模型"
              capabilities={modelCapabilities}
              runOverride={{
                reasoningEffort: agent.defaultReasoningEffort,
                speedMode: agent.defaultSpeedMode,
              }}
              onRunOverrideChange={(override) =>
                void saveAgentDefaultRunOverride(override)
              }
              inheritRunLabel="使用模型默认"
            />
          </label>
        </div>
        {modelError && <div className="inline-error">{modelError}</div>}
      </section>
      {avatarCropFile &&
        createPortal(
          <AvatarCropModal
            file={avatarCropFile}
            title={`裁剪 ${agent.name} 的头像`}
            saving={avatarSaving}
            onCancel={() => setAvatarCropFile(null)}
            onSave={(data) => void uploadAvatar(data)}
          />,
          document.body,
        )}
      <div className="agent-profile-scroll">
        <div className="agent-tab-panel">
          {tab === 'notes' && (
            <FrakioAgentTextPanel
              title="Agent 笔记"
              text={agent.notes || ''}
              fallback="记录只属于这个 Agent 的维护说明。"
              onDirtyChange={onDirtyChange}
              onSave={(notes) =>
                onUpdateAgent(agent.id, { notes } as Partial<Agent>)
              }
            />
          )}
          {tab === 'user' && (
            <div className="text-panel editable-panel">
              <div className="panel-edit-head">
                <strong>用户画像</strong>
                <span>Frakio 用户层</span>
              </div>
              <p>
                用户画像与个人偏好由“个人资料”和“记忆中心”统一管理，并投影给当前 Agent
                使用。
              </p>
            </div>
          )}
          {tab === 'soul' && (
            <FrakioAgentTextPanel
              title="Soul"
              text={agent.soul || ''}
              fallback="定义这个 Agent 的人格和长期行为原则。"
              confirmLabel="确认修改 Soul"
              onDirtyChange={onDirtyChange}
              onSave={(soul) =>
                onUpdateAgent(agent.id, {
                  soul,
                  confirmSoul: true,
                } as Partial<Agent>)
              }
            />
          )}
          {tab === 'runtime' && (
            <AgentRuntimePolicyPanel
              agent={agent}
              onUpdateAgent={onUpdateAgent}
            />
          )}
        </div>
      </div>
    </>
  );
}

export function FrakioAgentTextPanel({
  title,
  text,
  fallback,
  confirmLabel = '保存',
  onSave,
  onDirtyChange,
}: {
  title: string;
  text: string;
  fallback: string;
  confirmLabel?: string;
  onSave: (value: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  useEffect(() => {
    onDirtyChange?.(editing && draft.trim() !== text.trim());
  }, [draft, editing, text, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="text-panel editable-panel">
      <div className="panel-edit-head">
        <strong>{title}</strong>
        {!editing && (
          <button className="secondary-btn" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            编辑
          </button>
        )}
      </div>
      {editing ? (
        <div className="inline-profile-editor">
          <textarea
            className="inline-profile-editor-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
            autoFocus
          />
          <div className="inline-profile-editor-footer">
            <div className="inline-profile-editor-status">
              {error ? (
                <span className="error">{error}</span>
              ) : (
                <span>保存后同步到所有 Runtime</span>
              )}
            </div>
            <div className="panel-edit-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  setDraft(text);
                  setEditing(false);
                }}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="send-btn"
                onClick={() => void save()}
                disabled={saving || draft.trim() === text.trim()}
              >
                {saving ? '保存中' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p>{text || fallback}</p>
      )}
    </div>
  );
}

export function EditableTextPanel({
  agentId,
  title,
  kind,
  profileName,
  text,
  fallback,
  onEdit,
  editor,
}: {
  agentId: string;
  title: string;
  kind: 'notes' | 'user' | 'soul';
  profileName: string;
  text: string;
  fallback: string;
  onEdit: () => void;
  editor: ProfileEditorControls;
}) {
  const isActive =
    editor.state.target?.agentId === agentId && editor.state.target.kind === kind;
  return (
    <div className="text-panel editable-panel">
      <div className="panel-edit-head">
        <strong>{title}</strong>
        {!isActive &&
          (profileName ? (
            <button className="secondary-btn" onClick={onEdit}>
              <Pencil size={15} />
              编辑
            </button>
          ) : (
            <span>保存为 Hermes Profile 后可编辑</span>
          ))}
      </div>
      {isActive ? <InlineProfileEditor editor={editor} /> : <p>{text || fallback}</p>}
    </div>
  );
}

export function InlineProfileEditor({ editor }: { editor: ProfileEditorControls }) {
  const { state, dirty } = editor;
  if (state.loading) return <div className="inline-profile-editor-state">正在读取文件...</div>;
  if (state.errorStage === 'load') {
    return (
      <div className="inline-profile-editor-state error">
        <span>{state.error}</span>
        <button className="secondary-btn" onClick={editor.discard}>
          关闭
        </button>
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
          {state.error ? (
            <span className="error">{state.error}</span>
          ) : dirty ? (
            <span>有未保存修改</span>
          ) : (
            <span>已同步</span>
          )}
        </div>
        <div className="panel-edit-actions">
          <button
            className="secondary-btn"
            onClick={editor.discard}
            disabled={state.saving}
          >
            取消
          </button>
          <button
            className="send-btn"
            onClick={() => void editor.save()}
            disabled={state.saving || !dirty}
          >
            {state.saving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
// wjz新建文件结束。
