import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
const collaborationStoreSource = await readFile(new URL('../web/src/collaboration-store.ts', import.meta.url), 'utf8');
const overlaySource = await readFile(new URL('../web/src/overlay-primitives.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../web/src/settings.css', import.meta.url), 'utf8');
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
  for (const component of ['PermissionModeControl']) {
    const source = mainSource.match(new RegExp(`function ${component}[\\s\\S]*?(?=\\nfunction )`))?.[0] || '';
    assert.match(source, /<AppMenu/);
    assert.match(source, /<AppMenuTrigger asChild>/);
    assert.match(source, /<AppMenuContent/);
    assert.doesNotMatch(source, /document\.addEventListener|handleOptionKeyDown/);
  }
  assert.doesNotMatch(mainSource, /function ExecutionModeControl/);
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

test('Model Center exposes compatibility for every supported Harness', () => {
  const modelCenter = mainSource.match(/function ModelCenter[\s\S]*?(?=\nfunction OAuthAccountsPanel)/)?.[0] || '';
  assert.match(modelCenter, /Promise\.all\(\['hermes', 'pi', 'codex', 'claude'\]/);
  assert.match(modelCenter, /const runtimeCompatibility = \['hermes', 'pi', 'codex', 'claude'\]/);
  assert.match(modelCenter, /Hermes、Pi、Codex 与 Claude 都能使用同一账户/);
});

test('Agent reply avatars own the current-thread model settings entry', () => {
  const messageConfig = mainSource.match(/function MessageAgentSessionConfig[\s\S]*?(?=\nfunction ProviderModelPicker)/)?.[0] || '';
  assert.match(messageConfig, /<AppPopover open=\{open\} onOpenChange=\{onOpenChange\}>/);
  assert.match(messageConfig, /className="message-agent-config-trigger"/);
  assert.match(messageConfig, /当前会话覆盖/);
  assert.doesNotMatch(messageConfig, /Harness 由 Agent Profile 管理/);
  assert.doesNotMatch(messageConfig, /<AgentAvatar agent=\{agent\} size="sm" \/>/);
  assert.match(mainSource, /messageAgentConfigOpenId === message\.id/);
  assert.match(mainSource, /<MessageAgentSessionConfig/);
  assert.doesNotMatch(mainSource, /AgentComposerModelControl/);
  assert.match(stylesSource, /\.message-agent-config-trigger \{[\s\S]*?width: 34px;[\s\S]*?height: 34px;/);
  assert.match(stylesSource, /\.message-agent-config-popover \{/);
});

test('conversation switching keeps the existing shell while loading the next thread', () => {
  const openThread = mainSource.match(/async function openThread\(threadId: string\)[\s\S]*?(?=\n  async function )/)?.[0] || '';
  assert.doesNotMatch(openThread, /setActiveThread\(null\)/);
  assert.match(openThread, /setOpeningThreadId\(threadId\)/);
  assert.match(mainSource, /Boolean\(activeThread\) \|\| Boolean\(openingThreadId\)/);
  assert.match(stylesSource, /\.thread-content:has\(> \.thread-opening-skeleton\) > :not\(\.thread-opening-skeleton\)/);
  assert.match(mainSource, /!openingThreadId && <ThreadOverviewRail/);
  assert.match(mainSource, /className=\{`composer \$\{attachmentDragActive \? 'attachment-drag-active' : ''\}\$\{openingThreadId \? ' thread-opening' : ''\}`\}/);
  assert.match(mainSource, /canSend=\{!openingThreadId && !workflowControlInProgress/);
});

test('pinned rail pages use the shared workspace surface without duplicating macOS chrome', () => {
  assert.match(mainSource, /const workspaceSurfaceNavIds = new Set\(\['inbox', 'kanban'\]\)/);
  assert.match(mainSource, /const isWorkspaceSurfaceNav = workspaceSurfaceNavIds\.has\(activeNav\)/);
  assert.match(mainSource, /const isMacWorkspaceSurfaceShell = isMacConversationShell \|\| \(isMacDesktop && isWorkspaceSurfaceNav\)/);
  assert.match(mainSource, /\$\{isWorkspaceSurfaceNav \? 'workspace-surface-mode' : ''\}/);
  assert.match(mainSource, /activeNav === 'inbox' \? \(\s*<WorkspaceSurface>[\s\S]*?<InboxPage/);
  assert.match(mainSource, /activeNav === 'kanban' \? \(\s*<WorkspaceSurface><CollaborationCenterPage/);
  assert.match(mainSource, /function WorkspaceSurface\([\s\S]*?className="workspace-surface-content"/);
  assert.doesNotMatch(mainSource, /className="management-page collaboration-center-page"/);
  assert.match(mainSource, /\{!isMacWorkspaceSurfaceShell && workbenchLeftActions\}/);
  assert.match(mainSource, /!isMacWorkspaceSurfaceShell && <header className="topbar">/);
  assert.match(mainSource, /!isMacConversationShell && !isWorkspaceSurfaceNav && \(\s*<ResizeHandle/);
  assert.match(settingsSource, /:is\(\.app\.settings-mode, \.app\.workspace-surface-mode\)\s*\{[\s\S]*?--settings-rail-width:\s*212px;[\s\S]*?grid-template-columns:\s*var\(--settings-rail-width\) 0 minmax\(0, 1fr\);[\s\S]*?gap:\s*12px;[\s\S]*?padding:\s*12px;/);
  assert.doesNotMatch(settingsSource, /\.app\.workspace-surface-mode\s*\{[\s\S]*?grid-template-columns:\s*var\(--sidebar-width\)/);
  assert.match(settingsSource, /\.app\.settings-mode > \.resize-handle,\s*\.app\.workspace-surface-mode > \.resize-handle\s*\{\s*display:\s*none;/);
  assert.match(settingsSource, /\.app\.settings-mode > \.main,\s*\.app\.workspace-surface-mode > \.main\s*\{[\s\S]*?border-radius:\s*12px;[\s\S]*?box-shadow:\s*var\(--settings-main-shadow\);/);
  assert.match(settingsSource, /:is\(\.app\.settings-mode > \.settings-rail-sidebar, \.app\.workspace-surface-mode > \.sidebar\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(stylesSource, /\.app:not\(\.settings-mode\):not\(\.workspace-create-mode\):not\(\.workspace-surface-mode\) > \.sidebar\s*\{/);
  assert.match(stylesSource, /\.app:not\(\.workspace-create-mode\):not\(\.workspace-surface-mode\):not\(\.sidebar-collapsed\) > \.sidebar\s*\{/);
  assert.match(settingsSource, /\.workspace-surface-content\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?mask-image:/);
  assert.match(settingsSource, /\.mac-desktop-shell\.workspace-surface-mode \.workspace-surface-content\s*\{\s*padding-top:\s*calc\(var\(--scroll-boundary-fade-size\) \+ 50px\);/);
  assert.match(settingsSource, /\.app\.workspace-surface-mode \.inbox-page\s*\{[\s\S]*?padding:\s*0 0 24px;/);
  assert.match(settingsSource, /\.app\.workspace-surface-mode \.collaboration-center-page\s*\{[\s\S]*?overflow:\s*visible;/);
  assert.match(settingsSource, /\.app\[data-appearance='dark'\]\.workspace-surface-mode/);
});

test('conversation and floating surfaces share one bounded geometry transition', () => {
  assert.match(mainSource, /const \[shellSurfaceTransitioning, setShellSurfaceTransitioning\] = useState\(false\)/);
  assert.match(mainSource, /function beginShellSurfaceTransition\(nextNav: string, nextView: 'thread' \| 'new-chat', forcedKind\?: 'conversation' \| 'floating'\)/);
  assert.match(mainSource, /async function openThread\(threadId: string\)\s*\{\s*beginShellSurfaceTransition\('council', 'thread', 'conversation'\);/);
  assert.match(mainSource, /currentShellSurfaceKind === nextKind/);
  assert.match(mainSource, /prefers-reduced-motion: reduce/);
  assert.match(mainSource, /max-width: 760px/);
  assert.match(mainSource, /shellSurfaceTransitioning \? 'shell-surface-transitioning' : ''/);
  assert.match(mainSource, /onTransitionEnd=\{handleShellSurfaceTransitionEnd\}/);
  assert.match(mainSource, /event\.propertyName !== 'padding-top'/);
  assert.match(settingsSource, /@media \(prefers-reduced-motion: no-preference\) and \(min-width: 761px\)[\s\S]*?\.mac-desktop-shell\.shell-surface-transitioning\s*\{[\s\S]*?padding-top \.36s cubic-bezier\(\.2, \.8, \.2, 1\);[\s\S]*?\.mac-desktop-shell\.shell-surface-transitioning > \.main\s*\{[\s\S]*?height \.36s cubic-bezier\(\.2, \.8, \.2, 1\);/);
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

test('composer collaboration is an explicit draft intent with a slash shortcut', () => {
  const control = mainSource.match(/function CollaborationIntentControl[\s\S]*?(?=\nfunction )/)?.[0] || '';
  const textarea = mainSource.match(/function MentionTextarea[\s\S]*?(?=\nfunction )/)?.[0] || '';
  assert.match(control, /aria-pressed=\{active\}/);
  assert.match(control, />协作</);
  assert.match(textarea, /\/collab/);
  assert.match(textarea, /onCollaborationChange\(true\)/);
  assert.match(mainSource, /messageIntent: collaborationEnabled \? 'collaboration' : 'chat'/);
  assert.match(mainSource, /setNewChatCollaborationEnabled\(enabled\); if \(enabled\) setNewChatPlanEnabled\(false\)/);
  assert.match(mainSource, /setNewChatPlanEnabled\(true\); setNewChatCollaborationEnabled\(false\)/);
  assert.doesNotMatch(mainSource, /postApprovalIntent|withPlanHandoff/);
  assert.match(mainSource, /collaborationIntentEnabled && !activeWorkflowRunning/);
  assert.match(mainSource, /发送内容将作为当前任务引导/);
  assert.match(mainSource, /const activeCollaborationProposal = activeProposal\?\.purpose === 'collaboration'/);
  assert.match(mainSource, /if \(!activeThread \|\| !activeProposal \|\| planAction\) return;/);
  assert.match(mainSource, /plans\/\$\{activeProposal\.id\}\/questions/);
  assert.match(stylesSource, /\.composer-collaboration-toggle\.active/);
  assert.match(stylesSource, /\.composer-intent-tray/);
});

test('inline collaboration keeps live progress without the right rail mounted', () => {
  const inlineBlock = mainSource.match(/function InlineCollaborationBlock[\s\S]*?(?=\nfunction ChatCollaborationEvents)/)?.[0] || '';
  const taskSession = mainSource.match(/function CollaborationTaskSessionPanel[\s\S]*?(?=\nfunction InlineCollaborationBlock)/)?.[0] || '';
  assert.match(inlineBlock, /useThreadCollaboration<CollaborationSnapshot>\(thread\?\.id\)/);
  assert.match(collaborationStoreSource, /const entries = new Map<string, Entry>\(\)/);
  assert.match(collaborationStoreSource, /new EventSource\(`\/api\/threads\/\$\{encodeURIComponent\(entry\.threadId\)\}\/collaboration\/events\?afterCursor=\$\{cursor\}`\)/);
  assert.match(collaborationStoreSource, /source\.addEventListener\('collaboration\.snapshot'/);
  assert.match(inlineBlock, /frakio:collaboration-snapshot/);
  assert.match(collaborationStoreSource, /frakio:thread-refresh-request/);
  assert.match(collaborationStoreSource, /nextCursor < previousCursor/);
  assert.match(inlineBlock, /状态待同步/);
  assert.match(collaborationStoreSource, /source\.close\(\)/);
  assert.match(collaborationStoreSource, /entry\.listeners\.add\(listener\)/);
  assert.match(collaborationStoreSource, /entry\.listeners\.delete\(listener\)/);
  assert.match(inlineBlock, /workflowSignature/);
  assert.match(inlineBlock, /dismissedStickySignature/);
  assert.match(inlineBlock, /new IntersectionObserver/);
  assert.match(inlineBlock, /\{ root, threshold: 0\.02 \}/);
  assert.match(inlineBlock, /observer\.observe\(node\)/);
  assert.match(inlineBlock, /observer\.disconnect\(\)/);
  assert.match(inlineBlock, /frakio:open-collaboration-task/);
  assert.match(inlineBlock, /关闭协作任务条/);
  assert.doesNotMatch(inlineBlock, /some\(\(workflow\) => workflow\.status === 'active'\)/);
  assert.match(taskSession, /\/api\/workflows\/\$\{encodeURIComponent\(workflow\.id\)\}\/tasks\/\$\{encodeURIComponent\(task\.id\)\}/);
  assert.match(taskSession, /new EventSource\(`\/api\/runtime-runs\/\$\{latestRun\.id\}\/events\?cursor=\$\{cursor\}`\)/);
  assert.match(taskSession, /nearBottom = node\.scrollHeight - node\.scrollTop - node\.clientHeight < 72/);
  assert.match(taskSession, /className="collaboration-agent-panel"/);
  assert.match(taskSession, /className="collaboration-session-back" onClick=\{onBack\}/);
  assert.match(taskSession, /<RunTranscriptContent/);
  assert.match(taskSession, /presentation\?\.approval/);
  assert.match(taskSession, /detail\.parents/);
  assert.match(taskSession, /detail\?\.artifacts/);
  assert.match(taskSession, /查看新内容/);
  assert.match(stylesSource, /\.collaboration-agent-modal \{[^}]*height:\s*min\(780px, calc\(100vh - 32px\)\)/);
  assert.match(stylesSource, /\.collaboration-agent-stream \{[^}]*overscroll-behavior:\s*contain/);
  assert.doesNotMatch(mainSource, /nextCursor !== cursorRef\.current \+ 1/);
  assert.match(collaborationStoreSource, /const previousCursor = Math\.max\(0, Number\(entry\.state\.snapshot\?\.cursor \|\| 0\)\)/);
  assert.match(mainSource, /状态待同步，正在读取最新状态/);
  assert.match(stylesSource, /\.collaboration-sync-pending/);
});

test('right rail only labels unresolved dependencies as waiting', () => {
  assert.match(mainSource, /const taskStatusById = new Map\(activeTasks\.map\(\(task\) => \[task\.id, task\.status\]\)\)/);
  assert.match(mainSource, /filter\(\(\[, parentTaskId\]\) => Boolean\(parentTaskId\) && !\['done', 'completed'\]\.includes\(taskStatusById\.get\(String\(parentTaskId\)\) \|\| ''\)\)\)/);
  assert.match(mainSource, /dependencyByTask\.has\(task\.id\)/);
});
