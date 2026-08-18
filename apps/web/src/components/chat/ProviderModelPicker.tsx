// wjz新建文件，新建原因：解耦模型选择器与浮层菜单组件（ProviderModelPicker, calculateProviderModelMenuPlacement），修改时间：2026-08-17。
// 文件内容概述：多运行时模型选择器、推理强度/速度覆盖面板及下拉位置自适应计算。
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { modelChoiceValue, modelNamesForProvider, resolveModelChoice } from '../../utils/model-helpers';
import type {
  AgentRunOverride,
  ModelCapability,
  ModelProfile,
  RuntimeId,
  RuntimeModelCatalog,
} from '../../types/workbench';

export type ProviderModelMenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  openAbove: boolean;
  submenuSide: 'left' | 'right';
};

export function calculateProviderModelMenuPlacement(
  trigger: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
  advanced: boolean,
): ProviderModelMenuPlacement {
  const gap = 8;
  const margin = 12;
  const narrow = viewportWidth < 720;
  const rootPanelWidth = 232;
  const subPanelWidth = 300;
  const singlePanelWidth = Math.min(subPanelWidth, viewportWidth - margin * 2);
  const width = advanced && !narrow ? rootPanelWidth : singlePanelWidth;
  const minLeft = margin;
  const maxLeft = Math.max(minLeft, viewportWidth - width - margin);
  const desiredLeft = Math.max(minLeft, Math.min(maxLeft, trigger.right - width));
  let left = desiredLeft;
  let submenuSide: 'left' | 'right' = 'right';

  if (advanced && !narrow) {
    const rightLimit = viewportWidth - margin - rootPanelWidth - gap - subPanelWidth;
    const leftLimit = margin + subPanelWidth + gap;
    const rightFits = desiredLeft <= rightLimit;
    const leftFits = desiredLeft >= leftLimit;

    if (!rightFits && leftFits) {
      submenuSide = 'left';
    } else if (!rightFits && !leftFits) {
      const rightCandidate = Math.max(minLeft, Math.min(maxLeft, rightLimit));
      const leftCandidate = Math.max(minLeft, Math.min(maxLeft, leftLimit));
      const rightDistance = Math.abs(desiredLeft - rightCandidate);
      const leftDistance = Math.abs(desiredLeft - leftCandidate);
      if (rightDistance <= leftDistance) {
        left = rightCandidate;
      } else {
        left = leftCandidate;
        submenuSide = 'left';
      }
    }
  }

  const above = Math.max(0, trigger.top - gap - margin);
  const below = Math.max(0, viewportHeight - trigger.bottom - gap - margin);
  const openAbove = above >= Math.min(180, below) || above > below;
  return {
    left,
    width,
    maxHeight: Math.max(0, Math.min(460, openAbove ? above : below)),
    openAbove,
    submenuSide,
  };
}

