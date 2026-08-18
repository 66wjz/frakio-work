// wjz新建文件，新建原因：封装基础下拉选择组件 BaseSelect，修改时间：2026-08-18。
// 文件内容概述：支持 options 数组传入与 children 自定义两种模式，统一边框与焦点交互。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseSelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
}

export interface BaseSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: BaseSelectOption[];
  error?: boolean;
  helperText?: string;
  prefixIcon?: string | React.ReactNode;
}

export const BaseSelect: React.FC<BaseSelectProps> = ({
  options,
  children,
  error = false,
  helperText,
  prefixIcon,
  disabled = false,
  className = '',
  ...props
}) => {
  return (
    <div className="base-select-wrapper w-full flex flex-col gap-1">
      <div className="relative flex items-center w-full">
        {prefixIcon && (
          <div className="absolute left-2.5 flex items-center pointer-events-none text-[var(--mac-text-muted,#6b7280)]">
            {typeof prefixIcon === 'string' ? <BaseIcon name={prefixIcon} size={15} /> : prefixIcon}
          </div>
        )}
        <select
          className={`
            w-full px-3 py-1.5 pr-8 text-sm rounded-md bg-[var(--mac-surface,#ffffff)]
            border border-[var(--mac-border)] text-[var(--mac-text)]
            focus:outline-none focus:border-[var(--mac-accent)] focus:ring-1 focus:ring-[var(--mac-accent)]
            transition-all appearance-none cursor-pointer
            ${prefixIcon ? 'pl-8' : ''}
            ${disabled ? 'opacity-50 cursor-not-allowed bg-[var(--mac-surface-disabled,#f3f4f6)]' : ''}
            ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
            ${className}
          `}
          disabled={disabled}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <div className="absolute right-2.5 flex items-center pointer-events-none text-[var(--mac-text-muted,#6b7280)]">
          <BaseIcon name="chevron-down" size={14} />
        </div>
      </div>
      {helperText && (
        <span className={`text-xs ${error ? 'text-red-500 font-medium' : 'text-[var(--mac-text-muted,#6b7280)]'}`}>
          {helperText}
        </span>
      )}
    </div>
  );
};

export default BaseSelect;
// wjz新建文件结束。
