// wjz新建文件，新建原因：封装复合内容分区组件 BaseSection，修改时间：2026-08-18。
// 文件内容概述：支持区域标题、副标题说明、图标、右侧操作按钮区与内容卡片容器。
import React from 'react';
import { BaseIcon } from '../base/BaseIcon';

export interface BaseSectionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: string;
  extra?: React.ReactNode;
  bordered?: boolean;
}

export const BaseSection: React.FC<BaseSectionProps> = ({
  title,
  description,
  icon,
  extra,
  children,
  bordered = true,
  className = '',
  ...props
}) => {
  return (
    <div
      className={`rounded-xl bg-[var(--mac-card-bg,#ffffff)] ${bordered ? 'border border-[var(--mac-border)] shadow-sm' : ''} p-5 ${className}`}
      {...props}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-2.5">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-[var(--mac-surface-muted,rgba(0,0,0,0.03))] border border-[var(--mac-border)] flex items-center justify-center text-[var(--mac-accent)] flex-shrink-0 mt-0.5">
              <BaseIcon name={icon} size={16} />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-[var(--mac-text)] leading-tight">{title}</h3>
            {description && (
              <p className="text-xs text-[var(--mac-text-muted,#6b7280)] mt-0.5 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        {extra && <div className="flex items-center gap-2 flex-shrink-0">{extra}</div>}
      </div>

      <div className="section-content">{children}</div>
    </div>
  );
};

export default BaseSection;
// wjz新建文件结束。
