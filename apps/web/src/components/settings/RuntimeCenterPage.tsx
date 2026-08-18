// wjz新建文件，新建原因：解耦运行环境中心与版本管理面板组件（RuntimeCenterPage, HermesRuntimePanel, UpdatesPanel 等），修改时间：2026-08-17。
// 文件内容概述：多 Runtime 执行内核发现/安装/切换、Frakio Work 桌面版更新卡片、Hermes 官方发布版本与配置快照回滚。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import {
  SettingsInlineNote,
  SettingsPanel,
  SettingsRow,
  SettingsStatusValue,
} from '../../settings-ui';
import {
  AppDialog,
  AppDialogClose,
  AppDialogContent,
  AppDialogDescription,
  AppDialogTitle,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
} from '../../overlay-primitives';
import { RichMarkdown } from '../../rich-content/RichMarkdown';
import { RuntimeLabel } from '../layout/RuntimeLabel';
import { requestJson } from '../../utils/api-client';
import { formatFileSize, formatTime } from '../../utils/formatters';
import {
  isRuntimeReady,
  mergeRuntimeDefinitions,
  runtimeLabels,
  runtimeSeed,
} from '../../utils/workbench-helpers';
import type {
  DesktopUpdateState,
  HermesApiAvailability,
  HermesBackup,
  HermesBootstrapStatus,
  HermesGatewayRepair,
  HermesLocalStatus,
  HermesOfficialRelease,
  HermesRuntimeDiagnostics,
  HermesRuntimeStatus,
  PiRuntimePackageStatus,
  RollbackScopes,
  RuntimeDefinition,
  RuntimeDiscoveryCandidate,
  RuntimeId,
  RuntimeModelCatalog,
  UpdateActionResult,
  UpdateBusy,
  UpdateModuleStatus,
  UpdatesStatus,
} from '../../types/workbench';

