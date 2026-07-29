import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Document, Page, pdfjs } from 'react-pdf';
import { Check, ChevronDown, ChevronRight, Copy, Download, Maximize2, Minus, Plus, RotateCcw, Search, X } from 'lucide-react';
import { createHighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import githubLight from '@shikijs/themes/github-light';
import githubDark from '@shikijs/themes/github-dark';
import bashLanguage from '@shikijs/langs/bash';
import cssLanguage from '@shikijs/langs/css';
import htmlLanguage from '@shikijs/langs/html';
import javascriptLanguage from '@shikijs/langs/javascript';
import jsonLanguage from '@shikijs/langs/json';
import jsxLanguage from '@shikijs/langs/jsx';
import markdownLanguage from '@shikijs/langs/markdown';
import pythonLanguage from '@shikijs/langs/python';
import rubyLanguage from '@shikijs/langs/ruby';
import sqlLanguage from '@shikijs/langs/sql';
import tsxLanguage from '@shikijs/langs/tsx';
import typescriptLanguage from '@shikijs/langs/typescript';
import yamlLanguage from '@shikijs/langs/yaml';
import { hasUnclosedMarkdownFence, markStreamRevealTail, normalizeDataSpec, normalizePreviewSpec, remarkCjkStrong, splitStreamingMarkdown } from './rich-content.mjs';
import { STREAM_REVEAL_ANIMATION_MS } from '../stream-reveal.mjs';
import 'katex/dist/katex.min.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type PreviewContext = { threadId?: string | null; workspaceId?: string | null };
type StreamRevealMeta = { appendedGraphemes: number; revision: number };
type RichMarkdownProps = PreviewContext & { content: string; streaming?: boolean; streamReveal?: StreamRevealMeta; depth?: number };
type PreviewItem = { src: string; title?: string; label?: string };
type PreviewSpec = PreviewItem & { items?: PreviewItem[] };
type DataValue = string | number | boolean | null;
type ColumnDef = { key: string; label?: string; type?: string };
type DataSpec = { title?: string; filename?: string; sheetName?: string; columns?: Array<string | ColumnDef>; rows?: Array<DataValue[] | Record<string, DataValue>>; src?: string; groupBy?: string };

const RICH_LANGUAGES = new Set(['diff', 'json', 'mermaid', 'latex', 'math', 'datatable', 'spreadsheet', 'html-preview', 'image-preview', 'pdf-preview', 'markdown-preview']);
const REPAIRABLE_DIAGRAM_LANGUAGES = new Set(['plantuml', 'puml']);
const LazyPatchDiff = React.lazy(() => import('@pierre/diffs/react').then((module) => ({ default: module.PatchDiff })));
const LazyJsonView = React.lazy(() => import('@uiw/react-json-view').then((module) => ({ default: module.default })));
let shikiHighlighterPromise: Promise<any> | null = null;

const SHIKI_LANGUAGES: Partial<Record<string, any>> = {
  bash: bashLanguage,
  css: cssLanguage,
  html: htmlLanguage,
  javascript: javascriptLanguage,
  json: jsonLanguage,
  jsx: jsxLanguage,
  markdown: markdownLanguage,
  python: pythonLanguage,
  ruby: rubyLanguage,
  sql: sqlLanguage,
  tsx: tsxLanguage,
  typescript: typescriptLanguage,
  yaml: yamlLanguage,
};

async function highlightedCodeHtml(code: string, requestedLanguage: string) {
  if (!shikiHighlighterPromise) {
    shikiHighlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: Object.values(SHIKI_LANGUAGES),
      engine: createJavaScriptRegexEngine(),
    });
  }
  const highlighter = await shikiHighlighterPromise;
  const aliases: Record<string, string> = { js: 'javascript', jsx: 'jsx', ts: 'typescript', shell: 'bash', sh: 'bash', py: 'python', rb: 'ruby', yml: 'yaml' };
  const language = aliases[requestedLanguage] || requestedLanguage || 'text';
  const grammar = SHIKI_LANGUAGES[language];
  return highlighter.codeToHtml(code, {
    lang: grammar ? language : 'text',
    themes: { light: 'github-light', dark: 'github-dark' },
  });
}

function contentKey(value: string, index: number) {
  let hash = 2166136261;
  for (let offset = 0; offset < value.length; offset += 1) hash = Math.imul(hash ^ value.charCodeAt(offset), 16777619);
  return `${index}-${(hash >>> 0).toString(36)}`;
}

