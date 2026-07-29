'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAppearance, appearanceState, applyAppearance } = require('./appearance.cjs');

test('normalizes desktop appearance values', () => {
  assert.equal(normalizeAppearance('system'), 'system');
  assert.equal(normalizeAppearance('light'), 'light');
  assert.equal(normalizeAppearance('dark'), 'dark');
  assert.equal(normalizeAppearance('auto'), 'system');
});

test('resolves system appearance from Electron nativeTheme', () => {
  assert.deepEqual(appearanceState({ themeSource: 'system', shouldUseDarkColors: true }), { source: 'system', dark: true });
  assert.deepEqual(appearanceState({ themeSource: 'system', shouldUseDarkColors: false }), { source: 'system', dark: false });
  assert.deepEqual(appearanceState({ themeSource: 'light', shouldUseDarkColors: true }), { source: 'light', dark: false });
});

test('applies a validated theme source', () => {
  const nativeTheme = { themeSource: 'system', shouldUseDarkColors: false };
  assert.deepEqual(applyAppearance(nativeTheme, 'dark'), { source: 'dark', dark: true });
  assert.equal(nativeTheme.themeSource, 'dark');
});
