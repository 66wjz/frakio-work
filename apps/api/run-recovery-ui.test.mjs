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

test('removed threads cancel active Runtime Runs during deletion and startup recovery', async () => {
  const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /async function cancelRuntimeRunsForRemovedThreads/);
  assert.match(serverSource, /await cancelRuntimeRunsForRemovedThreads\(result\.deletedThreadIds\)/);
  assert.match(serverSource, /await cancelRuntimeRunsForRemovedThreads\(\[result\.deletedThreadId\]\)/);
  assert.match(serverSource, /await reconcileOrphanRuntimeRuns\(startupState\)/);
});
