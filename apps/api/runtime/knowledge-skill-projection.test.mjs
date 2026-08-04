import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFilesystemSkillAdapter } from './filesystem-skill-adapter.mjs';
import { createSkillProjector, resolveSkillSet } from './skill-projector.mjs';
import { createRuntimeStore } from './store.mjs';

const skillPath = path.resolve('runtime-catalog/skills/frakio-llm-wiki');

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-skill-projection-'));
  const store = createRuntimeStore(path.join(root, 'runtime.db'));
  const content = await readFile(path.join(skillPath, 'SKILL.md'), 'utf8');
  const skill = { id: 'frakio-llm-wiki', name: 'frakio-llm-wiki', version: '2', contentHash: createHash('sha256').update(content).digest('hex'), scope: 'workspace', subjectId: 'vault:test', compatibleRuntimeIds: ['hermes', 'pi', 'codex', 'claude'], entryPath: skillPath };
  return { root, store, skill, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('bundled knowledge Skill projects consistently to all four runtimes', async () => {
  const current = await fixture();
  try {
    const adapters = new Map(['hermes', 'pi', 'codex', 'claude'].map((runtimeId) => [runtimeId, createFilesystemSkillAdapter({ runtimeId, rootForAgent: async (agentId) => path.join(current.root, runtimeId, agentId, 'skills') })]));
    const projector = createSkillProjector({ store: current.store, adapters });
    const skillSet = resolveSkillSet({ workspaceSkills: [current.skill] });
    for (const runtimeId of adapters.keys()) {
      const result = await projector.apply({ runtimeId, agentId: 'iris', sessionId: `session-${runtimeId}`, skillSet, requiredSkillIds: ['frakio-llm-wiki'] });
      assert.equal(result.receipts[0].status, 'projecting');
      assert.equal(result.receipts[0].loadMethod, 'filesystem_link');
      assert.equal((await lstat(path.join(current.root, runtimeId, 'iris', 'skills', 'frakio-llm-wiki'))).isSymbolicLink(), true);
    }
  } finally { await current.close(); }
});

test('required knowledge Skill falls back to a recorded host instruction', async () => {
  const current = await fixture();
  try {
    const projector = createSkillProjector({ store: current.store, adapters: new Map() });
    const result = await projector.apply({ runtimeId: 'custom', agentId: 'iris', sessionId: 'session-custom', skillSet: resolveSkillSet({ workspaceSkills: [current.skill] }), requiredSkillIds: ['frakio-llm-wiki'] });
    assert.equal(result.receipts[0].status, 'applied');
    assert.equal(result.receipts[0].loadMethod, 'host_instruction');
    assert.match(result.hostInstructions[0].content, /Frakio LLM Wiki/);
  } finally { await current.close(); }
});
