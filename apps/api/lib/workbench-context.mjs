const HTTP_URL_PATTERN = /https?:\/\/[^\s<>()\[\]{}"']+/gi;

function cleanText(value, max = 4000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRect(rect = {}) {
  return {
    x: finite(rect.x),
    y: finite(rect.y),
    width: Math.max(0, finite(rect.width)),
    height: Math.max(0, finite(rect.height)),
    scrollX: finite(rect.scrollX),
    scrollY: finite(rect.scrollY),
    viewportWidth: Math.max(0, finite(rect.viewportWidth)),
    viewportHeight: Math.max(0, finite(rect.viewportHeight)),
    devicePixelRatio: Math.max(0.1, finite(rect.devicePixelRatio, 1)),
  };
}

export function normalizeDraftContext(value = {}) {
  return {
    browserAnnotations: Array.isArray(value.browserAnnotations) ? value.browserAnnotations : [],
    reviewComments: Array.isArray(value.reviewComments) ? value.reviewComments : [],
  };
}

export function normalizeBrowserAnnotation(input, { id, threadId, createdAt }) {
  const url = cleanText(input?.url, 2048);
  const comment = cleanText(input?.comment, 4000);
  if (!url || !comment) throw Object.assign(new Error('网页批注需要页面地址和评论。'), { status: 400 });
  return {
    id,
    threadId,
    target: input?.target === 'region' ? 'region' : 'element',
    url,
    pageTitle: cleanText(input?.pageTitle, 300),
    comment,
    selector: cleanText(input?.selector, 1000) || undefined,
    tagName: cleanText(input?.tagName, 80) || undefined,
    accessibleName: cleanText(input?.accessibleName, 500) || undefined,
    text: cleanText(input?.text, 1000) || undefined,
    domExcerpt: cleanText(input?.domExcerpt, 4000) || undefined,
    rect: normalizeRect(input?.rect),
    evidenceAttachmentId: cleanText(input?.evidenceAttachmentId, 200) || undefined,
    createdAt,
  };
}

export function normalizeReviewComment(input, { id, threadId, createdAt }) {
  const changeSetId = cleanText(input?.changeSetId, 200);
  const filePath = cleanText(input?.filePath, 2000);
  const comment = cleanText(input?.comment, 4000);
  const line = Math.max(1, Math.floor(finite(input?.line, 1)));
  if (!changeSetId || !filePath || !comment) throw Object.assign(new Error('审阅意见缺少改动、文件或评论。'), { status: 400 });
  return {
    id,
    threadId,
    changeSetId,
    filePath,
    side: input?.side === 'old' ? 'old' : 'new',
    line,
    hunk: cleanText(input?.hunk, 1000) || undefined,
    comment,
    createdAt,
  };
}

export function selectMessageContext(thread, browserIds = [], reviewIds = []) {
  const draft = normalizeDraftContext(thread?.draftContext);
  const browserSet = new Set((browserIds || []).map(String));
  const reviewSet = new Set((reviewIds || []).map(String));
  return {
    browserAnnotations: draft.browserAnnotations.filter((item) => browserSet.has(item.id)),
    reviewComments: draft.reviewComments.filter((item) => reviewSet.has(item.id)),
  };
}

export function consumeMessageContext(thread, context) {
  const draft = normalizeDraftContext(thread?.draftContext);
  const browserSet = new Set((context?.browserAnnotations || []).map((item) => item.id));
  const reviewSet = new Set((context?.reviewComments || []).map((item) => item.id));
  thread.draftContext = {
    browserAnnotations: draft.browserAnnotations.filter((item) => !browserSet.has(item.id)),
    reviewComments: draft.reviewComments.filter((item) => !reviewSet.has(item.id)),
  };
}

export function messageContextPrompt(context, evidencePaths = {}) {
  const blocks = [];
  const browser = (context?.browserAnnotations || []).map((item, index) => {
    const target = item.target === 'region'
      ? `region x=${item.rect.x}, y=${item.rect.y}, width=${item.rect.width}, height=${item.rect.height}, scroll=(${item.rect.scrollX},${item.rect.scrollY})`
      : `element selector=${item.selector || '(unavailable)'}, tag=${item.tagName || '(unknown)'}`;
    const evidencePath = evidencePaths[item.evidenceAttachmentId] || '';
    return [
      `Annotation ${index + 1}: ${item.comment}`,
      `Page: ${item.pageTitle || '(untitled)'} (${item.url})`,
      `Target: ${target}`,
      item.accessibleName ? `Accessible name: ${item.accessibleName}` : '',
      item.text ? `Visible text: ${item.text}` : '',
      item.domExcerpt ? `DOM excerpt: ${item.domExcerpt}` : '',
      evidencePath ? `Local visual evidence: ${evidencePath}` : '',
    ].filter(Boolean).join('\n');
  });
  if (browser.length) blocks.push(`<frakio_browser_annotations>\n${browser.join('\n\n')}\n</frakio_browser_annotations>`);
  const review = (context?.reviewComments || []).map((item, index) => [
    `Review comment ${index + 1}: ${item.comment}`,
    `File: ${item.filePath}`,
    `Location: ${item.side} line ${item.line}`,
    item.hunk ? `Hunk: ${item.hunk}` : '',
    `Change set: ${item.changeSetId}`,
  ].filter(Boolean).join('\n'));
  if (review.length) blocks.push(`<frakio_review_comments>\n${review.join('\n\n')}\n</frakio_review_comments>`);
  return blocks.join('\n\n');
}

export function conversationSources(messages = []) {
  const sources = [];
  const seen = new Set();
  for (const message of messages) {
    if (message?.agentId !== 'user') continue;
    for (const attachment of message.attachments || []) {
      const key = `attachment:${attachment.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        id: key,
        kind: 'attachment',
        label: attachment.name,
        detail: attachment.contentUrl || '',
        attachment,
        messageId: message.id,
        createdAt: message.createdAt,
      });
    }
    const candidates = String(message.content || '').match(HTTP_URL_PATTERN) || [];
    for (const candidate of candidates) {
      const trimmed = candidate.replace(/[.,;:!?，。；：！？]+$/, '');
      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const normalized = parsed.toString();
      const key = `link:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        id: key,
        kind: 'link',
        label: parsed.hostname || normalized,
        detail: normalized,
        url: normalized,
        messageId: message.id,
        createdAt: message.createdAt,
      });
    }
  }
  return sources.reverse();
}
