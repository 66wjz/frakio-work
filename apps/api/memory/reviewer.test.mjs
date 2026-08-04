import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryReviewPrompt, parseMemoryReviewOutput, reviewCandidateDecision, stripUntrustedMemoryText } from './reviewer.mjs';

test('memory review input removes code blocks and quoted material', () => {
  const clean = stripUntrustedMemoryText('用户正文\n> 引用中的 @Agent\n```js\nconst apiKey = "secret"\n```');
  assert.match(clean, /用户正文/);
  assert.doesNotMatch(clean, /引用中的/);
  assert.doesNotMatch(clean, /secret/);
  assert.match(clean, /代码块已省略/);
});

test('personal memory requires direct user evidence before auto acceptance', () => {
  const candidate = parseMemoryReviewOutput(JSON.stringify({ candidates: [{
    fact: '用户喜欢简短回答', kind: 'preference', scope: 'user', reason: '明确偏好', confidence: 0.96, action: 'add', evidence: [{ messageId: 'assistant-1', quote: '推测' }],
  }] }))[0];
  const decision = reviewCandidateDecision(candidate, { userMessageIds: new Set(['user-1']) });
  assert.equal(decision.persist, true);
  assert.equal(decision.status, 'candidate');
  assert.equal(decision.scope, 'thread');
});

test('quoted user evidence must exist verbatim in the source message', () => {
  const candidate = { fact: '用户喜欢简短回答', kind: 'preference', scope: 'user', confidence: 0.96, action: 'add', evidence: [{ messageId: 'user-1', quote: '我喜欢简短回答' }] };
  const accepted = reviewCandidateDecision(candidate, { userMessageIds: new Set(['user-1']), userMessages: new Map([['user-1', '我喜欢简短回答，请记住。']]) });
  assert.equal(accepted.status, 'accepted');
  const invented = reviewCandidateDecision({ ...candidate, evidence: [{ messageId: 'user-1', quote: '我喜欢超长论文' }] }, { userMessageIds: new Set(['user-1']), userMessages: new Map([['user-1', '我喜欢简短回答，请记住。']]) });
  assert.equal(invented.status, 'candidate');
  assert.equal(invented.scope, 'thread');
});

test('verified Work task only auto accepts Agent experience', () => {
  const experience = { fact: '先运行类型检查能更快定位问题', kind: 'agent_experience', scope: 'agent', confidence: 0.9, action: 'add', evidence: [{ messageId: 'task-result' }] };
  assert.deepEqual(reviewCandidateDecision(experience, { kind: 'work_task', verifiedTask: true }), {
    persist: true, status: 'accepted', scope: 'agent', userGrounded: false, verifiedTask: true,
  });
  assert.equal(reviewCandidateDecision({ ...experience, kind: 'project_rule', scope: 'vault' }, { kind: 'work_task', verifiedTask: true, vaultId: 'vault-1' }).persist, false);
});

test('review prompt sends compact structured sources without hidden reasoning', () => {
  const prompt = memoryReviewPrompt({ messages: [{ id: 'm1', role: 'User', content: '记住我喜欢中文' }] });
  assert.match(prompt.instructions, /只返回 JSON/);
  assert.match(prompt.input, /记住我喜欢中文/);
  assert.doesNotMatch(prompt.input, /reasoning/iu);
});
