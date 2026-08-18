// wjz新建文件，新建原因：封装基础警告与提示横幅组件 BaseAlert，修改时间：2026-08-18。
// 文件内容概述：支持 info, success, warning, error 四种类型，支持可选关闭按钮与自定义图标。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseAlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  closable?: boolean;
  onClose?: () => void;
  icon?: string;
}

export const BaseAlert: React.FC<BaseAlertProps> = ({
  children,
  variant = 'info',
  title,
  closable = false,
  onClose,
  icon,
  className = '',
  ...props
}) => {
  const variantClasses = {
    info: 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300',
    success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
    error: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
  }[variant];

  const defaultIcons = {
    info: 'info',
    success: 'check-circle-2',
    warning: 'triangle-alert',
    error: 'alert-circle',
  }[variant];

  return (
    <div
      className={`flex items-start gap-3 p-3.5 rounded-xl border text-xs leading-relaxed ${variantClasses} ${className}`}
      {...props}
    >
      <div className="flex-shrink-0 mt-0.5">
        <BaseIcon name={icon || defaultIcons} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div className="opacity-90">{children}</div>
      </div>
      {closable && (
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity p-0.5 rounded focus:outline-none"
        >
          <BaseIcon name="x" size={14} />
        </button>
      )}
    </div>
  );
};

export default BaseAlert;
// wjz新建文件结束。
