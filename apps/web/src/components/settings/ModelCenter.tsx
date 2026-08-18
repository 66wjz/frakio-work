// wjz新建文件，新建原因：解耦模型中心组件（ModelCenter, ModelEditorModal, OAuthAccountsPanel, AuxiliaryModelsPanel, MemoryReviewModelSettings 等），修改时间：2026-08-17。
// 文件内容概述：模型中心页面、模型配置与编辑弹窗、授权账户管理、辅助模型及记忆模型配置。
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Trash2,
  X,
  RefreshCw,
  LoaderCircle,
  ChevronDown,
  CircleHelp,
  TriangleAlert,
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { SettingsPanel, SettingsRow } from '../../settings-ui';
import { SettingsStatusValue } from './SettingsStatusValue';
import { requestJson } from '../../utils/api-client';
import { compatibilityRelayProviderKeys, openExternalUrl, runtimeLabels } from '../../utils/workbench-helpers';
import { modelNamesForProvider } from '../../utils/model-helpers';
import type {
  AuxiliaryModelSettings,
  AuxiliaryModelsConfig,
  AuxiliaryModelTask,
  CatalogInfo,
  FetchAvailableModels,
  HermesProfile,
  MemoryReviewConfig,
  ModelCapability,
  ModelKind,
  ModelPayload,
  ModelPricing,
  ModelProfile,
  ModelProtocol,
  OAuthAccount,
  OAuthProviderState,
  ProviderApiMode,
  ProviderApiModePreference,
  ProviderAuthType,
  ProviderPreset,
  RuntimeModelCatalog,
  SaveModel,
} from '../../types/workbench';

export type ModelSlotGroup = { provider: string; label: string; models: string[] };

