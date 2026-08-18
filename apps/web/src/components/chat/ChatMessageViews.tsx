// wjz新建文件，新建原因：解耦 main.tsx 中的消息头像、附件托盘、产物引用、Lightbox 与消息操作条（ChatMessageViews），修改时间：2026-08-17。
// 文件内容概述：MessageAvatar, AgentMessageAvatar, AttachmentTray, MessageAttachments, WorkMessageArtifacts, MessageImageAttachment, ImageLightbox, MessageActions。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  Image,
  LoaderCircle,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import type { Attachment } from '@frakio/contracts';
import type {
  Agent,
  AttachmentDraft,
  ChatEvent,
  UserProfile,
  WorkMessageArtifact,
} from '../../types/workbench';
import { agentColor } from '../../utils/workbench-helpers';
import { formatDuration, formatFileSize } from '../../utils/formatters';
import { AgentAvatar } from '../common/AgentAvatar';
import { IconTooltipButton } from '../common/IconTooltipButton';

export function MessageAvatar({
  message,
  agents,
  userProfile,
}: {
  message: ChatEvent;
  agents: Agent[];
  userProfile?: UserProfile;
}) {
  if (message.agentId === 'user') {
    const nickname = String(userProfile?.nickname || '').trim();
    const avatarUrl = String(userProfile?.avatarUrl || '').trim();
    if (!nickname && !avatarUrl) return null;
    return (
      <span className="user-message-avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : nickname.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const agent = agents.find((item) => item.id === message.agentId);
  if (agent) return <AgentMessageAvatar message={message} agent={agent} />;
  return (
    <span className="agent-avatar" style={{ background: agentColor(agents, message.agentId) }}>
      {message.agentName.slice(0, 1)}
    </span>
  );
}

export function AgentMessageAvatar({ message, agent }: { message: ChatEvent; agent: Agent }) {
  if (message.agentAvatarUrl)
    return (
      <span className="agent-avatar">
        <img src={message.agentAvatarUrl} alt="" />
      </span>
    );
  return <AgentAvatar agent={agent} />;
}

export function isBrowserPreviewableImage(file: File) {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type.toLowerCase());
}

export function isInlineAttachmentImage(attachment: Attachment) {
  return (
    attachment.kind === 'image' &&
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mimeType.toLowerCase())
  );
}

export function attachmentKindLabel(kind: Attachment['kind']) {
  if (kind === 'image') return '图片';
  if (kind === 'text') return '文本';
  if (kind === 'document') return '文档';
  if (kind === 'audio') return '音频';
  if (kind === 'video') return '视频';
  return '压缩包';
}

