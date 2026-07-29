export const SPACE_THEME_RENDER_VERSION = 3;

export function migrateSpaceThemeOpacity(value) {
  const opacity = Math.max(0.3, Math.min(0.9, Number(value) || 0.5));
  return Number((0.35 + ((opacity - 0.3) / 0.6) * 0.25).toFixed(4));
}

export function migrateSpaceTheme(theme = {}) {
  const previousVersion = Number(theme.renderVersion) || 0;
  const colorMode = theme.colorMode === 'native' ? 'native' : 'custom';
  if (previousVersion >= SPACE_THEME_RENDER_VERSION) return { ...theme, colorMode, renderVersion: SPACE_THEME_RENDER_VERSION };
  if (previousVersion >= 2) return { ...theme, colorMode, renderVersion: SPACE_THEME_RENDER_VERSION };
  const migratePalette = (palette = {}) => ({
    ...palette,
    opacity: migrateSpaceThemeOpacity(palette.opacity ?? theme.opacity),
  });
  return {
    ...theme,
    opacity: migrateSpaceThemeOpacity(theme.opacity),
    lightTheme: migratePalette(theme.lightTheme || theme),
    darkTheme: migratePalette(theme.darkTheme || theme),
    colorMode,
    renderVersion: SPACE_THEME_RENDER_VERSION,
  };
}
