'use strict';

const APPEARANCE_VALUES = new Set(['system', 'light', 'dark']);

function normalizeAppearance(value) {
  return APPEARANCE_VALUES.has(value) ? value : 'system';
}

function appearanceState(nativeTheme, requested = nativeTheme.themeSource) {
  const source = normalizeAppearance(requested);
  return {
    source,
    dark: source === 'dark' || (source === 'system' && nativeTheme.shouldUseDarkColors),
  };
}

function applyAppearance(nativeTheme, requested) {
  const source = normalizeAppearance(requested);
  nativeTheme.themeSource = source;
  return appearanceState(nativeTheme, source);
}

module.exports = { normalizeAppearance, appearanceState, applyAppearance };
