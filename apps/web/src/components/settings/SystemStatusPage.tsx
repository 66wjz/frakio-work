// wjz新建文件，新建原因：解耦 main.tsx 中的 SystemStatusPage 系统状态面板组件，修改时间：2026-08-17。
// 文件内容概述：展示本地管理服务、Runtime Router、外部兼容 API 与 Home 目录状态。
// wjz新建文件结束。

import React from 'react';
import type {
  HermesApiAvailability,
  HermesBootstrapStatus,
  HermesRuntimeDiagnostics,
  HermesRuntimeStatus,
} from '../../types/workbench';
import { SettingsPanel, SettingsRow } from '../../settings-ui';
import { SettingsStatusValue } from './SettingsStatusValue';

export function SystemStatusPage({
  hermesBootstrap,
  hermesRuntime,
  hermesDiagnostics,
  hermesApiAvailability,
}: {
  hermesBootstrap: HermesBootstrapStatus | null;
  hermesRuntime: HermesRuntimeStatus | null;
  hermesDiagnostics: HermesRuntimeDiagnostics | null;
  hermesApiAvailability: HermesApiAvailability;
}) {
  const workbenchOnline = hermesApiAvailability !== 'offline';
  const bridgeReady = Boolean(hermesRuntime?.bridge?.ready);
  const externalApiOnline = Boolean(hermesBootstrap?.api?.online);
  const frakioHome = hermesRuntime?.frakioWorkHome || hermesDiagnostics?.frakioWorkHome?.path || '~/.frakio-work';

  return (
    <>
      <div className="settings-head">
        <h2>系统状态</h2>
      </div>
      <div className="settings-section-head">
        <h3>Frakio Work</h3>
      </div>
      <SettingsPanel ariaLabel="Frakio Work 系统状态">
        <SettingsRow title="本地管理服务" description="为桌面端提供本地状态、设置和运行管理。">
          <SettingsStatusValue
            state={workbenchOnline ? '已连接' : '未连接'}
            detail={hermesDiagnostics?.workbenchApi.url || 'http://127.0.0.1:8787'}
            tone={workbenchOnline ? 'ready' : 'warning'}
          />
        </SettingsRow>
        <SettingsRow title="Runtime Router" description="统一连接 Frakio 对话与全部执行运行时。">
          <SettingsStatusValue
            state={bridgeReady ? '运行中' : '未就绪'}
            detail={hermesRuntime?.bridge?.endpoint || '等待检测'}
            tone={bridgeReady ? 'ready' : 'warning'}
          />
        </SettingsRow>
        <SettingsRow title="外部兼容 API" description="供第三方 OpenAI-compatible 客户端使用，不影响工作台对话。">
          <SettingsStatusValue
            state={externalApiOnline ? '运行中' : '未运行'}
            detail={hermesBootstrap?.api?.apiBaseUrl || 'http://127.0.0.1:8642/v1'}
            tone={externalApiOnline ? 'ready' : 'neutral'}
          />
        </SettingsRow>
        <SettingsRow title="Frakio Work Home" description="运行状态、Bridge Socket 和应用缓存目录。">
          <SettingsStatusValue state={frakioHome} />
        </SettingsRow>
      </SettingsPanel>
    </>
  );
}
