import type { CSSProperties } from 'react';
import { Check, Circle, LoaderCircle, TriangleAlert } from 'lucide-react';
import frakioBrandLogoUrl from '../../assets/frakio-brand-logo.png';

export type LaunchPhase = 'booting' | 'connecting' | 'installing' | 'welcome' | 'error';
export type LaunchInstallStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  detail?: string;
};
export type LaunchInstallJob = {
  id: string;
  status: 'running' | 'ready' | 'failed';
  currentStepId: string;
  steps: LaunchInstallStep[];
  error?: string;
  bootstrap?: unknown;
  runtime?: unknown;
};
export type LaunchIssue = {
  source: 'hermes' | 'local-service' | 'pi';
  title: string;
  message: string;
  settingsTarget: 'hermesAgent' | 'localConnection';
  actionLabel: string;
};

function LaunchLogo({ animated = false }: { animated?: boolean }) {
  return (
    <span className={`launch-logo ${animated ? 'is-animated' : ''}`} aria-hidden="true">
      <img className="launch-logo-base" src={frakioBrandLogoUrl} alt="" />
      {animated && <img className="launch-logo-sheen" src={frakioBrandLogoUrl} alt="" />}
    </span>
  );
}

export function LaunchLoadingScreen({
  phase,
  userAvatarUrl,
  installJob,
  issue,
  appearance,
  colorMode,
  style,
  hold,
  onOpenSettings,
}: {
  phase: LaunchPhase;
  userAvatarUrl: string;
  installJob: LaunchInstallJob | null;
  issue: LaunchIssue | null;
  appearance: 'light' | 'dark';
  colorMode: 'native' | 'custom';
  style: CSSProperties;
  hold?: boolean;
  onOpenSettings: (issue: LaunchIssue) => void;
}) {
  const welcome = phase === 'welcome';
  const installing = phase === 'installing';
  const failed = phase === 'error';
  const completedSteps = installJob?.steps.filter((step) => step.status === 'ready').length || 0;
  const progress = installJob?.status === 'ready'
    ? 100
    : installJob?.steps.length
      ? Math.round((completedSteps / installJob.steps.length) * 100)
      : 0;

  return (
    <div
      className={`launch-screen ${welcome ? 'welcome' : installing ? 'installing' : failed ? 'failed' : 'working'} ${hold ? 'qa-hold' : ''}`}
      role={failed ? 'alertdialog' : 'status'}
      aria-live="polite"
      data-launch-phase={phase}
      data-appearance={appearance}
      data-space-color-mode={colorMode}
      style={style}
    >
      {installing ? (
        <section className="launch-install-panel" data-launch-panel="installing" aria-labelledby="launch-install-title">
          <header className="launch-install-head">
            <LaunchLogo animated={installJob?.status === 'running'} />
            <span>
              <h1 id="launch-install-title">{installJob?.status === 'ready' ? 'Hermes Agent 已准备完成' : '正在安装 Hermes Agent'}</h1>
              <p>首次使用需要准备本地运行环境，请保持 Frakio Work 打开。</p>
            </span>
          </header>
          <div className="launch-install-progress" aria-label={`安装进度 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="launch-install-steps">
            {(installJob?.steps || []).map((step) => {
              const Icon = step.status === 'ready' ? Check : step.status === 'running' ? LoaderCircle : step.status === 'failed' ? TriangleAlert : Circle;
              return (
                <div className={`launch-install-step ${step.status}`} key={step.id}>
                  <Icon size={16} />
                  <span><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : failed && issue ? (
        <section className="launch-error-panel" data-launch-panel="error" aria-labelledby="launch-error-title">
          <LaunchLogo />
          <h1 id="launch-error-title">{issue.title}</h1>
          <p>{issue.message}</p>
          <button type="button" onClick={() => onOpenSettings(issue)}>{issue.actionLabel}</button>
        </section>
      ) : (
        <div className="launch-shell" data-launch-panel={welcome ? 'welcome' : 'working'}>
          <LaunchLogo animated={!welcome} />
          {welcome && (
            <div className="launch-welcome">
              <span>Hi，</span>
              {userAvatarUrl && <span className="launch-user-avatar"><img src={userAvatarUrl} alt="" /></span>}
              <span>欢迎回来</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
