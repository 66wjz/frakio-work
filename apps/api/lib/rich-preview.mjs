import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_RICH_PREVIEW_TEXT_BYTES = 1024 * 1024;
export const MAX_RICH_PREVIEW_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_RICH_PREVIEW_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_RICH_PREVIEW_SPREADSHEET_BYTES = 16 * 1024 * 1024;

const MIME_BY_EXTENSION = new Map([
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mdx', 'text/markdown; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

function previewError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function isInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function richPreviewMimeType(filePath) {
  return MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

export function richPreviewKind(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType === 'application/vnd.ms-excel') return 'spreadsheet';
  if (mimeType.startsWith('text/') || mimeType.includes('json')) return 'text';
  return 'binary';
}

export function richPreviewByteLimit(kind) {
  if (kind === 'text') return MAX_RICH_PREVIEW_TEXT_BYTES;
  if (kind === 'image') return MAX_RICH_PREVIEW_IMAGE_BYTES;
  if (kind === 'pdf') return MAX_RICH_PREVIEW_PDF_BYTES;
  if (kind === 'spreadsheet') return MAX_RICH_PREVIEW_SPREADSHEET_BYTES;
  return 0;
}

export async function resolveRichPreviewFile(requestedPath, allowedRoots) {
  const source = String(requestedPath || '').trim();
  if (!source || !path.isAbsolute(source)) throw previewError('预览文件必须使用绝对路径。', 400, 'RICH_PREVIEW_PATH_REQUIRED');

  let resolvedFile;
  try {
    resolvedFile = await realpath(source);
  } catch {
    throw previewError('预览文件不存在。', 404, 'RICH_PREVIEW_NOT_FOUND');
  }

  const resolvedRoots = [];
  for (const root of allowedRoots) {
    if (!root) continue;
    try {
      resolvedRoots.push(await realpath(root));
    } catch {
      // Optional roots may not exist yet.
    }
  }
  if (!resolvedRoots.some((root) => isInsideRoot(resolvedFile, root))) {
    throw previewError('该文件不在 Frakio 允许预览的目录中。', 403, 'RICH_PREVIEW_FORBIDDEN');
  }

  const metadata = await stat(resolvedFile);
  if (!metadata.isFile()) throw previewError('只能预览普通文件。', 400, 'RICH_PREVIEW_NOT_FILE');
  const mimeType = richPreviewMimeType(resolvedFile);
  const kind = richPreviewKind(mimeType);
  const byteLimit = richPreviewByteLimit(kind);
  if (!byteLimit) throw previewError('该文件类型不支持预览。', 415, 'RICH_PREVIEW_UNSUPPORTED');
  if (metadata.size > byteLimit) {
    throw previewError(`文件超过预览上限（${Math.round(byteLimit / 1024 / 1024)} MiB）。`, 413, 'RICH_PREVIEW_TOO_LARGE');
  }
  return {
    filePath: resolvedFile,
    fileName: path.basename(resolvedFile),
    size: metadata.size,
    mimeType,
    kind,
    stream: () => createReadStream(resolvedFile),
  };
}
