export const SIDEBAR_WIDTH_VERSION: number;
export const DEFAULT_SIDEBAR_WIDTH: number;
export const DEFAULT_MAC_SIDEBAR_WIDTH: number;
export const SIDEBAR_WIDTH_BOUNDS: Readonly<{ min: number; max: number }>;
export const MAC_SIDEBAR_WIDTH_BOUNDS: Readonly<{ min: number; max: number }>;

export function normalizeWorkbenchSidebarSettings(ui?: Record<string, unknown>): {
  sidebarWidth: number;
  macSidebarWidth: number;
  macSidebarWidthVersion: number;
};

export function normalizeWorkbenchSidebarPatch<T extends Record<string, unknown>>(patch?: T): T & {
  sidebarWidth?: number;
  macSidebarWidth?: number;
  macSidebarWidthVersion?: number;
};
