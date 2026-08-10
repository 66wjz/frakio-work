import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntimeStore } from './runtime/store.mjs';

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
if (command === 'unlink') { store.links = store.links.filter(link => link[0] !== rest[0] || link[1] !== rest[1]); save(); process.exit(0); }
if (command === 'reassign') { store.tasks[rest[0]].assignee = rest[1]; store.tasks[rest[0]].status = 'ready'; save(); process.exit(0); }
if (command === 'block') { const task = store.tasks[rest[0]]; task.status = rest.includes('dependency') ? 'todo' : 'blocked'; save(); process.exit(0); }
if (command === 'unblock') { const taskId = rest.at(-1); store.tasks[taskId].status = 'ready'; save(); process.exit(0); }
if (command === 'reclaim') { store.tasks[rest[0]].status = 'ready'; save(); process.exit(0); }
if (command === 'archive') { store.tasks[rest[0]].status = 'archived'; save(); process.exit(0); }
if (command === 'dispatch') { console.log(JSON.stringify({ dispatched: [] })); process.exit(0); }
if (command === 'comment') { (store.comments[rest[0]] ||= []).push({ id: Date.now(), author: 'user', body: rest[1], created_at: Math.floor(Date.now() / 1000) }); save(); process.exit(0); }
if (command === 'attach') { (store.attachments ||= {})[rest[0]] = [...(store.attachments?.[rest[0]] || []), rest[1]]; save(); process.exit(0); }
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
  return {
    baseUrl,
    databasePath: path.join(home, 'data', 'frakio.db'),
    module,
    headers: { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' },
  };
}

async function createConfirmedNativeWorkflow(ctx, suffix, agentId = ctx.agentId) {
  const createdResponse = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      title: `Native workflow ${suffix}`,
      primaryAgentId: agentId,
      coordinatorAgentId: agentId,
      messageIntent: 'collaboration',
    }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  const planId = created.thread.activePlanId;
  const submittedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      baseRevision: 0,
      title: `Native plan ${suffix}`,
      summary: '执行一个可审计的原生协作任务。',
      idempotencyKey: `native-plan-${suffix}`,
      steps: [{
        key: 'worker',
        title: '执行任务',
        description: '完成任务并提交结果。',
        files: [],
        assigneeAgentId: agentId,
        expectedResult: '可验收结果',
        dependsOnKeys: [],
      }],
      tests: [],
      assumptions: [],
    }),
  });
  assert.equal(submittedResponse.status, 200, await submittedResponse.text());
  const proposalSnapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then((response) => response.json());
  const proposal = proposalSnapshot.snapshot.proposals[0];
  const confirmedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/proposals/${proposal.id}/confirm`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ revision: proposal.revision, confirmedBy: 'user' }),
  });
  const confirmed = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 200, JSON.stringify(confirmed));
  return {
    threadId: created.thread.id,
    workflowId: confirmed.workflow.id,
    taskId: confirmed.workflow.plan.tasks[0].taskId,
    agentId,
  };
}

function seedBoundRuntimeRun(ctx, workflow, { cancellation = true, runtimeId = 'hermes' } = {}) {
  const store = createRuntimeStore(ctx.databasePath);
  const claimed = store.claimWorkTask(workflow.taskId);
  assert.ok(claimed?.leaseToken);
  const session = store.upsertSession({
    runtimeId,
    threadId: workflow.threadId,
    agentId: claimed.assigneeAgentId,
    workspaceId: '',
    laneType: 'work_task',
    laneId: claimed.id,
    status: 'active',
    lifecycleState: 'active',
    capabilitySnapshot: { capabilities: { cancellation } },
  });
  const run = store.createRun({
    sessionId: session.id,
    runtimeId,
    threadId: workflow.threadId,
    agentId: claimed.assigneeAgentId,
    turnId: `turn-${workflow.taskId}`,
    status: 'running',
    metadata: {
      taskId: claimed.id,
      workflowId: workflow.workflowId,
      leaseToken: claimed.leaseToken,
      taskDispatch: true,
    },
  });
  store.bindTaskRun({ taskId: claimed.id, runId: run.id, leaseToken: claimed.leaseToken });
  store.close();
  return { run, task: claimed };
}

test('native approval events move a bound Task through waiting_input and back to running', async t => {
  const agents = [{ id: 'approval-agent', name: 'Approval Agent', role: 'Worker', profileName: 'approval-agent', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'approval', agents[0].id);
  const bound = seedBoundRuntimeRun(ctx, workflow, { runtimeId: 'pi' });

  await ctx.module.processCanonicalRuntimeEvent(bound.run.id, {
    type: 'approval.requested',
    approvalId: 'approval-1',
    title: '请确认执行命令',
    command: 'echo approval-test',
    nativeEventKey: 'approval-request-1',
  });
  const waitingStore = createRuntimeStore(ctx.databasePath);
  assert.equal(waitingStore.getWorkTask(bound.task.id).status, 'waiting_input');
  waitingStore.close();

  await ctx.module.processCanonicalRuntimeEvent(bound.run.id, {
    type: 'approval.resolved',
    approvalId: 'approval-1',
    decision: 'approve_once',
    nativeEventKey: 'approval-resolved-1',
  });
  const resumedStore = createRuntimeStore(ctx.databasePath);
  assert.equal(resumedStore.getWorkTask(bound.task.id).status, 'running');
  resumedStore.close();

  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  assert.ok(snapshot.snapshot.events.some((event) => event.type === 'human.required' && event.taskId === bound.task.id));
  assert.ok(snapshot.snapshot.events.some((event) => event.type === 'task.resumed' && event.taskId === bound.task.id));
});

test('a bound Runtime completion updates the Task and thread projection exactly once', async t => {
  const agents = [{ id: 'complete-agent', name: 'Complete Agent', role: 'Worker', profileName: 'complete-agent', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'complete', agents[0].id);
  const bound = seedBoundRuntimeRun(ctx, workflow, { runtimeId: 'pi' });

  await ctx.module.processCanonicalRuntimeEvent(bound.run.id, {
    type: 'run.completed',
    nativeEventKey: 'bound-completion-1',
    payload: { output: '可验收的原生 Runtime 交付。' },
  });
  const firstSnapshot = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  const secondSnapshot = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  const completedTask = firstSnapshot.snapshot.workflows[0].tasks.find((task) => task.id === bound.task.id);
  assert.equal(completedTask.status, 'completed');
  const completedEvents = secondSnapshot.snapshot.events.filter((event) => event.type === 'task.completed' && event.taskId === bound.task.id);
  assert.equal(completedEvents.length, 1);
  assert.equal(completedEvents[0].runId, bound.run.id);
  const thread = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`).then((response) => response.json());
  const projected = thread.thread.collaboration.workflows.find((item) => item.id === workflow.workflowId).taskStatusProjection[bound.task.id];
  assert.equal(projected.status, 'completed');
});

