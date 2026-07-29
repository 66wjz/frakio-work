import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUnclosedMarkdownFence, markStreamRevealTail, normalizeDataSpec, normalizePreviewSpec, remarkCjkStrong, splitStreamingMarkdown } from './rich-content.mjs';

test('streaming markdown keeps completed fences stable and leaves the tail active', () => {
  const chunks = splitStreamingMarkdown('Intro\n\n```mermaid\ngraph LR\nA-->B\n```\nTail', true);
  assert.deepEqual(chunks, ['Intro\n\n', '```mermaid\ngraph LR\nA-->B\n```\n', 'Tail']);
  assert.deepEqual(splitStreamingMarkdown('```json\n{"a": 1}', true), ['```json\n{"a": 1}']);
  assert.equal(hasUnclosedMarkdownFence('```json\n{"a": 1}'), true);
  assert.equal(hasUnclosedMarkdownFence('````json\n```\n````'), false);
});

test('CJK strong repair only rewrites residual text nodes', () => {
  const tree = { type: 'root', children: [
    { type: 'paragraph', children: [{ type: 'text', value: '**今天（7/26）**是风雨最强日' }] },
    { type: 'inlineCode', value: '**不要改**中文' },
    { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '**链接**中文' }] },
  ] };
  remarkCjkStrong()(tree);
  assert.deepEqual(tree.children[0].children, [
    { type: 'strong', children: [{ type: 'text', value: '今天（7/26）' }] },
    { type: 'text', value: '是风雨最强日' },
  ]);
  assert.equal(tree.children[1].value, '**不要改**中文');
  assert.equal(tree.children[2].children[0].value, '**链接**中文');
});

test('stream reveal marks only the final safe text node without changing markdown structure', () => {
  const tree = { type: 'root', children: [
    { type: 'element', tagName: 'p', properties: {}, children: [
      { type: 'text', value: '普通文字 ' },
      { type: 'element', tagName: 'strong', properties: {}, children: [{ type: 'text', value: '粗体结尾' }] },
    ] },
  ] };
  assert.equal(markStreamRevealTail(tree, 2, 7), true);
  const strong = tree.children[0].children[1];
  assert.equal(strong.tagName, 'strong');
  assert.deepEqual(strong.children, [
    { type: 'text', value: '粗体' },
    {
      type: 'element',
      tagName: 'span',
      properties: { className: ['stream-reveal-tail'], dataStreamRevealRevision: '7' },
      children: [{ type: 'text', value: '结尾' }],
    },
  ]);
});

test('stream reveal does not mark code blocks, tables or rich content', () => {
  for (const tagName of ['code', 'table']) {
    const tree = { type: 'root', children: [{ type: 'element', tagName, properties: {}, children: [{ type: 'text', value: '不要动画' }] }] };
    assert.equal(markStreamRevealTail(tree, 4, 1), false);
    assert.equal(tree.children[0].children[0].type, 'text');
  }
  const richTree = { type: 'root', children: [{ type: 'element', tagName: 'div', properties: { className: ['rich-frame'] }, children: [{ type: 'text', value: '预览' }] }] };
  assert.equal(markStreamRevealTail(richTree, 2, 1), false);
});

test('preview specs require absolute-looking source strings at the protocol layer', () => {
  assert.equal(normalizePreviewSpec('{bad'), null);
  assert.equal(normalizePreviewSpec('{}'), null);
  assert.deepEqual(normalizePreviewSpec('{"src":" /tmp/a.md ","title":"A"}'), { src: '/tmp/a.md', title: 'A' });
  assert.equal(normalizePreviewSpec('{"items":[]}'), null);
});

test('data specs normalize object and array rows', () => {
  assert.deepEqual(normalizeDataSpec({ rows: [{ city: '广州', rain: 20 }, { city: '南沙', rain: 30 }] }), {
    columns: ['city', 'rain'],
    columnDefs: [{ key: 'city', label: 'city', type: 'text' }, { key: 'rain', label: 'rain', type: 'text' }],
    rows: [['广州', 20], ['南沙', 30]],
  });
  assert.deepEqual(normalizeDataSpec({ columns: ['a', 'b'], rows: [[1], [2, 3]] }).rows, [[1, null], [2, 3]]);
  assert.deepEqual(normalizeDataSpec({ columns: [{ key: 'amount', label: '金额', type: 'currency' }], rows: [{ amount: 42 }] }), {
    columns: ['金额'],
    columnDefs: [{ key: 'amount', label: '金额', type: 'currency' }],
    rows: [[42]],
  });
});
