import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startMentionBridge(t) {
  const chats = [];
  let runSequence = 0;
  const runs = new Map();
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
        const runId = `mention-run-${runSequence}`;
        chats.push({ runId, profile: request.profile, message: request.message, sessionId: request.session_id });
        runs.set(runId, {
          profile: request.profile,
          output: request.profile === 'iris' ? '@Victor 请接着说明。' : '收到，我是 Victor。',
        });
        response = { ok: true, run_id: runId, session_id: request.session_id, status: 'started' };
      } else if (request.action === 'get_output') {
        const run = runs.get(request.run_id);
        const output = run?.output || '';
        const explicitCompletion = run?.profile === 'victor';
        response = {
          ok: true,
          run_id: request.run_id,
          status: 'complete',
          done: true,
          cursor: output ? 1 : 0,
          event_cursor: explicitCompletion ? 1 : 0,
          delta: explicitCompletion ? '' : output,
          output,
          events: explicitCompletion
            ? [{ event: 'run.completed', run_id: request.run_id, output }]
            : [],
          result: { final_response: output },
        };
      } else {
        response = { ok: false, error: `Unsupported fake action: ${request.action}` };
      }
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return { endpoint: `tcp://127.0.0.1:${server.address().port}`, chats };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for Agent mention turn.');
}

test('API owns Agent mention routing after the browser starts only the root run', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-agent-mention-turn-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(path.join(home, 'data'), { recursive: true });
  for (const profile of ['iris', 'victor']) {
    const profileHome = path.join(hermesHome, 'profiles', profile);
    await mkdir(profileHome, { recursive: true });
    await writeFile(path.join(profileHome, 'profile.yaml'), `name: ${profile === 'iris' ? 'Iris' : 'Victor'}\nrole: Test Agent\n`);
    await writeFile(path.join(profileHome, 'config.yaml'), '{}\n');
  }

  const bridge = await startMentionBridge(t);
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  process.env.HERMES_AGENT_BRIDGE_ENDPOINT = bridge.endpoint;
  process.env.PORT = '0';

  const module = await import(`./server.mjs?agent-mention-turn=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };
  assert.equal((await fetch(`${baseUrl}/api/hermes-bootstrap/import`, { method: 'POST', headers })).status, 200);
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
  for (const agentId of ['iris', 'victor']) {
    assert.equal((await fetch(`${baseUrl}/api/agents/${agentId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ model: `${model.id}::test-model` }),
    })).status, 200);
  }
  const conversationResponse = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Mention routing', primaryAgentId: 'iris' }),
  });
  const { thread } = await conversationResponse.json();
  const rootResponse = await fetch(`${baseUrl}/api/threads/${thread.id}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: '请 Iris 转交 Victor 继续说明。',
      selectedAgents: ['iris'],
      targetAgentId: 'iris',
      turnId: 'turn-agent-mention',
    }),
  });
  assert.equal(rootResponse.status, 202, JSON.stringify(await rootResponse.clone().json().catch(() => ({}))));
  assert.equal((await rootResponse.json()).turnId, 'turn-agent-mention');

  const completed = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/threads/${thread.id}`).then((item) => item.json());
    return response.thread.runStatus === 'idle'
      && response.thread.messages.some((message) => message.agentId === 'victor')
      && response.thread.activeRunGroup?.routes?.[0]?.status === 'completed'
      ? response.thread
      : null;
  });
  assert.deepEqual(bridge.chats.map((chat) => chat.profile), ['iris', 'victor']);
  assert.deepEqual(completed.selectedAgents.sort(), ['iris', 'victor']);
  assert.equal(completed.messages.filter((message) => message.agentId === 'victor').length, 1);
  const iris = completed.messages.find((message) => message.agentId === 'iris');
  const victor = completed.messages.find((message) => message.agentId === 'victor');
  assert.equal(iris.content, '@Victor 请接着说明。');
  assert.equal(victor.parentMessageId, iris.id);
  assert.equal(victor.mentionDepth, 1);
  assert.equal(victor.routeReason, 'agent_mention');
  assert.equal(iris.handoffs.length, 1);
  assert.equal(iris.handoffs[0].targetAgentId, 'victor');
  assert.equal(iris.handoffs[0].status, 'completed');
  assert.equal(iris.handoffs[0].sourceMessageId, iris.id);
  assert.deepEqual(completed.activeRunGroup.routedEdges, ['iris->victor']);
  assert.equal(completed.activeRunGroup.routes[0].status, 'completed');
  assert.equal(completed.runStatus, 'idle');

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(bridge.chats.map((chat) => chat.profile), ['iris', 'victor']);

  const eventText = await fetch(`${baseUrl}/api/threads/${thread.id}/turns/turn-agent-mention/events`, {
    headers: { cookie },
  }).then((response) => response.text());
  const events = eventText
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  assert.equal(events.filter((event) => event.event === 'run.started').length, 2);
  assert.equal(events.filter((event) => event.event === 'run.completed').length, 2);
  assert.equal(events.filter((event) => event.event === 'turn.completed').length, 1);
  assert.deepEqual(events.filter((event) => event.event === 'run.started').map((event) => event.agentId), ['iris', 'victor']);

  const finalCursor = Math.max(...events.map((event) => Number(event.cursor || 0)));
  const replayAfterCompletion = await fetch(`${baseUrl}/api/threads/${thread.id}/turns/turn-agent-mention/events?cursor=${finalCursor}`, {
    headers: { cookie },
  });
  assert.equal(replayAfterCompletion.status, 200);
  assert.equal(await replayAfterCompletion.text(), '');
});
