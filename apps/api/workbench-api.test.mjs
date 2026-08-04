import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  await execFileAsync('git', ['-C', root, ...args]);
}

test('workbench context, overview and change routes remain scoped to their thread', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-workbench-api-'));
  const home = path.join(parent, '.frakio-work');
  const repository = path.join(parent, 'project');
  const statePath = path.join(home, 'data', 'workbench-state.json');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(repository, { recursive: true });
  await git(repository, 'init', '-q');
  await git(repository, 'config', 'user.email', 'tests@frakio.local');
  await git(repository, 'config', 'user.name', 'Frakio Tests');
  await writeFile(path.join(repository, 'app.txt'), 'baseline\n', 'utf8');
  await git(repository, 'add', '.');
  await git(repository, 'commit', '-qm', 'initial');

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?workbench-api=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };

  const workspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'existing', rootPath: repository }),
  });
  assert.equal(workspaceResponse.status, 200);
  const { workspace, thread: projectThread } = await workspaceResponse.json();

  const directResponse = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Other thread' }),
  });
  assert.equal(directResponse.status, 200);
  const { thread: otherThread } = await directResponse.json();

  const annotationResponse = await fetch(`${baseUrl}/api/threads/${projectThread.id}/draft-context/browser`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url: 'http://localhost:5173/settings',
      pageTitle: 'Settings',
      target: 'element',
      selector: '#save',
      accessibleName: 'Save',
      comment: 'Use the quieter button style.',
      rect: { x: 20, y: 40, width: 120, height: 36, viewportWidth: 1280, viewportHeight: 720 },
    }),
  });
  assert.equal(annotationResponse.status, 201);
  const annotation = (await annotationResponse.json()).item;

  const reviewResponse = await fetch(`${baseUrl}/api/threads/${projectThread.id}/draft-context/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      changeSetId: 'changes-test',
      filePath: 'app.txt',
      side: 'new',
      line: 1,
      hunk: '@@ -1 +1 @@',
      comment: 'Keep the original fallback.',
    }),
  });
  assert.equal(reviewResponse.status, 201);
  const review = (await reviewResponse.json()).item;

  const projectDraft = await fetch(`${baseUrl}/api/threads/${projectThread.id}/draft-context`).then((response) => response.json());
  assert.deepEqual(projectDraft.draftContext.browserAnnotations.map((item) => item.id), [annotation.id]);
  assert.deepEqual(projectDraft.draftContext.reviewComments.map((item) => item.id), [review.id]);
  const otherDraft = await fetch(`${baseUrl}/api/threads/${otherThread.id}/draft-context`).then((response) => response.json());
  assert.deepEqual(otherDraft.draftContext, { browserAnnotations: [], reviewComments: [] });

  const stored = JSON.parse(await readFile(statePath, 'utf8'));
  const storedThread = stored.threads.find((item) => item.id === projectThread.id);
  storedThread.runStatus = 'running';
  storedThread.activeRunId = 'existing-run';
  storedThread.activeRunTurnId = 'existing-turn';
  storedThread.activeRunStartedAt = new Date().toISOString();
  storedThread.changeSets = [{
    id: 'changes-test',
    threadId: projectThread.id,
    runId: 'completed-run',
    workspaceId: workspace.id,
    scope: 'last-turn',
    status: 'completed',
    fileCount: 1,
    additions: 2,
    deletions: 1,
    files: [{ path: 'app.txt', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new\n' }],
    baselineTree: 'private-baseline',
    root: repository,
    createdAt: new Date().toISOString(),
  }];
  await writeFile(statePath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

  const rejectedRun = await fetch(`${baseUrl}/api/threads/${projectThread.id}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      runtimeId: 'pi',
      message: 'Apply the selected feedback.',
      browserAnnotationIds: [annotation.id],
      reviewCommentIds: [review.id],
    }),
  });
  assert.equal(rejectedRun.status, 400);
  const draftAfterFailure = await fetch(`${baseUrl}/api/threads/${projectThread.id}/draft-context`).then((response) => response.json());
  assert.deepEqual(draftAfterFailure.draftContext.browserAnnotations.map((item) => item.id), [annotation.id]);
  assert.deepEqual(draftAfterFailure.draftContext.reviewComments.map((item) => item.id), [review.id]);

  const overviewResponse = await fetch(`${baseUrl}/api/threads/${projectThread.id}/overview`);
  assert.equal(overviewResponse.status, 200);
  const overview = (await overviewResponse.json()).overview;
  assert.equal(overview.threadId, projectThread.id);
  assert.equal(overview.environment.kind, 'local');
  assert.equal(overview.environment.workspaceRoot, repository);
  assert.equal(overview.lastChangeSet.id, 'changes-test');

  const changeSetResponse = await fetch(`${baseUrl}/api/threads/${projectThread.id}/change-sets/changes-test`);
  assert.equal(changeSetResponse.status, 200);
  const changeSet = (await changeSetResponse.json()).changeSet;
  assert.equal(changeSet.files[0].path, 'app.txt');
  assert.equal(changeSet.baselineTree, undefined);
  assert.equal(changeSet.root, undefined);

  await writeFile(path.join(repository, 'app.txt'), 'changed\n', 'utf8');
  const diffResponse = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/diff`);
  assert.equal(diffResponse.status, 200);
  const uncommitted = (await diffResponse.json()).changeSet;
  assert.equal(uncommitted.scope, 'uncommitted');
  assert.equal(uncommitted.fileCount, 1);
  assert.equal(uncommitted.files[0].path, 'app.txt');
});
