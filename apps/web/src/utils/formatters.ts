// wjz新建文件，新建原因：解耦 main.tsx 中的通用格式化函数，修改时间：2026-08-17。
// 文件内容概述：时间、文件大小、数值、货币等纯函数格式化工具。
// wjz新建文件结束。

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value || 0));
}

export function formatFullNumber(value: number): string {
  return Math.round(value || 0).toLocaleString('en-US');
}

export function formatWanNumber(value: number): string {
  const next = Number(value || 0);
  if (next >= 10_000) return `${(next / 10_000).toFixed(next >= 1_000_000 ? 2 : 1)} 万`;
  if (next >= 1_000) return `${(next / 1_000).toFixed(1)}K`;
  return String(Math.round(next));
}

export function formatChineseApproxNumber(value: number): string {
  const next = Number(value || 0);
  if (next >= 100_000_000) return `${trimTrailingZero(next / 100_000_000)} 亿`;
  if (next >= 10_000) return `${trimTrailingZero(next / 10_000)} 万`;
  return String(Math.round(next));
}

export function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

export function formatUsd(value: number): string {
  return `$${Number(value || 0).toFixed(value >= 10 ? 2 : 4)}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
