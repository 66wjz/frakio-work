// wjz新建文件，新建原因：封装基础卡片组件 BaseCard，修改时间：2026-08-18。
// 文件内容概述：支持 BaseCard, BaseCardHeader, BaseCardTitle, BaseCardDescription, BaseCardContent, BaseCardFooter 子组件及悬停交互。
import React from 'react';

export interface BaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'hoverable' | 'bordered' | 'flat';
  isDefault?: boolean;
}

export const BaseCard: React.FC<BaseCardProps> = ({
  children,
  variant = 'default',
  isDefault = false,
  className = '',
  ...props
}) => {
  const variantClasses = {
    default: 'bg-[var(--mac-card-bg,#ffffff)] border border-[var(--mac-border)] shadow-sm',
    hoverable: 'bg-[var(--mac-card-bg,#ffffff)] border border-[var(--mac-border)] hover:border-[var(--mac-accent)] hover:shadow-md transition-all cursor-pointer',
    bordered: 'bg-[var(--mac-card-bg,#ffffff)] border-2 border-[var(--mac-border)]',
    flat: 'bg-[var(--mac-surface-muted,rgba(0,0,0,0.02))] border-0',
  }[variant];

  const defaultBorder = isDefault ? 'border-l-4 border-l-[var(--mac-accent)]' : '';

  return (
    <div className={`rounded-xl overflow-hidden ${variantClasses} ${defaultBorder} ${className}`} {...props}>
      {children}
    </div>
  );
};

export const BaseCardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => (
  <div className={`px-4 py-3.5 border-b border-[var(--mac-border)] flex items-center justify-between gap-2 ${className}`} {...props}>
    {children}
  </div>
);

export const BaseCardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ children, className = '', ...props }) => (
  <h3 className={`text-sm font-semibold text-[var(--mac-text)] leading-tight ${className}`} {...props}>
    {children}
  </h3>
);

export const BaseCardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ children, className = '', ...props }) => (
  <p className={`text-xs text-[var(--mac-text-muted,#6b7280)] mt-0.5 ${className}`} {...props}>
    {children}
  </p>
);

export const BaseCardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => (
  <div className={`p-4 ${className}`} {...props}>
    {children}
  </div>
);

export const BaseCardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => (
  <div className={`px-4 py-3 bg-[var(--mac-surface-muted,rgba(0,0,0,0.015))] border-t border-[var(--mac-border)] flex items-center justify-end gap-2 ${className}`} {...props}>
    {children}
  </div>
);

export default BaseCard;
// wjz新建文件结束。
