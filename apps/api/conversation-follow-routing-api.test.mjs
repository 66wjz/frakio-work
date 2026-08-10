import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('default follow returns to the default Agent while conversation follow keeps the mentioned Agent', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-conversation-follow-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(home, { recursive: true });
  for (const profile of ['iris', 'victor']) {
    const profileHome = path.join(hermesHome, 'profiles', profile);
    await mkdir(profileHome, { recursive: true });
    await writeFile(path.join(profileHome, 'profile.yaml'), `name: ${profile[0].toUpperCase()}${profile.slice(1)}\nrole: Test Agent\n`);
    await writeFile(path.join(profileHome, 'config.yaml'), '{}\n');
  }
  t.after(() => rm(parent, { recursive: true, force: true }));

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.HERMES_BIN = path.join(parent, 'missing-hermes');
  process.env.PORT = '0';
  const module = await import(`./server.mjs?conversation-follow=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };
  assert.equal((await fetch(`${baseUrl}/api/hermes-bootstrap/import`, { method: 'POST', headers })).status, 200);

  async function createConversation(followMode) {
    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: followMode, primaryAgentId: 'iris' }),
    });
    const { thread } = await response.json();
    if (followMode === 'conversation') {
      const patched = await fetch(`${baseUrl}/api/threads/${thread.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ followMode }),
      }).then((result) => result.json());
      return patched.thread;
    }
    return thread;
  }

  async function send(threadId, message) {
    const response = await fetch(`${baseUrl}/api/council/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ threadId, message, selectedAgents: ['iris', 'victor'] }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  const defaultThread = await createConversation('default');
  const defaultMention = await send(defaultThread.id, '@Victor 请回复。');
  assert.equal(defaultMention.events[0].agentId, 'victor');
  assert.equal(defaultMention.thread.activeAgentId, 'iris');
  const defaultNext = await send(defaultThread.id, '继续。');
  assert.equal(defaultNext.events[0].agentId, 'iris');
  assert.equal(defaultNext.thread.activeAgentId, 'iris');

  const conversationThread = await createConversation('conversation');
  const conversationMention = await send(conversationThread.id, '@Victor 请回复。');
  assert.equal(conversationMention.events[0].agentId, 'victor');
  assert.equal(conversationMention.thread.activeAgentId, 'victor');
  const conversationNext = await send(conversationThread.id, '继续。');
  assert.equal(conversationNext.events[0].agentId, 'victor');
  assert.equal(conversationNext.thread.activeAgentId, 'victor');
});
