import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_FILE_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_PATCH_BYTES = 20 * 1024 * 1024;

async function git(root, args, options = {}) {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...(options.env || {}) },
  });
  return String(result.stdout || '');
}

export async function gitWorkspaceInfo(root) {
  try {
    const [topLevel, branch] = await Promise.all([
      git(root, ['rev-parse', '--show-toplevel']),
      git(root, ['branch', '--show-current']).catch(() => ''),
    ]);
    return { available: true, root: topLevel.trim(), branch: branch.trim() || 'HEAD' };
  } catch {
    return { available: false, root: '', branch: '' };
  }
}

export async function captureWorktreeTree(root) {
  const info = await gitWorkspaceInfo(root);
  if (!info.available) throw Object.assign(new Error('当前项目不是 Git 仓库。'), { code: 'GIT_UNAVAILABLE', status: 409 });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'frakio-index-'));
  const indexPath = path.join(tempDir, 'index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    await git(info.root, ['read-tree', 'HEAD'], { env }).catch(() => git(info.root, ['read-tree', '--empty'], { env }));
    await git(info.root, ['add', '-A', '--', '.'], { env, maxBuffer: 64 * 1024 * 1024 });
    const tree = (await git(info.root, ['write-tree'], { env })).trim();
    return { tree, root: info.root, branch: info.branch };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseNumstat(output) {
  const rows = new Map();
  for (const line of String(output || '').split('\n')) {
    if (!line) continue;
    const [added, deleted, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (!filePath) continue;
    rows.set(filePath, {
      additions: added === '-' ? 0 : Number(added || 0),
      deletions: deleted === '-' ? 0 : Number(deleted || 0),
      binary: added === '-' || deleted === '-',
    });
  }
  return rows;
}

function statusLabel(value, binary) {
  if (binary) return 'binary';
  if (value.startsWith('A')) return 'added';
  if (value.startsWith('D')) return 'deleted';
  if (value.startsWith('R')) return 'renamed';
  return 'modified';
}

export async function diffTrees(root, beforeTree, afterTree, { includePatches = true } = {}) {
  const [numstat, names] = await Promise.all([
    git(root, ['diff', '--no-ext-diff', '--numstat', beforeTree, afterTree, '--']),
    git(root, ['diff', '--no-ext-diff', '--name-status', '-M', beforeTree, afterTree, '--']),
  ]);
  const stats = parseNumstat(numstat);
  const files = [];
  let totalPatchBytes = 0;
  for (const line of names.split('\n')) {
    if (!line) continue;
    const [rawStatus, firstPath, secondPath] = line.split('\t');
    const filePath = secondPath || firstPath;
    const fileStats = stats.get(filePath) || stats.get(firstPath) || { additions: 0, deletions: 0, binary: false };
    let patch = '';
    let truncated = false;
    if (includePatches && !fileStats.binary && totalPatchBytes < MAX_TOTAL_PATCH_BYTES) {
      patch = await git(root, ['diff', '--no-ext-diff', '--unified=3', beforeTree, afterTree, '--', filePath], { maxBuffer: MAX_FILE_PATCH_BYTES + 256 * 1024 }).catch(() => '');
      const bytes = Buffer.byteLength(patch);
      if (bytes > MAX_FILE_PATCH_BYTES || totalPatchBytes + bytes > MAX_TOTAL_PATCH_BYTES) {
        patch = Buffer.from(patch).subarray(0, Math.min(MAX_FILE_PATCH_BYTES, MAX_TOTAL_PATCH_BYTES - totalPatchBytes)).toString('utf8');
        truncated = true;
      }
      totalPatchBytes += Buffer.byteLength(patch);
    } else if (includePatches && !fileStats.binary) {
      truncated = true;
    }
    files.push({
      path: filePath,
      previousPath: secondPath ? firstPath : undefined,
      status: statusLabel(rawStatus, fileStats.binary),
      additions: fileStats.additions,
      deletions: fileStats.deletions,
      binary: fileStats.binary || undefined,
      patch: patch || undefined,
      truncated: truncated || undefined,
    });
  }
  return {
    fileCount: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };
}

export async function uncommittedChangeSet(root) {
  const current = await captureWorktreeTree(root);
  let head;
  try {
    head = (await git(current.root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'frakio-empty-tree-'));
    const indexPath = path.join(tempDir, 'index');
    try {
      await git(current.root, ['read-tree', '--empty'], { env: { GIT_INDEX_FILE: indexPath } });
      head = (await git(current.root, ['write-tree'], { env: { GIT_INDEX_FILE: indexPath } })).trim();
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { ...await diffTrees(current.root, head, current.tree), root: current.root, branch: current.branch };
}
