// wjz新建文件，新建原因：封装基础可选标签/芯片组件 BaseCheckTag，修改时间：2026-08-18。
// 文件内容概述：支持 checked/unchecked 状态切换、图标与点击回调，适用于多选标签场景。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseCheckTagProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  children: React.ReactNode;
  icon?: string;
  disabled?: boolean;
  className?: string;
}

export const BaseCheckTag: React.FC<BaseCheckTagProps> = ({
  checked,
  onChange,
  children,
  icon,
  disabled = false,
  className = '',
}) => {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full
        border transition-all select-none cursor-pointer focus:outline-none
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${checked
          ? 'bg-[var(--mac-accent)] text-white border-[var(--mac-accent)] shadow-sm'
          : 'bg-[var(--mac-surface,#ffffff)] text-[var(--mac-text-muted,#4b5563)] border-[var(--mac-border)] hover:border-[var(--mac-accent)] hover:text-[var(--mac-text)]'
        }
        ${className}
      `}
    >
      {icon && <BaseIcon name={icon} size={13} color={checked ? '#ffffff' : undefined} />}
      <span>{children}</span>
    </button>
  );
};

export default BaseCheckTag;
// wjz新建文件结束。
