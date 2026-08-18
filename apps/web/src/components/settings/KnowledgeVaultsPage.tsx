// wjz新建文件，新建原因：解耦 main.tsx 中的 KnowledgeVaultsPage 资料库管理面板与 KnowledgeFileTree 树形视图组件，修改时间：2026-08-17。
// 文件内容概述：资料库列表、创建、检索、文件预览、健康检查、自治策略与系统维护者配置。
// wjz新建文件结束。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  Bot,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Globe2,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Agent, ModelProfile, Vault, VaultDetail } from '../../types/workbench';
import { requestJson } from '../../utils/api-client';
import { formatTime } from '../../utils/formatters';
import { modelNamesForProvider } from '../../utils/model-helpers';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import {
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSeparator,
  AppMenuTrigger,
} from '../../overlay-primitives';
import launchDinoUrl from '../../assets/launch-dino.png';

export type KnowledgeTreeFile = { relativePath: string; name: string; directory: string; size: number; updatedAt: string };
export type KnowledgeTreeDirectory = { name: string; path: string; directories: Map<string, KnowledgeTreeDirectory>; files: KnowledgeTreeFile[] };

export function KnowledgeFileTree({
  files,
  selectedPath,
  onOpen,
}: {
  files: KnowledgeTreeFile[];
  selectedPath: string;
  onOpen: (relativePath: string) => void;
}) {
  const tree = useMemo(() => {
    const root: KnowledgeTreeDirectory = { name: '', path: '', directories: new Map(), files: [] };
    for (const file of files) {
      const parts = file.relativePath.split('/');
      const fileName = parts.pop() || file.name;
      let current = root;
      for (const part of parts) {
        const directoryPath = current.path ? `${current.path}/${part}` : part;
        if (!current.directories.has(part)) {
          current.directories.set(part, { name: part, path: directoryPath, directories: new Map(), files: [] });
        }
        current = current.directories.get(part)!;
      }
      current.files.push({ ...file, name: fileName });
    }
    return root;
  }, [files]);

  const renderDirectory = (directory: KnowledgeTreeDirectory, depth: number): React.ReactNode => {
    const containsSelection = Boolean(selectedPath && (selectedPath === directory.path || selectedPath.startsWith(`${directory.path}/`)));
    return (
      <details className="knowledge-tree-directory" key={directory.path} open={depth === 0 || containsSelection}>
        <summary style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <ChevronRight className="knowledge-tree-chevron" size={13} />
          <FolderOpen size={14} />
          <span>{directory.name}</span>
        </summary>
        {[...directory.directories.values()]
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((child) => renderDirectory(child, depth + 1))}
        {directory.files
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((file) => (
            <button
              style={{ paddingLeft: `${23 + depth * 14}px` }}
              className={selectedPath === file.relativePath ? 'selected' : ''}
              key={file.relativePath}
              onClick={() => onOpen(file.relativePath)}
              title={file.relativePath}
            >
              <FileText size={14} />
              <span>{file.name}</span>
            </button>
          ))}
      </details>
    );
  };

  return (
    <div className="knowledge-file-tree">
      {[...tree.directories.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((directory) => renderDirectory(directory, 0))}
      {tree.files
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((file) => (
          <button
            className={selectedPath === file.relativePath ? 'selected' : ''}
            key={file.relativePath}
            onClick={() => onOpen(file.relativePath)}
            title={file.relativePath}
          >
            <FileText size={14} />
            <span>{file.name}</span>
          </button>
        ))}
    </div>
  );
}

export function KnowledgeVaultsPage({
  vaults,
  models,
  agents,
  vaultPathInput,
  setVaultPathInput,
  vaultError,
  vaultBusy,
  newVaultKind,
  setNewVaultKind,
  showConnector,
  setShowConnector,
  addVault,
  reindexVault,
  deleteVault,
  resolveLegacyVaultBinding,
}: {
  vaults: Vault[];
  models: ModelProfile[];
  agents: Agent[];
  vaultPathInput: string;
  setVaultPathInput: (value: string) => void;
  vaultError: string;
  vaultBusy: Record<string, 'index' | 'delete' | 'keep' | 'detach'>;
  newVaultKind: 'personal' | 'project';
  setNewVaultKind: (kind: 'personal' | 'project') => void;
  showConnector: boolean;
  setShowConnector: (show: boolean) => void;
  addVault: (kind?: 'personal' | 'project', useDefault?: boolean) => Promise<void>;
  reindexVault: (vaultId: string) => Promise<void>;
  deleteVault: (vault: Vault) => Promise<void>;
  resolveLegacyVaultBinding: (vault: Vault, action: 'keep' | 'detach') => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<'overview' | 'content' | 'rules' | 'activity' | 'pending'>('overview');
  const [detail, setDetail] = useState<VaultDetail | null>(null);
  const [files, setFiles] = useState<Array<{ relativePath: string; name: string; directory: string; size: number; updatedAt: string }>>([]);
  const [preview, setPreview] = useState<{
    file: { relativePath: string; content: string; body?: string; frontmatter?: Record<string, unknown> };
    links: Array<{ to: string }>;
    backlinks: string[];
  } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ relativePath: string; summary: string; score?: number; confident?: boolean }>>([]);
  const [noAnswer, setNoAnswer] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const vault = vaults.find((item) => item.id === selectedId) || null;

  const loadDetail = useCallback(async (vaultId: string) => {
    if (!vaultId) return;
    setBusy('load');
    try {
      const [nextDetail, tree] = await Promise.all([
        requestJson<VaultDetail>(`/api/vaults/${vaultId}`),
        requestJson<{ files: Array<{ relativePath: string; name: string; directory: string; size: number; updatedAt: string }> }>(`/api/vaults/${vaultId}/tree`),
      ]);
      setDetail(nextDetail);
      setFiles(tree.files || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库详情读取失败。');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const openFile = async (relativePath: string) => {
    if (!selectedId) return;
    try {
      setPreview(await requestJson(`/api/vaults/${selectedId}/file?path=${encodeURIComponent(relativePath)}`));
      setTab('content');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库文件读取失败。');
    }
  };

  const search = async () => {
    if (!selectedId || !query.trim()) return;
    try {
      const data = await requestJson<{
        results: Array<{ relativePath: string; summary: string; score?: number; confident?: boolean }>;
        message?: string;
      }>(`/api/vaults/${selectedId}/search?q=${encodeURIComponent(query.trim())}`);
      setResults(data.results || []);
      setNoAnswer(data.message || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库搜索失败。');
    }
  };

  const configure = async (
    managementMode: 'managed' | 'read_only',
    autonomy: 'fully_autonomous' | 'tiered' | 'all_review',
  ) => {
    if (!selectedId) return;
    setBusy('configure');
    try {
      await requestJson(`/api/vaults/${selectedId}/initialize`, {
        method: 'POST',
        body: JSON.stringify({ managementMode, autonomy, confirmUpgrade: true }),
      });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库配置失败。');
    } finally {
      setBusy('');
    }
  };

  const patchConfig = async (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setBusy('configure');
    try {
      await requestJson(`/api/vaults/${selectedId}/config`, { method: 'PATCH', body: JSON.stringify(patch) });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置保存失败。');
    } finally {
      setBusy('');
    }
  };

  const uploadCuratorAvatar = async (file: File | undefined) => {
    if (!file || !selectedId) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('仅支持 png、jpg、webp、gif 头像。');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('头像大小需小于 3MB。');
      return;
    }
    setBusy('avatar');
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('头像读取失败。'));
        reader.readAsDataURL(file);
      });
      await requestJson(`/api/vaults/${selectedId}/curator-avatar`, { method: 'POST', body: JSON.stringify({ mimeType: file.type, data }) });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像保存失败。');
    } finally {
      setBusy('');
    }
  };

  const removeCuratorAvatar = async () => {
    if (!selectedId) return;
    setBusy('avatar');
    try {
      await requestJson(`/api/vaults/${selectedId}/curator-avatar`, { method: 'DELETE' });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像移除失败。');
    } finally {
      setBusy('');
    }
  };

  const uploadVaultAvatar = async (file: File | undefined) => {
    if (!file || !selectedId) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setError('请上传小于 3MB 的 png、jpg、webp 或 gif 图片。');
      return;
    }
    setBusy('vault-avatar');
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('图片读取失败。'));
        reader.readAsDataURL(file);
      });
      await requestJson(`/api/vaults/${selectedId}/avatar`, { method: 'POST', body: JSON.stringify({ mimeType: file.type, data }) });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库头像保存失败。');
    } finally {
      setBusy('');
    }
  };

  const removeVaultAvatar = async () => {
    if (!selectedId) return;
    setBusy('vault-avatar');
    try {
      await requestJson(`/api/vaults/${selectedId}/avatar`, { method: 'DELETE' });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料库头像移除失败。');
    } finally {
      setBusy('');
    }
  };

  const runAction = async (key: string, endpoint: string) => {
    setBusy(key);
    try {
      await requestJson(endpoint, { method: 'POST', body: '{}' });
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败。');
    } finally {
      setBusy('');
    }
  };

  if (!vault) {
    return (
      <>
        <div className="settings-head">
          <div>
            <h2>
              资料库 <span className="feature-beta">Beta</span>
            </h2>
            <p className="settings-description">
              个人资料库参与全局检索；项目资料库只在连接的对话中注入规则和知识。
            </p>
          </div>
          <button className="send-btn" onClick={() => setShowConnector(!showConnector)}>
            <Plus size={15} />
            {showConnector ? '收起' : '新建资料库'}
          </button>
        </div>
        {showConnector && (
          <div className="vault-form">
            <select
              value={newVaultKind}
              onChange={(event) => setNewVaultKind(event.target.value as 'personal' | 'project')}
            >
              <option value="project">项目资料库</option>
              <option value="personal">个人资料库</option>
            </select>
            <input
              value={vaultPathInput}
              onChange={(event) => setVaultPathInput(event.target.value)}
              placeholder="选择本地 Markdown 目录"
            />
            <button className="send-btn" onClick={() => void addVault(newVaultKind)}>
              创建或连接
            </button>
            {newVaultKind === 'personal' && (
              <button className="secondary-btn" onClick={() => void addVault('personal', true)}>
                使用默认目录
              </button>
            )}
          </div>
        )}
        {vaultError && <div className="form-error">{vaultError}</div>}
        <div className="knowledge-vault-list">
          {vaults.map((item) => (
            <button className="knowledge-vault-list-row" key={item.id} onClick={() => setSelectedId(item.id)}>
              <span className="knowledge-vault-icon">
                {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <BookOpenText size={18} />}
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.kind === 'personal' ? '个人资料库' : '项目资料库'} · {item.documentCount || 0} 个 Markdown
                </small>
              </span>
              <span
                className={`knowledge-state ${
                  item.managementMode === 'read_only' || item.onboardingStatus === 'needs_upgrade_confirmation'
                    ? 'warning'
                    : ''
                }`}
              >
                {item.kind === 'personal'
                  ? '默认资料库'
                  : item.managementMode === 'read_only'
                    ? '只读连接'
                    : item.onboardingStatus === 'needs_upgrade_confirmation'
                      ? '待升级'
                      : 'AI 自治'}
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
          {!vaults.length && (
            <div className="empty-state">
              <Database size={22} />
              <strong>还没有资料库</strong>
              <span>新建后立即可以连接对话，AI 设置在资料库详情中完成。</span>
            </div>
          )}
        </div>
      </>
    );
  }

  const pendingSources = detail?.sources.filter((source) => ['pending', 'drifted'].includes(source.status)) || [];
  const pendingOperations =
    detail?.recentOperations.filter((operation) => ['awaiting_review', 'conflict'].includes(operation.status)) || [];

  return (
    <div className="knowledge-vault-detail">
      <div className="settings-head knowledge-vault-head">
        <div>
          <button
            className="knowledge-back"
            onClick={() => {
              setSelectedId('');
              setDetail(null);
              setPreview(null);
            }}
          >
            <ArrowLeft size={16} />
            资料库
          </button>
          <h2>{vault.name}</h2>
          <p className="settings-description" title={vault.path}>
            {vault.path}
          </p>
        </div>
        <div className="settings-inline-actions">
          {vault.obsidianAvailable && window.frakioDesktop?.openObsidianVault && (
            <button
              className="secondary-btn"
              onClick={() => void window.frakioDesktop?.openObsidianVault?.(vault.path)}
            >
              <ExternalLink size={15} />
              Obsidian
            </button>
          )}
          <AppMenu>
            <AppMenuTrigger asChild>
              <button className="icon-btn" aria-label="资料库更多操作">
                <MoreHorizontal size={17} />
              </button>
            </AppMenuTrigger>
            <AppMenuContent align="end">
              <AppMenuItem onSelect={() => void reindexVault(vault.id)}>
                <RefreshCw size={15} />
                重建索引
              </AppMenuItem>
              {window.frakioDesktop?.showItemInFolder && (
                <AppMenuItem onSelect={() => void window.frakioDesktop?.showItemInFolder?.(vault.path)}>
                  <FolderOpen size={15} />
                  在 Finder 显示
                </AppMenuItem>
              )}
              {vault.legacyWorkspaceBinding && (
                <>
                  <AppMenuSeparator />
                  <AppMenuItem onSelect={() => void resolveLegacyVaultBinding(vault, 'keep')}>
                    保留项目连接
                  </AppMenuItem>
                  <AppMenuItem onSelect={() => void resolveLegacyVaultBinding(vault, 'detach')}>
                    解除旧版连接
                  </AppMenuItem>
                </>
              )}
              <AppMenuSeparator />
              <AppMenuItem variant="destructive" onSelect={() => void deleteVault(vault)}>
                <Trash2 size={15} />
                移除资料库
              </AppMenuItem>
            </AppMenuContent>
          </AppMenu>
        </div>
      </div>
      <div className="knowledge-vault-tabs" role="tablist">
        {(
          [
            ['overview', '概览'],
            ['content', '内容'],
            ['rules', '规则与 Agent'],
            ['activity', '活动记录'],
            ['pending', `待确认${detail?.stats.pending ? ` ${detail.stats.pending}` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'selected' : ''}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {busy === 'load' && !detail ? (
        <div className="knowledge-loading">
          <LoaderCircle className="spin" size={18} />
          读取资料库
        </div>
      ) : null}
      {detail && tab === 'overview' && (
        <div className="knowledge-overview">
          <section className="knowledge-overview-section">
            <div>
              <h3>资料库头像</h3>
            </div>
            <div className="knowledge-vault-avatar-form">
              <span className="knowledge-vault-icon large">
                {vault.avatarUrl ? <img src={`${vault.avatarUrl}?v=${Date.now()}`} alt="" /> : <BookOpenText size={21} />}
              </span>
              <label className="secondary-btn">
                上传头像
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  disabled={busy === 'vault-avatar'}
                  onChange={(event) => {
                    void uploadVaultAvatar(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              {vault.avatarUrl && (
                <button className="secondary-btn" disabled={busy === 'vault-avatar'} onClick={() => void removeVaultAvatar()}>
                  恢复默认图标
                </button>
              )}
            </div>
          </section>
          {detail.config.onboardingStatus !== 'ready' && (
            <section className="knowledge-setup-band">
              <div>
                <Sparkles size={20} />
                <span>
                  <strong>让 Frakio 接管日常维护</strong>
                  <small>现有文件不会移动。来源、发布和回滚从确认后开始受 Runtime 管理。</small>
                </span>
              </div>
              <span className="settings-inline-actions">
                <button
                  className="send-btn"
                  disabled={busy === 'configure'}
                  onClick={() => void configure('managed', 'fully_autonomous')}
                >
                  一键自动配置
                </button>
                <button
                  className="secondary-btn"
                  disabled={busy === 'configure'}
                  onClick={() => void configure('managed', 'tiered')}
                >
                  分级自治
                </button>
                <button
                  className="secondary-btn"
                  disabled={busy === 'configure'}
                  onClick={() => void configure('read_only', 'all_review')}
                >
                  只读连接
                </button>
              </span>
            </section>
          )}
          <div className="knowledge-stat-grid">
            <div>
              <strong>{detail.stats.documents}</strong>
              <span>Markdown</span>
            </div>
            <div>
              <strong>{detail.stats.sources}</strong>
              <span>已收录来源</span>
            </div>
            <div>
              <strong>{detail.stats.pending}</strong>
              <span>待确认</span>
            </div>
            <div>
              <strong>{detail.stats.issues}</strong>
              <span>健康问题</span>
            </div>
          </div>
          <section className="knowledge-overview-section">
            <div>
              <h3>运行状态</h3>
              <button
                className="secondary-btn"
                disabled={busy === 'lint'}
                onClick={() => void runAction('lint', `/api/vaults/${vault.id}/lint`)}
              >
                <ShieldCheck size={15} />
                运行健康检查
              </button>
            </div>
            <div className="knowledge-status-lines">
              <span>
                <strong>管理方式</strong>
                {detail.config.managementMode === 'managed' ? 'Frakio 管理' : '只读连接'}
              </span>
              <span>
                <strong>自治档位</strong>
                {detail.config.autonomy === 'fully_autonomous'
                  ? '完全自治'
                  : detail.config.autonomy === 'tiered'
                    ? '分级自治'
                    : '全部审核'}
              </span>
              <span>
                <strong>维护者</strong>
                {detail.curator?.displayName || '无上的霸王龙'}
              </span>
              <span>
                <strong>来源边界</strong>
                {detail.config.immutableRoots.join('、')}
              </span>
            </div>
          </section>
          <section className="knowledge-overview-section">
            <div>
              <h3>最近活动</h3>
              <button className="knowledge-text-button" onClick={() => setTab('activity')}>
                查看全部 <ChevronRight size={14} />
              </button>
            </div>
            {detail.recentOperations.slice(0, 4).map((operation) => (
              <div className="knowledge-activity-row" key={operation.id}>
                <Activity size={15} />
                <span>
                  <strong>{operation.summary}</strong>
                  <small>
                    {formatTime(operation.createdAt)} · {operation.files.length} 个文件
                  </small>
                </span>
                <em>
                  {operation.status === 'published'
                    ? '已发布'
                    : operation.status === 'awaiting_review'
                      ? '待确认'
                      : operation.status}
                </em>
              </div>
            ))}
            {!detail.recentOperations.length && <div className="overview-empty">还没有维护活动。</div>}
          </section>
        </div>
      )}
      {detail && tab === 'content' && (
        <div className="knowledge-content-view">
          <aside>
            <div className="knowledge-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void search();
                }}
                placeholder="搜索资料库"
              />
              <button onClick={() => void search()} aria-label="搜索">
                <ArrowUp size={14} />
              </button>
            </div>
            {query && (
              <div className="knowledge-search-results">
                {noAnswer && <div className="knowledge-no-answer">{noAnswer}</div>}
                {results.map((result) => (
                  <button key={result.relativePath} onClick={() => void openFile(result.relativePath)}>
                    <strong>{result.relativePath}</strong>
                    <small>{result.summary}</small>
                  </button>
                ))}
              </div>
            )}
            <KnowledgeFileTree
              files={files}
              selectedPath={preview?.file.relativePath || ''}
              onOpen={(relativePath) => void openFile(relativePath)}
            />
          </aside>
          <main>
            {preview ? (
              <>
                <header>
                  <div>
                    <strong>{preview.file.relativePath}</strong>
                    <small>
                      {Object.keys(preview.file.frontmatter || {}).length} 个属性 · {preview.links.length} 个出链 ·{' '}
                      {preview.backlinks.length} 个反向链接
                    </small>
                  </div>
                </header>
                <div className="knowledge-markdown">
                  <MarkdownMessage content={preview.file.body ?? preview.file.content} />
                </div>
                {(preview.links.length > 0 || preview.backlinks.length > 0) && (
                  <footer>
                    {preview.links.map((link) => (
                      <button key={`out-${link.to}`} onClick={() => void openFile(link.to)}>
                        <Link2 size={13} />
                        {link.to}
                      </button>
                    ))}
                    {preview.backlinks.map((from) => (
                      <button key={`back-${from}`} onClick={() => void openFile(from)}>
                        <GitBranch size={13} />
                        {from}
                      </button>
                    ))}
                  </footer>
                )}
              </>
            ) : (
              <div className="knowledge-preview-empty">
                <FileText size={24} />
                <span>从左侧选择一个 Markdown 文件</span>
              </div>
            )}
          </main>
        </div>
      )}
      {detail && tab === 'rules' && (
        <div className="knowledge-rules-view">
          <section className="knowledge-curator-panel">
            <div className="knowledge-curator-heading">
              <span className="knowledge-curator-avatar">
                {detail.curator?.avatarUrl ? <img src={detail.curator.avatarUrl} alt="" /> : <img src={launchDinoUrl} alt="" />}
              </span>
              <div>
                <h3>{detail.curator?.displayName || '无上的霸王龙'}</h3>
                <p>系统维护者 / frakio-knowledge-curator · 固定通过 Hermes 执行</p>
              </div>
            </div>
            <div className="knowledge-curator-form">
              <label>
                昵称
                <input
                  defaultValue={detail.config.curatorPresentation.displayName}
                  maxLength={48}
                  onBlur={(event) => {
                    const displayName = event.target.value.trim() || '无上的霸王龙';
                    if (displayName !== detail.config.curatorPresentation.displayName) {
                      void patchConfig({ curatorPresentation: { displayName } });
                    }
                  }}
                />
              </label>
              <label>
                头像
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={busy === 'avatar'}
                  onChange={(event) => {
                    void uploadCuratorAvatar(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              {detail.curator?.avatarUrl && (
                <button className="secondary-btn" disabled={busy === 'avatar'} onClick={() => void removeCuratorAvatar()}>
                  恢复默认头像
                </button>
              )}
              <label>
                模型路线
                <select
                  value={detail.config.curatorExecution.mode}
                  onChange={(event) =>
                    void patchConfig({
                      curatorExecution: { mode: event.target.value },
                      curatorReferenceAgentId:
                        event.target.value === 'follow_agent' ? detail.config.curatorReferenceAgentId : '',
                    })
                  }
                >
                  <option value="auto">自动（全局维护者模型）</option>
                  <option value="explicit_model">指定模型</option>
                  <option value="follow_agent">跟随 Agent 模型</option>
                </select>
              </label>
              {detail.config.curatorExecution.mode === 'explicit_model' && (
                <label>
                  指定模型
                  <select
                    value={`${detail.config.curatorExecution.provider}::${detail.config.curatorExecution.model}`}
                    onChange={(event) => {
                      const [provider, model] = event.target.value.split('::');
                      void patchConfig({ curatorExecution: { provider, model } });
                    }}
                  >
                    <option value="::">选择模型</option>
                    {models.flatMap((item) =>
                      modelNamesForProvider(item).map((name) => (
                        <option key={`${item.providerKey}::${name}`} value={`${item.providerKey}::${name}`}>
                          {item.name} / {name}
                        </option>
                      )),
                    )}
                  </select>
                </label>
              )}
              {detail.config.curatorExecution.mode === 'follow_agent' && (
                <label>
                  参考 Agent
                  <select
                    value={detail.config.curatorReferenceAgentId}
                    onChange={(event) => void patchConfig({ curatorReferenceAgentId: event.target.value })}
                  >
                    <option value="">选择 Agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                调用超时
                <input
                  type="number"
                  min="30"
                  max="900"
                  value={detail.config.curatorExecution.timeout}
                  onChange={(event) => void patchConfig({ curatorExecution: { timeout: Number(event.target.value) || 600 } })}
                />
              </label>
              <span className="knowledge-curator-effective">
                当前：Hermes · {detail.curator?.modelLabel || '自动'} ·{' '}
                {detail.curator?.modelSource === 'reference_agent'
                  ? `模型路线参考自 ${detail.curator.referenceAgentName}`
                  : detail.curator?.modelSource === 'vault_model'
                    ? '资料库专属模型'
                    : detail.curator?.modelSource === 'global_curator'
                      ? '全局默认模型'
                      : '默认 Agent 模型'}
              </span>
            </div>
          </section>
          <section>
            <div>
              <h3>自治策略</h3>
              <p>规则和 Agent 权限变更始终进入待确认。</p>
            </div>
            <select
              value={detail.config.autonomy}
              disabled={busy === 'configure' || detail.config.managementMode === 'read_only'}
              onChange={(event) => void patchConfig({ autonomy: event.target.value })}
            >
              <option value="fully_autonomous">完全自治</option>
              <option value="tiered">分级自治</option>
              <option value="all_review">全部审核</option>
            </select>
          </section>
          <section>
            <div>
              <h3>管理方式</h3>
              <p>只读连接保留检索和规则注入，但暂停 AI 发布。</p>
            </div>
            <select
              value={detail.config.managementMode}
              disabled={busy === 'configure'}
              onChange={(event) => void patchConfig({ managementMode: event.target.value })}
            >
              <option value="managed">Frakio 管理</option>
              <option value="read_only">只读连接</option>
            </select>
          </section>
          <section className="knowledge-rule-paths">
            <div>
              <h3>实际注入规则</h3>
              <p>这些路径由 manifest 授权，普通 Markdown 不能扩大权限。</p>
            </div>
            {detail.config.trustedRulePaths.length ? (
              detail.config.trustedRulePaths.map((rulePath) => (
                <button key={rulePath} onClick={() => void openFile(rulePath)}>
                  <ShieldCheck size={15} />
                  {rulePath}
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <span className="overview-empty">个人资料库不注入项目工作流规则。</span>
            )}
          </section>
          <section className="knowledge-rule-paths">
            <div>
              <h3>维护规则</h3>
              <p>{detail.curator?.displayName || '无上的霸王龙'}读取这些规则来整理来源和知识。</p>
            </div>
            {detail.config.maintenanceRulePaths.map((rulePath) => (
              <button key={rulePath} onClick={() => void openFile(rulePath)}>
                <Bot size={15} />
                {rulePath}
                <ChevronRight size={14} />
              </button>
            ))}
          </section>
        </div>
      )}
      {detail && tab === 'activity' && (
        <div className="knowledge-activity-view">
          <div className="knowledge-section-toolbar">
            <div>
              <h3>维护操作</h3>
              <p>每次发布都有文件级历史，可以整体回滚。</p>
            </div>
            <button className="secondary-btn" onClick={() => void loadDetail(vault.id)}>
              <RefreshCw size={15} />
              刷新
            </button>
          </div>
          {detail.recentOperations.map((operation) => (
            <div className="knowledge-operation-row" key={operation.id}>
              <span className={`knowledge-operation-icon ${operation.status}`}>
                <Activity size={15} />
              </span>
              <span>
                <strong>{operation.summary}</strong>
                <small>
                  {formatTime(operation.createdAt)} · {operation.kind} ·{' '}
                  {operation.files.map((file) => file.relativePath).join('、')}
                </small>
              </span>
              <em>
                {operation.status === 'published'
                  ? '已发布'
                  : operation.status === 'rejected'
                    ? '已拒绝'
                    : operation.status === 'conflict'
                      ? '冲突'
                      : '待确认'}
              </em>
              {operation.status === 'published' && !operation.rolledBackAt && (
                <button
                  className="secondary-btn"
                  disabled={busy === operation.id}
                  onClick={() => void runAction(operation.id, `/api/vaults/${vault.id}/operations/${operation.id}/rollback`)}
                >
                  回滚
                </button>
              )}
            </div>
          ))}
          {!detail.recentOperations.length && !detail.recentJobs.length && (
            <div className="knowledge-empty-line">还没有维护活动。</div>
          )}
          {detail.recentJobs.length > 0 && (
            <>
              <div className="knowledge-section-toolbar compact">
                <div>
                  <h3>维护任务</h3>
                </div>
              </div>
              {detail.recentJobs.map((job) => (
                <div className="knowledge-job-row" key={job.id}>
                  <Clock3 size={14} />
                  <span>
                    <strong>{job.kind}</strong>
                    <small>
                      {formatTime(job.updatedAt)}
                      {job.error ? ` · ${job.error}` : ''}
                    </small>
                  </span>
                  <em>{job.status}</em>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {detail && tab === 'pending' && (
        <div className="knowledge-pending-view">
          <div className="knowledge-section-toolbar">
            <div>
              <h3>来源确认</h3>
              <p>任何来源首次进入资料库都需要确认。</p>
            </div>
          </div>
          {pendingSources.map((source) => (
            <div className="knowledge-pending-row" key={source.id}>
              <Globe2 size={16} />
              <span>
                <strong>{source.title}</strong>
                <small>
                  {source.origin || source.kind} · {source.status === 'drifted' ? '内容已变化' : '等待收录'}
                </small>
              </span>
              <button
                className="send-btn"
                disabled={busy === source.id}
                onClick={() => void runAction(source.id, `/api/vaults/${vault.id}/sources/${source.id}/accept`)}
              >
                确认收录
              </button>
              <button
                className="secondary-btn"
                disabled={busy === source.id}
                onClick={() => void runAction(source.id, `/api/vaults/${vault.id}/sources/${source.id}/reject`)}
              >
                拒绝
              </button>
            </div>
          ))}
          {!pendingSources.length && <div className="knowledge-empty-line">没有待确认来源。</div>}
          <div className="knowledge-section-toolbar">
            <div>
              <h3>变更审核</h3>
              <p>规则、删除、矛盾裁决和大批量变更始终在这里确认。</p>
            </div>
          </div>
          {pendingOperations.map((operation) => (
            <div className="knowledge-pending-row operation" key={operation.id}>
              <GitCompareArrows size={16} />
              <span>
                <strong>{operation.summary}</strong>
                <small>
                  {operation.files.length} 个文件 ·{' '}
                  {operation.status === 'conflict' ? '外部文件已变化' : operation.files.map((file) => file.relativePath).join('、')}
                </small>
              </span>
              {operation.status !== 'conflict' && (
                <button
                  className="send-btn"
                  disabled={busy === operation.id}
                  onClick={() => void runAction(operation.id, `/api/vaults/${vault.id}/operations/${operation.id}/publish`)}
                >
                  发布
                </button>
              )}
              <button
                className="secondary-btn"
                disabled={busy === operation.id}
                onClick={() => void runAction(operation.id, `/api/vaults/${vault.id}/operations/${operation.id}/reject`)}
              >
                拒绝
              </button>
            </div>
          ))}
          {!pendingOperations.length && <div className="knowledge-empty-line">没有待审核变更。</div>}
          {detail.issues.length > 0 && (
            <>
              <div className="knowledge-section-toolbar">
                <div>
                  <h3>健康问题</h3>
                </div>
              </div>
              {detail.issues.map((issue) => (
                <div className="knowledge-issue-row" key={issue.id}>
                  <TriangleAlert size={15} />
                  <span>
                    <strong>{issue.message}</strong>
                    <small>{issue.relativePath || issue.code}</small>
                  </span>
                  <em>{issue.severity}</em>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
