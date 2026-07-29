export type PaneSide = 'left' | 'right';

export function normalizePaneWidth(value: unknown, minWidth: number, maxWidth: number): number;

export function availablePaneMax(options: {
  side: PaneSide;
  viewportWidth: number;
  sidebarWidth: number;
  contextWidth: number;
  leftVisible: boolean;
  rightVisible: boolean;
  minMainWidth?: number;
  chromeWidth?: number;
  minWidth: number;
  maxWidth: number;
}): number;

export function paneWidthFromPointer(options: {
  side: PaneSide;
  startWidth: number;
  startX: number;
  currentX: number;
  minWidth: number;
  maxWidth: number;
}): number;

export function paneWidthFromKey(options: {
  side: PaneSide;
  currentWidth: number;
  key: string;
  shiftKey: boolean;
  minWidth: number;
  maxWidth: number;
}): number;