test('unsupported cancellation exposes pending runs and blocks resume until the native terminal event', async t => {
  const agents = [{ id: 'cancel-agent', name: 'Cancel Agent', role: 'Worker', profileName: 'cancel-agent', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'cancel', agents[0].id);
  const bound = seedBoundRuntimeRun(ctx, workflow, { cancellation: false });

  const pausedResponse = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/pause`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ idempotencyKey: 'unsupported-pause' }),
  });
  const paused = await pausedResponse.json();
  assert.equal(pausedResponse.status, 200, JSON.stringify(paused));
  assert.deepEqual(paused.pendingRunIds, [bound.run.id]);
  assert.deepEqual(paused.deferredRunIds, [bound.run.id]);
  assert.equal(paused.stoppedRuns, 0);

  const rejectedResume = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/resume`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ idempotencyKey: 'unsupported-resume-before-terminal' }),
  });
  const rejectedBody = await rejectedResume.json();
  assert.equal(rejectedResume.status, 409);
  assert.equal(rejectedBody.code, 'WORKFLOW_RUNS_STILL_STOPPING');
  assert.deepEqual(rejectedBody.details.runIds, [bound.run.id]);

  await ctx.module.processCanonicalRuntimeEvent(bound.run.id, {
    type: 'run.completed',
    nativeEventKey: 'unsupported-terminal-1',
    payload: { summary: '原生 Runtime 已自然结束' },
  });
  const resumedResponse = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/resume`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ idempotencyKey: 'unsupported-resume-after-terminal' }),
  });
  const resumed = await resumedResponse.json();
  assert.equal(resumedResponse.status, 200, JSON.stringify(resumed));
  assert.equal(resumed.workflow.status, 'active');
});

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
  assert.equal(work.capability.protocolVersion, 3);

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
  assert.equal(created.capability.protocolVersion, 3);
});

test('Chat Plan persists structured questions, revisions, and cancellation without changing execution mode', async t => {
  const agents = [{ id: 'plan-chat-agent', name: 'Plan Chat Agent', role: 'Engineer', profileName: 'plan-chat-agent', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const createdResponse = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ title: 'Chat Plan', primaryAgentId: 'plan-chat-agent', collaborationMode: 'plan' }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  assert.equal(created.thread.executionMode, 'chat');
  assert.equal(created.thread.collaborationMode, 'plan');
  assert.ok(created.thread.activePlanId);
  const planId = created.thread.activePlanId;

  const lockedMode = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, {
    method: 'PATCH',
    headers: ctx.headers,
    body: JSON.stringify({ mode: 'work' }),
  });
  assert.equal(lockedMode.status, 409);

  const questionResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/questions`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      questions: [{
        id: 'scope',
        header: '范围',
        question: '首版覆盖到哪里？',
        options: [
          { label: '当前模块', description: '变更更小，先验证闭环。' },
          { label: '全部模块', description: '范围更广，回归成本更高。' },
        ],
      }],
    }),
  });
  const question = await questionResponse.json();
  assert.equal(questionResponse.status, 200, JSON.stringify(question));
  assert.equal(question.batch.status, 'pending');
  assert.equal(question.batch.questions[0].options[0].recommended, true);

  const answeredResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/questions/${question.batch.id}/answer`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ answers: { scope: { selectedLabel: '当前模块', note: '保留兼容性' } } }),
  });
  const answered = await answeredResponse.json();
  assert.equal(answeredResponse.status, 200, JSON.stringify(answered));
  assert.equal(answered.batch.status, 'resolved');

  const cancelledQuestionResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/questions`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      questions: [{
        id: 'cancel-scope',
        header: '取消范围',
        question: '是否继续补充？',
        options: [
          { label: '继续', description: '继续补充问题。' },
          { label: '停止', description: '返回计划草拟。', recommended: true },
        ],
      }],
    }),
  });
  const cancelledQuestion = await cancelledQuestionResponse.json();
  assert.equal(cancelledQuestionResponse.status, 200, JSON.stringify(cancelledQuestion));
  assert.equal(cancelledQuestion.batch.questions[0].options[1].recommended, true);

  const cancelQuestionResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/questions/${cancelledQuestion.batch.id}/cancel`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ source: 'test' }),
  });
  const cancelQuestion = await cancelQuestionResponse.json();
  assert.equal(cancelQuestionResponse.status, 200, JSON.stringify(cancelQuestion));
  assert.equal(cancelQuestion.batch.status, 'cancelled');
  assert.equal(cancelQuestion.plan.status, 'drafting');

  const cancelQuestionReplayResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/questions/${cancelledQuestion.batch.id}/cancel`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ source: 'test-replay' }),
  });
  const cancelQuestionReplay = await cancelQuestionReplayResponse.json();
  assert.equal(cancelQuestionReplayResponse.status, 200, JSON.stringify(cancelQuestionReplay));
  assert.equal(cancelQuestionReplay.batch.status, 'cancelled');

  const draftBody = {
    baseRevision: 0,
    title: '接入 Chat Plan',
    summary: '在当前模块增加只读规划与批准执行。',
    idempotencyKey: 'chat-plan-v1',
    steps: [{
      key: 'inspect',
      title: '检查现状',
      description: '读取现有实现并确认接入点。',
      files: ['apps/web/src/main.tsx'],
      expectedResult: '得到明确接入位置。',
      dependsOnKeys: [],
    }],
    tests: ['运行类型检查'],
    assumptions: ['保持现有权限模式'],
  };
  const submittedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify(draftBody),
  });
  const submitted = await submittedResponse.json();
  assert.equal(submittedResponse.status, 200, JSON.stringify(submitted));
  assert.equal(submitted.draft.revision, 1);
  assert.equal(submitted.plan.status, 'waiting_approval');

  const replay = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify(draftBody),
  }).then(res => res.json());
  assert.equal(replay.draft.revision, 1);

  const cancelled = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/cancel`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({}),
  }).then(res => res.json());
  assert.equal(cancelled.thread.collaborationMode, 'default');
  assert.equal(cancelled.plan.status, 'cancelled');
});

test('Work Plan keeps Kanban empty before approval and publishes the approved DAG once', async t => {
  const agents = [
    { id: 'plan-coord', name: 'Plan Coordinator', role: 'Coordinator', profileName: 'plan-coord', source: 'hermes-profile' },
    { id: 'plan-worker', name: 'Plan Worker', role: 'Engineer', profileName: 'plan-worker', source: 'hermes-profile' },
  ];
  const ctx = await startTestApp(t, { agents });
  const createdResponse = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      title: 'Work Plan',
      primaryAgentId: 'plan-coord',
      coordinatorAgentId: 'plan-coord',
      executionMode: 'work',
      collaborationMode: 'plan',
      requestId: 'work-plan-create',
    }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  assert.equal(created.snapshot.workflows[0].tasks.length, 0);
  const planId = created.thread.activePlanId;

  const submittedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      baseRevision: 0,
      title: '发布批准后的 DAG',
      summary: '先研究，再实现。',
      idempotencyKey: 'work-plan-v1',
      steps: [
        { key: 'research', title: '研究', description: '读取现状。', files: [], assigneeAgentId: 'plan-coord', expectedResult: '研究结论', dependsOnKeys: [] },
        { key: 'implement', title: '实现', description: '按结论实现。', files: [], assigneeAgentId: 'plan-worker', expectedResult: '可运行实现', dependsOnKeys: ['research'] },
      ],
      tests: ['运行回归测试'],
      assumptions: [],
    }),
  });
  const submitted = await submittedResponse.json();
  assert.equal(submittedResponse.status, 200, JSON.stringify(submitted));
  const beforeApproval = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(beforeApproval.snapshot.workflows[0].tasks.length, 0);

  const executedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/execute`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({}),
  });
  const executed = await executedResponse.json();
  assert.equal(executedResponse.status, 200, JSON.stringify(executed));
  assert.equal(executed.kind, 'work-dispatch');
  assert.equal(executed.plan.status, 'executing');
  assert.equal(executed.snapshot.workflows[0].tasks.length, 3);
  assert.equal(executed.snapshot.workflows[0].plan.tasks.length, 2);
  assert.ok(executed.snapshot.events.some(event => event.type === 'dependency.created'));
});

