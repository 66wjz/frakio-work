// wjz新建文件，新建原因：封装规范化 Select 下拉选择基础公共组件，修改时间：2026-08-18。
// 文件内容概述：支持 label, error, helperText, options 数组与自定义子项的通用 Select 组件。
import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: SelectOption[];
  containerClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      helperText,
      options,
      children,
      className = '',
      containerClassName = '',
      id,
      ...props
    },
    ref,
  ) => {
    const selectId = id || (label ? `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);

    return (
      <div className={['form-field-group', containerClassName].filter(Boolean).join(' ')}>
        {label && (
          <label htmlFor={selectId} className="form-field-label">
            {label}
          </label>
        )}
        <div className={['select-wrapper', error && 'has-error'].filter(Boolean).join(' ')}>
          <select
            ref={ref}
            id={selectId}
            className={['select-control', className].filter(Boolean).join(' ')}
            aria-invalid={Boolean(error)}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <span className="select-chevron" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </div>
        {error ? (
          <p className="form-field-error" role="alert">{error}</p>
        ) : helperText ? (
          <p className="form-field-helper">{helperText}</p>
        ) : null}
      </div>
    );
  },
);

Select.displayName = 'Select';
// wjz新建文件结束。
