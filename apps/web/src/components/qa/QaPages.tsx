// wjz新建文件，新建原因：解耦 main.tsx 中的富内容验收与流式动画 QA 验收页面（QaPages），修改时间：2026-08-17。
// 文件内容概述：RichContentQaPage（富文本、代码块、Diff、图表、预览验收页面）与 StreamRevealQaPage（流式呈现、工具调度时间线渐显验收页面）。
import React, { useEffect, useMemo, useState } from 'react';
import type { RunActivityGroup } from '@frakio/contracts';
import type { Agent, RunPresentationPhase } from '../../types/workbench';
import { RichMarkdown } from '../../rich-content/RichMarkdown';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { ChatRunStatus } from '../chat/RunActivityViews';

export function RichContentQaPage() {
  const params = new URLSearchParams(window.location.search);
  const qaRoot = params.get('qaRoot') || '/tmp/frakio-rich-content-qa';
  const file = (name: string) => `${qaRoot.replace(/\/$/, '')}/${name}`;
  const content = [
    '# Frakio 富内容验收',
    '',
    '- **今天（7/26）**是 CJK 相邻粗体测试',
    '- [x] GFM 任务列表 ~~删除线~~',
    '',
    '| 中文列 | 很长的英文列 | 状态 |',
    '| --- | --- | --- |',
    '| 金沙洲 | SupercalifragilisticexpialidociousWithoutBreak | 正常 |',
    '',
    '```typescript',
    'const greeting: string = "Frakio Work rich content";',
    '```',
    '',
    '```diff',
    '--- a/example.ts',
    '+++ b/example.ts',
    '@@ -1 +1 @@',
    '-const ready = false;',
    '+const ready = true;',
    '```',
    '',
    '```json',
    '{"workspace":{"name":"Frakio","features":["markdown","mermaid"]}}',
    '```',
    '',
    '```mermaid',
    'graph LR',
    '  A["用户提出任务"] --> B["Frakio 路由"] --> C["Agent 执行"] --> D["富内容结果"]',
    '```',
    '',
    '$$E = mc^2$$',
    '',
    '```datatable',
    JSON.stringify(
      {
        title: 'Craft 协议数据表',
        columns: [
          { key: 'city', label: '城市', type: 'text' },
          { key: 'revenue', label: '营收', type: 'currency' },
          { key: 'growth', label: '增长', type: 'percent' },
          { key: 'tier', label: '等级', type: 'badge' },
        ],
        rows: [
          { city: '佛山', revenue: 4200, growth: 0.152, tier: 'A' },
          { city: '广州', revenue: 3600, growth: -0.03, tier: 'B' },
        ],
      },
      null,
      2,
    ),
    '```',
    '',
    '```spreadsheet',
    JSON.stringify(
      {
        filename: 'qa.xlsx',
        sheetName: 'Sheet 1',
        columns: [
          { key: 'month', label: '月份', type: 'text' },
          { key: 'value', label: '数值', type: 'number' },
        ],
        rows: [
          { month: '7月', value: 1280 },
          { month: '8月', value: 1530 },
        ],
      },
      null,
      2,
    ),
    '```',
    '',
    '```html-preview',
    JSON.stringify(
      {
        title: 'HTML 标签',
        items: [
          { src: file('one.html'), label: '报告一' },
          { src: file('two.html'), label: '报告二' },
        ],
      },
      null,
      2,
    ),
    '```',
    '',
    '```image-preview',
    JSON.stringify(
      {
        title: '图片标签',
        items: [
          { src: file('one.svg'), label: '图片一' },
          { src: file('two.svg'), label: '图片二' },
        ],
      },
      null,
      2,
    ),
    '```',
    '',
    '```pdf-preview',
    JSON.stringify({ src: file('sample.pdf'), title: 'PDF 阅读器' }, null, 2),
    '```',
    '',
    '```markdown-preview',
    JSON.stringify(
      {
        title: 'Markdown 标签',
        items: [
          { src: file('one.md'), label: '文档一' },
          { src: file('two.md'), label: '文档二' },
        ],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');

  return (
    <main
      className="app desktop-shell mac-desktop-shell mac-conversation-shell rich-qa-shell"
      data-appearance="light"
    >
      <article className="rich-qa-page">
        <RichMarkdown content={content} threadId="rich-content-qa" />
      </article>
    </main>
  );
}

export function StreamRevealQaPage() {
  const params = new URLSearchParams(window.location.search);
  const streamingResponses = params.get('streaming') !== 'off';
  const appearance = params.get('appearance') === 'dark' ? 'dark' : 'light';
  const startDelay = Math.max(0, Math.min(2_000, Number(params.get('startDelay') || 120) || 120));
  const handoffDelay = Math.max(0, Math.min(2_000, Number(params.get('handoffDelay') || 150) || 150));
  const [draft, setDraft] = useState('');
  const [groups, setGroups] = useState<RunActivityGroup[]>([]);
  const [phase, setPhase] = useState<RunPresentationPhase>('thinking');
  const [running, setRunning] = useState(true);
  const [persisted, setPersisted] = useState('');
  const finalContent =
    '先确认当前状态。工具调用完成后，继续补充 Markdown **结论**，以及一段突发到达但仍需柔和呈现的正文。';
  const agent = useMemo<Agent>(
    () => ({
      id: 'iris',
      name: 'Iris',
      role: '助理',
      model: 'qa',
      color: '#0f766e',
      soul: '',
      scope: 'qa',
    }),
    [],
  );

  useEffect(() => {
    setDraft('');
    setGroups([]);
    setPhase('thinking');
    setRunning(true);
    setPersisted('');
    const timers = [
      window.setTimeout(() => {
        setDraft('先');
        setPhase('responding');
      }, startDelay),
      window.setTimeout(() => setDraft('先确认当前状态。'), startDelay + 52),
      window.setTimeout(() => {
        const now = new Date().toISOString();
        setGroups([
          {
            id: 'qa-tool',
            contentOffset: '先确认当前状态。'.length,
            status: 'completed',
            summary: '读取了当前状态',
            items: [
              {
                id: 'qa-tool-item',
                kind: 'read',
                status: 'completed',
                toolName: 'qa_read',
                displayName: '读取当前状态',
                intent: '确认工具摘要与正文保持时间线顺序。',
                activeLabel: '正在读取',
                completedLabel: '读取完成',
                target: '/tmp/qa',
                durationMs: 42,
                resultPreview: 'ok',
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]);
        setPhase('activity');
      }, startDelay + 102),
      window.setTimeout(() => {
        setDraft('先确认当前状态。工具调用完成后，继续补充');
        setPhase('responding');
      }, startDelay + 156),
      window.setTimeout(() => setDraft(finalContent), startDelay + 194),
      window.setTimeout(() => setPhase('finished'), startDelay + 256),
      window.setTimeout(() => {
        setPersisted(finalContent);
        setDraft('');
        setRunning(false);
      }, startDelay + 256 + handoffDelay),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [finalContent, handoffDelay, startDelay]);

  return (
    <main
      className="app desktop-shell mac-desktop-shell mac-conversation-shell rich-qa-shell"
      data-appearance={appearance}
    >
      <section className="rich-qa-page" data-testid="stream-output">
        {persisted ? (
          <article className="message" data-testid="persisted-message">
            <span className="agent-avatar" style={{ background: agent.color }}>
              I
            </span>
            <div className="message-body">
              <div className="message-meta">
                <strong>Iris</strong>
              </div>
              <MarkdownMessage content={persisted} />
            </div>
          </article>
        ) : running ? (
          <div data-testid="run-status">
            <ChatRunStatus
              target={{ kind: 'agent', agent }}
              startedAt={Date.now()}
              tick={0}
              draft={draft}
              activityGroups={groups}
              presentationPhase={phase}
              error=""
              streamingResponses={streamingResponses}
            />
          </div>
        ) : null}
        <textarea aria-label="QA 输入框" defaultValue="" />
      </section>
    </main>
  );
}
// wjz新建文件结束。
