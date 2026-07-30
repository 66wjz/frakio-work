import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ id: request.id, result: { userAgent: 'fake-codex' } });
    return;
  }
  if (request.method === 'initialized') return;
  if (request.method === 'model/list') {
    send({ id: request.id, result: { data: [{ id: 'fake-codex-model', displayName: 'Fake Codex Model', isDefault: true }] } });
    return;
  }
  if (request.method === 'thread/start' || request.method === 'thread/resume') {
    send({ id: request.id, result: { thread: { id: request.params.threadId || 'codex-thread-1' } } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ id: request.id, result: { turn: { id: 'codex-turn-1', status: 'inProgress' } } });
    setTimeout(() => {
      send({ method: 'item/agentMessage/delta', params: { threadId: request.params.threadId, turnId: 'codex-turn-1', delta: 'Codex ready' } });
      send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { id: 'codex-turn-1', status: 'completed' } } });
    }, 20);
    return;
  }
  if (request.method === 'turn/steer' || request.method === 'turn/interrupt') {
    send({ id: request.id, result: {} });
  }
});
