import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateSpaceTheme, migrateSpaceThemeOpacity, SPACE_THEME_RENDER_VERSION } from './lib/space-theme.mjs';

test('maps legacy workspace opacity into the restrained material range', () => {
  assert.equal(migrateSpaceThemeOpacity(0.3), 0.35);
  assert.equal(migrateSpaceThemeOpacity(0.9), 0.6);
  assert.equal(migrateSpaceThemeOpacity(0.6), 0.475);
});

test('migrates workspace palettes once', () => {
  const migrated = migrateSpaceTheme({ opacity: 0.9, lightTheme: { opacity: 0.6 }, darkTheme: { opacity: 0.3 } });
  assert.equal(migrated.renderVersion, SPACE_THEME_RENDER_VERSION);
  assert.equal(migrated.colorMode, 'custom');
  assert.equal(migrated.opacity, 0.6);
  assert.equal(migrated.lightTheme.opacity, 0.475);
  assert.equal(migrated.darkTheme.opacity, 0.35);
  assert.deepEqual(migrateSpaceTheme(migrated), migrated);
});

test('version two themes gain custom color mode without remapping opacity', () => {
  const migrated = migrateSpaceTheme({ renderVersion: 2, opacity: 0.475, lightTheme: { opacity: 0.475 } });
  assert.equal(migrated.renderVersion, SPACE_THEME_RENDER_VERSION);
  assert.equal(migrated.colorMode, 'custom');
  assert.equal(migrated.opacity, 0.475);
  assert.equal(migrated.lightTheme.opacity, 0.475);
});

test('normalizes native and unknown color modes', () => {
  assert.equal(migrateSpaceTheme({ renderVersion: 2, colorMode: 'native' }).colorMode, 'native');
  assert.equal(migrateSpaceTheme({ renderVersion: 2, colorMode: 'unknown' }).colorMode, 'custom');
});
