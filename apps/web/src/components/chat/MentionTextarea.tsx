// wjz新建文件，新建原因：解耦 main.tsx 中的 @ 提及输入框与快捷斜杠指令弹窗（MentionTextarea），修改时间：2026-08-17。
// 文件内容概述：MentionTextarea 自动伸缩多行输入框、@Agent 提及弹出菜单、/collab 协作斜杠指令自动补全与快捷按键分发。
import React, { useEffect, useRef, useState } from 'react';
import { Network } from 'lucide-react';
import type {
  Agent,
  MentionOption,
  WorkbenchUiSettings,
} from '../../types/workbench';
import { buildMentionOptions } from '../../utils/workbench-helpers';
import { AgentAvatar } from '../common/AgentAvatar';

export function MentionTextarea({
  value,
  onChange,
  onSend,
  sendKey,
  agents,
  selectedAgentIds,
  placeholder,
  collaborationEnabled = false,
  onCollaborationChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sendKey: WorkbenchUiSettings['sendKey'];
  agents: Agent[];
  selectedAgentIds: string[];
  placeholder: string;
  collaborationEnabled?: boolean;
  onCollaborationChange?: (enabled: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [slashActive, setSlashActive] = useState(false);
  const options = buildMentionOptions(agents, selectedAgentIds, mentionQuery).slice(0, 8);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = Number.parseFloat(getComputedStyle(el).maxHeight);
    const nextHeight = Number.isFinite(maxHeight) ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!mentionActive) return;
      const target = event.target as HTMLElement;
      if (!target.closest('.mention-menu')) setMentionActive(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mentionActive]);

  useEffect(() => {
    const active = dropdownRef.current?.querySelector('.active') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function updateMentionState(nextValue = value) {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    let atPos = -1;
    for (let index = cursorPos - 1; index >= 0; index -= 1) {
      const char = nextValue[index];
      if (char === '@') {
        atPos = index;
        break;
      }
      if (/\s/.test(char || '')) break;
    }
    if (atPos === -1 || (atPos > 0 && /[A-Za-z0-9_]/.test(nextValue[atPos - 1] || ''))) {
      setMentionActive(false);
      return;
    }
    const query = nextValue.slice(atPos + 1, cursorPos);
    if (/\s/.test(query)) {
      setMentionActive(false);
      return;
    }
    const nextOptions = buildMentionOptions(agents, selectedAgentIds, query);
    setMentionQuery(query);
    setMentionStartIndex(atPos);
    setActiveIndex(0);
    setMentionActive(nextOptions.length > 0);
  }

  function applyCollaborationCommand(nextValue: string) {
    const match = nextValue.match(/^\s*\/collab(?:\s+|$)/i);
    if (!match || !onCollaborationChange) return false;
    onCollaborationChange(true);
    onChange(nextValue.slice(match[0].length));
    setSlashActive(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
    return true;
  }

  function selectCollaborationCommand() {
    if (!onCollaborationChange) return;
    onCollaborationChange(true);
    onChange(value.replace(/^\s*\/[^\s]*\s*/i, ''));
    setSlashActive(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function selectMention(option: MentionOption) {
    const el = textareaRef.current;
    if (!el || mentionStartIndex < 0) return;
    const before = value.slice(0, mentionStartIndex);
    const after = value.slice(el.selectionStart);
    const insert = `@${option.name} `;
    const nextValue = `${before}${insert}${after}`;
    onChange(nextValue);
    setMentionActive(false);
    requestAnimationFrame(() => {
      const nextPos = before.length + insert.length;
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashActive) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectCollaborationCommand();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashActive(false);
        return;
      }
    }
    if (mentionActive && options.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectMention(options[activeIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionActive(false);
        return;
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      (sendKey !== 'mod-enter' || event.metaKey || event.ctrlKey)
    ) {
      if (isComposing || event.nativeEvent.isComposing) return;
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="mention-textarea-wrap">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (applyCollaborationCommand(nextValue)) return;
          onChange(nextValue);
          setSlashActive(
            Boolean(
              onCollaborationChange &&
                /^\s*\/[^\s]*$/i.test(nextValue) &&
                '/collab'.startsWith(nextValue.trim().toLowerCase()),
            ),
          );
          if (!isComposing) requestAnimationFrame(() => updateMentionState(nextValue));
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => {
          setIsComposing(false);
          requestAnimationFrame(() => updateMentionState());
        }}
        onClick={() => updateMentionState()}
        placeholder={placeholder}
        data-collaboration={collaborationEnabled ? 'true' : 'false'}
      />
      {mentionActive && options.length > 0 && (
        <div className="mention-menu" ref={dropdownRef}>
          {options.map((option, index) => (
            <button
              type="button"
              className={index === activeIndex ? 'mention-option active' : 'mention-option'}
              key={option.key}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMention(option);
              }}
            >
              {option.agent ? (
                <AgentAvatar agent={option.agent} size="sm" />
              ) : (
                <span className="mention-all-avatar">@</span>
              )}
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {slashActive && !mentionActive && (
        <div className="mention-menu slash-command-menu">
          <button
            type="button"
            className="mention-option active"
            onMouseDown={(event) => {
              event.preventDefault();
              selectCollaborationCommand();
            }}
          >
            <span className="slash-command-avatar">
              <Network size={14} />
            </span>
            <span>
              <strong>协作</strong>
              <small>/collab · 生成多 Agent 协作方案</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
// wjz新建文件结束。
