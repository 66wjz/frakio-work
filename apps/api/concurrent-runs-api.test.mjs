import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startFakeBridge(t) {
  let runSequence = 0;
  const server = net.createServer((socket) => {
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      const lineEnd = input.indexOf('\n');
      if (lineEnd < 0) return;
      const request = JSON.parse(input.slice(0, lineEnd));
      let response;
      if (request.action === 'ping') {
        response = { ok: true, broker: { pid: process.pid }, workers: {}, worker_details: {} };
      } else if (request.action === 'chat') {
        runSequence += 1;
        response = { ok: true, run_id: `fake-run-${runSequence}`, session_id: request.session_id, status: 'started' };
      } else if (request.action === 'get_output') {
        response = {
          ok: true,
          done: true,
          cursor: 1,
          event_cursor: 1,
          events: [{ event: 'run.completed', run_id: request.run_id, output: `reply for ${request.run_id}` }],
        };
      } else {
        response = { ok: false, error: `Unsupported fake action: ${request.action}` };
      }
      const delayMs = request.action === 'chat' ? 30 : request.action === 'get_output' ? 250 : 0;
      setTimeout(() => socket.end(`${JSON.stringify(response)}\n`), delayMs);
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return `tcp://127.0.0.1:${server.address().port}`;
}

test('two conversations can run concurrently without losing either thread state', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-concurrent-runs-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const profileHome = path.join(hermesHome, 'profiles', 'iris');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(profileHome, { recursive: true });
  await writeFile(path.join(profileHome, 'profile.yaml'), 'name: Iris\nrole: Test Agent\n');
  await writeFile(path.join(profileHome, 'config.yaml'), '{}\n');

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.HERMES_AGENT_BRIDGE_ENDPOINT = await startFakeBridge(t);
  process.env.PORT = '0';

  const module = await import(`./server.mjs?concurrent-runs=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };

  const importResponse = await fetch(`${baseUrl}/api/hermes-bootstrap/import`, { method: 'POST', headers });
  assert.equal(importResponse.status, 200);
  const modelResponse = await fetch(`${baseUrl}/api/models`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Local test model',
      provider: 'Local',
      kind: 'local',
      protocol: 'OpenAI Compatible',
      apiMode: 'chat_completions',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'test-model',
      models: ['test-model'],
    }),
  });
  assert.equal(modelResponse.status, 200);
  const model = (await modelResponse.json()).model;
  assert.equal((await fetch(`${baseUrl}/api/agents/iris`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ model: `${model.id}::test-model` }),
  })).status, 200);

  const conversationResponses = await Promise.all(['First', 'Second'].map((title) => fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, primaryAgentId: 'iris' }),
  })));
  assert.deepEqual(conversationResponses.map((response) => response.status), [200, 200]);
  const conversations = await Promise.all(conversationResponses.map((response) => response.json()));

  const runResponses = await Promise.all(conversations.map(({ thread }, index) => fetch(`${baseUrl}/api/threads/${thread.id}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: `task ${index + 1}`, turnId: `turn-${index + 1}`, targetAgentId: 'iris' }),
  })));
  assert.deepEqual(runResponses.map((response) => response.status), [202, 202], JSON.stringify(await Promise.all(runResponses.map((response) => response.clone().json().catch(() => ({}))))));
  const runs = await Promise.all(runResponses.map((response) => response.json()));

  for (const [index, { thread }] of conversations.entries()) {
    const runningThread = await fetch(`${baseUrl}/api/threads/${thread.id}`).then((response) => response.json());
    assert.equal(runningThread.thread.runStatus, 'running');
    const activeRun = await fetch(`${baseUrl}/api/threads/${thread.id}/runs/active`).then((response) => response.json());
    assert.equal(activeRun.threadId, thread.id);
    assert.equal(activeRun.run.runId, runs[index].hostRunId);
    assert.equal(activeRun.run.nativeRunId, runs[index].runId);
    assert.ok(['queued', 'running'].includes(activeRun.run.status));
  }

  const duplicateRunResponse = await fetch(`${baseUrl}/api/threads/${conversations[0].thread.id}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'duplicate task', turnId: 'turn-duplicate', targetAgentId: 'iris' }),
  });
  assert.equal(duplicateRunResponse.status, 409);
  const stillRunningThread = await fetch(`${baseUrl}/api/threads/${conversations[0].thread.id}`).then((response) => response.json());
  assert.equal(stillRunningThread.thread.runStatus, 'running');

  await Promise.all(runs.map((run, index) => fetch(`${baseUrl}/api/threads/${conversations[index].thread.id}/runs/${run.runId}/events?sessionId=${run.sessionId}`).then((response) => response.text())));

  for (const [index, { thread }] of conversations.entries()) {
    const completedThread = await fetch(`${baseUrl}/api/threads/${thread.id}`).then((response) => response.json());
    assert.equal(completedThread.thread.runStatus, 'idle');
    const completedMessage = completedThread.thread.messages.find((message) => message.content === `reply for ${runs[index].runId}`);
    assert.ok(completedMessage);
    assert.ok(completedMessage.processingDurationMs > 0);
    const reconciledRun = await fetch(`${baseUrl}/api/threads/${thread.id}/runs/active`).then((response) => response.json());
    assert.equal(reconciledRun.run.runId, runs[index].hostRunId);
    assert.equal(reconciledRun.run.status, 'completed');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stopResponse = await fetch(`${baseUrl}/api/threads/${thread.id}/runs/${runs[index].hostRunId}/stop`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: runs[index].sessionId }),
      });
      assert.equal(stopResponse.status, 202);
      const stopped = await stopResponse.json();
      assert.equal(stopped.resolved, true);
      assert.equal(stopped.alreadyTerminal, true);
      assert.equal(stopped.run.status, 'completed');
    }
  }
});
