import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeGateway } from './gateway.mjs';
import { createRuntimeStore } from '../runtime/store.mjs';

async function fixture(kind = 'project') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-knowledge-v2-'));
  const store = createRuntimeStore(path.join(root, 'runtime.db'));
  const vault = { id: 'vault-test', name: 'Test Vault', path: path.join(root, 'vault'), kind, trustedRulePaths: kind === 'project' ? ['FRAKIO.md'] : [] };
  const gateway = createKnowledgeGateway({ store });
  await gateway.initializeVault(vault);
  await gateway.index(vault);
  return { root, store, vault, gateway, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('new vaults use managed v2 defaults and standard directories', async () => {
  const current = await fixture();
  try {
    const manifest = await current.gateway.readManifest(current.vault);
    assert.equal(manifest.version, 2);
    assert.equal(manifest.managementMode, 'managed');
    assert.equal(manifest.autonomy, 'fully_autonomous');
    assert.equal(manifest.curatorPresentation.displayName, '无上的霸王龙');
    assert.equal(manifest.curatorExecution.mode, 'auto');
    assert.deepEqual(manifest.immutableRoots, ['来源']);
    assert.match(await readFile(path.join(current.vault.path, 'index.md'), 'utf8'), /资料库索引/);
    assert.match(await readFile(path.join(current.vault.path, 'FRAKIO.md'), 'utf8'), /项目规则/);
  } finally { await current.close(); }
});

test('curator presentation and avatar stay in managed metadata, outside immutable sources', async () => {
  const current = await fixture();
  try {
    const config = await current.gateway.updateConfig(current.vault, {
      curatorPresentation: { displayName: '项目霸王龙' },
      curatorExecution: { mode: 'follow_agent', timeout: 180 },
      curatorReferenceAgentId: 'max',
    });
    assert.equal(config.curatorPresentation.displayName, '项目霸王龙');
    assert.equal(config.curatorExecution.mode, 'follow_agent');
    assert.equal(config.curatorReferenceAgentId, 'max');
    const updated = await current.gateway.writeCuratorAvatar(current.vault, Buffer.from('avatar'), 'png');
    assert.equal(updated.curatorPresentation.avatarAssetPath, '.frakio/assets/curator-avatar.png');
    assert.equal(await readFile(path.join(current.vault.path, '.frakio/assets/curator-avatar.png'), 'utf8'), 'avatar');
    const removed = await current.gateway.removeCuratorAvatar(current.vault);
    assert.equal(removed.curatorPresentation.avatarAssetPath, '');
  } finally { await current.close(); }
});

test('source admission is explicit and immutable paths reject normal changes', async () => {
  const current = await fixture();
  try {
    const source = await current.gateway.proposeSource(current.vault, { title: 'Runtime Notes', origin: 'https://example.com/runtime', kind: 'url', content: '# Runtime\n\nEvidence.' });
    assert.equal(source.status, 'pending');
    assert.equal(current.store.listKnowledgeJobs(current.vault.id).length, 0);
    const accepted = await current.gateway.acceptSource(current.vault, source.id);
    assert.equal(accepted.source.status, 'accepted');
    assert.equal(accepted.job.status, 'queued');
    assert.match(await readFile(path.join(current.vault.path, accepted.source.relativePath), 'utf8'), /sha256:/);
    await assert.rejects(() => current.gateway.proposeChanges(current.vault, { changes: [{ relativePath: accepted.source.relativePath, content: 'mutated' }] }), /来源目录不可修改/);
  } finally { await current.close(); }
});

test('autonomy publishes low-risk changes, tiered mode reviews edits, and rollback is complete', async () => {
  const current = await fixture();
  try {
    const target = '知识/概念/runtime.md';
    const first = await current.gateway.proposeChanges(current.vault, { summary: 'Create runtime page', changes: [{ relativePath: target, content: '# Runtime\n\n[[index]]\n' }] });
    assert.equal(first.status, 'published');
    assert.match(await readFile(path.join(current.vault.path, target), 'utf8'), /Runtime/);
    await current.gateway.updateConfig(current.vault, { autonomy: 'tiered' });
    const review = await current.gateway.proposeChanges(current.vault, { summary: 'Edit runtime page', changes: [{ relativePath: target, content: '# Runtime V2\n' }] });
    assert.equal(review.status, 'awaiting_review');
    const published = await current.gateway.publishOperation(current.vault, review.id, { reviewedBy: 'test' });
    assert.equal(published.status, 'published');
    assert.match(await readFile(path.join(current.vault.path, target), 'utf8'), /Runtime V2/);
    const rollback = await current.gateway.rollbackOperation(current.vault, review.id);
    assert.equal(rollback.status, 'published');
    assert.match(await readFile(path.join(current.vault.path, target), 'utf8'), /\[\[index\]\]/);
    assert.equal(current.store.getKnowledgeOperation(review.id).rolledBackAt !== null, true);
  } finally { await current.close(); }
});

test('optimistic hashes stop external overwrites and lint records source drift', async () => {
  const current = await fixture();
  try {
    await current.gateway.updateConfig(current.vault, { autonomy: 'all_review' });
    const target = '知识/概念/conflict.md';
    const operation = await current.gateway.proposeChanges(current.vault, { summary: 'Conflict candidate', changes: [{ relativePath: target, content: '# Proposed\n' }] });
    await writeFile(path.join(current.vault.path, target), '# External\n', 'utf8');
    await assert.rejects(() => current.gateway.publishOperation(current.vault, operation.id), /外部修改/);
    assert.equal(current.store.getKnowledgeOperation(operation.id).status, 'conflict');
    const source = await current.gateway.proposeSource(current.vault, { title: 'Drift', kind: 'text', content: 'Original body' });
    const accepted = await current.gateway.acceptSource(current.vault, source.id);
    await writeFile(path.join(current.vault.path, accepted.source.relativePath), '---\nsha256: invalid\n---\nChanged body', 'utf8');
    await current.gateway.index(current.vault);
    const lint = await current.gateway.lint(current.vault);
    assert.equal(lint.issues.some((issue) => issue.code === 'source_drift'), true);
    const query = await current.gateway.query(current.vault, 'term-that-does-not-exist');
    assert.equal(query.answerStatus, 'no_confident_answer');
  } finally { await current.close(); }
});

test('incremental indexing refreshes one external Markdown change', async () => {
  const current = await fixture();
  try {
    const target = '知识/概念/external.md';
    await writeFile(path.join(current.vault.path, target), '# External\n\nUnique incremental token.\n', 'utf8');
    const refreshed = await current.gateway.refreshIndexedFile(current.vault, target);
    assert.equal(refreshed.relativePath, target);
    const results = await current.gateway.search(current.vault, 'incremental');
    assert.equal(results[0].relativePath, target);
    await rm(path.join(current.vault.path, target));
    await current.gateway.refreshIndexedFile(current.vault, target);
    assert.equal(current.store.getVaultDocument(current.vault.id, target), undefined);
  } finally { await current.close(); }
});

test('Obsidian multiline YAML frontmatter is parsed and excluded from preview body', async () => {
  const current = await fixture();
  try {
    const target = '知识/概念/frontmatter.md';
    await writeFile(path.join(current.vault.path, target), '---\ntitle: Frontmatter\ntags:\n  - architecture\n  - runtime\nrelated:\n  - "[[index]]"\ncontested: false\n---\n# Preview Body\n', 'utf8');
    await current.gateway.refreshIndexedFile(current.vault, target);
    const document = current.store.getVaultDocument(current.vault.id, target);
    assert.deepEqual(document.tags, ['architecture', 'runtime']);
    assert.deepEqual(document.frontmatter.related, ['[[index]]']);
    assert.equal(document.frontmatter.contested, false);
    const preview = await current.gateway.read(current.vault, target);
    assert.equal(preview.body, '# Preview Body\n');
  } finally { await current.close(); }
});
