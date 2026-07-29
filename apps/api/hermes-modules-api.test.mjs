import assert from 'node:assert/strict';
import { access, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

async function startModuleApp(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-modules-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  await writeFile(path.join(hermesHome, 'config.yaml'), '{}\n');
  for (const profileName of ['iris', 'kai']) {
    const profileDir = path.join(hermesHome, 'profiles', profileName);
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, 'config.yaml'), '{}\n');
    await writeFile(path.join(profileDir, 'profile.yaml'), `name: ${profileName === 'iris' ? 'Iris' : 'Kai'}\n`);
  }
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?hermes-modules=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return {
    home,
    hermesHome,
    baseUrl,
    headers: { cookie, 'x-frakio-request': '1', 'content-type': 'application/json' },
  };
}

async function writeSkill(root, name, description, script = 'same') {
  const dir = path.join(root, 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  await writeFile(path.join(dir, 'run.sh'), `${script}\n`);
}

async function writePlugin(root, name) {
  const dir = path.join(root, 'plugins', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'plugin.yaml'), `name: ${name}\ndescription: Test plugin\n`);
  await writeFile(path.join(dir, '__init__.py'), 'def register(ctx):\n    return None\n');
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('identical Agent skills promote to one global source and demote to the recorded origin', async (t) => {
  const ctx = await startModuleApp(t);
  const irisDir = path.join(ctx.hermesHome, 'profiles', 'iris');
  const kaiDir = path.join(ctx.hermesHome, 'profiles', 'kai');
  await writeSkill(ctx.hermesHome, 'shared-skill', 'Shared skill');
  await writeSkill(irisDir, 'shared-skill', 'Shared skill');
  await writeSkill(kaiDir, 'shared-skill', 'Shared skill');

  const before = await fetch(`${ctx.baseUrl}/api/hermes-modules?kind=skill`).then((response) => response.json());
  assert.equal(before.global.length, 0);
  assert.equal(before.profile.length, 2);
  assert.deepEqual(before.profile.find((item) => item.profileName === 'iris').duplicateProfileNames, ['kai']);

  const promoteResponse = await fetch(`${ctx.baseUrl}/api/hermes-modules/scope`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ action: 'promote', kind: 'skill', name: 'shared-skill', profileName: 'iris' }),
  });
  assert.equal(promoteResponse.status, 200);
  const promoted = await promoteResponse.json();
  assert.equal(promoted.originProfileName, 'iris');
  assert.deepEqual(promoted.archivedDuplicateProfiles, ['kai']);
  assert.equal(promoted.modules.global[0].originProfileName, 'iris');
  assert.equal(promoted.modules.profile.length, 0);
  assert.equal(await exists(path.join(ctx.home, 'shared', 'skills', 'shared-skill', 'SKILL.md')), true);
  assert.equal(await exists(path.join(ctx.hermesHome, 'skills', 'shared-skill', 'SKILL.md')), true);
  assert.equal(await exists(path.join(irisDir, 'skills', 'shared-skill')), false);
  assert.equal(await exists(path.join(kaiDir, 'skills', 'shared-skill')), false);

  for (const profileDir of [ctx.hermesHome, irisDir, kaiDir]) {
    const config = YAML.parse(await readFile(path.join(profileDir, 'config.yaml'), 'utf8'));
    assert.ok(config.skills.external_dirs.includes(path.join(ctx.home, 'shared', 'skills')));
    assert.equal(config.skills.disabled.includes('shared-skill'), false);
  }
  const provenance = JSON.parse(await readFile(path.join(ctx.home, 'module-provenance.json'), 'utf8'));
  assert.equal(provenance.skills['shared-skill'].originProfileName, 'iris');

  const demoteResponse = await fetch(`${ctx.baseUrl}/api/hermes-modules/scope`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ action: 'demote', kind: 'skill', name: 'shared-skill' }),
  });
  assert.equal(demoteResponse.status, 200);
  const demoted = await demoteResponse.json();
  assert.equal(demoted.targetProfileName, 'iris');
  assert.equal(demoted.modules.global.length, 0);
  assert.equal(demoted.modules.profile.length, 1);
  assert.equal(demoted.modules.profile[0].profileName, 'iris');
  assert.equal(await exists(path.join(irisDir, 'skills', 'shared-skill', 'SKILL.md')), true);
  assert.equal(await exists(path.join(kaiDir, 'skills', 'shared-skill')), false);
});

test('different same-name skills block promotion without changing either Agent', async (t) => {
  const ctx = await startModuleApp(t);
  const irisDir = path.join(ctx.hermesHome, 'profiles', 'iris');
  const kaiDir = path.join(ctx.hermesHome, 'profiles', 'kai');
  await writeSkill(irisDir, 'conflict-skill', 'Iris version', 'iris');
  await writeSkill(kaiDir, 'conflict-skill', 'Kai version', 'kai');

  const response = await fetch(`${ctx.baseUrl}/api/hermes-modules/scope`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ action: 'promote', kind: 'skill', name: 'conflict-skill', profileName: 'iris' }),
  });
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.deepEqual(payload.details.conflicts.map((item) => item.profileName), ['kai']);
  assert.equal(await exists(path.join(irisDir, 'skills', 'conflict-skill', 'SKILL.md')), true);
  assert.equal(await exists(path.join(kaiDir, 'skills', 'conflict-skill', 'SKILL.md')), true);
  assert.equal(await exists(path.join(ctx.home, 'shared', 'skills', 'conflict-skill')), false);
});

test('global plugins use managed projections and deletion archives the canonical source', async (t) => {
  const ctx = await startModuleApp(t);
  const irisDir = path.join(ctx.hermesHome, 'profiles', 'iris');
  const kaiDir = path.join(ctx.hermesHome, 'profiles', 'kai');
  await writePlugin(irisDir, 'sample-plugin');
  await writePlugin(kaiDir, 'sample-plugin');

  const promoteResponse = await fetch(`${ctx.baseUrl}/api/hermes-modules/scope`, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify({ action: 'promote', kind: 'plugin', name: 'sample-plugin', profileName: 'iris' }),
  });
  assert.equal(promoteResponse.status, 200);
  const promoted = await promoteResponse.json();
  assert.equal(promoted.modules.global[0].originProfileName, 'iris');
  for (const profileDir of [ctx.hermesHome, irisDir, kaiDir]) {
    const link = path.join(profileDir, 'plugins', 'sample-plugin');
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    const config = YAML.parse(await readFile(path.join(profileDir, 'config.yaml'), 'utf8'));
    assert.ok(config.plugins.enabled.includes('sample-plugin'));
  }

  const deleteResponse = await fetch(`${ctx.baseUrl}/api/hermes-modules`, {
    method: 'DELETE',
    headers: ctx.headers,
    body: JSON.stringify({ kind: 'plugin', scope: 'global', name: 'sample-plugin' }),
  });
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(await exists(deleted.archivePath), true);
  assert.equal(await exists(path.join(ctx.home, 'shared', 'plugins', 'sample-plugin')), false);
  for (const profileDir of [ctx.hermesHome, irisDir, kaiDir]) {
    assert.equal(await exists(path.join(profileDir, 'plugins', 'sample-plugin')), false);
  }
});
