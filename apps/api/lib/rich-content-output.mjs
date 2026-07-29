import { renderMermaidSVG } from 'beautiful-mermaid';

const JSON_FENCES = new Set(['datatable', 'spreadsheet', 'html-preview', 'image-preview', 'pdf-preview', 'markdown-preview']);
const UNSUPPORTED_DIAGRAM_FENCES = new Set(['plantuml', 'puml']);

export function fencedBlocks(source) {
  const lines = String(source || '').split(/\r?\n/);
  const blocks = [];
  let open = null;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = line.match(/^\s*(`{3,}|~{3,})([^\s`]*)\s*$/);
    if (!open && marker) {
      open = { marker: marker[1], language: String(marker[2] || '').toLowerCase(), start: offset, startLine: index + 1, content: [] };
    } else if (open) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/)?.[1] || '';
      if (close && close[0] === open.marker[0] && close.length >= open.marker.length) {
        blocks.push({ ...open, code: open.content.join('\n'), end: offset + line.length, endLine: index + 1 });
        open = null;
      } else {
        open.content.push(line);
      }
    }
    offset += line.length + 1;
  }
  return { blocks, unclosed: open ? { language: open.language, line: open.startLine } : null };
}

function validPreviewSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.src === 'string' && value.src.trim()) return true;
  return Array.isArray(value.items) && value.items.length > 0 && value.items.every((item) => item && typeof item.src === 'string' && item.src.trim());
}

function validDataSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.src === 'string' && value.src.trim()) return true;
  return Array.isArray(value.rows) && (Array.isArray(value.columns) || value.rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)));
}

export function validateRichContentOutput(source) {
  const { blocks, unclosed } = fencedBlocks(source);
  const issues = [];
  if (unclosed) issues.push({ code: 'UNCLOSED_FENCE', language: unclosed.language, line: unclosed.line, message: '富内容围栏没有闭合。' });
  for (const block of blocks) {
    if (UNSUPPORTED_DIAGRAM_FENCES.has(block.language)) {
      issues.push({ code: 'UNSUPPORTED_DIAGRAM', language: block.language, line: block.startLine, message: 'Frakio 流程图必须使用 Mermaid。' });
      continue;
    }
    if (block.language === 'mermaid') {
      try {
        renderMermaidSVG(block.code);
      } catch (error) {
        issues.push({ code: 'INVALID_MERMAID', language: block.language, line: block.startLine, message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    if (JSON_FENCES.has(block.language)) {
      let value;
      try {
        value = JSON.parse(block.code);
      } catch (error) {
        issues.push({ code: 'INVALID_RICH_JSON', language: block.language, line: block.startLine, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const valid = block.language === 'datatable' || block.language === 'spreadsheet' ? validDataSpec(value) : validPreviewSpec(value);
      if (!valid) issues.push({ code: 'INVALID_RICH_SPEC', language: block.language, line: block.startLine, message: '富内容 JSON 缺少有效的 src、items 或表格数据。' });
    }
  }
  return { valid: issues.length === 0, issues, blocks };
}

export function richContentRepairPrompt(source, issues) {
  const diagnostics = issues.map((issue) => `${issue.code} line ${issue.line}: ${issue.message}`).join('\n');
  return [
    '修复下面的 Frakio Agent 最终回复。只返回修复后的完整回复，不要解释，不要使用外层 markdown 围栏。',
    '保留所有正常正文、标题、列表、链接和代码，只修改诊断指出的富内容块。',
    'PlantUML/Puml 必须转换成语义等价且语法有效的 Mermaid。所有 Mermaid 节点标签含标点时使用双引号。',
    '富内容 JSON 必须是严格 JSON，所有围栏必须闭合。禁止调用工具。',
    `诊断：\n${diagnostics}`,
    `原始回复：\n${source}`,
  ].join('\n\n');
}

export function normalizeRepairedOutput(source) {
  const value = String(source || '').trim();
  const outer = value.match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
  return (outer?.[1] || value).trim();
}
