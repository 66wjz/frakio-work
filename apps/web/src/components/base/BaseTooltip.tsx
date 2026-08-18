// wjz新建文件，新建原因：封装基础文字提示组件 BaseTooltip，修改时间：2026-08-18。
// 文件内容概述：提供延迟展示、四个方位自适应浮层与圆角气泡提示。
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface BaseTooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
}

export const BaseTooltip: React.FC<BaseTooltipProps> = ({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 200,
}) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let top = 0;
    let left = 0;

    if (side === 'top') {
      top = rect.top + scrollY - 8;
      left = align === 'start' ? rect.left + scrollX : align === 'end' ? rect.right + scrollX : rect.left + scrollX + rect.width / 2;
    } else if (side === 'bottom') {
      top = rect.bottom + scrollY + 8;
      left = align === 'start' ? rect.left + scrollX : align === 'end' ? rect.right + scrollX : rect.left + scrollX + rect.width / 2;
    } else if (side === 'left') {
      top = rect.top + scrollY + rect.height / 2;
      left = rect.left + scrollX - 8;
    } else if (side === 'right') {
      top = rect.top + scrollY + rect.height / 2;
      left = rect.right + scrollX + 8;
    }

    setCoords({ top, left });
  };

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, delayDuration);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const getTransform = () => {
    if (side === 'top') {
      return align === 'start' ? 'translate(0, -100%)' : align === 'end' ? 'translate(-100%, -100%)' : 'translate(-50%, -100%)';
    }
    if (side === 'bottom') {
      return align === 'start' ? 'translate(0, 0)' : align === 'end' ? 'translate(-100%, 0)' : 'translate(-50%, 0)';
    }
    if (side === 'left') {
      return 'translate(-100%, -50%)';
    }
    return 'translate(0, -50%)';
  };

  return (
    <>
      <span
        ref={triggerRef as any}
        className="inline-flex"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>

      {visible &&
        createPortal(
          <div
            className="fixed z-50 px-2.5 py-1 text-xs text-white bg-neutral-900/95 dark:bg-neutral-800/95 backdrop-blur-sm rounded-md shadow-lg border border-neutral-700/50 animate-fade-in select-none pointer-events-none"
            style={{
              top: coords.top,
              left: coords.left,
              transform: getTransform(),
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
};

export default BaseTooltip;
// wjz新建文件结束。


