// wjz新建文件，新建原因：封装基础徽标/状态标签组件 BaseBadge，修改时间：2026-08-18。
// 文件内容概述：支持 neutral, primary, success, warning, error, info 变体与圆点指示器。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  dot?: boolean;
  icon?: string | React.ReactNode;
}

export const BaseBadge: React.FC<BaseBadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  icon,
  className = '',
  ...props
}) => {
  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[11px] gap-1',
    md: 'px-2 py-0.5 text-xs gap-1.5',
  }[size];

  const variantClasses = {
    neutral: 'bg-[var(--mac-badge-neutral-bg,rgba(0,0,0,0.05))] text-[var(--mac-text-muted,#4b5563)] border border-[var(--mac-border)]',
    primary: 'bg-[var(--mac-badge-primary-bg,rgba(59,130,246,0.1))] text-[var(--mac-accent)] border border-[var(--mac-accent)]',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
    error: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
    info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20',
  }[variant];

  const dotColors = {
    neutral: 'bg-gray-400',
    primary: 'bg-[var(--mac-accent)]',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-rose-500',
    info: 'bg-sky-500',
  }[variant];

  return (
    <span
      className={`inline-flex items-center justify-center font-medium rounded-full select-none ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors}`} />}
      {icon && (
        <span className="flex-shrink-0">
          {typeof icon === 'string' ? <BaseIcon name={icon} size={size === 'sm' ? 10 : 12} /> : icon}
        </span>
      )}
      {children}
    </span>
  );
};

export default BaseBadge;
// wjz新建文件结束。
