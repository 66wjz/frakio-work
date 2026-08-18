// wjz新建文件，新建原因：解耦 main.tsx 中的 ToolCapabilitiesPage 工具能力检查面板组件，修改时间：2026-08-17。
// 文件内容概述：联网搜索与只读网页浏览工具能力检测与状态展示。
// wjz新建文件结束。

import React, { useCallback, useEffect, useState } from 'react';
import type { HermesNetworkStatus } from '@frakio/contracts';
import type { HermesRuntimeStatus } from '../../types/workbench';
import { SettingsInlineNote, SettingsPanel, SettingsRow } from '../../settings-ui';
import { SettingsStatusValue } from './SettingsStatusValue';
import { formatTime } from '../../utils/formatters';

export function ToolCapabilitiesPage({
  profile,
  hermesRuntime,
}: {
  profile: string;
  hermesRuntime: HermesRuntimeStatus | null;
}) {
  const [networkStatus, setNetworkStatus] = useState<HermesNetworkStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      setChecking(true);
      try {
        const response = await fetch(
          `/api/hermes/network-status${refresh ? '/refresh' : ''}?profile=${encodeURIComponent(profile || 'default')}`,
          { method: refresh ? 'POST' : 'GET', headers: refresh ? { 'x-frakio-request': '1' } : undefined },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '工具能力读取失败。');
        setNetworkStatus(data);
        setError('');
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '工具能力读取失败。');
      } finally {
        setChecking(false);
      }
    },
    [profile],
  );

  useEffect(() => {
    void load();
  }, [load, hermesRuntime?.bridge?.ready]);

  const detail = (capability: HermesNetworkStatus['search'] | HermesNetworkStatus['browser']) => {
    if (capability.detail === 'free_provider_ready') return '免费搜索可用，服务繁忙时可能限流';
    if (capability.detail === 'tool_disabled') return '工具未启用';
    if (capability.detail === 'provider_not_configured') return '搜索后端未配置';
    if (capability.detail === 'provider_unavailable') return '已配置后端当前不可用';
    if (capability.detail === 'browser_cli_missing') return '只读浏览器组件未就绪';
    return capability.provider ? `${capability.provider} 已就绪` : '已就绪';
  };

  const statusDetail = networkStatus?.checkedAt
    ? `验证于 ${formatTime(networkStatus.checkedAt)}`
    : checking
      ? '正在读取验证结果'
      : '尚未验证';

  return (
    <>
      <div className="settings-head">
        <div>
          <h2>工具能力</h2>
          <p className="settings-description">联网与浏览能力按当前 Hermes Profile 保存验证结果。</p>
        </div>
        <button className="secondary-btn" onClick={() => void load(true)} disabled={checking}>
          {checking ? '检查中' : '检查工具'}
        </button>
      </div>
      <div className="settings-section-head">
        <h3>联网与浏览</h3>
        <span className="settings-section-meta">{statusDetail}</span>
      </div>
      <SettingsPanel ariaLabel="联网与浏览工具能力">
        <SettingsRow title="网页搜索" description="实时信息优先使用搜索；单个免费服务限流不代表本机离线。">
          <SettingsStatusValue
            state={checking ? '检查中' : networkStatus?.search.ready ? '可用' : networkStatus ? '未就绪' : '尚未验证'}
            detail={networkStatus ? detail(networkStatus.search) : statusDetail}
            tone={networkStatus?.search.ready ? 'ready' : 'warning'}
          />
        </SettingsRow>
        <SettingsRow title="网页浏览" description="搜索失败时使用只读浏览器；目标网站拒绝或超时不代表本机离线。">
          <SettingsStatusValue
            state={checking ? '检查中' : networkStatus?.browser.ready ? '可用' : networkStatus ? '未就绪' : '尚未验证'}
            detail={networkStatus ? detail(networkStatus.browser) : statusDetail}
            tone={networkStatus?.browser.ready ? 'ready' : 'warning'}
          />
        </SettingsRow>
      </SettingsPanel>
      <SettingsInlineNote>
        Plan 模式允许网页搜索和只读浏览。点击、输入、脚本控制或终端 curl 被拦截时，属于 Plan 安全策略，不是网络故障。
      </SettingsInlineNote>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}
