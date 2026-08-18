// wjz新建文件，新建原因：解耦外观与通用设置页面组件（AppearanceSettingsPage, WorkbenchResponseSettings, TelemetrySettingsPanel 等），修改时间：2026-08-17。
// 文件内容概述：系统主题/外观切换、紧凑模式、左侧置顶项配置、流式响应体验、隐私/遥测统计、桌面版更新状态指示器与归档对话面板。
import React from 'react';
import {
  Archive,
  ArrowDownToLine,
  Check,
  LoaderCircle,
  Monitor,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Sun,
  Trash2,
} from 'lucide-react';
import {
  SettingsInlineNote,
  SettingsPanel,
  SettingsRow,
  SettingsToggleRow,
} from '../../settings-ui';
import {
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
  AppPopover,
  AppPopoverContent,
  AppPopoverTrigger,
} from '../../overlay-primitives';
import { railNavItems } from '../../utils/workbench-helpers';
import { formatFileSize, formatTime } from '../../utils/formatters';
import type {
  DesktopUpdateState,
  PinnedNav,
  TelemetryStatus,
  ThreadSummary,
  WorkbenchUiSettings,
} from '../../types/workbench';

export function WorkbenchResponseSettings({
  uiSettings,
  onUpdateUi,
}: {
  uiSettings: WorkbenchUiSettings;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
}) {
  const rows = [
    {
      label: '流式响应',
      hint: 'Agent 回复按打字节奏展示。',
      checked: uiSettings.streamingResponses !== false,
      onChange: (checked: boolean) => onUpdateUi({ streamingResponses: checked }),
    },
    {
      label: '丰富的工具描述',
      hint: '让 Agent 为每个工具步骤生成简短动作名和执行意图。',
      checked: uiSettings.richToolDescriptions !== false,
      onChange: (checked: boolean) => onUpdateUi({ richToolDescriptions: checked }),
    },
  ];
  return (
    <>
      <div className="settings-section-head">
        <h3>响应体验</h3>
      </div>
      <SettingsPanel className="workbench-display-panel" ariaLabel="响应体验">
        {rows.map((row) => (
          <SettingsToggleRow
            key={row.label}
            title={row.label}
            description={row.hint}
            checked={row.checked}
            onChange={row.onChange}
          />
        ))}
      </SettingsPanel>
    </>
  );
}

