// wjz新建文件，新建原因：解耦 server.mjs 中的附件上传/下载、本地目录浏览与富内容文件预览路由（filesystem-and-attachments），修改时间：2026-08-18。
// 文件内容概述：/api/attachments, /api/filesystem/directories, /api/rich-preview。
import express from 'express';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { resolveInsideRoot } from '../lib/path-boundary.mjs';
import { resolveRichPreviewFile } from '../lib/rich-preview.mjs';
import { MAX_ATTACHMENT_BYTES } from '../lib/attachment-store.mjs';

export function createFilesystemAndAttachmentsRouter({
  attachmentStore,
  serverDirectoryRoot,
  readState,
  attachmentRoot,
  frakioWorkHome,
}) {
  const router = express.Router();

  // 1. Upload attachment draft
  router.post('/attachments', express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }), async (req, res) => {
    try {
      const attachment = await attachmentStore.save({
        name: String(req.query.name || ''),
        mimeType: String(req.headers['content-type'] || ''),
        data: req.body,
      });
      res.status(201).json({ attachment });
    } catch (error) {
      res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
    }
  });

  // 2. Download / stream attachment content
  router.get('/attachments/:id/content', async (req, res) => {
    try {
      const { metadata, filePath, inline } = await attachmentStore.content(req.params.id);
      res.type(metadata.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', String(metadata.size));
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      );
      await pipeline(createReadStream(filePath), res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
    }
  });

  // 3. Delete attachment draft
  router.delete('/attachments/:id', async (req, res) => {
    try {
      await attachmentStore.removeDraft(req.params.id);
      res.json({ ok: true, deletedAttachmentId: req.params.id });
    } catch (error) {
      res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
    }
  });

  // 4. Attachments payload too large error handler
  router.use('/attachments', (error, _req, res, next) => {
    if (error?.status === 413 || error?.type === 'entity.too.large') {
      return res.status(413).json({ error: '单个附件不能超过 32 MiB。', code: 'attachment_too_large' });
    }
    return next(error);
  });

  // 5. Read directories on local filesystem
  router.get('/filesystem/directories', async (req, res) => {
    try {
      const requested = String(req.query.path || serverDirectoryRoot).trim() || serverDirectoryRoot;
      const current = resolveInsideRoot(serverDirectoryRoot, requested);
      const info = await stat(current);
      if (!info.isDirectory()) return res.status(400).json({ error: '目标路径不是文件夹。' });
      const entries = (await readdir(current, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => ({ name: entry.name, path: path.join(current, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      const parentCandidate = path.dirname(current);
      res.json({
        root: serverDirectoryRoot,
        current,
        parent: current === serverDirectoryRoot ? '' : resolveInsideRoot(serverDirectoryRoot, parentCandidate),
        entries,
      });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || '无法读取文件夹。' });
    }
  });

  // 6. Rich preview endpoint
  router.get('/rich-preview', async (req, res) => {
    try {
      const state = await readState();
      const threadId = String(req.query.threadId || '');
      const workspaceId = String(req.query.workspaceId || '');
      const thread = threadId ? state.threads?.find((item) => item.id === threadId) : null;
      const resolvedWorkspaceId = workspaceId || thread?.workspaceId || '';
      const workspace = resolvedWorkspaceId ? state.workspaces?.find((item) => item.id === resolvedWorkspaceId) : null;
      const preview = await resolveRichPreviewFile(String(req.query.path || ''), [
        workspace?.rootPath,
        attachmentRoot,
        frakioWorkHome,
        os.tmpdir(),
      ]);
      res.setHeader('Content-Type', preview.mimeType);
      res.setHeader('Content-Length', String(preview.size));
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(preview.fileName)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await pipeline(preview.stream(), res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(error.status || 500).json({
          error: error.message || '文件预览失败。',
          code: error.code || 'RICH_PREVIEW_FAILED',
        });
      }
    }
  });

  return router;
}
// wjz新建文件结束。
