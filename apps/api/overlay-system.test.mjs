import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
const overlaySource = await readFile(new URL('../web/src/overlay-primitives.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const packageSource = JSON.parse(await readFile(new URL('../web/package.json', import.meta.url), 'utf8'));

test('web package exposes the shared Radix overlay primitives', () => {
  for (const dependency of [
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-context-menu',
    '@radix-ui/react-popover',
    '@radix-ui/react-dialog',
    '@radix-ui/react-alert-dialog',
  ]) assert.ok(packageSource.dependencies[dependency], `${dependency} is required`);
  for (const component of ['AppMenu', 'AppContextMenu', 'AppPopover', 'AppDialog', 'AppAlertDialog']) {
    assert.match(overlaySource, new RegExp(`export const ${component}`));
  }
  assert.match(overlaySource, /collisionPadding = 8/);
});

test('rail menus and confirmations use the unified semantic surfaces', () => {
  assert.match(mainSource, /function RailContextMenu[\s\S]*?<AppMenuContent/);
  assert.match(mainSource, /<AppMenuSeparator/);
  assert.match(mainSource, /variant="destructive"[\s\S]*?<Trash2/);
  assert.match(mainSource, /function RailConfirmDialog[\s\S]*?<AppAlertDialogContent/);
  assert.match(mainSource, /<AppAlertDialogCancel className="cancel" autoFocus/);
  assert.doesNotMatch(mainSource, /type RailConfirm[^\n]*\bx:\s*number|type RailConfirm[^\n]*\by:\s*number/);
  assert.doesNotMatch(stylesSource, /\.rail-context-menu\s*\{/);
  assert.doesNotMatch(stylesSource, /\.rail-confirm-popover\s*\{/);
});

test('high-frequency menus use stable interaction primitives', () => {
  for (const component of ['PermissionModeControl', 'ExecutionModeControl']) {
    const source = mainSource.match(new RegExp(`function ${component}[\\s\\S]*?(?=\\nfunction )`))?.[0] || '';
    assert.match(source, /<AppMenu/);
    assert.match(source, /<AppMenuTrigger asChild>/);
    assert.match(source, /<AppMenuContent/);
    assert.doesNotMatch(source, /document\.addEventListener|handleOptionKeyDown/);
  }
  assert.match(mainSource, /className="new-chat-agent-menu-v2"/);
  assert.match(mainSource, /className="project-picker-menu-v2"/);
  assert.match(mainSource, /className="board-popover-v2"/);
  const modelPicker = mainSource.match(/function ProviderModelPicker[\s\S]*?(?=\nfunction )/)?.[0] || '';
  assert.doesNotMatch(modelPicker, /<AppMenu(?:Sub|Content|Trigger)/);
  assert.match(modelPicker, /const rootPanel = advanced \? \(/);
  assert.match(modelPicker, /section === 'model' && modelPanel/);
  assert.match(modelPicker, /section === 'reasoning' && reasoningPanel/);
  assert.match(modelPicker, /section === 'speed' && speedPanel/);
  assert.match(modelPicker, /async function commitChoice/);
  assert.match(modelPicker, /disabled=\{saving\}/);
  assert.match(mainSource, /const rootPanelWidth = 232;/);
  assert.match(stylesSource, /\.provider-model-menu\.advanced \.provider-model-subpanel \{[\s\S]*?position: absolute;/);
  assert.match(stylesSource, /\.provider-model-menu\.advanced\.submenu-left \.provider-model-subpanel/);
  assert.match(stylesSource, /\.provider-model-root-panel \{ width: 232px; \}/);
  assert.match(stylesSource, /body:has\(\.mac-desktop-shell\) \.provider-model-menu\.advanced\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(stylesSource, /body:has\(\.mac-desktop-shell\) \.provider-model-menu\.advanced :is\(\.provider-model-root-panel, \.provider-model-subpanel\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*var\(--overlay-surface-solid\);[\s\S]*?box-shadow:\s*var\(--overlay-shadow\);/);
});

test('profile editor owns its scroll, focus, and unsaved-change boundary', () => {
  const profilePanel = mainSource.match(/function UserProfilePanel[\s\S]*?(?=\nfunction ProfileInsightPanel)/)?.[0] || '';
  const profileForm = mainSource.match(/function UserProfileForm[\s\S]*?(?=\nfunction AvatarCropModal)/)?.[0] || '';
  assert.match(profilePanel, /settingsContent\.style\.overflow = 'hidden'/);
  assert.match(profilePanel, /settingsContent\.scrollTop = scrollTop/);
  assert.match(profilePanel, /editTriggerRef\.current\?\.focus\(\)/);
  assert.match(profileForm, /data-profile-autofocus/);
  assert.match(profileForm, /event\.key === 'Escape'/);
  assert.match(profileForm, /放弃未保存的修改？/);
  assert.match(profileForm, /role=\{compact \? 'dialog'/);
  assert.match(stylesSource, /\.user-profile-form\.compact\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/);
  assert.match(stylesSource, /\.user-profile-edit-body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(stylesSource, /\.user-profile-form\.compact \.modal-actions\s*\{[\s\S]*?border-top:/);
});

test('macOS overlay tokens remain neutral and motion-aware', () => {
  assert.match(stylesSource, /body:has\(\.mac-desktop-shell\)\s*\{[\s\S]*?--mac-popover-surface:\s*rgb\(248 248 248 \/ 76%\);[\s\S]*?--overlay-backdrop:[\s\S]*?--overlay-z-dialog:/);
  assert.match(stylesSource, /body:has\(\.mac-desktop-shell\[data-appearance='dark'\]\)\s*\{[\s\S]*?--mac-popover-surface:\s*rgb\(30 30 30 \/ 78%\);/);
  assert.match(stylesSource, /\.app-overlay-surface\s*\{[\s\S]*?background:\s*var\(--mac-popover-surface,[\s\S]*?blur\(20px\) saturate\(1\.16\)/);
  assert.match(stylesSource, /\.app-menu-surface\s*\{[\s\S]*?border-radius:\s*10px/);
  assert.match(stylesSource, /\.app-popover-surface\s*\{[\s\S]*?border-radius:\s*12px/);
  assert.match(stylesSource, /\.app-dialog-surface\s*\{[\s\S]*?border-radius:\s*14px/);
  assert.match(stylesSource, /@keyframes app-overlay-enter/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-menu-surface[\s\S]*?animation:\s*none !important/);
  assert.match(stylesSource, /\.mac-desktop-shell \.modal-backdrop[\s\S]*?background:\s*var\(--overlay-backdrop\)/);
});

test('macOS elevation layers use separate restrained edge systems', () => {
  assert.match(stylesSource, /\.mac-desktop-shell\s*\{[\s\S]*?--mac-panel-outline:\s*rgb\(17 24 39 \/ 6%\);[\s\S]*?0 18px 44px -22px rgb\(15 23 42 \/ 18%\);/);
  assert.match(stylesSource, /\.mac-desktop-shell\[data-appearance='dark'\]\s*\{[\s\S]*?--mac-panel-outline:\s*rgb\(255 255 255 \/ 7%\);[\s\S]*?0 22px 52px -28px rgb\(0 0 0 \/ 50%\);/);
  assert.match(stylesSource, /\.desktop-shell\.mac-conversation-shell > \.main,[\s\S]*?box-shadow:\s*var\(--mac-panel-shadow\);/);

  const overlaySurface = stylesSource.match(/\.app-overlay-surface\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(overlaySurface, /border:\s*0;/);
  assert.match(overlaySurface, /box-shadow:\s*var\(--overlay-shadow/);
  assert.doesNotMatch(overlaySurface, /inset|1px solid/);

  const dialogSurface = stylesSource.match(/\.app-dialog-surface\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(dialogSurface, /box-shadow:\s*var\(--overlay-dialog-shadow\);/);
  assert.match(stylesSource, /\.mac-desktop-shell \.modal,[\s\S]*?box-shadow:\s*var\(--overlay-dialog-shadow\);/);
  assert.match(stylesSource, /body:has\(\.mac-desktop-shell\) :is\(\.provider-model-root-panel, \.provider-model-subpanel\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*var\(--overlay-shadow\);/);
});

test('composer add menu and rename dialog keep the restrained one-line hierarchy', () => {
  const composerMenu = mainSource.match(/function ComposerAddMenu[\s\S]*?(?=\nfunction )/)?.[0] || '';
  assert.match(composerMenu, />添加文件</);
  assert.match(composerMenu, /计划模式已开启/);
  assert.doesNotMatch(composerMenu, /<small>|AppMenuSeparator/);
  assert.match(stylesSource, /\.composer-add-menu\s*\{[\s\S]*?196px/);
  assert.match(stylesSource, /\.composer-add-option\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?font-size:\s*13px;/);

  const renameDialog = mainSource.match(/function RenameDialog[\s\S]*?(?=\nfunction )/)?.[0] || '';
  assert.match(renameDialog, /自动生成标题/);
  assert.match(renameDialog, /className="rename-dialog-head"/);
  assert.doesNotMatch(renameDialog, /className="modal-head"/);
  assert.match(stylesSource, /\.rename-dialog\s*\{[\s\S]*?380px/);
});
