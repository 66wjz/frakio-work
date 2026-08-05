import { createHash, randomUUID } from 'node:crypto';
import { watch as watchFilesystem } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveInsideRoot } from '../lib/path-boundary.mjs';

const MANIFEST_PATH = '.frakio/vault.json';
const MANIFEST_VERSION = 2;
const LIBRARY_DIRS = ['收件箱', '来源', '来源/网页', '来源/文件', '来源/对话', '来源/资产', '知识', '知识/实体', '知识/概念', '知识/比较', '知识/查询', '规则', '.frakio', '.frakio/drafts', '.frakio/history/objects', '.frakio/history/operations', '.frakio/transactions'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.cache', '.frakio']);
const AUTONOMY_MODES = new Set(['fully_autonomous', 'tiered', 'all_review']);
const MANAGEMENT_MODES = new Set(['managed', 'read_only']);
const CURATOR_EXECUTION_MODES = new Set(['auto', 'explicit_model', 'follow_agent']);
const vaultQueues = new Map();

function normalizeRelative(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function hashContent(content) {
  return createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex');
}

function defaultLibraryFiles(kind) {
  const today = new Date().toISOString().slice(0, 10);
  const root = kind === 'project'
    ? { 'FRAKIO.md': '# 项目规则\n\n这里记录当前项目的目标、路径、角色分工和执行流程。只有本文件及其明确引用的 `规则/` 文件会作为受信任规则。\n\n## 知识维护\n\n资料来源先进入待确认；确认后由无上的霸王龙整理到 `知识/`。\n' }
    : { '资料库说明.md': '# 个人资料库\n\n这里保存可以跨项目长期检索的个人知识。资料来源先确认，再由无上的霸王龙整理。\n' };
  return {
    ...root,
    'index.md': `# 资料库索引\n\n> 最后更新：${today} | 页面数：0\n\n## 实体\n\n## 概念\n\n## 比较\n\n## 查询\n`,
    'log.md': `# 资料库活动记录\n\n## ${today} create | 资料库初始化\n\n- 已创建 Frakio Knowledge Runtime V2 标准结构。\n`,
  };
}

function defaultManifest(vault, { existing = false, managementMode, autonomy } = {}) {
  const kind = vault.kind === 'personal' ? 'personal' : 'project';
  const resolvedManagement = MANAGEMENT_MODES.has(managementMode) ? managementMode : existing ? 'read_only' : 'managed';
  return {
    type: kind,
    version: MANIFEST_VERSION,
    indexVersion: Math.max(2, Number(vault.indexVersion || 2)),
    managementMode: resolvedManagement,
    autonomy: AUTONOMY_MODES.has(autonomy) ? autonomy : 'fully_autonomous',
    onboardingStatus: existing ? 'needs_upgrade_confirmation' : 'ready',
    trustedRulePaths: kind === 'project' ? (vault.trustedRulePaths?.length ? vault.trustedRulePaths.map(normalizeRelative) : ['FRAKIO.md']) : [],
    maintenanceRulePaths: kind === 'project' ? ['FRAKIO.md', '规则/知识维护.md'] : ['资料库说明.md', '规则/知识维护.md'],
    writableRoots: ['知识', 'index.md', 'log.md'],
    immutableRoots: ['来源'],
    tagTaxonomy: [],
    templateId: '',
    presentation: { avatarAssetPath: '' },
    maintenanceModel: { profile: 'curator', fallback: 'default' },
    curatorPresentation: { displayName: '无上的霸王龙', avatarAssetPath: '' },
    curatorExecution: { mode: 'auto', provider: '', model: '', timeout: 600, source: 'global' },
    curatorReferenceAgentId: '',
    search: { engine: 'fts5', confidenceThreshold: 0.15 },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeManifest(vault, raw = {}, options = {}) {
  const base = defaultManifest(vault, options);
  const kind = vault.kind === 'personal' ? 'personal' : 'project';
  return {
    ...base,
    ...raw,
    type: kind,
    version: MANIFEST_VERSION,
    managementMode: MANAGEMENT_MODES.has(raw.managementMode) ? raw.managementMode : base.managementMode,
    autonomy: AUTONOMY_MODES.has(raw.autonomy) ? raw.autonomy : base.autonomy,
    trustedRulePaths: kind === 'project' ? (Array.isArray(raw.trustedRulePaths) ? raw.trustedRulePaths.map(normalizeRelative) : base.trustedRulePaths) : [],
    maintenanceRulePaths: Array.isArray(raw.maintenanceRulePaths) ? raw.maintenanceRulePaths.map(normalizeRelative) : base.maintenanceRulePaths,
    writableRoots: Array.isArray(raw.writableRoots) ? raw.writableRoots.map(normalizeRelative) : base.writableRoots,
    immutableRoots: Array.isArray(raw.immutableRoots) ? raw.immutableRoots.map(normalizeRelative) : base.immutableRoots,
    tagTaxonomy: Array.isArray(raw.tagTaxonomy) ? raw.tagTaxonomy.map(String) : base.tagTaxonomy,
    maintenanceModel: { ...base.maintenanceModel, ...(raw.maintenanceModel || {}) },
    presentation: {
      avatarAssetPath: /^\.frakio\/assets\/vault-avatar\.(png|jpe?g|webp|gif)$/i.test(String(raw.presentation?.avatarAssetPath || '').trim()) ? String(raw.presentation.avatarAssetPath).trim() : '',
    },
    curatorPresentation: {
      displayName: String(raw.curatorPresentation?.displayName || base.curatorPresentation.displayName).trim().slice(0, 48) || base.curatorPresentation.displayName,
      avatarAssetPath: /^\.frakio\/assets\/curator-avatar\.(png|jpe?g|webp|gif)$/i.test(String(raw.curatorPresentation?.avatarAssetPath || '').trim()) ? String(raw.curatorPresentation.avatarAssetPath).trim() : '',
    },
    curatorExecution: {
      mode: CURATOR_EXECUTION_MODES.has(raw.curatorExecution?.mode) ? raw.curatorExecution.mode : base.curatorExecution.mode,
      provider: String(raw.curatorExecution?.provider || '').trim().slice(0, 120),
      model: String(raw.curatorExecution?.model || '').trim().slice(0, 200),
      timeout: Math.max(30, Math.min(900, Number(raw.curatorExecution?.timeout || base.curatorExecution.timeout))),
      source: String(raw.curatorExecution?.source || base.curatorExecution.source).trim().slice(0, 40),
    },
    curatorReferenceAgentId: String(raw.curatorReferenceAgentId || '').trim().slice(0, 120),
    search: { ...base.search, ...(raw.search || {}) },
    updatedAt: new Date().toISOString(),
  };
}

async function markdownFiles(root, directory = root, rows = []) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await markdownFiles(root, fullPath, rows);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const info = await stat(fullPath).catch(() => null);
    if (!info || info.size > 2 * 1024 * 1024) continue;
    rows.push({ fullPath, relativePath: path.relative(root, fullPath).replaceAll('\\', '/'), size: info.size, updatedAt: info.mtime.toISOString() });
  }
  return rows;
}

async function visibleDirectories(root, directory = root, rows = []) {
  rows.push(directory);
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    await visibleDirectories(root, path.join(directory, entry.name), rows);
  }
  return rows;
}

function linkedMarkdownPaths(content) {
  const paths = new Set();
  for (const match of String(content || '').matchAll(/\[[^\]]*\]\(([^)#?]+\.md)(?:#[^)]+)?\)/gi)) paths.add(normalizeRelative(decodeURIComponent(match[1])));
  for (const match of String(content || '').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const raw = normalizeRelative(match[1]);
    paths.add(raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`);
  }
  return [...paths];
}

function parseFrontmatter(content) {
  const source = String(content || '').replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: {}, body: source };
  try {
    const parsed = parseYaml(match[1]);
    const frontmatter = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return { frontmatter, body: source.slice(match[0].length) };
  } catch {
    return { frontmatter: {}, body: source.slice(match[0].length) };
  }
}

function documentMetadata(relativePath, content, updatedAt) {
  const { frontmatter } = parseFrontmatter(content);
  const heading = String(content).match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  return {
    relativePath,
    content,
    title: String(frontmatter.title || heading || path.basename(relativePath, '.md')),
    type: String(frontmatter.type || (relativePath.startsWith('知识/实体/') ? 'entity' : relativePath.startsWith('知识/概念/') ? 'concept' : relativePath.startsWith('知识/比较/') ? 'comparison' : relativePath.startsWith('知识/查询/') ? 'query' : '')),
    contentHash: hashContent(content),
    frontmatter,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    confidence: String(frontmatter.confidence || ''),
    sources: Array.isArray(frontmatter.sources) ? frontmatter.sources : [],
    updatedAt,
  };
}

async function writeIfMissing(target, content) {
  try {
    await stat(target);
  } catch {
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  }
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.frakio-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

async function readMaybe(target) {
  return readFile(target, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
}

function withVaultLock(vaultId, task) {
  const previous = vaultQueues.get(vaultId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  vaultQueues.set(vaultId, current);
  return current.finally(() => {
    if (vaultQueues.get(vaultId) === current) vaultQueues.delete(vaultId);
  });
}

function safeSourceName(title, kind) {
  const extension = kind === 'markdown' ? '.md' : '.md';
  const stem = String(title || 'source').normalize('NFKC').replace(/[\\/:*?"<>|#\[\]]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'source';
  return `${stem}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}${extension}`;
}

function sourceDirectory(kind) {
  if (kind === 'url' || kind === 'web') return '来源/网页';
  if (kind === 'conversation') return '来源/对话';
  if (kind === 'asset') return '来源/资产';
  return '来源/文件';
}

function isPathWithin(relativePath, root) {
  return relativePath === root || relativePath.startsWith(`${root}/`);
}

export function createKnowledgeGateway({ store }) {
  async function readManifest(vault) {
    const root = path.resolve(vault.path);
    const raw = await readFile(resolveInsideRoot(root, path.join(root, MANIFEST_PATH)), 'utf8').catch(() => '');
    if (!raw) return defaultManifest(vault, { existing: true });
    try {
      return normalizeManifest(vault, JSON.parse(raw), { existing: true });
    } catch {
      throw new Error('资料库 manifest 无法解析。');
    }
  }

  async function writeManifest(vault, manifest) {
    const root = path.resolve(vault.path);
    const normalized = normalizeManifest(vault, manifest, { existing: true });
    await atomicWrite(resolveInsideRoot(root, path.join(root, MANIFEST_PATH)), `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  }

  function validateManagedPath(manifest, relativePath, { allowRules = false } = {}) {
    const safeRelative = normalizeRelative(relativePath);
    if (!safeRelative || safeRelative.startsWith('.frakio/') || safeRelative === MANIFEST_PATH) throw new Error('变更路径不在资料库可写范围内。');
    if (manifest.immutableRoots.some((root) => isPathWithin(safeRelative, root))) throw new Error('来源目录不可修改，只能通过来源确认流程写入。');
    const allowed = manifest.writableRoots.some((root) => isPathWithin(safeRelative, root)) || (allowRules && (safeRelative === 'FRAKIO.md' || safeRelative === '资料库说明.md' || safeRelative.startsWith('规则/')));
    if (!allowed) throw new Error(`路径 ${safeRelative} 不在 manifest 的可写范围内。`);
    return safeRelative;
  }

  function requiresReview(manifest, files, metadata = {}) {
    if (manifest.managementMode !== 'managed') return true;
    if (manifest.autonomy === 'all_review') return true;
    if (files.length > 10 || metadata.contradictionResolution) return true;
    if (files.some((file) => file.action === 'delete' || file.relativePath.startsWith('规则/') || ['FRAKIO.md', '资料库说明.md'].includes(file.relativePath))) return true;
    if (manifest.autonomy === 'tiered' && files.some((file) => file.beforeContent !== null)) return true;
    return false;
  }

  async function storeHistoryObject(root, content) {
    if (content === null || content === undefined) return '';
    const digest = hashContent(content);
    const target = resolveInsideRoot(root, path.join(root, '.frakio/history/objects', digest));
    await writeIfMissing(target, String(content));
    return digest;
  }

  async function indexVault(vault) {
    const root = path.resolve(vault.path);
    const files = await markdownFiles(root);
    const documents = [];
    const links = [];
    for (const file of files) {
      const content = await readFile(file.fullPath, 'utf8').catch(() => '');
      documents.push(documentMetadata(file.relativePath, content, file.updatedAt));
      for (const target of linkedMarkdownPaths(content)) links.push({ from: file.relativePath, to: target, type: 'wikilink' });
    }
    store.replaceVaultDocuments?.(vault.id, documents);
    store.replaceVaultLinks?.(vault.id, links);
    return {
      documentCount: files.length,
      files: files.map(({ relativePath, size, updatedAt }) => ({ relativePath, size, updatedAt })),
      links,
      backlinks: links.reduce((map, link) => ({ ...map, [link.to]: [...(map[link.to] || []), link.from] }), {}),
      indexedAt: new Date().toISOString(),
    };
  }

  async function refreshIndexedFile(vault, relativePath) {
    const safeRelative = normalizeRelative(relativePath);
    if (!safeRelative.toLowerCase().endsWith('.md') || safeRelative.startsWith('.frakio/') || safeRelative.split('/').some((part) => part.startsWith('.'))) return null;
    const root = path.resolve(vault.path);
    const target = resolveInsideRoot(root, path.join(root, safeRelative));
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      store.removeVaultDocument?.(vault.id, safeRelative);
      return { relativePath: safeRelative, removed: true };
    }
    if (info.size > 2 * 1024 * 1024) return null;
    const content = await readFile(target, 'utf8');
    const document = documentMetadata(safeRelative, content, info.mtime.toISOString());
    store.upsertVaultDocument?.(vault.id, document);
    store.replaceVaultDocumentLinks?.(vault.id, safeRelative, linkedMarkdownPaths(content).map((to) => ({ from: safeRelative, to, type: 'wikilink' })));
    return { relativePath: safeRelative, removed: false, contentHash: document.contentHash, updatedAt: document.updatedAt };
  }

  async function appendHumanLog(vault, operation, verb) {
    const root = path.resolve(vault.path);
    const logPath = resolveInsideRoot(root, path.join(root, 'log.md'));
    const paths = (operation.files || []).map((file) => `- ${file.action}: \`${file.relativePath}\``).join('\n');
    await appendFile(logPath, `\n## ${new Date().toISOString().slice(0, 10)} ${verb} | ${operation.summary || operation.id}\n\n${paths}\n`, 'utf8');
  }

  async function publishOperation(vault, operationId, { reviewedBy = '' } = {}) {
    return withVaultLock(vault.id, async () => {
      const operation = store.getKnowledgeOperation?.(operationId);
      if (!operation || operation.vaultId !== vault.id) throw new Error('知识操作不存在。');
      if (!['proposed', 'awaiting_review'].includes(operation.status)) throw new Error('这个操作当前不可发布。');
      const manifest = await readManifest(vault);
      if (manifest.managementMode !== 'managed') throw new Error('资料库当前为只读连接，不能发布变更。');
      const root = path.resolve(vault.path);
      const stageRoot = resolveInsideRoot(root, path.join(root, '.frakio/transactions', operation.id));
      await rm(stageRoot, { recursive: true, force: true });
      await mkdir(path.join(stageRoot, 'new'), { recursive: true });
      await mkdir(path.join(stageRoot, 'before'), { recursive: true });
      const prepared = [];
      for (const file of operation.files) {
        const relativePath = validateManagedPath(manifest, file.relativePath, { allowRules: operation.kind === 'rule_change' });
        const target = resolveInsideRoot(root, path.join(root, relativePath));
        const current = await readMaybe(target);
        const currentHash = current === null ? '' : hashContent(current);
        if (currentHash !== String(file.baseHash || '')) {
          store.updateKnowledgeOperation?.(operation.id, { status: 'conflict', metadata: { ...operation.metadata, conflictPath: relativePath, expectedHash: file.baseHash, actualHash: currentHash } });
          throw new Error(`文件 ${relativePath} 已被外部修改，操作已转入冲突处理。`);
        }
        if (file.action !== 'delete') {
          const staged = resolveInsideRoot(stageRoot, path.join(stageRoot, 'new', relativePath));
          await mkdir(path.dirname(staged), { recursive: true });
          await writeFile(staged, String(file.afterContent ?? ''), { encoding: 'utf8', mode: 0o600 });
        }
        await storeHistoryObject(root, current);
        await storeHistoryObject(root, file.action === 'delete' ? null : file.afterContent);
        prepared.push({ ...file, relativePath, target, current });
      }
      const movedBefore = [];
      const installed = [];
      let manifestChanged = false;
      try {
        for (const file of prepared) {
          if (file.current !== null) {
            const backup = resolveInsideRoot(stageRoot, path.join(stageRoot, 'before', file.relativePath));
            await mkdir(path.dirname(backup), { recursive: true });
            await rename(file.target, backup);
            movedBefore.push({ target: file.target, backup });
          }
        }
        for (const file of prepared) {
          if (file.action === 'delete') continue;
          const staged = resolveInsideRoot(stageRoot, path.join(stageRoot, 'new', file.relativePath));
          await mkdir(path.dirname(file.target), { recursive: true });
          await rename(staged, file.target);
          installed.push(file.target);
        }
        if (operation.kind === 'rule_change' && operation.metadata?.manifestPatch) {
          const requested = operation.metadata.manifestPatch;
          const manifestPatch = {};
          if (Array.isArray(requested.trustedRulePaths)) manifestPatch.trustedRulePaths = requested.trustedRulePaths.map(normalizeRelative);
          if (Array.isArray(requested.maintenanceRulePaths)) manifestPatch.maintenanceRulePaths = requested.maintenanceRulePaths.map(normalizeRelative);
          if (requested.roleBindings && typeof requested.roleBindings === 'object') manifestPatch.roleBindings = requested.roleBindings;
          if (Array.isArray(requested.tagTaxonomy)) manifestPatch.tagTaxonomy = requested.tagTaxonomy.map(String);
          await writeManifest(vault, { ...manifest, ...manifestPatch });
          manifestChanged = true;
        }
      } catch (error) {
        for (const target of installed.reverse()) await unlink(target).catch(() => {});
        for (const item of movedBefore.reverse()) await rename(item.backup, item.target).catch(() => {});
        if (manifestChanged) await writeManifest(vault, manifest).catch(() => {});
        throw error;
      }
      const publishedAt = new Date().toISOString();
      const updated = store.updateKnowledgeOperation?.(operation.id, { status: 'published', publishedAt, metadata: { ...operation.metadata, reviewedBy } });
      await atomicWrite(resolveInsideRoot(root, path.join(root, '.frakio/history/operations', `${operation.id}.json`)), `${JSON.stringify(updated, null, 2)}\n`);
      await appendHumanLog(vault, updated, 'publish');
      await rm(stageRoot, { recursive: true, force: true });
      await indexVault(vault);
      return updated;
    });
  }

  const api = {
    async initializeVault(vault, options = {}) {
      const root = path.resolve(vault.path);
      const kind = vault.kind === 'personal' ? 'personal' : 'project';
      const manifestTarget = resolveInsideRoot(root, path.join(root, MANIFEST_PATH));
      const existingManifestRaw = await readFile(manifestTarget, 'utf8').catch(() => '');
      const hadExistingContent = (await readdir(root).catch(() => [])).length > 0;
      await mkdir(root, { recursive: true });
      await Promise.all(LIBRARY_DIRS.map((directory) => mkdir(path.join(root, directory), { recursive: true })));
      for (const [relativePath, content] of Object.entries(defaultLibraryFiles(kind))) await writeIfMissing(resolveInsideRoot(root, path.join(root, relativePath)), content);
      let previous = {};
      try { previous = existingManifestRaw ? JSON.parse(existingManifestRaw) : {}; } catch { previous = {}; }
      const existing = Boolean(existingManifestRaw || hadExistingContent);
      const manifest = normalizeManifest(vault, previous, {
        existing,
        managementMode: options.managementMode || (existing && !existingManifestRaw ? 'read_only' : undefined),
        autonomy: options.autonomy,
      });
      if (options.managementMode) manifest.managementMode = options.managementMode;
      if (options.autonomy) manifest.autonomy = options.autonomy;
      if (options.confirmUpgrade) manifest.onboardingStatus = 'ready';
      await atomicWrite(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`);
      return { root, manifestPath: MANIFEST_PATH, manifest, directories: LIBRARY_DIRS, files: Object.keys(defaultLibraryFiles(kind)) };
    },
    readManifest,
    async updateConfig(vault, patch = {}) {
      const current = await readManifest(vault);
      const next = { ...current };
      if (MANAGEMENT_MODES.has(patch.managementMode)) next.managementMode = patch.managementMode;
      if (AUTONOMY_MODES.has(patch.autonomy)) next.autonomy = patch.autonomy;
      if (patch.onboardingStatus) next.onboardingStatus = String(patch.onboardingStatus);
      if (patch.templateId !== undefined) next.templateId = String(patch.templateId || '');
      if (patch.maintenanceModel && typeof patch.maintenanceModel === 'object') next.maintenanceModel = { ...current.maintenanceModel, ...patch.maintenanceModel };
      if (patch.curatorPresentation && typeof patch.curatorPresentation === 'object') next.curatorPresentation = { ...current.curatorPresentation, ...patch.curatorPresentation };
      if (patch.curatorExecution && typeof patch.curatorExecution === 'object') next.curatorExecution = { ...current.curatorExecution, ...patch.curatorExecution };
      if (patch.curatorReferenceAgentId !== undefined) next.curatorReferenceAgentId = String(patch.curatorReferenceAgentId || '');
      return writeManifest(vault, next);
    },
    async detail(vault) {
      const manifest = await readManifest(vault);
      const documents = store.listVaultDocuments?.(vault.id) || [];
      const operations = store.listKnowledgeOperations?.(vault.id, { limit: 30 }) || [];
      const issues = store.listKnowledgeIssues?.(vault.id) || [];
      const jobs = store.listKnowledgeJobs?.(vault.id, { limit: 30 }) || [];
      const sources = store.listKnowledgeSources?.(vault.id, { limit: 30 }) || [];
      return {
        vault: { ...vault, managementMode: manifest.managementMode, autonomy: manifest.autonomy, onboardingStatus: manifest.onboardingStatus },
        config: manifest,
        stats: { documents: documents.length, sources: sources.filter((source) => source.status === 'accepted').length, pending: operations.filter((operation) => operation.status === 'awaiting_review').length + sources.filter((source) => source.status === 'pending').length, issues: issues.length },
        recentOperations: operations,
        recentJobs: jobs,
        sources,
        issues,
      };
    },
    async tree(vault) {
      const files = await markdownFiles(path.resolve(vault.path));
      return files.map(({ relativePath, size, updatedAt }) => ({ relativePath, name: path.basename(relativePath), directory: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath), size, updatedAt }));
    },
    async writeCuratorAvatar(vault, buffer, extension = 'png') {
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('头像大小需小于 3MB。');
      const root = path.resolve(vault.path);
      const safeExtension = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(String(extension).toLowerCase()) ? String(extension).toLowerCase() : 'png';
      const assetsRoot = resolveInsideRoot(root, path.join(root, '.frakio/assets'));
      await mkdir(assetsRoot, { recursive: true });
      for (const entry of await readdir(assetsRoot, { withFileTypes: true }).catch(() => [])) {
        if (entry.isFile() && /^curator-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name)) await unlink(path.join(assetsRoot, entry.name)).catch(() => {});
      }
      const relativePath = `.frakio/assets/curator-avatar.${safeExtension}`;
      await atomicWrite(resolveInsideRoot(root, path.join(root, relativePath)), buffer);
      const manifest = await readManifest(vault);
      return writeManifest(vault, { ...manifest, curatorPresentation: { ...manifest.curatorPresentation, avatarAssetPath: relativePath } });
    },
    async removeCuratorAvatar(vault) {
      const root = path.resolve(vault.path);
      const manifest = await readManifest(vault);
      const relativePath = manifest.curatorPresentation?.avatarAssetPath || '.frakio/assets/curator-avatar.png';
      await unlink(resolveInsideRoot(root, path.join(root, relativePath))).catch(() => {});
      return writeManifest(vault, { ...manifest, curatorPresentation: { ...manifest.curatorPresentation, avatarAssetPath: '' } });
    },
    async writeVaultAvatar(vault, buffer, extension = 'png') {
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('头像大小需小于 3MB。');
      const root = path.resolve(vault.path);
      const safeExtension = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(String(extension).toLowerCase()) ? String(extension).toLowerCase() : 'png';
      const assetsRoot = resolveInsideRoot(root, path.join(root, '.frakio/assets'));
      await mkdir(assetsRoot, { recursive: true });
      for (const entry of await readdir(assetsRoot, { withFileTypes: true }).catch(() => [])) {
        if (entry.isFile() && /^vault-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name)) await unlink(path.join(assetsRoot, entry.name)).catch(() => {});
      }
      const relativePath = `.frakio/assets/vault-avatar.${safeExtension}`;
      await atomicWrite(resolveInsideRoot(root, path.join(root, relativePath)), buffer);
      const manifest = await readManifest(vault);
      return writeManifest(vault, { ...manifest, presentation: { ...manifest.presentation, avatarAssetPath: relativePath } });
    },
    async removeVaultAvatar(vault) {
      const root = path.resolve(vault.path);
      const manifest = await readManifest(vault);
      const relativePath = manifest.presentation?.avatarAssetPath || '.frakio/assets/vault-avatar.png';
      await unlink(resolveInsideRoot(root, path.join(root, relativePath))).catch(() => {});
      return writeManifest(vault, { ...manifest, presentation: { ...manifest.presentation, avatarAssetPath: '' } });
    },
    async search(vault, query, { limit = 20 } = {}) {
      const clean = String(query || '').trim().toLowerCase();
      if (!clean) return [];
      const manifest = await readManifest(vault);
      const indexed = store.searchVaultDocuments?.(vault.id, clean, limit) || [];
      if (indexed.length) return indexed.map((result) => ({ ...result, confident: result.score >= Number(manifest.search?.confidenceThreshold || 0.15) }));
      const files = await markdownFiles(path.resolve(vault.path));
      const matches = [];
      for (const file of files) {
        const content = await readFile(file.fullPath, 'utf8').catch(() => '');
        const lower = content.toLowerCase();
        const index = lower.indexOf(clean);
        if (index < 0 && !file.relativePath.toLowerCase().includes(clean)) continue;
        matches.push({ relativePath: file.relativePath, sourcePath: file.relativePath, citation: `[[${file.relativePath.replace(/\.md$/i, '')}]]`, summary: index >= 0 ? content.slice(Math.max(0, index - 100), Math.min(content.length, index + clean.length + 300)).replace(/\s+/g, ' ').trim() : file.relativePath, updatedAt: file.updatedAt, score: 1, confident: true });
        if (matches.length >= Math.max(1, Math.min(100, Number(limit) || 20))) break;
      }
      return matches;
    },
    async query(vault, query, options = {}) {
      const results = await api.search(vault, query, options);
      const confident = results.filter((result) => result.confident !== false);
      return { results, confident: confident.length > 0, answerStatus: confident.length ? 'grounded' : 'no_confident_answer', message: confident.length ? '' : '资料库没有可信答案。' };
    },
    async read(vault, relativePath) {
      const root = path.resolve(vault.path);
      const safeRelative = normalizeRelative(relativePath);
      const target = resolveInsideRoot(root, path.join(root, safeRelative));
      const info = await stat(target);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('资料库文件不可读取。');
      const content = await readFile(target, 'utf8');
      const document = store.getVaultDocument?.(vault.id, safeRelative);
      const links = store.listVaultLinks?.(vault.id, { sourcePath: safeRelative }) || [];
      const backlinks = store.listVaultLinks?.(vault.id, { targetPath: safeRelative }) || [];
      const parsed = parseFrontmatter(content);
      return { relativePath: safeRelative, content, body: parsed.body, frontmatter: document?.frontmatter || parsed.frontmatter, links, backlinks: backlinks.map((link) => link.from), updatedAt: info.mtime.toISOString() };
    },
    async trustedRules(vault) {
      if (!vault || vault.kind !== 'project') return [];
      const root = path.resolve(vault.path);
      const manifest = await readManifest(vault);
      const entryPaths = new Set((manifest.trustedRulePaths?.length ? manifest.trustedRulePaths : ['FRAKIO.md']).map(normalizeRelative));
      const entry = await readFile(resolveInsideRoot(root, path.join(root, 'FRAKIO.md')), 'utf8').catch(() => '');
      for (const linked of linkedMarkdownPaths(entry)) if (linked.startsWith('规则/')) entryPaths.add(linked);
      const rules = [];
      let total = 0;
      for (const relativePath of [...entryPaths].slice(0, 24)) {
        if (relativePath !== 'FRAKIO.md' && !relativePath.startsWith('规则/')) continue;
        const content = await readFile(resolveInsideRoot(root, path.join(root, relativePath)), 'utf8').catch(() => '');
        if (!content) continue;
        const clipped = content.slice(0, Math.max(0, 40_000 - total));
        if (!clipped) break;
        rules.push({ relativePath, content: clipped });
        total += clipped.length;
      }
      return rules;
    },
    async proposeSource(vault, input = {}) {
      const content = String(input.content || '');
      if (!content.trim()) throw new Error('来源内容不能为空。');
      const origin = String(input.origin || input.url || '').trim();
      const contentHash = hashContent(content);
      const duplicate = store.findKnowledgeSource?.({ vaultId: vault.id, origin, contentHash });
      const status = duplicate?.contentHash === contentHash ? 'duplicate' : duplicate ? 'drifted' : 'pending';
      return store.putKnowledgeSource?.({
        vaultId: vault.id,
        kind: String(input.kind || (input.url ? 'url' : 'text')),
        title: String(input.title || origin || '未命名来源'),
        origin,
        contentHash,
        status,
        metadata: { content, mimeType: input.mimeType || 'text/markdown', previousSourceId: duplicate?.id || '', proposedBy: input.proposedBy || {} },
      });
    },
    async acceptSource(vault, sourceId) {
      return withVaultLock(vault.id, async () => {
        const source = store.getKnowledgeSource?.(sourceId);
        if (!source || source.vaultId !== vault.id) throw new Error('来源候选不存在。');
        if (!['pending', 'drifted'].includes(source.status)) throw new Error('这个来源当前不可收录。');
        const root = path.resolve(vault.path);
        const relativePath = path.posix.join(sourceDirectory(source.kind), safeSourceName(source.title, source.kind));
        const target = resolveInsideRoot(root, path.join(root, relativePath));
        if (await readMaybe(target) !== null) throw new Error('来源目标路径已存在。');
        const body = String(source.metadata?.content || '');
        const frontmatter = `---\nsource_url: ${source.origin || ''}\ningested: ${new Date().toISOString().slice(0, 10)}\nsha256: ${hashContent(body)}\n---\n`;
        await atomicWrite(target, `${frontmatter}${body}`);
        const accepted = store.updateKnowledgeSource?.(source.id, { status: 'accepted', relativePath, contentHash: hashContent(body), acceptedAt: new Date().toISOString(), metadata: { ...source.metadata, content: undefined } });
        const job = store.putKnowledgeJob?.({ vaultId: vault.id, triggerKey: `source:${source.id}`, kind: 'ingest', input: { sourceId: source.id, relativePath }, modelSnapshot: { profile: 'curator', fallback: 'default' } });
        await appendFile(resolveInsideRoot(root, path.join(root, 'log.md')), `\n## ${new Date().toISOString().slice(0, 10)} ingest | ${source.title}\n\n- 来源：\`${relativePath}\`\n- 维护任务：\`${job.id}\`\n`, 'utf8');
        await indexVault(vault);
        return { source: accepted, job };
      });
    },
    rejectSource(vault, sourceId) {
      const source = store.getKnowledgeSource?.(sourceId);
      if (!source || source.vaultId !== vault.id) throw new Error('来源候选不存在。');
      return store.updateKnowledgeSource?.(sourceId, { status: 'rejected' });
    },
    async proposeChanges(vault, input = {}) {
      const manifest = await readManifest(vault);
      if (manifest.managementMode !== 'managed') throw new Error('资料库当前为只读连接，只能生成预览。');
      const root = path.resolve(vault.path);
      const files = [];
      const allowRules = input.kind === 'rule_change';
      for (const change of input.changes || []) {
        const relativePath = validateManagedPath(manifest, change.relativePath || change.path, { allowRules });
        const target = resolveInsideRoot(root, path.join(root, relativePath));
        const beforeContent = await readMaybe(target);
        const action = change.action === 'delete' ? 'delete' : 'write';
        const afterContent = action === 'delete' ? null : String(change.content ?? change.afterContent ?? '');
        files.push({ relativePath, action, baseHash: String(change.baseHash ?? (beforeContent === null ? '' : hashContent(beforeContent))), beforeHash: beforeContent === null ? '' : hashContent(beforeContent), afterHash: afterContent === null ? '' : hashContent(afterContent), beforeContent, afterContent, metadata: change.metadata || {} });
      }
      if (!files.length) throw new Error('变更集不能为空。');
      const review = requiresReview(manifest, files, input.metadata || {});
      const operation = store.putKnowledgeOperation?.({ vaultId: vault.id, jobId: input.jobId || '', kind: input.kind || 'change_set', status: review ? 'awaiting_review' : 'proposed', summary: input.summary || `更新 ${files.length} 个资料库文件`, risk: input.risk || (review ? 'review' : 'normal'), requiresReview: review, actor: input.actor || { type: 'system', name: 'Frakio 知识维护' }, metadata: input.metadata || {}, files });
      if (!review) return publishOperation(vault, operation.id);
      return operation;
    },
    publishOperation,
    rejectOperation(vault, operationId, reason = '') {
      const operation = store.getKnowledgeOperation?.(operationId);
      if (!operation || operation.vaultId !== vault.id) throw new Error('知识操作不存在。');
      return store.updateKnowledgeOperation?.(operationId, { status: 'rejected', rejectedAt: new Date().toISOString(), metadata: { ...operation.metadata, rejectionReason: reason } });
    },
    async rollbackOperation(vault, operationId, { actor = { type: 'user' } } = {}) {
      const original = store.getKnowledgeOperation?.(operationId);
      if (!original || original.vaultId !== vault.id || original.status !== 'published') throw new Error('只有已发布操作可以回滚。');
      const root = path.resolve(vault.path);
      const changes = [];
      for (const file of original.files) {
        const current = await readMaybe(resolveInsideRoot(root, path.join(root, file.relativePath)));
        const expected = file.afterContent === null ? '' : hashContent(file.afterContent);
        const currentHash = current === null ? '' : hashContent(current);
        if (currentHash !== expected) throw new Error(`文件 ${file.relativePath} 已在发布后变化，不能自动回滚。`);
        changes.push({ relativePath: file.relativePath, action: file.beforeContent === null ? 'delete' : 'write', content: file.beforeContent, baseHash: currentHash });
      }
      const rollback = store.putKnowledgeOperation?.({ vaultId: vault.id, kind: 'rollback', status: 'proposed', summary: `回滚：${original.summary || original.id}`, risk: 'reviewed', requiresReview: false, actor, metadata: { rollbackOf: original.id }, files: await Promise.all(changes.map(async (change) => {
        const beforeContent = await readMaybe(resolveInsideRoot(root, path.join(root, change.relativePath)));
        const afterContent = change.action === 'delete' ? null : change.content;
        return { ...change, beforeContent, afterContent, beforeHash: beforeContent === null ? '' : hashContent(beforeContent), afterHash: afterContent === null ? '' : hashContent(afterContent) };
      })) });
      const published = await publishOperation(vault, rollback.id, { reviewedBy: 'rollback' });
      store.updateKnowledgeOperation?.(original.id, { rolledBackAt: new Date().toISOString(), metadata: { ...original.metadata, rollbackOperationId: published.id } });
      return published;
    },
    async proposeRuleChange(vault, input = {}) {
      return api.proposeChanges(vault, { ...input, kind: 'rule_change', risk: 'rules', metadata: { ...(input.metadata || {}), ruleChange: true, ...(input.manifestPatch ? { manifestPatch: input.manifestPatch } : {}) } });
    },
    async draftWrite({ workspace, vault, runId, relativePath, content }) {
      const safeRunId = String(runId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '-');
      const requested = normalizeRelative(relativePath).replace(/^(?:drafts|\.frakio\/drafts)\/[^/]+\//, '');
      if (!requested || !requested.toLowerCase().endsWith('.md')) throw new Error('资料库草稿必须使用 .md 路径。');
      const draftRelativePath = path.posix.join('.frakio/drafts', safeRunId, requested);
      const root = path.resolve(vault.path);
      const target = resolveInsideRoot(root, path.join(root, draftRelativePath));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, String(content || ''), { encoding: 'utf8', mode: 0o600 });
      const commit = store.appendKnowledgeCommit({ workspaceId: workspace.id, vaultId: vault.id, runId, operation: 'draft.write', relativePath: draftRelativePath });
      return { relativePath: draftRelativePath, commit };
    },
    async publish({ workspace, vault, runId, draftPath, targetPath = '' }) {
      const root = path.resolve(vault.path);
      const normalizedDraft = normalizeRelative(draftPath);
      const runRoot = `.frakio/drafts/${String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}/`;
      if (!normalizedDraft.startsWith(runRoot)) throw new Error('只能发布当前运行创建的资料库草稿。');
      const targetRelative = normalizeRelative(targetPath) || path.posix.join('知识', normalizedDraft.slice(runRoot.length));
      const content = await readFile(resolveInsideRoot(root, path.join(root, normalizedDraft)), 'utf8');
      const operation = await api.proposeChanges(vault, { summary: `发布草稿 ${targetRelative}`, actor: { type: 'runtime', runId }, changes: [{ relativePath: targetRelative, content }] });
      if (operation.status === 'published') await unlink(resolveInsideRoot(root, path.join(root, normalizedDraft))).catch(() => {});
      const commit = store.appendKnowledgeCommit({ workspaceId: workspace.id, vaultId: vault.id, runId, operation: operation.status === 'published' ? 'publish' : 'publish.proposed', relativePath: targetRelative, sourcePath: normalizedDraft, metadata: { operationId: operation.id } });
      return { relativePath: targetRelative, operation, commit };
    },
    async index(vault) {
      return indexVault(vault);
    },
    indexSnapshot(vault) {
      const documents = store.listVaultDocuments?.(vault.id) || [];
      const links = store.listVaultLinks?.(vault.id) || [];
      return {
        documentCount: documents.length,
        files: documents.map((document) => ({ relativePath: document.relativePath, updatedAt: document.updatedAt, contentHash: document.contentHash })),
        links,
        backlinks: links.reduce((map, link) => ({ ...map, [link.to]: [...(map[link.to] || []), link.from] }), {}),
      };
    },
    refreshIndexedFile,
    async watch(vault, onChange = () => {}) {
      const root = path.resolve(vault.path);
      const watchers = [];
      const pending = new Map();
      const schedule = (relativePath) => {
        const safeRelative = normalizeRelative(relativePath);
        if (!safeRelative) return;
        clearTimeout(pending.get(safeRelative));
        const timer = setTimeout(() => {
          pending.delete(safeRelative);
          void refreshIndexedFile(vault, safeRelative).then((result) => result && onChange(result)).catch(() => {});
        }, 120);
        timer.unref?.();
        pending.set(safeRelative, timer);
      };
      const attach = (directory, recursive = false) => {
        const watcher = watchFilesystem(directory, { recursive }, (_event, filename) => {
          if (!filename) return;
          schedule(path.relative(root, path.join(directory, String(filename))).replaceAll('\\', '/'));
        });
        watcher.on('error', () => {});
        watcher.unref?.();
        watchers.push(watcher);
      };
      try {
        attach(root, true);
      } catch {
        for (const directory of await visibleDirectories(root)) attach(directory, false);
      }
      return { close() { for (const timer of pending.values()) clearTimeout(timer); pending.clear(); for (const watcher of watchers) watcher.close(); } };
    },
    async lint(vault) {
      const manifest = await readManifest(vault);
      const documents = store.listVaultDocuments?.(vault.id) || [];
      if (!documents.length) await indexVault(vault);
      const currentDocuments = store.listVaultDocuments?.(vault.id) || [];
      const links = store.listVaultLinks?.(vault.id) || [];
      const paths = new Set(currentDocuments.map((document) => document.relativePath));
      const stems = new Map(currentDocuments.map((document) => [document.relativePath.replace(/\.md$/i, ''), document.relativePath]));
      const issues = [];
      const resolveLink = (target) => paths.has(target) ? target : stems.get(target.replace(/\.md$/i, '')) || currentDocuments.find((document) => path.basename(document.relativePath, '.md') === path.basename(target, '.md'))?.relativePath || '';
      for (const link of links) if (!resolveLink(link.to)) issues.push({ code: 'broken_link', severity: 'error', relativePath: link.from, message: `链接目标不存在：${link.to}`, metadata: { target: link.to } });
      const inbound = new Set(links.map((link) => resolveLink(link.to)).filter(Boolean));
      for (const document of currentDocuments.filter((item) => item.relativePath.startsWith('知识/'))) {
        if (!inbound.has(document.relativePath)) issues.push({ code: 'orphan', severity: 'warning', relativePath: document.relativePath, message: '页面没有任何反向链接。' });
        const required = ['title', 'created', 'updated', 'type', 'tags', 'sources'];
        const missing = required.filter((key) => document.frontmatter?.[key] === undefined);
        if (missing.length) issues.push({ code: 'frontmatter', severity: 'warning', relativePath: document.relativePath, message: `缺少 frontmatter 字段：${missing.join(', ')}`, metadata: { missing } });
        if (document.confidence === 'low') issues.push({ code: 'low_confidence', severity: 'info', relativePath: document.relativePath, message: '页面置信度为 low，需要补充来源或复核。' });
        const illegalTags = manifest.tagTaxonomy.length ? document.tags.filter((tag) => !manifest.tagTaxonomy.includes(tag)) : [];
        if (illegalTags.length) issues.push({ code: 'illegal_tag', severity: 'warning', relativePath: document.relativePath, message: `使用了未定义标签：${illegalTags.join(', ')}`, metadata: { tags: illegalTags } });
        if (document.frontmatter?.contested === true || document.frontmatter?.contradictions) issues.push({ code: 'contradiction', severity: 'warning', relativePath: document.relativePath, message: '页面包含未解决的矛盾。' });
        if (document.content.split('\n').length > 200) issues.push({ code: 'oversized', severity: 'info', relativePath: document.relativePath, message: '页面超过 200 行，建议拆分。' });
      }
      const indexContent = currentDocuments.find((document) => document.relativePath === 'index.md')?.content || '';
      for (const document of currentDocuments.filter((item) => item.relativePath.startsWith('知识/'))) {
        const stem = document.relativePath.replace(/\.md$/i, '');
        if (!indexContent.includes(`[[${stem}`) && !indexContent.includes(`[[${document.relativePath}`)) issues.push({ code: 'index_missing', severity: 'warning', relativePath: document.relativePath, message: '页面未列入 index.md。' });
      }
      for (const document of currentDocuments.filter((item) => item.relativePath.startsWith('来源/'))) {
        const { frontmatter, body } = parseFrontmatter(document.content);
        if (frontmatter.sha256 && frontmatter.sha256 !== hashContent(body)) issues.push({ code: 'source_drift', severity: 'error', relativePath: document.relativePath, message: '不可变来源的内容哈希发生变化。' });
      }
      store.replaceKnowledgeIssues?.(vault.id, issues);
      const job = store.putKnowledgeJob?.({ vaultId: vault.id, triggerKey: `lint:${Date.now()}`, kind: 'lint', status: 'completed', input: {}, result: { issueCount: issues.length }, completedAt: new Date().toISOString() });
      await appendFile(resolveInsideRoot(path.resolve(vault.path), path.join(vault.path, 'log.md')), `\n## ${new Date().toISOString().slice(0, 10)} lint | ${issues.length} 个问题\n`, 'utf8');
      return { issues: store.listKnowledgeIssues?.(vault.id) || issues, count: issues.length, job };
    },
  };

  return api;
}
