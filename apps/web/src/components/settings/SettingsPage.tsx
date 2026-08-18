// wjz新建文件，新建原因：解耦全量系统设置总页面与侧边栏路由组件（SettingsPage, SettingsRail），修改时间：2026-08-17。
// 文件内容概述：设置中心 12 个领域子页面路由分发（个人资料、工作台、外观、隐私、归档、Agent、记忆中心、资料库、技能、插件、工具能力、Runtime Center、模型、Hermes 集成、MCP、频道、任务、监控、系统状态、版本更新）与设置检索导航栏。
import React, { useState } from 'react';
import {
  BaseIcon,
  BaseButton,
  BaseInput,
  BaseSelect,
  BaseBadge,
  BaseCard,
  BaseEmptyState,
} from '../base';

const Activity = (p: any) => <BaseIcon name="activity" {...p} />;
const Archive = (p: any) => <BaseIcon name="archive" {...p} />;
const ArrowLeft = (p: any) => <BaseIcon name="arrow-left" {...p} />;
const Bot = (p: any) => <BaseIcon name="bot" {...p} />;
const Boxes = (p: any) => <BaseIcon name="boxes" {...p} />;
const Brain = (p: any) => <BaseIcon name="brain" {...p} />;
const Cable = (p: any) => <BaseIcon name="cable" {...p} />;
const Clock3 = (p: any) => <BaseIcon name="clock3" {...p} />;
const Cpu = (p: any) => <BaseIcon name="cpu" {...p} />;
const Database = (p: any) => <BaseIcon name="database" {...p} />;
const MessageSquare = (p: any) => <BaseIcon name="message-square" {...p} />;
const Network = (p: any) => <BaseIcon name="network" {...p} />;
const Palette = (p: any) => <BaseIcon name="palette" {...p} />;
const PanelRight = (p: any) => <BaseIcon name="panel-right" {...p} />;
const RefreshCw = (p: any) => <BaseIcon name="refresh-cw" {...p} />;
const Search = (p: any) => <BaseIcon name="search" {...p} />;
const Settings = (p: any) => <BaseIcon name="settings" {...p} />;
const ShieldCheck = (p: any) => <BaseIcon name="shield-check" {...p} />;
const Sparkles = (p: any) => <BaseIcon name="sparkles" {...p} />;
const UserCircle = (p: any) => <BaseIcon name="user-circle" {...p} />;
const X = (p: any) => <BaseIcon name="x" {...p} />;
import {
  SettingsField,
  SettingsInlineNote,
  SettingsPanel,
  SettingsRow,
} from '../../settings-ui';
import { resolveHermesProfileNameForAgent } from '../../utils/model-helpers';
import { formatTime } from '../../utils/formatters';
import { permissionLabel } from '../collaboration/PlanAndDecisionPanels';
import { SystemStatusPage } from './SystemStatusPage';
import { ToolCapabilitiesPage } from './ToolCapabilitiesPage';
import { MemoryCenterPage } from './MemoryCenterPage';
import { KnowledgeVaultsPage } from './KnowledgeVaultsPage';
import { HermesModulesPage } from './HermesModulesPage';
import { ModelCenter } from './ModelCenter';
import { OrgPage } from './OrgPage';
import { UserProfilePanel } from './UserProfilePanel';
import { MonitoringPage } from './MonitoringPage';
import {
  AppearanceSettingsPage,
  ArchivedThreadsPanel,
  TelemetrySettingsPanel,
  WorkbenchResponseSettings,
} from './AppearanceAndGeneralSettings';
import {
  HermesBackupPanel,
  HermesRuntimePanel,
  RuntimeCenterPage,
  UpdatesPanel,
  WorkbenchProfileSyncPanel,
} from './RuntimeCenterPage';
import {
  ChannelsPage,
  HermesAdvancedProfileConfig,
  JobsPage,
  McpSettingsPage,
} from './HermesIntegrationsPage';
import type {
  Agent,
  DesktopUpdateState,
  FetchAvailableModels,
  HermesApiAvailability,
  HermesBackup,
  HermesBootstrapStatus,
  HermesLocalStatus,
  HermesRuntimeDiagnostics,
  HermesRuntimeStatus,
  ModelCapability,
  ModelProfile,
  PermissionMode,
  PinnedNav,
  ProfileEditorControls,
  RollbackScopes,
  SaveModel,
  TelemetryStatus,
  ThreadSummary,
  UpdateActionResult,
  UpdateBusy,
  UpdatesStatus,
  UserProfile,
  Vault,
  WorkbenchUiSettings,
} from '../../types/workbench';

