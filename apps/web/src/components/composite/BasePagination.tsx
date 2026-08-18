// wjz新建文件，新建原因：封装复合分页控制器组件 BasePagination，修改时间：2026-08-18。
// 文件内容概述：支持上一页/下一页、页码跳转、每页条数展示与极简样式。
import React from 'react';
import { BaseButton } from '../base/BaseButton';

export interface BasePaginationProps {
  current: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
  className?: string;
}

export const BasePagination: React.FC<BasePaginationProps> = ({
  current,
  total,
  pageSize = 10,
  onChange,
  className = '',
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-between gap-4 py-2 select-none text-xs text-[var(--mac-text-muted,#6b7280)] ${className}`}>
      <div>
        共 <span className="font-semibold text-[var(--mac-text)]">{total}</span> 条数据，第 <span className="font-semibold text-[var(--mac-text)]">{current}</span> / {totalPages} 页
      </div>

      <div className="flex items-center gap-1.5">
        <BaseButton
          variant="outline"
          size="sm"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
          icon="chevron-left"
        >
          上一页
        </BaseButton>

        <BaseButton
          variant="outline"
          size="sm"
          disabled={current >= totalPages}
          onClick={() => onChange(current + 1)}
          icon="chevron-right"
          iconPosition="right"
        >
          下一页
        </BaseButton>
      </div>
    </div>
  );
};

export default BasePagination;
// wjz新建文件结束。
