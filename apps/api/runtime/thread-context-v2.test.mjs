import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntimeStore } from './store.mjs';
import { compileThreadContextV2, projectThreadState, publicThreadView, syncThreadContextEvents } from './thread-context-v2.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-context-v2-'));
  const store = createRuntimeStore(path.join(root, 'runtime.sqlite'));
  t.after(() => store.close());
  return store;
}

function message(id, agentId, content, extra = {}) {
  return { id, agentId, agentName: agentId === 'user' ? '你' : agentId, role: agentId === 'user' ? 'Workspace Owner' : 'Agent', content, createdAt: new Date(1_700_000_000_000 + Number(id.replace(/\D/g, '') || 0)).toISOString(), ...extra };
}

test('thread context events are append-only, idempotent, and snapshots use CAS', async (t) => {
  const store = await fixture(t);
  const first = store.putThreadContextEvent({ threadId: 'thread-1', eventType: 'message.created', actorType: 'user', actorId: 'user', sourceId: 'message-1', payload: { message: message('message-1', 'user', '确认决定使用 V2。') } });
  const repeated = store.putThreadContextEvent({ threadId: 'thread-1', eventType: 'message.created', actorType: 'user', actorId: 'user', sourceId: 'message-1', payload: {} });
  assert.equal(first.id, repeated.id);
  assert.equal(store.listThreadContextEvents('thread-1').length, 1);
  const saved = store.putThreadStateSnapshot({ threadId: 'thread-1', revision: 1, throughCursor: 1, state: { items: {} }, contentHash: 'one' }, 0);
  assert.equal(saved.revision, 1);
  assert.equal(store.putThreadStateSnapshot({ threadId: 'thread-1', revision: 2, throughCursor: 1, state: { items: {} }, contentHash: 'stale' }, 0), null);
});

test('V2 retains an early confirmed decision outside the recent tail and writes a receipt', async (t) => {
  const store = await fixture(t);
  const messages = [message('message-1', 'user', '确认决定：发布前必须经过人工审核。')];
  for (let index = 2; index <= 500; index += 1) messages.push(message(`message-${index}`, index % 2 ? 'iris' : 'user', `普通协作消息 ${index}`));
  const thread = { id: 'thread-long', messages, workflowState: [], artifacts: [], updatedAt: new Date().toISOString() };
  const { packet, receipt } = compileThreadContextV2({
    store, thread, agent: { id: 'victor', role: 'Technical Director', profileRevision: 'profile-1', runtimePolicy: { permissionProfileId: 'default' } }, runtimeId: 'codex', query: '发布审核', basePacket: { memory: [], personalKnowledge: [], projectKnowledge: [], projectRules: [], memorySelection: {} }, contextWindow: 128000,
  });
  assert.equal(packet.schemaVersion, 2);
  assert.equal(packet.recentConversation.length, 12);
  assert.ok(packet.sharedState.decisions.some((item) => item.sourceMessageIds.includes('message-1') && item.authority === 'user_confirmed'));
  assert.ok(packet.relevantHistory.some((item) => item.messageId === 'message-1'));
  assert.equal(receipt.packetHash, packet.packetHash);
  assert.equal(store.listContextReceipts({ threadId: thread.id, limit: 1 })[0].id, receipt.id);
});

test('legacy internal relays are hidden only when followed by the matching routed Agent reply', async (t) => {
  const store = await fixture(t);
  const thread = {
    id: 'thread-relay', updatedAt: new Date().toISOString(), workflowState: [], artifacts: [],
    messages: [
      message('message-source', 'iris', '@Victor 请继续。'),
      message('message-relay', 'user', '群聊系统：Iris 在对话中提及了你（Victor），请基于当前上下文直接回复。\n\n原始消息：请继续。'),
      message('message-target', 'victor', '收到。', { agentName: 'Victor', routeReason: 'agent_mention', parentMessageId: 'message-source' }),
      message('message-user-copy', 'user', '群聊系统：Iris 在对话中提及了你（Victor），这只是用户粘贴的文本。'),
      message('message-normal', 'iris', '正常回复。'),
    ],
  };
  syncThreadContextEvents(store, thread);
  assert.deepEqual(publicThreadView(thread).messages.map((row) => row.id), ['message-source', 'message-target', 'message-user-copy', 'message-normal']);
  assert.equal(store.listThreadContextEvents(thread.id, { visibility: 'internal' }).filter((event) => event.eventType === 'message.created').length, 1);
});

test('state projection rebuild is deterministic', async (t) => {
  const store = await fixture(t);
  const thread = { id: 'thread-rebuild', messages: [message('message-1', 'user', '确认决定：使用稳定 cursor。'), message('message-2', 'iris', '风险：旧摘要可能遗漏来源。')], workflowState: [], artifacts: [], updatedAt: new Date().toISOString() };
  syncThreadContextEvents(store, thread);
  const first = projectThreadState(store, thread.id);
  store.deleteThreadStateSnapshot(thread.id);
  const rebuilt = projectThreadState(store, thread.id, { force: true });
  assert.equal(rebuilt.contentHash, first.contentHash);
  assert.deepEqual(rebuilt.state, first.state);
});

test('Agent cursor only returns unseen public messages while retaining shared state', async (t) => {
  const store = await fixture(t);
  const firstThread = {
    id: 'thread-cursor', workflowState: [], artifacts: [], updatedAt: new Date().toISOString(),
    messages: [
      message('message-1', 'user', '确认决定：所有发布都需要审批。'),
      message('message-2', 'iris', '第一轮回复。'),
    ],
  };
  const common = { store, agent: { id: 'victor', role: 'Technical Director', profileRevision: 'profile-1', runtimePolicy: {} }, runtimeId: 'native', query: '继续', basePacket: { memory: [], personalKnowledge: [], projectKnowledge: [], projectRules: [], memorySelection: {} }, writeReceipt: false };
  const first = compileThreadContextV2({ ...common, thread: firstThread });
  const nextThread = { ...firstThread, messages: [...firstThread.messages, message('message-3', 'user', '新增要求：保留审计记录。'), message('message-4', 'iris', '第二轮回复。')] };
  const next = compileThreadContextV2({ ...common, thread: nextThread, cursorFrom: first.packet.cursor.to });

  assert.deepEqual(next.packet.recentConversation.map((row) => row.messageId), ['message-3', 'message-4']);
  assert.equal(next.packet.relevantHistory.some((row) => row.messageId === 'message-1'), false);
  assert.ok(next.packet.sharedState.decisions.some((item) => item.sourceMessageIds.includes('message-1')));
  assert.equal(next.packet.cursor.from, first.packet.cursor.to);
  assert.ok(next.packet.cursor.to > next.packet.cursor.from);
});