export type SettingsSection =
  | 'localConnection'
  | 'runtimes'
  | 'memory'
  | 'tools'
  | 'hermesAgent'
  | 'updates'
  | 'appearance'
  | 'privacy'
  | 'agents'
  | 'skills'
  | 'profile'
  | 'workbench'
  | 'archivedThreads'
  | 'mcp'
  | 'models'
  | 'channels'
  | 'plugins'
  | 'jobs'
  | 'monitoring'
  | 'vaults';

export const settingsGroups: Array<{
  title: string;
  items: Array<{
    id: SettingsSection;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    aliases?: string[];
    beta?: boolean;
  }>;
}> = [
  {
    title: '个人',
    items: [
      { id: 'profile', label: '个人资料', icon: UserCircle },
      { id: 'workbench', label: '工作台', icon: PanelRight },
      {
        id: 'appearance',
        label: '外观',
        icon: Palette,
        aliases: ['主题', '浅色', '深色', '紧凑模式'],
      },
      {
        id: 'privacy',
        label: '隐私',
        icon: ShieldCheck,
        aliases: ['匿名使用统计', 'Umami'],
      },
      { id: 'archivedThreads', label: '归档对话', icon: Archive },
    ],
  },
  {
    title: '协作基础',
    items: [
      { id: 'agents', label: 'Agent 配置', icon: Network },
      {
        id: 'memory',
        label: '记忆中心',
        icon: Brain,
        aliases: ['长期记忆', 'Memory Ledger', '候选记忆'],
        beta: true,
      },
      {
        id: 'vaults',
        label: '资料库',
        icon: Database,
        aliases: ['Knowledge', '知识库', 'Vault', 'Obsidian', '仓库'],
        beta: true,
      },
      {
        id: 'skills',
        label: '技能',
        icon: Sparkles,
        aliases: ['Skill', '全局技能', 'Agent 技能'],
      },
      {
        id: 'plugins',
        label: '插件',
        icon: Boxes,
        aliases: ['Plugin', '全局插件', 'Agent 插件'],
      },
      {
        id: 'tools',
        label: '工具能力',
        icon: Cable,
        aliases: ['网页搜索', '网页浏览', '浏览器', '网络能力'],
      },
    ],
  },
  {
    title: '运行时与模型',
    items: [
      {
        id: 'runtimes',
        label: 'Runtime Center',
        icon: Cpu,
        aliases: ['Pi', 'Codex', 'Claude', '运行时', '内核'],
      },
      { id: 'models', label: '模型', icon: Bot },
      {
        id: 'hermesAgent',
        label: 'Hermes 集成',
        icon: Sparkles,
        aliases: ['Hermes Agent', 'Hermes Runtime', '诊断', '备份', '回滚', 'Profile'],
      },
    ],
  },
  {
    title: '集成',
    items: [
      { id: 'mcp', label: 'MCP', icon: Boxes },
      { id: 'channels', label: '频道', icon: MessageSquare },
    ],
  },
  {
    title: '自动化',
    items: [
      { id: 'jobs', label: '任务', icon: Clock3 },
      { id: 'monitoring', label: '监控', icon: Activity },
    ],
  },
  {
    title: '系统',
    items: [
      {
        id: 'localConnection',
        label: '系统状态',
        icon: Cable,
        aliases: ['本地连接', '本地服务', 'Frakio Work Home', '外部兼容 API'],
      },
      {
        id: 'updates',
        label: '版本更新',
        icon: RefreshCw,
        aliases: ['版本与更新', 'Frakio Work 更新', 'Hermes Agent Runtime 更新'],
      },
    ],
  },
];

