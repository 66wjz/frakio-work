// wjz新建文件，新建原因：封装基础输入框组件 BaseInput，修改时间：2026-08-18。
// 文件内容概述：支持文本输入、多行 textarea、前缀/后缀图标、清除按钮及错误状态提示。
import React, { forwardRef } from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  multiline?: boolean;
  rows?: number;
  prefixIcon?: string | React.ReactNode;
  suffixIcon?: string | React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  error?: boolean;
  helperText?: string;
}

export const BaseInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, BaseInputProps>(({
  multiline = false,
  rows = 3,
  prefixIcon,
  suffixIcon,
  clearable = false,
  onClear,
  error = false,
  helperText,
  disabled = false,
  className = '',
  value,
  onChange,
  ...props
}, ref) => {
  const isControlled = value !== undefined;
  const hasValue = Boolean(value && String(value).length > 0);

  const baseInputStyle = `
    w-full px-3 py-1.5 text-sm rounded-md bg-[var(--mac-surface,#ffffff)] 
    border border-[var(--mac-border)] text-[var(--mac-text)]
    placeholder-[var(--mac-text-placeholder,#9ca3af)]
    focus:outline-none focus:border-[var(--mac-accent)] focus:ring-1 focus:ring-[var(--mac-accent)]
    transition-all
    ${disabled ? 'opacity-50 cursor-not-allowed bg-[var(--mac-surface-disabled,#f3f4f6)]' : ''}
    ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
  `;

  const renderIcon = (icon: string | React.ReactNode) => {
    if (!icon) return null;
    if (typeof icon === 'string') {
      return <BaseIcon name={icon} size={15} className="text-[var(--mac-text-muted,#6b7280)]" />;
    }
    return icon;
  };

  if (multiline) {
    return (
      <div className="base-input-wrapper w-full flex flex-col gap-1">
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          rows={rows}
          className={`${baseInputStyle} resize-y ${className}`}
          disabled={disabled}
          value={value}
          onChange={onChange as any}
          {...(props as any)}
        />
        {helperText && (
          <span className={`text-xs ${error ? 'text-red-500 font-medium' : 'text-[var(--mac-text-muted,#6b7280)]'}`}>
            {helperText}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="base-input-wrapper w-full flex flex-col gap-1">
      <div className="relative flex items-center w-full">
        {prefixIcon && (
          <div className="absolute left-2.5 flex items-center pointer-events-none">
            {renderIcon(prefixIcon)}
          </div>
        )}
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className={`
            ${baseInputStyle}
            ${prefixIcon ? 'pl-8' : ''}
            ${suffixIcon || (clearable && hasValue) ? 'pr-8' : ''}
            ${className}
          `}
          disabled={disabled}
          value={value}
          onChange={onChange}
          {...props}
        />
        {clearable && hasValue && !disabled && (
          <button
            type="button"
            className="absolute right-2.5 flex items-center text-[var(--mac-text-muted,#9ca3af)] hover:text-[var(--mac-text)] cursor-pointer focus:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              onClear?.();
            }}
          >
            <BaseIcon name="x" size={14} />
          </button>
        )}
        {!clearable && suffixIcon && (
          <div className="absolute right-2.5 flex items-center pointer-events-none">
            {renderIcon(suffixIcon)}
          </div>
        )}
      </div>
      {helperText && (
        <span className={`text-xs ${error ? 'text-red-500 font-medium' : 'text-[var(--mac-text-muted,#6b7280)]'}`}>
          {helperText}
        </span>
      )}
    </div>
  );
});

BaseInput.displayName = 'BaseInput';
export default BaseInput;
// wjz新建文件结束。