function rehypeStreamRevealTail(options: StreamRevealMeta) {
  return (tree: any) => {
    markStreamRevealTail(tree, options.appendedGraphemes, options.revision);
  };
}

function StreamRevealTail({ children, revision, ...props }: { children: React.ReactNode; revision: string; [key: string]: any }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof node.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.getAnimations().forEach((animation) => animation.cancel());
    node.animate([
      { opacity: .6, transform: 'translateY(1px)', filter: 'blur(.6px)' },
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
    ], {
      duration: STREAM_REVEAL_ANIMATION_MS,
      easing: 'cubic-bezier(.2, .8, .2, 1)',
      fill: 'both',
    });
  }, [revision]);
  return <span ref={ref} className="stream-reveal-tail" data-stream-reveal-revision={revision} {...props}>{children}</span>;
}

function previewUrl(src: string, context: PreviewContext) {
  const query = new URLSearchParams({ path: src });
  if (context.threadId) query.set('threadId', context.threadId);
  if (context.workspaceId) query.set('workspaceId', context.workspaceId);
  return `/api/rich-preview?${query.toString()}`;
}

function openSafeMarkdownLink(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  const desktop = (window as any).frakioDesktop;
  if (desktop?.openExternal) {
    void desktop.openExternal(href);
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

function parseJson<T>(source: string): T | null {
  try {
    return JSON.parse(source) as T;
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: DataValue) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function useTextResource(url: string | null) {
  const [state, setState] = useState<{ text: string; error: string; loading: boolean }>({ text: '', error: '', loading: Boolean(url) });
  useEffect(() => {
    if (!url) {
      setState({ text: '', error: '', loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ text: '', error: '', loading: true });
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `读取失败（${response.status}）`);
        return response.text();
      })
      .then((text) => setState({ text, error: '', loading: false }))
      .catch((error) => {
        if (error?.name !== 'AbortError') setState({ text: '', error: String(error?.message || error), loading: false });
      });
    return () => controller.abort();
  }, [url]);
  return state;
}

class RichBlockBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn('Rich content renderer failed:', error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button className="rich-icon-button" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function RichFrame({ title, actions, children, className = '' }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`rich-frame ${className}`.trim()}>
    <header className="rich-frame-header"><span>{title}</span><div className="rich-frame-actions">{actions}</div></header>
    <div className="rich-frame-body">{children}</div>
  </section>;
}

function Fullscreen({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(<div className="rich-fullscreen-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="rich-fullscreen" data-appearance={document.querySelector('.app')?.getAttribute('data-appearance') || 'light'} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><strong>{title}</strong><IconButton label="关闭" onClick={onClose}><X size={17} /></IconButton></header>
      <div className="rich-fullscreen-content">{children}</div>
    </section>
  </div>, document.body);
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <IconButton label={copied ? '已复制' : '复制'} onClick={() => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconButton>;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    void highlightedCodeHtml(code, language).then((value) => { if (!cancelled) setHtml(value); }).catch((error) => {
      console.warn('Shiki highlighting failed:', error);
      if (!cancelled) setHtml('');
    });
    return () => { cancelled = true; };
  }, [code, language]);
  return <RichFrame title={language || 'text'} actions={<CopyButton value={code} />} className="rich-code-frame">
    {html ? <div className="rich-shiki" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="rich-code-fallback"><code>{code}</code></pre>}
  </RichFrame>;
}

function DiffBlock({ code }: { code: string }) {
  return <RichFrame title="Diff" actions={<CopyButton value={code} />} className="rich-diff-frame">
    <React.Suspense fallback={<pre className="rich-code-fallback"><code>{code}</code></pre>}><LazyPatchDiff patch={code} disableWorkerPool options={{ diffStyle: 'unified', themeType: 'system' }} /></React.Suspense>
  </RichFrame>;
}

function JsonBlock({ code }: { code: string }) {
  const value = parseJson<object>(code);
  if (!value || typeof value !== 'object') return <CodeBlock code={code} language="json" />;
  return <RichFrame title="JSON" actions={<CopyButton value={code} />} className="rich-json-frame">
    <React.Suspense fallback={<pre className="rich-code-fallback"><code>{code}</code></pre>}><LazyJsonView value={value} collapsed={2} displayDataTypes={false} shortenTextAfterLength={120} enableClipboard /></React.Suspense>
  </RichFrame>;
}

function cleanSvg(svg: string) {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
  documentNode.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
  documentNode.querySelectorAll('style').forEach((node) => {
    node.textContent = String(node.textContent || '')
      .replace(/@import\s+url\([^)]*\)\s*;?/gi, '')
      .replace(/font-family\s*:[^;]+;/gi, 'font-family: system-ui, sans-serif;');
  });
  documentNode.querySelectorAll('*').forEach((node) => [...node.attributes].forEach((attribute) => {
    if (/^on/i.test(attribute.name) || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
  }));
  return new XMLSerializer().serializeToString(documentNode.documentElement);
}

function MermaidCanvas({ svg, zoom = 1 }: { svg: string; zoom?: number }) {
  return <div className="rich-mermaid-canvas"><div className="rich-mermaid-zoom" style={{ zoom } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: svg }} /></div>;
}

