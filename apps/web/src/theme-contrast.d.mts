export function hexRgbChannels(value: string): number[];
export function compositeTint(color: string, opacity: number, dark: boolean): number[];
export function relativeLuminance(rgb: number[]): number;
export function contrastForegroundForTint(color: string, opacity: number, dark: boolean): 'light' | 'dark';
export function workspaceTintAlpha(opacity: number): number;
