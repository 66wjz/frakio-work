import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compositeTint, contrastForegroundForTint, workspaceTintAlpha } from '../web/src/theme-contrast.mjs';

const stylesSource = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../web/src/settings.css', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');

test('chooses readable foregrounds for native light and dark material', () => {
  assert.equal(contrastForegroundForTint('#ffffff', 0, false), 'dark');
  assert.equal(contrastForegroundForTint('#000000', 0, true), 'light');
});

test('chooses readable foregrounds for bright, dark, and saturated tints', () => {
  assert.equal(contrastForegroundForTint('#fff200', 0.9, false), 'dark');
  assert.equal(contrastForegroundForTint('#120033', 0.9, true), 'light');
  assert.equal(contrastForegroundForTint('#0033aa', 0.8, false), 'light');
});

test('composites translucent workspace color over the current native material', () => {
  assert.deepEqual(compositeTint('#ff0000', 0.5, false), [248, 120, 122]);
  assert.deepEqual(compositeTint('#ffffff', 0.5, true), [139, 139, 141]);
  assert.equal(contrastForegroundForTint('#ffffff', 0.5, true), 'dark');
});

test('maps stored workspace opacity to a restrained native-material tint', () => {
  assert.equal(workspaceTintAlpha(0.3), 0.12);
  assert.equal(workspaceTintAlpha(0.6), 0.23);
  assert.equal(workspaceTintAlpha(0.9), 0.34);
  assert.equal(workspaceTintAlpha(2), 0.34);
});