test('collaboration intent creates a proposal without a Workflow and starts collaboration only after confirmation', async t => {
  const agents = [
    { id: 'collab-coord', name: 'Collab Coordinator', role: 'Coordinator', profileName: 'collab-coord', source: 'hermes-profile' },
    { id: 'collab-worker', name: 'Collab Worker', role: 'Writer', profileName: 'collab-worker', source: 'hermes-profile' },
  ];
  const ctx = await startTestApp(t, { agents });
  const createdResponse = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ title: 'Collaboration proposal', primaryAgentId: 'collab-coord', coordinatorAgentId: 'collab-coord', messageIntent: 'collaboration' }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  assert.equal(created.thread.executionMode, 'chat');
  assert.equal(created.thread.collaborationMode, 'collaboration');
  assert.equal(created.thread.planSessions[0].purpose, 'collaboration');
  assert.equal(created.thread.planSessions[0].targetExecutionMode, 'collaboration');
  const before = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(before.snapshot.workflows.length, 0);
  assert.equal(before.snapshot.proposals.length, 1);
  assert.equal(before.snapshot.proposals[0].status, 'pending_confirmation');

  const planId = created.thread.activePlanId;
  const submittedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({
      baseRevision: 0,
      title: '宣传稿协作',
      summary: '研究后完成宣传稿。',
      idempotencyKey: 'collaboration-proposal-v1',
      steps: [
        { key: 'research', title: '研究定位', description: '整理事实。', files: [], assigneeAgentId: 'collab-coord', expectedResult: '事实清单', dependsOnKeys: [] },
        { key: 'write', title: '撰写正文', description: '完成宣传稿。', files: [], assigneeAgentId: 'collab-worker', expectedResult: '宣传稿', dependsOnKeys: ['research'] },
      ],
      tests: ['确认事实口径'], assumptions: [],
    }),
  });
  const submitted = await submittedResponse.json();
  assert.equal(submittedResponse.status, 200, JSON.stringify(submitted));
  assert.ok(submitted.proposal.proposalMessageId);
  const submittedThread = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}`).then(res => res.json());
  const collaborationMessages = submittedThread.thread.messages.filter(message => message.contentType === 'collaboration_plan_response' && message.planId === planId && message.planRevision === 1);
  assert.equal(collaborationMessages.length, 1);
  assert.equal(collaborationMessages[0].content, '我整理成了 2 个协作步骤，请确认后开始执行。');
  assert.equal(collaborationMessages[0].agentId, 'collab-coord');
  assert.equal(collaborationMessages[0].id, submitted.proposal.proposalMessageId);
  assert.equal(submittedThread.thread.messages.filter(message => message.contentType === 'collaboration_plan_intro' && message.planIntroForId === planId).length, 0);
  const replaySubmit = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({
      baseRevision: 0,
      title: '宣传稿协作',
      summary: '研究后完成宣传稿。',
      idempotencyKey: 'collaboration-proposal-v1',
      steps: [
        { key: 'research', title: '研究定位', description: '整理事实。', files: [], assigneeAgentId: 'collab-coord', expectedResult: '事实清单', dependsOnKeys: [] },
        { key: 'write', title: '撰写正文', description: '完成宣传稿。', files: [], assigneeAgentId: 'collab-worker', expectedResult: '宣传稿', dependsOnKeys: ['research'] },
      ],
      tests: ['确认事实口径'], assumptions: [],
    }),
  });
  assert.equal(replaySubmit.status, 200, await replaySubmit.text());
  const replayThread = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}`).then(res => res.json());
  assert.equal(replayThread.thread.messages.filter(message => message.contentType === 'collaboration_plan_response' && message.planId === planId && message.planRevision === 1).length, 1);
  assert.equal(replayThread.thread.messages.filter(message => message.contentType === 'collaboration_plan_intro' && message.planIntroForId === planId).length, 0);
  const stillBefore = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(stillBefore.snapshot.workflows.length, 0);
  assert.equal(stillBefore.snapshot.proposals[0].revision, 1);
  assert.equal(stillBefore.snapshot.proposals[0].proposalMessageId, submitted.proposal.proposalMessageId);

  const proposalId = stillBefore.snapshot.proposals[0].id;
  const confirmed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/proposals/${proposalId}/confirm`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ revision: 1, confirmedBy: 'user' }),
  }).then(res => res.json());
  assert.equal(confirmed.proposal.status, 'confirmed');
  assert.ok(confirmed.proposal.workflowId);
  assert.equal(confirmed.workflow.nativeOnly, true);
  assert.equal(confirmed.snapshot.workflows.length, 1);
  assert.equal(confirmed.snapshot.workflows[0].tasks.length, 3);
  const waitingTask = confirmed.snapshot.workflows[0].tasks.find((task) => task.id === confirmed.workflow.plan.tasks.find((task) => task.key === 'write').taskId);
  assert.equal(waitingTask.activity.phase, 'waiting_dependency');
  assert.deepEqual(waitingTask.activity.upstreamAgentNames, ['Collab Coordinator']);
  assert.ok(waitingTask.activity.waitingSince);
  const publishedEvent = confirmed.snapshot.events.find(event => event.type === 'plan.published');
  assert.equal(publishedEvent.title, '协作方案已确认');
  assert.deepEqual(publishedEvent.payload.agentIds.sort(), ['collab-coord', 'collab-worker']);
  const replayConfirmation = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/proposals/${proposalId}/confirm`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ revision: 1, confirmedBy: 'user' }),
  }).then(res => res.json());
  assert.equal(replayConfirmation.proposal.status, 'confirmed');

  const executedResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/execute`, { method: 'POST', headers: ctx.headers, body: '{}' });
  const executed = await executedResponse.json();
  assert.equal(executedResponse.status, 200, JSON.stringify(executed));
  assert.equal(executed.kind, 'work-dispatch');
  assert.equal(executed.snapshot.workflows.length, 1);
  assert.equal(executed.snapshot.workflows[0].tasks.length, 3);
  assert.equal(executed.workflow.nativeOnly, true);
  assert.equal(executed.workflow.boardSlug, '');
  assert.equal(executed.dispatch.scheduler, 'frakio');
  assert.equal(executed.snapshot.proposals[0].workflowId, executed.workflow.id);

  const revisionStartResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration-mode`, {
    method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'collaboration', purpose: 'collaboration', authorAgentId: 'collab-coord' }),
  });
  const revisionStart = await revisionStartResponse.json();
  assert.equal(revisionStartResponse.status, 200, JSON.stringify(revisionStart));
  assert.equal(revisionStart.thread.collaborationMode, 'collaboration');
  assert.equal(revisionStart.plan.workflowId, executed.workflow.id);
  await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${revisionStart.plan.id}/submit`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({
      baseRevision: 0, title: '宣传稿协作修订', summary: '增加终审。', idempotencyKey: 'collaboration-revision-v2',
      steps: [
        { key: 'research', title: '研究定位', description: '补充事实。', files: [], assigneeAgentId: 'collab-coord', expectedResult: '事实清单', dependsOnKeys: [] },
        { key: 'write', title: '撰写正文', description: '完成宣传稿。', files: [], assigneeAgentId: 'collab-worker', expectedResult: '宣传稿', dependsOnKeys: ['research'] },
        { key: 'review', title: '终审', description: '检查最终口径。', files: [], assigneeAgentId: 'collab-coord', expectedResult: '终稿', dependsOnKeys: ['write'] },
      ], tests: [], assumptions: [],
    }),
  });
  const revisionResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${revisionStart.plan.id}/execute`, { method: 'POST', headers: ctx.headers, body: '{}' });
  const revision = await revisionResponse.json();
  assert.equal(revisionResponse.status, 200, JSON.stringify(revision));
  assert.equal(revision.kind, 'collaboration-revision');
  assert.equal(revision.workflow.id, executed.workflow.id);
  assert.equal(revision.snapshot.workflows.length, 1);
  assert.equal(revision.snapshot.workflows[0].plan.revision, 2);
  assert.equal(revision.snapshot.proposals.find((proposal) => proposal.id === proposalId).proposalMessageId, submitted.proposal.proposalMessageId);

  const paused = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${executed.workflow.id}/pause`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'native-pause-once' }),
  }).then(res => res.json());
  assert.equal(paused.workflow.nativeOnly, true);
  assert.equal(paused.snapshot.workflows[0].status, 'paused');
  assert.ok(paused.snapshot.workflows[0].tasks.some(task => task.status === 'paused'));

  const resumed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows/${executed.workflow.id}/resume`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'native-resume-once' }),
  }).then(res => res.json());
  assert.equal(resumed.snapshot.workflows[0].status, 'active');
  assert.ok(resumed.snapshot.workflows[0].tasks.some(task => task.status === 'ready'));
});

