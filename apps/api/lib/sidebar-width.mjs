export const SIDEBAR_WIDTH_VERSION = 1;
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_MAC_SIDEBAR_WIDTH = 224;
export const SIDEBAR_WIDTH_BOUNDS = Object.freeze({ min: 240, max: 420 });
export const MAC_SIDEBAR_WIDTH_BOUNDS = Object.freeze({ min: 220, max: 420 });

function clampWidth(value, fallback, bounds) {
  const parsed = value === null || value === '' ? Number.NaN : Number(value);
  const safeValue = Number.isFinite(parsed) ? parsed : fallback;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, safeValue)));
}

export function normalizeWorkbenchSidebarSettings(ui = {}) {
  const sidebarWidth = clampWidth(ui.sidebarWidth, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_WIDTH_BOUNDS);
  const migrated = Number(ui.macSidebarWidthVersion) >= SIDEBAR_WIDTH_VERSION;
  const hasMacWidth = ui.macSidebarWidth !== null && ui.macSidebarWidth !== '' && Number.isFinite(Number(ui.macSidebarWidth));
  const macSource = migrated || hasMacWidth
    ? ui.macSidebarWidth
    : (sidebarWidth === DEFAULT_SIDEBAR_WIDTH ? DEFAULT_MAC_SIDEBAR_WIDTH : sidebarWidth);
  const macSidebarWidth = clampWidth(macSource, DEFAULT_MAC_SIDEBAR_WIDTH, MAC_SIDEBAR_WIDTH_BOUNDS);
  return {
    sidebarWidth,
    macSidebarWidth,
    macSidebarWidthVersion: SIDEBAR_WIDTH_VERSION,
  };
}

export function normalizeWorkbenchSidebarPatch(patch = {}) {
  const next = { ...patch };
  if (Object.prototype.hasOwnProperty.call(next, 'sidebarWidth')) {
    next.sidebarWidth = clampWidth(next.sidebarWidth, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_WIDTH_BOUNDS);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'macSidebarWidth')) {
    next.macSidebarWidth = clampWidth(next.macSidebarWidth, DEFAULT_MAC_SIDEBAR_WIDTH, MAC_SIDEBAR_WIDTH_BOUNDS);
    next.macSidebarWidthVersion = SIDEBAR_WIDTH_VERSION;
  } else if (Object.prototype.hasOwnProperty.call(next, 'macSidebarWidthVersion')) {
    next.macSidebarWidthVersion = SIDEBAR_WIDTH_VERSION;
  }
  return next;
}
