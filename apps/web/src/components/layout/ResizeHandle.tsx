// wjz新建文件，新建原因：解耦 main.tsx 中的双侧栏可拖拽缩放控制把手（ResizeHandle），修改时间：2026-08-17。
// 文件内容概述：ResizeHandle 侧边栏拖拽/键盘微调调整宽度组件、requestAnimationFrame 调度与 PointerCapture 事件管理。
import React, { useEffect, useRef } from 'react';
import { clampNumber } from '../../utils/formatters';
import {
  createLatestFrameScheduler,
  paneWidthFromKey,
  paneWidthFromPointer,
} from '../../pane-resize.mjs';

export function ResizeHandle({
  side,
  currentWidth,
  minWidth,
  maxWidth,
  edgeAligned = false,
  disabled,
  onResize,
  onCommit,
  onDragStart,
  onDragEnd,
}: {
  side: 'left' | 'right';
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  edgeAligned?: boolean;
  disabled?: boolean;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (width: number) => void;
}) {
  const latestWidthRef = useRef(currentWidth);
  const latestBoundsRef = useRef({ minWidth, maxWidth });
  const keyboardWidthRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const effectiveMaxWidth = Math.max(minWidth, maxWidth);
  latestBoundsRef.current = { minWidth, maxWidth: effectiveMaxWidth };

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      document.body.classList.remove('resizing-columns');
    },
    [],
  );

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const startWidth = clampNumber(currentWidth, minWidth, effectiveMaxWidth);
    latestWidthRef.current = startWidth;
    onDragStart?.();
    document.body.classList.add('resizing-columns');
    target.classList.add('is-resizing');
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; window listeners still keep the drag stable.
    }
    const applyPointerPosition = (clientX: number) => {
      const bounds = latestBoundsRef.current;
      const nextWidth = paneWidthFromPointer({
        side,
        startWidth,
        startX,
        currentX: clientX,
        minWidth: bounds.minWidth,
        maxWidth: bounds.maxWidth,
      });
      latestWidthRef.current = nextWidth;
      onResize(nextWidth);
    };
    const moveScheduler = createLatestFrameScheduler({
      requestFrame: window.requestAnimationFrame.bind(window),
      cancelFrame: window.cancelAnimationFrame.bind(window),
      apply: applyPointerPosition,
    });
    const onMove = (moveEvent: PointerEvent) => {
      moveScheduler.schedule(moveEvent.clientX);
    };
    let finished = false;
    const cleanup = () => {
      moveScheduler.cancel();
      document.body.classList.remove('resizing-columns');
      target.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already have been released by the operating system.
      }
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      moveScheduler.flush();
      cleanup();
      onCommit(latestWidthRef.current);
      onDragEnd?.(latestWidthRef.current);
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    window.addEventListener('blur', finish, { once: true });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextWidth = paneWidthFromKey({
      side,
      currentWidth: keyboardWidthRef.current ?? currentWidth,
      key: event.key,
      shiftKey: event.shiftKey,
      minWidth,
      maxWidth: effectiveMaxWidth,
    });
    keyboardWidthRef.current = nextWidth;
    latestWidthRef.current = nextWidth;
    onResize(nextWidth);
  }

  function commitKeyboardWidth() {
    if (keyboardWidthRef.current === null) return;
    const width = keyboardWidthRef.current;
    keyboardWidthRef.current = null;
    onCommit(width);
  }

  return (
    <div
      className={`resize-handle ${side} ${edgeAligned ? 'card-edge' : ''} ${disabled ? 'disabled' : ''}`}
      role="separator"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={effectiveMaxWidth}
      aria-valuenow={clampNumber(currentWidth, minWidth, effectiveMaxWidth)}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={startDrag}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) commitKeyboardWidth();
      }}
      onBlur={commitKeyboardWidth}
    />
  );
}
// wjz新建文件结束。