test('collaboration response keeps one Agent message and takes over placeholder content on Run completion', async t => {
  const agents = [{ id: 'response-coord', name: 'Response Coordinator', role: 'Coordinator', profileName: 'response-coord', source: 'frakio', avatarUrl: '/avatars/response-coord.png' }];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Response takeover', primaryAgentId: 'response-coord', messageIntent: 'collaboration' }) }).then(res => res.json());
  const store = createRuntimeStore(ctx.databasePath);
  const session = store.upsertSession({ runtimeId: 'hermes', threadId: created.thread.id, agentId: 'response-coord', laneType: 'chat', laneId: created.thread.id, status: 'active', lifecycleState: 'active' });
  const run = store.createRun({ sessionId: session.id, runtimeId: 'hermes', threadId: created.thread.id, agentId: 'response-coord', turnId: 'response-turn', status: 'running', metadata: {} });
  store.close();
  const planId = created.thread.activePlanId;
  const submitted = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ baseRevision: 0, title: '协作回复接管', summary: '完成回复接管。', submittedByRunId: run.id, idempotencyKey: 'response-takeover-v1', steps: [{ key: 'one', title: '执行一步', description: '完成。', files: [], assigneeAgentId: 'response-coord', expectedResult: '结果', dependsOnKeys: [] }], tests: [], assumptions: [] }) }).then(res => res.json());
  assert.ok(submitted.proposal.proposalMessageId);
  const before = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}`).then(res => res.json());
  const placeholder = before.thread.messages.find(message => message.id === submitted.proposal.proposalMessageId);
  assert.equal(placeholder.content, '我整理成了 1 个协作步骤，请确认后开始执行。');
  assert.equal(placeholder.agentId, 'response-coord');
  await ctx.module.processCanonicalRuntimeEvent(run.id, { type: 'run.completed', nativeEventKey: 'response-takeover-complete', payload: { output: '这是 Response Coordinator 的最终协作说明。' } });
  const after = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}`).then(res => res.json());
  const responses = after.thread.messages.filter(message => message.contentType === 'collaboration_plan_response' && message.planId === planId);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, placeholder.id);
  assert.equal(responses[0].content, '这是 Response Coordinator 的最终协作说明。');
  assert.equal(responses[0].agentId, 'response-coord');
  assert.equal(after.thread.messages.filter(message => message.content.includes('我整理成了 1 个协作步骤')).length, 0);
  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.proposals[0].proposalMessageId, placeholder.id);
});

test('native Scheduler events appear in the thread collaboration snapshot and cursor replay', async t => {
  const agents = [{ id: 'event-worker', name: 'Event Worker', role: 'Worker', profileName: 'event-worker', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow({ ...ctx, agentId: 'event-worker' }, 'event-projection', 'event-worker');
  const store = createRuntimeStore(ctx.databasePath);
  const started = store.appendCollaborationEvent({
    id: 'native-task-started-event',
    type: 'task.started',
    workflowId: workflow.workflowId,
    taskId: workflow.taskId,
    runId: 'native-run-1',
    payload: {
      title: 'Event Worker 开始执行',
      detail: 'Pi Runtime Session 已启动',
      actorAgentId: 'event-worker',
      runtimeId: 'pi',
    },
  });
  store.close();

  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  const projected = snapshot.snapshot.events.find((event) => event.id === started.id);
  assert.equal(projected.type, 'task.started');
  assert.equal(projected.title, 'Event Worker 开始执行');
  assert.equal(projected.detail, 'Pi Runtime Session 已启动');
  assert.equal(projected.runId, 'native-run-1');
  assert.equal(snapshot.snapshot.cursor, started.cursor);

  const replayController = new AbortController();
  const replayResponse = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/events?after=${started.cursor - 1}`, { signal: replayController.signal });
  const replayReader = replayResponse.body.getReader();
  let replayText = '';
  while (!replayText.includes('event: collaboration.snapshot')) {
    const chunk = await Promise.race([
      replayReader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('native collaboration event replay timed out')), 2000)),
    ]);
    if (chunk.done) break;
    replayText += new TextDecoder().decode(chunk.value);
  }
  replayController.abort();
  assert.match(replayText, new RegExp(`id: ${started.cursor}\\nevent: task\\.started`));
});

test('collaboration snapshot projects the latest sanitized Runtime activity for each task', async t => {
  const agents = [{ id: 'activity-worker', name: 'Activity Worker', role: 'Worker', profileName: 'activity-worker', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow({ ...ctx, agentId: 'activity-worker' }, 'activity-projection', 'activity-worker');
  const bound = seedBoundRuntimeRun(ctx, workflow, { runtimeId: 'pi' });
  await ctx.module.processCanonicalRuntimeEvent(bound.run.id, {
    type: 'tool.started',
    payload: { toolName: 'read_file', args: { path: '/private/project/src/main.tsx' } },
    nativeEventKey: 'activity-read-main',
  });
  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  const task = snapshot.snapshot.workflows[0].tasks.find((item) => item.id === workflow.taskId);
  assert.equal(task.status, 'running');
  assert.equal(task.activity.phase, 'running');
  assert.equal(task.activity.kind, 'read');
  assert.equal(task.activity.target, 'main.tsx');
  assert.equal(task.activity.runId, bound.run.id);
  assert.ok(task.activity.revision > 0);
  assert.ok(task.activity.sourceEventId);
});

test('task-session attachment guidance is retained when the Runtime can only consume it on the next run', async t => {
  const agents = [{ id: 'attachment-worker', name: 'Attachment Worker', role: 'Writer', profileName: 'attachment-worker', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow({ ...ctx, agentId: 'attachment-worker' }, 'attachment-guidance', 'attachment-worker');
  const upload = await fetch(`${ctx.baseUrl}/api/attachments?name=${encodeURIComponent('brief.txt')}`, {
    method: 'POST',
    headers: { cookie: ctx.headers.cookie, 'x-frakio-request': '1', 'content-type': 'text/plain' },
    body: 'Use the supplied product brief as the source of truth.',
  });
  const uploaded = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(uploaded));
  assert.ok(uploaded.attachment?.id);

  const response = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/interventions`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({
      workflowId: workflow.workflowId,
      taskId: workflow.taskId,
      action: 'message',
      message: '请按附件更新文章口径。',
      attachmentIds: [uploaded.attachment.id],
      idempotencyKey: 'attachment-guidance-once',
    }),
  });
  const intervention = await response.json();
  assert.equal(response.status, 200, JSON.stringify(intervention));
  assert.equal(intervention.intervention.status, 'deferred_to_next_run');
  assert.deepEqual(intervention.intervention.attachmentIds, [uploaded.attachment.id]);

  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((result) => result.json());
  const event = snapshot.snapshot.events.find((item) => item.id === intervention.event.id);
  assert.deepEqual(event.payload.attachmentIds, [uploaded.attachment.id]);
  const store = createRuntimeStore(ctx.databasePath);
  const stored = store.listCollaborationInterventions({ workflowId: workflow.workflowId, taskId: workflow.taskId }).find((item) => item.id === intervention.interventionId);
  store.close();
  assert.deepEqual(stored.metadata.attachmentIds, [uploaded.attachment.id]);
});