export function HermesRuntimePanel({
  runtime,
  bootstrap,
  localStatus,
  diagnostics,
  apiAvailability,
  onStart,
  onRefresh,
}: {
  runtime: HermesRuntimeStatus | null;
  bootstrap: HermesBootstrapStatus | null;
  localStatus: HermesLocalStatus | null;
  diagnostics: HermesRuntimeDiagnostics | null;
  apiAvailability: HermesApiAvailability;
  onStart: () => Promise<void>;
  onRefresh: () => Promise<unknown>;
}) {
  const bridgeReady = Boolean(runtime?.bridge?.ready);
  const bundledRuntimeReady = Boolean(
    runtime?.runtime?.runtimeDir || diagnostics?.runtime?.runtimeDir,
  );
  const autoStart = runtime?.autoStart;
  const runtimeTools = runtime?.tools || diagnostics?.tools || {};
  const missingRuntimeTools = Object.values(runtimeTools)
    .filter((tool) => tool && !tool.available)
    .map((tool) => tool.command);
  const autoStartWarnings = autoStart?.warnings || [];
  const autoStartLabel =
    autoStart?.status === 'starting'
      ? '工作台启动中'
      : autoStart?.status === 'ready'
        ? '工作台已就绪'
        : autoStart?.status === 'partial'
          ? '工作台已就绪，部分网关未启动'
          : autoStart?.status === 'failed'
            ? '工作台启动失败'
            : '等待启动';
  return (
    <SettingsPanel className="hermes-runtime-panel" ariaLabel="Hermes Agent Runtime">
      <div className="runtime-control-row">
        <div>
          <strong>{autoStartLabel}</strong>
          <small>
            {autoStart?.finishedAt
              ? `最近完成 ${formatTime(autoStart.finishedAt)}`
              : autoStart?.startedAt
                ? `开始于 ${formatTime(autoStart.startedAt)}`
                : '检测聊天桥接、外部兼容 API 和本地依赖。'}
          </small>
        </div>
        <div className="runtime-actions">
          <button className="secondary-btn" onClick={() => void onRefresh()}>
            重新检测
          </button>
          <button className="send-btn" onClick={() => void onStart()}>
            {bridgeReady ? '重新启动 Runtime' : '启动 Runtime'}
          </button>
        </div>
      </div>
      {autoStart?.steps?.length ? (
        <div className="runtime-step-strip" aria-label="Runtime 启动步骤">
          {autoStart.steps.map((step) => (
            <span className={step.status} key={step.id}>
              {step.label}
            </span>
          ))}
        </div>
      ) : null}
      {(autoStart?.error || autoStartWarnings.length > 0) && (
        <div className="runtime-log-list">
          {autoStart?.error && (
            <details className="runtime-autostart-log">
              <summary>查看启动日志</summary>
              <pre>{autoStart.error}</pre>
            </details>
          )}
          {autoStartWarnings.length > 0 && (
            <details className="runtime-autostart-log warning">
              <summary>查看启动警告</summary>
              <pre>{autoStartWarnings.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
      <SettingsRow
        title="Frakio Work 内置 Runtime"
        description="工作台随应用提供的 Hermes Agent 运行环境。"
      >
        <SettingsStatusValue
          state={bundledRuntimeReady ? '可用' : '未打包'}
          detail={
            runtime?.runtime?.runtimeDir ||
            diagnostics?.runtime?.runtimeDir ||
            '等待检测'
          }
          tone={bundledRuntimeReady ? 'ready' : 'warning'}
        />
      </SettingsRow>
      <SettingsRow
        title="Hermes 原生桥接"
        description="用于 Hermes Profile、网关与原生 Session 的通信。"
      >
        <SettingsStatusValue
          state={bridgeReady ? '运行中' : '桥接未就绪'}
          detail={
            runtime?.bridge?.error || runtime?.bridge?.endpoint || '等待检测'
          }
          tone={bridgeReady ? 'ready' : 'warning'}
        />
      </SettingsRow>
      <SettingsRow
        title="Hermes Home"
        description={`${localStatus?.profiles?.length || 0} 个本地 Profile。`}
      >
        <SettingsStatusValue
          state={runtime?.hermesHome || diagnostics?.hermesHome?.path || '~/.hermes'}
        />
      </SettingsRow>
      <SettingsRow
        title="Frakio Work Home"
        description="Runtime、Bridge Socket 和本地运行缓存。"
      >
        <SettingsStatusValue
          state={
            runtime?.frakioWorkHome ||
            diagnostics?.frakioWorkHome?.path ||
            '~/.frakio-work'
          }
          detail={runtime?.agentRoot || diagnostics?.agentRoot.path || ''}
        />
      </SettingsRow>
      <SettingsRow
        title="Runtime Tools"
        description="Hermes Agent 运行所需的本地命令。"
      >
        <SettingsStatusValue
          state={
            missingRuntimeTools.length
              ? `缺少 ${missingRuntimeTools.join(', ')}`
              : '依赖可用'
          }
          detail={['node', 'npm', 'npx', 'uv', 'python3']
            .map((name) => runtimeTools[name]?.path || `${name}: missing`)
            .join(' · ')}
          tone={missingRuntimeTools.length ? 'warning' : 'ready'}
        />
      </SettingsRow>
      {diagnostics && (
        <details className="runtime-parameters">
          <summary>运行参数</summary>
          <div>
            <span>
              <strong>管理服务</strong>
              {diagnostics.workbenchApi.url} · PID {diagnostics.workbenchApi.pid}
            </span>
            <span>
              <strong>当前构建</strong>v{diagnostics.workbenchApi.version || '未知'} ·{' '}
              {diagnostics.workbenchApi.buildFingerprint || '无指纹'} ·{' '}
              {diagnostics.workbenchApi.packaged ? '桌面安装包' : '源码开发版'}
            </span>
            <span>
              <strong>构建时间</strong>
              {diagnostics.workbenchApi.buildTime
                ? new Date(diagnostics.workbenchApi.buildTime).toLocaleString()
                : '未知'}
            </span>
            <span>
              <strong>运行 Runtime</strong>
              {diagnostics.agentRoot.path || '未定位'}
            </span>
            <span>
              <strong>Bridge Script</strong>
              {diagnostics.bridgeScript.path || '未定位'}
            </span>
            <span>
              <strong>Python</strong>
              {diagnostics.python.path || '未定位'}
            </span>
          </div>
        </details>
      )}
      <SettingsInlineNote>
        Profile Gateway 状态与操作请前往“频道”和“Hermes 集成”的高级 Profile 配置。
      </SettingsInlineNote>
    </SettingsPanel>
  );
}

export function UpdatesPanel({
  runtime,
  status,
  busy,
  error,
  result,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onDownloadDesktopUpdate,
  onCancelDesktopUpdate,
  onOpenDesktopUpdate,
  onCheckRuntime,
  onInstallRuntime,
  onActivateRuntime,
  onUseBundledRuntime,
  onDeleteRuntime,
}: {
  runtime: HermesRuntimeStatus | null;
  status: UpdatesStatus | null;
  busy: UpdateBusy;
  error: string;
  result: UpdateActionResult | null;
  desktopUpdateState: DesktopUpdateState | null;
  onCheckDesktopUpdate: () => Promise<void>;
  onDownloadDesktopUpdate: () => Promise<void>;
  onCancelDesktopUpdate: () => Promise<void>;
  onOpenDesktopUpdate: () => Promise<void>;
  onCheckRuntime: () => Promise<void>;
  onInstallRuntime: (tag?: string) => Promise<void>;
  onActivateRuntime: (version: string) => Promise<void>;
  onUseBundledRuntime: () => Promise<void>;
  onDeleteRuntime: (version: string) => Promise<void>;
}) {
  const [officialReleases, setOfficialReleases] = useState<HermesOfficialRelease[]>(
    [],
  );
  const [selectedReleaseTag, setSelectedReleaseTag] = useState('');
  const [releaseListError, setReleaseListError] = useState('');
  const manager = runtime?.manager;
  const active = manager?.activeRuntime || runtime?.runtime || null;
  const bundled = manager?.bundledRuntime || null;
  const latest = manager?.officialLatest || null;
  const managed = manager?.managedRuntimes || [];
  const latestBundled = Boolean(latest?.version && bundled?.version === latest.version);
  const selectedRelease =
    officialReleases.find((release) => release.tag === selectedReleaseTag) || null;
  const selectedInstalled = Boolean(
    selectedReleaseTag &&
      managed.some((item) => item.manifest?.sourceTag === selectedReleaseTag),
  );

  useEffect(() => {
    let activeRequest = true;
    void fetch('/api/hermes-runtime/releases')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(data.error || '无法读取官方 Runtime 版本。');
        return Array.isArray(data.releases)
          ? (data.releases as HermesOfficialRelease[])
          : [];
      })
      .then((releases) => {
        if (!activeRequest) return;
        setOfficialReleases(releases);
        setSelectedReleaseTag(
          (current) => current || latest?.tag || releases[0]?.tag || '',
        );
        setReleaseListError('');
      })
      .catch((loadError) => {
        if (!activeRequest) return;
        setReleaseListError(
          loadError instanceof Error
            ? loadError.message
            : '无法读取官方 Runtime 版本。',
        );
        setSelectedReleaseTag((current) => current || latest?.tag || '');
      });
    return () => {
      activeRequest = false;
    };
  }, [latest?.tag]);

  return (
    <section className="updates-page-body">
      <div className="updates-page-toolbar">
        <div>
          <strong>产品版本</strong>
          <p>Frakio Work 检查桌面版本；可选执行内核统一在 Runtime Center 管理。</p>
        </div>
        <button
          className="secondary-btn"
          onClick={() =>
            void Promise.all([onCheckDesktopUpdate(), onCheckRuntime()])
          }
          disabled={
            Boolean(busy) || desktopUpdateState?.phase === 'checking'
          }
        >
          {busy === 'runtime-check' || desktopUpdateState?.phase === 'checking'
            ? '检查中'
            : '检查更新'}
        </button>
      </div>
      <div className="settings-section-head">
        <h3>Frakio Work</h3>
      </div>
      <SettingsPanel className="update-product-panel" ariaLabel="Frakio Work 版本更新">
        <FrakioUpdateCard
          status={status?.frakioWork || null}
          desktopState={desktopUpdateState}
          onCheck={onCheckDesktopUpdate}
          onDownload={onDownloadDesktopUpdate}
          onCancel={onCancelDesktopUpdate}
          onOpenInstaller={onOpenDesktopUpdate}
        />
      </SettingsPanel>
      <div className="settings-section-head">
        <h3>Hermes Agent Runtime</h3>
      </div>
      <SettingsPanel
        className="update-product-panel"
        ariaLabel="Hermes Agent Runtime 版本管理"
      >
        <div className="update-card runtime-update-card">
          <div className="update-card-head">
            <span>
              <strong>Hermes Agent Runtime</strong>
              <small>
                官方版本独立安装。安装完成后，需要确认“使用”才会切换。
              </small>
            </span>
            <em>
              {active?.source === 'managed'
                ? '用户安装'
                : active?.source === 'override'
                  ? '开发覆盖'
                  : 'Frakio Work 内置'}
            </em>
          </div>
          <div className="update-meta">
            <span>
              <strong>当前版本</strong>
              {active?.version || '未知'}
            </span>
            <span>
              <strong>内置版本</strong>
              {bundled?.version || '未知'}
            </span>
            <span>
              <strong>官方稳定版</strong>
              {latest?.label || latest?.tag || '等待检查'}
            </span>
            <span>
              <strong>运行路径</strong>
              {active?.runtimeDir || '未定位'}
            </span>
          </div>
          {manager?.fallbackReason && (
            <div className="update-blocked">{manager.fallbackReason}</div>
          )}
          <div className="runtime-release-picker">
            <label htmlFor="runtime-official-release">官方稳定版本</label>
            <div>
              <select
                id="runtime-official-release"
                value={selectedReleaseTag}
                onChange={(event) => setSelectedReleaseTag(event.target.value)}
                disabled={
                  Boolean(busy) || (!officialReleases.length && !latest?.tag)
                }
              >
                {!officialReleases.length && latest?.tag && (
                  <option value={latest.tag}>{latest.label || latest.tag}</option>
                )}
                {!officialReleases.length && !latest?.tag && (
                  <option value="">等待检查</option>
                )}
                {officialReleases.map((release) => (
                  <option value={release.tag} key={release.tag}>
                    {release.label || release.tag}
                    {release.releaseDate ? ` · ${release.releaseDate}` : ''}
                  </option>
                ))}
              </select>
              <button
                className="secondary-btn"
                onClick={() =>
                  void onInstallRuntime(selectedReleaseTag || undefined)
                }
                disabled={
                  Boolean(busy) ||
                  !selectedReleaseTag ||
                  selectedInstalled ||
                  (latestBundled && selectedReleaseTag === latest?.tag)
                }
              >
                {busy === 'runtime-install'
                  ? '安装中'
                  : selectedInstalled
                    ? '已安装'
                    : latestBundled && selectedReleaseTag === latest?.tag
                      ? '已内置'
                      : '下载安装'}
              </button>
            </div>
            <small>
              {selectedRelease?.url ? (
                <a href={selectedRelease.url} target="_blank" rel="noreferrer">
                  查看此版本的官方说明
                </a>
              ) : (
                '只提供 NousResearch 官方稳定版本。'
              )}
            </small>
          </div>
          {releaseListError && !latest?.tag && (
            <div className="update-blocked">{releaseListError}</div>
          )}
          <div className="runtime-version-actions">
            {active?.source === 'managed' && (
              <button
                className="secondary-btn"
                onClick={() => void onUseBundledRuntime()}
                disabled={Boolean(busy)}
              >
                {busy === 'runtime-bundled' ? '切换中' : '恢复内置版本'}
              </button>
            )}
          </div>
          {managed.length > 0 && (
            <div className="runtime-version-list">
              {managed.map((item) => {
                const isActive =
                  active?.source === 'managed' && active.version === item.version;
                return (
                  <div
                    className="runtime-version-row"
                    key={`${item.version}-${item.platform}`}
                  >
                    <span>
                      <strong>{item.version}</strong>
                      <small>
                        {item.manifest?.sourceTag || item.platform || ''}
                        {item.compatible === false ? ' · Bridge 不兼容' : ''}
                      </small>
                    </span>
                    <div>
                      <button
                        className="secondary-btn"
                        onClick={() => void onActivateRuntime(item.version || '')}
                        disabled={
                          Boolean(busy) || isActive || item.compatible === false
                        }
                      >
                        {busy === `runtime-activate:${item.version}`
                          ? '切换中'
                          : isActive
                            ? '正在使用'
                            : '使用'}
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`删除 Runtime ${item.version}`}
                        title="删除这个用户 Runtime"
                        onClick={() => void onDeleteRuntime(item.version || '')}
                        disabled={Boolean(busy) || isActive}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingsPanel>
      {error && <div className="form-error">{error}</div>}
      {result?.logs?.length ? (
        <div className="updates-log">
          <strong>
            {result.target || 'update'} · {result.phase || 'status'}
          </strong>
          <span>{result.logs.slice(-3).join(' · ')}</span>
          {result.backup?.path && <em>回滚点：{result.backup.path}</em>}
          {result.restartRequired && (
            <em>更新已完成，重启当前 Frakio Work 服务后生效。</em>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function FrakioUpdateCard({
  status,
  desktopState,
  onCheck,
  onDownload,
  onCancel,
  onOpenInstaller,
}: {
  status: UpdateModuleStatus | null;
  desktopState: DesktopUpdateState | null;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenInstaller: () => Promise<void>;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const release = status?.release || null;
  const desktopSupported = desktopState?.supported === true;
  const phase = desktopSupported
    ? desktopState.phase
    : release?.updateAvailable
      ? 'available'
      : release?.latestVersion
        ? 'up-to-date'
        : 'idle';
  const percent = Math.max(
    0,
    Math.min(100, Math.round(Number(desktopState?.progress?.percent || 0))),
  );
  const stateLabel =
    phase === 'checking'
      ? '检查中'
      : phase === 'available'
        ? '有可用更新'
        : phase === 'downloading'
          ? `下载中 ${percent}%`
          : phase === 'downloaded'
            ? '已下载'
            : phase === 'error'
              ? '下载失败'
              : phase === 'up-to-date'
                ? '已是最新'
                : '等待检查';
  const errorMessage = desktopSupported ? desktopState.error : release?.error;

  async function openRelease() {
    if (!release?.releaseUrl) return;
    if (window.frakioDesktop?.openRelease)
      await window.frakioDesktop.openRelease(release.releaseUrl);
    else window.open(release.releaseUrl, '_blank', 'noopener,noreferrer');
  }

  function primaryAction() {
    if (!desktopSupported)
      return {
        label: '查看 Release',
        disabled: !release?.releaseUrl,
        action: openRelease,
      };
    if (phase === 'available' || phase === 'error')
      return {
        label: phase === 'error' ? '重新下载' : '下载更新',
        disabled: false,
        action: onDownload,
      };
    if (phase === 'downloading')
      return { label: '取消下载', disabled: false, action: onCancel };
    if (phase === 'downloaded')
      return {
        label: '退出并打开安装包',
        disabled: false,
        action: onOpenInstaller,
      };
    return {
      label: phase === 'checking' ? '检查中' : '检查更新',
      disabled: phase === 'checking',
      action: onCheck,
    };
  }

  const primary = primaryAction();
  return (
    <div
      className={`update-card ${phase === 'available' || phase === 'downloaded' ? 'available' : phase === 'error' ? 'blocked' : ''}`}
    >
      <div className="update-card-head">
        <span>
          <strong>Frakio Work</strong>
          <small>
            更新桌面应用、Web UI、API、Frakio Bridge 和下一版内置 Runtime。
          </small>
        </span>
        <em>{stateLabel}</em>
      </div>
      <div className="update-meta">
        <span>
          <strong>当前版本</strong>v
          {desktopState?.currentVersion ||
            release?.currentVersion ||
            status?.packageVersion ||
            '未知'}
        </span>
        <span>
          <strong>最新版本</strong>
          {desktopState?.latestVersion || release?.latestVersion
            ? `v${(desktopState?.latestVersion || release?.latestVersion || '').replace(/^v/i, '')}`
            : '尚未发布'}
        </span>
        <span>
          <strong>安装方式</strong>
          {desktopSupported ? '应用内下载 DMG' : '源码版'}
        </span>
        <span>
          <strong>当前架构</strong>
          {desktopState?.assetName ||
            release?.asset?.name ||
            '使用 Release 升级说明'}
        </span>
        {desktopState?.checkedAt && (
          <span>
            <strong>最近检查</strong>
            {formatTime(desktopState.checkedAt)}
          </span>
        )}
      </div>
      {phase === 'downloading' && (
        <div
          className="settings-update-download-progress"
          aria-label={`下载进度 ${percent}%`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {release?.notes && <p className="update-release-notes">{release.notes}</p>}
      {errorMessage && <div className="update-blocked">{errorMessage}</div>}
      <div className="settings-update-actions">
        <button
          className="secondary-btn"
          onClick={() => void primary.action()}
          disabled={primary.disabled}
        >
          {primary.label}
        </button>
        {release?.notes && (
          <button
            className="secondary-btn quiet"
            onClick={() => setNotesOpen(true)}
          >
            查看完整更新日志
          </button>
        )}
      </div>
      <AppDialog open={notesOpen} onOpenChange={setNotesOpen}>
        <AppDialogContent className="release-notes-dialog">
          <header className="release-notes-dialog-head">
            <div>
              <AppDialogTitle asChild>
                <h2>
                  Frakio Work{' '}
                  {release?.latestVersion
                    ? `v${release.latestVersion}`
                    : '更新日志'}
                </h2>
              </AppDialogTitle>
              <AppDialogDescription>
                {release?.publishedAt
                  ? `发布于 ${formatTime(release.publishedAt)}`
                  : '完整 GitHub Release 说明'}
              </AppDialogDescription>
            </div>
            <AppDialogClose asChild>
              <button className="icon-btn" aria-label="关闭更新日志">
                <X size={16} />
              </button>
            </AppDialogClose>
          </header>
          <div className="release-notes-dialog-body">
            <RichMarkdown content={release?.notes || '暂无更新日志。'} />
          </div>
          <footer className="release-notes-dialog-footer">
            <button
              className="secondary-btn"
              onClick={() => void openRelease()}
              disabled={!release?.releaseUrl}
            >
              在 GitHub 查看
            </button>
            <AppDialogClose asChild>
              <button className="secondary-btn">关闭</button>
            </AppDialogClose>
          </footer>
        </AppDialogContent>
      </AppDialog>
    </div>
  );
}

export function HermesBackupRow({
  backup,
  busy,
  onRollback,
  onDelete,
}: {
  backup: HermesBackup;
  busy: UpdateBusy;
  onRollback: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>;
  onDelete: (backup: HermesBackup) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<RollbackScopes>({});
  const rollbackBusy = busy === `rollback:${backup.id}`;
  const deleteBusy = busy === `delete:${backup.id}`;
  const before =
    backup.before?.displayVersion ||
    backup.before?.tagDescription ||
    shortCommit(backup.before?.commit || '') ||
    '未知版本';
  const after =
    backup.after?.displayVersion ||
    backup.after?.tagDescription ||
    shortCommit(backup.after?.commit || '') ||
    '未记录';
  const content =
    [
      backup.patchSaved ? '本地 patch' : '',
      backup.untrackedFiles?.length
        ? `${backup.untrackedFiles.length} 个未跟踪文件`
        : '',
      backup.configFiles?.length
        ? `${backup.configFiles.length} 个配置文件`
        : '',
    ]
      .filter(Boolean)
      .join(' · ') || '配置快照';
  return (
    <details
      className="backup-row"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          <strong>{backupReasonLabel(backup.reason)}</strong>
          <small>
            {formatTime(backup.createdAt)} · {before} → {after}
          </small>
        </span>
        <em>{formatFileSize(backup.size || 0)}</em>
      </summary>
      <div className="backup-row-body">
        <div className="backup-meta">
          <span>
            <strong>路径</strong>
            {backup.path}
          </span>
          <span>
            <strong>内容</strong>
            {content}
          </span>
          <span>
            <strong>状态</strong>
            {backup.status || 'ready'}
          </span>
        </div>
        {backup.dirtyFiles?.length ? (
          <div className="update-dirty">
            {backup.dirtyFiles.slice(0, 8).map((file) => (
              <code key={file}>{file}</code>
            ))}
          </div>
        ) : null}
        <div className="rollback-scopes">
          <span>回滚配置范围</span>
          <label>
            <input
              type="checkbox"
              checked={scopes.profiles === true}
              onChange={(event) =>
                setScopes((current) => ({
                  ...current,
                  profiles: event.target.checked,
                }))
              }
            />{' '}
            Profiles
          </label>
          <label>
            <input
              type="checkbox"
              checked={scopes.mcp === true}
              onChange={(event) =>
                setScopes((current) => ({
                  ...current,
                  mcp: event.target.checked,
                }))
              }
            />{' '}
            MCP
          </label>
          <label>
            <input
              type="checkbox"
              checked={scopes.channels === true}
              onChange={(event) =>
                setScopes((current) => ({
                  ...current,
                  channels: event.target.checked,
                }))
              }
            />{' '}
            频道
          </label>
          <label>
            <input
              type="checkbox"
              checked={scopes.models === true}
              onChange={(event) =>
                setScopes((current) => ({
                  ...current,
                  models: event.target.checked,
                }))
              }
            />{' '}
            模型
          </label>
        </div>
        <div className="backup-actions">
          <button
            className="secondary-btn"
            onClick={() => void onRollback(backup, scopes)}
            disabled={rollbackBusy || Boolean(busy && !rollbackBusy)}
          >
            {rollbackBusy ? '回滚中' : '回滚到此版本'}
          </button>
          <button
            className="secondary-btn danger"
            onClick={() => void onDelete(backup)}
            disabled={deleteBusy || Boolean(busy && !deleteBusy)}
          >
            {deleteBusy ? '删除中' : '删除备份'}
          </button>
        </div>
      </div>
    </details>
  );
}

export function backupReasonLabel(reason?: string) {
  if (reason === 'update') return '更新前回滚点';
  if (reason === 'pre-rollback') return '回滚前快照';
  if (reason === 'manual') return '手动备份';
  return reason || '备份';
}

export function shortCommit(value?: string) {
  return value ? value.slice(0, 7) : '';
}

export function runtimeBuildLabel(value?: string) {
  return value ? value.slice(-8) : '';
}

export function WorkbenchProfileSyncPanel({
  title,
  detail,
  hint,
  canSync,
  busy,
  error,
  onSync,
}: {
  title: string;
  detail: string;
  hint: string;
  canSync: boolean;
  busy: boolean;
  error: string;
  onSync: () => Promise<void>;
}) {
  return (
    <>
      <div className="settings-section-head">
        <h3>本地配置同步</h3>
      </div>
      <SettingsPanel ariaLabel="本地配置同步">
        <SettingsRow
          title="Hermes Agent Profiles"
          description={`${title}。${detail}`}
        >
          <button
            className="send-btn"
            onClick={() => void onSync()}
            disabled={busy || !canSync}
          >
            {busy ? '同步中' : '同步配置'}
          </button>
        </SettingsRow>
        <SettingsInlineNote>
          {hint}。模型仍需在 Frakio Work 中单独配置。
        </SettingsInlineNote>
      </SettingsPanel>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}

export function HermesBackupPanel({
  status,
  busy,
  onCreate,
  onRollback,
  onDelete,
  onCleanup,
}: {
  status: UpdatesStatus | null;
  busy: UpdateBusy;
  onCreate: () => Promise<void>;
  onRollback: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>;
  onDelete: (backup: HermesBackup) => Promise<void>;
  onCleanup: (mode: 'older-than-30-days' | 'keep-latest-10') => Promise<void>;
}) {
  const backups = status?.backups || [];
  return (
    <>
      <div className="settings-section-head">
        <h3>配置保护</h3>
      </div>
      <SettingsPanel
        className="hermes-backup-panel"
        ariaLabel="Hermes Agent 配置保护"
      >
        <SettingsRow
          title="创建配置快照"
          description="保存当前 Hermes Agent 配置，供更新或排错后回滚。"
        >
          <button
            className="secondary-btn"
            onClick={() => void onCreate()}
            disabled={Boolean(busy)}
          >
            {busy === 'backup' ? '备份中' : '立即备份'}
          </button>
        </SettingsRow>
        <SettingsRow
          title="清理旧备份"
          description="只清理备份缓存，不影响当前 Hermes Agent 配置。"
        >
          <span className="settings-inline-actions">
            <button
              className="secondary-btn"
              onClick={() => void onCleanup('keep-latest-10')}
              disabled={Boolean(busy)}
            >
              保留最近 10 条
            </button>
            <button
              className="secondary-btn danger"
              onClick={() => void onCleanup('older-than-30-days')}
              disabled={Boolean(busy)}
            >
              清理 30 天前
            </button>
          </span>
        </SettingsRow>
        {backups.length ? (
          backups.map((backup) => (
            <HermesBackupRow
              backup={backup}
              busy={busy}
              onRollback={onRollback}
              onDelete={onDelete}
              key={backup.id}
            />
          ))
        ) : (
          <SettingsInlineNote>
            还没有配置快照。首次手动备份或执行更新时会在这里显示。
          </SettingsInlineNote>
        )}
      </SettingsPanel>
    </>
  );
}

export function RuntimeCenterPage({
  onOpenHermes,
}: {
  onOpenHermes: () => void;
}) {
  const [runtimes, setRuntimes] = useState<RuntimeDefinition[]>(runtimeSeed);
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, RuntimeModelCatalog>>({});
  const [packageStatuses, setPackageStatuses] = useState<Record<string, PiRuntimePackageStatus>>({});
  const [discoveryCandidates, setDiscoveryCandidates] = useState<Record<string, RuntimeDiscoveryCandidate[]>>({});
  const [expandedRuntimeId, setExpandedRuntimeId] = useState<string>('');
  const [runtimeBusy, setRuntimeBusy] = useState('');
  const [runtimeActivity, setRuntimeActivity] = useState('');
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [gatewayRepair, setGatewayRepair] = useState<HermesGatewayRepair | null>(null);

  const detect = useCallback(async (runtimeId: string) => {
    setCheckingIds((current) => new Set(current).add(runtimeId));
    try {
      const response = await fetch(`/api/runtimes/${runtimeId}/detect`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '运行时检测失败。');
      setRuntimes((current) => mergeRuntimeDefinitions(current, [data.runtime]));
      if (runtimeId === 'hermes') {
        const hermes = await fetch('/api/hermes-runtime/status')
          .then((item) => item.json())
          .catch(() => null);
        if (hermes?.gatewayRepair) setGatewayRepair(hermes.gatewayRepair);
      }
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(runtimeId);
        return next;
      });
    }
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/runtimes');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Runtime 状态读取失败。');
      setRuntimes((current) => mergeRuntimeDefinitions(current, data.runtimes || []));
      const hermesRuntimeStatus = await fetch('/api/hermes-runtime/status')
        .then((item) => item.json())
        .catch(() => null);
      if (hermesRuntimeStatus?.gatewayRepair)
        setGatewayRepair(hermesRuntimeStatus.gatewayRepair);
      const catalogs = await Promise.all(
        ['hermes', 'pi', 'codex', 'claude'].map(async (runtimeId) => {
          try {
            const catalogResponse = await fetch(`/api/runtimes/${runtimeId}/models`);
            const catalog = await catalogResponse.json().catch(() => ({}));
            return catalogResponse.ok
              ? ([runtimeId, catalog as RuntimeModelCatalog] as const)
              : null;
          } catch {
            return null;
          }
        }),
      );
      setModelCatalogs(
        Object.fromEntries(
          catalogs.filter(Boolean) as Array<readonly [string, RuntimeModelCatalog]>,
        ),
      );
      const packageEntries = await Promise.all(
        ['pi', 'codex', 'claude'].map(async (runtimeId) => {
          try {
            const status = await requestJson<PiRuntimePackageStatus>(
              `/api/runtime-packages/${runtimeId}`,
            );
            return [runtimeId, status] as const;
          } catch {
            return null;
          }
        }),
      );
      setPackageStatuses(
        Object.fromEntries(
          packageEntries.filter(Boolean) as Array<
            readonly [string, PiRuntimePackageStatus]
          >,
        ),
      );
      const missingSnapshots = (data.runtimes || [])
        .filter((runtime: RuntimeDefinition) => !runtime.capabilitySnapshot)
        .map((runtime: RuntimeDefinition) => runtime.id);
      if (missingSnapshots.length)
        await Promise.all(
          missingSnapshots.map((runtimeId: RuntimeId) => detect(runtimeId)),
        );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Runtime 状态读取失败。',
      );
    }
  }, [detect]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshRuntimePackage = async (runtimeId: string) => {
    const status = await requestJson<PiRuntimePackageStatus>(
      `/api/runtime-packages/${runtimeId}`,
    );
    setPackageStatuses((current) => ({ ...current, [runtimeId]: status }));
    await detect(runtimeId);
    return status;
  };

  const discoverRuntime = async (runtimeId: string) => {
    setRuntimeBusy(`discover:${runtimeId}`);
    setError('');
    try {
      const data = await requestJson<{
        candidates: RuntimeDiscoveryCandidate[];
      }>(`/api/runtimes/${runtimeId}/discover`, { method: 'POST', body: '{}' });
      setDiscoveryCandidates((current) => ({
        ...current,
        [runtimeId]: data.candidates || [],
      }));
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : '系统 Runtime 发现失败。',
      );
    } finally {
      setRuntimeBusy('');
    }
  };

  const bindRuntime = async (
    runtimeId: string,
    candidate: RuntimeDiscoveryCandidate,
  ) => {
    setRuntimeBusy(`bind:${runtimeId}`);
    setError('');
    try {
      await requestJson(`/api/runtimes/${runtimeId}/native-bindings`, {
        method: 'POST',
        body: JSON.stringify({
          executablePath: candidate.realPath,
          fingerprint: candidate.fingerprint,
        }),
      });
      await refreshRuntimePackage(runtimeId);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Runtime 绑定失败。',
      );
    } finally {
      setRuntimeBusy('');
    }
  };

  const installRuntime = async (runtimeId: string, version: string) => {
    setRuntimeBusy(`install:${runtimeId}`);
    setExpandedRuntimeId(runtimeId);
    setRuntimeActivity(
      `正在下载并验证 ${runtimeLabels[runtimeId] || runtimeId} ${version}，请勿关闭 Frakio Work。`,
    );
    setError('');
    try {
      await requestJson(`/api/runtime-packages/${runtimeId}/install`, {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      await refreshRuntimePackage(runtimeId);
      setRuntimeActivity(
        `${runtimeLabels[runtimeId] || runtimeId} ${version} 已安装，可在安装来源中启用。`,
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Runtime 安装失败。',
      );
      setRuntimeActivity('');
    } finally {
      setRuntimeBusy('');
    }
  };

  const activateRuntime = async (runtimeId: string, runtimeBuildId: string) => {
    setRuntimeBusy(`activate:${runtimeBuildId}`);
    setError('');
    try {
      await requestJson(`/api/runtime-packages/${runtimeId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ runtimeBuildId }),
      });
      await refreshRuntimePackage(runtimeId);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Runtime 切换失败。',
      );
    } finally {
      setRuntimeBusy('');
    }
  };

  const unbindRuntime = async (runtimeId: string, runtimeBuildId: string) => {
    setRuntimeBusy(`unbind:${runtimeBuildId}`);
    setError('');
    try {
      await requestJson(
        `/api/runtimes/${runtimeId}/native-bindings/${encodeURIComponent(runtimeBuildId)}`,
        { method: 'DELETE' },
      );
      await refreshRuntimePackage(runtimeId);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Runtime 解除绑定失败。',
      );
    } finally {
      setRuntimeBusy('');
    }
  };

  const deleteManagedRuntime = async (runtimeId: string, version: string) => {
    setRuntimeBusy(`delete:${runtimeId}:${version}`);
    setError('');
    try {
      await requestJson(
        `/api/runtime-packages/${runtimeId}/versions/${encodeURIComponent(version)}`,
        { method: 'DELETE' },
      );
      await refreshRuntimePackage(runtimeId);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Runtime 删除失败。',
      );
    } finally {
      setRuntimeBusy('');
    }
  };

  const repairHermesGateways = async () => {
    setRuntimeBusy('repair:hermes-gateways');
    setError('');
    try {
      const data = await requestJson<{
        gatewayRepair: HermesGatewayRepair;
      }>('/api/hermes-runtime/gateway-repair', { method: 'POST', body: '{}' });
      setGatewayRepair(data.gatewayRepair);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Gateway 历史修复失败。',
      );
    } finally {
      setRuntimeBusy('');
    }
  };

  const verifyAll = () =>
    void Promise.all(runtimeSeed.map((runtime) => detect(runtime.id)));

  const runtimeSummary = useMemo(() => {
    const checked = runtimes.filter((runtime) =>
      Boolean(runtime.capabilitySnapshot),
    ).length;
    const ready = runtimes.filter((runtime) => isRuntimeReady(runtime)).length;
    const missing = runtimes.filter(
      (runtime) => runtime.installation?.status === 'missing',
    ).length;
    if (checkingIds.size) return `正在验证 ${checkingIds.size} 个运行时`;
    if (missing) return `已验证 ${ready} 个运行时，${missing} 个尚未安装`;
    return checked ? `已验证 ${ready} 个运行时` : '首次验证后会保留结果';
  }, [checkingIds.size, runtimes]);

  const renderGroup = (kind: 'core' | 'channel', title: string) => (
    <>
      <div className="settings-section-head">
        <h3>{title}</h3>
      </div>
      <SettingsPanel className="runtime-center-panel" ariaLabel={title}>
        {runtimes
          .filter((runtime) => runtime.kind === kind)
          .map((runtime) => {
            const installation = runtime.installation;
            const ready = installation?.status === 'ready';
            const checking = checkingIds.has(runtime.id);
            const installing = runtimeBusy === `install:${runtime.id}`;
            const expanded = expandedRuntimeId === runtime.id;
            const description =
              runtime.id === 'pi'
                ? '独立版本的 Pi Worker；使用 Frakio Model Center，并由 Runtime Platform 固定 Session 版本。'
                : runtime.id === 'hermes'
                  ? '内置执行运行时；使用 Frakio Model Center。Profile、网关与备份在 Hermes 集成中管理。'
                  : '使用已确认的 CLI 二进制；模型和凭据只来自 Frakio Model Center。';
            const catalog = modelCatalogs[runtime.id];
            const catalogDetail =
              runtime.kind === 'core' && catalog
                ? `${catalog.usableModelCount || 0} 个可用模型 · Frakio Model Center`
                : '';
            const checkedAt =
              runtime.capabilitySnapshot?.checkedAt ||
              installation?.checkedAt ||
              '';
            const runtimeSource =
              runtime.capabilitySnapshot?.runtimeSource === 'managed'
                ? '用户安装'
                : runtime.capabilitySnapshot?.runtimeSource === 'bundled'
                  ? 'Frakio Work 内置'
                  : '';
            const buildDetail = runtime.capabilitySnapshot?.runtimeBuildId
              ? `Build ${runtimeBuildLabel(runtime.capabilitySnapshot.runtimeBuildId)}`
              : '';
            const packageStatus = packageStatuses[runtime.id];
            const compatibleRelease = packageStatus?.releases?.verified?.[0];
            const candidates = discoveryCandidates[runtime.id] || [];
            const packageCount = packageStatus?.packages.length || 0;
            const modelRouteReady = Boolean(catalog?.usableModelCount);
            const activePackage = packageStatus?.packages.find(
              (pkg) =>
                pkg.runtimeBuildId ===
                packageStatus.activeBinding?.runtimeBuildId,
            );
            const activePackageUsable =
              activePackage?.verificationState === 'verified' &&
              activePackage?.availability === 'ready';
            const realTurnVerified = Boolean(
              activePackage?.verificationReceipt?.realTurnVerified,
            );
            const state = installing
              ? '安装中'
              : checking
                ? '验证中'
                : !runtime.capabilitySnapshot
                  ? '尚未验证'
                  : activePackage && !activePackageUsable
                    ? activePackage.verificationState === 'unverified'
                      ? '需要重新安装'
                      : '验证失败'
                    : ready && modelRouteReady
                      ? '模型链路可用'
                      : ready
                        ? 'CLI 已连接'
                        : installation?.status === 'missing'
                          ? '未安装'
                          : installation?.status === 'error'
                            ? '异常'
                            : installation?.status || '尚未验证';
            const stateTone =
              installing || (activePackage && !activePackageUsable)
                ? 'warning'
                : ready && modelRouteReady && !checking
                  ? 'ready'
                  : installation?.status === 'missing'
                    ? 'neutral'
                    : 'warning';
            const primaryLabel = installing
              ? '安装中'
              : checking
                ? '验证中'
                : installation?.status === 'missing' && compatibleRelease
                  ? '安装'
                  : ready
                    ? '重新验证'
                    : '查看问题';
            const runPrimaryAction = () => {
              if (installation?.status === 'missing' && compatibleRelease) {
                void installRuntime(runtime.id, compatibleRelease.version);
                return;
              }
              if (ready || !expanded) {
                void detect(runtime.id);
                return;
              }
              setExpandedRuntimeId(runtime.id);
            };
            return (
              <article
                className={
                  expanded
                    ? 'runtime-center-item expanded'
                    : 'runtime-center-item'
                }
                key={runtime.id}
              >
                <div className="runtime-center-row">
                  <button
                    type="button"
                    className="runtime-center-disclosure"
                    aria-expanded={expanded}
                    aria-controls={`runtime-detail-${runtime.id}`}
                    onClick={() =>
                      setExpandedRuntimeId(expanded ? '' : runtime.id)
                    }
                  >
                    <span className="runtime-center-identity">
                      <span className="runtime-center-icon">
                        <RuntimeLabel runtimeId={runtime.id} showName={false} />
                      </span>
                      <span>
                        <strong>
                          {runtimeLabels[runtime.id] || runtime.name}
                        </strong>
                        <small>{description}</small>
                      </span>
                    </span>
                    <span className="runtime-center-status">
                      <SettingsStatusValue
                        state={state}
                        detail={[
                          installation?.version,
                          checkedAt
                            ? `${formatTime(checkedAt)} 已验证`
                            : packageCount
                              ? `${packageCount} 个安装来源`
                              : '首次验证后显示详情',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        tone={stateTone}
                      />
                    </span>
                  </button>
                  <div
                    className="runtime-center-actions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      className="secondary-btn compact quiet"
                      onClick={runPrimaryAction}
                      disabled={checking || Boolean(runtimeBusy)}
                    >
                      {primaryLabel}
                    </button>
                    <AppMenu modal={false}>
                      <AppMenuTrigger asChild>
                        <button
                          className="icon-btn small"
                          aria-label={`${runtimeLabels[runtime.id] || runtime.name} 更多操作`}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </AppMenuTrigger>
                      <AppMenuContent
                        align="end"
                        aria-label={`${runtimeLabels[runtime.id] || runtime.name} 更多操作`}
                      >
                        <AppMenuItem
                          onSelect={() => void detect(runtime.id)}
                          disabled={checking}
                        >
                          <RefreshCw size={15} />
                          {runtime.capabilitySnapshot ? '重新验证' : '验证'}
                        </AppMenuItem>
                        {runtime.id === 'hermes' ? (
                          <AppMenuItem onSelect={onOpenHermes}>
                            <Settings size={15} />
                            打开 Hermes 集成
                          </AppMenuItem>
                        ) : (
                          <AppMenuItem
                            onSelect={() => void discoverRuntime(runtime.id)}
                            disabled={Boolean(runtimeBusy)}
                          >
                            <Search size={15} />
                            发现系统安装
                          </AppMenuItem>
                        )}
                        {runtime.id !== 'hermes' && compatibleRelease && (
                          <AppMenuItem
                            onSelect={() =>
                              void installRuntime(
                                runtime.id,
                                compatibleRelease.version,
                              )
                            }
                            disabled={Boolean(runtimeBusy)}
                          >
                            <Download size={15} />
                            安装 {compatibleRelease.version}
                          </AppMenuItem>
                        )}
                      </AppMenuContent>
                    </AppMenu>
                  </div>
                </div>
                {expanded && (
                  <div
                    className="runtime-center-detail"
                    id={`runtime-detail-${runtime.id}`}
                  >
                    {installing && (
                      <section
                        className="runtime-install-progress"
                        aria-live="polite"
                      >
                        <LoaderCircle
                          className="spin"
                          size={18}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>
                            正在安装{' '}
                            {runtimeLabels[runtime.id] || runtime.name}{' '}
                            {compatibleRelease?.version || ''}
                          </strong>
                          <small>
                            正在下载托管 Runtime 并验证可执行文件。完成后可在下方启用。
                          </small>
                        </div>
                      </section>
                    )}
                    <section>
                      <span>链路状态</span>
                      <strong>{state}</strong>
                      <small>
                        {ready
                          ? `二进制可用 · Adapter 可用 · ${modelRouteReady ? '模型路由可用' : '尚无可用模型路由'} · ${realTurnVerified ? `真实对话已验证${activePackage?.verificationReceipt?.realTurnVerifiedAt ? ` ${formatTime(String(activePackage.verificationReceipt.realTurnVerifiedAt))}` : ''}` : '真实对话待验证'}`
                          : installation?.detail ||
                            '请完成验证或安装后再使用。'}
                      </small>
                    </section>
                    <section>
                      <span>安装来源</span>
                      <div className="runtime-source-list">
                        {packageStatus?.packages.map((pkg) => (
                          <div
                            className="runtime-source-card"
                            key={pkg.runtimeBuildId}
                          >
                            <div>
                              <strong>
                                {pkg.source === 'native'
                                  ? '系统安装'
                                  : pkg.source === 'bundled'
                                    ? '应用内置'
                                    : '托管安装'}{' '}
                                {pkg.runtimeVersion}
                              </strong>
                              <small
                                title={pkg.executablePath || pkg.runtimeDir}
                              >
                                {pkg.executablePath || pkg.runtimeDir}
                              </small>
                            </div>
                            <div className="runtime-source-actions">
                              <em>
                                {packageStatus.activeBinding?.runtimeBuildId ===
                                pkg.runtimeBuildId
                                  ? '正在使用'
                                  : pkg.verificationState === 'unverified'
                                    ? '需要重新安装'
                                    : pkg.verificationState !== 'verified' ||
                                        pkg.availability !== 'ready'
                                      ? '不可用'
                                      : '可用'}
                              </em>
                              {packageStatus.activeBinding?.runtimeBuildId !==
                                pkg.runtimeBuildId &&
                                pkg.verificationState === 'verified' &&
                                pkg.availability === 'ready' && (
                                  <button
                                    className="secondary-btn compact quiet"
                                    disabled={Boolean(runtimeBusy)}
                                    onClick={() =>
                                      void activateRuntime(
                                        runtime.id,
                                        pkg.runtimeBuildId,
                                      )
                                    }
                                  >
                                    启用
                                  </button>
                                )}
                              <AppMenu modal={false}>
                                <AppMenuTrigger asChild>
                                  <button
                                    className="icon-btn small"
                                    aria-label={`${pkg.runtimeVersion} 更多操作`}
                                  >
                                    <MoreHorizontal size={15} />
                                  </button>
                                </AppMenuTrigger>
                                <AppMenuContent align="end">
                                  {pkg.source === 'native' && (
                                    <AppMenuItem
                                      onSelect={() =>
                                        void unbindRuntime(
                                          runtime.id,
                                          pkg.runtimeBuildId,
                                        )
                                      }
                                      disabled={Boolean(runtimeBusy)}
                                    >
                                      解除绑定
                                    </AppMenuItem>
                                  )}
                                  {pkg.source === 'managed' && (
                                    <AppMenuItem
                                      variant="destructive"
                                      onSelect={() =>
                                        void deleteManagedRuntime(
                                          runtime.id,
                                          pkg.runtimeVersion,
                                        )
                                      }
                                      disabled={
                                        Boolean(runtimeBusy) ||
                                        packageStatus.activeBinding
                                          ?.runtimeBuildId ===
                                          pkg.runtimeBuildId ||
                                        packageStatus.previousBinding
                                          ?.runtimeBuildId ===
                                          pkg.runtimeBuildId
                                      }
                                    >
                                      <Trash2 size={15} />
                                      删除
                                    </AppMenuItem>
                                  )}
                                </AppMenuContent>
                              </AppMenu>
                            </div>
                          </div>
                        ))}
                        {!packageStatus?.packages.length && (
                          <small className="runtime-detail-empty">
                            尚未发现已绑定的安装来源。
                          </small>
                        )}
                      </div>
                    </section>
                    <section>
                      <span>操作记录</span>
                      <small>
                        {[
                          runtimeSource,
                          buildDetail,
                          catalogDetail,
                          checkedAt
                            ? `最近验证 ${formatTime(checkedAt)}`
                            : '尚无验证记录',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </section>
                    {runtime.id === 'hermes' && gatewayRepair && (
                      <section>
                        <span>Gateway 历史修复</span>
                        <strong>
                          {gatewayRepair.status === 'completed'
                            ? '旧版残留已自动清理'
                            : '自动清理已完成，仍有项目需要确认'}
                        </strong>
                        <small>
                          {[
                            `停止 ${gatewayRepair.stoppedServices.length} 个旧服务`,
                            `归档 ${gatewayRepair.archivedProfiles.length} 个孤儿 Profile`,
                            `清理 ${gatewayRepair.cleanedAutoStartNames.length} 个自动启动项`,
                            `执行于 ${formatTime(gatewayRepair.repairedAt)}`,
                          ].join(' · ')}
                        </small>
                        {gatewayRepair.unresolved.length > 0 && (
                          <div className="runtime-source-list">
                            {gatewayRepair.unresolved
                              .slice(0, 6)
                              .map((item, index) => (
                                <div
                                  className="runtime-source-card"
                                  key={`${item.profileName}:${index}`}
                                >
                                  <div>
                                    <strong>
                                      {item.profileName || '未知 Profile'}
                                    </strong>
                                    <small>{item.reason}</small>
                                  </div>
                                  <em>未自动处理</em>
                                </div>
                              ))}
                          </div>
                        )}
                        <div className="runtime-source-actions">
                          <button
                            className="secondary-btn compact quiet"
                            onClick={() => void repairHermesGateways()}
                            disabled={Boolean(runtimeBusy)}
                          >
                            {runtimeBusy === 'repair:hermes-gateways'
                              ? '检测中'
                              : '重新检测旧 Gateway'}
                          </button>
                        </div>
                      </section>
                    )}
                    {candidates.length > 0 && (
                      <section>
                        <span>发现的系统安装</span>
                        <div className="runtime-source-list">
                          {candidates.map((candidate) => (
                            <div
                              className="runtime-source-card"
                              key={`${candidate.realPath}:${candidate.fingerprint}`}
                            >
                              <div>
                                <strong>
                                  {candidate.version || '未知版本'} ·{' '}
                                  {candidate.compatibility === 'compatible'
                                    ? '兼容'
                                    : '需检查'}
                                </strong>
                                <small title={candidate.realPath}>
                                  {candidate.realPath}
                                </small>
                              </div>
                              {candidate.compatibility === 'compatible' && (
                                <button
                                  className="secondary-btn compact quiet"
                                  disabled={Boolean(runtimeBusy)}
                                  onClick={() =>
                                    void bindRuntime(runtime.id, candidate)
                                  }
                                >
                                  确认绑定
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </article>
            );
          })}
      </SettingsPanel>
    </>
  );
  return (
    <>
      <div className="settings-head">
        <div>
          <h2>Runtime Center</h2>
          <p className="settings-description">
            {runtimeActivity || runtimeSummary}
          </p>
        </div>
        <button
          className="secondary-btn"
          onClick={verifyAll}
          disabled={checkingIds.size > 0 || Boolean(runtimeBusy)}
        >
          {checkingIds.size > 0 ? '验证中' : '重新验证全部'}
        </button>
      </div>
      {renderGroup('core', 'Runtime 内核')}
      {renderGroup('channel', 'CLI 内核')}
      <SettingsInlineNote>
        这里是全部执行运行时的唯一总入口。切换运行时会创建独立原生 Session；Agent 人格、Frakio 对话、Memory 和 Workspace Vault 保持不变。
      </SettingsInlineNote>
      {error && <div className="form-error">{error}</div>}
    </>
  );
}
// wjz新建文件结束。
