// wjz新建文件，新建原因：封装复合工具栏组件 BaseToolbar，修改时间：2026-08-18。
// 文件内容概述：支持左右插槽布局，用于列表顶部操作栏、筛选器与状态汇总条。
import React from 'react';

export interface BaseToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export const BaseToolbar: React.FC<BaseToolbarProps> = ({
  left,
  right,
  children,
  className = '',
  ...props
}) => {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[var(--mac-surface-muted,rgba(0,0,0,0.02))] border border-[var(--mac-border)] ${className}`}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[200px]">
        {left || children}
      </div>
      {right && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {right}
        </div>
      )}
    </div>
  );
};

export default BaseToolbar;
// wjz新建文件结束。
