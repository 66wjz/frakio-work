// wjz新建文件，新建原因：封装基础按钮组件 BaseButton，修改时间：2026-08-18。
// 文件内容概述：支持 primary, secondary, outline, ghost, danger 变体与 sm, md, lg 尺寸及加载动画、前缀/后缀图标。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: string | React.ReactNode;
  iconPosition?: 'left' | 'right';
  block?: boolean;
}

export const BaseButton: React.FC<BaseButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  block = false,
  className = '',
  ...props
}) => {
  const baseClasses = 'base-btn inline-flex items-center justify-center font-medium transition-colors focus:outline-none select-none rounded-md';
  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs gap-1.5 min-h-[28px]',
    md: 'px-3.5 py-1.5 text-sm gap-2 min-h-[34px]',
    lg: 'px-5 py-2.5 text-base gap-2.5 min-h-[42px]',
  }[size];

  const variantClasses = {
    primary: 'base-btn-primary bg-[var(--mac-accent)] text-[var(--mac-accent-foreground,#ffffff)] hover:opacity-90 active:opacity-95 shadow-sm',
    secondary: 'base-btn-secondary bg-[var(--mac-button-secondary-bg,#f3f4f6)] hover:bg-[var(--mac-button-secondary-hover,#e5e7eb)] text-[var(--mac-text)] border border-[var(--mac-border)] shadow-sm',
    outline: 'base-btn-outline bg-transparent border border-[var(--mac-border)] hover:bg-[var(--mac-surface-hover,rgba(0,0,0,0.05))] text-[var(--mac-text)]',
    ghost: 'base-btn-ghost bg-transparent hover:bg-[var(--mac-surface-hover,rgba(0,0,0,0.05))] text-[var(--mac-text)]',
    danger: 'base-btn-danger bg-red-600 hover:bg-red-700 text-white shadow-sm',
  }[variant];

  const blockClass = block ? 'w-full flex' : '';
  const disabledClass = disabled || loading ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer';

  const renderIcon = (iconContent: string | React.ReactNode) => {
    if (!iconContent) return null;
    if (typeof iconContent === 'string') {
      return <BaseIcon name={iconContent} size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />;
    }
    return iconContent;
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${blockClass} ${disabledClass} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <BaseIcon name="loader-circle" size={size === 'sm' ? 14 : 16} spinning className="animate-spin" />}
      {!loading && icon && iconPosition === 'left' && renderIcon(icon)}
      {children && <span>{children}</span>}
      {!loading && icon && iconPosition === 'right' && renderIcon(icon)}
    </button>
  );
};

export default BaseButton;
// wjz新建文件结束。