test('macOS typography keeps a readable body and a compact regular-weight rail', () => {
  assert.match(stylesSource, /\.mac-desktop-shell :is\(\.message p, \.message-text, \.markdown-message\)\s*\{[\s\S]*?font-size:\s*15px;[\s\S]*?font-weight:\s*400;[\s\S]*?line-height:\s*1\.68;/);
  assert.match(stylesSource, /\.mac-desktop-shell :is\(\.rail-action, \.rail-item strong, \.rail-subitem strong\)\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?font-weight:\s*500;/);
  assert.match(stylesSource, /\.mac-desktop-shell :is\(\.rail-section-title, \.rail-section-head\)\s*\{[\s\S]*?font-size:\s*11\.5px;[\s\S]*?font-weight:\s*500;/);
});

test('macOS controls and structured content consume semantic light and dark tokens', () => {
  for (const token of [
    '--mac-text-secondary',
    '--mac-text-tertiary',
    '--mac-icon',
    '--mac-icon-hover',
    '--mac-icon-active',
    '--mac-structure-base',
    '--mac-structure-raised',
    '--mac-structure-hover',
    '--mac-structure-border',
    '--mac-field-surface',
    '--mac-drawer-surface',
  ]) assert.match(stylesSource, new RegExp(`${token}:`));
  assert.match(stylesSource, /\.mac-desktop-shell\[data-appearance='dark'\][\s\S]*?--mac-structure-base:\s*color-mix/);
  assert.match(stylesSource, /\.mac-desktop-shell :is\([\s\S]*?\.kanban-card[\s\S]*?\.studio-settings-panel[\s\S]*?background:\s*var\(--mac-structure-base\)/);
  assert.match(stylesSource, /\.mac-desktop-shell \.markdown-message :is\(code, pre\)[\s\S]*?background:\s*var\(--mac-structure-raised\)/);
});

test('macOS temporary surfaces use semantic stacking and an opaque narrow drawer', () => {
  assert.match(stylesSource, /\.sidebar-footer\s*\{[^}]*z-index:\s*20;/);
  assert.match(stylesSource, /sidebar-auto-collapsed\.mac-sidebar-overlay-visible > \.sidebar\s*\{[\s\S]*?z-index:\s*300;[\s\S]*?filter:\s*none;[\s\S]*?background:\s*var\(--mac-drawer-surface\);[\s\S]*?backdrop-filter:\s*blur\(18px\) saturate\(1\.08\);[\s\S]*?transition:\s*opacity \.2s ease-out, transform \.22s/);
  assert.match(stylesSource, /sidebar-auto-collapsed\.mac-sidebar-overlay-closing > \.sidebar\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:\s*translateX\(-14px\);[\s\S]*?pointer-events:\s*none;/);
  assert.match(mainSource, /macSidebarOverlayVisible\s*=\s*macSidebarOverlayOpen \|\| macSidebarOverlayClosing/);
  assert.match(mainSource, /setMacSidebarOverlayClosing\(true\)[\s\S]*?window\.setTimeout\([\s\S]*?220\)/);
  assert.match(stylesSource, /\.mac-space-editor-popover\s*\{[\s\S]*?z-index:\s*var\(--overlay-z-floating, 400\)/);
  assert.doesNotMatch(stylesSource, /\.sidebar-footer\s*\{[^}]*214748|sidebar-auto-collapsed\.mac-sidebar-overlay-visible > \.sidebar\s*\{[\s\S]*?214748|\.mac-space-editor-popover\s*\{[\s\S]*?214748/);
});

test('macOS composer follows Codex light and dark material tokens', () => {
  for (const token of [
    '--mac-panel-outline',
    '--mac-panel-shadow',
    '--mac-composer-surface',
    '--mac-composer-border',
    '--mac-composer-shadow',
    '--mac-composer-placeholder',
    '--mac-composer-control',
    '--mac-composer-permission-muted',
    '--mac-composer-permission-full',
    '--mac-composer-send-bg',
    '--mac-composer-send-disabled-bg',
    '--overlay-edge',
    '--overlay-shadow',
    '--overlay-dialog-shadow',
  ]) assert.match(stylesSource, new RegExp(`${token}:`));
  assert.match(stylesSource, /--mac-composer-control:\s*#000;/);
  assert.match(stylesSource, /\.mac-desktop-shell :is\(\.composer, \.new-chat-composer\)\s*\{[\s\S]*?min-height:\s*100px;[\s\S]*?border-radius:\s*22px;[\s\S]*?background:\s*var\(--mac-composer-surface\)/);
  assert.match(stylesSource, /\.mac-desktop-shell\[data-appearance='dark'\][\s\S]*?--mac-composer-surface:\s*#2b2b2b;[\s\S]*?--mac-composer-control:\s*#fff;/);
  assert.match(stylesSource, /\.mac-desktop-shell :is\(\.composer, \.new-chat-composer\) textarea\s*\{[\s\S]*?min-height:\s*38px;/);
});

test('new chat supporting controls stay below the composer elevation', () => {
  const supportingControls = stylesSource.match(/\.new-chat-agent-chip,\s*\n\.new-chat-project-row\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const supportingHover = stylesSource.match(/\.new-chat-agent-chip:hover,\s*\n\.new-chat-project-row:hover\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const darkSupportingControls = stylesSource.match(/\.mac-desktop-shell\[data-appearance='dark'\] :is\(\.new-chat-agent-chip, \.new-chat-project-row\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(supportingControls, /border:\s*1px solid rgb\(17 24 39 \/ 8%\);/);
  assert.match(supportingControls, /box-shadow:\s*none;/);
  assert.match(supportingHover, /transform:\s*none;/);
  assert.doesNotMatch(supportingHover, /translateY/);
  assert.match(darkSupportingControls, /border-color:\s*var\(--mac-composer-border\);/);
  assert.match(darkSupportingControls, /box-shadow:\s*none;/);
});

test('composer permission tones and model chrome cannot be flattened by generic controls', () => {
  assert.match(mainSource, /return '完全访问';/);
  assert.match(mainSource, /permission-menu-option permission-\$\{mode\}/);
  assert.match(stylesSource, /\.mac-desktop-shell \.permission-select:is\(\.manual, \.smart\)[\s\S]*?var\(--mac-composer-permission-muted\)/);
  assert.match(stylesSource, /\.mac-desktop-shell \.permission-select\.full[\s\S]*?var\(--mac-composer-permission-full\)/);
  assert.match(stylesSource, /\.composer-agent-model \.provider-model-trigger span::after\s*\{\s*color:\s*currentColor;/);
  assert.match(stylesSource, /Keep composer state colors[\s\S]*?\.execution-mode-trigger,[\s\S]*?> svg\s*\{\s*color:\s*currentColor;/);
  assert.match(stylesSource, /Keep composer state colors[\s\S]*?\.provider-model-trigger > svg[\s\S]*?color:\s*var\(--mac-composer-control\)/);
  assert.match(stylesSource, /permission-menu-option\.permission-off[\s\S]*?color:\s*var\(--mac-composer-permission-full/);
});

test('composer attachment and send states match the Codex reference structure', () => {
  assert.match(stylesSource, /\.mac-desktop-shell \.attachment-preview-card\s*\{[\s\S]*?width:\s*80px;[\s\S]*?height:\s*80px;[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.mac-desktop-shell \.attachment-preview-card\.ready > span\s*\{\s*display:\s*none;/);
  assert.match(stylesSource, /\.mac-desktop-shell \.composer-run-button\.is-idle:not\(:disabled\)[\s\S]*?var\(--mac-composer-send-bg\)/);
  assert.match(stylesSource, /\.mac-desktop-shell \.composer-run-button\.is-idle:disabled[\s\S]*?var\(--mac-composer-send-disabled-bg\)/);
});

test('settings dark appearance exposes a complete semantic surface and chart palette', () => {
  for (const token of [
    '--settings-surface-base',
    '--settings-surface-raised',
    '--settings-surface-inset',
    '--settings-field-bg',
    '--settings-hover-bg',
    '--settings-border-weak',
    '--settings-border-strong',
    '--settings-text-primary',
    '--settings-text-secondary',
    '--settings-text-tertiary',
    '--settings-chart-canvas',
    '--settings-chart-grid',
    '--settings-chart-axis',
    '--settings-chart-legend',
    '--settings-chart-cursor',
    '--settings-chart-empty',
    '--settings-heatmap-empty',
  ]) assert.match(settingsSource, new RegExp(`${token}:`));

  assert.match(settingsSource, /\.app\[data-appearance='dark'\]\.settings-mode\s*\{[\s\S]*?--settings-surface-base:\s*rgb\(255 255 255 \/ 3\.5%\);[\s\S]*?--settings-text-primary:\s*#f1f1f1;[\s\S]*?--settings-text-secondary:\s*#a4a4a8;[\s\S]*?--settings-text-tertiary:\s*#74747a;/);
  assert.match(settingsSource, /--settings-main-bg:\s*rgb\(24 24 24 \/ 94%\);/);
});

test('complex settings pages consume settings semantic tokens instead of light-only surfaces', () => {
  assert.match(settingsSource, /\.app\.settings-mode :is\([\s\S]*?\.profile-stat-strip,[\s\S]*?\.platform-card,[\s\S]*?\.usage-summary-card,[\s\S]*?\.monitor-panel[\s\S]*?\)\s*\{[\s\S]*?background:\s*var\(--settings-surface-base\);/);
  assert.match(settingsSource, /\.app\.settings-mode :is\(\.mini-segment, \.module-view-tabs, \.agent-tabs\)\s*\{[\s\S]*?border:\s*1px solid var\(--settings-control-border\);[\s\S]*?background:\s*var\(--settings-field-bg\);[\s\S]*?box-shadow:\s*none;/);
  assert.match(settingsSource, /\.app\.settings-mode :is\(\.mini-segment, \.module-view-tabs, \.agent-tabs\) button\.selected\s*\{[\s\S]*?color:\s*var\(--settings-text-primary\);[\s\S]*?background:\s*var\(--settings-hover-bg\);/);
  assert.match(settingsSource, /\.app\.settings-mode \.token-activity-cell\s*\{[\s\S]*?var\(--settings-heatmap-empty\)/);
  assert.match(settingsSource, /\.app\.settings-mode \.platform-warning\s*\{[\s\S]*?var\(--settings-warning-bg\)/);
  assert.match(settingsSource, /\.app\.settings-mode \.usage-trend-scroll\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?var\(--settings-chart-canvas\)/);
  assert.match(settingsSource, /\.app\.settings-mode :is\(\.modal, \.profile-edit-card\)\s*\{[\s\S]*?background:\s*var\(--settings-main-bg\)/);
  assert.match(mainSource, /CartesianGrid[\s\S]*?stroke="var\(--settings-chart-grid\)"/);
  assert.match(mainSource, /tick=\{\{ fill: 'var\(--settings-chart-axis\)'/);
  assert.match(mainSource, /Legend[\s\S]*?color: 'var\(--settings-chart-legend\)'/);
  assert.match(mainSource, /color: 'var\(--settings-chart-empty\)'/);
});
