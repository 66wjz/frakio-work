// wjz新建文件，新建原因：解耦全局搜索快捷浮层组件（GlobalSearchDialog），修改时间：2026-08-17。
// 文件内容概述：全局 Cmd/Ctrl+K 对话、Agent 与设置页面快速搜索弹窗。
import React, { useEffect, useState } from 'react';
import { BaseIcon, BaseInput } from '../base';

const Bot = (p: any) => <BaseIcon name="bot" {...p} />;
const MessageSquare = (p: any) => <BaseIcon name="message-square" {...p} />;
const Search = (p: any) => <BaseIcon name="search" {...p} />;
const Settings = (p: any) => <BaseIcon name="settings" {...p} />;
const X = (p: any) => <BaseIcon name="x" {...p} />;
import type { Agent, ThreadSummary } from '../../types/workbench';

export function GlobalSearchDialog({
  conversations,
  agents,
  onClose,
  onOpenThread,
  onOpenAgent,
  onOpenSettings,
}: {
  conversations: ThreadSummary[];
  agents: Agent[];
  onClose: () => void;
  onOpenThread: (threadId: string) => Promise<void>;
  onOpenAgent: (agentId: string) => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const threads = conversations
    .filter(
      (thread) =>
        !normalized ||
        `${thread.title} ${thread.preview} ${thread.primaryAgentName || ''}`
          .toLowerCase()
          .includes(normalized),
    )
    .slice(0, 8);
  const matchingAgents = agents
    .filter(
      (agent) =>
        !normalized ||
        `${agent.name} ${agent.role} ${agent.profileName || ''}`
          .toLowerCase()
          .includes(normalized),
    )
    .slice(0, 6);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onClose]);

  return (
    <div className="modal-backdrop global-search-backdrop" onClick={onClose}>
      <div
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="global-search-input">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话、Agent 或设置"
          />
          <button onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </label>
        <div className="global-search-results">
          <section>
            <strong>对话</strong>
            {threads.length ? (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => void onOpenThread(thread.id)}
                >
                  <MessageSquare size={16} />
                  <span>
                    <b>{thread.title}</b>
                    <small>{thread.preview || '暂无内容'}</small>
                  </span>
                </button>
              ))
            ) : (
              <p>没有匹配的对话</p>
            )}
          </section>
          <section>
            <strong>Agent</strong>
            {matchingAgents.length ? (
              matchingAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => onOpenAgent(agent.id)}
                >
                  <Bot size={16} />
                  <span>
                    <b>{agent.name}</b>
                    <small>{agent.role}</small>
                  </span>
                </button>
              ))
            ) : (
              <p>没有匹配的 Agent</p>
            )}
          </section>
          <section>
            <strong>设置</strong>
            <button onClick={onOpenSettings}>
              <Settings size={16} />
              <span>
                <b>打开设置</b>
                <small>Runtime、模型、更新和工作台偏好</small>
              </span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
// wjz新建文件结束。
