import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const fakeHermesSource = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.FAKE_HERMES_STATE;
const args = process.argv.slice(2);
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { boards: { default: { tasks: {}, links: [], comments: {} } } };
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const boardIndex = args.indexOf('--board');
const board = boardIndex >= 0 ? args[boardIndex + 1] : 'default';
const clean = boardIndex >= 0 ? [...args.slice(0, boardIndex), ...args.slice(boardIndex + 2)] : args;
const actionIndex = clean.indexOf('kanban') + 1;
const command = clean[actionIndex];
const rest = clean.slice(actionIndex + 1);
if (command === 'boards') {
  if (rest[0] === 'list') console.log(JSON.stringify(Object.keys(state.boards).map(slug => ({ slug, name: slug, archived: false, total: Object.keys(state.boards[slug].tasks).length }))));
  else if (rest[0] === 'create') { state.boards[rest[1]] = state.boards[rest[1]] || { tasks: {}, links: [], comments: {} }; save(); }
  else if (rest[0] === 'rm') { state.boards[rest[1]].archived = true; save(); }
  process.exit(0);
}
const store = state.boards[board] || (state.boards[board] = { tasks: {}, links: [], comments: {} });
if (command === 'create') {
  const idemAt = rest.indexOf('--idempotency-key');
  const idem = idemAt >= 0 ? rest[idemAt + 1] : '';
  let task = Object.values(store.tasks).find(item => idem && item.idempotency_key === idem);
  if (!task) {
    const id = 'task-' + (Object.keys(store.tasks).length + 1);
    const value = flag => { const at = rest.indexOf(flag); return at >= 0 ? rest[at + 1] : null; };
    task = { id, title: rest[0], body: value('--body'), assignee: value('--assignee'), status: rest.includes('--triage') ? 'triage' : 'ready', priority: 0, idempotency_key: idem, created_at: Math.floor(Date.now() / 1000) };
    store.tasks[id] = task; save();
  }
  console.log(JSON.stringify(task)); process.exit(0);
}
if (command === 'list') { console.log(JSON.stringify(Object.values(store.tasks))); process.exit(0); }
if (command === 'show') {
  const task = store.tasks[rest[0]];
  console.log(JSON.stringify({ task, parents: store.links.filter(link => link[1] === task.id).map(link => link[0]), children: store.links.filter(link => link[0] === task.id).map(link => link[1]), comments: store.comments[task.id] || [], runs: [] })); process.exit(0);
}
if (command === 'link') { if (!store.links.some(link => link[0] === rest[0] && link[1] === rest[1])) store.links.push([rest[0], rest[1]]); save(); process.exit(0); }
if (command === 'block') { const task = store.tasks[rest[0]]; task.status = rest.includes('dependency') ? 'todo' : 'blocked'; save(); process.exit(0); }
if (command === 'unblock') { const taskId = rest.at(-1); store.tasks[taskId].status = 'ready'; save(); process.exit(0); }
if (command === 'reclaim') { store.tasks[rest[0]].status = 'ready'; save(); process.exit(0); }
if (command === 'archive') { store.tasks[rest[0]].status = 'archived'; save(); process.exit(0); }
if (command === 'dispatch') { console.log(JSON.stringify({ dispatched: [] })); process.exit(0); }
if (command === 'comment') { (store.comments[rest[0]] ||= []).push({ id: Date.now(), author: 'user', body: rest[1], created_at: Math.floor(Date.now() / 1000) }); save(); process.exit(0); }
if (command === 'complete') { store.tasks[rest[0]].status = 'done'; store.tasks[rest[0]].result = rest[rest.indexOf('--summary') + 1]; save(); process.exit(0); }
console.error('unsupported fake Hermes command: ' + args.join(' ')); process.exit(2);
`;

async function startTestApp(t, options = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-collaboration-api-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const hermesBin = path.join(parent, 'fake-hermes.cjs');
  const fakeState = path.join(parent, 'fake-hermes.json');
  await mkdir(home, { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  if (options.agents?.length) {
    await mkdir(path.join(home, 'data'), { recursive: true });
    await writeFile(path.join(home, 'data', 'workbench-state.json'), JSON.stringify({ ui: { defaultAgentId: options.agents[0].id }, agents: options.agents }));
    for (const agent of options.agents) {
      const profileDir = path.join(hermesHome, 'profiles', agent.profileName || agent.id);
      await mkdir(profileDir, { recursive: true });
      await writeFile(path.join(profileDir, 'config.yaml'), '{}\n');
    }
  }
  await writeFile(hermesBin, fakeHermesSource);
  await chmod(hermesBin, 0o755);
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.HERMES_BIN = hermesBin;
  process.env.FAKE_HERMES_STATE = fakeState;
  process.env.PORT = '0';
  const previousSkipRuntimeCheck = process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK;
  process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = '1';
  const module = await import(`./server.mjs?collaboration-api=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.close();
    if (previousSkipRuntimeCheck === undefined) delete process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK;
    else process.env.FRAKIO_WORK_SKIP_MCP_RUNTIME_CHECK = previousSkipRuntimeCheck;
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  return { baseUrl, headers: { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' } };
}

test('threads default to Chat and entering Work atomically creates a reusable workflow', async t => {
  const ctx = await startTestApp(t);
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Campaign work' }) }).then(res => res.json());
  assert.equal(created.thread.executionMode, 'chat');
  assert.equal(created.thread.workerOutputMode, 'summary');

  const switched = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work' }) });
  assert.equal(switched.status, 200);
  const work = await switched.json();
  assert.equal(work.thread.executionMode, 'work');
  assert.equal(work.snapshot.workflows.length, 1);
  assert.equal(work.snapshot.workflows[0].tasks.length, 0);
  assert.equal(work.capability.protocolVersion, 2);

  const chat = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'chat' }) }).then(res => res.json());
  assert.equal(chat.thread.executionMode, 'chat');
  const resumed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work' }) }).then(res => res.json());
  assert.equal(resumed.snapshot.workflows.length, 1);
  assert.equal(resumed.workflow.id, work.workflow.id);
});

