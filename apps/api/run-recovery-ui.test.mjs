import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');

test('background run completion refreshes lists without opening its conversation', () => {
  const sendMessage = source.match(/async function sendMessage\(\)[\s\S]*?(?=\n  function clearAttachmentDrafts)/)?.[0] || '';
  const startNewChat = source.match(/async function startNewChat\(\)[\s\S]*?(?=\n  async function importHermesProfiles)/)?.[0] || '';
  assert.match(sendMessage, /setActiveThread\(\(current\) => current\?\.id === threadId \? routedThread : current\)/);
  assert.match(sendMessage, /loadThreads\(threadWorkspaceId, threadId, \{ openPreferred: false \}\)/);
  assert.match(startNewChat, /loadThreads\(thread\.workspaceId, thread\.id, \{ openPreferred: false \}\)/);
  assert.match(source, /if \(targetId && options\.openPreferred !== false\) await openThread\(targetId\)/);
  assert.match(source, /function adoptThreadSnapshot[\s\S]*?syncThreadSummary\(threadId, normalizedThread\)/);
  assert.match(source, /function syncThreadSummary[\s\S]*?setConversations[\s\S]*?setThreads/);
  assert.match(source, /requestJson<\{ thread: Thread \}>\(`\/api\/threads\/\$\{threadId\}`\)\.then\(\(data\) => adoptThreadSnapshot\(threadId, data\.thread\)\)/);
  assert.match(source, /window\.addEventListener\('frakio:thread-refresh-request', refresh\)/);
});

