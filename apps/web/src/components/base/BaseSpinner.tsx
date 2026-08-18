// wjz新建文件，新建原因：封装基础加载动画指示器 BaseSpinner，修改时间：2026-08-18。
// 文件内容概述：支持 sm, md, lg 尺寸、自定义颜色与居中容器。
import React from 'react';
import { BaseIcon } from './BaseIcon';

export interface BaseSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | number;
  color?: string;
  className?: string;
  center?: boolean;
  label?: string;
}

export const BaseSpinner: React.FC<BaseSpinnerProps> = ({
  size = 'md',
  color,
  className = '',
  center = false,
  label,
}) => {
  const sizePx = typeof size === 'number'
    ? size
    : { sm: 14, md: 20, lg: 32 }[size];

  const content = (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <BaseIcon
        name="loader-circle"
        size={sizePx}
        color={color}
        spinning
        className="animate-spin text-[var(--mac-accent,#0f766e)]"
      />
      {label && <span className="text-xs text-[var(--mac-text-muted,#6b7280)]">{label}</span>}
    </div>
  );

  if (center) {
    return <div className="flex items-center justify-center p-6 w-full h-full min-h-[100px]">{content}</div>;
  }

  return content;
};

export default BaseSpinner;
// wjz新建文件结束。
