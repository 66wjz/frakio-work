// wjz新建文件，新建原因：封装规范化 Tooltip 文字提示基础公共组件，修改时间：2026-08-18。
// 文件内容概述：通用轻量 Tooltip 组件。
import React, { useState } from 'react';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  className = '',
}: TooltipProps) {
  const [visible, setVisible] = useState(false);

  if (!content) return children;

  return (
    <div
      className="tooltip-container"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={['tooltip-bubble', `tooltip-${position}`, className].filter(Boolean).join(' ')}
        >
          {content}
        </div>
      )}
    </div>
  );
}
// wjz新建文件结束。
