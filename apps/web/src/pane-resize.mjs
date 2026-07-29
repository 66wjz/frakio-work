function clamp(value, min, max) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Math.max(safeMin, Number.isFinite(max) ? max : safeMin);
  const safeValue = Number.isFinite(value) ? value : safeMin;
  return Math.round(Math.min(safeMax, Math.max(safeMin, safeValue)));
}

export function normalizePaneWidth(value, minWidth, maxWidth) {
  return clamp(Number(value), minWidth, maxWidth);
}

export function availablePaneMax({
  side,
  viewportWidth,
  sidebarWidth,
  contextWidth,
  leftVisible,
  rightVisible,
  minMainWidth = 520,
  chromeWidth = 72,
  minWidth,
  maxWidth,
}) {
  const oppositeWidth = side === 'left'
    ? (rightVisible ? contextWidth : 0)
    : (leftVisible ? sidebarWidth : 0);
  const available = viewportWidth - oppositeWidth - minMainWidth - chromeWidth;
  return clamp(available, minWidth, maxWidth);
}

export function paneWidthFromPointer({ side, startWidth, startX, currentX, minWidth, maxWidth }) {
  const delta = currentX - startX;
  const nextWidth = side === 'left' ? startWidth + delta : startWidth - delta;
  return clamp(nextWidth, minWidth, maxWidth);
}

export function paneWidthFromKey({ side, currentWidth, key, shiftKey, minWidth, maxWidth }) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return currentWidth;
  const step = shiftKey ? 24 : 8;
  const direction = key === 'ArrowRight' ? 1 : -1;
  const signedStep = side === 'left' ? direction * step : direction * -step;
  return clamp(currentWidth + signedStep, minWidth, maxWidth);
}
