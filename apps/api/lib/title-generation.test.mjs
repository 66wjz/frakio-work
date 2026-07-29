import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeGeneratedTitle, titleGenerationTranscript } from './title-generation.mjs';

test('builds a bounded transcript from visible user and assistant messages', () => {
  const transcript = titleGenerationTranscript({
    messages: [
      { agentId: 'system', content: '内部提示' },
      { agentId: 'user', content: '帮我优化模型菜单 [附件路径：/tmp/mock.png]' },
      { agentId: 'iris', content: '先检查现有实现。' },
      { agentId: 'iris', content: '隐藏计划卡', planId: 'plan-1' },
      { agentId: 'user', content: '还要增加自动标题 file:///tmp/private.txt' },
    ],
  });
  assert.equal(transcript, '用户：帮我优化模型菜单\n\n助手：先检查现有实现。\n\n用户：还要增加自动标题');
});

test('keeps the most recent transcript content within the character limit', () => {
  const transcript = titleGenerationTranscript({
    messages: [
      { agentId: 'user', content: '旧内容'.repeat(20) },
      { agentId: 'iris', content: '最新内容'.repeat(20) },
    ],
  }, { maxChars: 24 });
  assert.ok(transcript.length <= 24);
  assert.match(transcript, /最新内容/);
});

test('sanitizes thinking, prefixes, quotes, punctuation, and length', () => {
  assert.equal(
    sanitizeGeneratedTitle('<think>分析过程</think>\nTitle: “优化模型菜单与标题。”'),
    '优化模型菜单与标题',
  );
  assert.equal(sanitizeGeneratedTitle('标题：Frakio Work 浮层优化\n额外说明'), 'Frakio Work 浮层优化');
  assert.equal(Array.from(sanitizeGeneratedTitle('一'.repeat(80))).length, 60);
});