export function SettingsRail({
  activeSection,
  onSectionChange,
  onReturnToConversation,
}: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onReturnToConversation: () => void;
}) {
  const [settingsQuery, setSettingsQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const visibleSettingsGroups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !normalizedSettingsQuery ||
          `${group.title} ${item.label} ${(item.aliases || []).join(' ')}`
            .toLowerCase()
            .includes(normalizedSettingsQuery),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="settings-rail-sidebar">
      <div className="settings-rail-head">
        <button className="settings-return" onClick={onReturnToConversation}>
          <ArrowLeft size={16} />
          <span>返回对话</span>
        </button>
        <button
          className="settings-mobile-toggle"
          type="button"
          aria-label={mobileOpen ? '收起设置导航' : '展开设置导航'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((current) => !current)}
        >
          {mobileOpen ? <X size={16} /> : <Settings size={16} />}
        </button>
      </div>
      <div className={mobileOpen ? 'settings-rail-body open' : 'settings-rail-body'}>
        <label className="settings-search">
          <Search size={15} />
          <input
            value={settingsQuery}
            onChange={(event) => setSettingsQuery(event.target.value)}
            placeholder="搜索设置..."
          />
        </label>
        <div className="settings-nav">
          {visibleSettingsGroups.map((group) => (
            <section className="settings-nav-group" key={group.title}>
              <span>{group.title}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={activeSection === item.id ? 'selected' : ''}
                    key={item.id}
                    aria-current={activeSection === item.id ? 'page' : undefined}
                    onClick={() => {
                      onSectionChange(item.id);
                      setMobileOpen(false);
                    }}
                  >
                    <Icon size={16} />
                    <strong>
                      {item.label}
                      {item.beta && <span className="settings-nav-beta">Beta</span>}
                    </strong>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function SettingsPage({
  vaults,
  models,
  modelCapabilities,
  agents,
  hermesStatus,
  hermesBootstrap,
  hermesRuntime,
  hermesDiagnostics,
  hermesApiAvailability,
  hermesError,
  updatesStatus,
  updatesBusy,
  updatesError,
  updatesResult,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onDownloadDesktopUpdate,
  onCancelDesktopUpdate,
  onOpenDesktopUpdate,
  onCheckHermesRuntime,
  onInstallHermesRuntime,
  onActivateHermesRuntime,
  onUseBundledHermesRuntime,
  onDeleteHermesRuntime,
  onCreateHermesBackup,
  onRollbackHermesBackup,
  onDeleteHermesBackup,
  onCleanupHermesBackups,
  userProfile,
  uiSettings,
  telemetryStatus,
  isImportingHermes,
  vaultPathInput,
  setVaultPathInput,
  vaultError,
  vaultBusy,
  addVault,
  reindexVault,
  deleteVault,
  resolveLegacyVaultBinding,
  onImportHermes,
  onRunFirstUseGuide,
  firstUseGuideRunning,
  onStartHermesRuntime,
  onRefreshHermesRuntime,
  onStartProfileGateway,
  onStopProfileGateway,
  onUpdateUi,
  onUserProfileSaved,
  pinnedNav,
  onTogglePinned,
  modelError,
  saveModel,
  deleteModel,
  fetchAvailableModels,
  onCapabilityChanged,
  activeSection,
  onSectionChange,
  archivedThreads,
  onRefreshArchivedThreads,
  onRestoreThread,
  onDeleteThread,
  selectedOrgAgentId,
  onSelectAgent,
  onProfilesChanged,
  onUpdateAgent,
  onDeleteAgent,
  onCreateAgent,
  profileEditor,
  onUpdateDefaultAgent,
  onOpenMemorySource,
}: {
  vaults: Vault[];
  models: ModelProfile[];
  modelCapabilities: Record<string, ModelCapability>;
  agents: Agent[];
  hermesStatus: HermesLocalStatus | null;
  hermesBootstrap: HermesBootstrapStatus | null;
  hermesRuntime: HermesRuntimeStatus | null;
  hermesDiagnostics: HermesRuntimeDiagnostics | null;
  hermesApiAvailability: HermesApiAvailability;
  hermesError: string;
  updatesStatus: UpdatesStatus | null;
  updatesBusy: UpdateBusy;
  updatesError: string;
  updatesResult: UpdateActionResult | null;
  desktopUpdateState: DesktopUpdateState | null;
  onCheckDesktopUpdate: () => Promise<void>;
  onDownloadDesktopUpdate: () => Promise<void>;
  onCancelDesktopUpdate: () => Promise<void>;
  onOpenDesktopUpdate: () => Promise<void>;
  onCheckHermesRuntime: () => Promise<void>;
  onInstallHermesRuntime: (tag?: string) => Promise<void>;
  onActivateHermesRuntime: (version: string) => Promise<void>;
  onUseBundledHermesRuntime: () => Promise<void>;
  onDeleteHermesRuntime: (version: string) => Promise<void>;
  onCreateHermesBackup: () => Promise<void>;
  onRollbackHermesBackup: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>;
  onDeleteHermesBackup: (backup: HermesBackup) => Promise<void>;
  onCleanupHermesBackups: (mode: 'older-than-30-days' | 'keep-latest-10') => Promise<void>;
  userProfile: UserProfile;
  uiSettings: WorkbenchUiSettings;
  telemetryStatus: TelemetryStatus | null;
  isImportingHermes: boolean;
  vaultPathInput: string;
  setVaultPathInput: (value: string) => void;
  vaultError: string;
  vaultBusy: Record<string, 'index' | 'delete' | 'keep' | 'detach'>;
  addVault: (kind?: 'personal' | 'project', useDefault?: boolean) => Promise<void>;
  reindexVault: (vaultId: string) => Promise<void>;
  deleteVault: (vault: Vault) => Promise<void>;
  resolveLegacyVaultBinding: (vault: Vault, action: 'keep' | 'detach') => Promise<void>;
  onImportHermes: () => Promise<void>;
  onRunFirstUseGuide: () => void;
  firstUseGuideRunning: boolean;
  onStartHermesRuntime: () => Promise<void>;
  onRefreshHermesRuntime: () => Promise<unknown>;
  onStartProfileGateway: (profileName: string) => Promise<void>;
  onStopProfileGateway: (profileName: string) => Promise<void>;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
  onUserProfileSaved: (profile: UserProfile, agents?: Agent[]) => void;
  pinnedNav: PinnedNav;
  onTogglePinned: (id: string) => void;
  modelError: string;
  saveModel: SaveModel;
  deleteModel: (modelId: string) => Promise<boolean>;
  fetchAvailableModels: FetchAvailableModels;
  onCapabilityChanged: (modelId: string, modelName: string, capability: ModelCapability) => void;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  archivedThreads: ThreadSummary[];
  onRefreshArchivedThreads: () => Promise<void>;
  onRestoreThread: (threadId: string) => Promise<void>;
  onDeleteThread: (threadId: string) => Promise<void>;
  selectedOrgAgentId: string;
  onSelectAgent: (id: string) => void;
  onProfilesChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onCreateAgent: () => void;
  profileEditor: ProfileEditorControls;
  onUpdateDefaultAgent: (agentId: string) => void;
  onOpenMemorySource: (threadId: string, messageId?: string) => void;
}) {
  const [newVaultKind, setNewVaultKind] = useState<'personal' | 'project'>('project');
  const [showVaultConnector, setShowVaultConnector] = useState(false);
  const localProfiles = hermesBootstrap?.profiles.length
    ? hermesBootstrap.profiles
    : hermesStatus?.profiles || [];
  const detectedProfiles = localProfiles.length;
  const hermesPath =
    hermesBootstrap?.installPath ||
    hermesStatus?.profiles?.[0]?.path?.replace(/\/profiles\/[^/]+$/, '') ||
    '~/.hermes';
  const canSyncHermes = detectedProfiles > 0;
  const workbenchApiOffline = hermesApiAvailability === 'offline';
  const localHermesTitle = workbenchApiOffline
    ? 'Frakio Work 本地管理服务未运行'
    : canSyncHermes
      ? '已发现本地 Hermes 配置'
      : '未发现本地 Hermes 配置';
  const localHermesDetail = workbenchApiOffline
    ? '无法连接 127.0.0.1:8787，暂时不能检测本地 Profile'
    : `Hermes Home ${hermesPath} · ${detectedProfiles} 个 Profile`;
  const localHermesHint = workbenchApiOffline
    ? '请用 npm run dev 同时启动 Web 和 API，或单独运行 npm run dev:api。'
    : hermesBootstrap?.checkedAt || hermesStatus?.checkedAt
      ? `最近检测 ${formatTime(hermesBootstrap?.checkedAt || hermesStatus?.checkedAt || '')}`
      : '打开设置时会自动检测本地配置。';
  const defaultAgent =
    agents.find((agent) => agent.id === uiSettings.defaultAgentId) ||
    agents.find((agent) => agent.id === 'iris') ||
    agents[0] ||
    null;
  const defaultAgentProfile = resolveHermesProfileNameForAgent(
    defaultAgent,
    localProfiles,
  );

  return (
    <section className="settings-page codex-settings-page">
      <div className="settings-content">
        {activeSection === 'localConnection' && (
          <SystemStatusPage
            hermesBootstrap={hermesBootstrap}
            hermesRuntime={hermesRuntime}
            hermesDiagnostics={hermesDiagnostics}
            hermesApiAvailability={hermesApiAvailability}
          />
        )}

        {activeSection === 'runtimes' && (
          <RuntimeCenterPage
            onOpenHermes={() => onSectionChange('hermesAgent')}
          />
        )}
        {activeSection === 'memory' && (
          <MemoryCenterPage
            vaults={vaults}
            agents={agents}
            models={models}
            onOpenModels={() => onSectionChange('models')}
            onOpenSource={onOpenMemorySource}
          />
        )}
        {activeSection === 'tools' && (
          <ToolCapabilitiesPage
            profile={defaultAgentProfile}
            hermesRuntime={hermesRuntime}
          />
        )}

        {activeSection === 'hermesAgent' && (
          <>
            <div className="settings-head">
              <h2>Hermes 集成</h2>
            </div>
            <div className="settings-section-head">
              <h3>Profile 与连接</h3>
            </div>
            <SettingsPanel ariaLabel="Hermes Profile 与连接">
              <SettingsRow
                title="初次使用引导"
                description="重新检查依赖并完成 Frakio Work 与 Hermes Agent 的连接。"
              >
                <button
                  className="secondary-btn"
                  onClick={onRunFirstUseGuide}
                  disabled={firstUseGuideRunning}
                >
                  {firstUseGuideRunning ? '引导运行中' : '运行引导'}
                </button>
              </SettingsRow>
              <HermesAdvancedProfileConfig
                profiles={localProfiles}
                defaultProfileName={defaultAgentProfile}
              />
            </SettingsPanel>
            <div className="settings-section-head">
              <h3>Runtime 与诊断</h3>
            </div>
            <HermesRuntimePanel
              runtime={hermesRuntime}
              bootstrap={hermesBootstrap}
              localStatus={hermesStatus}
              diagnostics={hermesDiagnostics}
              apiAvailability={hermesApiAvailability}
              onStart={onStartHermesRuntime}
              onRefresh={onRefreshHermesRuntime}
            />
            <HermesBackupPanel
              status={updatesStatus}
              busy={updatesBusy}
              onCreate={onCreateHermesBackup}
              onRollback={onRollbackHermesBackup}
              onDelete={onDeleteHermesBackup}
              onCleanup={onCleanupHermesBackups}
            />
            {(hermesError || updatesError) && (
              <div className="form-error">
                {hermesError || updatesError}
              </div>
            )}
          </>
        )}

        {activeSection === 'updates' && (
          <>
            <div className="settings-head">
              <h2>版本更新</h2>
            </div>
            <UpdatesPanel
              runtime={hermesRuntime}
              status={updatesStatus}
              busy={updatesBusy}
              error={updatesError}
              result={updatesResult}
              desktopUpdateState={desktopUpdateState}
              onCheckDesktopUpdate={onCheckDesktopUpdate}
              onDownloadDesktopUpdate={onDownloadDesktopUpdate}
              onCancelDesktopUpdate={onCancelDesktopUpdate}
              onOpenDesktopUpdate={onOpenDesktopUpdate}
              onCheckRuntime={onCheckHermesRuntime}
              onInstallRuntime={onInstallHermesRuntime}
              onActivateRuntime={onActivateHermesRuntime}
              onUseBundledRuntime={onUseBundledHermesRuntime}
              onDeleteRuntime={onDeleteHermesRuntime}
            />
          </>
        )}

        {activeSection === 'agents' && (
          <OrgPage
            agents={agents}
            models={models}
            modelCapabilities={modelCapabilities}
            selectedOrgAgentId={selectedOrgAgentId}
            onSelectAgent={onSelectAgent}
            onProfilesChanged={onProfilesChanged}
            onUpdateAgent={onUpdateAgent}
            onDeleteAgent={onDeleteAgent}
            onCreate={onCreateAgent}
            profileEditor={profileEditor}
            defaultAgentId={uiSettings.defaultAgentId || defaultAgent?.id || ''}
            onUpdateDefaultAgent={onUpdateDefaultAgent}
          />
        )}

        {activeSection === 'profile' && (
          <>
            <div className="settings-head">
              <h2>个人资料</h2>
            </div>
            <UserProfilePanel
              userProfile={userProfile}
              defaultAgent={defaultAgent}
              onSaved={onUserProfileSaved}
            />
          </>
        )}

        {activeSection === 'workbench' && (
          <>
            <div className="settings-head">
              <h2>工作台</h2>
            </div>
            <div className="settings-section-head">
              <h3>工作台偏好</h3>
            </div>
            <SettingsPanel ariaLabel="工作台偏好">
              <SettingsRow
                title="新对话标语"
                description="显示在新对话输入框上方的提示语。"
              >
                <SettingsField>
                  <input
                    value={uiSettings.newChatPrompt || '我们接下来做点什么？'}
                    onChange={(event) =>
                      onUpdateUi({ newChatPrompt: event.target.value })
                    }
                  />
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="发送键"
                description="选择在输入框中发送消息的快捷键。"
              >
                <SettingsField>
                  <select
                    value={uiSettings.sendKey || 'enter'}
                    onChange={(event) =>
                      onUpdateUi({
                        sendKey: event.target
                          .value as WorkbenchUiSettings['sendKey'],
                      })
                    }
                  >
                    <option value="enter">Enter 发送</option>
                    <option value="mod-enter">Cmd/Ctrl + Enter 发送</option>
                  </select>
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="默认操作权限"
                description="新对话采用的外部操作审批方式。"
              >
                <SettingsField>
                  <select
                    value={uiSettings.defaultPermissionMode || 'manual'}
                    onChange={(event) =>
                      onUpdateUi({
                        defaultPermissionMode: event.target
                          .value as PermissionMode,
                      })
                    }
                  >
                    {(['manual', 'smart', 'off'] as const).map((mode) => (
                      <option key={mode} value={mode}>
                        {permissionLabel(mode)}
                      </option>
                    ))}
                  </select>
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="全局决策 Agent"
                description="在没有明确指定时负责全局决策的 Agent。"
              >
                <SettingsField>
                  <select
                    value={
                      uiSettings.fallbackDecisionAgentId ||
                      uiSettings.defaultAgentId ||
                      ''
                    }
                    onChange={(event) =>
                      onUpdateUi({
                        fallbackDecisionAgentId: event.target.value,
                      })
                    }
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="上下文压缩阈值"
                description="达到该 Token 数后开始压缩长对话。"
              >
                <SettingsField>
                  <input
                    type="number"
                    value={uiSettings.contextTriggerTokens || 500000}
                    onChange={(event) =>
                      onUpdateUi({
                        contextTriggerTokens: Number(event.target.value),
                      })
                    }
                  />
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="群聊触发 Token"
                description="群聊达到该长度后触发上下文处理。"
              >
                <SettingsField>
                  <input
                    type="number"
                    value={uiSettings.groupChatTriggerTokens || 100000}
                    onChange={(event) =>
                      onUpdateUi({
                        groupChatTriggerTokens: Number(event.target.value),
                      })
                    }
                  />
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="历史尾部消息数"
                description="压缩后始终保留的最近消息数量。"
              >
                <SettingsField>
                  <input
                    type="number"
                    value={uiSettings.historyTailMessages || 10}
                    onChange={(event) =>
                      onUpdateUi({
                        historyTailMessages: Number(event.target.value),
                      })
                    }
                  />
                </SettingsField>
              </SettingsRow>
              <SettingsRow
                title="Agent 间 @ 路由上限"
                description="控制一轮对话中 Agent 之间允许继续转发的深度。"
              >
                <SettingsField>
                  <select
                    value={
                      uiSettings.agentMentionMaxDepth === 'unlimited'
                        ? 'unlimited'
                        : 'fixed'
                    }
                    onChange={(event) =>
                      onUpdateUi({
                        agentMentionMaxDepth:
                          event.target.value === 'unlimited'
                            ? 'unlimited'
                            : typeof uiSettings.agentMentionMaxDepth === 'number'
                              ? uiSettings.agentMentionMaxDepth
                              : 2,
                      })
                    }
                  >
                    <option value="fixed">固定次数</option>
                    <option value="unlimited">无限制</option>
                  </select>
                </SettingsField>
              </SettingsRow>
              {uiSettings.agentMentionMaxDepth !== 'unlimited' && (
                <SettingsRow
                  title="最多转发次数"
                  description="设置固定路由模式下允许的转发次数。"
                >
                  <SettingsField>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={
                        typeof uiSettings.agentMentionMaxDepth === 'number'
                          ? uiSettings.agentMentionMaxDepth
                          : 2
                      }
                      onChange={(event) =>
                        onUpdateUi({
                          agentMentionMaxDepth: Math.max(
                            0,
                            Math.floor(Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </SettingsField>
                </SettingsRow>
              )}
              <SettingsInlineNote>
                无限制模式仍会阻止重复循环，并在单轮达到 64 次 Agent 运行时自动停止。
              </SettingsInlineNote>
            </SettingsPanel>
            <WorkbenchResponseSettings
              uiSettings={uiSettings}
              onUpdateUi={onUpdateUi}
            />
            <WorkbenchProfileSyncPanel
              title={localHermesTitle}
              detail={localHermesDetail}
              hint={localHermesHint}
              canSync={canSyncHermes}
              busy={isImportingHermes}
              error={hermesError}
              onSync={onImportHermes}
            />
          </>
        )}

        {activeSection === 'appearance' && (
          <AppearanceSettingsPage
            uiSettings={uiSettings}
            pinnedNav={pinnedNav}
            onUpdateUi={onUpdateUi}
            onTogglePinned={onTogglePinned}
          />
        )}

        {activeSection === 'privacy' && (
          <>
            <div className="settings-head">
              <h2>隐私</h2>
            </div>
            <TelemetrySettingsPanel
              uiSettings={uiSettings}
              status={telemetryStatus}
              onUpdateUi={onUpdateUi}
            />
          </>
        )}

        {activeSection === 'models' && (
          <ModelCenter
            models={models}
            profiles={localProfiles}
            defaultProfile={
              defaultAgentProfile || uiSettings.defaultProfile || 'default'
            }
            modelError={modelError}
            saveModel={saveModel}
            deleteModel={deleteModel}
            fetchAvailableModels={fetchAvailableModels}
            onCapabilityChanged={onCapabilityChanged}
          />
        )}
        {activeSection === 'skills' && (
          <HermesModulesPage
            kind="skill"
            onStartProfileGateway={onStartProfileGateway}
          />
        )}
        {activeSection === 'archivedThreads' && (
          <ArchivedThreadsPanel
            threads={archivedThreads}
            onRefresh={onRefreshArchivedThreads}
            onRestore={onRestoreThread}
            onDelete={onDeleteThread}
          />
        )}
        {activeSection === 'mcp' && (
          <McpSettingsPage
            profiles={localProfiles}
            defaultProfile={
              defaultAgentProfile ||
              uiSettings.defaultProfile ||
              hermesBootstrap?.approval.profileName ||
              'default'
            }
          />
        )}
        {activeSection === 'channels' && (
          <ChannelsPage
            profiles={localProfiles}
            defaultProfile={
              defaultAgentProfile ||
              uiSettings.defaultProfile ||
              hermesBootstrap?.approval.profileName ||
              'default'
            }
            embedded
          />
        )}
        {activeSection === 'plugins' && (
          <HermesModulesPage
            kind="plugin"
            onStartProfileGateway={onStartProfileGateway}
          />
        )}
        {activeSection === 'jobs' && (
          <JobsPage
            profiles={localProfiles}
            defaultProfile={
              defaultAgentProfile ||
              uiSettings.defaultProfile ||
              hermesBootstrap?.approval.profileName ||
              'default'
            }
            embedded
          />
        )}
        {activeSection === 'monitoring' && <MonitoringPage embedded />}
        {activeSection === 'vaults' && (
          <KnowledgeVaultsPage
            vaults={vaults}
            models={models}
            agents={agents}
            vaultPathInput={vaultPathInput}
            setVaultPathInput={setVaultPathInput}
            vaultError={vaultError}
            vaultBusy={vaultBusy}
            newVaultKind={newVaultKind}
            setNewVaultKind={setNewVaultKind}
            showConnector={showVaultConnector}
            setShowConnector={setShowVaultConnector}
            addVault={addVault}
            reindexVault={reindexVault}
            deleteVault={deleteVault}
            resolveLegacyVaultBinding={resolveLegacyVaultBinding}
          />
        )}
      </div>
    </section>
  );
}
// wjz新建文件结束。
