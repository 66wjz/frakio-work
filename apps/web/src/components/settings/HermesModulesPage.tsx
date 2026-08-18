// wjz新建文件，新建原因：解耦技能与插件中心页面组件（HermesModulesPage, PluginsPage, HermesModuleMatrix），修改时间：2026-08-17。
// 文件内容概述：Hermes 技能与插件管理页面、插件聚合分析与矩阵视图。
import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Search,
  Pencil,
  ArrowUpFromLine,
  ArrowDownToLine,
  Trash2,
  X,
} from 'lucide-react';
import {
  AppAlertDialog,
  AppAlertDialogAction,
  AppAlertDialogCancel,
  AppAlertDialogContent,
  AppAlertDialogDescription,
  AppAlertDialogTitle,
  AppDialog,
  AppDialogClose,
  AppDialogContent,
  AppDialogDescription,
  AppDialogTitle,
} from '../../overlay-primitives';
import { requestJson } from '../../utils/api-client';
import { formatCompactNumber, formatTime } from '../../utils/formatters';
import type {
  Agent,
  HermesProfile,
  ManagedHermesModule,
  ManagedHermesModuleKind,
  ManagedHermesModulesPayload,
  ProfileModuleEntry,
} from '../../types/workbench';

export type ManagedModuleAction = { type: 'promote' | 'demote' | 'delete'; item: ManagedHermesModule };