export function ProviderModelPicker({
  models,
  value,
  onChange,
  runtimeId = 'hermes',
  agentName = '',
  emptyLabel = '未配置模型',
  className = '',
  ariaLabel = '切换模型',
  title = '切换模型',
  allowDefault = false,
  usingDefault = false,
  capabilities,
  runOverride,
  onRunOverrideChange,
  inheritRunLabel = '跟随 Agent',
}: {
  models: ModelProfile[];
  value: string;
  onChange: (value: string) => void | Promise<void>;
  runtimeId?: RuntimeId;
  agentName?: string;
  emptyLabel?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
  allowDefault?: boolean;
  usingDefault?: boolean;
  capabilities?: Record<string, ModelCapability>;
  runOverride?: AgentRunOverride;
  onRunOverrideChange?: (override: AgentRunOverride) => void | Promise<void>;
  inheritRunLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'root' | 'model' | 'reasoning' | 'speed'>('model');
  const [saving, setSaving] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [submenuSide, setSubmenuSide] = useState<'left' | 'right'>('right');
  const [openAbove, setOpenAbove] = useState(true);
  const [runtimeCatalog, setRuntimeCatalog] = useState<RuntimeModelCatalog | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const providers = models.filter((model) => model.baseUrl && modelNamesForProvider(model).length);
  const selected = resolveModelChoice(value, providers);
  const selectedLabel = selected.modelName || selected.model?.model || emptyLabel;
  const advanced = Boolean(capabilities && runOverride && onRunOverrideChange);
  const selectedCapability = capabilities?.[selected.value];
  const reasoningLabels: Record<string, string> = {
    off: '关闭',
    none: '关闭',
    minimal: '最低',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: '最大',
    ultra: '极致',
  };
  const reasoningLabel = runOverride?.reasoningEffort
    ? reasoningLabels[runOverride.reasoningEffort] || runOverride.reasoningEffort
    : inheritRunLabel;
  const selectedTier = selectedCapability?.serviceTiers.find(
    (tier) => tier.id === runOverride?.speedMode || runOverride?.speedMode === 'fast',
  );
  const speedLabel = selectedCapability?.serviceTiers.length
    ? selectedTier?.name || (runOverride?.speedMode === 'standard' ? '标准' : inheritRunLabel)
    : selectedCapability?.serviceTierStatus === 'unsupported'
    ? '该模型不支持'
    : '能力未确认';

  useEffect(() => {
    let cancelled = false;
    setRuntimeCatalog(null);
    fetch(`/api/runtimes/${runtimeId}/models`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Runtime 模型目录读取失败。');
        if (!cancelled) setRuntimeCatalog(payload);
      })
      .catch(() => {
        if (!cancelled) setRuntimeCatalog({ runtimeId, source: 'frakio-model-center', models: [], usableModelCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeId]);

  const positionMenu = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const gap = 8;
    const placement = calculateProviderModelMenuPlacement(trigger, window.innerWidth, window.innerHeight, advanced);
    setSubmenuSide(placement.submenuSide);
    setOpenAbove(placement.openAbove);
    setMenuStyle({
      left: placement.left,
      width: placement.width,
      maxHeight: placement.maxHeight,
      ...(placement.openAbove
        ? { bottom: window.innerHeight - trigger.top + gap, top: 'auto' }
        : { top: trigger.bottom + gap, bottom: 'auto' }),
    });
  }, [advanced]);

  useLayoutEffect(() => {
    if (open) positionMenu();
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('.provider-model-trigger')?.focus();
      }
    }
    function handleViewportChange() {
      positionMenu();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, positionMenu]);

  function openPicker() {
    setSection(advanced ? 'root' : 'model');
    setOpen((current) => !current);
  }

  async function commitChoice(action: () => void | Promise<void>, closeAfterSave = false) {
    if (saving) return;
    setSaving(true);
    try {
      await action();
      if (closeAfterSave) setOpen(false);
    } catch {
      // The persisted state remains visible; users can select again after a transient failure.
    } finally {
      setSaving(false);
    }
  }

  function chooseModel(nextValue: string) {
    void commitChoice(() => onChange(nextValue), !advanced);
  }

  function chooseRunOverride(nextOverride: AgentRunOverride) {
    if (!onRunOverrideChange) return;
    void commitChoice(() => onRunOverrideChange(nextOverride));
  }

  const modelPanel = (
    <section className="provider-model-subpanel provider-model-list-panel">
      <header>
        <button type="button" onClick={() => setSection('root')} disabled={saving} aria-label="返回">
          <ArrowLeft size={15} />
        </button>
        <strong>模型</strong>
      </header>
      <div className="provider-model-scroll">
        {allowDefault && (
          <button
            type="button"
            className={`provider-model-follow-default ${usingDefault ? 'selected' : ''}`}
            onClick={() => chooseModel('')}
            disabled={saving}
            title="默认模型变化时同步更新"
          >
            <span>跟随 Agent 默认模型</span>
            {usingDefault && <Check size={14} aria-hidden="true" />}
          </button>
        )}
        {providers.length ? (
          providers.map((provider) => (
            <section className="provider-model-group" key={provider.id}>
              <strong>{provider.name || provider.provider}</strong>
              <div>
                {modelNamesForProvider(provider).map((modelName) => {
                  const itemValue = modelChoiceValue(provider, modelName);
                  const isSelected = selected.value === itemValue;
                  const catalogEntry = runtimeCatalog?.models.find((entry) => entry.id === provider.id);
                  const compatibility =
                    catalogEntry?.modelCompatibilities?.[modelName] || catalogEntry?.compatibility;
                  const usable = Boolean(compatibility?.usableModelIds.includes(modelName));
                  const compatibilityLabel =
                    compatibility?.compatibility === 'bridged'
                      ? '通过 Frakio 兼容桥使用'
                      : '可由当前 Runtime 直接使用';
                  return (
                    <button
                      type="button"
                      className={`${isSelected ? 'selected' : ''}${runtimeCatalog && !usable ? ' incompatible' : ''}`}
                      key={itemValue}
                      onClick={() => chooseModel(itemValue)}
                      disabled={saving || !runtimeCatalog || !usable}
                      title={usable ? compatibilityLabel : compatibility?.reason || '当前 Runtime 不支持该模型'}
                    >
                      <span>
                        {modelName}
                        {usable && compatibility?.compatibility === 'bridged' ? ' · 兼容桥' : ''}
                      </span>
                      {isSelected && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <span className="provider-model-empty">{emptyLabel}</span>
        )}
      </div>
    </section>
  );

  const reasoningPanel = (
    <section className="provider-model-subpanel">
      <header>
        <button type="button" onClick={() => setSection('root')} disabled={saving} aria-label="返回">
          <ArrowLeft size={15} />
        </button>
        <strong>推理强度</strong>
      </header>
      <div className="provider-setting-options">
        <button
          className={!runOverride?.reasoningEffort ? 'selected' : ''}
          onClick={() => chooseRunOverride({ ...runOverride, reasoningEffort: undefined })}
          disabled={saving}
          title="不发送推理强度覆盖参数"
        >
          <span>{inheritRunLabel}</span>
          {!runOverride?.reasoningEffort && <Check size={14} aria-hidden="true" />}
        </button>
        {(selectedCapability?.reasoningEfforts || []).map((effort) => {
          const isSelected = runOverride?.reasoningEffort === effort;
          return (
            <button
              className={isSelected ? 'selected' : ''}
              key={effort}
              onClick={() => chooseRunOverride({ ...runOverride, reasoningEffort: effort })}
              disabled={saving}
            >
              <span>{reasoningLabels[effort] || effort}</span>
              {isSelected && <Check size={14} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );

  const speedPanel = (
    <section className="provider-model-subpanel">
      <header>
        <button type="button" onClick={() => setSection('root')} disabled={saving} aria-label="返回">
          <ArrowLeft size={15} />
        </button>
        <strong>速度</strong>
      </header>
      <div className="provider-setting-options">
        <button
          className={!runOverride?.speedMode ? 'selected' : ''}
          onClick={() => chooseRunOverride({ ...runOverride, speedMode: undefined })}
          disabled={saving}
          title="不发送速度覆盖参数"
        >
          <span>{inheritRunLabel}</span>
          {!runOverride?.speedMode && <Check size={14} aria-hidden="true" />}
        </button>
        <button
          className={runOverride?.speedMode === 'standard' ? 'selected' : ''}
          onClick={() => chooseRunOverride({ ...runOverride, speedMode: 'standard' })}
          disabled={saving}
        >
          <span>标准</span>
          {runOverride?.speedMode === 'standard' && <Check size={14} aria-hidden="true" />}
        </button>
        {(selectedCapability?.serviceTiers || []).map((tier) => {
          const isSelected = runOverride?.speedMode === tier.id || runOverride?.speedMode === 'fast';
          return (
            <button
              className={isSelected ? 'selected' : ''}
              key={tier.id}
              onClick={() => chooseRunOverride({ ...runOverride, speedMode: tier.id })}
              disabled={saving}
              title={tier.billingNotice || tier.description || tier.name}
            >
              <span>{tier.name}</span>
              {isSelected && <Check size={14} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );

  const rootPanel = advanced ? (
    <section className="provider-model-root-panel">
      <button
        type="button"
        className={section === 'model' ? 'active' : ''}
        onClick={() => setSection('model')}
        disabled={saving}
      >
        <span>模型</span>
        <em>{selectedLabel}</em>
        <ChevronRight size={14} />
      </button>
      {selectedCapability?.reasoningStatus === 'confirmed' && selectedCapability.reasoning && (
        <button
          type="button"
          className={section === 'reasoning' ? 'active' : ''}
          onClick={() => setSection('reasoning')}
          disabled={saving}
          title="调整当前运行的推理强度"
        >
          <span>推理强度</span>
          <em>{reasoningLabel}</em>
          <ChevronRight size={14} />
        </button>
      )}
      {selectedCapability?.serviceTierStatus === 'confirmed' && selectedCapability.serviceTiers.length > 0 && (
        <button
          type="button"
          className={section === 'speed' ? 'active' : ''}
          onClick={() => setSection('speed')}
          disabled={saving}
          title={speedLabel}
        >
          <span>速度</span>
          <em>{speedLabel}</em>
          <ChevronRight size={14} />
        </button>
      )}
    </section>
  ) : null;

  return (
    <div className={`provider-model-picker ${className}`} ref={rootRef}>
      <button
        type="button"
        className="provider-model-trigger"
        onClick={openPicker}
        disabled={!providers.length}
        aria-label={ariaLabel}
        title={title}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {agentName && <span>{agentName}</span>}
        <strong>
          {selectedLabel}
          {advanced && runOverride?.reasoningEffort ? ` · ${reasoningLabel}` : ''}
        </strong>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            id={menuId}
            className={`provider-model-menu ${advanced ? 'advanced' : ''} ${
              section === 'root' ? 'root-only' : ''
            } submenu-${submenuSide} ${openAbove ? 'opens-above' : 'opens-below'}`}
            ref={menuRef}
            style={menuStyle}
            role="dialog"
            aria-label={title}
          >
            {rootPanel}
            {section === 'model' && modelPanel}
            {section === 'reasoning' && reasoningPanel}
            {section === 'speed' && speedPanel}
          </div>,
          document.body,
        )}
    </div>
  );
}
// wjz新建文件结束。
