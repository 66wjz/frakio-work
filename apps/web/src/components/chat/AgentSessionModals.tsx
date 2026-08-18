// wjz新建文件，新建原因：解耦 main.tsx 中的 Agent 会话覆盖配置、模型切换模态窗与 Agent 编辑器（AgentSessionModals），修改时间：2026-08-17。
// 文件内容概述：MessageAgentSessionConfig 消息级 Agent 运行时配置气泡、AgentSessionModelModal 会话模型覆盖模态窗、AgentEditorModal Agent 增删改编辑器、AgentFields 字段集合、SpaceIconGlyph 空间图标呈现。
import React, { useEffect, useState } from 'react';
import { Folder, X } from 'lucide-react';
import {
  AppPopover,
  AppPopoverContent,
  AppPopoverTrigger,
} from '../../overlay-primitives';
import type {
  Agent,
  AgentRunOverride,
  AgentRuntimePolicy,
  ChatEvent,
  HarnessId,
  ModelCapability,
  ModelProfile,
  RuntimeId,
  Space,
} from '../../types/workbench';
import {
  agentDefaultModelLabel,
  hermesProfileModels,
  modelChoiceValue,
  modelNamesForProvider,
  resolveModelChoice,
} from '../../utils/model-helpers';
import { spaceIconKind } from '../../utils/theme-helpers';
import { ProviderModelPicker } from './ProviderModelPicker';
import { AgentAvatar } from '../common/AgentAvatar';
import { AgentMessageAvatar } from './ChatMessageViews';
import { HarnessChoiceGrid } from '../layout/HarnessChoiceGrid';

export function MessageAgentSessionConfig({
  message,
  agent,
  runtimeId,
  models,
  value,
  modelOverride,
  runOverride,
  capabilities,
  open,
  onOpenChange,
  onChange,
  onRunOverrideChange,
}: {
  message: ChatEvent;
  agent: Agent;
  runtimeId: RuntimeId;
  models: ModelProfile[];
  value: string;
  modelOverride: string;
  runOverride: AgentRunOverride;
  capabilities: Record<string, ModelCapability>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void | Promise<void>;
  onRunOverrideChange: (override: AgentRunOverride) => void | Promise<void>;
}) {
  const pickerProps = {
    runtimeId,
    agentName: agent.name,
    value,
    models,
    emptyLabel: '未配置模型',
    ariaLabel: `${agent.name} 的 Frakio Model Center 模型`,
    title: 'Frakio Model Center',
    allowDefault: true,
    usingDefault: !modelOverride,
    capabilities,
    runOverride,
    onRunOverrideChange,
    onChange,
  };
  return (
    <AppPopover open={open} onOpenChange={onOpenChange}>
      <AppPopoverTrigger asChild>
        <button
          type="button"
          className="message-agent-config-trigger"
          aria-label={`打开 ${agent.name} 的会话配置`}
          title={`打开 ${agent.name} 的会话配置`}
        >
          <AgentMessageAvatar message={message} agent={agent} />
        </button>
      </AppPopoverTrigger>
      <AppPopoverContent
        className="message-agent-config-popover"
        side="right"
        align="start"
        aria-label={`${agent.name} 会话配置`}
      >
        <div className="message-agent-config-head">
          <strong>{agent.name}</strong>
          <small>{agent.role || 'Agent'} · 当前会话覆盖</small>
        </div>
        <ProviderModelPicker {...pickerProps} className="message-agent-config-picker" />
      </AppPopoverContent>
    </AppPopover>
  );
}

