import React from 'react';

type SettingsPanelProps = {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
};

type SettingsRowProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  stacked?: boolean;
};

type SettingsToggleRowProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

type SettingsSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
  className?: string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function SettingsPanel({ children, className, ariaLabel }: SettingsPanelProps) {
  return (
    <section className={classNames('frakio-settings-panel', className)} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

export function SettingsRow({ title, description, children, className, stacked = false }: SettingsRowProps) {
  return (
    <div className={classNames('frakio-settings-row', stacked && 'is-stacked', className)}>
      <span className="frakio-settings-row-copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      {children && <span className="frakio-settings-row-control">{children}</span>}
    </div>
  );
}

export function SettingsToggleRow({ title, description, checked, disabled, onChange, className }: SettingsToggleRowProps) {
  return (
    <label className={classNames('frakio-settings-row', 'frakio-settings-toggle-row', disabled && 'is-disabled', className)}>
      <span className="frakio-settings-row-copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      <span className="frakio-settings-switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={typeof title === 'string' ? title : undefined}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

export function SettingsSwitch({ checked, disabled, ariaLabel, onChange, className }: SettingsSwitchProps) {
  return (
    <label className={classNames('frakio-settings-switch', className)}>
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

export function SettingsField({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={classNames('frakio-settings-field', className)}>{children}</span>;
}

export function SettingsInlineNote({ children }: { children: React.ReactNode }) {
  return <p className="frakio-settings-inline-note">{children}</p>;
}
