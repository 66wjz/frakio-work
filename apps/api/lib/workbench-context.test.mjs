import test from 'node:test';
import assert from 'node:assert/strict';

import {
  consumeMessageContext,
  conversationSources,
  messageContextPrompt,
  normalizeBrowserAnnotation,
  normalizeReviewComment,
  selectMessageContext,
} from './workbench-context.mjs';

test('draft context is selected by id and consumed only from its thread', () => {
  const browser = normalizeBrowserAnnotation({
    url: 'http://localhost:5173/',
    pageTitle: 'Preview',
    target: 'element',
    selector: '#save',
    comment: 'Make this action quieter.',
    rect: { x: 10, y: 20, width: 80, height: 30 },
  }, { id: 'annotation-1', threadId: 'thread-a', createdAt: '2026-08-02T00:00:00.000Z' });
  const review = normalizeReviewComment({
    changeSetId: 'changes-1',
    filePath: 'src/App.tsx',
    line: 42,
    side: 'new',
    comment: 'Keep the existing loading state.',
  }, { id: 'review-1', threadId: 'thread-a', createdAt: '2026-08-02T00:00:00.000Z' });
  const thread = { draftContext: { browserAnnotations: [browser], reviewComments: [review] } };

  const selected = selectMessageContext(thread, ['annotation-1'], []);
  assert.deepEqual(selected.browserAnnotations.map((item) => item.id), ['annotation-1']);
  assert.equal(selected.reviewComments.length, 0);
  consumeMessageContext(thread, selected);
  assert.equal(thread.draftContext.browserAnnotations.length, 0);
  assert.deepEqual(thread.draftContext.reviewComments.map((item) => item.id), ['review-1']);
});

test('message context prompt carries structured browser and review targets', () => {
  const context = {
    browserAnnotations: [normalizeBrowserAnnotation({
      url: 'http://127.0.0.1:3000/settings',
      pageTitle: 'Settings',
      target: 'region',
      comment: 'Align this group.',
      evidenceAttachmentId: 'attachment-1',
      rect: { x: 12, y: 24, width: 300, height: 120, scrollY: 480 },
    }, { id: 'annotation-1', threadId: 'thread-a', createdAt: '2026-08-02T00:00:00.000Z' })],
    reviewComments: [normalizeReviewComment({
      changeSetId: 'changes-1', filePath: 'src/settings.tsx', line: 18, side: 'old', comment: 'Do not remove this fallback.',
    }, { id: 'review-1', threadId: 'thread-a', createdAt: '2026-08-02T00:00:00.000Z' })],
  };
  const prompt = messageContextPrompt(context, { 'attachment-1': '/tmp/evidence.png' });
  assert.match(prompt, /frakio_browser_annotations/);
  assert.match(prompt, /region x=12, y=24, width=300, height=120/);
  assert.match(prompt, /Local visual evidence: \/tmp\/evidence\.png/);
  assert.match(prompt, /src\/settings\.tsx/);
  assert.match(prompt, /old line 18/);
});

test('conversation sources deduplicate user uploads and links', () => {
  const attachment = { id: 'attachment-1', name: 'brief.pdf', contentUrl: '/api/attachments/attachment-1/content' };
  const sources = conversationSources([
    { id: 'm1', agentId: 'user', content: 'Read https://example.com/guide.', attachments: [attachment] },
    { id: 'm2', agentId: 'agent', content: 'https://ignored.example/', attachments: [] },
    { id: 'm3', agentId: 'user', content: 'Again https://example.com/guide', attachments: [attachment] },
  ]);
  assert.equal(sources.length, 2);
  assert.deepEqual(new Set(sources.map((item) => item.kind)), new Set(['attachment', 'link']));
});