test('run recovery uses Host Run state and clears every composer lock on terminal state', () => {
  const terminal = source.match(/function applyTerminalRunUi\([\s\S]*?(?=\n  function applyThreadRunSnapshot)/)?.[0] || '';
  for (const field of ['isRunning: false', 'activeRun: null', 'stopping: false', 'approval: null', 'clarification: null']) {
    assert.match(terminal, new RegExp(field));
  }
  assert.match(source, /activeHermesRun\.hostRunId \|\| activeHermesRun\.runId/);
  assert.match(source, /alreadyTerminal/);
  assert.match(source, /reconcileThreadRun\(threadId, true\)/);
  assert.match(source, /applyTerminalRunUi\(\s*threadId,[\s\S]*data\.hostRunId \|\| data\.runId/);
  assert.match(source, /terminalRunId/);
});

test('live and recovered subscriptions deduplicate by thread, turn, Host Run, and event cursor', () => {
  assert.match(source, /runSubscriptionKey\(threadId, run\.turnId, run\.runId\)/);
  assert.match(source, /liveRunSubscriptionKeysRef\.current\.has\(key\) \|\| recoveredRunSubscriptionsRef\.current\.has\(key\)/);
  assert.match(source, /cursorValue && cursorValue <= subscription\.lastCursor/);
  assert.match(source, /eventCursor && eventCursor <= lastEventCursor/);
});

test('one turn renders independent Host Run presentations for every mentioned Agent', () => {
  assert.match(source, /runPresentationsByThreadId/);
  assert.match(source, /updateRunPresentation\(threadId, incomingHostRunId/);
  assert.match(source, /key={`run:\$\{presentation\.hostRunId\}`}/);
  assert.doesNotMatch(source, /if \(activeStreamRunId && incomingRunId !== activeStreamRunId\) return/);
  assert.doesNotMatch(source, /if \(data\.runId && data\.runId !== activeStreamRunId\)/);
});

test('approval and clarification stay bound to the requesting Host Run', () => {
  assert.match(source, /const activeDecisionPresentation = liveRunPresentations\.find\(\(run\) => run\.approval \|\| run\.clarification\)/);
  assert.match(source, /updateDecisionRunUi/);
  assert.match(source, /harnessId: decisionRunUi\?\.target/);
  const recovered = source.match(/function ensureRecoveredRunSubscription\([\s\S]*?(?=\n  async function reconcileActiveRuns)/)?.[0] || '';
  assert.match(recovered, /updateRunPresentation\(threadId, incomingHostRunId, \{[\s\S]*?approval: normalized\.approval/);
  assert.match(recovered, /if \(incomingHostRunId === run\.runId\) updateRunUi\(threadId, \{[\s\S]*?approval: normalized\.approval/);
  assert.match(recovered, /updateRunPresentation\(threadId, incomingHostRunId, \{[\s\S]*?clarification: normalized\.clarification/);
});

test('readonly Harness panel renders every bound Agent instead of only the active speaker', () => {
  const switcher = source.match(/function RuntimeSwitcher\([\s\S]*?(?=\nfunction ThreadActionsMenu)/)?.[0] || '';
  assert.match(switcher, /thread\.selectedAgents/);
  assert.match(switcher, /Object\.keys\(thread\.agentHarnessBindings \|\| \{\}\)/);
  assert.match(switcher, /teamAgents\.map\(\(agent\) =>/);
  assert.match(switcher, /<AgentAvatar agent=\{agent\}/);
  assert.match(switcher, /<RuntimeLabel runtimeId=\{runtimeId\}/);
  assert.doesNotMatch(switcher, /\[activeAgent\]\.map/);
});

test('recovered turn subscription stays open across child Run completion', () => {
  const recovered = source.match(/function ensureRecoveredRunSubscription\([\s\S]*?(?=\n  async function reconcileActiveRuns)/)?.[0] || '';
  assert.match(recovered, /data\.event === 'run\.completed'[\s\S]*?updateRunPresentation/);
  assert.match(recovered, /data\.event === 'turn\.completed'[\s\S]*?clearRecoveredRunSubscription/);
  assert.doesNotMatch(recovered, /data\.event === 'run\.completed' \|\| data\.event === 'run\.failed'[\s\S]{0,400}clearRecoveredRunSubscription/);
});

test('turn events expose a stable Host Run identity', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  const emit = serverSource.match(/function emitHermesTurnEvent\([\s\S]*?(?=\nfunction hermesTurnEventSink)/)?.[0] || '';
  assert.match(emit, /resolveHostRun\(event\.hostRunId \|\| event\.runId\)/);
  assert.match(emit, /hostRunId: event\.hostRunId \|\| hostRun\?\.id/);
});

test('new chat keeps its optimistic message and startup lock until Host Run acceptance', () => {
  assert.match(source, /clientMessageId/);
  assert.match(source, /addPendingMessage\(thread\.id, clientMessageId\)/);
  assert.match(source, /startPending: true/);
  assert.match(source, /if \(current\.startPending && !run\) return current/);
  assert.doesNotMatch(source, /if \(movedToThread && createdThreadId\) updateRunUi\(createdThreadId, \{ isRunning: false/);
  assert.match(source, /Host Run terminal events own composer unlock/);
});

test('new chat publishes its rail entry immediately after thread creation', () => {
  const startNewChat = source.match(/async function startNewChat\(\)[\s\S]*?(?=\n  async function importHermesProfiles)/)?.[0] || '';
  const createdIndex = startNewChat.indexOf('const thread = created.thread as Thread;');
  const railIndex = startNewChat.indexOf('setConversations((current) => [{ ...summary');
  const streamIndex = startNewChat.indexOf('await runHermesAgentThread(');
  assert.ok(createdIndex >= 0 && railIndex > createdIndex, 'rail update should follow creation');
  assert.ok(streamIndex < 0 || railIndex < streamIndex, 'rail update must precede the streaming wait');
  assert.match(startNewChat, /void loadThreads\(thread\.workspaceId, thread\.id, \{ openPreferred: false \}\)/);
});

test('Hermes turn sink forwards canonical events without writing them twice', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  const sink = serverSource.match(/function hermesTurnEventSink\([\s\S]*?(?=\nasync function invokeInternalHermesRun)/)?.[0] || '';
  assert.match(sink, /emitHermesTurnEvent/);
  assert.doesNotMatch(sink, /runtimePlatform\.ingestEvent/);
});

test('Hermes terminal paths finalize the Host Run and carry stable identity', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  const complete = serverSource.match(/async function completeHermesRunFromOutput\([\s\S]*?(?=\nasync function failHermesRunFromChunk)/)?.[0] || '';
  assert.match(complete, /runtimeHostController\.finish\(hostRun\.id, 'completed'/);
  assert.match(complete, /hostRunId/);
  assert.match(complete, /runtimeCursor/);
  assert.match(serverSource, /chunk\.done[\s\S]*?completeHermesRunFromOutput\([\s\S]*?nativeTerminal: true/);
  assert.match(serverSource, /function cancelHermesRun\([\s\S]*?runtimeHostController\.finish\(hostRun\.id, 'cancelled'/);
});

test('Hermes collaboration Tasks never occupy the main conversation Run projection', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  const startHermes = serverSource.match(/async function startHermesRunRequest[\s\S]*?(?=\napp\.post\('\/api\/threads\/:id\/runs')/)?.[0] || '';
  assert.match(startHermes, /if \(!taskDispatch\) \{\s*thread\.runStatus = 'running'/);
  assert.match(startHermes, /if \(taskDispatch\) \{\s*currentThread\.agentSessionIds/);
  assert.match(startHermes, /if \(!taskDispatch\) \{\s*retargetThreadChangeSet[\s\S]*?threadAfterStart\.activeRunId = started\.run_id/);
  assert.match(startHermes, /if \(taskDispatch\) \{\s*threadAfterStart\.activeWorkRuns/);
  assert.match(serverSource, /function finishTerminalThreadRunProjection[\s\S]*?run\.metadata\?\.taskDispatch[\s\S]*?clearHermesRunState/);
});

test('native collaboration dispatch binds every Runtime Run before the adapter starts', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  const startPi = serverSource.match(/async function startPiRunRequest[\s\S]*?(?=\nasync function startExternalChannelRunRequest)/)?.[0] || '';
  const startExternal = serverSource.match(/async function startExternalChannelRunRequest[\s\S]*?(?=\nasync function startRuntimeRunRequest)/)?.[0] || '';
  const startHermes = serverSource.match(/async function startHermesRunRequest[\s\S]*?(?=\napp\.post\('\/api\/threads\/:id\/runs')/)?.[0] || '';

  assert.match(startPi, /if \(taskDispatch \|\| thread\.executionMode === 'work'\)[\s\S]*?runtimeStore\.bindTaskRun/);
  assert.match(startPi, /runtimeStore\.bindTaskRun[\s\S]*?runtimeHostController\.dispatch/);
  assert.match(startPi, /kind: taskDispatch \? 'work-task'/);
  assert.match(startExternal, /runtimeStore\.bindTaskRun[\s\S]*?runtimeHostController\.dispatch/);
  assert.match(startHermes, /runtimeStore\.bindTaskRun[\s\S]*?runtimeHostController\.dispatch/);
});

test('removed threads cancel active Runtime Runs during deletion and startup recovery', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /async function cancelRuntimeRunsForRemovedThreads/);
  assert.match(serverSource, /await cancelRuntimeRunsForRemovedThreads\(result\.deletedThreadIds\)/);
  assert.match(serverSource, /await cancelRuntimeRunsForRemovedThreads\(\[result\.deletedThreadId\]\)/);
  assert.match(serverSource, /await reconcileOrphanRuntimeRuns\(startupState\)/);
});
