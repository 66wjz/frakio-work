import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInsideRoot } from '../lib/path-boundary.mjs';

const DEFAULT_FILES = {
  'index.md': '# Workspace Knowledge\n\nThis Vault is managed by Frakio Work.\n',
  'AGENTS.md': '# Agent Knowledge Rules\n\nWrite run output to `drafts/<run-id>/` first. Publish reviewed facts to `wiki/`. Keep raw sources in `sources/`.\n',
  'log.md': '# Knowledge Log\n',
};

const DEFAULT_DIRS = ['sources', 'wiki', 'drafts', 'artifacts'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.cache']);

function normalizeRelative(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

async function markdownFiles(root, directory = root, rows = []) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') && entry.name !== '.obsidian') continue;
    if (SKIP_DIRS.has(entry.name) || entry.name === '.obsidian') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await markdownFiles(root, fullPath, rows);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const info = await stat(fullPath).catch(() => null);
    if (!info || info.size > 2 * 1024 * 1024) continue;
    rows.push({ fullPath, relativePath: path.relative(root, fullPath).replaceAll('\\', '/'), size: info.size, updatedAt: info.mtime.toISOString() });
  }
  return rows;
}

export function createKnowledgeGateway({ store }) {
  return {
    async initializeVault(vault) {
      const root = path.resolve(vault.path);
      await mkdir(root, { recursive: true });
      await Promise.all(DEFAULT_DIRS.map((directory) => mkdir(path.join(root, directory), { recursive: true })));
      for (const [relativePath, content] of Object.entries(DEFAULT_FILES)) {
        const target = resolveInsideRoot(root, path.join(root, relativePath));
        try {
          await stat(target);
        } catch {
          await writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
        }
      }
      return { root, directories: DEFAULT_DIRS, files: Object.keys(DEFAULT_FILES) };
    },
    async search(vault, query, { limit = 20 } = {}) {
      const clean = String(query || '').trim().toLowerCase();
      if (!clean) return [];
      const files = await markdownFiles(path.resolve(vault.path));
      const matches = [];
      for (const file of files) {
        const content = await readFile(file.fullPath, 'utf8').catch(() => '');
        const lower = content.toLowerCase();
        const index = lower.indexOf(clean);
        if (index < 0 && !file.relativePath.toLowerCase().includes(clean)) continue;
        matches.push({
          relativePath: file.relativePath,
          summary: index >= 0
            ? content.slice(Math.max(0, index - 100), Math.min(content.length, index + clean.length + 300)).replace(/\s+/g, ' ').trim()
            : file.relativePath,
          updatedAt: file.updatedAt,
        });
        if (matches.length >= Math.max(1, Math.min(100, Number(limit) || 20))) break;
      }
      return matches;
    },
    async read(vault, relativePath) {
      const root = path.resolve(vault.path);
      const safeRelative = normalizeRelative(relativePath);
      const target = resolveInsideRoot(root, path.join(root, safeRelative));
      const info = await stat(target);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Knowledge file is not a readable document.');
      return { relativePath: safeRelative, content: await readFile(target, 'utf8'), updatedAt: info.mtime.toISOString() };
    },
    async draftWrite({ workspace, vault, runId, relativePath, content }) {
      const safeRunId = String(runId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '-');
      const requested = normalizeRelative(relativePath).replace(/^drafts\/[^/]+\//, '');
      if (!requested || !requested.toLowerCase().endsWith('.md')) throw new Error('Knowledge drafts must use a .md path.');
      const draftRelativePath = path.posix.join('drafts', safeRunId, requested);
      const root = path.resolve(vault.path);
      const target = resolveInsideRoot(root, path.join(root, draftRelativePath));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, String(content || ''), { encoding: 'utf8', mode: 0o600 });
      const commit = store.appendKnowledgeCommit({
        workspaceId: workspace.id,
        vaultId: vault.id,
        runId,
        operation: 'draft.write',
        relativePath: draftRelativePath,
      });
      return { relativePath: draftRelativePath, commit };
    },
    async publish({ workspace, vault, runId, draftPath, targetPath = '' }) {
      const root = path.resolve(vault.path);
      const normalizedDraft = normalizeRelative(draftPath);
      if (!normalizedDraft.startsWith(`drafts/${String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}/`)) {
        throw new Error('Only drafts owned by the current run can be published.');
      }
      const targetRelative = normalizeRelative(targetPath)
        || path.posix.join('wiki', normalizedDraft.split('/').slice(2).join('/'));
      if (!targetRelative.startsWith('wiki/') && !targetRelative.startsWith('artifacts/')) {
        throw new Error('Published knowledge must target wiki/ or artifacts/.');
      }
      const source = resolveInsideRoot(root, path.join(root, normalizedDraft));
      const target = resolveInsideRoot(root, path.join(root, targetRelative));
      const sourceInfo = await stat(source);
      if (!sourceInfo.isFile()) throw new Error('Knowledge draft does not exist.');
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
      const createdAt = new Date().toISOString();
      await appendFile(path.join(root, 'log.md'), `\n- ${createdAt} published \`${normalizedDraft}\` to \`${targetRelative}\` (run ${runId})\n`, 'utf8');
      const commit = store.appendKnowledgeCommit({
        workspaceId: workspace.id,
        vaultId: vault.id,
        runId,
        operation: 'publish',
        relativePath: targetRelative,
        sourcePath: normalizedDraft,
      });
      return { relativePath: targetRelative, commit };
    },
    async index(vault) {
      const files = await markdownFiles(path.resolve(vault.path));
      return {
        documentCount: files.length,
        files: files.map(({ relativePath, size, updatedAt }) => ({ relativePath, size, updatedAt })),
        indexedAt: new Date().toISOString(),
      };
    },
  };
}
