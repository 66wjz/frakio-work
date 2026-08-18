import type { LaunchMaterialSnapshot } from '../../types/workbench';
import { defaultProductSpaceTheme, normalizeSpaceTheme } from '../../utils/theme-helpers';

export const launchUserAvatarSnapshotKey = 'frakio-work.launchUserAvatarSnapshot';
export const launchMaterialSnapshotKey = 'frakio-work.launchMaterialSnapshot';

export function readLaunchUserAvatarSnapshot() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(launchUserAvatarSnapshotKey);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

export function writeLaunchUserAvatarSnapshot(avatarUrl: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (avatarUrl) window.localStorage.setItem(launchUserAvatarSnapshotKey, avatarUrl);
    else window.localStorage.removeItem(launchUserAvatarSnapshotKey);
  } catch {
    // localStorage can be disabled; the launch screen still renders from live profile data.
  }
}

export function readLaunchMaterialSnapshot(nativeMaterial: boolean): LaunchMaterialSnapshot {
  const fallbackDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const fallbackTheme = normalizeSpaceTheme({
    ...defaultProductSpaceTheme,
    colorMode: nativeMaterial ? 'native' : 'custom',
    appearance: fallbackDark ? 'dark' : 'light',
  });
  const fallback = { activeSpaceId: 'space_default', theme: fallbackTheme, dark: fallbackDark };
  if (typeof window === 'undefined') return fallback;
  try {
    const value = JSON.parse(window.localStorage.getItem(launchMaterialSnapshotKey) || 'null');
    if (!value || typeof value !== 'object') return fallback;
    return {
      activeSpaceId: String(value.activeSpaceId || 'space_default'),
      theme: normalizeSpaceTheme(value.theme),
      dark: Boolean(value.dark),
    };
  } catch {
    return fallback;
  }
}

export function writeLaunchMaterialSnapshot(snapshot: LaunchMaterialSnapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(launchMaterialSnapshotKey, JSON.stringify(snapshot));
  } catch {
    // The live theme still takes over as soon as workspace data is available.
  }
}
// wjz新建文件结束。
