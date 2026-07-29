import test from 'node:test';
import assert from 'node:assert/strict';
import { activityTimelineEntries, buildRunActivityTimeline } from '../web/src/run-activity-timeline.mjs';

const tool = (id, status = 'completed') => ({ id, kind: 'search', status });
const group = (id, contentOffset, items) => ({ id, contentOffset, items, createdAt: `2026-01-01T00:00:0${id}.000Z` });

test('keeps each assistant text segment outside tool entries in transcript order', () => {
  const content = '我先查资料。找到了线索，再核对。最终答案。';
  const timeline = buildRunActivityTimeline(content, [group('1', 6, [tool('a')]), group('2', 16, [tool('b')])]);
  assert.equal(timeline.groups[0].commentary, '我先查资料。');
  assert.equal(timeline.groups[1].commentary, '找到了线索，再核对。');
  assert.equal(timeline.tail, '最终答案。');
  assert.deepEqual(activityTimelineEntries(timeline.groups[0].group).map((entry) => entry.type), ['tool']);
  assert.equal(activityTimelineEntries(timeline.groups[0].group).some((entry) => entry.type === 'commentary'), false);
});

test('pure tool and pure body turns preserve their expected shape', () => {
  assert.equal(activityTimelineEntries(group('1', 0, [tool('a'), tool('b')])).length, 2);
  const body = buildRunActivityTimeline('只有正文', []);
  assert.equal(body.tail, '只有正文');
  assert.equal(body.groups.length, 0);
});

test('parallel, failed and interrupted tool groups never absorb partial assistant text', () => {
  const content = '开始执行。第一步完成，继续处理。';
  const timeline = buildRunActivityTimeline(content, [
    group('1', 5, [tool('a', 'failed'), tool('b')]),
    group('2', 11, [tool('c', 'running')]),
  ]);
  assert.equal(timeline.groups[0].commentary, '开始执行。');
  assert.equal(timeline.groups[1].commentary, '第一步完成，');
  assert.equal(timeline.tail, '继续处理。');
  assert.deepEqual(activityTimelineEntries(timeline.groups[0].group).map((entry) => entry.item.status), ['failed', 'completed']);
  assert.deepEqual(activityTimelineEntries(timeline.groups[1].group).map((entry) => entry.item.status), ['running']);
});
