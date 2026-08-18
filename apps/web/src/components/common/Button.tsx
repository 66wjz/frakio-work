// wjz新建文件，新建原因：封装规范化 Button 基础公共组件，修改时间：2026-08-18。
// 文件内容概述：支持 primary, secondary, outline, ghost, danger 多变体及 sm, md, lg 尺寸的通用 Button 组件。
import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      className = '',
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const variantClass = `btn-${variant}`;
    const sizeClass = `btn-${size}`;
    const combinedClassName = ['btn', variantClass, sizeClass, loading && 'btn-loading', className]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} className={combinedClassName} disabled={disabled || loading} {...props}>
        {loading ? (
          <Loader2 className="btn-spinner animate-spin" size={size === 'sm' ? 12 : 16} aria-hidden="true" />
        ) : (
          leftIcon && <span className="btn-icon-left" aria-hidden="true">{leftIcon}</span>
        )}
        {children && <span className="btn-label">{children}</span>}
        {!loading && rightIcon && <span className="btn-icon-right" aria-hidden="true">{rightIcon}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';
// wjz新建文件结束。