test('a new Work conversation creates its workflow during conversation creation', async t => {
  const agents = [{ id: 'coord-new', name: 'New Coordinator', role: 'Coordinator', profileName: 'coord-new', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const response = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ title: 'New Work', executionMode: 'work', coordinatorAgentId: 'coord-new', primaryAgentId: 'coord-new', requestId: 'new-work-once' }),
  });
  const created = await response.json();
  assert.equal(response.status, 200, JSON.stringify(created));
  assert.equal(created.thread.executionMode, 'work');
  assert.equal(created.workflow.coordinatorAgentId, 'coord-new');
  assert.equal(created.snapshot.workflows.length, 1);
  assert.equal(created.snapshot.workflows[0].tasks.length, 0);
  assert.equal(created.capability.protocolVersion, 2);
});

test('a structured plan creates visible tasks and dependencies with revision control', async t => {
  const agents = [
    { id: 'coord-test', name: 'Coordinator Test', role: 'Coordinator', profileName: 'coord-test', source: 'hermes-profile' },
    { id: 'copy-test', name: 'Copy Test', role: 'Marketing', profileName: 'copy-test', source: 'hermes-profile' },
  ];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Launch campaign' }) }).then(res => res.json());
  const switchedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work', agentId: 'coord-test' }) });
  const switched = await switchedResponse.json();
  assert.equal(switchedResponse.status, 200, JSON.stringify(switched));
  const root = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/roots`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: switched.workflow.id, title: 'Write campaign', assigneeAgentId: 'coord-test', idempotencyKey: 'root-plan' }) }).then(res => res.json());
  const publish = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/plans`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({
    workflowId: switched.workflow.id,
    rootTaskId: root.task.id,
    baseRevision: 0,
    goal: 'Publish a campaign',
    summary: 'Research first, then write copy',
    idempotencyKey: 'plan-v1',
    tasks: [
      { key: 'research', title: 'Research competitors', assigneeAgentId: 'coord-test', dependsOnKeys: [] },
      { key: 'copy', title: 'Write launch copy', assigneeAgentId: 'copy-test', dependsOnKeys: ['research'] },
    ],
  }) });
  assert.equal(publish.status, 200);
  const plan = await publish.json();
  assert.equal(plan.planRevision, 1);
  assert.deepEqual(plan.diff.added, ['research', 'copy']);
  assert.equal(plan.event.type, 'plan.published');
  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.workflows[0].tasks.length, 3);
  assert.equal(snapshot.snapshot.workflows[0].plan.tasks.length, 2);
  assert.ok(snapshot.snapshot.events.some(event => event.type === 'dependency.created'));

  const conflict = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/plans`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: switched.workflow.id, rootTaskId: root.task.id, baseRevision: 0, summary: 'stale', idempotencyKey: 'plan-stale', tasks: [{ key: 'copy', title: 'Write', assigneeAgentId: 'copy-test' }] }) });
  assert.equal(conflict.status, 409);
});

test('collaboration workflow, dependency request, and cursor replay are durable and idempotent', async t => {
  const ctx = await startTestApp(t);
  const conversationResponse = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Launch plan' }) });
  assert.equal(conversationResponse.status, 200);
  const { thread } = await conversationResponse.json();

  const workflowBody = { name: '新品发布', boardSlug: 'launch', idempotencyKey: 'workflow-once' };
  const firstWorkflow = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/workflows`, { method: 'POST', headers: ctx.headers, body: JSON.stringify(workflowBody) });
  assert.equal(firstWorkflow.status, 200);
  const workflow = await firstWorkflow.json();
  const replayWorkflow = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/workflows`, { method: 'POST', headers: ctx.headers, body: JSON.stringify(workflowBody) }).then(res => res.json());
  assert.equal(replayWorkflow.idempotent, true);
  assert.equal(replayWorkflow.workflow.id, workflow.workflow.id);

  const root = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/roots`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflow.id, title: '内容策略', idempotencyKey: 'root-once' }) }).then(res => res.json());
  assert.equal(root.task.id, 'task-1');
  const resolved = await fetch(`${ctx.baseUrl}/api/collaboration/resolve?taskId=${root.task.id}`).then(res => res.json());
  assert.equal(resolved.threadId, thread.id);
  assert.equal(resolved.workflowId, workflow.workflow.id);
  const dependencyBody = { workflowId: workflow.workflow.id, requesterTaskId: root.task.id, title: '竞品定价资料', reason: '等待竞品资料', idempotencyKey: 'dependency-once' };
  const dependency = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/dependencies`, { method: 'POST', headers: ctx.headers, body: JSON.stringify(dependencyBody) }).then(res => res.json());
  assert.equal(dependency.dependencyTask.id, 'task-2');
  const dependencyReplay = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/dependencies`, { method: 'POST', headers: ctx.headers, body: JSON.stringify(dependencyBody) }).then(res => res.json());
  assert.equal(dependencyReplay.idempotent, true);

  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.workflows[0].tasks.length, 2);
  assert.equal(snapshot.snapshot.workflows[0].tasks.find(task => task.id === 'task-1').status, 'todo');
  assert.deepEqual(snapshot.snapshot.events.map(event => event.cursor), [1, 2, 3, 4]);
  assert.equal(snapshot.snapshot.events[2].type, 'dependency.created');

  const completed = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/tasks/${dependency.dependencyTask.id}/complete`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflow.id, title: '竞品定价资料', summary: '三个竞品价格带已交付' }) });
  assert.equal(completed.status, 200);
  const afterComplete = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration`).then(res => res.json());
  assert.equal(afterComplete.snapshot.events.at(-2).type, 'task.completed');
  assert.equal(afterComplete.snapshot.events.at(-1).type, 'dependency.satisfied');

  const humanBlocker = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/blockers`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflow.id, taskId: root.task.id, kind: 'needs_input', evidence: '需要用户授权外部发布', requiresUserApproval: true, idempotencyKey: 'human-blocker-once' }) });
  assert.equal(humanBlocker.status, 200);
  const humanBlockerBody = await humanBlocker.json();
  assert.equal(humanBlockerBody.humanRequired, true);
  assert.equal(humanBlockerBody.event.type, 'human.required');

  const intervention = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/interventions`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflow.id, taskId: root.task.id, action: 'message', message: '已补充外部发布授权' }) });
  assert.equal(intervention.status, 200);
  const afterIntervention = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration`).then(res => res.json());
  assert.equal(afterIntervention.snapshot.workflows[0].tasks.find(task => task.id === root.task.id).status, 'ready');
  assert.equal(afterIntervention.snapshot.events.at(-2).type, 'task.resumed');
  assert.equal(afterIntervention.snapshot.events.at(-1).type, 'intervention.sent');
});

test('workflow pause, held steer, resume, and cancel preserve the collaboration graph', async t => {
  const agents = [{ id: 'pause-coordinator', name: 'Pause Coordinator', role: 'Coordinator', profileName: 'pause-coordinator', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Pause controls' }) }).then(res => res.json());
  const switched = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work', agentId: 'pause-coordinator' }) }).then(res => res.json());
  const root = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/roots`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: switched.workflow.id, title: 'Root task', idempotencyKey: 'pause-root' }) }).then(res => res.json());
  const plan = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/plans`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({
    workflowId: switched.workflow.id,
    rootTaskId: root.task.id,
    baseRevision: 0,
    summary: 'One executable task',
    idempotencyKey: 'pause-plan',
    tasks: [{ key: 'worker', title: 'Worker task', assigneeAgentId: switched.workflow.coordinatorAgentId, dependsOnKeys: [] }],
  }) }).then(res => res.json());
  const workerTaskId = plan.plan.tasks[0].taskId;

  const pauseBody = JSON.stringify({ idempotencyKey: 'pause-once' });
  const pausedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${switched.workflow.id}/pause`, { method: 'POST', headers: ctx.headers, body: pauseBody });
  const paused = await pausedResponse.json();
  assert.equal(pausedResponse.status, 200, JSON.stringify(paused));
  assert.equal(paused.workflow.status, 'paused');
  assert.equal(paused.blockedTasks, 1);
  assert.equal(paused.snapshot.workflows[0].tasks.find(task => task.id === workerTaskId).status, 'blocked');
  assert.ok(paused.snapshot.events.some(event => event.type === 'workflow.paused'));

  const replay = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${switched.workflow.id}/pause`, { method: 'POST', headers: ctx.headers, body: pauseBody }).then(res => res.json());
  assert.equal(replay.idempotent, true);
  assert.equal(replay.operationId, paused.operationId);

  const held = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/interventions`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: switched.workflow.id, taskId: root.task.id, action: 'steer', message: '恢复后调整标题', idempotencyKey: 'held-steer' }) }).then(res => res.json());
  assert.equal(held.queueStatus, 'held');

  const resumedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${switched.workflow.id}/resume`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'resume-once' }) });
  const resumed = await resumedResponse.json();
  assert.equal(resumedResponse.status, 200, JSON.stringify(resumed));
  assert.equal(resumed.workflow.status, 'active');
  assert.equal(resumed.heldInterventions, 1);
  assert.equal(resumed.snapshot.workflows[0].tasks.find(task => task.id === workerTaskId).status, 'ready');

  const cancelledResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${switched.workflow.id}/cancel`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'cancel-once' }) });
  const cancelled = await cancelledResponse.json();
  assert.equal(cancelledResponse.status, 200, JSON.stringify(cancelled));
  assert.equal(cancelled.workflow.status, 'cancelled');
  assert.equal(cancelled.snapshot.workflows[0].tasks.find(task => task.id === workerTaskId).status, 'archived');
  assert.ok(cancelled.snapshot.events.some(event => event.type === 'workflow.cancelled'));

  const rejectedResume = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${switched.workflow.id}/resume`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'resume-after-cancel' }) });
  assert.equal(rejectedResume.status, 409);
});
