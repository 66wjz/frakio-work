const thinkBlockPattern = /<\s*(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const orphanThinkPattern = /<\s*\/?\s*(think|thinking|reasoning)\b[^>]*>/gi;
const titlePrefixPattern = /^(?:title|标题|对话标题|conversation title)\s*[:：\-—]\s*/i;
const trailingPunctuationPattern = /[\s。.!！?？,，;；:：、\-—]+$/u;

export function titleGenerationTranscript(thread, { maxMessages = 12, maxChars = 6000 } = {}) {
  const messages = (Array.isArray(thread?.messages) ? thread.messages : [])
    .filter((message) => {
      if (!message || message.planId) return false;
      if (message.agentId === 'system') return false;
      return message.agentId === 'user' || String(message.content || '').trim();
    })
    .slice(-Math.max(1, maxMessages))
    .map((message) => {
      const role = message.agentId === 'user' ? '用户' : '助手';
      const content = String(message.content || '')
        .replace(/\[(?:附件|文件)(?:路径)?[：:][^\]]+\]/gi, '')
        .replace(/file:\/\/\S+/gi, '')
        .trim();
      return content ? `${role}：${content}` : '';
    })
    .filter(Boolean);

  if (!messages.length) return '';
  const selected = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = messages[index];
    const remaining = Math.max(0, maxChars - used);
    if (!remaining) break;
    const value = line.length <= remaining ? line : line.slice(line.length - remaining);
    selected.unshift(value);
    used += value.length + (selected.length > 1 ? 2 : 0);
  }
  return selected.join('\n\n').slice(-maxChars).trim();
}

export function sanitizeGeneratedTitle(value, maxLength = 60) {
  const withoutThinking = String(value || '')
    .replace(thinkBlockPattern, '')
    .replace(orphanThinkPattern, '')
    .replace(/^```[^\n]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
  const firstLine = withoutThinking.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const cleaned = firstLine
    .replace(titlePrefixPattern, '')
    .replace(/^["'“‘《「『]+|["'”’》」』]+$/gu, '')
    .replace(trailingPunctuationPattern, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, Math.max(1, maxLength)).join('').trim();
}
