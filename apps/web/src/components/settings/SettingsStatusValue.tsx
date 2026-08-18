// wjz新建文件，新建原因：解耦 main.tsx 中的 SettingsStatusValue 通用状态标签组件，修改时间：2026-08-17。
// 文件内容概述：展示设置项运行状态值（state, detail, tone: ready/warning/neutral）。
// wjz新建文件结束。

import React from 'react';

export function SettingsStatusValue({
  state,
  detail,
  tone = 'neutral',
}: {
  state: string;
  detail?: string;
  tone?: 'neutral' | 'ready' | 'warning';
}) {
  return (
    <span className={`settings-status-value ${tone}`}>
      <strong>{state}</strong>
      {detail && <small>{detail}</small>}
    </span>
  );
}
