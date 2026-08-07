import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startMentionBridge(t, profiles = {}) {
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
        const profile = profiles[request.profile] || {};
        runs.set(runId, { profile: request.profile, output: profile.output || (request.profile === 'iris' ? '@Victor 请接着说明。' : '收到，我是 Victor。'), delayPolls: Number(profile.delayPolls || 0), polls: 0 });
        response = { ok: true, run_id: runId, session_id: request.session_id, status: 'started' };
      } else if (request.action === 'get_output') {
        const run = runs.get(request.run_id);
        run.polls += 1;
        const output = run?.output || '';
        if (run.polls <= run.delayPolls) {
          response = { ok: true, run_id: request.run_id, status: 'running', done: false, cursor: 0, event_cursor: 0, delta: '', output: '', events: [], result: {} };
          socket.end(`${JSON.stringify(response)}\n`);
          return;
        }
        response = {
          ok: true,
          run_id: request.run_id,
          status: 'complete',
          done: true,
          cursor: output ? 1 : 0,
          event_cursor: 1,
          delta: '',
          output,
          events: [{ event: 'run.completed', run_id: request.run_id, output }],
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

test('Chat routes each mentioned Agent once, then permits one explicit structured re-entry', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-agent-mention-turn-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(path.join(home, 'data'), { recursive: true });
  for (const profile of ['iris', 'kai', 'victor', 'max']) {
    const profileHome = path.join(hermesHome, 'profiles', profile);
    await mkdir(profileHome, { recursive: true });
    await writeFile(path.join(profileHome, 'profile.yaml'), `name: ${profile[0].toUpperCase()}${profile.slice(1)}\nrole: Test Agent\n`);
    await writeFile(path.join(profileHome, 'config.yaml'), '{}\n');
  }

  const bridge = await startMentionBridge(t, {
    iris: { output: '@Kai @Victor @Max 请分别确认。' },
    kai: { output: 'Kai 已完成首次确认。' },
    victor: { output: 'Victor 已完成首次确认。' },
    max: { output: '@Kai @Victor 请再次确认。', delayPolls: 20 },
  });
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
  for (const agentId of ['iris', 'kai', 'victor', 'max']) {
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
      message: '请 Iris 让 Kai、Victor、Max 确认。',
      selectedAgents: ['iris'],
      targetAgentId: 'iris',
      turnId: 'turn-agent-mention',
    }),
  });
  assert.equal(rootResponse.status, 202, JSON.stringify(await rootResponse.clone().json().catch(() => ({}))));
  assert.equal((await rootResponse.json()).turnId, 'turn-agent-mention');

  const maxRunning = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/threads/${thread.id}`).then((item) => item.json());
    return response.thread.activeRunAgentId === 'max'
      && response.thread.messages.some((message) => message.agentId === 'kai')
      && response.thread.messages.some((message) => message.agentId === 'victor')
      ? response.thread
      : null;
  });
  assert.equal(maxRunning.messages.filter((message) => message.agentId === 'kai').length, 1);
  const rejectedHandoff = await fetch(`${baseUrl}/api/threads/${thread.id}/handoffs`, { method: 'POST', headers, body: JSON.stringify({ targetAgentId: 'kai', reason: '需要复核' }) });
  assert.equal(rejectedHandoff.status, 400);
  const handoff = { targetAgentId: 'kai', objective: '复核金沙洲坐标是否正确。', reason: 'Max 需要确认天气定位。' };
  assert.equal((await fetch(`${baseUrl}/api/threads/${thread.id}/handoffs`, { method: 'POST', headers, body: JSON.stringify(handoff) })).status, 202);
  assert.equal((await fetch(`${baseUrl}/api/threads/${thread.id}/handoffs`, { method: 'POST', headers, body: JSON.stringify(handoff) })).status, 202);

  const completed = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/threads/${thread.id}`).then((item) => item.json());
    return response.thread.runStatus === 'idle' && response.thread.messages.filter((message) => message.agentId === 'kai').length === 2 ? response.thread : null;
  });
  assert.deepEqual(bridge.chats.map((chat) => chat.profile), ['iris', 'kai', 'victor', 'max', 'kai']);
  assert.deepEqual(completed.selectedAgents.sort(), ['iris', 'kai', 'max', 'victor']);
  assert.equal(completed.messages.filter((message) => message.agentId === 'user').length, 1);
  assert.equal(completed.messages.some((message) => message.agentId === 'user' && message.content.startsWith('群聊系统：')), false);
  assert.equal(completed.messages.filter((message) => message.agentId === 'victor').length, 1);
  assert.equal(completed.messages.filter((message) => message.agentId === 'max').length, 1);
  assert.equal(completed.messages.filter((message) => message.agentId === 'kai').length, 2);
  const iris = completed.messages.find((message) => message.agentId === 'iris');
  const max = completed.messages.find((message) => message.agentId === 'max');
  const kaiReplies = completed.messages.filter((message) => message.agentId === 'kai');
  assert.equal(iris.handoffs.length, 3);
  assert.equal(max.handoffs.filter((item) => item.targetAgentId === 'kai').length, 1);
  assert.equal(kaiReplies[1].parentMessageId, max.id);
  assert.equal(kaiReplies[1].routeReason, 'structured_handoff');
  assert.equal(kaiReplies[1].handoff.objective, handoff.objective);
  assert.equal(completed.activeRunGroup.routes.filter((route) => route.targetAgentId === 'kai').length, 2);
  assert.equal(completed.activeRunGroup.routes.filter((route) => route.reason === 'structured_handoff').length, 1);
  assert.equal(completed.runStatus, 'idle');

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(bridge.chats.map((chat) => chat.profile), ['iris', 'kai', 'victor', 'max', 'kai']);

  const eventText = await fetch(`${baseUrl}/api/threads/${thread.id}/turns/turn-agent-mention/events`, {
    headers: { cookie },
  }).then((response) => response.text());
  const events = eventText
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  assert.equal(events.filter((event) => event.event === 'run.started').length, 5);
  assert.equal(events.filter((event) => event.event === 'run.completed').length, 5);
  assert.equal(events.filter((event) => event.event === 'turn.completed').length, 1);
  assert.deepEqual(events.filter((event) => event.event === 'run.started').map((event) => event.agentId), ['iris', 'kai', 'victor', 'max', 'kai']);

  const finalCursor = Math.max(...events.map((event) => Number(event.cursor || 0)));
  const replayAfterCompletion = await fetch(`${baseUrl}/api/threads/${thread.id}/turns/turn-agent-mention/events?cursor=${finalCursor}`, {
    headers: { cookie },
  });
  assert.equal(replayAfterCompletion.status, 200);
  assert.equal(await replayAfterCompletion.text(), '');
});
