// wjz新建文件，新建原因：解耦 main.tsx 中的 HarnessChoiceGrid 运行内核单选网格组件，修改时间：2026-08-17。
// 文件内容概述：Agent 默认 Harness 选择网格，支持禁用态与选中状态高亮。
// wjz新建文件结束。

import React from 'react';
import { Check } from 'lucide-react';
import type { HarnessId } from '../../types/workbench';
import { harnessChoices } from '../../utils/workbench-helpers';
import { RuntimeLabel } from './RuntimeLabel';

export function HarnessChoiceGrid({
  value,
  onChange,
  disabled = false,
  unavailable = {},
}: {
  value: HarnessId;
  onChange: (value: HarnessId) => void;
  disabled?: boolean;
  unavailable?: Partial<Record<HarnessId, boolean>>;
}) {
  return (
    <div className="agent-runtime-grid harness-choice-grid" role="radiogroup" aria-label="默认 Harness">
      {harnessChoices.map((choice) => {
        const isUnavailable = Boolean(unavailable[choice.id]);
        const selected = value === choice.id;
        return (
          <button
            type="button"
            key={choice.id}
            className={`agent-runtime-card ${selected ? 'selected' : ''} ${isUnavailable ? 'unavailable' : ''}`}
            aria-pressed={selected}
            aria-label={`${choice.name}${isUnavailable ? '（不可用）' : ''}`}
            disabled={disabled || isUnavailable}
            onClick={() => onChange(choice.id)}
          >
            <span className="agent-runtime-card-icon">
              <RuntimeLabel runtimeId={choice.runtimeId} showName={false} />
            </span>
            <span className="agent-runtime-card-copy">
              <strong>{choice.name}</strong>
            </span>
            {selected && (
              <span className="agent-runtime-check">
                <Check size={13} aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
