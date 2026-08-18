// wjz新建文件，新建原因：解耦 main.tsx 中的 RuntimeLabel 运行内核标签组件，修改时间：2026-08-17。
// 文件内容概述：展示 Hermes, Pi, Codex, Claude Code 等内核图标与名称的原子组件。
// wjz新建文件结束。

import React from 'react';
import { Cpu } from 'lucide-react';
import type { RuntimeId } from '../../types/workbench';
import { runtimeLabels, runtimeVisuals } from '../../utils/workbench-helpers';
import piRuntimeLogoUrl from '../../assets/runtime-logos/pi.svg';

export function RuntimeLabel({
  runtimeId,
  showName = true,
  className = '',
}: {
  runtimeId: RuntimeId;
  showName?: boolean;
  className?: string;
}) {
  const visual =
    runtimeId === 'native'
      ? { iconUrl: piRuntimeLogoUrl, label: 'Frakio Native' }
      : runtimeVisuals[runtimeId] || { iconUrl: '', label: runtimeLabels[runtimeId] || runtimeId };

  return (
    <span className={`runtime-label ${className}`.trim()}>
      {visual.iconUrl ? <img src={visual.iconUrl} alt="" aria-hidden="true" /> : <Cpu size={16} aria-hidden="true" />}
      {showName && <span>{visual.label}</span>}
    </span>
  );
}