test('native collaboration completion projects the approved proposal card to completed', async t => {
  const agents = [{ id: 'terminal-coord', name: 'Terminal Coordinator', role: 'Coordinator', profileName: 'terminal-coord', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ title: 'Terminal proposal', primaryAgentId: 'terminal-coord', messageIntent: 'collaboration' }),
  }).then(res => res.json());
  const planId = created.thread.activePlanId;
  await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/plans/${planId}/submit`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({
      baseRevision: 0, title: '完成状态测试', summary: '完成一个任务后汇总。', idempotencyKey: 'terminal-proposal',
      steps: [{ key: 'work', title: '执行任务', description: '交付结果。', files: [], assigneeAgentId: 'terminal-coord', expectedResult: '结果', dependsOnKeys: [] }],
      tests: [], assumptions: [],
    }),
  });
  const proposalSnapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  const confirmed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/proposals/${proposalSnapshot.snapshot.proposals[0].id}/confirm`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ revision: 1, confirmedBy: 'user' }),
  }).then(res => res.json());
  assert.equal(confirmed.workflow.approvedPlanId, planId);
  const rootTask = confirmed.snapshot.workflows[0].tasks.find(task => task.id === confirmed.rootTaskId);
  const workerTask = confirmed.snapshot.workflows[0].tasks.find(task => task.id !== confirmed.rootTaskId);
  assert.ok(rootTask);
  assert.ok(workerTask);
  await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/tasks/${workerTask.id}/complete`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: confirmed.workflow.id, title: workerTask.title, summary: '子任务已经交付。' }),
  });
  const rootCompleted = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/tasks/${rootTask.id}/complete`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: confirmed.workflow.id, title: rootTask.title, summary: '最终交付已经完成。' }),
  });
  assert.equal(rootCompleted.status, 200, await rootCompleted.text());
  await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`);
  const terminalThread = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}`).then(res => res.json());
  const terminalWorkflow = terminalThread.thread.collaboration.workflows.find(workflow => workflow.id === confirmed.workflow.id);
  const terminalPlan = terminalThread.thread.planSessions.find(plan => plan.id === planId);
  assert.equal(terminalWorkflow.status, 'completed');
  assert.equal(terminalWorkflow.approvedPlanId, planId);
  assert.equal(terminalPlan.status, 'completed');
});

test('Plan and collaboration intents are mutually exclusive', async t => {
  const agents = [
    { id: 'double-coord', name: 'Double Coordinator', role: 'Coordinator', profileName: 'double-coord', source: 'hermes-profile' },
  ];
  const ctx = await startTestApp(t, { agents });
  const combinedResponse = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Double confirmation', primaryAgentId: 'double-coord', coordinatorAgentId: 'double-coord', planEnabled: true, collaborationMode: 'plan', messageIntent: 'collaboration' }),
  });
  const combined = await combinedResponse.json();
  assert.equal(combinedResponse.status, 409, JSON.stringify(combined));
  assert.equal(combined.code, 'PLAN_COLLABORATION_CONFLICT');
  const conversations = await fetch(`${ctx.baseUrl}/api/conversations`, { headers: ctx.headers }).then(res => res.json());
  assert.equal(conversations.conversations.some((thread) => thread.title === 'Double confirmation'), false);

  const planThread = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Plan only', primaryAgentId: 'double-coord', planEnabled: true, collaborationMode: 'plan' }),
  }).then(res => res.json());
  const runConflictResponse = await fetch(`${ctx.baseUrl}/api/threads/${planThread.thread.id}/runs`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ message: '改成多人协作', messageIntent: 'collaboration', turnId: 'plan-collaboration-conflict' }),
  });
  const runConflict = await runConflictResponse.json();
  assert.equal(runConflictResponse.status, 409, JSON.stringify(runConflict));
  assert.equal(runConflict.code, 'PLAN_COLLABORATION_CONFLICT');
  const collaborationResponse = await fetch(`${ctx.baseUrl}/api/threads/${planThread.thread.id}/collaboration-mode`, {
    method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'collaboration', purpose: 'collaboration', authorAgentId: 'double-coord' }),
  });
  const collaboration = await collaborationResponse.json();
  assert.equal(collaborationResponse.status, 409, JSON.stringify(collaboration));
  assert.equal(collaboration.code, 'PLAN_COLLABORATION_CONFLICT');
});

test('an active collaboration Workflow blocks a new ordinary Plan', async t => {
  const agents = [{ id: 'workflow-coord', name: 'Workflow Coordinator', role: 'Coordinator', profileName: 'workflow-coord', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  ctx.agentId = 'workflow-coord';
  const active = await createConfirmedNativeWorkflow(ctx, 'plan-block', 'workflow-coord');
  const response = await fetch(`${ctx.baseUrl}/api/threads/${active.threadId}/collaboration-mode`, {
    method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'plan', authorAgentId: 'workflow-coord' }),
  });
  const result = await response.json();
  assert.equal(response.status, 409, JSON.stringify(result));
  assert.equal(result.code, 'WORK_ROOT_ACTIVE');
});

test('structured collaboration suggestions never create a Workflow before the user acts', async t => {
  const agents = [{ id: 'suggest-agent', name: 'Suggest Agent', role: 'Assistant', profileName: 'suggest-agent', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Suggestion', primaryAgentId: 'suggest-agent' }) }).then(res => res.json());
  const suggestionResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/suggestions`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: '多人完成宣传稿', reason: '研究与撰写可以并行协作。', sourceAgentId: 'suggest-agent', idempotencyKey: 'suggest-once' }),
  });
  const suggestion = await suggestionResponse.json();
  assert.equal(suggestionResponse.status, 200, JSON.stringify(suggestion));
  assert.equal(suggestion.message.contentType, 'collaboration_suggestion');
  const replay = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/suggestions`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: '多人完成宣传稿', reason: '研究与撰写可以并行协作。', sourceAgentId: 'suggest-agent', idempotencyKey: 'suggest-once' }),
  }).then(res => res.json());
  assert.equal(replay.idempotent, true);
  const snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.workflows.length, 0);
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

test('new projects preserve the entered folder name instead of falling back to default', async t => {
  const ctx = await startTestApp(t);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-project-name-'));
  const english = await fetch(`${ctx.baseUrl}/api/workspaces`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ mode: 'create', name: 'Frakio Works', parentPath: parent }),
  });
  const englishBody = await english.json();
  assert.equal(english.status, 200, JSON.stringify(englishBody));
  assert.equal(englishBody.workspace.rootPath, path.join(parent, 'Frakio Works'));
  assert.equal(englishBody.workspace.name, 'Frakio Works');
  assert.equal(englishBody.workspace.vaultId, null);
  assert.equal(englishBody.vault, null);
  for (const legacyEntry of ['AGENTS.md', 'sources', 'wiki', 'drafts']) {
    assert.equal(await readFile(path.join(englishBody.workspace.rootPath, legacyEntry), 'utf8').catch(() => ''), '');
  }

  const chinese = await fetch(`${ctx.baseUrl}/api/workspaces`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ mode: 'create', name: '宣传稿项目', parentPath: parent }),
  });
  const chineseBody = await chinese.json();
  assert.equal(chinese.status, 200, JSON.stringify(chineseBody));
  assert.equal(chineseBody.workspace.rootPath, path.join(parent, '宣传稿项目'));

  const work = await fetch(`${ctx.baseUrl}/api/threads/${englishBody.thread.id}/mode`, {
    method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work' }),
  }).then(res => res.json());
  const root = await fetch(`${ctx.baseUrl}/api/threads/${englishBody.thread.id}/collaboration/roots`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: work.workflow.id, title: '文件交付', idempotencyKey: 'artifact-root' }),
  }).then(res => res.json());
  const artifactPath = path.join(englishBody.workspace.rootPath, 'result.md');
  await writeFile(artifactPath, '# Result\n');
  const artifactResponse = await fetch(`${ctx.baseUrl}/api/threads/${englishBody.thread.id}/collaboration/tasks/${root.task.id}/artifacts`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: work.workflow.id, name: '最终结果', path: artifactPath, summary: '已生成最终文档' }),
  });
  const artifactBody = await artifactResponse.json();
  assert.equal(artifactResponse.status, 200, JSON.stringify(artifactBody));
  assert.equal(artifactBody.artifact.relativePath, 'result.md');
  const taskDetail = await fetch(`${ctx.baseUrl}/api/workflows/${work.workflow.id}/tasks/${root.task.id}`).then(res => res.json());
  assert.equal(taskDetail.detail.task.id, root.task.id);
  assert.equal(taskDetail.detail.artifacts.length, 1);
  assert.deepEqual(taskDetail.detail.runtimeEvents, []);
  assert.deepEqual(taskDetail.detail.interventions, []);
  await writeFile(artifactPath, '# Result changed\n');
  const conflictResponse = await fetch(`${ctx.baseUrl}/api/threads/${englishBody.thread.id}/collaboration/tasks/${root.task.id}/artifacts`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: work.workflow.id, name: '冲突结果', path: artifactPath, summary: '未提供基线版本' }),
  });
  const conflictBody = await conflictResponse.json();
  assert.equal(conflictResponse.status, 409, JSON.stringify(conflictBody));
  assert.equal(conflictBody.code, 'ARTIFACT_VERSION_CONFLICT');

  const invalid = await fetch(`${ctx.baseUrl}/api/workspaces`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ mode: 'create', name: 'bad/name', parentPath: parent }),
  });
  assert.equal(invalid.status, 400);
});

