import readline from 'node:readline';

const settings = {};
const input = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function readSettings(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '-c') continue;
    const setting = String(args[index + 1] || '');
    const separator = setting.indexOf('=');
    if (separator < 0) continue;
    const key = setting.slice(0, separator);
    const raw = setting.slice(separator + 1);
    try { settings[key] = JSON.parse(raw); } catch { settings[key] = raw; }
  }
}

readSettings(process.argv.slice(2));

input.on('line', async (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ id: request.id, result: { userAgent: 'fake-codex-gateway' } });
    return;
  }
  if (request.method === 'initialized') return;
  if (request.method === 'thread/start' || request.method === 'thread/resume') {
    send({ id: request.id, result: { thread: { id: request.params.threadId || 'codex-gateway-thread' } } });
    return;
  }
  if (request.method !== 'turn/start') return;
  const baseUrl = String(settings['model_providers.frakio.base_url'] || '');
  const token = process.env.FRAKIO_RUNTIME_TOKEN || '';
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: settings.model || '', input: [{ role: 'user', content: 'gateway test' }], stream: true }),
  });
  const body = await response.text();
  if (!response.ok || !body.includes('gateway-ok')) {
    send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { id: 'codex-gateway-turn', status: 'failed', error: { message: body || `HTTP ${response.status}` } } } });
    return;
  }
  send({ id: request.id, result: { turn: { id: 'codex-gateway-turn', status: 'inProgress' } } });
  send({ method: 'item/agentMessage/delta', params: { threadId: request.params.threadId, turnId: 'codex-gateway-turn', delta: 'gateway-ok' } });
  send({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { id: 'codex-gateway-turn', status: 'completed' } } });
});
