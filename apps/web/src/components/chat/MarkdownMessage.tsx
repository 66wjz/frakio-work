// wjz新建文件，新建原因：解耦 main.tsx 中的 MarkdownMessage 渲染组件，修改时间：2026-08-17。
// 文件内容概述：封装 RichMarkdown 渲染 Markdown 内容并支持流式揭示与附件。
// wjz新建文件结束。

import React from 'react';
import { RichMarkdown } from '../../rich-content/RichMarkdown';

export function trimMessageStart(content: string) {
  return String(content || '').replace(/^\s*\n+/, '').trimStart();
}

export type StreamRevealFrame = {
  rawContent: string;
  displayedContent: string;
  appendedGraphemes: number;
  revision: number;
  settled: boolean;
};

export function MarkdownMessage({
  content,
  streaming,
  streamReveal,
  threadId,
  workspaceId,
}: {
  content: string;
  streaming?: boolean;
  streamReveal?: StreamRevealFrame;
  threadId?: string | null;
  workspaceId?: string | null;
}) {
  return (
    <RichMarkdown
      content={trimMessageStart(content)}
      streaming={streaming}
      streamReveal={streamReveal}
      threadId={threadId}
      workspaceId={workspaceId}
    />
  );
}