test('legacy collaboration migration previews conflicts and commits read-only history idempotently', async t => {
  const ctx = await startTestApp(t);
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Legacy migration' }) }).then(res => res.json());
  const mode = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work' }) }).then(res => res.json());
  assert.equal(mode.workflow.nativeOnly, false);
  const preview = await fetch(`${ctx.baseUrl}/api/collaboration/migrations/legacy/preview`, { method: 'POST', headers: ctx.headers, body: '{}' }).then(res => res.json());
  const entry = preview.entries.find(item => item.id === mode.workflow.id);
  assert.ok(entry);
  assert.equal(entry.status, 'legacy_active');
  assert.equal(entry.sources.hermesBoard.adapter, 'legacy');
  const committed = await fetch(`${ctx.baseUrl}/api/collaboration/migrations/legacy/commit`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowIds: [entry.id], migrationId: 'migration-test-1', idempotencyKey: 'migration-test-1' }) });
  const committedBody = await committed.json();
  assert.equal(committed.status, 200, JSON.stringify(committedBody));
  assert.deepEqual(committedBody.activeLegacyWorkflowIds, [entry.id]);
  const repeated = await fetch(`${ctx.baseUrl}/api/collaboration/migrations/legacy/commit`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowIds: [entry.id], migrationId: 'migration-test-1', idempotencyKey: 'migration-test-1' }) }).then(res => res.json());
  assert.equal(repeated.idempotent, true);
});

test('project libraries are opt-in, trusted rules are scoped to the connected thread, and personal libraries stay global', async t => {
  const ctx = await startTestApp(t, { agents: [{ id: 'iris-test', name: 'Iris', role: 'Coordinator', profileName: 'iris-test', source: 'hermes-profile' }] });
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-library-scope-'));
  const projectRoot = path.join(parent, '项目资料库');
  const projectResponse = await fetch(`${ctx.baseUrl}/api/vaults`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ kind: 'project', path: projectRoot, name: '项目规则库' }) });
  const project = await projectResponse.json();
  assert.equal(projectResponse.status, 200, JSON.stringify(project));
  assert.equal(project.vault.kind, 'project');
  assert.match(await readFile(path.join(projectRoot, '.frakio', 'vault.json'), 'utf8'), /"type": "project"/);
  await writeFile(path.join(projectRoot, 'FRAKIO.md'), '# 规则\n\n交付路径固定为 `交付物/`。\n');

  const personalRoot = path.join(parent, '个人资料库');
  const personalResponse = await fetch(`${ctx.baseUrl}/api/vaults`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ kind: 'personal', path: personalRoot }) });
  const personal = await personalResponse.json();
  assert.equal(personalResponse.status, 200, JSON.stringify(personal));
  assert.equal(personal.vault.kind, 'personal');

  const thread = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: '规则隔离', mode: 'direct', selectedAgents: ['iris-test'] }) }).then(res => res.json());
  const connectedResponse = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ vaultId: project.vault.id }) });
  const connected = await connectedResponse.json();
  assert.equal(connectedResponse.status, 200, JSON.stringify(connected));
  const preview = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}/context-preview?agentId=iris-test`, { headers: ctx.headers }).then(res => res.json());
  assert.deepEqual(preview.projectRulePaths, ['FRAKIO.md']);
  assert.ok(preview.sources.some(source => source.kind === 'personal_vault'));

  const disconnected = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ vaultId: null }) }).then(res => res.json());
  assert.equal(disconnected.thread.vaultId, null);
  const disconnectedPreview = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}/context-preview?agentId=iris-test`, { headers: ctx.headers }).then(res => res.json());
  assert.deepEqual(disconnectedPreview.projectRulePaths, []);

  const personalOff = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ personalKnowledgeMode: 'off' }) });
  assert.equal(personalOff.status, 200);
  const personalOffPreview = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}/context-preview?agentId=iris-test`, { headers: ctx.headers }).then(res => res.json());
  assert.equal(personalOffPreview.personalKnowledge.enabled, false);
  assert.ok(!personalOffPreview.sources.some(source => source.kind === 'personal_vault'));

  const invalidPersonalBinding = await fetch(`${ctx.baseUrl}/api/threads/${thread.thread.id}`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ vaultId: personal.vault.id }) });
  assert.equal(invalidPersonalBinding.status, 400);
});

test('project Work tasks automatically write a durable delivery into the project folder', async t => {
  const agents = [{ id: 'delivery-coord', name: 'Delivery Coordinator', role: 'Coordinator', profileName: 'delivery-coord', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-work-delivery-'));
  const created = await fetch(`${ctx.baseUrl}/api/workspaces`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ mode: 'create', name: '交付项目', parentPath: parent, primaryAgentId: 'delivery-coord' }),
  }).then(res => res.json());
  const work = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, {
    method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work', agentId: 'delivery-coord' }),
  }).then(res => res.json());
  const root = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/roots`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: work.workflow.id, title: '项目根任务', assigneeAgentId: 'delivery-coord', idempotencyKey: 'delivery-root' }),
  }).then(res => res.json());
  const plan = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/plans`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({
      workflowId: work.workflow.id, rootTaskId: root.task.id, baseRevision: 0, idempotencyKey: 'delivery-plan',
      tasks: [{ key: 'research', title: '整理研究资料', assigneeAgentId: 'delivery-coord', dependsOnKeys: [] }],
    }),
  }).then(res => res.json());
  const taskId = plan.plan.tasks[0].taskId;
  const completed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/tasks/${taskId}/complete`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: work.workflow.id, title: '整理研究资料', summary: '已整理三条研究结论。' }),
  }).then(res => res.json());
  assert.equal(completed.ok, true);
  assert.equal(completed.artifact.source, 'auto_summary');
  assert.match(completed.artifact.relativePath, /^交付物\//);
  assert.equal(path.resolve(completed.artifact.path).startsWith(path.resolve(created.workspace.rootPath)), true);
  assert.match(await readFile(completed.artifact.path, 'utf8'), /已整理三条研究结论/);
});