export function useModelSlotGroups(models: ModelProfile[]) {
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/model-providers/presets')
      .then((res) => res.json())
      .then((data: { providers?: ProviderPreset[] }) => {
        if (!cancelled) setPresets(Array.isArray(data.providers) ? data.providers : []);
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return useMemo(() => {
    const groups = new Map<string, ModelSlotGroup>();
    for (const preset of presets) {
      if (!preset.value || preset.value.toLowerCase() === 'moa') continue;
      groups.set(preset.value, {
        provider: preset.value,
        label: preset.label || preset.value,
        models: [...(preset.models || [])],
      });
    }
    for (const model of models) {
      const matchedPreset = presets.find(
        (preset) => preset.value === model.providerKey || (model.baseUrl && preset.baseUrl === model.baseUrl),
      );
      const provider = model.providerKey || matchedPreset?.value || '';
      if (!provider || provider.toLowerCase() === 'moa') continue;
      const current = groups.get(provider) || {
        provider,
        label: provider.startsWith('custom:')
          ? model.name || model.provider || provider
          : matchedPreset?.label || model.provider || model.name || provider,
        models: [],
      };
      current.models = Array.from(new Set([...current.models, ...modelNamesForProvider(model)]));
      groups.set(provider, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [models, presets]);
}

export function ModelIdCombobox({
  value,
  options,
  onChange,
  placeholder = '选择或输入模型 ID',
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedOptions = Array.from(new Set(options.map((item) => String(item || '').trim()).filter(Boolean)));
  const filteredOptions = normalizedOptions.filter(
    (item) => !value.trim() || item.toLowerCase().includes(value.trim().toLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
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
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
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
        <button type="button" onClick={() => setOpen((current) => !current)} aria-label="展开模型列表">
          <ChevronDown size={15} />
        </button>
      </div>
      {open && (
        <div className="model-id-combobox-menu" role="listbox">
          {filteredOptions.length ? (
            filteredOptions.map((item) => (
              <button
                type="button"
                className={item === value ? 'selected' : ''}
                key={item}
                onClick={() => {
                  onChange(item);
                  setOpen(false);
                }}
              >
                {item}
              </button>
            ))
          ) : (
            <span>没有匹配项，可直接输入模型 ID</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AuxiliaryModelsPanel({ groups }: { groups: ModelSlotGroup[] }) {
  const [tasks, setTasks] = useState<AuxiliaryModelTask[]>([]);
  const [auxiliary, setAuxiliary] = useState<AuxiliaryModelsConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{
    task: AuxiliaryModelTask;
    settings: AuxiliaryModelSettings;
    extraBody: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ tasks: AuxiliaryModelTask[]; auxiliary: AuxiliaryModelsConfig }>(
        '/api/auxiliary-models',
      );
      setTasks(data.tasks || []);
      setAuxiliary(data.auxiliary || {});
    } catch (err: any) {
      setError(err.message || '辅助模型配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openEditor(task: AuxiliaryModelTask) {
    const current = auxiliary[task.key] || {};
    setEditing({
      task,
      settings: {
        provider: current.provider || 'auto',
        model: current.model || '',
        timeout: current.timeout || task.default_timeout,
        download_timeout:
          task.key === 'vision' ? current.download_timeout || task.default_download_timeout : undefined,
      },
      extraBody: current.extra_body ? JSON.stringify(current.extra_body, null, 2) : '',
    });
  }

  async function persist(task: AuxiliaryModelTask, settings: AuxiliaryModelSettings) {
    setSaving(true);
    setError('');
    try {
      const data = await requestJson<{ auxiliary: AuxiliaryModelsConfig }>('/api/auxiliary-models', {
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
      <div className="model-routing-head">
        <div>
          <h3>Frakio 系统辅助模型</h3>
          <p>为视觉、压缩、审批、MCP 和后台维护指定一套全局模型，所有 Agent 共用。</p>
        </div>
        <button className="secondary-btn" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="model-routing-table auxiliary-routing-table">
        <div className="model-routing-row head">
          <span>任务</span>
          <span>Provider / 默认模型</span>
          <span>超时</span>
          <span>操作</span>
        </div>
        {tasks.map((task) => (
          <div className="model-routing-row" key={task.key}>
            <strong>{task.label}</strong>
            <span className="mono-cell">{configLabel(auxiliary[task.key])}</span>
            <span className="mono-cell">{timeoutLabel(task, auxiliary[task.key])}</span>
            <span className="row-actions">
              <button onClick={() => openEditor(task)}>编辑</button>
              <button
                disabled={saving}
                onClick={() =>
                  void persist(task, {
                    provider: 'auto',
                    timeout: task.default_timeout,
                    ...(task.key === 'vision' ? { download_timeout: task.default_download_timeout } : {}),
                  })
                }
              >
                清除
              </button>
            </span>
          </div>
        ))}
      </div>
      {editing && (
        <div className="modal-backdrop" onClick={() => !saving && setEditing(null)}>
          <div className="modal model-routing-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>{editing.task.label}</h2>
                <p>Frakio 全局系统辅助模型，所有 Agent 共用。</p>
              </div>
              <button className="icon-btn" onClick={() => setEditing(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="routing-form-grid">
              <label>
                Provider
                <select
                  value={editing.settings.provider || 'auto'}
                  onChange={(event) =>
                    setEditing((current) =>
                      current
                        ? { ...current, settings: { ...current.settings, provider: event.target.value, model: '' } }
                        : current,
                    )
                  }
                >
                  <option value="auto">自动</option>
                  <option value="main">主模型</option>
                  {groups.map((group) => (
                    <option value={group.provider} key={group.provider}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模型
                {['auto', 'main'].includes(editing.settings.provider || 'auto') ? (
                  <span className="auxiliary-model-inherited">
                    {editing.settings.provider === 'main'
                      ? '直接使用当前 Agent 的主模型，无需另选模型。'
                      : '由 Hermes 自动选择当前任务的模型，无需另选模型。'}
                  </span>
                ) : (
                  <ModelIdCombobox
                    value={editing.settings.model || ''}
                    options={editingGroup?.models || []}
                    onChange={(value) =>
                      setEditing((current) =>
                        current ? { ...current, settings: { ...current.settings, model: value } } : current,
                      )
                    }
                  />
                )}
              </label>
              <label>
                调用超时（秒）
                <input
                  type="number"
                  min="1"
                  value={editing.settings.timeout || ''}
                  onChange={(event) =>
                    setEditing((current) =>
                      current
                        ? { ...current, settings: { ...current.settings, timeout: Number(event.target.value) } }
                        : current,
                    )
                  }
                />
              </label>
              {editing.task.key === 'vision' && (
                <label>
                  下载超时（秒）
                  <input
                    type="number"
                    min="1"
                    value={editing.settings.download_timeout || ''}
                    onChange={(event) =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              settings: { ...current.settings, download_timeout: Number(event.target.value) },
                            }
                          : current,
                      )
                    }
                  />
                </label>
              )}
              <label className="wide-field">
                Extra body JSON
                <textarea
                  rows={5}
                  value={editing.extraBody}
                  onChange={(event) =>
                    setEditing((current) => (current ? { ...current, extraBody: event.target.value } : current))
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="send-btn" disabled={saving} onClick={() => void saveEditor()}>
                {saving ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function MemoryReviewModelSettings({
  models,
  compact = false,
  onOpenModels,
}: {
  models: ModelProfile[];
  compact?: boolean;
  onOpenModels?: () => void;
}) {
  const [config, setConfig] = useState<MemoryReviewConfig>({
    enabled: true,
    provider: 'auto',
    model: '',
    timeout: 60,
    extraBody: {},
  });
  const [extraBody, setExtraBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const options = models.flatMap((model) =>
    modelNamesForProvider(model).map((modelName) => ({
      value: `${model.id}::${modelName}`,
      label: `${model.name} / ${modelName}`,
    })),
  );
  const load = useCallback(async () => {
    try {
      const data = await requestJson<{ config: MemoryReviewConfig }>('/api/memory/config');
      setConfig(data.config);
      setExtraBody(
        Object.keys(data.config.extraBody || {}).length ? JSON.stringify(data.config.extraBody, null, 2) : '',
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '记忆整理配置读取失败。');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    let parsed: Record<string, unknown> = {};
    if (extraBody.trim()) {
      try {
        parsed = JSON.parse(extraBody);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
      } catch {
        setError('高级请求参数必须是 JSON 对象。');
        return;
      }
    }
    setSaving(true);
    try {
      const data = await requestJson<{ config: MemoryReviewConfig }>('/api/memory/config', {
        method: 'PUT',
        body: JSON.stringify({ ...config, provider: config.model ? 'configured' : 'auto', extraBody: parsed }),
      });
      setConfig(data.config);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '记忆整理配置保存失败。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={`model-routing-panel memory-review-model-panel ${compact ? 'memory-review-model-compact' : ''}`}>
      <div className="model-routing-head">
        <div>
          <h3>{compact ? '记忆整理模型' : '全局记忆整理模型'}</h3>
          <p>
            {compact
              ? '在这里快速选择整理模型。高级请求参数与超时在模型中心管理。'
              : 'Frakio 全局任务。对话完整结束后异步识别跨内核记忆，不跟随 Profile 切换。'}
          </p>
        </div>
        <SettingsStatusValue state={config.enabled ? '已开启' : '已关闭'} tone={config.enabled ? 'ready' : 'warning'} />
      </div>
      <SettingsPanel ariaLabel="全局记忆整理模型">
        <SettingsRow title="自动整理" description="关闭后仍可在历史对话中手动执行整理。">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig((current) => ({ ...current, enabled: event.target.checked }))}
          />
        </SettingsRow>
        <SettingsRow title="模型" description="自动会使用 Frakio 的全局默认 Agent 模型。">
          <select value={config.model} onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))}>
            <option value="">自动使用全局默认模型</option>
            {options.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        {!compact && (
          <SettingsRow title="超时" description="整理失败会后台重试三次，不影响对话和 Work 完成。">
            <input
              type="number"
              min="5"
              max="300"
              value={config.timeout}
              onChange={(event) => setConfig((current) => ({ ...current, timeout: Number(event.target.value) }))}
            />
          </SettingsRow>
        )}
        {!compact && (
          <SettingsRow title="高级请求参数" description="仅传给已选择的模型，不会自动回退到其他外部模型。">
            <textarea
              rows={4}
              value={extraBody}
              placeholder="可选 JSON"
              onChange={(event) => setExtraBody(event.target.value)}
            />
          </SettingsRow>
        )}
        <div className="modal-actions">
          <button className="send-btn" disabled={saving} onClick={() => void save()}>
            {saving ? '保存中' : compact ? '保存记忆设置' : '保存全局设置'}
          </button>
          {compact && onOpenModels && (
            <button className="secondary-btn" onClick={onOpenModels}>
              前往模型中心
            </button>
          )}
        </div>
      </SettingsPanel>
      {error && <div className="form-error">{error}</div>}
    </section>
  );
}

export function ModelConfigPage({
  models,
  profiles,
  defaultProfile,
  modelError,
  saveModel,
  deleteModel,
  fetchAvailableModels,
  onCapabilityChanged,
}: {
  models: ModelProfile[];
  profiles: HermesProfile[];
  defaultProfile: string;
  modelError: string;
  saveModel: SaveModel;
  deleteModel: (modelId: string) => Promise<boolean>;
  fetchAvailableModels: FetchAvailableModels;
  onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void;
}) {
  return (
    <section className="settings-page">
      <ModelCenter
        models={models}
        profiles={profiles}
        defaultProfile={defaultProfile}
        modelError={modelError}
        saveModel={saveModel}
        deleteModel={deleteModel}
        fetchAvailableModels={fetchAvailableModels}
        onCapabilityChanged={onCapabilityChanged}
      />
    </section>
  );
}

export function ModelCenter({
  models,
  profiles: _profiles,
  defaultProfile: _defaultProfile,
  modelError,
  saveModel,
  deleteModel,
  fetchAvailableModels,
  onCapabilityChanged,
}: {
  models: ModelProfile[];
  profiles: HermesProfile[];
  defaultProfile: string;
  modelError: string;
  saveModel: SaveModel;
  deleteModel: (modelId: string) => Promise<boolean>;
  fetchAvailableModels: FetchAvailableModels;
  onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void;
}) {
  const [activeTab, setActiveTab] = useState<'general' | 'accounts' | 'auxiliary'>('general');
  const [editingModel, setEditingModel] = useState<ModelProfile | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [runtimeCatalogs, setRuntimeCatalogs] = useState<Record<string, RuntimeModelCatalog>>({});
  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccount[]>([]);
  const [oauthAccountsApiError, setOauthAccountsApiError] = useState('');
  const slotGroups = useModelSlotGroups(models);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      ['hermes', 'pi', 'codex', 'claude'].map(async (runtimeId) => {
        try {
          const response = await fetch(`/api/runtimes/${runtimeId}/models`);
          const data = await response.json().catch(() => ({}));
          return response.ok ? ([runtimeId, data as RuntimeModelCatalog] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((catalogs) => {
      if (!cancelled)
        setRuntimeCatalogs(
          Object.fromEntries(catalogs.filter(Boolean) as Array<readonly [string, RuntimeModelCatalog]>),
        );
    });
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    void refreshAccounts();
  }, [models.map((model) => `${model.id}:${model.oauthAccountId || ''}`).join('|')]);

  async function handleSave(
    payload: ModelPayload,
    options: { close?: boolean; persistedModels?: ModelProfile[] } = {},
  ) {
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
        <div>
          <h2>Frakio Work 模型中心</h2>
        </div>
        <div className="top-actions">
          {activeTab === 'general' && (
            <button
              className="secondary-btn"
              onClick={() => {
                setEditingModel(null);
                setModalOpen(true);
              }}
            >
              <Plus size={16} />
              添加模型
            </button>
          )}
        </div>
      </div>
      <div className="module-matrix-tabs model-center-tabs">
        <button className={activeTab === 'general' ? 'selected' : ''} onClick={() => setActiveTab('general')}>
          模型配置
        </button>
        <button className={activeTab === 'accounts' ? 'selected' : ''} onClick={() => setActiveTab('accounts')}>
          授权账户
        </button>
        <button className={activeTab === 'auxiliary' ? 'selected' : ''} onClick={() => setActiveTab('auxiliary')}>
          辅助模型
        </button>
      </div>
      {modelError && <div className="form-error">{modelError}</div>}
      {activeTab === 'auxiliary' ? (
        <>
          <MemoryReviewModelSettings models={models} />
          <AuxiliaryModelsPanel groups={slotGroups} />
        </>
      ) : activeTab === 'accounts' ? (
        <>
          <p className="settings-description">
            全局授权账户。任意 Agent 的模型配置绑定后，Hermes、Pi、Codex 与 Claude 都能使用同一账户。
          </p>
          {oauthAccountsApiError ? (
            <div className="form-error">{oauthAccountsApiError}</div>
          ) : (
            <OAuthAccountsPanel accounts={oauthAccounts} onChanged={refreshAccounts} />
          )}
        </>
      ) : (
        <div className="model-grid">
          {models.map((model) => {
            const runtimeCompatibility = ['hermes', 'pi', 'codex', 'claude'].map((runtimeId) => ({
              runtimeId,
              compatibility: runtimeCatalogs[runtimeId]?.models.find((item) => item.id === model.id)?.compatibility,
            }));
            return (
              <div
                className="model-card"
                key={model.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setEditingModel(model);
                  setModalOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setEditingModel(model);
                    setModalOpen(true);
                  }
                }}
              >
                <div className="model-card-top">
                  <span>{modelKindLabel(model.kind)}</span>
                  <small>{modelAuthorizationLabel(model)}</small>
                  <button
                    className="icon-btn small danger model-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(model);
                    }}
                    aria-label={`删除 ${model.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
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
                      : status === 'ready'
                      ? '可用'
                      : status === 'partial'
                      ? '部分可用'
                      : status === 'missing_credentials'
                      ? '缺少凭据'
                      : /尚未开放/.test(compatibility.reason || '')
                      ? '尚未开放'
                      : '不兼容';
                    return (
                      <span
                        key={runtimeId}
                        className={compatibility ? status : 'checking'}
                        title={compatibility?.reason || '正在读取运行时兼容状态'}
                      >
                        {runtimeLabels[runtimeId]} · {label}
                      </span>
                    );
                  })}
                </div>
                <div className="model-tags model-tags-models">
                  {(model.models?.length ? model.models : [model.model].filter(Boolean)).map((item) => (
                    <span key={item} className={item === model.model ? 'default' : ''}>
                      {item}
                      {item === model.model ? ' 默认' : ''}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <button
            className="model-card add"
            onClick={() => {
              setEditingModel(null);
              setModalOpen(true);
            }}
          >
            <Plus size={22} />
            <strong>添加模型</strong>
            <p>官方 API / 第三方中转站 / 本地模型</p>
          </button>
        </div>
      )}
      {modalOpen && (
        <ModelEditorModal
          model={editingModel}
          oauthAccounts={oauthAccounts}
          onAccountsChanged={refreshAccounts}
          onClose={() => {
            setModalOpen(false);
            setEditingModel(null);
          }}
          onSave={handleSave}
          fetchAvailableModels={fetchAvailableModels}
          onCapabilityChanged={onCapabilityChanged}
        />
      )}
    </>
  );
}

export function OAuthAccountsPanel({
  accounts,
  onChanged,
}: {
  accounts: OAuthAccount[];
  onChanged: () => Promise<void>;
}) {
  const [authType, setAuthType] = useState<ProviderAuthType | null>(null);
  const [newAccountId, setNewAccountId] = useState('');
  const providerLabel: Record<string, string> = {
    'openai-codex': 'OpenAI Codex',
    'claude-oauth': 'Claude',
    'google-gemini-cli': 'Gemini',
  };
  async function remove(account: OAuthAccount) {
    if (!window.confirm(`删除授权账户「${account.label}」？关联模型必须先迁移或删除。`)) return;
    const response = await fetch(
      `/api/oauth-accounts/${encodeURIComponent(account.id)}?providerKey=${encodeURIComponent(account.providerKey)}`,
      { method: 'DELETE' },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data.error || '授权账户删除失败。');
      return;
    }
    await onChanged();
  }
  async function rename(account: OAuthAccount) {
    const label = window.prompt('账户名称', account.label)?.trim();
    if (!label || label === account.label) return;
    const response = await fetch(`/api/oauth-accounts/${encodeURIComponent(account.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerKey: account.providerKey, label }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error || '账户重命名失败。');
      return;
    }
    await onChanged();
  }
  return (
    <div className="model-grid">
      {accounts.map((account) => (
        <div className="model-card" key={`${account.providerKey}:${account.id}`}>
          <div className="model-card-top">
            <span>授权账户</span>
            <button
              className="icon-btn small danger"
              onClick={() => void remove(account)}
              aria-label={`删除 ${account.label}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <strong>{account.label}</strong>
          <p>{providerLabel[account.providerKey] || account.providerKey}</p>
          <p>{account.identity}</p>
          <p>{account.models?.length ? `关联 ${account.models.length} 个模型配置` : '尚未关联模型配置'}</p>
          <button className="secondary-btn" onClick={() => void rename(account)}>
            重命名
          </button>
        </div>
      ))}
      <button
        className="model-card add"
        onClick={() => {
          setNewAccountId(crypto.randomUUID());
          setAuthType('codex-device');
        }}
      >
        <Plus size={22} />
        <strong>授权新 Codex 账号</strong>
        <p>授权后可在模型配置中选择。</p>
      </button>
      <button
        className="model-card add"
        onClick={() => {
          setNewAccountId(crypto.randomUUID());
          setAuthType('claude-pkce');
        }}
      >
        <Plus size={22} />
        <strong>授权新 Claude 账号</strong>
        <p>授权后可在模型配置中选择。</p>
      </button>
      <button
        className="model-card add"
        onClick={() => {
          setNewAccountId(crypto.randomUUID());
          setAuthType('gemini-loopback');
        }}
      >
        <Plus size={22} />
        <strong>授权新 Gemini 账号</strong>
        <p>授权后可在模型配置中选择。</p>
      </button>
      {authType && (
        <ProviderAuthModal
          authType={authType}
          accountId={newAccountId}
          onClose={() => setAuthType(null)}
          onSuccess={() => {
            setAuthType(null);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}

export function ModelEditorModal({
  model,
  oauthAccounts,
  onAccountsChanged,
  onClose,
  onSave,
  fetchAvailableModels: _fetchAvailableModels,
  onCapabilityChanged: _onCapabilityChanged,
}: {
  model: ModelProfile | null;
  oauthAccounts: OAuthAccount[];
  onAccountsChanged: () => Promise<void>;
  onClose: () => void;
  onSave: (payload: ModelPayload, options?: { close?: boolean; persistedModels?: ModelProfile[] }) => Promise<boolean>;
  fetchAvailableModels: FetchAvailableModels;
  onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void;
}) {
  const emptyPricing: ModelPricing = { input: null, output: null, cacheRead: null, cacheCreation: null };
  const titleId = useId();
  const providerTypeForModel = (value: ModelProfile | null): 'preset' | 'custom' =>
    value &&
    (!value.providerKey || value.providerKey.startsWith('custom:') || compatibilityRelayProviderKeys.has(value.providerKey))
      ? 'custom'
      : 'preset';
  const draftForModel = (value: ModelProfile | null): ModelPayload => ({
    name: value?.name || '',
    provider: value?.provider || '',
    kind: value?.kind || 'official',
    protocol: value?.protocol || 'OpenAI Compatible',
    model: value?.model || '',
    models: value?.models?.length ? value.models : [value?.model || ''].filter(Boolean),
    baseUrl: value?.baseUrl || '',
    apiKey: '',
    providerKey: value?.providerKey || '',
    oauthAccountId: value?.oauthAccountId || '',
    apiMode: value?.apiMode || '',
    apiModePreference:
      value?.apiModePreference ||
      (value
        ? value.apiMode === 'codex_responses' || value.apiMode === 'openai_responses'
          ? 'openai_responses'
          : value.apiMode === 'anthropic_messages'
          ? 'anthropic_messages'
          : 'chat_completions'
        : 'auto'),
    modelsUrl: value?.modelsUrl || '',
    modelApiModes: value?.modelApiModes || {},
    compat: value?.compat || { thinkingFormat: 'openai', requestOverrides: {} },
    modelCompat: value?.modelCompat || {},
    contextLimit: value?.contextLimit || null,
    pricing: value?.pricing || emptyPricing,
    capabilityMode: value?.capabilityMode || 'auto',
    capabilityOverrides: value?.capabilityOverrides || {},
  });
  const secureOrigin = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.origin.toLowerCase() : '';
    } catch {
      return '';
    }
  };
  const comparableDraft = (value: ModelPayload) => JSON.stringify({ ...value, apiKey: value.apiKey || '' });
  const connectionSignature = (value: ModelPayload) =>
    JSON.stringify({
      baseUrl: value.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
      apiModePreference: value.apiModePreference || 'auto',
      apiMode: value.apiMode || '',
      model: value.model,
      modelApiModes: value.modelApiModes || {},
      capabilityMode: value.capabilityMode,
      capabilityOverrides: value.capabilityOverrides || {},
      compat: value.compat || {},
      modelCompat: value.modelCompat || {},
      apiKey: value.apiKey || '',
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
  const [availableModels, setAvailableModels] = useState<string[]>(
    model?.models?.length ? model.models : [model?.model || ''].filter(Boolean),
  );
  const [detectedCapabilities, setDetectedCapabilities] = useState<Record<string, ModelCapability>>({});
  const [capabilityProbeInfo, setCapabilityProbeInfo] = useState<{
    active?: boolean;
    models?: Array<{ modelId: string; status: string; stage?: string; error?: string }>;
  }>({});
  const [capabilityRefreshTick, setCapabilityRefreshTick] = useState(0);
  const [retryingCapabilityModel, setRetryingCapabilityModel] = useState('');
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
  const filteredPresets = presets.filter((preset) =>
    `${preset.label} ${preset.value}`.toLowerCase().includes(providerQuery.toLowerCase().trim()),
  );
  const canFetchModels = Boolean(draft.baseUrl && !selectedAuthType && /^https?:\/\//i.test(draft.baseUrl));
  const fetchModelsVisible = providerType === 'custom' || canFetchModels;
  const savedCredentialReusable = Boolean(
    model?.hasApiKey && secureOrigin(savedDraft.baseUrl) && secureOrigin(savedDraft.baseUrl) === secureOrigin(draft.baseUrl),
  );
  const hasUsableApiKey = Boolean(draft.apiKey || savedCredentialReusable || selectedAuthType);
  const fetchModelsDisabled = isFetching || !draft.baseUrl || !hasUsableApiKey || !/^https?:\/\//i.test(draft.baseUrl);
  const isDirty = comparableDraft(draft) !== comparableDraft(savedDraft);
  const connectionDirty = connectionSignature(draft) !== connectionSignature(savedDraft);
  const routeChanged =
    draft.apiMode !== savedDraft.apiMode ||
    draft.baseUrl.trim().replace(/\/+$/, '').toLowerCase() !== savedDraft.baseUrl.trim().replace(/\/+$/, '').toLowerCase();
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
    setCapabilityProbeInfo({});
    setCatalogInfo(null);
    setVerifyState('idle');
    setVerifyMessage('');
    setRetryingCapabilityModel('');
  }, [model?.id]);

  useEffect(() => {
    if (!model?.id) return undefined;
    let cancelled = false;
    let timer = 0;
    const loadCapabilities = async () => {
      const data = await fetch('/api/model-capabilities').then((response) => response.json()).catch(() => null);
      if (cancelled || !data) return;
      const prefix = `${model.id}::`;
      const next = Object.fromEntries(
        Object.entries(data.capabilities || {})
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
      const probe = data.probes?.[model.id] || {};
      setDetectedCapabilities(next as Record<string, ModelCapability>);
      setCapabilityProbeInfo(probe);
      setCatalogInfo(data.providers?.[model.id] || null);
      if (probe.active) timer = window.setTimeout(loadCapabilities, 1200);
    };
    void loadCapabilities();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [model?.id, capabilityRefreshTick]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/model-providers/presets')
      .then((res) => res.json())
      .then((data: { providers?: ProviderPreset[] }) => {
        if (cancelled) return;
        const nextPresets = Array.isArray(data.providers) ? data.providers : [];
        setPresets(nextPresets);
        setAuthorizedProviders(
          Object.fromEntries(nextPresets.filter((preset) => preset.authenticated).map((preset) => [preset.value, true])),
        );
        const current = nextPresets.find((preset) => preset.value === model?.providerKey);
        if (current) {
          setProviderQuery(current.label);
          setOauthState(
            current.authenticated ? (current.models.length ? 'ready' : 'catalog_error') : 'unauthenticated',
          );
        }
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [model?.providerKey]);

  function protocolFromApiMode(apiMode?: ProviderApiMode): ModelProtocol {
    if (apiMode === 'anthropic_messages') return 'Anthropic Compatible';
    if (apiMode === 'openai_responses' || apiMode === 'codex_responses' || apiMode === 'chat_completions')
      return 'OpenAI Compatible';
    return apiMode ? 'Custom' : 'OpenAI Compatible';
  }

  function protocolLabel(apiMode?: ProviderApiMode) {
    if (apiMode === 'codex_responses' || apiMode === 'openai_responses') return 'OpenAI Responses';
    if (apiMode === 'anthropic_messages') return 'Anthropic Messages';
    return 'OpenAI Chat Completions';
  }

  function kindFromPreset(preset: ProviderPreset): ModelKind {
    if (preset.value === 'lmstudio') return 'local';
    if (preset.value.includes('fun') || preset.value.includes('gateway') || preset.value.includes('router'))
      return 'relay';
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
    const nextAuthenticated = preset.authType
      ? Boolean(preset.authenticated || authorizedProviders[preset.value])
      : false;
    setProviderQuery(preset.label);
    setAvailableModels(nextModels);
    setDetectedCapabilities({});
    setCapabilityProbeInfo({});
    setCatalogInfo(preset.catalog || null);
    setVerifyState('idle');
    setVerifyMessage('');
    setDetectionStage('');
    setOauthState(
      preset.authType
        ? nextAuthenticated
          ? nextModels.length
            ? 'ready'
            : 'catalog_error'
          : 'unauthenticated'
        : 'unauthenticated',
    );
    setDraft((current) => ({
      ...current,
      name: preset.label,
      provider: preset.label,
      providerKey: preset.value,
      oauthAccountId: preset.value === model?.providerKey ? model?.oauthAccountId || '' : '',
      apiMode: preset.apiMode || 'chat_completions',
      apiModePreference:
        preset.apiMode === 'codex_responses' || preset.apiMode === 'openai_responses'
          ? 'openai_responses'
          : preset.apiMode === 'anthropic_messages'
          ? 'anthropic_messages'
          : 'chat_completions',
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
    setCapabilityProbeInfo({});
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
          const detail = [event.protocol, event.path, event.status ? `HTTP ${event.status}` : '', event.error]
            .filter(Boolean)
            .join(' · ');
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
      const nextModels = Array.isArray(result.models) ? (result.models as string[]) : [];
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
      setDetectedCapabilities(
        (result.capabilities ||
          (result.capability && nextModel ? { [nextModel]: result.capability } : {})) as Record<
          string,
          ModelCapability
        >,
      );
      setCatalogInfo(result.catalog || null);
      setAvailableModels(nextModels);
      setDraft(nextDraft);
      previousVerificationSignature.current = connectionSignature(nextDraft);
      setVerifyState('passed');
      setDetectionStage('检测完成');
      const capability = result.capability as ModelCapability | undefined;
      const reasoning = capability?.reasoningEfforts?.length
        ? `支持 ${capability.reasoningEfforts.length} 档推理`
        : '推理能力尚未确认';
      setVerifyMessage(
        result.autoCompletedV1
          ? `已自动补全 /v1，连接验证通过 · ${protocolLabel(result.apiMode)} · ${reasoning}`
          : `检测完成 · ${protocolLabel(result.apiMode)} · ${reasoning}`,
      );
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

  async function handleAuthSuccess(result: {
    models?: string[];
    catalog?: CatalogInfo;
    capabilities?: Record<string, ModelCapability>;
    authenticated?: boolean;
    accountId?: string;
  }) {
    const providerKey = draft.providerKey || selectedPreset;
    setAuthorizedProviders((current) => ({ ...current, [providerKey]: true }));
    setAuthType(null);
    const nextModels = Array.isArray(result.models) ? result.models : [];
    setAvailableModels(nextModels);
    setCatalogInfo(result.catalog || null);
    setDetectedCapabilities(result.capabilities || {});
    setDraft((current) => ({
      ...current,
      oauthAccountId: result.accountId || current.oauthAccountId,
      models: nextModels,
      model: nextModels.includes(current.model) ? current.model : nextModels[0] || '',
    }));
    setOauthState(nextModels.length ? 'ready' : 'catalog_error');
    setFetchError(
      nextModels.length ? '' : result.catalog?.refreshError || '授权已完成，但模型目录获取失败。请重新获取模型。',
    );
  }

  async function refreshOAuthCatalog() {
    if (draft.providerKey !== 'openai-codex') return;
    setOauthState('authorized_loading_catalog');
    setIsFetching(true);
    setFetchError('');
    try {
      const response = await fetch('/api/auth/codex/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: draft.oauthAccountId || '' }),
      });
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
    setDraft((current) =>
      isCodex
        ? { ...current, oauthAccountId: accountId, model: '', models: [] }
        : { ...current, oauthAccountId: accountId },
    );
    if (!isCodex || !accountId) return;
    setOauthState('authorized_loading_catalog');
    setIsFetching(true);
    setFetchError('');
    try {
      const response = await fetch('/api/auth/codex/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
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
  const saveDisabled =
    providerType === 'preset'
      ? !selectedPreset ||
        (needsAuthorization
          ? true
          : !draft.model || !(availableModels.length || draft.models.length) || (!selectedAuthType && !draft.baseUrl))
      : isFetching ||
        !draft.baseUrl ||
        !hasUsableApiKey ||
        !draft.model ||
        !(availableModels.length || draft.models.length) ||
        (connectionDirty && verifyState !== 'passed');
  const activeCapability = routeChanged && verifyState !== 'passed' ? undefined : detectedCapabilities[draft.model];
  const capabilitySummary = activeCapability
    ? `${activeCapability.reasoning ? `支持 ${activeCapability.reasoningEfforts.length} 档推理` : '推理能力尚未确认'} · ${
        activeCapability.serviceTiers.length ? '线路接受快速模式' : '快速模式尚未确认'
      }${activeCapability.confidence === 'inferred' ? ' · 推断结果' : ''}`
    : '获取模型后显示自动识别结果。';
  const capabilityProbeByModel = Object.fromEntries(
    (capabilityProbeInfo.models || []).map((item) => [item.modelId, item]),
  );
  const capabilityStatusLabel = (modelName: string) => {
    const capability = detectedCapabilities[modelName];
    const probe = capabilityProbeByModel[modelName];
    if (probe?.status === 'queued' || probe?.status === 'running') return probe.stage || '正在识别';
    if (probe?.status === 'failed') return '识别失败';
    if (capability?.status === 'confirmed') {
      const parts = [];
      if (capability.reasoningStatus === 'confirmed' && capability.reasoningEfforts.length)
        parts.push(`${capability.reasoningEfforts.length} 档推理`);
      if (capability.serviceTierStatus === 'confirmed' && capability.serviceTiers.length) parts.push('快速模式');
      return parts.length ? parts.join(' · ') : '能力已确认';
    }
    if (capability?.status === 'unsupported') return '无可调档位';
    if (capability?.status === 'verification_failed') return '识别失败';
    return '等待识别';
  };

  async function retryCapabilityProbe(modelName: string) {
    if (!model?.id || retryingCapabilityModel) return;
    setRetryingCapabilityModel(modelName);
    setFetchError('');
    try {
      const response = await fetch(`/api/models/${model.id}/capabilities/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: modelName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '能力重新识别失败。');
      setCapabilityProbeInfo(data.probe || {});
      setCapabilityRefreshTick((value) => value + 1);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : '能力重新识别失败。');
    } finally {
      setRetryingCapabilityModel('');
    }
  }

  const effectiveProtocolLabel = draft.apiMode ? protocolLabel(draft.apiMode) : '';
  const baseUrlNeedsV1 = (() => {
    if (!['auto', 'chat_completions', 'openai_responses'].includes(draft.apiModePreference || 'auto')) return false;
    if (draft.apiMode === 'anthropic_messages') return false;
    try {
      const parsed = new URL(draft.baseUrl);
      if (parsed.hostname.toLowerCase() === 'api.anthropic.com' || /\/anthropic(?:\/v1)?\/?$/i.test(parsed.pathname))
        return false;
      if (/\.openai\.azure\.com$/i.test(parsed.hostname) || /\/openai\/deployments\//i.test(parsed.pathname))
        return false;
      const path = parsed.pathname.replace(/\/(?:models|responses|messages|chat\/completions)\/?$/i, '');
      return !path
        .split('/')
        .filter(Boolean)
        .some((part) => /^v\d+(?:beta\d*)?$/i.test(part));
    } catch {
      return false;
    }
  })();
  const detectionWaitMessage =
    elapsedSeconds >= 30
      ? '部分线路可能需要更长时间，检测仍在进行。'
      : elapsedSeconds >= 15
      ? '线路响应较慢，仍在继续探测，请耐心等待。'
      : '正在探测模型能力，通常需要 10–15 秒，请耐心等待。';

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal agent-editor provider-editor" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{model ? '编辑 Provider' : '添加 Provider'}</h2>
            {isDirty && <small className="provider-unsaved">有未保存更改</small>}
          </div>
          <button type="button" className="icon-btn provider-modal-close" onClick={requestClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="agent-editor-body provider-editor-body">
          {!model && (
            <label className="provider-field">
              <span>Provider 类型</span>
              <div className="provider-mode-tabs">
                <button
                  type="button"
                  className={providerType === 'preset' ? 'selected' : ''}
                  onClick={() => resetForProviderType('preset')}
                >
                  预设
                </button>
                <button
                  type="button"
                  className={providerType === 'custom' ? 'selected' : ''}
                  onClick={() => resetForProviderType('custom')}
                >
                  自定义
                </button>
              </div>
            </label>
          )}
          {providerType === 'preset' ? (
            <>
              <label className="provider-field provider-combobox-wrap">
                <span>
                  选择 Provider <em>*</em>
                </span>
                <ProviderPresetCombobox
                  query={providerQuery}
                  open={providerOpen}
                  presets={filteredPresets}
                  onOpenChange={setProviderOpen}
                  onQueryChange={(value) => {
                    setProviderQuery(value);
                    setProviderOpen(true);
                  }}
                  onSelect={applyPreset}
                />
              </label>
              <label className="provider-field">
                <span>
                  Base URL <em>*</em>
                </span>
                <div className="provider-base-url-control">
                  <input
                    disabled={isFetching}
                    value={draft.baseUrl}
                    onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                    placeholder="例如 https://api.example.com/v1"
                  />
                  <button
                    type="button"
                    className={baseUrlNeedsV1 ? 'provider-base-help warning' : 'provider-base-help'}
                    aria-label="Base URL 帮助"
                    aria-expanded={baseHelpOpen}
                    onClick={() => setBaseHelpOpen((open) => !open)}
                    onBlur={() => window.setTimeout(() => setBaseHelpOpen(false), 120)}
                  >
                    {baseUrlNeedsV1 ? <TriangleAlert size={15} /> : <CircleHelp size={15} />}
                  </button>
                  <span
                    className={baseHelpOpen ? 'provider-base-tooltip open' : 'provider-base-tooltip'}
                    role="tooltip"
                  >
                    {baseUrlNeedsV1
                      ? '当前地址可能缺少 /v1。检测时会同时尝试原地址和 /v1 地址，验证成功后自动使用正确地址。'
                      : 'OpenAI 兼容接口通常以 /v1 结尾；Anthropic 官方地址无需添加。系统会在检测时确认并补全正确路径。'}
                  </span>
                </div>
              </label>
              {!selectedAuthType && (
                <label className="provider-field">
                  <span>
                    API Key <em>*</em>
                  </span>
                  <input
                    disabled={isFetching}
                    value={draft.apiKey}
                    onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                    placeholder={model?.hasApiKey ? '已保存，留空表示继续使用' : 'sk-...'}
                    type="password"
                  />
                  {model?.hasApiKey && !savedCredentialReusable && !draft.apiKey && (
                    <small className="error">Base URL 地址已变化，请重新输入 API Key。</small>
                  )}
                </label>
              )}
              {selectedAuthType && (
                <label className="provider-field">
                  <span>
                    选择授权账户 <em>*</em>
                  </span>
                  <select
                    value={draft.oauthAccountId || ''}
                    onChange={(event) => void selectOAuthAccount(event.target.value)}
                  >
                    <option value="">请选择账户</option>
                    {providerAccounts.map((account) => (
                      <option value={account.id} key={account.id}>
                        {account.label} · {account.identity}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-btn provider-fetch"
                    onClick={() => {
                      setNewAccountId(crypto.randomUUID());
                      setAuthType(selectedAuthType);
                    }}
                  >
                    授权新账号
                  </button>
                </label>
              )}
              {selectedAuthType && (
                <div className="auth-provider-note">
                  <ShieldCheck size={16} />
                  <span>
                    {oauthState === 'ready'
                      ? `${selectedPresetData?.label} 已授权到 Frakio Work，模型目录已就绪。`
                      : oauthState === 'catalog_error'
                      ? `${selectedPresetData?.label} 已授权到 Frakio Work，但模型目录尚不可用。`
                      : oauthState === 'authorized_loading_catalog'
                      ? '正在读取授权账号的模型目录。'
                      : `${selectedPresetData?.label} 将授权给整个 Frakio Work。`}
                  </span>
                </div>
              )}
              <label className="provider-field">
                <span>
                  默认模型 <em>*</em>
                </span>
                {availableModels.length ? (
                  <select
                    disabled={isFetching}
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  >
                    {availableModels.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                ) : selectedAuthType ? (
                  <input value="" disabled placeholder="授权后获取模型" />
                ) : (
                  <input
                    disabled={isFetching}
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  />
                )}
              </label>
            </>
          ) : (
            <>
              <label className="provider-field">
                <span>名称</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="根据 Base URL 自动生成"
                />
              </label>
              <label className="provider-field">
                <span>
                  Base URL <em>*</em>
                </span>
                <div className="provider-base-url-control">
                  <input
                    disabled={isFetching}
                    value={draft.baseUrl}
                    onChange={(event) => updateCustomBaseUrl(event.target.value)}
                    placeholder="例如 https://api.example.com/v1"
                  />
                  <button
                    type="button"
                    className={baseUrlNeedsV1 ? 'provider-base-help warning' : 'provider-base-help'}
                    aria-label="Base URL 帮助"
                    aria-expanded={baseHelpOpen}
                    onClick={() => setBaseHelpOpen((open) => !open)}
                    onBlur={() => window.setTimeout(() => setBaseHelpOpen(false), 120)}
                  >
                    {baseUrlNeedsV1 ? <TriangleAlert size={15} /> : <CircleHelp size={15} />}
                  </button>
                  <span
                    className={baseHelpOpen ? 'provider-base-tooltip open' : 'provider-base-tooltip'}
                    role="tooltip"
                  >
                    {baseUrlNeedsV1
                      ? '当前地址可能缺少 /v1。检测时会同时尝试原地址和 /v1 地址，验证成功后自动使用正确地址。'
                      : 'OpenAI 兼容接口通常以 /v1 结尾；Anthropic 官方地址无需添加。系统会在检测时确认并补全正确路径。'}
                  </span>
                </div>
              </label>
              <label className="provider-field">
                <span>
                  API Key <em>*</em>
                </span>
                <input
                  disabled={isFetching}
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  placeholder={model?.hasApiKey ? '已保存，留空表示继续使用' : 'sk-...'}
                  type="password"
                />
                {model?.hasApiKey && !savedCredentialReusable && !draft.apiKey && (
                  <small className="error">Base URL 地址已变化，请重新输入 API Key。</small>
                )}
              </label>
              <label className="provider-field">
                <span>
                  默认模型 <em>*</em>
                </span>
                {availableModels.length ? (
                  <select
                    disabled={isFetching}
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  >
                    {availableModels.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={isFetching}
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  />
                )}
              </label>
              <label className="provider-field">
                <span>上下文长度</span>
                <input
                  value={draft.contextLimit ?? ''}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    setDraft({
                      ...draft,
                      contextLimit: event.target.value && Number.isFinite(parsed) ? Math.max(0, parsed) : null,
                    });
                  }}
                  placeholder="例如 256000（可选）"
                  inputMode="numeric"
                />
              </label>
              <label className="provider-field">
                <span>API 协议</span>
                <div className="provider-protocol-control">
                  <select
                    disabled={isFetching}
                    value={draft.apiModePreference || 'auto'}
                    onChange={(event) => {
                      const preference = event.target.value as ProviderApiModePreference;
                      setDraft({
                        ...draft,
                        apiModePreference: preference,
                        apiMode: preference === 'auto' ? '' : preference,
                      });
                    }}
                  >
                    <option value="auto">自动适配（推荐）</option>
                    <option value="chat_completions">OpenAI Chat Completions</option>
                    <option value="openai_responses">OpenAI Responses</option>
                    <option value="anthropic_messages">Anthropic Messages</option>
                  </select>
                  <small>
                    {draft.apiModePreference === 'auto'
                      ? effectiveProtocolLabel
                        ? `当前使用 ${effectiveProtocolLabel}`
                        : '检测后自动选择'
                      : '手动指定'}
                  </small>
                </div>
              </label>
            </>
          )}
          {fetchModelsVisible && (
            <button
              type="button"
              className="secondary-btn provider-fetch"
              onClick={() => void handleFetchModels()}
              disabled={fetchModelsDisabled}
            >
              {isFetching ? (
                <>
                  <LoaderCircle className="spin" size={15} />
                  正在检测
                </>
              ) : verifyState === 'failed' ? (
                '重新检测'
              ) : (
                '获取并检测'
              )}
            </button>
          )}
          {selectedAuthType && draft.providerKey === 'openai-codex' && draft.oauthAccountId && (
            <button
              type="button"
              className="secondary-btn provider-fetch"
              onClick={() => void refreshOAuthCatalog()}
              disabled={isFetching}
            >
              {isFetching ? '正在获取模型' : availableModels.length ? '刷新模型目录' : '获取模型目录'}
            </button>
          )}
          {fetchError && <div className="form-error">{fetchError}</div>}
          {isFetching && (
            <div className="provider-detection-status" aria-live="polite" aria-busy="true">
              <div className="provider-detection-line">
                <LoaderCircle className="spin" size={16} />
                <strong>{detectionStage}</strong>
                <span>已等待 {elapsedSeconds} 秒</span>
              </div>
              <div className="provider-detection-progress" aria-hidden="true">
                <i />
              </div>
              <small>{detectionWaitMessage}</small>
            </div>
          )}
          {!isFetching && verifyMessage && (
            <div
              className={
                verifyState === 'failed'
                  ? 'provider-detection-status failed'
                  : 'provider-detection-status complete'
              }
              aria-live="polite"
              aria-busy="false"
            >
              <strong>{verifyMessage}</strong>
            </div>
          )}
          {routeChanged &&
          verifyState !== 'passed' &&
          draft.baseUrl.trim().replace(/\/+$/, '').toLowerCase() !==
            savedDraft.baseUrl.trim().replace(/\/+$/, '').toLowerCase() ? (
            <div className="provider-catalog-status">
              <strong>模型列表待重新检测</strong>
            </div>
          ) : (
            catalogInfo && (
              <div className="provider-catalog-status">
                <strong>已找到 {availableModels.length} 个模型</strong>
                <small>
                  {catalogInfo.lastSuccessAt
                    ? `最近检测 ${new Date(catalogInfo.lastSuccessAt).toLocaleString()}`
                    : '本次检测已完成'}
                </small>
              </div>
            )
          )}
          <section className="provider-capability-settings">
            <div className="provider-capability-head">
              <div>
                <strong>能力识别</strong>
                <small>{draft.model || '请先完成检测'}</small>
              </div>
              <span className="provider-auto-badge">自动</span>
            </div>
            <p className="provider-capability-summary">{capabilitySummary}</p>
            {availableModels.length > 0 && (
              <div className="provider-capability-models">
                {availableModels.map((modelName) => {
                  const probe = capabilityProbeByModel[modelName];
                  const capability = detectedCapabilities[modelName];
                  const retryable = Boolean(
                    model?.id &&
                      (['failed', 'unresolved'].includes(probe?.status || '') ||
                        ['unknown', 'verification_failed'].includes(capability?.status || 'unknown')),
                  );
                  const retrying =
                    retryingCapabilityModel === modelName || probe?.status === 'queued' || probe?.status === 'running';
                  return (
                    <div
                      key={modelName}
                      className={probe?.status === 'failed' ? 'failed' : ''}
                      title={probe?.error || ''}
                    >
                      <span>{modelName}</span>
                      <em>{capabilityStatusLabel(modelName)}</em>
                      {retryable && (
                        <button
                          type="button"
                          className="provider-capability-retry"
                          disabled={retrying || Boolean(retryingCapabilityModel)}
                          onClick={() => void retryCapabilityProbe(modelName)}
                          aria-label={`重新识别 ${modelName} 的模型能力`}
                          title="重新识别"
                        >
                          {retrying ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        <div className="provider-modal-footer">
          <button className="secondary-btn" onClick={requestClose}>
            取消
          </button>
          <button className="send-btn" onClick={() => void saveDraft()} disabled={saveDisabled}>
            {needsAuthorization ? '授权' : model ? '保存' : '添加'}
          </button>
        </div>
        {authType && (
          <ProviderAuthModal
            authType={authType}
            accountId={newAccountId}
            onClose={() => {
              setAuthType(null);
              setOauthState('unauthenticated');
            }}
            onSuccess={(result) => {
              void onAccountsChanged();
              void handleAuthSuccess(result);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ProviderPresetCombobox({
  query,
  open,
  presets,
  onQueryChange,
  onOpenChange,
  onSelect,
}: {
  query: string;
  open: boolean;
  presets: ProviderPreset[];
  onQueryChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
}) {
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
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => onOpenChange(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onOpenChange(false);
              event.currentTarget.blur();
            }
          }}
          placeholder="选择一个 provider..."
        />
        <button type="button" onClick={() => onOpenChange(!open)} aria-label="展开 Provider 列表">
          <ChevronDown size={16} />
        </button>
      </div>
      {open && (
        <div className="provider-combobox-menu">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.value}
              onMouseDown={(event) => {
                event.preventDefault();
                selectPreset(preset.value);
              }}
            >
              {preset.label}
            </button>
          ))}
          {!presets.length && <span>没有匹配的 Provider</span>}
        </div>
      )}
    </div>
  );
}

export function ProviderAuthModal({
  authType,
  accountId = '',
  accountLabel = '',
  onClose,
  onSuccess,
}: {
  authType: ProviderAuthType;
  accountId?: string;
  accountLabel?: string;
  onClose: () => void;
  onSuccess: (result: {
    models?: string[];
    catalog?: CatalogInfo;
    capabilities?: Record<string, ModelCapability>;
    authenticated?: boolean;
    accountId?: string;
  }) => void;
}) {
  const titleId = useId();
  const [status, setStatus] = useState<'loading' | 'waiting' | 'submitting' | 'approved' | 'expired' | 'error'>(
    'loading',
  );
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
        const endpoint =
          authType === 'codex-device'
            ? '/api/auth/codex/start'
            : authType === 'claude-pkce'
            ? '/api/auth/claude/start'
            : '/api/auth/gemini/start';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, accountLabel }),
        });
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
              const pollEndpoint =
                authType === 'codex-device'
                  ? `/api/auth/codex/${data.session_id}`
                  : `/api/auth/gemini/${data.session_id}`;
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

  const title =
    authType === 'codex-device'
      ? 'OpenAI Codex 授权'
      : authType === 'claude-pkce'
      ? 'Claude OAuth 授权'
      : 'Google Gemini OAuth 授权';

  return (
    <div className="modal-backdrop nested">
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{status === 'waiting' ? '浏览器会打开授权页面，完成后回到这里。' : '正在准备授权。'}</p>
          </div>
          <button type="button" className="icon-btn provider-modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="auth-modal-body">
          {status === 'loading' && (
            <div className="auth-state">
              <RefreshCw className="spin" size={22} />
              <span>正在启动授权...</span>
            </div>
          )}
          {status === 'waiting' && authType === 'codex-device' && (
            <div className="auth-state">
              <strong className="auth-code">{userCode}</strong>
              <button className="secondary-btn" onClick={() => navigator.clipboard?.writeText(userCode)}>
                复制授权码
              </button>
              <button className="send-btn" onClick={() => void openExternalUrl(authUrl)}>
                <ExternalLink size={15} />
                重新打开授权页面
              </button>
            </div>
          )}
          {status === 'waiting' && authType === 'gemini-loopback' && (
            <div className="auth-state">
              <button className="send-btn" onClick={() => void openExternalUrl(authUrl)}>
                <ExternalLink size={15} />
                重新打开 Google 授权
              </button>
              <span>授权完成后会自动返回。</span>
            </div>
          )}
          {(status === 'waiting' || status === 'submitting') && authType === 'claude-pkce' && (
            <div className="auth-state">
              <button className="send-btn" onClick={() => void openExternalUrl(authUrl)}>
                <ExternalLink size={15} />
                重新打开 Claude 授权
              </button>
              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="粘贴 Claude 返回的 code"
              />
              <button
                className="secondary-btn full"
                onClick={() => void submitClaudeCode()}
                disabled={!code.trim() || status === 'submitting'}
              >
                {status === 'submitting' ? '提交中' : '提交 code'}
              </button>
            </div>
          )}
          {status === 'approved' && (
            <div className="auth-state success">
              <CheckCircle2 size={28} />
              <span>授权完成。</span>
            </div>
          )}
          {status === 'expired' && (
            <div className="auth-state">
              <span>授权已过期，请重新发起。</span>
            </div>
          )}
          {status === 'error' && <div className="form-error">{errorMessage}</div>}
        </div>
      </div>
    </div>
  );
}

export function modelKindLabel(kind: ModelKind) {
  if (kind === 'relay') return '第三方中转站';
  if (kind === 'local') return '本地模型';
  return '官方模型';
}

export function modelAuthorizationLabel(model: ModelProfile) {
  const oauthLabels: Record<string, string> = {
    'openai-codex': '已授权 ChatGPT / Codex 账号',
    'claude-oauth': '已授权 Claude Pro / Max',
    'google-gemini-oauth': '已授权 Google Gemini OAuth',
    'google-gemini-cli': '已授权 Google Gemini OAuth',
  };
  if (oauthLabels[model.providerKey || ''])
    return model.oauthAccountBindingRequired
      ? '需要选择授权账户'
      : model.hasApiKey
      ? oauthLabels[model.providerKey || '']
      : '未授权';
  return model.hasApiKey ? '已配置 Key' : '未配置 Key';
}

export function modelPricingSummary(pricing?: ModelPricing) {
  if (!pricing || [pricing.input, pricing.output, pricing.cacheRead, pricing.cacheCreation].every((value) => value == null))
    return '默认价格';
  return `in $${pricing.input ?? 0}/M · out $${pricing.output ?? 0}/M`;
}

export function pricingSourceLabel(source?: string) {
  if (source === 'configured') return '配置价格';
  if (source === 'default') return '默认价格';
  return '未计价';
}
// wjz新建文件结束。
