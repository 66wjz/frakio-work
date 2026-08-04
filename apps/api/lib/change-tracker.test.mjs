import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { captureWorktreeTree, diffTrees, uncommittedChangeSet } from './change-tracker.mjs';

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  await execFileAsync('git', ['-C', root, ...args]);
}

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-change-tracker-'));
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'tests@frakio.local');
  await git(root, 'config', 'user.name', 'Frakio Tests');
  await writeFile(path.join(root, 'app.txt'), 'baseline\n', 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'initial');
  return root;
}

test('turn diff excludes dirty files that existed before the baseline', async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, 'app.txt'), 'user dirty change\n', 'utf8');
    const before = await captureWorktreeTree(root);
    await writeFile(path.join(root, 'agent.txt'), 'agent output\n', 'utf8');
    const after = await captureWorktreeTree(root);
    const result = await diffTrees(root, before.tree, after.tree);
    assert.equal(result.fileCount, 1);
    assert.equal(result.files[0].path, 'agent.txt');
    assert.equal(result.files[0].status, 'added');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uncommitted diff includes tracked edits, deletes and untracked files', async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, 'app.txt'), 'changed\n', 'utf8');
    await writeFile(path.join(root, 'new.txt'), 'new\n', 'utf8');
    const result = await uncommittedChangeSet(root);
    assert.equal(result.fileCount, 2);
    assert.deepEqual(new Set(result.files.map((file) => file.path)), new Set(['app.txt', 'new.txt']));
    assert.ok(result.additions >= 2);
    assert.ok(result.deletions >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
