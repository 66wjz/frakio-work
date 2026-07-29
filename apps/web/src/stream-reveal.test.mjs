import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STREAM_REVEAL_INITIAL_BUFFER_MS,
  STREAM_REVEAL_MAX_LAG_MS,
  STREAM_REVEAL_MIN_COMMIT_MS,
  segmentStreamGraphemes,
  streamRevealTransition,
} from './stream-reveal.mjs';

test('stream reveal segments CJK, emoji and combining characters as complete graphemes', () => {
  assert.deepEqual(segmentStreamGraphemes('佛山'), ['佛', '山']);
  assert.deepEqual(segmentStreamGraphemes('👍🏽e\u0301'), ['👍🏽', 'e\u0301']);
});

test('stream reveal buffers the first fragment and coalesces a lone grapheme', () => {
  const waiting = streamRevealTransition({ rawContent: '你', queueStartedAt: 100, now: 100 + STREAM_REVEAL_INITIAL_BUFFER_MS });
  assert.equal(waiting.kind, 'wait');
  const released = streamRevealTransition({ rawContent: '你', queueStartedAt: 100, now: 100 + STREAM_REVEAL_INITIAL_BUFFER_MS * 2 });
  assert.equal(released.kind, 'append');
  assert.equal(released.displayedContent, '你');
});

test('stream reveal respects the minimum commit cadence and catches bursts up before the lag deadline', () => {
  const rawContent = '这是一个用于验证突发流式内容能够快速追平的长段落。'.repeat(18);
  let displayedContent = '';
  let lastCommitAt = 0;
  const queueStartedAt = 1000;
  for (let now = queueStartedAt; now <= queueStartedAt + STREAM_REVEAL_MAX_LAG_MS; now += STREAM_REVEAL_MIN_COMMIT_MS) {
    const step = streamRevealTransition({ displayedContent, rawContent, queueStartedAt, lastCommitAt, now });
    if (step.kind === 'append') {
      displayedContent = step.displayedContent;
      lastCommitAt = now;
    }
  }
  const final = streamRevealTransition({
    displayedContent,
    rawContent,
    queueStartedAt,
    lastCommitAt,
    now: queueStartedAt + STREAM_REVEAL_MAX_LAG_MS,
    force: true,
  });
  assert.equal(final.displayedContent, rawContent);
  assert.equal(final.settled, true);
});

test('stream reveal resets immediately when upstream content is no longer a prefix', () => {
  const step = streamRevealTransition({ displayedContent: '旧正文', rawContent: '修正后的正文', queueStartedAt: 10, now: 20 });
  assert.equal(step.kind, 'reset');
  assert.equal(step.displayedContent, '修正后的正文');
  assert.equal(step.appendedGraphemes, 0);
});

test('stream reveal force mode drains all remaining content at completion', () => {
  const step = streamRevealTransition({ displayedContent: '前缀', rawContent: '前缀和结尾', queueStartedAt: 1, now: 2, force: true });
  assert.equal(step.kind, 'append');
  assert.equal(step.displayedContent, '前缀和结尾');
  assert.equal(step.settled, true);
});
