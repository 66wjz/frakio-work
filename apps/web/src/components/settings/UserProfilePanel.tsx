// wjz新建文件，新建原因：解耦个人资料与 Token 用量统计面板组件（UserProfilePanel, UserProfileForm 等），修改时间：2026-08-17。
// 文件内容概述：个人资料 Hero 卡片、Token 用量活动热力图、常用 Agent 与插件洞察、管理员密码修改及个人资料编辑表单。
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import {
  AppAlertDialog,
  AppAlertDialogAction,
  AppAlertDialogCancel,
  AppAlertDialogContent,
  AppAlertDialogDescription,
  AppAlertDialogTitle,
} from '../../overlay-primitives';
import { AvatarCropModal } from '../common/AvatarCropModal';
import {
  buildProfileActivity,
  type ProfileActivityCell,
  type ProfileActivityMode,
} from '../../profile-activity.mjs';
import {
  formatChineseApproxNumber,
  formatFullNumber,
  formatTime,
} from '../../utils/formatters';
import type {
  Agent,
  UserProfile,
  UserProfileModuleUsage,
  UserProfileSummary,
} from '../../types/workbench';


export function UserProfilePanel({
  userProfile,
  defaultAgent,
  onSaved,
}: {
  userProfile: UserProfile;
  defaultAgent: Agent | null;
  onSaved: (profile: UserProfile, agents?: Agent[]) => void;
}) {
  const [summary, setSummary] = useState<UserProfileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [activityMode, setActivityMode] = useState<ProfileActivityMode>('daily');
  const [tokenTooltip, setTokenTooltip] = useState<{
    cell: ProfileActivityCell;
    left: number;
    top: number;
    placement: 'above' | 'below';
  } | null>(null);
  const tooltipId = useId();
  const reduceMotion = useReducedMotion();
  const displayName = userProfile.nickname || 'Frakio User';
  const initials = (displayName || 'MG').slice(0, 2).toUpperCase();
  const stats = summary?.stats || {
    totalTokens: 0,
    peakDayTokens: 0,
    peakDay: '',
    requests: 0,
    conversations: 0,
    activeAgents: 0,
  };
  const activity = useMemo(
    () =>
      buildProfileActivity(
        summary?.usage?.byDay || [],
        summary?.usage?.entries || [],
        activityMode,
      ),
    [activityMode, summary],
  );
  const topAgents = (summary?.agents || [])
    .filter((agent) => agent.conversationCount > 0 || agent.messageCount > 0)
    .slice(0, 5);
  const topSkills = (summary?.modules.skills.byName || []).slice(0, 5);
  const topPlugins = (summary?.modules.plugins.byName || []).slice(0, 5);
  const skillRuns = topSkills.reduce((sum, item) => sum + moduleUsageTotal(item), 0);
  const pluginRuns = topPlugins.reduce((sum, item) => sum + moduleUsageTotal(item), 0);
  const insightRows = [
    { label: '对话总数', value: formatFullNumber(stats.conversations) },
    { label: '使用过的 Agent', value: formatFullNumber(stats.activeAgents) },
    { label: '模型请求', value: formatFullNumber(stats.requests) },
    { label: 'Skill 使用次数', value: formatFullNumber(skillRuns) },
    { label: '插件使用次数', value: formatFullNumber(pluginRuns) },
  ];

  async function loadSummary() {
    setLoading(true);
    try {
      const data = await fetch('/api/user-profile/summary').then((res) => res.json());
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    setTokenTooltip(null);
  }, [activityMode]);

  useEffect(() => {
    if (!editOpen) return;
    const settingsContent = document.querySelector<HTMLElement>('.settings-content');
    if (!settingsContent) return;
    const scrollTop = settingsContent.scrollTop;
    const scrollLeft = settingsContent.scrollLeft;
    const previousOverflow = settingsContent.style.overflow;
    settingsContent.style.overflow = 'hidden';
    // The fixed modal still lives under settings-content in the DOM. Restore
    // the frozen position after its first-field autofocus has settled.
    let settleFrame = 0;
    const restoreFrame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => {
        settingsContent.scrollTop = scrollTop;
        settingsContent.scrollLeft = scrollLeft;
      });
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(settleFrame);
      settingsContent.style.overflow = previousOverflow;
      settingsContent.scrollTop = scrollTop;
      settingsContent.scrollLeft = scrollLeft;
    };
  }, [editOpen]);

  function openEditor(trigger: HTMLButtonElement) {
    editTriggerRef.current = trigger;
    setEditOpen(true);
  }

  function closeEditor() {
    setEditOpen(false);
    window.requestAnimationFrame(() => editTriggerRef.current?.focus());
  }

  function handleSaved(profile: UserProfile, agents?: Agent[]) {
    onSaved(profile, agents);
    closeEditor();
    void loadSummary();
  }

  function showTokenTooltip(cell: ProfileActivityCell, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = Math.min(216, Math.max(148, window.innerWidth - 24));
    const maxLeft = Math.max(12, window.innerWidth - tooltipWidth - 12);
    const left = Math.min(
      maxLeft,
      Math.max(12, rect.left + rect.width / 2 - tooltipWidth / 2),
    );
    const placement = cell.row <= 2 || rect.top <= 92 ? 'below' : 'above';
    setTokenTooltip({
      cell,
      left,
      top: placement === 'above' ? rect.top - 9 : rect.bottom + 9,
      placement,
    });
  }

  return (
    <section className="profile-dashboard">
      <div className="profile-dashboard-actions">
        <button
          className="secondary-btn compact"
          onClick={(event) => openEditor(event.currentTarget)}
        >
          <Pencil size={14} />
          编辑
        </button>
      </div>
      <section className="profile-hero">
        <button
          className="profile-avatar-button"
          onClick={(event) => openEditor(event.currentTarget)}
          aria-label="编辑个人资料"
        >
          {userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : initials}
        </button>
        <h2>{displayName}</h2>
        <p>Frakio Work 用户 · 默认 Agent：{defaultAgent?.name || '未设置'}</p>
        <span className="visually-hidden" role="status" aria-live="polite">
          {loading ? '正在刷新资料数据' : summary ? '资料数据已更新' : ''}
        </span>
      </section>

      <section className="profile-stat-strip" aria-label="个人统计">
        <div>
          <strong>{formatChineseApproxNumber(stats.totalTokens)}</strong>
          <span>累计 Token 数</span>
        </div>
        <div>
          <strong>{formatChineseApproxNumber(stats.peakDayTokens)}</strong>
          <span>峰值日 Token 数</span>
        </div>
        <div>
          <strong>{formatFullNumber(stats.requests)}</strong>
          <span>模型请求</span>
        </div>
        <div>
          <strong>{formatFullNumber(stats.conversations)}</strong>
          <span>对话数</span>
        </div>
        <div>
          <strong>{formatFullNumber(stats.activeAgents)}</strong>
          <span>使用过的 Agent</span>
        </div>
      </section>

      <section className="profile-activity-panel">
        <div className="profile-section-head">
          <h3>Token 活动</h3>
          <div className="mini-segment" aria-label="Token 活动范围">
            <button
              type="button"
              className={activityMode === 'daily' ? 'selected' : ''}
              aria-pressed={activityMode === 'daily'}
              onClick={() => setActivityMode('daily')}
            >
              每日
            </button>
            <button
              type="button"
              className={activityMode === 'weekly' ? 'selected' : ''}
              aria-pressed={activityMode === 'weekly'}
              onClick={() => setActivityMode('weekly')}
            >
              每周
            </button>
            <button
              type="button"
              className={activityMode === 'total' ? 'selected' : ''}
              aria-pressed={activityMode === 'total'}
              onClick={() => setActivityMode('total')}
            >
              累计
            </button>
          </div>
        </div>
        <div className="token-activity-scroll" onScroll={() => setTokenTooltip(null)}>
          <div
            className={`token-activity-grid${summary ? ' is-loaded' : ''}`}
            aria-label="Token 活动网格"
            aria-busy={!summary}
          >
            {activity.cells.map((cell) => (
              <button
                type="button"
                className={`token-activity-cell level-${cell.level}${cell.future ? ' is-future' : ''}`}
                data-day={cell.day}
                key={cell.day}
                aria-label={cell.ariaLabel}
                aria-describedby={
                  tokenTooltip?.cell.day === cell.day ? tooltipId : undefined
                }
                style={{
                  animationDelay: reduceMotion
                    ? '0ms'
                    : `${Math.round(cell.index * 0.85)}ms`,
                }}
                onPointerEnter={(event) =>
                  showTokenTooltip(cell, event.currentTarget)
                }
                onPointerLeave={() => setTokenTooltip(null)}
                onFocus={(event) => showTokenTooltip(cell, event.currentTarget)}
                onBlur={() => setTokenTooltip(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setTokenTooltip(null);
                }}
              />
            ))}
          </div>
          <div className="token-activity-months">
            {activity.months.map((month) => (
              <span
                key={`${month.label}-${month.index}`}
                style={{ gridColumnStart: month.index + 1 }}
              >
                {month.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="profile-lower-grid">
        <ProfileInsightPanel title="活动洞察" empty="暂无活动记录。">
          <div className="profile-metric-list">
            {insightRows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </ProfileInsightPanel>
        <section className="profile-insight-panel profile-top-list">
          <h3>最常用</h3>
          <div className="profile-top-section">
            <h4>Agent</h4>
            <div className="profile-insight-list">
              {topAgents.length ? (
                topAgents.map((agent) => (
                  <div className="profile-agent-row" key={agent.id}>
                    <span
                      className="profile-agent-avatar"
                      style={
                        agent.avatarUrl
                          ? undefined
                          : { background: agent.color || '#0f766e' }
                      }
                    >
                      {agent.avatarUrl ? (
                        <img src={agent.avatarUrl} alt="" />
                      ) : (
                        agent.name.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agent.role || agent.profileName || 'Agent'}</small>
                    </span>
                    <em>
                      {agent.conversationCount} 次对话
                      <small>{agent.messageCount} 条消息</small>
                    </em>
                  </div>
                ))
              ) : (
                <p className="muted-copy">暂无 Agent 使用记录。</p>
              )}
            </div>
          </div>
          <div className="profile-top-section">
            <h4>Skill</h4>
            <div className="profile-insight-list">
              {topSkills.length ? (
                topSkills.map((item) => (
                  <ProfileModuleUsageRow item={item} key={item.name} />
                ))
              ) : (
                <p className="muted-copy">暂无 Skill 使用记录。</p>
              )}
            </div>
          </div>
          <div className="profile-top-section">
            <h4>插件</h4>
            <div className="profile-insight-list">
              {topPlugins.length ? (
                topPlugins.map((item) => (
                  <ProfileModuleUsageRow item={item} key={item.name} />
                ))
              ) : (
                <p className="muted-copy">暂无插件使用记录。</p>
              )}
            </div>
          </div>
        </section>
      </section>

      {editOpen && (
        <div className="modal-backdrop profile-edit-modal">
          <div className="modal-card profile-edit-card">
            <UserProfileForm
              userProfile={userProfile}
              defaultAgent={defaultAgent}
              onSaved={handleSaved}
              onCancel={closeEditor}
              compact
            />
          </div>
        </div>
      )}
      {tokenTooltip &&
        createPortal(
          <div
            className={`profile-token-tooltip is-${tokenTooltip.placement}`}
            id={tooltipId}
            role="tooltip"
            style={{ left: tokenTooltip.left, top: tokenTooltip.top }}
          >
            <strong>{tokenTooltip.cell.heading}</strong>
            <span>{tokenTooltip.cell.detail}</span>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function ProfileInsightPanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <section className="profile-insight-panel">
      <h3>{title}</h3>
      <div className="profile-insight-list">
        {hasChildren ? children : <p className="muted-copy">{empty}</p>}
      </div>
    </section>
  );
}

export function ProfileModuleUsageRow({ item }: { item: UserProfileModuleUsage }) {
  const total = moduleUsageTotal(item);
  return (
    <div className="profile-module-row">
      <span>
        <strong>{item.name}</strong>
        <small>
          {item.enabledProfiles ?? 0}/{item.profiles ?? 0} enabled
        </small>
      </span>
      <em>
        {formatFullNumber(total)} 次
        <small>{item.lastUsedAt ? formatTime(item.lastUsedAt) : '暂无最近记录'}</small>
      </em>
    </div>
  );
}

export function moduleUsageTotal(item: UserProfileModuleUsage) {
  return (
    Number(item.useCount || 0) +
    Number(item.viewCount || 0) +
    Number(item.patchCount || 0)
  );
}

export function ManagedWebPasswordSettings() {
  const [managed, setManaged] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void fetch('/api/auth/status')
      .then((response) => response.json())
      .then((status) => setManaged(status.managed === true))
      .catch(() => {});
  }, []);
  if (!managed) return null;
  async function savePassword() {
    setMessage('');
    if (nextPassword.length < 10) return setMessage('新密码至少需要 10 个字符。');
    if (nextPassword !== confirmation) return setMessage('两次输入的新密码不一致。');
    setSaving(true);
    try {
      await fetch('/api/session');
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Frakio-Request': '1' },
        body: JSON.stringify({ currentPassword, password: nextPassword }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '密码修改失败。');
      setCurrentPassword('');
      setNextPassword('');
      setConfirmation('');
      setMessage('管理员密码已更新，其他登录会话已退出。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密码修改失败。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="managed-profile-password" aria-label="管理员密码">
      <div>
        <strong>管理员密码</strong>
        <small>修改后会退出其他设备的登录会话。</small>
      </div>
      <label>
        当前密码
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        新密码
        <input
          type="password"
          autoComplete="new-password"
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
        />
      </label>
      <label>
        确认新密码
        <input
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary-btn"
        disabled={saving || !currentPassword || !nextPassword || !confirmation}
        onClick={() => void savePassword()}
      >
        {saving ? '保存中' : '更新密码'}
      </button>
      {message && (
        <div
          className={
            message.includes('已更新') ? 'settings-inline-message' : 'form-error'
          }
        >
          {message}
        </div>
      )}
    </section>
  );
}

export function UserProfileForm({
  userProfile,
  defaultAgent,
  onSaved,
  onCancel,
  compact = false,
}: {
  userProfile: UserProfile;
  defaultAgent: Agent | null;
  onSaved: (profile: UserProfile, agents?: Agent[]) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<UserProfile>(userProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    () => setDraft(userProfile),
    [userProfile.updatedAt, userProfile.avatarUrl, userProfile.nickname],
  );
  const formName = String(draft.nickname || userProfile.nickname || 'Frakio User').trim();
  const formInitials = (formName || 'MG').slice(0, 2).toUpperCase();
  const busy = saving || avatarSaving;
  const isDirty = userProfileHasUnsavedChanges(draft, userProfile);

  useEffect(() => {
    if (!compact) return;
    const firstField = formRef.current?.querySelector<HTMLElement>(
      '[data-profile-autofocus]',
    );
    window.requestAnimationFrame(() => firstField?.focus({ preventScroll: true }));
  }, [compact]);

  function requestClose() {
    if (busy || avatarCropFile) return;
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onCancel?.();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== 'Tab' || !formRef.current) return;
    const focusable = Array.from(
      formRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    setError('');
    setAvatarCropFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  async function uploadAvatar(data: string) {
    setAvatarSaving(true);
    try {
      const res = await fetch('/api/user-profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: 'image/png', data }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '头像保存失败。');
      setDraft((current) => ({ ...current, avatarUrl: payload.avatarUrl || '' }));
      setAvatarCropFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像保存失败。');
    } finally {
      setAvatarSaving(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfile: draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '用户资料保存失败。');
      onSaved(payload.userProfile, payload.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户资料保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={compact ? 'user-profile-form compact' : 'user-profile-form'}
      ref={formRef}
      role={compact ? 'dialog' : undefined}
      aria-modal={compact || undefined}
      aria-labelledby={compact ? 'user-profile-editor-title' : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="user-profile-edit-hero">
        <button
          className="user-profile-avatar"
          type="button"
          onClick={() => avatarInputRef.current?.click()}
          disabled={avatarSaving}
          aria-label="上传用户头像"
        >
          {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : formInitials}
        </button>
        <input
          ref={avatarInputRef}
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => chooseAvatar(event.target.files?.[0])}
        />
        <div>
          <span id="user-profile-editor-title">编辑个人资料</span>
          <strong>{formName}</strong>
          <small>
            默认 Agent：{defaultAgent?.name || '未设置'} · 资料会同步给 Agent 使用
          </small>
          <button
            className="profile-avatar-upload-link"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarSaving}
          >
            {avatarSaving ? '上传中...' : draft.avatarUrl ? '更换头像' : '上传头像'}
          </button>
        </div>
        {onCancel && (
          <button
            className="profile-edit-close icon-btn"
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className="user-profile-edit-body">
        <div className="preference-grid user-profile-grid">
          <label>
            用户名/昵称
            <input
              data-profile-autofocus
              value={draft.nickname}
              onChange={(event) =>
                setDraft({ ...draft, nickname: event.target.value })
              }
              placeholder="例如：Alex"
            />
          </label>
          <label>
            年龄
            <input
              value={draft.age}
              onChange={(event) => setDraft({ ...draft, age: event.target.value })}
              placeholder="选填"
            />
          </label>
          <label className="wide">
            个人简介
            <textarea
              value={draft.bio}
              onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
              placeholder="简单介绍你自己"
            />
          </label>
          <label className="wide">
            爱好
            <textarea
              value={draft.hobbies}
              onChange={(event) =>
                setDraft({ ...draft, hobbies: event.target.value })
              }
              placeholder="选填"
            />
          </label>
          <label className="wide">
            职业信息
            <textarea
              value={draft.occupation}
              onChange={(event) =>
                setDraft({ ...draft, occupation: event.target.value })
              }
              placeholder="选填"
            />
          </label>
          <label>
            默认 Agent 对你的称呼
            <input
              value={draft.defaultAgentAddress}
              onChange={(event) =>
                setDraft({ ...draft, defaultAgentAddress: event.target.value })
              }
              placeholder="例如：老板"
            />
          </label>
          <label>
            其他 Agent 对你的称呼
            <input
              value={draft.otherAgentAddress}
              onChange={(event) =>
                setDraft({ ...draft, otherAgentAddress: event.target.value })
              }
              placeholder="例如：Alex"
            />
          </label>
        </div>
        <ManagedWebPasswordSettings />
        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="modal-actions">
        {onCancel && (
          <button className="secondary-btn" onClick={requestClose} disabled={busy}>
            取消
          </button>
        )}
        <button
          className="send-btn"
          onClick={() => void saveProfile()}
          disabled={busy}
        >
          {saving ? '保存中' : '保存并同步到 Agent'}
        </button>
      </div>
      {avatarCropFile && (
        <AvatarCropModal
          file={avatarCropFile}
          title="裁剪个人头像"
          saving={avatarSaving}
          onCancel={() => setAvatarCropFile(null)}
          onSave={(data) => void uploadAvatar(data)}
        />
      )}
      <AppAlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AppAlertDialogContent>
          <AppAlertDialogTitle className="app-alert-title">
            放弃未保存的修改？
          </AppAlertDialogTitle>
          <AppAlertDialogDescription className="app-alert-description">
            关闭后，本次尚未保存的个人资料修改将丢失。
          </AppAlertDialogDescription>
          <div className="app-alert-actions">
            <AppAlertDialogCancel className="cancel">继续编辑</AppAlertDialogCancel>
            <AppAlertDialogAction className="danger" onClick={() => onCancel?.()}>
              放弃修改
            </AppAlertDialogAction>
          </div>
        </AppAlertDialogContent>
      </AppAlertDialog>
    </div>
  );
}

export function userProfileHasUnsavedChanges(draft: UserProfile, saved: UserProfile) {
  return [
    'avatarUrl',
    'nickname',
    'bio',
    'age',
    'hobbies',
    'occupation',
    'defaultAgentAddress',
    'otherAgentAddress',
  ].some((key) => draft[key as keyof UserProfile] !== saved[key as keyof UserProfile]);
}
// wjz新建文件结束。