test('startup migrates a legacy default project directory without losing its files', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-default-migration-'));
  const home = path.join(parent, '.frakio-work');
  const legacyRoot = path.join(parent, 'Desktop', 'default');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(legacyRoot, { recursive: true });
  await writeFile(path.join(legacyRoot, 'index.md'), '# preserved\n');
  await writeFile(path.join(home, 'data', 'workbench-state.json'), JSON.stringify({
    agents: [], spaces: [{ id: 'space_default', name: 'Frakio Work' }],
    workspaces: [{ id: 'workspace-legacy', spaceId: 'space_default', name: 'Frakio Works', rootPath: legacyRoot, vaultId: 'vault-legacy', activeThreadId: null }],
    vaults: [{ id: 'vault-legacy', name: 'Frakio Works', path: legacyRoot, status: 'not_indexed', documentCount: 0, productCount: 0, lastIndexedAt: null, index: null }],
    threads: [],
  }));
  const previous = { home: process.env.FRAKIO_WORK_HOME, hermesHome: process.env.HERMES_HOME, port: process.env.PORT, disabled: process.env.FRAKIO_WORK_DISABLE_AUTOSTART };
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = path.join(parent, '.hermes');
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  t.after(() => {
    for (const [key, value] of Object.entries({ FRAKIO_WORK_HOME: previous.home, HERMES_HOME: previous.hermesHome, PORT: previous.port, FRAKIO_WORK_DISABLE_AUTOSTART: previous.disabled })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const module = await import(`./server.mjs?legacy-default-migration=${Date.now()}-${Math.random()}`);
  await module.createApp();
  const migrated = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  const nextRoot = path.join(parent, 'Desktop', 'Frakio Works');
  assert.equal(migrated.workspaces.find((item) => item.id === 'workspace-legacy').rootPath, nextRoot);
  assert.equal(migrated.vaults.find((item) => item.id === 'vault-legacy').path, nextRoot);
  assert.equal(await readFile(path.join(nextRoot, 'index.md'), 'utf8'), '# preserved\n');
});

test('completed Work tasks wait for one coordinator final response instead of completing silently', async t => {
  const agents = [{ id: 'coord-final', name: 'Final Coordinator', role: 'Coordinator', profileName: 'coord-final', source: 'hermes-profile' }];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ title: 'Final response', primaryAgentId: 'coord-final' }) }).then(res => res.json());
  const switched = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/mode`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ mode: 'work', agentId: 'coord-final' }) }).then(res => res.json());
  const root = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/roots`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: switched.workflow.id, title: 'Root', idempotencyKey: 'final-root' }) }).then(res => res.json());
  const plan = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/plans`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({
    workflowId: switched.workflow.id, rootTaskId: root.task.id, baseRevision: 0, idempotencyKey: 'final-plan',
    tasks: [{ key: 'worker', title: 'Worker', assigneeAgentId: 'coord-final', dependsOnKeys: [] }],
  }) }).then(res => res.json());
  const workerTaskId = plan.plan.tasks[0].taskId;
  const completed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/tasks/${workerTaskId}/complete`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: switched.workflow.id, title: 'Worker', summary: '工作已完成' }),
  });
  assert.equal(completed.status, 200);

  const first = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  const workflow = first.snapshot.workflows[0];
  assert.equal(workflow.status, 'active');
  assert.equal(workflow.finalization.state, 'requested');
  assert.ok(first.snapshot.events.some(event => event.title === '正在生成最终回应'));
  const second = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(second.snapshot.events.filter(event => event.title === '正在生成最终回应').length, 1);
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
  const conflictingWorkflow = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/workflows`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ name: '另一个协作', boardSlug: 'launch-second', idempotencyKey: 'workflow-second' }),
  });
  assert.equal(conflictingWorkflow.status, 409);
  const conflictBody = await conflictingWorkflow.json();
  assert.equal(conflictBody.code, 'ACTIVE_WORKFLOW_EXISTS');
  assert.equal(conflictBody.workflowId, workflow.workflow.id);

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
  const replayController = new AbortController();
  const replayResponse = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/events?after=2`, { signal: replayController.signal });
  const replayReader = replayResponse.body.getReader();
  let replayText = '';
  while (!replayText.includes('event: collaboration.snapshot')) {
    const chunk = await Promise.race([
      replayReader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('collaboration event replay timed out')), 2000)),
    ]);
    if (chunk.done) break;
    replayText += new TextDecoder().decode(chunk.value);
  }
  replayController.abort();
  const replayEvents = replayText.split('event: collaboration.snapshot')[0];
  assert.match(replayEvents, /id: 3\nevent: dependency\.created/);
  assert.match(replayEvents, /id: 4\nevent: task\.waiting/);
  assert.doesNotMatch(replayEvents, /id: [12]\n/);

  const completed = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration/tasks/${dependency.dependencyTask.id}/complete`, { method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflow.id, title: '竞品定价资料', summary: '三个竞品价格带已交付' }) });
  assert.equal(completed.status, 200);
  const afterComplete = await fetch(`${ctx.baseUrl}/api/threads/${thread.id}/collaboration`).then(res => res.json());
  const completionEvents = afterComplete.snapshot.events.filter(event => event.cursor > 4);
  const completedIndex = completionEvents.findIndex(event => event.type === 'task.completed');
  const dependencyIndex = completionEvents.findIndex(event => event.type === 'dependency.satisfied');
  assert.ok(completedIndex >= 0);
  assert.ok(dependencyIndex > completedIndex);

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

test('native collaboration supports A1 to B waiting for A2 and resumes B after A2 delivery', async t => {
  const agents = [
    { id: 'native-a', name: 'Native A', role: 'Researcher', profileName: 'native-a', source: 'hermes-profile' },
    { id: 'native-b', name: 'Native B', role: 'Writer', profileName: 'native-b', source: 'hermes-profile' },
  ];
  const ctx = await startTestApp(t, { agents });
  const created = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ title: 'Native dynamic dependency', primaryAgentId: 'native-a', coordinatorAgentId: 'native-a' }),
  }).then(res => res.json());
  const workflowResponse = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/workflows`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ name: 'Native workflow', native: true, coordinatorAgentId: 'native-a', idempotencyKey: 'native-workflow-once' }),
  });
  const workflow = await workflowResponse.json();
  const root = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/roots`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: workflow.workflow.id, title: 'B 汇总资料', assigneeAgentId: 'native-b', idempotencyKey: 'native-root-once' }),
  }).then(res => res.json());
  const dependency = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/dependencies`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: workflow.workflow.id, requesterTaskId: root.task.id, targetAgentId: 'native-a', title: 'A2 补充资料', reason: 'B 发现资料不足', idempotencyKey: 'native-a2-once' }),
  });
  const dependencyBody = await dependency.json();
  assert.equal(dependency.status, 200, JSON.stringify(dependencyBody));
  assert.equal(dependencyBody.dependencyTask.workflowId, workflow.workflow.id);
  let snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.workflows[0].tasks.find(task => task.id === root.task.id).status, 'waiting_dependency');
  const prematureRootCompletion = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/tasks/${root.task.id}/complete`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: workflow.workflow.id, title: 'B 汇总资料', summary: '不应该越过 A2 提前完成' }),
  });
  assert.equal(prematureRootCompletion.status, 409);
  assert.equal((await prematureRootCompletion.json()).code, 'TASK_DEPENDENCIES_INCOMPLETE');
  snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.workflows[0].tasks.find(task => task.id === root.task.id).status, 'waiting_dependency');
  const completed = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/tasks/${dependencyBody.dependencyTask.id}/complete`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: workflow.workflow.id, title: 'A2 补充资料', summary: '资料已补齐' }),
  });
  assert.equal(completed.status, 200, await completed.text());
  snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.ok(['completed', 'done'].includes(snapshot.snapshot.workflows[0].tasks.find(task => task.id === dependencyBody.dependencyTask.id).status));
  assert.equal(snapshot.snapshot.workflows[0].tasks.find(task => task.id === root.task.id).status, 'ready');
  assert.ok(snapshot.snapshot.events.some(event => event.type === 'dependency.satisfied'));
  const deferredIntervention = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration/interventions`, {
    method: 'POST', headers: ctx.headers,
    body: JSON.stringify({ workflowId: workflow.workflow.id, taskId: root.task.id, action: 'message', message: '下一次运行请加入新的标题要求', idempotencyKey: 'native-deferred-once' }),
  }).then(res => res.json());
  assert.equal(deferredIntervention.intervention.status, 'deferred_to_next_run');
  snapshot = await fetch(`${ctx.baseUrl}/api/threads/${created.thread.id}/collaboration`).then(res => res.json());
  assert.equal(snapshot.snapshot.workflows[0].interventionQueue.at(-1).status, 'deferred_to_next_run');
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

test('terminal workflow reconciliation clears stale active bindings and restores deletion', async t => {
  const agents = [{ id: 'terminal-coordinator', name: 'Terminal Coordinator', role: 'Coordinator', profileName: 'terminal-coordinator', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'terminal-reconciliation', agents[0].id);
  const cancelled = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/cancel`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'terminal-reconciliation-cancel' }),
  });
  assert.equal(cancelled.status, 200, await cancelled.text());

  const statePath = path.join(path.dirname(ctx.databasePath), 'workbench-state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const storedThread = state.threads.find((thread) => thread.id === workflow.threadId);
  const storedWorkflow = storedThread.collaboration.workflows.find((item) => item.id === workflow.workflowId);
  storedWorkflow.status = 'active';
  storedThread.collaboration.activeWorkflowId = workflow.workflowId;
  await writeFile(statePath, JSON.stringify(state));

  const reconciled = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  assert.equal(reconciled.snapshot.workflows[0].status, 'cancelled');
  const threadAfterReconciliation = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`).then((response) => response.json());
  assert.equal(threadAfterReconciliation.thread.collaboration.activeWorkflowId, '');

  const deleted = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`, { method: 'DELETE', headers: ctx.headers });
  assert.equal(deleted.status, 200, await deleted.text());
});

