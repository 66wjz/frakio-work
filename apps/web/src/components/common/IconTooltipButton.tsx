// wjz新建文件，新建原因：解耦 main.tsx 中的 IconTooltipButton 通用浮层提示按钮组件，修改时间：2026-08-17。
// 文件内容概述：支持悬停延迟、视口边缘自适应（自动 flip 至 bottom/top）以及 Portal 渲染的浮层提示按钮。
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function IconTooltipButton({
  active,
  ariaLabel,
  badge,
  children,
  className = '',
  hoverDelayMs = 0,
  onClick,
  placement = 'bottom',
  tooltip,
  ...buttonProps
}: {
  active?: boolean;
  ariaLabel: string;
  badge?: number;
  children: React.ReactNode;
  className?: string;
  hoverDelayMs?: number;
  placement?: 'top' | 'bottom';
  tooltip: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'className' | 'title'>) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const tooltipId = useId();
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);
  const shown = Boolean(tooltipPosition);

  const updateTooltipPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const resolvedPlacement = placement === 'top' && rect.top < 44 ? 'bottom' : placement;
    setTooltipPosition({
      left: Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2)),
      top: resolvedPlacement === 'top' ? rect.top - 8 : rect.bottom + 8,
      placement: resolvedPlacement,
    });
  }, [placement]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const hideTooltip = useCallback(() => {
    clearHoverTimer();
    setTooltipPosition(null);
  }, [clearHoverTimer]);

  const showTooltipAfterDelay = useCallback(() => {
    clearHoverTimer();
    if (hoverDelayMs <= 0) {
      updateTooltipPosition();
      return;
    }
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      updateTooltipPosition();
    }, hoverDelayMs);
  }, [clearHoverTimer, hoverDelayMs, updateTooltipPosition]);

  useEffect(() => {
    if (!shown) return undefined;
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    return () => {
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('scroll', hideTooltip, true);
    };
  }, [hideTooltip, shown]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node || !tooltipPosition) return;
    const halfWidth = node.offsetWidth / 2;
    const nextLeft = Math.min(window.innerWidth - 12 - halfWidth, Math.max(12 + halfWidth, tooltipPosition.left));
    if (Math.abs(nextLeft - tooltipPosition.left) < 0.5) return;
    setTooltipPosition((current) => current ? { ...current, left: nextLeft } : current);
  }, [tooltip, tooltipPosition]);

  return (
    <>
      <button
        {...buttonProps}
        ref={buttonRef}
        className={`${className}${active ? ' active' : ''}`}
        onBlur={hideTooltip}
        onClick={(event) => {
          hideTooltip();
          onClick?.(event);
        }}
        onFocus={updateTooltipPosition}
        onMouseEnter={showTooltipAfterDelay}
        onMouseLeave={hideTooltip}
        aria-label={ariaLabel}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        type="button"
      >
        {children}
        {badge ? <em>{badge}</em> : null}
      </button>
      {tooltipPosition && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className={`icon-tooltip placement-${tooltipPosition.placement}`}
          role="tooltip"
          style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
        >
          {tooltip}
        </div>,
        document.body,
      )}
    </>
  );
}
// wjz新建文件结束。