function MermaidBlock({ code }: { code: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [result, setResult] = useState({ svg: '', error: '', loading: true });
  useEffect(() => {
    let cancelled = false;
    setResult({ svg: '', error: '', loading: true });
    void import('beautiful-mermaid').then(({ renderMermaidSVG }) => {
      const svg = cleanSvg(renderMermaidSVG(code, { bg: 'var(--rich-surface)', fg: 'var(--rich-text)', transparent: true, font: 'Inter, system-ui, sans-serif', padding: 28 }));
      if (!cancelled) setResult({ svg, error: '', loading: false });
    }).catch((error) => {
      if (!cancelled) setResult({ svg: '', error: String(error instanceof Error ? error.message : error), loading: false });
    });
    return () => { cancelled = true; };
  }, [code]);
  if (result.loading) return <RichFrame title="Mermaid" actions={<CopyButton value={code} />} className="rich-mermaid-frame"><p className="rich-loading">正在绘制图表…</p></RichFrame>;
  if (!result.svg) return <RichFrame title="Mermaid 无法渲染" actions={<CopyButton value={code} />} className="rich-error-frame"><p>{result.error || '图表语法无效。'}</p><CodeBlock code={code} language="mermaid" /></RichFrame>;
  return <>
    <RichFrame title="Mermaid" actions={<><CopyButton value={code} /><IconButton label="全屏查看" onClick={() => setFullscreen(true)}><Maximize2 size={15} /></IconButton></>} className="rich-mermaid-frame"><MermaidCanvas svg={result.svg} /></RichFrame>
    <Fullscreen open={fullscreen} title="Mermaid" onClose={() => setFullscreen(false)}><div className="rich-mermaid-fullscreen-view">
      <div className="rich-mermaid-fullscreen-tools" aria-label="流程图缩放">
        <IconButton label="缩小" onClick={() => setZoom((value) => Math.max(.6, Math.round((value - .2) * 10) / 10))}><Minus size={15} /></IconButton>
        <IconButton label="重置缩放" onClick={() => setZoom(1)}><RotateCcw size={14} /></IconButton>
        <IconButton label="放大" onClick={() => setZoom((value) => Math.min(2, Math.round((value + .2) * 10) / 10))}><Plus size={15} /></IconButton>
      </div>
      <MermaidCanvas svg={result.svg} zoom={zoom} />
    </div></Fullscreen>
  </>;
}

function MathBlock({ code }: { code: string }) {
  return <RichFrame title="Math" actions={<CopyButton value={code} />} className="rich-math-frame"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{`$$\n${code}\n$$`}</ReactMarkdown></RichFrame>;
}

function formattedDataValue(value: DataValue, type = 'text') {
  if (value == null) return '';
  if (type === 'number' && typeof value === 'number') return new Intl.NumberFormat().format(value);
  if (type === 'currency' && typeof value === 'number') return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  if (type === 'percent' && typeof value === 'number') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value);
  if (type === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'date') {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }
  return String(value);
}

function mergeDataSpec(inline: DataSpec | null, fileValue: unknown): DataSpec | null {
  if (!inline) return null;
  const fileSpec: DataSpec | null = Array.isArray(fileValue)
    ? { rows: fileValue as Array<DataValue[] | Record<string, DataValue>> }
    : fileValue && typeof fileValue === 'object' ? fileValue as DataSpec : null;
  if (!fileSpec) return inline;
  return {
    ...fileSpec,
    ...inline,
    columns: inline.columns?.length ? inline.columns : fileSpec.columns,
    rows: inline.rows?.length ? inline.rows : fileSpec.rows,
    title: inline.title || fileSpec.title,
  };
}