export function ManagedModuleAvatar({ name, avatarUrl, color }: { name: string; avatarUrl?: string; color?: string }) {
  return (
    <span className="managed-module-avatar" style={avatarUrl ? undefined : { background: color || '#64748b' }} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function HermesModulesPage({ kind, onStartProfileGateway }: { kind: ManagedHermesModuleKind; onStartProfileGateway: (profileName: string) => Promise<void> }) {
  const title = kind === 'skill' ? '技能' : '插件';
  const [payload, setPayload] = useState<ManagedHermesModulesPayload | null>(null);
  const [scope, setScope] = useState('global');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<ManagedModuleAction | null>(null);
  const [demoteTarget, setDemoteTarget] = useState('');
  const [restartProfiles, setRestartProfiles] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ item: ManagedHermesModule; content: string; loading: boolean; saving: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<ManagedHermesModulesPayload>(`/api/hermes-modules?kind=${kind}`);
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${title}读取失败。`);
    } finally {
      setLoading(false);
    }
  }, [kind, title]);

  useEffect(() => {
    setScope('global');
    setPayload(null);
    void load();
  }, [kind, load]);

  const selectedProfile = payload?.profiles.find((profile) => profile.profileName === scope) || null;
  const sourceItems = scope === 'global'
    ? payload?.global || []
    : (payload?.profile || []).filter((item) => item.profileName === scope);
  const normalizedQuery = query.trim().toLowerCase();
  const items = sourceItems.filter((item) => !normalizedQuery || `${item.name} ${item.description} ${item.category} ${item.originAgentName || ''}`.toLowerCase().includes(normalizedQuery));

  function acceptMutation(result: { modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }) {
    if (result.modules) setPayload(result.modules);
    if (result.restartRequiredProfiles?.length) setRestartProfiles(result.restartRequiredProfiles);
  }

  async function runAction(target: ManagedModuleAction) {
    const key = `${target.type}:${target.item.scope}:${target.item.name}`;
    setBusy(key);
    setError('');
    try {
      if (target.type === 'promote') {
        acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/scope', {
          method: 'POST',
          body: JSON.stringify({ action: 'promote', kind, name: target.item.name, profileName: target.item.profileName }),
        }));
        setScope('global');
      } else if (target.type === 'demote') {
        const targetProfileName = target.item.originProfileName || demoteTarget;
        acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/scope', {
          method: 'POST',
          body: JSON.stringify({ action: 'demote', kind, name: target.item.name, targetProfileName }),
        }));
        setScope(targetProfileName);
      } else {
        acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules', {
          method: 'DELETE',
          body: JSON.stringify({ kind, name: target.item.name, scope: target.item.scope, profileName: target.item.profileName }),
        }));
      }
      setAction(null);
      setDemoteTarget('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败。';
      const details = (err as Error & { details?: { conflicts?: Array<{ agentName?: string; profileName?: string }> } })?.details;
      const conflicts = details?.conflicts?.map((item) => item.agentName || item.profileName).filter(Boolean).join('、');
      setError(conflicts ? `${message} 冲突来源：${conflicts}` : message);
      setAction(null);
    } finally {
      setBusy('');
    }
  }

  async function toggle(item: ManagedHermesModule) {
    setBusy(`state:${item.name}`);
    setError('');
    try {
      acceptMutation(await requestJson<{ modules?: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/state', {
        method: 'PUT',
        body: JSON.stringify({ kind, name: item.name, profileName: item.profileName, enabled: !item.enabled }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态保存失败。');
    } finally {
      setBusy('');
    }
  }

  async function openEditor(item: ManagedHermesModule) {
    setEditor({ item, content: '', loading: true, saving: false });
    try {
      const params = new URLSearchParams({ kind, scope: item.scope, name: item.name, ...(item.profileName ? { profileName: item.profileName } : {}) });
      const result = await requestJson<{ content: string }>(`/api/hermes-modules/file?${params.toString()}`);
      setEditor({ item, content: result.content || '', loading: false, saving: false });
    } catch (err) {
      setEditor(null);
      setError(err instanceof Error ? err.message : '模块文件读取失败。');
    }
  }

  async function saveEditor() {
    if (!editor) return;
    setEditor({ ...editor, saving: true });
    try {
      const result = await requestJson<{ modules: ManagedHermesModulesPayload; restartRequiredProfiles?: string[] }>('/api/hermes-modules/file', {
        method: 'PUT',
        body: JSON.stringify({ kind, scope: editor.item.scope, name: editor.item.name, profileName: editor.item.profileName, content: editor.content }),
      });
      acceptMutation(result);
      setEditor(null);
    } catch (err) {
      setEditor((current) => current ? { ...current, saving: false } : current);
      setError(err instanceof Error ? err.message : '模块保存失败。');
    }
  }

  async function restartAffectedProfiles() {
    setBusy('restart');
    setError('');
    try {
      for (const profileName of restartProfiles) await onStartProfileGateway(profileName);
      setRestartProfiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent 网关重启失败。');
    } finally {
      setBusy('');
    }
  }

  function requestAction(next: ManagedModuleAction) {
    setAction(next);
    if (next.type === 'demote' && !next.item.originProfileName) setDemoteTarget(payload?.profiles[0]?.profileName || '');
  }

  const actionTitle = action?.type === 'promote' ? `将 ${action.item.name} 设为全局？`
    : action?.type === 'demote' ? `取消 ${action.item.name} 的全局共享？`
      : action ? `删除 ${action.item.name}？` : '';
  const actionDescription = action?.type === 'promote'
    ? `内容完全相同的副本会被归档，来源记录为 ${action.item.agentName || action.item.profileName}。`
    : action?.type === 'demote'
      ? '取消后只保留在接收它的 Agent 中，其他 Agent 将不再继承。'
      : '模块会移入可恢复归档，并从当前范围移除。';

  return (
    <section className="managed-modules-page" data-module-kind={kind}>
      <div className="settings-head managed-modules-head">
        <div><h2>{title}</h2><p>{kind === 'skill' ? '管理所有 Agent 的技能范围与启用状态。' : '管理所有 Agent 的插件范围与运行状态。'}</p></div>
        <button className="secondary-btn" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
      </div>

      <div className="managed-scope-strip" aria-label={`${title}范围`}>
        <button className={scope === 'global' ? 'selected' : ''} onClick={() => setScope('global')}>
          <span className="managed-global-avatar"><Sparkles size={16} /></span>
          <span><strong>全局</strong><small>{payload?.global.length || 0} 个共享{title}</small></span>
        </button>
        {(payload?.profiles || []).map((profile) => (
          <button className={scope === profile.profileName ? 'selected' : ''} key={profile.profileName} onClick={() => setScope(profile.profileName)}>
            <ManagedModuleAvatar name={profile.name} avatarUrl={profile.avatarUrl} color={profile.color} />
            <span><strong>{profile.name}</strong><small>{profile.role || profile.profileName}</small></span>
          </button>
        ))}
      </div>

      <div className="managed-module-toolbar">
        <div>
          <strong>{scope === 'global' ? `全局${title}` : `${selectedProfile?.name || scope} 的${title}`}</strong>
          <span>{scope === 'global' ? '所有 Agent 统一可用' : `另继承 ${payload?.global.length || 0} 个全局${title}`}</span>
        </div>
        <label className="managed-module-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${title}`} /></label>
      </div>

      {error && <div className="form-error managed-module-error">{error}</div>}
      {loading && !payload ? <div className="empty-state">正在读取{title}...</div> : items.length ? (
        <div className="managed-module-list">
          {items.map((item) => {
            const itemBusy = busy.includes(item.name);
            const duplicates = item.duplicateProfileNames || [];
            return (
              <article className="managed-module-row" key={`${item.scope}-${item.profileName}-${item.name}`}>
                <div className="managed-module-main">
                  <div className="managed-module-title">
                    <span className={item.enabled ? 'managed-state-dot enabled' : 'managed-state-dot'} />
                    <strong>{item.name}</strong>
                    <em className={item.enabled ? 'enabled' : ''}>{item.enabled ? '已启用' : '未启用'}</em>
                  </div>
                  <p>{item.description || `这个${title}暂时没有描述。`}</p>
                  <div className="managed-module-meta">
                    <span>{item.scope === 'global' ? '全局共享' : 'Agent 独有'}</span>
                    {item.category && <span>{item.category}</span>}
                    {duplicates.length > 0 && <span>{duplicates.length + 1} 个相同副本</span>}
                    {item.scope === 'global' && (
                      <span className="managed-module-origin">
                        {item.originAgentName ? <ManagedModuleAvatar name={item.originAgentName} avatarUrl={item.originAvatarUrl} color={item.originColor} /> : <span className="managed-origin-native"><Sparkles size={11} /></span>}
                        来源：{item.originAgentName || '原生全局'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="managed-module-actions">
                  {item.scope === 'profile' && (
                    <label className="module-switch" title={item.enabled ? '已启用' : '未启用'}>
                      <input type="checkbox" checked={item.enabled} disabled={itemBusy} onChange={() => void toggle(item)} />
                      <span />
                    </label>
                  )}
                  <button className="secondary-btn" onClick={() => void openEditor(item)} disabled={itemBusy}><Pencil size={14} />编辑</button>
                  {item.scope === 'profile'
                    ? <button className="secondary-btn" onClick={() => requestAction({ type: 'promote', item })} disabled={itemBusy}><ArrowUpFromLine size={14} />设为全局</button>
                    : <button className="secondary-btn" onClick={() => requestAction({ type: 'demote', item })} disabled={itemBusy}><ArrowDownToLine size={14} />取消全局</button>}
                  <button className="secondary-btn danger" onClick={() => requestAction({ type: 'delete', item })} disabled={itemBusy}><Trash2 size={14} />删除</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state">{normalizedQuery ? `没有匹配的${title}。` : scope === 'global' ? `还没有全局${title}。` : `这个 Agent 还没有独有${title}。`}</div>}

      {action && (
        <AppAlertDialog open onOpenChange={(open: boolean) => { if (!open && !busy) setAction(null); }}>
          <AppAlertDialogContent>
            <AppAlertDialogTitle className="app-alert-title">{actionTitle}</AppAlertDialogTitle>
            <AppAlertDialogDescription className="app-alert-description">
              <strong>{action.item.name}</strong>
              <span>{actionDescription}</span>
            </AppAlertDialogDescription>
            {action.type === 'demote' && !action.item.originProfileName && (
              <label className="managed-demote-target">接收 Agent<select value={demoteTarget} onChange={(event) => setDemoteTarget(event.target.value)}>{(payload?.profiles || []).map((profile) => <option value={profile.profileName} key={profile.profileName}>{profile.name}</option>)}</select></label>
            )}
            <div className="app-alert-actions">
              <AppAlertDialogCancel className="cancel" onClick={() => setAction(null)}>取消</AppAlertDialogCancel>
              <AppAlertDialogAction className={action.type === 'delete' ? 'danger' : ''} disabled={Boolean(busy) || (action.type === 'demote' && !action.item.originProfileName && !demoteTarget)} onClick={() => void runAction(action)}>
                {action.type === 'promote' ? '设为全局' : action.type === 'demote' ? '取消全局' : '删除'}
              </AppAlertDialogAction>
            </div>
          </AppAlertDialogContent>
        </AppAlertDialog>
      )}

      {restartProfiles.length > 0 && (
        <AppAlertDialog open onOpenChange={(open: boolean) => { if (!open && busy !== 'restart') setRestartProfiles([]); }}>
          <AppAlertDialogContent>
            <AppAlertDialogTitle className="app-alert-title">重启受影响的 Agent？</AppAlertDialogTitle>
            <AppAlertDialogDescription className="app-alert-description">
              <strong>{restartProfiles.map((profileName) => payload?.profiles.find((profile) => profile.profileName === profileName)?.name || profileName).join('、')}</strong>
              <span>插件配置已保存。重启这些网关后立即生效；取消则在下次启动时生效。</span>
            </AppAlertDialogDescription>
            <div className="app-alert-actions">
              <AppAlertDialogCancel className="cancel" onClick={() => setRestartProfiles([])}>下次启动生效</AppAlertDialogCancel>
              <AppAlertDialogAction disabled={busy === 'restart'} onClick={() => void restartAffectedProfiles()}>{busy === 'restart' ? '重启中' : '立即重启'}</AppAlertDialogAction>
            </div>
          </AppAlertDialogContent>
        </AppAlertDialog>
      )}

      {editor && (
        <AppDialog open onOpenChange={(open: boolean) => { if (!open && !editor.saving) setEditor(null); }}>
          <AppDialogContent className="managed-module-editor-dialog">
            <div className="modal-head"><div><AppDialogTitle>{editor.item.name}</AppDialogTitle><AppDialogDescription>{editor.item.scope === 'global' ? '全局' : editor.item.agentName || editor.item.profileName} · {kind === 'skill' ? 'SKILL.md' : '插件清单'}</AppDialogDescription></div><AppDialogClose className="icon-btn" aria-label="关闭"><X size={18} /></AppDialogClose></div>
            {editor.loading ? <div className="empty-state">正在读取文件...</div> : <textarea value={editor.content} onChange={(event) => setEditor((current) => current ? { ...current, content: event.target.value } : current)} disabled={editor.saving} spellCheck={false} />}
            <div className="modal-actions"><button className="secondary-btn" onClick={() => setEditor(null)} disabled={editor.saving}>取消</button><button className="send-btn" onClick={() => void saveEditor()} disabled={editor.loading || editor.saving}>{editor.saving ? '保存中' : '保存'}</button></div>
          </AppDialogContent>
        </AppDialog>
      )}
    </section>
  );
}

export function HermesModuleMatrix({ agents, profiles }: { agents: Agent[]; profiles: HermesProfile[] }) {
  const [mode, setMode] = useState<'skills' | 'plugins'>('skills');
  const rows = profiles.length
    ? profiles.map((profile) => ({
      id: profile.name,
      name: profile.displayName || profile.name,
      color: profileColor(profile.name),
      source: profile.path || profile.name,
      skills: profile.skills || [],
      plugins: profile.plugins || [],
    }))
    : agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      color: agent.color,
      source: agent.profileName || agent.source || 'manual',
      skills: agent.skills || [],
      plugins: agent.plugins || [],
    }));
  return (
    <div className="module-matrix">
      <div className="module-matrix-tabs">
        <button className={mode === 'skills' ? 'selected' : ''} onClick={() => setMode('skills')}>技能</button>
        <button className={mode === 'plugins' ? 'selected' : ''} onClick={() => setMode('plugins')}>插件</button>
      </div>
      <div className="module-matrix-list">
        {rows.map((row) => {
          const items = mode === 'skills' ? row.skills : row.plugins;
          const enabledCount = items.filter((item) => moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled').length;
          return (
            <div className="module-matrix-row" key={row.id}>
              <div><span className="node-dot" style={{ background: row.color }} /><strong>{row.name}</strong><small>{row.source}</small></div>
              <div>
                {items.length ? <strong className="module-count">{enabledCount}/{items.length} 已启用</strong> : <em>未配置{mode === 'skills' ? '技能' : '插件'}</em>}
                {items.length ? items.slice(0, 12).map((item) => (
                  <span className={moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled' ? 'enabled' : 'disabled'} key={moduleEntryName(item)}>
                    {moduleEntryName(item)}
                  </span>
                )) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type PluginCenterFilter = 'all' | 'enabled' | 'disabled' | 'global' | 'profile';
export type AggregatedPlugin = {
  name: string;
  sources: string[];
  files: string[];
  installedProfiles: string[];
  enabledProfiles: string[];
  categories: string[];
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt: string | null;
};

export function PluginsPage({ agents, profiles, embedded = false }: { agents: Agent[]; profiles: HermesProfile[]; embedded?: boolean }) {
  const [filter, setFilter] = useState<PluginCenterFilter>('all');
  const [query, setQuery] = useState('');
  const rows = profiles.length
    ? profiles.map((profile) => ({
      id: profile.name,
      name: profile.displayName || profile.name,
      source: profile.path || profile.name,
      plugins: profile.plugins || [],
    }))
    : agents.map((agent) => ({
      id: agent.id,
      name: agent.profileName || agent.name,
      source: agent.source || agent.profileName || agent.name,
      plugins: agent.plugins || [],
    }));
  const plugins = aggregatePlugins(rows);
  const enabledCount = plugins.filter((plugin) => plugin.enabledProfiles.length > 0).length;
  const globalCount = plugins.filter((plugin) => plugin.sources.includes('global')).length;
  const profileCount = plugins.filter((plugin) => plugin.sources.includes('profile')).length;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = plugins.filter((plugin) => {
    const enabled = plugin.enabledProfiles.length > 0;
    const matchesFilter =
      filter === 'all'
      || (filter === 'enabled' && enabled)
      || (filter === 'disabled' && !enabled)
      || (filter === 'global' && plugin.sources.includes('global'))
      || (filter === 'profile' && plugin.sources.includes('profile'));
    const haystack = [
      plugin.name,
      ...plugin.sources,
      ...plugin.files,
      ...plugin.installedProfiles,
      ...plugin.categories,
    ].join(' ').toLowerCase();
    return matchesFilter && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  return (
    <section className={embedded ? 'embedded-management-page plugins-page' : 'management-page plugins-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>插件中心</h2></div>
      </div>

      <div className="plugin-stats">
        <article><span>插件总数</span><strong>{plugins.length}</strong><small>同名插件已合并</small></article>
        <article><span>已启用</span><strong>{enabledCount}</strong><small>至少一个 Profile 启用</small></article>
        <article><span>全局插件</span><strong>{globalCount}</strong><small>来自 Hermes 全局目录</small></article>
        <article><span>本地 Profile</span><strong>{profileCount}</strong><small>来自 Profile 插件目录</small></article>
      </div>

      <div className="plugin-toolbar">
        <div className="plugin-filter">
          {([
            ['all', '全部'],
            ['enabled', '已启用'],
            ['disabled', '未启用'],
            ['global', '全局'],
            ['profile', '本地 Profile'],
          ] as const).map(([value, label]) => (
            <button className={filter === value ? 'selected' : ''} key={value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <label className="plugin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索插件、来源、路径或 Profile" />
        </label>
      </div>

      {filtered.length ? (
        <div className="plugin-grid">
          {filtered.map((plugin) => {
            const enabled = plugin.enabledProfiles.length > 0;
            const usageTotal = plugin.useCount + plugin.viewCount + plugin.patchCount;
            return (
              <article className="plugin-card" key={plugin.name}>
                <div className="plugin-card-head">
                  <div>
                    <strong>{plugin.name}</strong>
                    <span>{plugin.sources.includes('global') ? 'global' : 'profile'} · {plugin.installedProfiles.length} profiles</span>
                  </div>
                  <em className={enabled ? 'enabled' : ''}>{enabled ? '已启用' : '未启用'}</em>
                </div>
                <div className="plugin-meta">
                  <span>启用 {plugin.enabledProfiles.length}/{plugin.installedProfiles.length}</span>
                  <span>使用 {formatCompactNumber(usageTotal)}</span>
                  {plugin.lastUsedAt && <span>最近 {formatTime(plugin.lastUsedAt)}</span>}
                </div>
                <p>{plugin.files[0] || '未提供插件清单路径'}</p>
                <div className="plugin-tags">
                  {plugin.sources.map((source) => <span key={source}>{source}</span>)}
                  {plugin.installedProfiles.slice(0, 5).map((profile) => <span key={profile}>{profile}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">当前没有匹配的插件。</div>
      )}
    </section>
  );
}

export function aggregatePlugins(rows: Array<{ id: string; name: string; source: string; plugins: ProfileModuleEntry[] }>) {
  const byName = new Map<string, AggregatedPlugin>();
  for (const row of rows) {
    for (const item of row.plugins || []) {
      const name = moduleEntryName(item);
      if (!name) continue;
      const usage = moduleEntryUsage(item);
      const source = moduleEntrySource(item) || 'profile';
      const file = typeof item === 'string' ? '' : item.file || '';
      const category = moduleEntryCategory(item);
      const enabled = moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled';
      const current = byName.get(name) || {
        name,
        sources: [],
        files: [],
        installedProfiles: [],
        enabledProfiles: [],
        categories: [],
        useCount: 0,
        viewCount: 0,
        patchCount: 0,
        lastUsedAt: null,
      };
      if (!current.sources.includes(source)) current.sources.push(source);
      if (file && !current.files.includes(file)) current.files.push(file);
      if (category && !current.categories.includes(category)) current.categories.push(category);
      if (!current.installedProfiles.includes(row.name)) current.installedProfiles.push(row.name);
      if (enabled && !current.enabledProfiles.includes(row.name)) current.enabledProfiles.push(row.name);
      current.useCount += usage.useCount || 0;
      current.viewCount += usage.viewCount || 0;
      current.patchCount += usage.patchCount || 0;
      if (usage.lastUsedAt && (!current.lastUsedAt || usage.lastUsedAt.localeCompare(current.lastUsedAt) > 0)) current.lastUsedAt = usage.lastUsedAt;
      byName.set(name, current);
    }
  }
  return Array.from(byName.values()).sort((a, b) => {
    const scoreA = a.enabledProfiles.length * 1000 + a.useCount + a.viewCount + a.patchCount;
    const scoreB = b.enabledProfiles.length * 1000 + b.useCount + b.viewCount + b.patchCount;
    return scoreB - scoreA || a.name.localeCompare(b.name);
  });
}

export function moduleEntryName(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? entry : entry.name;
}

export function moduleEntryDescription(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? '' : entry.description || '';
}

export function moduleEntryCategory(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? '' : entry.category || '';
}

export function moduleEntryEnabled(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? true : entry.enabled !== false;
}

export function moduleEntryStatus(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return 'installed';
  return entry.status || (entry.enabled === false ? 'disabled' : 'enabled');
}

export function moduleEntryStatusLabel(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return '已安装';
  return entry.statusLabel || (entry.enabled === false ? '未启用' : '已启用');
}

export function moduleEntrySource(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return '';
  return entry.source || '';
}

export function moduleEntryUsage(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? {} : entry.usage || {};
}

export function profileColor(profile: string) {
  const palette = ['#111827', '#0f766e', '#7c3aed', '#b45309', '#2563eb', '#475569', '#be123c', '#0369a1'];
  const total = String(profile || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return palette[total % palette.length];
}
// wjz新建文件结束。
