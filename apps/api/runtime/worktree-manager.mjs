import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

function safeSegment(value) {
  return String(value || 'task').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}

export function createWorktreeManager({ root, execFile }) {
  return {
    async create({ repositoryPath, workspaceId, taskId }) {
      const repository = path.resolve(repositoryPath);
      const gitDirectory = path.join(repository, '.git');
      const gitInfo = await stat(gitDirectory).catch(() => null);
      if (!gitInfo) throw new Error('Code task isolation requires a Git repository.');
      const workspaceDirectory = path.join(path.resolve(root), safeSegment(workspaceId));
      const worktreePath = path.join(workspaceDirectory, safeSegment(taskId));
      await mkdir(workspaceDirectory, { recursive: true });
      const existing = await stat(worktreePath).catch(() => null);
      if (existing?.isDirectory()) return { worktreePath, branch: `frakio/task-${safeSegment(taskId)}`, reused: true };
      const branch = `frakio/task-${safeSegment(taskId)}`;
      await execFile('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
        cwd: repository,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return { worktreePath, branch, reused: false };
    },
  };
}
