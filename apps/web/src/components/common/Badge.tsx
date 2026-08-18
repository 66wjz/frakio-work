// wjz新建文件，新建原因：封装规范化 Badge 基础公共组件，修改时间：2026-08-18。
// 文件内容概述：支持 neutral, primary, success, warning, error, info 变体及带状态圆点的通用 Badge 组件。
import React from 'react';

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: React.ReactNode;
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  icon,
  className = '',
  children,
  ...props
}: BadgeProps) {
  const combinedClassName = [
    'badge',
    `badge-${variant}`,
    `badge-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={combinedClassName} {...props}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {icon && <span className="badge-icon" aria-hidden="true">{icon}</span>}
      <span className="badge-text">{children}</span>
    </span>
  );
}
// wjz新建文件结束。
