import assert from 'node:assert/strict';
import test from 'node:test';
import { activityResultPreview, applyRunActivityToTranscript, normalizeRunActivityItem, normalizeRunTranscript, summarizeActivityItems } from './run-activity.mjs';

test('normalizes file, search, command and collaboration tools into semantic activities', () => {
  const read = normalizeRunActivityItem({ tool_name: 'read_file', tool_call_id: 'one', args: { path: '/tmp/src/main.tsx' } });
  assert.equal(read.id, 'one');
  assert.equal(read.kind, 'read');
  assert.equal(read.activeLabel, '正在读取');
  assert.equal(read.target, 'main.tsx');
  assert.equal(read.status, 'running');
  assert.equal(normalizeRunActivityItem({ tool_name: 'search_files', args: { pattern: 'runTools' } }).kind, 'search');
  assert.equal(normalizeRunActivityItem({ tool_name: 'terminal', args: { command: 'npm test' } }).kind, 'command');
  assert.equal(normalizeRunActivityItem({ tool_name: 'mcp__workbench__hermes_workbench_collaboration_plan_get', args: { workflowId: 'flow-1' } }).kind, 'collaboration');
});

test('prefers model semantics and classifies common commands without exposing secrets', () => {
  const modeled = normalizeRunActivityItem({
    tool_name: 'exec_command',
    display_name: '查看版本记录',
    intent: '确认 sk-12345678901234567890 最近有哪些重大更新',
    args: { command: 'git log --oneline -20' },
  }, 'completed');
  assert.equal(modeled.displayName, '查看版本记录');
  assert.equal(modeled.intent, '确认 sk-*** 最近有哪些重大更新');

  const fallback = normalizeRunActivityItem({ tool_name: 'exec_command', args: { command: 'rg -n "version" .' } }, 'completed');
  assert.equal(fallback.displayName, '搜索了');
  assert.equal(fallback.intent, '在项目中查找匹配内容');
});

test('redacts and bounds persisted result previews', () => {
  const preview = activityResultPreview(`authorization: Bearer secret-value\napi_key=hidden-value\nsk-abcdefghijklmnop\n${Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n')}`);
  assert.doesNotMatch(preview, /secret-value|hidden-value|abcdefghijklmnop/);
  assert.ok(preview.split('\n').length <= 21);
  assert.ok(preview.length <= 4100);
});

test('summarizes mixed groups without raw tool names', () => {
  const items = [
    normalizeRunActivityItem({ tool_name: 'read_file', tool_call_id: '1' }, 'completed'),
    normalizeRunActivityItem({ tool_name: 'read_file', tool_call_id: '2' }, 'completed'),
    normalizeRunActivityItem({ tool_name: 'terminal', tool_call_id: '3' }, 'completed'),
  ];
  assert.equal(summarizeActivityItems(items), '读取了 2 个文件 · 运行了 1 条命令');
  assert.doesNotMatch(summarizeActivityItems(items), /read_file|terminal|调用/);
  assert.equal(summarizeActivityItems([normalizeRunActivityItem({ tool_name: 'web_search', tool_call_id: '4' }, 'completed')]), '访问了网络 1 次');
});

test('transcript normalization restores group status and offsets', () => {
  const transcript = normalizeRunTranscript({ runId: 'run-1', groups: [{ id: 'group-1', contentOffset: 12, items: [
    { id: 'tool-1', toolName: 'read_file', kind: 'read', status: 'completed', target: 'main.tsx', createdAt: '2026-01-01T00:00:00.000Z' },
  ] }] });
  assert.equal(transcript.groups[0].contentOffset, 12);
  assert.equal(transcript.groups[0].status, 'completed');
});

test('consecutive and parallel tools share a group until assistant text opens a new boundary', () => {
  let transcript = normalizeRunTranscript({ runId: 'run-1', status: 'running', groups: [] });
  let applied = applyRunActivityToTranscript(transcript, { toolName: 'read_file', id: 'read-1', status: 'running', target: 'a.ts' }, { contentOffset: 8, groupOpen: false });
  transcript = applied.transcript;
  applied = applyRunActivityToTranscript(transcript, { toolName: 'search_files', id: 'search-1', status: 'running', target: 'query' }, { contentOffset: 8, groupOpen: true });
  transcript = applied.transcript;
  assert.equal(transcript.groups.length, 1);
  assert.equal(transcript.groups[0].items.length, 2);
  applied = applyRunActivityToTranscript(transcript, { toolName: 'terminal', id: 'command-1', status: 'running', target: 'npm test' }, { contentOffset: 30, groupOpen: false });
  assert.equal(applied.transcript.groups.length, 2);
  assert.equal(applied.transcript.groups[1].contentOffset, 30);
});

test('completion updates the stable call and failure keeps its group failed', () => {
  let applied = applyRunActivityToTranscript({ runId: 'run-1', status: 'running', groups: [] }, { toolName: 'terminal', id: 'call-1', status: 'running' }, { groupOpen: false });
  applied = applyRunActivityToTranscript(applied.transcript, { toolName: 'terminal', id: 'call-1', status: 'failed', resultPreview: 'exit 1' }, { groupOpen: true });
  assert.equal(applied.transcript.groups[0].items.length, 1);
  assert.equal(applied.transcript.groups[0].status, 'failed');
  assert.equal(applied.transcript.groups[0].items[0].resultPreview, 'exit 1');
  assert.equal(applied.groupOpen, true);
});

test('a late completion does not reopen a group after assistant text', () => {
  let applied = applyRunActivityToTranscript({ runId: 'run-1', status: 'running', groups: [] }, { toolName: 'read_file', id: 'call-1', status: 'running' }, { contentOffset: 0, groupOpen: false });
  applied = applyRunActivityToTranscript(applied.transcript, { toolName: 'read_file', id: 'call-1', status: 'completed' }, { contentOffset: 24, groupOpen: false });
  assert.equal(applied.groupOpen, false);
  applied = applyRunActivityToTranscript(applied.transcript, { toolName: 'terminal', id: 'call-2', status: 'running' }, { contentOffset: 24, groupOpen: applied.groupOpen });
  assert.equal(applied.transcript.groups.length, 2);
  assert.equal(applied.transcript.groups[1].contentOffset, 24);
});
