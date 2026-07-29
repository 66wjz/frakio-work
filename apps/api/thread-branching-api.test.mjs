import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('thread branches include the selected Agent reply and persist independent feedback and attachments', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-thread-branch-'));
  const home = path.join(parent, '.frakio-work');
  const dataRoot = path.join(home, 'data');
  const attachmentId = randomUUID();
  const attachmentDir = path.join(home, 'attachments', attachmentId);
  const createdAt = new Date().toISOString();
  await mkdir(dataRoot, { recursive: true });
  await mkdir(attachmentDir, { recursive: true });
  await writeFile(path.join(attachmentDir, 'content.md'), '# Source attachment');
  await writeFile(path.join(attachmentDir, 'metadata.json'), `${JSON.stringify({
    id: attachmentId,
    name: 'source.md',
    storedName: 'content.md',
    mimeType: 'text/markdown',
    size: Buffer.byteLength('# Source attachment'),
    kind: 'text',
    createdAt,
    claimedAt: createdAt,
    threadId: 'thread-root',
    messageId: 'message-agent-1',
  }, null, 2)}\n`);
  await writeFile(path.join(dataRoot, 'workbench-state.json'), JSON.stringify({
    ui: { defaultAgentId: 'iris' },
    agents: [{ id: 'iris', name: 'Iris', role: 'Assistant', profileName: 'iris', source: 'hermes-profile' }],
    threads: [{
      id: 'thread-root',
      title: '分支测试',
      mode: 'direct',
      executionMode: 'chat',
      primaryAgentId: 'iris',
      defaultAgentId: 'iris',
      activeAgentId: 'iris',
      selectedAgents: ['iris'],
      permissionMode: 'manual',
      externalSessionId: 'parent-hermes-session',
      agentSessionIds: { iris: 'parent-iris-session' },
      messages: [
        { id: 'message-intro', agentId: 'iris', agentName: 'Iris', role: 'Assistant', content: '已开启临时对话，当前默认 Agent 是 Iris。需要更多成员时，直接 @Agent。' },
        { id: 'message-user-1', agentId: 'user', agentName: '你', role: 'User', content: '第一问' },
        {
          id: 'message-agent-1',
          agentId: 'iris',
          agentName: 'Iris',
          role: 'Assistant',
          content: '第一答',
          parentMessageId: 'message-user-1',
          processingDurationMs: 22000,
          feedback: null,
          externalRunId: 'run-1',
          attachments: [{
            id: attachmentId,
            name: 'source.md',
            mimeType: 'text/markdown',
            size: Buffer.byteLength('# Source attachment'),
            kind: 'text',
            createdAt,
            contentUrl: `/api/attachments/${attachmentId}/content`,
          }],
        },
        { id: 'message-user-2', agentId: 'user', agentName: '你', role: 'User', content: '不能泄漏的后文' },
        { id: 'message-agent-2', agentId: 'iris', agentName: 'Iris', role: 'Assistant', content: '第二答', parentMessageId: 'message-user-2', processingDurationMs: 5000 },
        { id: 'message-agent-running', agentId: 'iris', agentName: 'Iris', role: 'Assistant', content: '仍在生成', externalRunId: 'run-running' },
      ],
      runTranscripts: [
        { runId: 'run-1', turnId: 'turn-1', messageId: 'message-agent-1', agentId: 'iris', status: 'completed', groups: [], createdAt, updatedAt: createdAt },
        { runId: 'run-running', turnId: 'turn-running', messageId: 'message-agent-running', agentId: 'iris', status: 'running', groups: [], createdAt, updatedAt: createdAt },
      ],
    }, {
      id: 'thread-legacy-intro',
      title: '旧开场消息',
      mode: 'direct',
      executionMode: 'chat',
      primaryAgentId: 'iris',
      defaultAgentId: 'iris',
      activeAgentId: 'iris',
      selectedAgents: ['iris'],
      messages: [
        { id: 'message-legacy-only', agentId: 'iris', agentName: 'Iris', role: 'Assistant', content: '已开启临时对话，当前默认 Agent 是 Iris。需要更多成员时，直接 @Agent。' },
      ],
    }],
  }));

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?thread-branch=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };

  const conversations = await fetch(`${baseUrl}/api/conversations`, { headers }).then((response) => response.json());
  assert.equal(conversations.conversations.find((conversation) => conversation.id === 'thread-legacy-intro').preview, '');

  const branchResponse = await fetch(`${baseUrl}/api/threads/thread-root/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messageId: 'message-agent-1' }),
  });
  const branch = await branchResponse.json();
  assert.equal(branchResponse.status, 201, JSON.stringify(branch));
  assert.equal(branch.thread.title, '分支测试 (2)');
  assert.equal(branch.thread.forkedFromThreadId, 'thread-root');
  assert.equal(branch.thread.forkedFromMessageId, 'message-agent-1');
  assert.equal(branch.thread.branchRootThreadId, 'thread-root');
  assert.equal(branch.thread.externalSessionId, null);
  assert.equal(branch.thread.agentSessionIds, undefined);
  assert.equal(branch.thread.activeRunId, undefined);
  assert.deepEqual(branch.thread.messages.map((message) => message.content), ['第一问', '第一答']);
  assert.ok(branch.thread.messages.every((message) => !['message-user-1', 'message-agent-1'].includes(message.id)));
  assert.equal(branch.thread.messages[1].parentMessageId, branch.thread.messages[0].id);
  assert.equal(branch.thread.messages[1].processingDurationMs, 22000);
  assert.equal(branch.thread.runTranscripts.length, 1);
  assert.equal(branch.thread.runTranscripts[0].messageId, branch.thread.messages[1].id);
  const clonedAttachment = branch.thread.messages[1].attachments[0];
  assert.notEqual(clonedAttachment.id, attachmentId);

  const feedbackResponse = await fetch(`${baseUrl}/api/threads/${branch.thread.id}/messages/${branch.thread.messages[1].id}/feedback`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ value: 'up' }),
  });
  assert.equal(feedbackResponse.status, 200);
  assert.equal((await feedbackResponse.json()).message.feedback, 'up');
  const refreshedBranch = await fetch(`${baseUrl}/api/threads/${branch.thread.id}`, { headers }).then((response) => response.json());
  assert.equal(refreshedBranch.thread.messages[1].feedback, 'up');

  const secondBranchResponse = await fetch(`${baseUrl}/api/threads/${branch.thread.id}/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messageId: branch.thread.messages[1].id }),
  });
  const secondBranch = await secondBranchResponse.json();
  assert.equal(secondBranchResponse.status, 201, JSON.stringify(secondBranch));
  assert.equal(secondBranch.thread.title, '分支测试 (3)');
  assert.equal(secondBranch.thread.branchRootThreadId, 'thread-root');

  const userBranchResponse = await fetch(`${baseUrl}/api/threads/thread-root/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messageId: 'message-user-1' }),
  });
  assert.equal(userBranchResponse.status, 400);
  const introBranchResponse = await fetch(`${baseUrl}/api/threads/thread-root/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messageId: 'message-intro' }),
  });
  assert.equal(introBranchResponse.status, 400);
  const runningBranchResponse = await fetch(`${baseUrl}/api/threads/thread-root/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messageId: 'message-agent-running' }),
  });
  assert.equal(runningBranchResponse.status, 409);

  const deleteSourceResponse = await fetch(`${baseUrl}/api/threads/thread-root`, { method: 'DELETE', headers });
  assert.equal(deleteSourceResponse.status, 200);
  const clonedContentResponse = await fetch(`${baseUrl}${clonedAttachment.contentUrl}`, { headers });
  assert.equal(clonedContentResponse.status, 200);
  assert.equal(await clonedContentResponse.text(), '# Source attachment');
});
