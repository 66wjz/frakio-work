import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROCESSING_CYCLE_MS,
  activityGroupPreview,
  activityElapsedMs,
  formatActivityDuration,
  formatRunElapsed,
  nextActivityExpanded,
  nextRunPresentationPhase,
  processingMessageAt,
  shouldShowRunPresence,
} from '../web/src/run-presence.mjs';

test('processing copy stays stable inside a cycle and changes on the next cycle', () => {
  const startedAt = 1_700_000_000_000;
  const first = processingMessageAt(startedAt, 0, 'Iris');
  assert.equal(processingMessageAt(startedAt, PROCESSING_CYCLE_MS / 1000 - 1, 'Iris'), first);
  assert.notEqual(processingMessageAt(startedAt, PROCESSING_CYCLE_MS / 1000, 'Iris'), first);
});

test('run elapsed time uses compact Craft-style formatting', () => {
  assert.equal(formatRunElapsed(0), '0s');
  assert.equal(formatRunElapsed(45), '45s');
  assert.equal(formatRunElapsed(62), '1:02');
  assert.equal(formatRunElapsed(3723), '1:02:03');
});

test('running activity duration advances from its creation time', () => {
  const item = { status: 'running', createdAt: '2026-07-26T06:00:00.000Z', durationMs: 500 };
  assert.equal(activityElapsedMs(item, Date.parse('2026-07-26T06:00:03.250Z')), 3250);
  assert.equal(activityElapsedMs({ ...item, status: 'completed', durationMs: 1800 }, Date.parse('2026-07-26T06:00:30.000Z')), 1800);
  assert.equal(formatActivityDuration(3250), '3.3s');
});

test('run presentation follows tool, response, input, and completion events', () => {
  let phase = nextRunPresentationPhase('finished', 'run.started');
  assert.equal(phase, 'thinking');
  assert.equal(shouldShowRunPresence(phase), true);
  phase = nextRunPresentationPhase(phase, 'tool.running');
  assert.equal(phase, 'activity');
  assert.equal(shouldShowRunPresence(phase), true);
  assert.equal(nextRunPresentationPhase(phase, 'message.delta', { delta: '\n' }), 'activity');
  phase = nextRunPresentationPhase(phase, 'message.delta', { delta: '开始回复' });
  assert.equal(phase, 'responding');
  assert.equal(shouldShowRunPresence(phase), false);
  phase = nextRunPresentationPhase(phase, 'tool.running');
  assert.equal(phase, 'activity');
  phase = nextRunPresentationPhase(phase, 'message.delta', { delta: '继续回复' });
  assert.equal(phase, 'responding');
  assert.equal(nextRunPresentationPhase(phase, 'run.completed'), 'finished');
});

test('waiting for user input suspends processing presence and resumes from available activity', () => {
  assert.equal(nextRunPresentationPhase('activity', 'approval.request'), 'waiting-input');
  assert.equal(shouldShowRunPresence('waiting-input'), false);
  assert.equal(nextRunPresentationPhase('waiting-input', 'approval.responded', { hasActivity: true }), 'activity');
  assert.equal(nextRunPresentationPhase('waiting-input', 'clarify.responded', { hasActivity: false }), 'thinking');
  assert.equal(nextRunPresentationPhase('activity', 'run.failed'), 'finished');
  assert.equal(nextRunPresentationPhase('activity', 'run.cancelled'), 'finished');
});

test('activity summary prefers the current task target and falls back to its label', () => {
  const group = {
    summary: '正在访问网络 2 次',
    items: [
      { status: 'completed', target: '旧任务', completedLabel: '访问了网络' },
      { status: 'running', target: '查询广州各个万达到南沙的地铁路线', activeLabel: '正在访问网络' },
    ],
  };
  assert.equal(activityGroupPreview(group), '查询广州各个万达到南沙的地铁路线');
  assert.equal(activityGroupPreview({ summary: '正在运行 1 条命令', items: [{ kind: 'command', status: 'running', target: 'curl -s https://example.com', activeLabel: '正在运行命令' }] }), '访问 example.com');
  assert.equal(activityGroupPreview({ summary: '正在运行 1 条命令', items: [{ kind: 'command', status: 'running', target: 'curl -s "https://www.google.com/search?q=佛山星港城+到+南沙万达广场+地铁路线"', activeLabel: '正在运行命令' }] }), '查询 佛山星港城 到 南沙万达广场 地铁路线');
  assert.equal(activityGroupPreview({ summary: '正在运行 1 条命令', items: [{ kind: 'command', status: 'running', target: 'curl -s "wttr.in/Foshan?2&lang=zh"', activeLabel: '正在运行命令' }] }), '访问 wttr.in/Foshan?2&lang=zh');
  assert.equal(activityGroupPreview({ summary: '正在读取 1 个文件', items: [{ kind: 'read', status: 'running', target: '/tmp/project/main.tsx', activeLabel: '正在读取' }] }), '正在读取 main.tsx');
});

test('activity expansion changes only after an explicit user toggle', () => {
  let expanded = false;
  expanded = nextActivityExpanded(expanded, 'tool.running');
  assert.equal(expanded, false);
  expanded = nextActivityExpanded(expanded, 'tool.completed');
  assert.equal(expanded, false);
  expanded = nextActivityExpanded(expanded, 'user.toggle');
  assert.equal(expanded, true);
  expanded = nextActivityExpanded(expanded, 'tool.running');
  assert.equal(expanded, true);
});
