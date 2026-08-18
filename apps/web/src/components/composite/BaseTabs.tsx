// wjz新建文件，新建原因：封装复合选项卡组件 BaseTabs，修改时间：2026-08-18。
// 文件内容概述：支持 pill（胶囊式）、underline（下划线式）、card（卡片式）三种风格，支持徽标与图标展示。
import React from 'react';
import { BaseIcon } from '../base/BaseIcon';
import { BaseBadge } from '../base/BaseBadge';

export interface BaseTabItem {
  id: string;
  label: React.ReactNode;
  icon?: string;
  badge?: string | number;
  disabled?: boolean;
}

export interface BaseTabsProps {
  items: BaseTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: 'pill' | 'underline' | 'card';
  size?: 'sm' | 'md';
  className?: string;
}

export const BaseTabs: React.FC<BaseTabsProps> = ({
  items,
  activeId,
  onChange,
  variant = 'pill',
  size = 'md',
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'text-xs px-2.5 py-1 gap-1.5' : 'text-sm px-3.5 py-1.5 gap-2';

  if (variant === 'underline') {
    return (
      <div className={`flex items-center gap-4 border-b border-[var(--mac-border)] ${className}`}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={`
                relative flex items-center font-medium transition-all pb-2.5 -mb-px
                ${sizeClasses}
                ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                ${isActive ? 'text-[var(--mac-accent)] font-semibold' : 'text-[var(--mac-text-muted,#6b7280)] hover:text-[var(--mac-text)]'}
              `}
            >
              {item.icon && <BaseIcon name={item.icon} size={size === 'sm' ? 13 : 15} />}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <BaseBadge size="sm" variant={isActive ? 'primary' : 'neutral'}>
                  {item.badge}
                </BaseBadge>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--mac-accent)] rounded-full animate-fade-in" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center p-1 bg-[var(--mac-surface-muted,rgba(0,0,0,0.04))] rounded-xl border border-[var(--mac-border)] gap-1 ${className}`}>
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={`
              flex items-center font-medium rounded-lg transition-all select-none
              ${sizeClasses}
              ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              ${isActive
                ? 'bg-[var(--mac-card-bg,#ffffff)] text-[var(--mac-text)] shadow-sm font-semibold'
                : 'text-[var(--mac-text-muted,#6b7280)] hover:text-[var(--mac-text)] hover:bg-[var(--mac-surface-hover,rgba(0,0,0,0.03))]'
              }
            `}
          >
            {item.icon && <BaseIcon name={item.icon} size={size === 'sm' ? 13 : 15} />}
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <BaseBadge size="sm" variant={isActive ? 'primary' : 'neutral'}>
                {item.badge}
              </BaseBadge>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default BaseTabs;
// wjz新建文件结束。
