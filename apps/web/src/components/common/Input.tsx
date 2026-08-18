// wjz新建文件，新建原因：封装规范化 Input 基础公共组件，修改时间：2026-08-18。
// 文件内容概述：支持 prefix/suffix 图标、error 状态及 helperText 提示的通用 Input 组件。
import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      className = '',
      containerClassName = '',
      id,
      ...props
    },
    ref,
  ) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);

    return (
      <div className={['form-field-group', containerClassName].filter(Boolean).join(' ')}>
        {label && (
          <label htmlFor={inputId} className="form-field-label">
            {label}
          </label>
        )}
        <div className={['input-wrapper', error && 'has-error', leftIcon && 'has-left-icon', rightIcon && 'has-right-icon'].filter(Boolean).join(' ')}>
          {leftIcon && <span className="input-icon input-icon-left" aria-hidden="true">{leftIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            className={['input-control', className].filter(Boolean).join(' ')}
            aria-invalid={Boolean(error)}
            {...props}
          />
          {rightIcon && <span className="input-icon input-icon-right" aria-hidden="true">{rightIcon}</span>}
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

Input.displayName = 'Input';
// wjz新建文件结束。
