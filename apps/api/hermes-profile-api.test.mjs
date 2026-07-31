import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Hermes Default stays hidden and protected while named profiles remain independently deletable', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-hermes-profile-api-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const irisHome = path.join(hermesHome, 'profiles', 'iris');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(irisHome, { recursive: true });
  await writeFile(path.join(hermesHome, 'config.yaml'), '{}\n');
  await writeFile(path.join(hermesHome, 'root-marker'), 'keep\n');
  await writeFile(path.join(irisHome, 'config.yaml'), '{}\n');
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    ui: { defaultAgentId: 'iris', fallbackDecisionAgentId: 'iris' },
    agents: [
      { id: 'hermes-default', name: 'Hermes Default', profileName: 'default', source: 'hermes-profile' },
      { id: 'iris', name: 'Iris', profileName: 'iris', source: 'hermes-profile' },
    ],
    integrations: {
      hermesStudio: { selectedProfile: 'iris' },
      hermesAgent: {
        selectedProfile: 'iris',
        agentCreationRequests: { 'iris-create': { agentId: 'iris', createdAt: '2026-01-01T00:00:00.000Z' } },
        gatewayAutoStart: { enabled: true, management: 'per_profile', include: ['default', 'iris'], exclude: ['iris'] },
      },
    },
  })}\n`);

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?hermes-profile-api=${Date.now()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const writeHeaders = { cookie, 'x-frakio-request': '1' };

  const agentsResponse = await fetch(`${baseUrl}/api/agents`);
  assert.equal(agentsResponse.status, 200);
  assert.deepEqual((await agentsResponse.json()).agents.map((agent) => agent.id), ['iris']);

  const protectedResponse = await fetch(`${baseUrl}/api/agents/hermes-default`, { method: 'DELETE', headers: writeHeaders });
  assert.equal(protectedResponse.status, 409);
  assert.equal((await protectedResponse.json()).code, 'system_profile_protected');
  await access(path.join(hermesHome, 'root-marker'));
  await access(path.join(irisHome, 'config.yaml'));

  const [deleteResponse, concurrentDeleteResponse] = await Promise.all([
    fetch(`${baseUrl}/api/agents/iris`, { method: 'DELETE', headers: writeHeaders }),
    fetch(`${baseUrl}/api/agents/iris`, { method: 'DELETE', headers: writeHeaders }),
  ]);
  const deleted = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200, JSON.stringify(deleted));
  assert.equal(concurrentDeleteResponse.status, 200);
  assert.equal(deleted.gateway.stopped, true);
  assert.equal(deleted.autoStart.removed, true);
  await access(path.join(hermesHome, 'root-marker'));
  await assert.rejects(access(irisHome));
  const state = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.deepEqual(state.agents.map((agent) => agent.id), []);
  assert.deepEqual(state.integrations.hermesAgent.gatewayAutoStart.include, ['default']);
  assert.deepEqual(state.integrations.hermesAgent.gatewayAutoStart.exclude, []);
  assert.deepEqual(state.integrations.hermesAgent.agentCreationRequests, {});
  assert.equal(state.integrations.hermesAgent.selectedProfile, 'default');
  assert.equal(state.integrations.hermesStudio.selectedProfile, 'default');
});

test('reserved names are rejected and a legacy reserved profile can be stopped, renamed, and deleted', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-hermes-legacy-profile-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const legacyDir = path.join(hermesHome, 'profiles', 'test');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(hermesHome, 'config.yaml'), '{}\n');
  await writeFile(path.join(legacyDir, 'config.yaml'), '{}\n');
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    agents: [{ id: 'test', name: 'test', profileName: 'test', source: 'frakio-agent' }],
    models: [{ id: 'model-test', profileName: 'test' }],
    integrations: {
      hermesStudio: { selectedProfile: 'test' },
      hermesAgent: { selectedProfile: 'test', gatewayAutoStart: { enabled: true, management: 'per_profile', include: ['default', 'test'], exclude: ['test'] } },
    },
  })}\n`);

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?hermes-legacy-profile=${Date.now()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${baseUrl}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' };

  const stop = await fetch(`${baseUrl}/api/hermes-runtime/profiles/test/gateway/stop`, { method: 'POST', headers });
  assert.equal(stop.status, 200, await stop.text());
  const renamed = await fetch(`${baseUrl}/api/agents/test`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'test B' }) });
  assert.equal(renamed.status, 200, await renamed.text());
  await access(path.join(hermesHome, 'profiles', 'test-b', 'config.yaml'));
  await assert.rejects(access(legacyDir));
  const renamedState = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(renamedState.agents[0].profileName, 'test-b');
  assert.equal(renamedState.models[0].profileName, 'test-b');
  assert.deepEqual(renamedState.integrations.hermesAgent.gatewayAutoStart.include, ['default', 'test-b']);
  assert.deepEqual(renamedState.integrations.hermesAgent.gatewayAutoStart.exclude, ['test-b']);
  assert.equal(renamedState.integrations.hermesAgent.selectedProfile, 'test-b');
  assert.equal(renamedState.integrations.hermesStudio.selectedProfile, 'test-b');

  const deleted = await fetch(`${baseUrl}/api/agents/test`, { method: 'DELETE', headers });
  assert.equal(deleted.status, 200, await deleted.text());
  await assert.rejects(access(path.join(hermesHome, 'profiles', 'test-b')));
  const deletedState = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.deepEqual(deletedState.agents, []);
  assert.deepEqual(deletedState.integrations.hermesAgent.gatewayAutoStart.include, ['default']);
  assert.deepEqual(deletedState.integrations.hermesAgent.gatewayAutoStart.exclude, []);

  const rejected = await fetch(`${baseUrl}/api/agents`, { method: 'POST', headers, body: JSON.stringify({ name: 'test', runtimePolicy: { defaultRuntimeId: 'hermes', allowedRuntimeIds: ['hermes'] } }) });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /不能作为 Hermes Profile 名称/);
  await assert.rejects(access(legacyDir));
});
