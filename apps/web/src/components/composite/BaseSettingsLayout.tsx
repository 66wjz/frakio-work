// wjz新建文件，新建原因：封装设置中心左右分栏标准布局组件 BaseSettingsLayout，修改时间：2026-08-18。
// 文件内容概述：左侧可滚动导航菜单 + 右侧带标题、说明与操作区的内容主面板。
import React from 'react';
import { BaseIcon } from '../base/BaseIcon';

export interface BaseSettingsNavItem {
  id: string;
  label: React.ReactNode;
  icon?: string;
  badge?: string | number;
  group?: string;
}

export interface BaseSettingsLayoutProps {
  navItems: BaseSettingsNavItem[];
  activeId: string;
  onSelectNav: (id: string) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const BaseSettingsLayout: React.FC<BaseSettingsLayoutProps> = ({
  navItems,
  activeId,
  onSelectNav,
  title,
  description,
  extra,
  children,
  className = '',
}) => {
  // 按 group 分组导航项
  const groups = navItems.reduce<Record<string, BaseSettingsNavItem[]>>((acc, item) => {
    const groupName = item.group || 'default';
    acc[groupName] = acc[groupName] || [];
    acc[groupName].push(item);
    return acc;
  }, {});

  return (
    <div className={`flex w-full h-full min-h-[600px] rounded-2xl border border-[var(--mac-border)] bg-[var(--mac-surface,#ffffff)] overflow-hidden shadow-sm ${className}`}>
      {/* 1. 左侧导航栏 */}
      <div className="w-56 flex-shrink-0 bg-[var(--mac-surface-muted,rgba(0,0,0,0.015))] border-r border-[var(--mac-border)] flex flex-col p-3 overflow-y-auto">
        <div className="space-y-4">
          {Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="space-y-1">
              {groupName !== 'default' && (
                <div className="px-2.5 py-1 text-[11px] font-semibold text-[var(--mac-text-muted,#9ca3af)] uppercase tracking-wider">
                  {groupName}
                </div>
              )}
              {items.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectNav(item.id)}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-xl transition-all text-left select-none
                      ${isActive
                        ? 'bg-[var(--mac-accent)] text-white shadow-sm font-semibold'
                        : 'text-[var(--mac-text-muted,#4b5563)] hover:bg-[var(--mac-surface-hover,rgba(0,0,0,0.04))] hover:text-[var(--mac-text)]'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      {item.icon && (
                        <BaseIcon
                          name={item.icon}
                          size={15}
                          color={isActive ? '#ffffff' : undefined}
                        />
                      )}
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge !== undefined && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-[var(--mac-surface-muted,rgba(0,0,0,0.05))] text-[var(--mac-text-muted,#6b7280)]'}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 2. 右侧主内容区 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {(title || description || extra) && (
          <div className="flex items-start justify-between gap-4 p-6 border-b border-[var(--mac-border)] bg-[var(--mac-card-bg,#ffffff)] flex-shrink-0">
            <div>
              {title && <h2 className="text-base font-bold text-[var(--mac-text)] leading-tight">{title}</h2>}
              {description && <p className="text-xs text-[var(--mac-text-muted,#6b7280)] mt-1">{description}</p>}
            </div>
            {extra && <div className="flex items-center gap-2 flex-shrink-0">{extra}</div>}
          </div>
        )}

        <div className="p-6 flex-1 bg-[var(--mac-surface-muted,rgba(0,0,0,0.01))]">{children}</div>
      </div>
    </div>
  );
};

export default BaseSettingsLayout;
// wjz新建文件结束。