export function AttachmentTray({
  attachments,
  notice,
  onRemove,
  onRetry,
}: {
  attachments: AttachmentDraft[];
  notice: string;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  if (!attachments.length && !notice) return null;
  return (
    <div className="attachment-tray-wrap">
      {attachments.length > 0 && (
        <div className="attachment-tray" aria-label="已选择附件">
          {attachments.map((draft) => {
            const attachment = draft.attachment;
            const label = attachment ? attachmentKindLabel(attachment.kind) : '附件';
            if (draft.previewUrl) {
              return (
                <div className={`attachment-preview-card ${draft.status}`} key={draft.localId}>
                  <a
                    href={draft.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`查看 ${draft.file.name}`}
                  >
                    <img src={draft.previewUrl} alt={draft.file.name} />
                  </a>
                  <button
                    className="attachment-remove"
                    onClick={() => onRemove(draft.localId)}
                    aria-label={`移除 ${draft.file.name}`}
                  >
                    <X size={13} />
                  </button>
                  <span>
                    {draft.status === 'uploading' ? (
                      <>
                        <LoaderCircle className="spin" size={12} />上传中
                      </>
                    ) : draft.status === 'error' ? (
                      '上传失败'
                    ) : (
                      draft.file.name
                    )}
                  </span>
                  {draft.status === 'error' && (
                    <button className="attachment-retry" onClick={() => onRetry(draft.localId)}>
                      <RefreshCw size={12} />重试
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div className={`attachment-file-card ${draft.status}`} key={draft.localId}>
                <span className="attachment-file-icon">
                  {attachment?.kind === 'image' ? <Image size={20} /> : <FileText size={20} />}
                </span>
                <span className="attachment-file-copy">
                  <strong>{draft.file.name}</strong>
                  <small>
                    {draft.status === 'uploading'
                      ? '上传中…'
                      : draft.status === 'error'
                        ? draft.error || '上传失败'
                        : `${label} · ${formatFileSize(draft.file.size)}`}
                  </small>
                </span>
                {draft.status === 'error' && (
                  <button
                    className="attachment-retry"
                    onClick={() => onRetry(draft.localId)}
                    aria-label={`重试 ${draft.file.name}`}
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
                <button
                  className="attachment-remove"
                  onClick={() => onRemove(draft.localId)}
                  aria-label={`移除 ${draft.file.name}`}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {notice && (
        <div className="attachment-notice" role="alert">
          {notice}
        </div>
      )}
    </div>
  );
}

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="message-attachments">
      {attachments.map((attachment) =>
        isInlineAttachmentImage(attachment) ? (
          <MessageImageAttachment attachment={attachment} key={attachment.id} />
        ) : (
          <a
            className="message-attachment-file"
            href={attachment.contentUrl}
            target="_blank"
            rel="noreferrer"
            key={attachment.id}
          >
            <FileText size={20} />
            <span>
              <strong>{attachment.name}</strong>
              <small>
                {attachmentKindLabel(attachment.kind)} · {formatFileSize(attachment.size)}
              </small>
            </span>
          </a>
        ),
      )}
    </div>
  );
}

export function WorkMessageArtifacts({
  artifacts,
  workspaceId,
}: {
  artifacts: WorkMessageArtifact[];
  workspaceId: string;
}) {
  return (
    <div className="message-attachments work-message-artifacts">
      {artifacts.map((artifact) => {
        const preview = `/api/rich-preview?${new URLSearchParams({ workspaceId, path: artifact.path }).toString()}`;
        return (
          <div className="work-message-artifact" key={artifact.id} title={artifact.path}>
            <a className="message-attachment-file" href={preview} target="_blank" rel="noreferrer">
              <FileText size={20} />
              <span>
                <strong>{artifact.name}</strong>
                <small>{artifact.relativePath || artifact.path}</small>
              </span>
            </a>
            {(window as any).frakioDesktop?.showItemInFolder && (
              <button
                type="button"
                className="work-message-artifact-finder"
                onClick={() => void (window as any).frakioDesktop?.showItemInFolder?.(artifact.path)}
                aria-label={`在 Finder 中显示 ${artifact.name}`}
                title="在 Finder 中显示"
              >
                <FolderOpen size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MessageImageAttachment({ attachment }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  if (failed) {
    return (
      <a
        className="message-attachment-file message-attachment-image-error"
        href={attachment.contentUrl}
        target="_blank"
        rel="noreferrer"
      >
        <Image size={20} />
        <span>
          <strong>{attachment.name}</strong>
          <small>图片加载失败 · 点击重试</small>
        </span>
      </a>
    );
  }
  return (
    <>
      <button
        ref={triggerRef}
        className="message-attachment-image"
        type="button"
        aria-label={`预览 ${attachment.name}`}
        aria-haspopup="dialog"
        onClick={() => setPreviewOpen(true)}
      >
        <img src={attachment.contentUrl} alt="" onError={() => setFailed(true)} />
        <span>{attachment.name}</span>
      </button>
      {previewOpen && <ImageLightbox attachment={attachment} onClose={closePreview} />}
    </>
  );
}

export function ImageLightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    closeTimerRef.current = window.setTimeout(onClose, reduceMotion ? 0 : 140);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.setAttribute('inert', '');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appRoot && !rootWasInert) appRoot.removeAttribute('inert');
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, [requestClose]);

  return createPortal(
    <div
      className={`image-lightbox ${closing ? 'closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${attachment.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <button className="image-lightbox-close" type="button" onClick={requestClose} aria-label="关闭图片预览" autoFocus>
        <X size={22} />
      </button>
      <figure className="image-lightbox-stage" onMouseDown={(event) => event.stopPropagation()}>
        <img src={attachment.contentUrl} alt={attachment.name} />
        <figcaption>{attachment.name}</figcaption>
      </figure>
    </div>,
    document.body,
  );
}

export function MessageActions({
  message,
  copied,
  feedbackBusy,
  branching,
  error,
  onCopy,
  onFeedback,
  onBranch,
}: {
  message: ChatEvent;
  copied: boolean;
  feedbackBusy: boolean;
  branching: boolean;
  error?: string;
  onCopy: () => void;
  onFeedback: (value: 'up' | 'down') => void;
  onBranch: () => void;
}) {
  const duration = Number(message.processingDurationMs || 0);
  return (
    <div className="message-actions-wrap">
      <div className="message-actions" aria-label="回复操作">
        <IconTooltipButton
          ariaLabel={copied ? '已复制回复' : '复制回复'}
          hoverDelayMs={180}
          placement="top"
          tooltip={copied ? '已复制' : '复制'}
          onClick={onCopy}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </IconTooltipButton>
        <IconTooltipButton
          active={message.feedback === 'up'}
          ariaLabel={message.feedback === 'up' ? '取消喜欢' : '喜欢'}
          disabled={feedbackBusy}
          aria-pressed={message.feedback === 'up'}
          hoverDelayMs={180}
          placement="top"
          tooltip={message.feedback === 'up' ? '取消喜欢' : '喜欢'}
          onClick={() => onFeedback('up')}
        >
          <ThumbsUp size={15} aria-hidden="true" />
        </IconTooltipButton>
        <IconTooltipButton
          active={message.feedback === 'down'}
          ariaLabel={message.feedback === 'down' ? '取消不喜欢' : '不喜欢'}
          disabled={feedbackBusy}
          aria-pressed={message.feedback === 'down'}
          hoverDelayMs={180}
          placement="top"
          tooltip={message.feedback === 'down' ? '取消不喜欢' : '不喜欢'}
          onClick={() => onFeedback('down')}
        >
          <ThumbsDown size={15} aria-hidden="true" />
        </IconTooltipButton>
        <IconTooltipButton
          ariaLabel="在新对话中继续"
          disabled={branching}
          aria-busy={branching || undefined}
          hoverDelayMs={180}
          placement="top"
          tooltip={branching ? '正在创建新对话' : '在新对话中继续'}
          onClick={onBranch}
        >
          {branching ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <GitBranch size={15} aria-hidden="true" />
          )}
        </IconTooltipButton>
        {duration > 0 && (
          <span className="message-processing-duration">已处理 {formatDuration(duration / 1000)}</span>
        )}
      </div>
      {error && <span className="message-actions-error" role="alert">{error}</span>}
    </div>
  );
}
// wjz新建文件结束。
