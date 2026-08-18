// wjz新建文件，新建原因：封装基础复选框组件 BaseCheckbox，修改时间：2026-08-18。
// 文件内容概述：支持受控/非受控勾选、标签文字与禁用状态。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseCheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const BaseCheckbox: React.FC<BaseCheckboxProps> = ({
  label,
  description,
  checked,
  disabled = false,
  className = '',
  onChange,
  ...props
}) => {
  return (
    <label className={`inline-flex items-start gap-2.5 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <div className="relative flex items-center justify-center mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="peer sr-only"
          {...props}
        />
        <div
          className={`
            w-4 h-4 rounded border transition-colors flex items-center justify-center
            border-[var(--mac-border)] bg-[var(--mac-surface,#ffffff)]
            peer-checked:bg-[var(--mac-accent)] peer-checked:border-[var(--mac-accent)]
            peer-focus:ring-1 peer-focus:ring-[var(--mac-accent)]
          `}
        >
          {checked && <BaseIcon name="check" size={12} color="#ffffff" strokeWidth={3} />}
        </div>
      </div>
      {(label || description) && (
        <div className="flex flex-col text-xs">
          {label && <span className="font-medium text-[var(--mac-text)] leading-tight">{label}</span>}
          {description && <span className="text-[var(--mac-text-muted,#6b7280)] mt-0.5">{description}</span>}
        </div>
      )}
    </label>
  );
};

export default BaseCheckbox;
// wjz新建文件结束。
