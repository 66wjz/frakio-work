import { segmentStreamGraphemes } from '../stream-reveal.mjs';

const CJK_AFTER_STRONG = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const STREAM_REVEAL_EXCLUDED_TAGS = new Set(['code', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'svg', 'math', 'video', 'audio', 'iframe', 'canvas']);

function fenceMarker(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  return match?.[1] || '';
}

export function hasUnclosedMarkdownFence(content) {
  let fence = '';
  for (const line of String(content || '').split(/\r?\n/)) {
    const marker = fenceMarker(line);
    if (!marker) continue;
    if (!fence) {
      fence = marker;
      continue;
    }
    if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
  }
  return Boolean(fence);
}

export function splitStreamingMarkdown(content, streaming = false) {
  if (!streaming) return [content];
  const lines = content.match(/.*(?:\n|$)/g)?.filter(Boolean) || [content];
  const chunks = [];
  let current = '';
  let fence = '';
  for (const line of lines) {
    current += line;
    const marker = fenceMarker(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = '';
        chunks.push(current);
        current = '';
      }
      continue;
    }
    if (!fence && /^\s*$/.test(line) && current.trim()) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

export function markStreamRevealTail(tree, appendedGraphemes, revision) {
  const requestedCount = Math.max(0, Number(appendedGraphemes) || 0);
  if (!tree || requestedCount === 0) return false;
  let lastText = null;
  const visit = (node, parent = null, index = -1, excluded = false) => {
    if (!node || typeof node !== 'object') return;
    const classNames = Array.isArray(node.properties?.className)
      ? node.properties.className
      : typeof node.properties?.className === 'string'
        ? node.properties.className.split(/\s+/)
        : [];
    const nextExcluded = excluded
      || STREAM_REVEAL_EXCLUDED_TAGS.has(String(node.tagName || '').toLowerCase())
      || classNames.some((name) => String(name).startsWith('katex') || String(name).startsWith('rich-'));
    if (node.type === 'text' && typeof node.value === 'string' && node.value.trim()) {
      lastText = { node, parent, index, excluded: nextExcluded };
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child, childIndex) => visit(child, node, childIndex, nextExcluded));
    }
  };
  visit(tree);
  if (!lastText || lastText.excluded || !lastText.parent || lastText.index < 0) return false;
  const graphemes = segmentStreamGraphemes(lastText.node.value);
  if (!graphemes.length) return false;
  const tailCount = Math.min(requestedCount, graphemes.length);
  const prefix = graphemes.slice(0, graphemes.length - tailCount).join('');
  const tail = graphemes.slice(-tailCount).join('');
  const replacement = [];
  if (prefix) replacement.push({ type: 'text', value: prefix });
  replacement.push({
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['stream-reveal-tail'],
      dataStreamRevealRevision: String(revision),
    },
    children: [{ type: 'text', value: tail }],
  });
  lastText.parent.children.splice(lastText.index, 1, ...replacement);
  return true;
}

function splitCjkStrongText(value) {
  const nodes = [];
  let cursor = 0;
  let index = 0;
  while (index < value.length - 3) {
    const marker = value.startsWith('**', index) ? '**' : value.startsWith('__', index) ? '__' : '';
    if (!marker) {
      index += 1;
      continue;
    }
    const close = value.indexOf(marker, index + 2);
    if (close <= index + 2) {
      index += 2;
      continue;
    }
    const next = value.slice(close + 2).match(/^./u)?.[0] || '';
    if (!CJK_AFTER_STRONG.test(next)) {
      index = close + 2;
      continue;
    }
    if (index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, index) });
    nodes.push({ type: 'strong', children: [{ type: 'text', value: value.slice(index + 2, close) }] });
    cursor = close + 2;
    index = cursor;
  }
  if (!nodes.length) return null;
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) });
  return nodes;
}

/** Repair CommonMark emphasis that remains literal when a closing marker is followed by CJK text. */
export function remarkCjkStrong() {
  const excludedParents = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition']);
  return (tree) => {
    const visit = (node) => {
      if (!node || !Array.isArray(node.children) || excludedParents.has(node.type)) return;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child?.type === 'text' && typeof child.value === 'string') {
          const replacement = splitCjkStrongText(child.value);
          if (replacement) {
            node.children.splice(index, 1, ...replacement);
            index += replacement.length - 1;
            continue;
          }
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

export function normalizePreviewSpec(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const items = Array.isArray(parsed.items)
    ? parsed.items.filter((item) => item && typeof item.src === 'string' && item.src.trim()).map((item) => ({ ...item, src: item.src.trim() }))
    : undefined;
  if (items?.length) return { ...parsed, items };
  if (typeof parsed.src !== 'string' || !parsed.src.trim()) return null;
  return { ...parsed, src: parsed.src.trim() };
}

export function normalizeDataSpec(spec) {
  const rows = Array.isArray(spec?.rows) ? spec.rows : [];
  const objectColumns = rows.flatMap((row) => row && !Array.isArray(row) && typeof row === 'object' ? Object.keys(row) : []);
  const rawColumns = Array.isArray(spec?.columns) && spec.columns.length ? spec.columns : Array.from(new Set(objectColumns));
  const columnDefs = rawColumns.map((column, index) => {
    if (column && typeof column === 'object' && !Array.isArray(column)) {
      const key = String(column.key || column.label || `column_${index + 1}`);
      return { key, label: String(column.label || key), type: String(column.type || 'text') };
    }
    const key = String(column);
    return { key, label: key, type: 'text' };
  });
  const columns = columnDefs.map((column) => column.label);
  const normalizedRows = rows.map((row) => Array.isArray(row)
    ? columnDefs.map((_, index) => row[index] ?? null)
    : columnDefs.map((column) => row?.[column.key] ?? null));
  return { columns, columnDefs, rows: normalizedRows };
}
