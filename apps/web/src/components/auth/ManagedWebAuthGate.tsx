// wjz新建文件，新建原因：解耦 main.tsx 中的受控 Web 服务登录校验与首次改密门禁（ManagedWebAuthGate），修改时间：2026-08-17。
// 文件内容概述：ManagedWebAuthGate 登录拦截器与 FirstManagedPasswordChange 首次登录修改密码模态界面。
import React, { useEffect, useState } from 'react';
import { BaseInput, BaseButton, BaseAlert, BaseIcon } from '../base';

export function ManagedWebAuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'change-password'>('loading');
  const [password, setPassword] = useState('');
  const [defaultPasswordHint, setDefaultPasswordHint] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/status')
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取 Web 服务登录状态。');
        const status = await response.json();
        if (cancelled) return;
        setDefaultPasswordHint(status.defaultPasswordHint || '');
        setState(
          status.managed && !status.authenticated
            ? 'login'
            : status.passwordChangeRequired
              ? 'change-password'
              : 'ready',
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setState('login');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '登录失败。');
      setPassword('');
      setDefaultPasswordHint('');
      setState(result.passwordChangeRequired ? 'change-password' : 'ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'ready') return <>{children}</>;
  if (state === 'loading') return <main className="managed-web-auth-shell" aria-label="正在连接 Frakio Work" />;
  if (state === 'change-password') return <FirstManagedPasswordChange onComplete={() => setState('ready')} />;
  return (
    <main className="managed-web-auth-shell">
      <form className="managed-web-auth-card" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <BaseIcon name="brand-logo" size={40} />
          <div>
            <h1 className="text-xl font-bold">Frakio Work</h1>
            <p className="text-xs text-[var(--mac-text-muted,#6b7280)]">输入工作台的管理员密码</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--mac-text)]">管理员密码</label>
          <BaseInput
            autoFocus
            type="password"
            autoComplete="current-password"
            prefixIcon="lock"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {defaultPasswordHint && (
          <small className="managed-web-default-password text-xs text-[var(--mac-text-muted,#6b7280)]">
            首次登录密码：<strong>{defaultPasswordHint}</strong>。登录后需要立即修改。
          </small>
        )}

        {error ? (
          <BaseAlert variant="error" closable onClose={() => setError('')}>
            {error}
          </BaseAlert>
        ) : null}

        <BaseButton
          type="submit"
          variant="primary"
          block
          loading={submitting}
          disabled={!password || submitting}
          icon="log-in"
        >
          {submitting ? '正在登录…' : '进入工作台'}
        </BaseButton>
        <small className="text-[11px] text-[var(--mac-text-muted,#9ca3af)] text-center">仅限可信局域网使用。不要把此 HTTP 地址直接暴露到公网。</small>
      </form>
    </main>
  );
}

export function FirstManagedPasswordChange({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 10) return setError('新密码至少需要 10 个字符。');
    if (password !== confirmation) return setError('两次输入的新密码不一致。');
    setSaving(true);
    try {
      await fetch('/api/session');
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Frakio-Request': '1' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '密码修改失败。');
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="managed-web-auth-shell">
      <form className="managed-web-auth-card" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <BaseIcon name="brand-logo" size={40} />
          <div>
            <h1 className="text-xl font-bold">设置管理员密码</h1>
            <p className="text-xs text-[var(--mac-text-muted,#6b7280)]">首次登录需要设置新的管理员密码</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--mac-text)]">新密码</label>
          <BaseInput
            autoFocus
            type="password"
            autoComplete="new-password"
            prefixIcon="lock"
            placeholder="至少 10 个字符"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--mac-text)]">确认新密码</label>
          <BaseInput
            type="password"
            autoComplete="new-password"
            prefixIcon="shield-check"
            placeholder="再次输入新密码"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        {error ? (
          <BaseAlert variant="error" closable onClose={() => setError('')}>
            {error}
          </BaseAlert>
        ) : null}

        <BaseButton
          type="submit"
          variant="primary"
          block
          loading={saving}
          disabled={!password || !confirmation || saving}
          icon="check"
        >
          {saving ? '正在保存…' : '保存并进入工作台'}
        </BaseButton>
      </form>
    </main>
  );
}
// wjz新建文件结束。

