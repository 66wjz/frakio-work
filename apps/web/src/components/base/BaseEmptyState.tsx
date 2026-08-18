// wjz新建文件，新建原因：封装基础空状态展示组件 BaseEmptyState，修改时间：2026-08-18。
// 文件内容概述：支持自定义图标、主标题、描述文本及快捷操作插槽。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseEmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: string | React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export const BaseEmptyState: React.FC<BaseEmptyStateProps> = ({
  icon = 'folder-open',
  title = '暂无数据',
  description,
  action,
  className = '',
  ...props
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center rounded-xl bg-[var(--mac-surface-muted,rgba(0,0,0,0.015))] border border-dashed border-[var(--mac-border)] ${className}`}
      {...props}
    >
      <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--mac-surface,#ffffff)] border border-[var(--mac-border)] text-[var(--mac-text-muted,#9ca3af)] shadow-sm mb-3">
        {typeof icon === 'string' ? <BaseIcon name={icon} size={22} /> : icon}
      </div>
      <h4 className="text-sm font-semibold text-[var(--mac-text)] mb-1">{title}</h4>
      {description && (
        <p className="text-xs text-[var(--mac-text-muted,#6b7280)] max-w-sm mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};

export default BaseEmptyState;
// wjz新建文件结束。