function DataGrid({ code, spreadsheet, context }: { code: string; spreadsheet: boolean; context: PreviewContext }) {
  const inline = parseJson<DataSpec>(code);
  const resourceUrl = inline?.src ? previewUrl(inline.src, context) : null;
  const resource = useTextResource(resourceUrl);
  const remote = resource.text ? parseJson<unknown>(resource.text) : null;
  const spec = useMemo(() => mergeDataSpec(inline, remote), [inline, remote]);
  const normalized = useMemo(() => spec ? normalizeDataSpec(spec) : { columns: [], columnDefs: [], rows: [] }, [spec]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ index: number; direction: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const initialGroupIndex = spec?.groupBy ? normalized.columnDefs?.findIndex((column: ColumnDef) => column.key === spec.groupBy || column.label === spec.groupBy) ?? -1 : -1;
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => setGroupIndex(initialGroupIndex), [initialGroupIndex]);
  const visibleRows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const filtered = normalized.rows.filter((row) => {
      if (term && !row.some((value) => String(value ?? '').toLocaleLowerCase().includes(term))) return false;
      return Object.entries(filters).every(([index, value]) => !value.trim() || String(row[Number(index)] ?? '').toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()));
    });
    if (!sort) return filtered;
    return [...filtered].sort((left, right) => String(left[sort.index] ?? '').localeCompare(String(right[sort.index] ?? ''), undefined, { numeric: true }) * sort.direction);
  }, [filters, normalized.rows, query, sort]);
  const groupedRows = useMemo(() => {
    if (groupIndex < 0) return null;
    const groups = new Map<string, DataValue[][]>();
    for (const row of visibleRows) {
      const key = String(row[groupIndex] ?? '—');
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return [...groups.entries()];
  }, [groupIndex, visibleRows]);
  if (!spec || resource.error || !normalized.columns.length) return <CodeBlock code={code} language={spreadsheet ? 'spreadsheet' : 'datatable'} />;

  const exportData = async (format: 'csv' | 'xlsx') => {
    if (format === 'xlsx') {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const sheet = [normalized.columns, ...visibleRows].map((row) => row.map((value) => value == null ? '' : value));
      await writeXlsxFile(sheet).toFile(`${spec.filename || spec.title || 'frakio-data'}.xlsx`);
      return;
    }
    const csv = [normalized.columns, ...visibleRows].map((row) => row.map(csvCell).join(',')).join('\n');
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${spec.title || 'frakio-data'}.csv`);
  };
  const renderRow = (row: DataValue[], rowIndex: number | string) => <tr key={rowIndex}>{row.map((value, cellIndex) => {
    const type = normalized.columnDefs[cellIndex]?.type || 'text';
    return <td key={cellIndex}><span className={type === 'badge' ? 'rich-data-badge' : type === 'percent' && typeof value === 'number' ? value < 0 ? 'rich-data-negative' : 'rich-data-positive' : ''}>{formattedDataValue(value, type)}</span></td>;
  })}</tr>;
  const table = <div className="rich-data-content">
    <div className="rich-data-toolbar">
      <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索数据" /></label>
      {!spreadsheet && <label className="rich-select"><select value={groupIndex} onChange={(event) => setGroupIndex(Number(event.target.value))}><option value={-1}>不分组</option>{normalized.columns.map((column, index) => <option value={index} key={normalized.columnDefs[index]?.key || column}>按 {column} 分组</option>)}</select><ChevronDown size={13} /></label>}
      <span>{visibleRows.length} 行</span>
    </div>
    <div className="rich-table-scroll"><table><thead><tr>{normalized.columns.map((column, index) => <th key={normalized.columnDefs[index]?.key || column}><button type="button" onClick={() => setSort((current) => current?.index === index ? { index, direction: current.direction === 1 ? -1 : 1 } : { index, direction: 1 })}>{column}{sort?.index === index ? (sort.direction === 1 ? ' ↑' : ' ↓') : ''}</button></th>)}</tr>{!spreadsheet && <tr className="rich-filter-row">{normalized.columns.map((column, index) => <th key={column}><input value={filters[index] || ''} onChange={(event) => setFilters((current) => ({ ...current, [index]: event.target.value }))} placeholder={`筛选 ${column}`} aria-label={`筛选 ${column}`} /></th>)}</tr>}</thead><tbody>{groupedRows ? groupedRows.flatMap(([group, rows]) => [<tr className="rich-group-row" key={`group-${group}`} onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}><td colSpan={normalized.columns.length}><ChevronRight size={13} className={collapsedGroups.has(group) ? '' : 'expanded'} />{normalized.columns[groupIndex]}: {group} <small>({rows.length})</small></td></tr>, ...(collapsedGroups.has(group) ? [] : rows.map((row, index) => renderRow(row, `${group}-${index}`)))]) : visibleRows.map(renderRow)}</tbody></table></div>
  </div>;
  return <>
    <RichFrame title={spec.title || spec.sheetName || (spreadsheet ? 'Spreadsheet' : 'Data table')} actions={<>{spreadsheet && <IconButton label="导出 XLSX" onClick={() => void exportData('xlsx')}><Download size={15} /></IconButton>}<IconButton label="导出 CSV" onClick={() => void exportData('csv')}><Download size={15} /></IconButton><IconButton label="全屏查看" onClick={() => setFullscreen(true)}><Maximize2 size={15} /></IconButton></>} className="rich-data-frame">{resource.loading ? <p className="rich-loading">正在读取数据…</p> : table}</RichFrame>
    <Fullscreen open={fullscreen} title={spec.title || (spreadsheet ? 'Spreadsheet' : 'Data table')} onClose={() => setFullscreen(false)}>{table}</Fullscreen>
  </>;
}

function previewItems(spec: PreviewSpec | null): PreviewItem[] {
  if (!spec) return [];
  return spec.items?.length ? spec.items : [{ src: spec.src, title: spec.title, label: spec.label }];
}

function PreviewTabs({ items, active, onSelect }: { items: PreviewItem[]; active: number; onSelect: (index: number) => void }) {
  if (items.length < 2) return null;
  return <div className="rich-preview-tabs" role="tablist">{items.map((item, index) => <button type="button" role="tab" aria-selected={index === active} className={index === active ? 'active' : ''} onClick={() => onSelect(index)} key={`${item.src}-${index}`}>{item.label || item.title || item.src.split('/').at(-1)}</button>)}</div>;
}

function ImagePreview({ code, context }: { code: string; context: PreviewContext }) {
  const spec = normalizePreviewSpec(code);
  const items = previewItems(spec);
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const selected = items[active] || items[0];
  if (!spec || !selected) return <CodeBlock code={code} language="image-preview" />;
  const url = previewUrl(selected.src, context);
  const image = failed[selected.src] ? <p className="rich-preview-error">图片加载失败。</p> : <img src={url} alt={selected.title || selected.label || ''} onError={() => setFailed((current) => ({ ...current, [selected.src]: true }))} />;
  return <>
    <RichFrame title={spec.title || selected.title || selected.label || 'Image'} actions={<IconButton label="全屏查看" onClick={() => setFullscreen(true)} disabled={failed[selected.src]}><Maximize2 size={15} /></IconButton>} className="rich-image-frame"><PreviewTabs items={items} active={active} onSelect={setActive} />{image}</RichFrame>
    <Fullscreen open={fullscreen && !failed[selected.src]} title={spec.title || selected.title || 'Image'} onClose={() => setFullscreen(false)}><div className="rich-preview-fullscreen-stack"><PreviewTabs items={items} active={active} onSelect={setActive} /><img className="rich-fullscreen-image" src={url} alt={selected.title || ''} /></div></Fullscreen>
  </>;
}

function HtmlFrame({ item, context, fullscreen = false }: { item: PreviewItem; context: PreviewContext; fullscreen?: boolean }) {
  const resource = useTextResource(previewUrl(item.src, context));
  if (resource.error) return <p className="rich-preview-error">{resource.error}</p>;
  if (resource.loading) return <p className="rich-loading">正在读取 HTML…</p>;
  return <iframe className={fullscreen ? 'rich-fullscreen-iframe' : undefined} title={item.title || item.label || 'HTML preview'} sandbox="" srcDoc={resource.text} />;
}

function HtmlPreview({ code, context }: { code: string; context: PreviewContext }) {
  const spec = normalizePreviewSpec(code);
  const items = previewItems(spec);
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const selected = items[active] || items[0];
  if (!spec || !selected) return <CodeBlock code={code} language="html-preview" />;
  return <>
    <RichFrame title={spec.title || selected.title || 'HTML preview'} actions={<IconButton label="全屏查看" onClick={() => setFullscreen(true)}><Maximize2 size={15} /></IconButton>} className="rich-html-frame"><PreviewTabs items={items} active={active} onSelect={setActive} /><HtmlFrame item={selected} context={context} /></RichFrame>
    <Fullscreen open={fullscreen} title={spec.title || selected.title || 'HTML preview'} onClose={() => setFullscreen(false)}><div className="rich-preview-fullscreen-stack"><PreviewTabs items={items} active={active} onSelect={setActive} /><HtmlFrame item={selected} context={context} fullscreen /></div></Fullscreen>
  </>;
}

function PdfDocumentView({ url, fullscreen = false }: { url: string; fullscreen?: boolean }) {
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [url]);
  return <div className={fullscreen ? 'rich-pdf-reader' : 'rich-pdf-inline'}>
    {fullscreen && pageCount > 0 && <div className="rich-pdf-navigation"><IconButton label="上一页" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronRight className="previous" size={15} /></IconButton><span>{page} / {pageCount}</span><IconButton label="下一页" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={15} /></IconButton></div>}
    <Document file={url} loading={<p className="rich-loading">正在加载 PDF…</p>} error={<p className="rich-preview-error">PDF 加载失败。</p>} onLoadSuccess={(pdf) => { setPageCount(pdf.numPages); setPage((value) => Math.min(Math.max(1, value), pdf.numPages)); }}>
      {pageCount > 0 && <Page pageNumber={fullscreen ? page : 1} width={fullscreen ? Math.min(900, window.innerWidth - 100) : 720} renderTextLayer={fullscreen} renderAnnotationLayer={fullscreen} />}
    </Document>
  </div>;
}

function PdfPreview({ code, context }: { code: string; context: PreviewContext }) {
  const spec = normalizePreviewSpec(code);
  const items = previewItems(spec);
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const selected = items[active] || items[0];
  if (!spec || !selected) return <CodeBlock code={code} language="pdf-preview" />;
  const url = previewUrl(selected.src, context);
  return <>
    <RichFrame title={spec.title || selected.title || 'PDF'} actions={<IconButton label="全屏查看" onClick={() => setFullscreen(true)}><Maximize2 size={15} /></IconButton>} className="rich-pdf-frame"><PreviewTabs items={items} active={active} onSelect={setActive} /><PdfDocumentView url={url} /></RichFrame>
    <Fullscreen open={fullscreen} title={spec.title || selected.title || 'PDF'} onClose={() => setFullscreen(false)}><div className="rich-preview-fullscreen-stack"><PreviewTabs items={items} active={active} onSelect={setActive} /><PdfDocumentView url={url} fullscreen /></div></Fullscreen>
  </>;
}

function MarkdownDocument({ item, context, depth }: { item: PreviewItem; context: PreviewContext; depth: number }) {
  const resource = useTextResource(previewUrl(item.src, context));
  return resource.error ? <p className="rich-preview-error">{resource.error}</p> : resource.loading ? <p className="rich-loading">正在读取 Markdown…</p> : <RichMarkdown content={resource.text} {...context} depth={depth + 1} />;
}

function MarkdownPreview({ code, context, depth }: { code: string; context: PreviewContext; depth: number }) {
  const spec = normalizePreviewSpec(code);
  const items = previewItems(spec);
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const selected = items[active] || items[0];
  if (!spec || !selected || depth >= 1) return <CodeBlock code={code} language="markdown-preview" />;
  const tabs = <PreviewTabs items={items} active={active} onSelect={setActive} />;
  return <>
    <RichFrame title={spec.title || selected.title || 'Markdown'} actions={<IconButton label="全屏查看" onClick={() => setFullscreen(true)}><Maximize2 size={15} /></IconButton>} className="rich-markdown-preview">{tabs}<MarkdownDocument item={selected} context={context} depth={depth} /></RichFrame>
    <Fullscreen open={fullscreen} title={spec.title || selected.title || 'Markdown'} onClose={() => setFullscreen(false)}><div className="rich-preview-fullscreen-stack">{tabs}<div className="rich-markdown-fullscreen"><MarkdownDocument item={selected} context={context} depth={depth} /></div></div></Fullscreen>
  </>;
}

function RichFence({ language, code, context, depth }: { language: string; code: string; context: PreviewContext; depth: number }) {
  const fallback = <CodeBlock code={code} language={language} />;
  let content: React.ReactNode = fallback;
  if (language === 'diff') content = <DiffBlock code={code} />;
  else if (language === 'json') content = <JsonBlock code={code} />;
  else if (language === 'mermaid') content = <MermaidBlock code={code} />;
  else if (language === 'latex' || language === 'math') content = <MathBlock code={code} />;
  else if (language === 'datatable') content = <DataGrid code={code} spreadsheet={false} context={context} />;
  else if (language === 'spreadsheet') content = <DataGrid code={code} spreadsheet context={context} />;
  else if (language === 'html-preview') content = <HtmlPreview code={code} context={context} />;
  else if (language === 'image-preview') content = <ImagePreview code={code} context={context} />;
  else if (language === 'pdf-preview') content = <PdfPreview code={code} context={context} />;
  else if (language === 'markdown-preview') content = <MarkdownPreview code={code} context={context} depth={depth} />;
  return <RichBlockBoundary fallback={fallback}>{content}</RichBlockBoundary>;
}

function PendingRichBlock({ language }: { language: string }) {
  return <RichFrame title={REPAIRABLE_DIAGRAM_LANGUAGES.has(language) || language === 'mermaid' ? '正在生成图表' : '正在生成内容'} className="rich-pending-frame"><p className="rich-loading">内容完成后将自动呈现。</p></RichFrame>;
}

const MarkdownChunk = memo(function MarkdownChunk({ content, context, depth, streaming, streamReveal }: { content: string; context: PreviewContext; depth: number; streaming: boolean; streamReveal?: StreamRevealMeta }) {
  const incompleteFence = streaming && hasUnclosedMarkdownFence(content);
  const rehypePlugins = streamReveal?.appendedGraphemes
    ? [rehypeKatex, [rehypeStreamRevealTail, streamReveal]]
    : [rehypeKatex];
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, remarkCjkStrong]}
    rehypePlugins={rehypePlugins as any}
    skipHtml
    components={{
      table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
      a: ({ href, children, ...props }) => {
        const safe = typeof href === 'string' && /^(https?:|mailto:)/i.test(href);
        return safe ? <a href={href} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); openSafeMarkdownLink(href); }} {...props}>{children}</a> : <span>{children}</span>;
      },
      span: ({ children, ...props }) => {
        const revision = String((props as any)['data-stream-reveal-revision'] || '');
        return revision
          ? <StreamRevealTail revision={revision} {...props}>{children}</StreamRevealTail>
          : <span {...props}>{children}</span>;
      },
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children }) => {
        const match = /language-([^\s]+)/.exec(className || '');
        const language = match?.[1]?.toLowerCase() || '';
        const code = String(children).replace(/\n$/, '');
        if (!match) return <code className={className}>{children}</code>;
        if (streaming && (incompleteFence || REPAIRABLE_DIAGRAM_LANGUAGES.has(language)) && (RICH_LANGUAGES.has(language) || REPAIRABLE_DIAGRAM_LANGUAGES.has(language))) {
          return <PendingRichBlock language={language} />;
        }
        return <RichFence language={RICH_LANGUAGES.has(language) ? language : language || 'text'} code={code} context={context} depth={depth} />;
      },
    }}
  >{content}</ReactMarkdown>;
});

export function RichMarkdown({ content, streaming = false, streamReveal, threadId, workspaceId, depth = 0 }: RichMarkdownProps) {
  const normalized = String(content || '').replace(/^\s*\n+/, '').trimStart();
  const chunks = useMemo(() => splitStreamingMarkdown(normalized, streaming), [normalized, streaming]);
  const context = useMemo(() => ({ threadId, workspaceId }), [threadId, workspaceId]);
  return <div className="message-text markdown-message rich-markdown">
    {chunks.map((chunk, index) => {
      const isLiveTail = streaming && index === chunks.length - 1;
      return <MarkdownChunk
        content={chunk}
        context={context}
        depth={depth}
        streaming={streaming}
        streamReveal={isLiveTail ? streamReveal : undefined}
        key={isLiveTail ? `streaming-tail-${index}` : contentKey(chunk, index)}
      />;
    })}
  </div>;
}
