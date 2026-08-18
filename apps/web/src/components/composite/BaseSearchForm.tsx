// wjz新建文件，新建原因：封装复合搜索与过滤表单组件 BaseSearchForm，修改时间：2026-08-18。
// 文件内容概述：集成搜索输入框、重置/查询按钮与自定义过滤项插槽。
import React from 'react';
import { BaseInput } from '../base/BaseInput';
import { BaseButton } from '../base/BaseButton';

export interface BaseSearchFormProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSearch?: () => void;
  onReset?: () => void;
  filters?: React.ReactNode;
  className?: string;
}

export const BaseSearchForm: React.FC<BaseSearchFormProps> = ({
  value,
  onChange,
  placeholder = '输入关键词搜索...',
  onSearch,
  onReset,
  filters,
  className = '',
}) => {
  return (
    <div className={`flex flex-wrap items-center gap-2.5 ${className}`}>
      <div className="w-64 min-w-[200px]">
        <BaseInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          prefixIcon="search"
          clearable
          onClear={() => onChange('')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch?.();
          }}
        />
      </div>

      {filters && <div className="flex items-center gap-2">{filters}</div>}

      {onSearch && (
        <BaseButton variant="primary" size="sm" icon="search" onClick={onSearch}>
          搜索
        </BaseButton>
      )}

      {onReset && (
        <BaseButton variant="ghost" size="sm" icon="rotate" onClick={onReset}>
          重置
        </BaseButton>
      )}
    </div>
  );
};

export default BaseSearchForm;
// wjz新建文件结束。