test('a failed coordinator root closes the workflow instead of keeping background collaboration active', async t => {
  const agents = [{ id: 'failed-coordinator', name: 'Failed Coordinator', role: 'Coordinator', profileName: 'failed-coordinator', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'failed-root-reconciliation', agents[0].id);
  const before = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`).then((response) => response.json());
  const rootTaskId = before.thread.collaboration.workflows.find((item) => item.id === workflow.workflowId).currentRootTaskId;
  const store = createRuntimeStore(ctx.databasePath);
  const root = store.getWorkTask(rootTaskId);
  store.upsertWorkTask({ ...root, status: 'failed', leaseToken: '', leaseExpiresAt: null, idempotencyKey: root.idempotencyKey });
  store.close();

  const reconciled = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  assert.equal(reconciled.snapshot.workflows[0].status, 'failed');
  assert.ok(reconciled.snapshot.events.some((event) => event.type === 'workflow.failed'));
  const threadAfterReconciliation = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`).then((response) => response.json());
  assert.equal(threadAfterReconciliation.thread.collaboration.activeWorkflowId, '');
});

test('native finalization persists one first-class delivery and hides completion from chat semantics', async t => {
  const agents = [{ id: 'delivery-coordinator', name: 'Delivery Coordinator', role: 'Coordinator', profileName: 'delivery-coordinator', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'first-class-delivery', agents[0].id);
  const workerResponse = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/tasks/${workflow.taskId}/complete`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflowId, title: '执行任务', summary: '上游交付已经验收。', actorAgentId: agents[0].id }),
  });
  assert.equal(workerResponse.status, 200, await workerResponse.text());
  const requested = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  const requestedWorkflow = requested.snapshot.workflows[0];
  const rootTaskId = requestedWorkflow.currentRootTaskId;
  assert.equal(requestedWorkflow.finalization.state, 'requested');
  assert.ok(requested.snapshot.events.some((event) => event.type === 'workflow.finalization_requested'));
  assert.equal(requestedWorkflow.tasks.find((task) => task.id === rootTaskId).status, 'ready');

  const finalResponse = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/tasks/${rootTaskId}/complete`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflowId, title: '最终交付', summary: '这是协调 Agent 整理的最终交付。', actorAgentId: agents[0].id }),
  });
  assert.equal(finalResponse.status, 200, await finalResponse.text());
  const completed = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  assert.equal(completed.snapshot.workflows[0].status, 'completed');
  assert.equal(completed.snapshot.workflows[0].finalization.state, 'delivered');
  assert.equal(completed.snapshot.workflows[0].finalDelivery.status, 'ready');
  assert.equal(completed.snapshot.workflows[0].finalDelivery.content, '这是协调 Agent 整理的最终交付。');
  assert.deepEqual(completed.snapshot.workflows[0].finalDelivery.sourceTaskIds, [workflow.taskId]);
  assert.equal(completed.snapshot.events.filter((event) => event.type === 'workflow.delivery_ready').length, 1);
  const thread = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`).then((response) => response.json());
  const deliveryMessages = thread.thread.messages.filter((message) => message.workFinalWorkflowId === workflow.workflowId);
  assert.equal(deliveryMessages.length, 1);
  assert.equal(deliveryMessages[0].contentType, 'workflow_final_delivery');
  assert.equal(thread.thread.collaboration.activeWorkflowId, '');
  const inbox = await fetch(`${ctx.baseUrl}/api/inbox`).then((response) => response.json());
  const notification = inbox.items.find((item) => item.workflowId === workflow.workflowId && item.type === 'workflow_completed');
  assert.ok(notification);
  assert.equal(notification.actionRequired, false);
  assert.equal(notification.readAt, null);
  const readResponse = await fetch(`${ctx.baseUrl}/api/inbox/${notification.id}`, { method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ read: true }) });
  const readResult = await readResponse.json();
  assert.equal(readResponse.status, 200, JSON.stringify(readResult));
  assert.ok(readResult.item.readAt);
});

test('a failed native finalization can be retried without rerunning completed execution tasks', async t => {
  const agents = [{ id: 'retry-coordinator', name: 'Retry Coordinator', role: 'Coordinator', profileName: 'retry-coordinator', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'retry-finalization', agents[0].id);
  await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/tasks/${workflow.taskId}/complete`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ workflowId: workflow.workflowId, title: '执行任务', summary: '执行任务已经完成。', actorAgentId: agents[0].id }),
  });
  const before = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}`).then((response) => response.json());
  const rootTaskId = before.thread.collaboration.workflows.find((item) => item.id === workflow.workflowId).currentRootTaskId;
  const store = createRuntimeStore(ctx.databasePath);
  const root = store.getWorkTask(rootTaskId);
  store.upsertWorkTask({ ...root, status: 'failed', leaseToken: '', leaseExpiresAt: null, idempotencyKey: root.idempotencyKey });
  store.close();
  const failed = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration`).then((response) => response.json());
  assert.equal(failed.snapshot.workflows[0].status, 'failed');
  assert.equal(failed.snapshot.workflows[0].finalization.state, 'failed');
  assert.equal(failed.snapshot.workflows[0].finalDelivery.status, 'failed');
  const failedInbox = await fetch(`${ctx.baseUrl}/api/inbox`).then((response) => response.json());
  const failureNotification = failedInbox.items.find((item) => item.workflowId === workflow.workflowId && item.type === 'finalization_failed');
  assert.ok(failureNotification);
  assert.equal(failureNotification.actionRequired, true);
  assert.equal(failureNotification.resolvedAt, null);

  const retryResponse = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/retry-finalization`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'retry-finalization-once' }),
  });
  const retried = await retryResponse.json();
  assert.equal(retryResponse.status, 200, JSON.stringify(retried));
  assert.equal(retried.snapshot.workflows[0].status, 'active');
  assert.equal(retried.snapshot.workflows[0].finalization.state, 'requested');
  assert.equal(retried.snapshot.workflows[0].tasks.find((task) => task.id === workflow.taskId).status, 'completed');
  assert.equal(retried.snapshot.workflows[0].tasks.find((task) => task.id === rootTaskId).status, 'ready');
  const retriedInbox = await fetch(`${ctx.baseUrl}/api/inbox`).then((response) => response.json());
  assert.ok(retriedInbox.items.find((item) => item.id === failureNotification.id).resolvedAt);
  const replay = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/retry-finalization`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'retry-finalization-once' }),
  }).then((response) => response.json());
  assert.equal(replay.idempotent, true);
});

test('terminal workflows cannot be reactivated by a history view request', async t => {
  const agents = [{ id: 'history-coordinator', name: 'History Coordinator', role: 'Coordinator', profileName: 'history-coordinator', source: 'frakio' }];
  const ctx = await startTestApp(t, { agents });
  const workflow = await createConfirmedNativeWorkflow(ctx, 'terminal-history', agents[0].id);
  await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}/cancel`, {
    method: 'POST', headers: ctx.headers, body: JSON.stringify({ idempotencyKey: 'terminal-history-cancel' }),
  });
  const activation = await fetch(`${ctx.baseUrl}/api/threads/${workflow.threadId}/collaboration/workflows/${workflow.workflowId}`, {
    method: 'PATCH', headers: ctx.headers, body: JSON.stringify({ active: true }),
  });
  assert.equal(activation.status, 409);
  assert.equal((await activation.json()).code, 'WORKFLOW_TERMINAL');
});
