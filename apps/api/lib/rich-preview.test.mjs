import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAX_RICH_PREVIEW_IMAGE_BYTES, resolveRichPreviewFile, richPreviewByteLimit, richPreviewMimeType } from './rich-preview.mjs';

test('rich preview accepts supported files inside an allowed root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-rich-preview-'));
  const filePath = path.join(root, 'notes.md');
  await writeFile(filePath, '# Notes');
  const preview = await resolveRichPreviewFile(filePath, [root]);
  assert.equal(preview.kind, 'text');
  assert.equal(preview.mimeType, 'text/markdown; charset=utf-8');
  assert.equal(preview.fileName, 'notes.md');
});

test('rich preview rejects files outside roots and symlink escapes', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-rich-preview-boundary-'));
  const root = path.join(parent, 'root');
  const outside = path.join(parent, 'outside.md');
  await mkdir(root);
  await writeFile(outside, 'secret');
  await assert.rejects(resolveRichPreviewFile(outside, [root]), { code: 'RICH_PREVIEW_FORBIDDEN' });
  const link = path.join(root, 'link.md');
  await symlink(outside, link);
  await assert.rejects(resolveRichPreviewFile(link, [root]), { code: 'RICH_PREVIEW_FORBIDDEN' });
});

test('rich preview rejects missing, relative, and unsupported files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-rich-preview-invalid-'));
  await assert.rejects(resolveRichPreviewFile('notes.md', [root]), { code: 'RICH_PREVIEW_PATH_REQUIRED' });
  await assert.rejects(resolveRichPreviewFile(path.join(root, 'missing.md'), [root]), { code: 'RICH_PREVIEW_NOT_FOUND' });
  const binary = path.join(root, 'archive.bin');
  await writeFile(binary, Buffer.from([0, 1, 2]));
  await assert.rejects(resolveRichPreviewFile(binary, [root]), { code: 'RICH_PREVIEW_UNSUPPORTED' });
  assert.equal(richPreviewMimeType('sheet.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('rich preview applies limits by file kind', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-rich-preview-limits-'));
  const image = path.join(root, 'large.png');
  await writeFile(image, '');
  await truncate(image, MAX_RICH_PREVIEW_IMAGE_BYTES + 1);
  await assert.rejects(resolveRichPreviewFile(image, [root]), { code: 'RICH_PREVIEW_TOO_LARGE' });
  assert.equal(richPreviewByteLimit('text'), 1024 * 1024);
  assert.equal(richPreviewByteLimit('spreadsheet'), 16 * 1024 * 1024);
});
