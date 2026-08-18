// wjz新建文件，新建原因：封装基础表单项组件 BaseFormGroup，修改时间：2026-08-18。
// 文件内容概述：统一封装表单标签、必填星号、输入控件插槽、错误提示与说明文案。
import React from 'react';

export interface BaseFormGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  required?: boolean;
  error?: string | boolean;
  helperText?: React.ReactNode;
  layout?: 'vertical' | 'horizontal';
}

export const BaseFormGroup: React.FC<BaseFormGroupProps> = ({
  children,
  label,
  required = false,
  error,
  helperText,
  layout = 'vertical',
  className = '',
  ...props
}) => {
  const isHorizontal = layout === 'horizontal';

  return (
    <div
      className={`flex ${isHorizontal ? 'flex-row items-center justify-between gap-4' : 'flex-col gap-1.5'} ${className}`}
      {...props}
    >
      {label && (
        <div className={`flex items-center gap-1 ${isHorizontal ? 'w-1/3 min-w-[120px]' : ''}`}>
          <label className="text-xs font-medium text-[var(--mac-text)] select-none">
            {label}
          </label>
          {required && <span className="text-rose-500 font-bold leading-none">*</span>}
        </div>
      )}
      <div className={`flex flex-col gap-1 ${isHorizontal ? 'flex-1' : 'w-full'}`}>
        {children}
        {typeof error === 'string' && error ? (
          <span className="text-xs font-medium text-rose-500 animate-fade-in">{error}</span>
        ) : (
          helperText && <span className="text-xs text-[var(--mac-text-muted,#6b7280)] leading-relaxed">{helperText}</span>
        )}
      </div>
    </div>
  );
};

export default BaseFormGroup;
// wjz新建文件结束。