export function AppearanceSettingsPage({
  uiSettings,
  pinnedNav,
  onUpdateUi,
  onTogglePinned,
}: {
  uiSettings: WorkbenchUiSettings;
  pinnedNav: PinnedNav;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
  onTogglePinned: (id: string) => void;
}) {
  return (
    <>
      <div className="settings-head">
        <h2>外观</h2>
      </div>
      <div className="settings-section-head">
        <h3>主题</h3>
      </div>
      <SettingsPanel ariaLabel="主题设置">
        <SettingsRow
          title="应用外观"
          description="系统模式会跟随 macOS 的浅色与深色设置。"
        >
          <div className="appearance-segmented" role="group" aria-label="应用外观">
            {(['system', 'light', 'dark'] as const).map((appearance) => (
              <button
                type="button"
                className={
                  (uiSettings.appearance || 'system') === appearance
                    ? 'selected'
                    : ''
                }
                key={appearance}
                onClick={() => onUpdateUi({ appearance })}
              >
                {appearance === 'system' ? (
                  <>
                    <Monitor size={14} />系统
                  </>
                ) : appearance === 'light' ? (
                  <>
                    <Sun size={14} />浅色
                  </>
                ) : (
                  <>
                    <Moon size={14} />深色
                  </>
                )}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsPanel>
      <div className="settings-section-head">
        <h3>界面布局</h3>
      </div>
      <SettingsPanel ariaLabel="界面布局">
        <SettingsToggleRow
          title="紧凑模式"
          description="压缩消息区和导航密度。"
          checked={uiSettings.density === 'compact'}
          onChange={(checked) =>
            onUpdateUi({ density: checked ? 'compact' : 'comfortable' })
          }
        />
      </SettingsPanel>
      <div className="settings-section-head">
        <h3>左侧置顶</h3>
      </div>
      <SettingsPanel ariaLabel="左侧置顶">
        {railNavItems.map((item) => (
          <SettingsToggleRow
            key={item.id}
            title={item.label}
            description="在主界面左侧导航中显示。"
            checked={pinnedNav[item.id] !== false}
            onChange={() => onTogglePinned(item.id)}
          />
        ))}
      </SettingsPanel>
    </>
  );
}

export function TelemetrySettingsPanel({
  uiSettings,
  status,
  onUpdateUi,
}: {
  uiSettings: WorkbenchUiSettings;
  status: TelemetryStatus | null;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
}) {
  return (
    <>
      <div className="settings-section-head">
        <h3>使用统计</h3>
      </div>
      <SettingsPanel className="telemetry-settings-panel" ariaLabel="隐私设置">
        <SettingsToggleRow
          title="匿名使用统计"
          description="用于统计日活、月活、留存、功能结果和粗略地区分布。"
          checked={uiSettings.telemetryEnabled === true}
          onChange={(checked) =>
            onUpdateUi({
              telemetryEnabled: checked,
              telemetryNoticeSeenAt:
                uiSettings.telemetryNoticeSeenAt || new Date().toISOString(),
            })
          }
        />
        <SettingsInlineNote>
          公网 IP 只由 Umami 换算为国家、省份和城市。不会发送对话、文件内容、项目名称、路径、密钥或账户资料。
          <span className="telemetry-status-row">
            <span>{status?.configured ? 'Umami 已配置' : 'Umami 未配置'}</span>
            <span>待发送 {status?.queueSize || 0} 条</span>
            <span>
              {status?.lastSentAt
                ? `最近发送 ${formatTime(status.lastSentAt)}`
                : '尚未发送'}
            </span>
          </span>
        </SettingsInlineNote>
      </SettingsPanel>
    </>
  );
}

export function TelemetryNotice({
  onAllow,
  onDecline,
}: {
  onAllow: () => void;
  onDecline: () => void;
}) {
  return (
    <aside className="telemetry-notice" role="status" aria-live="polite">
      <div>
        <strong>是否允许匿名使用统计？</strong>
        <p>
          同意后才会统计功能使用和粗略地区。不会发送对话、文件、项目名称、路径、密钥或账户资料。
        </p>
      </div>
      <div className="telemetry-notice-actions">
        <button className="secondary-btn" onClick={onDecline}>
          不发送
        </button>
        <button className="send-btn" onClick={onAllow}>
          同意
        </button>
      </div>
    </aside>
  );
}

export function DesktopUpdateBadge({
  state,
  open,
  onOpenChange,
  onCancel,
  onInstall,
}: {
  state: DesktopUpdateState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onInstall: () => void;
}) {
  const percent = Math.max(
    0,
    Math.min(100, Math.round(Number(state.progress?.percent || 0))),
  );
  const version = state.latestVersion
    ? `v${state.latestVersion.replace(/^v/i, '')}`
    : '新版';
  const label =
    state.phase === 'available'
      ? `下载 Frakio Work ${version}`
      : state.phase === 'downloading'
        ? `Frakio Work ${version} 正在下载，${percent}%`
        : state.phase === 'downloaded'
          ? `Frakio Work ${version} 已下载，点击安装`
          : `Frakio Work ${version} 下载失败，点击重试`;
  const Icon =
    state.phase === 'downloading'
      ? LoaderCircle
      : state.phase === 'downloaded'
        ? Check
        : state.phase === 'error'
          ? RefreshCw
          : ArrowDownToLine;
  return (
    <AppPopover open={open} onOpenChange={onOpenChange}>
      <AppPopoverTrigger asChild>
        <button
          type="button"
          className={`desktop-update-badge ${state.phase}`}
          aria-label={label}
          title={label}
        >
          <Icon size={13} aria-hidden="true" />
        </button>
      </AppPopoverTrigger>
      <AppPopoverContent side="top" align="end" className="desktop-update-popover">
        {state.phase === 'downloaded' ? (
          <>
            <div className="desktop-update-popover-copy">
              <strong>Frakio Work {version} 已准备好</strong>
              <small>打开安装包后，将新版拖入 Applications 替换当前版本。</small>
            </div>
            <button type="button" className="send-btn" onClick={onInstall}>
              退出并打开安装包
            </button>
          </>
        ) : (
          <>
            <div className="desktop-update-popover-copy">
              <strong>正在下载 Frakio Work {version}</strong>
              <small>
                {percent}%
                {state.progress.total > 0
                  ? ` · ${formatFileSize(state.progress.transferred)} / ${formatFileSize(state.progress.total)}`
                  : ''}
              </small>
            </div>
            <div className="desktop-update-progress" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </div>
            <button type="button" className="secondary-btn" onClick={onCancel}>
              取消下载
            </button>
          </>
        )}
      </AppPopoverContent>
    </AppPopover>
  );
}

export function ArchivedThreadsPanel({
  threads,
  onRefresh,
  onRestore,
  onDelete,
}: {
  threads: ThreadSummary[];
  onRefresh: () => Promise<void>;
  onRestore: (threadId: string) => Promise<void>;
  onDelete: (threadId: string) => Promise<void>;
}) {
  async function restore(thread: ThreadSummary) {
    await onRestore(thread.id);
    await onRefresh();
  }
  async function remove(thread: ThreadSummary) {
    const ok = window.confirm(
      `删除对话「${thread.title}」？\n\n删除后不会进入归档。`,
    );
    if (!ok) return;
    await onDelete(thread.id);
    await onRefresh();
  }
  return (
    <>
      <div className="settings-head">
        <div>
          <h2>归档对话</h2>
          <p className="settings-description">
            归档后的对话会留在这里，需要时可恢复到原来的工作区。
          </p>
        </div>
        {threads.length > 0 && (
          <span className="settings-head-count">{threads.length} 个归档</span>
        )}
      </div>
      <section className="studio-settings-panel archived-threads-panel">
        {threads.length ? (
          threads.map((thread) => (
            <div className="archived-thread-row" key={thread.id}>
              <div>
                <strong>{thread.title}</strong>
                <span>
                  {thread.workspaceRootPath
                    ? thread.workspaceRootPath
                    : '单聊对话'}{' '}
                  ·{' '}
                  {thread.archivedAt
                    ? formatTime(thread.archivedAt)
                    : formatTime(thread.updatedAt)}
                </span>
              </div>
              <button
                className="secondary-btn compact"
                onClick={() => void restore(thread)}
              >
                恢复
              </button>
              <AppMenu>
                <AppMenuTrigger asChild>
                  <button
                    className="icon-btn small"
                    aria-label={`更多操作：${thread.title}`}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </AppMenuTrigger>
                <AppMenuContent align="end">
                  <AppMenuItem
                    variant="destructive"
                    onSelect={() => void remove(thread)}
                  >
                    <Trash2 size={15} />
                    删除对话
                  </AppMenuItem>
                </AppMenuContent>
              </AppMenu>
            </div>
          ))
        ) : (
          <div className="settings-empty-state archived-empty-state">
            <Archive size={24} aria-hidden="true" />
            <strong>还没有归档对话</strong>
            <span>归档后的对话会显示在这里，可随时恢复。</span>
          </div>
        )}
      </section>
    </>
  );
}
// wjz新建文件结束。
