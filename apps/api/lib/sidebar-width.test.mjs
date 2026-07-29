import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MAC_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_VERSION,
  normalizeWorkbenchSidebarPatch,
  normalizeWorkbenchSidebarSettings,
} from './sidebar-width.mjs';

test('new workbench state uses platform-specific sidebar defaults', () => {
  assert.deepEqual(normalizeWorkbenchSidebarSettings({}), {
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    macSidebarWidth: DEFAULT_MAC_SIDEBAR_WIDTH,
    macSidebarWidthVersion: SIDEBAR_WIDTH_VERSION,
  });
});

test('legacy default width migrates once to the narrower macOS default', () => {
  assert.equal(normalizeWorkbenchSidebarSettings({ sidebarWidth: 240 }).macSidebarWidth, 224);
  assert.equal(normalizeWorkbenchSidebarSettings({ sidebarWidth: 240 }).macSidebarWidthVersion, 1);
});

test('legacy custom widths are preserved on macOS', () => {
  assert.equal(normalizeWorkbenchSidebarSettings({ sidebarWidth: 316 }).macSidebarWidth, 316);
});

test('a migrated user can deliberately return macOS width to 240', () => {
  assert.equal(normalizeWorkbenchSidebarSettings({ sidebarWidth: 240, macSidebarWidth: 240, macSidebarWidthVersion: 1 }).macSidebarWidth, 240);
});

test('sidebar patches clamp each platform independently', () => {
  assert.deepEqual(normalizeWorkbenchSidebarPatch({ sidebarWidth: 12 }), { sidebarWidth: 240 });
  assert.deepEqual(normalizeWorkbenchSidebarPatch({ macSidebarWidth: 12 }), { macSidebarWidth: 220, macSidebarWidthVersion: 1 });
  assert.deepEqual(normalizeWorkbenchSidebarPatch({ sidebarWidth: 999, macSidebarWidth: 999 }), { sidebarWidth: 420, macSidebarWidth: 420, macSidebarWidthVersion: 1 });
});