export function AgentSessionModelModal({
  agent,
  models,
  value,
  onClose,
  onSave,
  onOpenModels,
}: {
  agent: Agent | null;
  models: ModelProfile[];
  value: string;
  onClose: () => void;
  onSave: (agentId: string, modelId: string) => Promise<void>;
  onOpenModels: () => void;
}) {
  const availableModels = hermesProfileModels(models);
  const [draftModelId, setDraftModelId] = useState(
    value || (availableModels[0] ? modelChoiceValue(availableModels[0], availableModels[0].model) : ''),
  );
  useEffect(
    () =>
      setDraftModelId(
        value || (availableModels[0] ? modelChoiceValue(availableModels[0], availableModels[0].model) : ''),
      ),
    [value, models.length, agent?.id],
  );
  if (!agent) return null;
  const disabled = !availableModels.length || !draftModelId;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agent-model-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{agent.name} 的本会话模型</h2>
            <p>只影响当前对话，不修改 Agent 默认模型。</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="agent-model-body">
          <div className="agent-model-target">
            <AgentAvatar agent={agent} />
            <span>
              <strong>{agent.name}</strong>
              <small>默认模型：{agentDefaultModelLabel(agent, models)}</small>
            </span>
          </div>
          <label className="form-row">
            <span>本会话使用模型</span>
            <ProviderModelPicker
              models={availableModels}
              value={draftModelId}
              onChange={setDraftModelId}
              emptyLabel="未配置模型"
            />
          </label>
          {!availableModels.length && <div className="inline-error">还没有可选模型，请先进入模型中心配置。</div>}
          <div className="modal-actions">
            <button className="secondary-btn" onClick={onOpenModels}>
              进入模型中心
            </button>
            <button
              className="send-btn"
              disabled={disabled}
              onClick={() => void onSave(agent.id, draftModelId)}
            >
              保存本会话模型
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentEditorModal({
  title,
  models,
  agent,
  onClose,
  onSave,
}: {
  title: string;
  models: ModelProfile[];
  agent: Agent | null;
  onClose: () => void;
  onSave: (payload: Partial<Agent>) => Promise<void>;
}) {
  const emptyAgent: Agent = {
    id: '',
    name: '',
    role: '',
    model: '',
    color: '#0f766e',
    soul: '',
    scope: '',
    runtimePolicy: {
      defaultRuntimeId: 'pi',
      defaultHarnessId: 'native',
      allowedRuntimeIds: ['pi'],
      permissionProfileId: 'default',
    },
  };
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
      <div
        className="modal agent-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id="agent-editor-title">{title}</h2>
            <p>编辑 Agent 的人格、模型、职责和默认 Harness。</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="agent-editor-body">
          <AgentFields draft={draft} setDraft={setDraft} models={models} />
        </div>
        <div className="agent-editor-footer">
          <button className="send-btn full" disabled={saving} onClick={() => void save()}>
            {saving ? '正在创建...' : '保存 Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentFields({
  draft,
  setDraft,
  models,
}: {
  draft: Agent;
  setDraft: (agent: Agent) => void;
  models: ModelProfile[];
}) {
  const modelChoices = models.flatMap((model) =>
    modelNamesForProvider(model).map((modelName) => ({
      value: modelChoiceValue(model, modelName),
      label: `${model.name} · ${modelName}`,
    })),
  );
  const policy = draft.runtimePolicy || {
    defaultRuntimeId: 'pi',
    defaultHarnessId: 'native',
    allowedRuntimeIds: ['pi'],
    permissionProfileId: 'default',
  };
  const setRuntimePolicy = (next: AgentRuntimePolicy) => setDraft({ ...draft, runtimePolicy: next });
  return (
    <div className="agent-fields">
      <label>
        名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label>
        角色<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />
      </label>
      <label>
        模型
        <select
          value={resolveModelChoice(draft.model, models).value}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
        >
          <option value="">未配置模型</option>
          {modelChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <section className="agent-runtime-section" aria-labelledby="agent-runtime-title">
        <div className="agent-runtime-section-head">
          <div>
            <strong id="agent-runtime-title">默认 Harness</strong>
            <span>只影响之后创建的会话。已有会话继续使用原来的 Harness。</span>
          </div>
        </div>
        <HarnessChoiceGrid
          value={(policy.defaultHarnessId || (policy.defaultRuntimeId === 'pi' ? 'native' : policy.defaultRuntimeId)) as HarnessId}
          onChange={(defaultHarnessId) => {
            const defaultRuntimeId = defaultHarnessId === 'native' ? 'pi' : defaultHarnessId;
            setRuntimePolicy({ ...policy, defaultHarnessId, defaultRuntimeId, allowedRuntimeIds: [defaultRuntimeId] });
          }}
        />
      </section>
      <label>
        Soul<textarea value={draft.soul} onChange={(event) => setDraft({ ...draft, soul: event.target.value })} />
      </label>
      <label>
        职责范围
        <textarea value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} />
      </label>
    </div>
  );
}

export function SpaceIconGlyph({ space }: { space: Space }) {
  const kind = spaceIconKind(space);
  if (kind === 'dot') return <span className="space-dot-glyph" />;
  if (kind === 'emoji') return <span>{space.iconValue || '✨'}</span>;
  return <Folder size={15} />;
}
// wjz新建文件结束。
