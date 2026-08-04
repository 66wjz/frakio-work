import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClaudeAgentSdkBridge } from './claude-agent-sdk.mjs';
import { createCodexAppServerBridge } from './codex-app-server.mjs';

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function sentinel(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  const before = await stat(target);
  return { target, content, mtimeMs: before.mtimeMs };
}

test('Claude and Codex use Frakio homes without reading or changing global CLI state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-isolation-'));
  const fakeHome = path.join(root, 'user-home');
  const sentinels = await Promise.all([
    sentinel(fakeHome, '.codex/config.toml', 'model_provider = "native"\n'),
    sentinel(fakeHome, '.codex/auth.json', '{"token":"native-codex"}\n'),
    sentinel(fakeHome, '.codex/skills/user-skill/SKILL.md', 'native codex skill\n'),
    sentinel(fakeHome, '.claude/settings.json', '{"model":"native"}\n'),
    sentinel(fakeHome, '.claude/skills/user-skill/SKILL.md', 'native claude skill\n'),
  ]);
  const previous = { HOME: process.env.HOME, OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  process.env.HOME = fakeHome;
  process.env.OPENAI_API_KEY = 'native-openai-secret';
  process.env.ANTHROPIC_API_KEY = 'native-anthropic-secret';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let codexSpawnOptions;
  const codex = createCodexAppServerBridge({
    runtimeHomeRoot: path.join(root, 'frakio', 'codex'),
    commandArgsFactory: () => [path.join(fixtureDirectory, 'fake-codex-app-server.mjs')],
    spawnProcess(command, args, options) {
      codexSpawnOptions = options;
      return spawn(command, args, options);
    },
  });
  t.after(() => codex.close());
  const codexCompleted = new Promise((resolve) => codex.on('event', ({ event }) => event.type === 'run.completed' && resolve(event)));
  await codex.startRun({
    runId: 'codex-isolation-run', sessionId: 'codex-isolation-session', cwd: root, model: 'gpt-test', permissionMode: 'off',
    profileSnapshot: { name: 'Ares', role: 'Engineer' }, contextPacket: {}, prompt: 'test',
    runtimeBinding: { runtimeBuildId: 'codex-build', runtimeVersion: '1.0.0', executablePath: process.execPath },
    executionRealm: { revision: 'codex-realm' },
    launchSpec: { baseUrl: 'http://127.0.0.1:8787/frakio/v1', token: 'realm-token', modelId: 'gpt-test' },
  });
  await codexCompleted;

  let claudeOptions;
  const claude = createClaudeAgentSdkBridge({
    runtimeHomeRoot: path.join(root, 'frakio', 'claude'),
    queryFactory({ options }) {
      claudeOptions = options;
      const stream = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-native-session' };
        yield { type: 'result', subtype: 'success', result: 'ok', is_error: false };
      })();
      stream.interrupt = async () => {};
      stream.close = () => {};
      return stream;
    },
  });
  t.after(() => claude.close());
  const claudeCompleted = new Promise((resolve) => claude.on('event', ({ event }) => event.type === 'run.completed' && resolve(event)));
  await claude.startRun({
    runId: 'claude-isolation-run', sessionId: 'claude-isolation-session', cwd: root, model: 'claude-test', permissionMode: 'off',
    profileSnapshot: { name: 'Ares', role: 'Engineer' }, contextPacket: {}, prompt: 'test',
    runtimeBinding: { runtimeBuildId: 'claude-build', runtimeVersion: '2.1.0', executablePath: process.execPath },
    executionRealm: { revision: 'claude-realm' },
    launchSpec: { baseUrl: 'http://127.0.0.1:8787/frakio', token: 'realm-token', modelId: 'claude-test' },
  });
  await claudeCompleted;

  assert.equal(codexSpawnOptions.env.CODEX_HOME, path.join(root, 'frakio', 'codex', 'codex-realm'));
  assert.equal('HOME' in codexSpawnOptions.env, false);
  assert.equal('OPENAI_API_KEY' in codexSpawnOptions.env, false);
  assert.equal(claudeOptions.env.CLAUDE_CONFIG_DIR, path.join(root, 'frakio', 'claude', 'claude-realm'));
  assert.equal('HOME' in claudeOptions.env, false);
  assert.equal(claudeOptions.env.ANTHROPIC_API_KEY, '');
  assert.deepEqual(claudeOptions.settingSources, []);

  for (const item of sentinels) {
    assert.equal(await readFile(item.target, 'utf8'), item.content);
    assert.equal((await stat(item.target)).mtimeMs, item.mtimeMs);
  }
});
