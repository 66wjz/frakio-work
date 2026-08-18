// wjz新建文件，新建原因：解耦 Agent 头像通用组件（AgentAvatar），修改时间：2026-08-17。
// 文件内容概述：通用 Agent 头像展示，支持图片头像与纯色首字兜底。
import React from 'react';
import type { Agent } from '../../types/workbench';

export function AgentAvatar({
  agent,
  size = 'md',
}: {
  agent: Pick<Agent, 'avatarUrl' | 'color' | 'name'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className={`agent-avatar ${size}`}
      style={agent.avatarUrl ? undefined : { background: agent.color || '#64748b' }}
      aria-hidden="true"
    >
      {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : (agent.name || 'A').slice(0, 1)}
    </span>
  );
}
// wjz新建文件结束。
