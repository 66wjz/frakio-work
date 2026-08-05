import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../web/src/settings.css', import.meta.url), 'utf8');

test('macOS conversation title lives in a fixed panel header below the window toolbar', () => {
  const toolbar = mainSource.match(/<header[\s\S]*?mac-global-window-toolbar[\s\S]*?<\/header>/)?.[0] || '';
  assert.match(mainSource, /\{isMacDesktop && \(/);
  assert.match(toolbar, /mac-window-drag-region/);
  assert.doesNotMatch(toolbar, /activeThread\.title|ThreadActionsMenu|MoreHorizontal/);
  assert.doesNotMatch(mainSource, /mac-window-conversation-title|mac-window-thread-actions/);
  assert.match(mainSource, /<header className="conversation-panel-header">[\s\S]*?<ThreadActionsMenu[\s\S]*?triggerVariant="title"[\s\S]*?triggerTitle=\{activeThread\.title\}/);
  assert.match(mainSource, /activeThread\.title\.trim\(\) !== '新对话'/);
  assert.match(mainSource, /<h1>\{triggerTitle\}<\/h1><ChevronDown size=\{14\}/);
  assert.match(stylesSource, /\.desktop-shell\.mac-conversation-shell > \.main \.council\s*\{[\s\S]*?grid-template-rows:\s*42px minmax\(0, 1fr\) auto;/);
  assert.match(stylesSource, /\.conversation-panel-header\s*\{[\s\S]*?justify-content:\s*center;/);
  assert.match(stylesSource, /\.conversation-title-trigger h1\s*\{[\s\S]*?text-overflow:\s*ellipsis;/);
});

test('title trigger is the sole macOS conversation settings entry and anchors its menu centrally', () => {
  assert.match(mainSource, /triggerVariant === 'title'[\s\S]*?<h1>\{triggerTitle\}<\/h1>/);
  assert.match(mainSource, /aria-expanded=\{open\}[\s\S]*?aria-controls=\{open \? popoverId : undefined\}[\s\S]*?aria-haspopup="dialog"/);
  assert.match(mainSource, /<AppPopover[\s\S]*?<AppPopoverContent[\s\S]*?align=\{triggerVariant === 'title' \? 'center' : 'end'\}/);
  assert.doesNotMatch(mainSource, /rect\.left \+ rect\.width \/ 2 - width \/ 2/);
  assert.match(stylesSource, /\.mac-window-drag-region\s*\{[\s\S]*?right:\s*var\(--mac-window-chrome-right-safe-area\);/);
});

test('macOS window chrome remains available above launch and settings content', () => {
  assert.match(mainSource, /\{isMacDesktop && \([\s\S]*?mac-global-window-toolbar[\s\S]*?\{!cleanShell && !isSettingsNav/);
  assert.match(stylesSource, /\.mac-global-window-toolbar\.is-launching\s*\{[\s\S]*?z-index:\s*140;/);
  assert.match(stylesSource, /\.mac-global-window-toolbar\.is-settings\s*\{[\s\S]*?--mac-window-chrome-left-safe-area:\s*230px;/);
  assert.doesNotMatch(stylesSource, /\.desktop-shell\.new-chat-mode:not\(\.settings-mode\)::before/);
  assert.match(settingsSource, /\.mac-desktop-shell\.settings-mode \.settings-content\s*\{[\s\S]*?padding-top:\s*calc\(var\(--scroll-boundary-fade-size\) \+ 50px\);/);
});

test('Web workbench keeps navigation controls without rendering native window chrome', () => {
  assert.match(mainSource, /const workbenchLeftActions = \([\s\S]*?aria-label="新对话"/);
  assert.match(mainSource, /\{!isDesktopShell && !isSettingsNav && workbenchLeftActions\}/);
  assert.match(mainSource, /\{!isDesktopShell && !isSettingsNav && rightRailKind && \(/);
  assert.match(stylesSource, /\.managed-web-shell \.workbench-window-controls\s*\{[\s\S]*?top:\s*11px;[\s\S]*?left:\s*16px;/);
  assert.match(stylesSource, /\.managed-web-shell \.mac-window-toolbar,[\s\S]*?display:\s*none !important;/);
});

test('macOS message viewport fades its own pixels instead of covering them with a bright layer', () => {
  assert.doesNotMatch(mainSource, /thread-boundary-fade/);
  assert.doesNotMatch(stylesSource, /\.thread-boundary-fade/);
  assert.match(stylesSource, /\.desktop-shell\.mac-conversation-shell > \.main \.thread\s*\{[\s\S]*?mask-image:\s*linear-gradient\(to bottom, transparent 0, #000 32px, #000 calc\(100% - 32px\), transparent 100%\);/);
  assert.match(stylesSource, /\.desktop-shell\.mac-conversation-shell > \.main \.thread\s*\{[\s\S]*?padding-bottom:\s*64px;/);
});

test('user message bubbles keep the avatar top-aligned and render one continuous tail', () => {
  assert.match(stylesSource, /\.message\.user\s*\{[\s\S]*?align-items:\s*start;/);
  assert.match(stylesSource, /\.message\.user \.message-body::after\s*\{[\s\S]*?top:\s*11px;[\s\S]*?right:\s*-9px;[\s\S]*?width:\s*10px;[\s\S]*?height:\s*12px;[\s\S]*?clip-path:\s*polygon\(0 0, 100% 50%, 0 100%\);/);
  assert.match(stylesSource, /\[data-appearance='light'\] \.message\.user \.message-body,[\s\S]*?--user-message-bubble:\s*#fff;[\s\S]*?background:\s*var\(--user-message-bubble\);/);
  assert.match(stylesSource, /\[data-appearance='dark'\] \.message\.user \.message-body,[\s\S]*?--user-message-bubble:\s*#343434;[\s\S]*?background:\s*var\(--user-message-bubble\);/);
  assert.match(stylesSource, /\[data-appearance='dark'\] \.message\.user \.message-body::after\s*\{[\s\S]*?background:\s*var\(--user-message-bubble\);[\s\S]*?box-shadow:\s*none;/);
  assert.match(mainSource, /<div className="message-body">[\s\S]*?\{message\.agentId === 'user' && <MessageAvatar/);
});

test('scrolling rails and settings content share alpha boundary masks without overlay elements', () => {
  assert.doesNotMatch(mainSource, /(?:sidebar|settings)-(?:boundary-)?fade/);
  assert.doesNotMatch(stylesSource, /\.(?:sidebar|settings)-(?:boundary-)?fade/);
  assert.doesNotMatch(settingsSource, /\.(?:sidebar|settings)-(?:boundary-)?fade/);
  assert.match(stylesSource, /--scroll-boundary-fade-compact:\s*20px;/);
  assert.match(stylesSource, /--scroll-boundary-fade-content:\s*32px;/);
  assert.match(stylesSource, /\.sidebar-scroll\s*\{[\s\S]*?--scroll-boundary-fade-size:\s*var\(--scroll-boundary-fade-compact\);[\s\S]*?mask-image:\s*linear-gradient\([\s\S]*?transparent 0,[\s\S]*?#000 var\(--scroll-boundary-fade-size\),[\s\S]*?#000 calc\(100% - var\(--scroll-boundary-fade-size\)\),[\s\S]*?transparent 100%[\s\S]*?\);[\s\S]*?-webkit-mask-image:\s*linear-gradient\(/);
  assert.match(settingsSource, /\.app\.settings-mode \.settings-nav\s*\{[\s\S]*?--scroll-boundary-fade-size:\s*var\(--scroll-boundary-fade-compact\);[\s\S]*?overflow:\s*auto;[\s\S]*?mask-image:\s*linear-gradient\([\s\S]*?-webkit-mask-image:\s*linear-gradient\(/);
  assert.match(settingsSource, /\.app\.settings-mode \.settings-content\s*\{[\s\S]*?--scroll-boundary-fade-size:\s*var\(--scroll-boundary-fade-content\);[\s\S]*?mask-image:\s*linear-gradient\([\s\S]*?-webkit-mask-image:\s*linear-gradient\(/);
  assert.match(settingsSource, /@media \(max-width:\s*760px\)[\s\S]*?\.settings-rail-body\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?\.app\.settings-mode \.settings-nav\s*\{[\s\S]*?overflow:\s*auto;/);
});

test('live Agent replies enter as one subtle block without replaying on history messages', () => {
  assert.match(mainSource, /<article className="message run-status-message incoming-agent-message"/);
  assert.equal(mainSource.match(/incoming-agent-message/g)?.length, 1);
  assert.match(stylesSource, /\.incoming-agent-message\s*\{[\s\S]*?animation:\s*agent-message-enter \.18s cubic-bezier\(\.2, \.8, \.2, 1\) both;/);
  assert.match(stylesSource, /@keyframes agent-message-enter\s*\{[\s\S]*?opacity:\s*0; transform:\s*translateY\(6px\);[\s\S]*?opacity:\s*1; transform:\s*translateY\(0\);/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.incoming-agent-message\s*\{\s*animation:\s*none;\s*\}/);
});

test('live Agent text uses a grapheme reveal tail instead of replaying the whole markdown block', () => {
  assert.doesNotMatch(stylesSource, /\.streaming-text\s*\{/);
  assert.doesNotMatch(mainSource, /animatedMessageContent|streamingMessageIds|revealThreadMessages/);
  assert.match(mainSource, /function useStreamRevealFrame\(/);
  assert.match(mainSource, /streamReveal=\{reduceMotion \? undefined : revealFrame\}/);
  assert.match(mainSource, /streamingResponses=\{uiSettings\.streamingResponses !== false\}/);
  assert.match(mainSource, /const visibleDraft = streamingResponses \? revealFrame\.displayedContent : '';/);
  assert.match(stylesSource, /\.stream-reveal-tail\s*\{\s*display:\s*inline;/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stream-reveal-tail\s*\{[\s\S]*?opacity:\s*1 !important;[\s\S]*?filter:\s*none !important;/);
});

test('thinking presence stays in the reply slot until the first buffered body is visible', () => {
  assert.match(mainSource, /const waitingForFirstVisibleDraft = streamingResponses[\s\S]*?Boolean\(draft\)[\s\S]*?!hasVisibleDraft[\s\S]*?presentationPhase === 'responding'[\s\S]*?presentationPhase === 'finished'\);/);
  assert.match(mainSource, /const exitingInitialPresence = useReplyPresenceHandoff\(hasVisibleDraft, reduceMotion\);/);
  assert.match(mainSource, /className=\{`run-reply-transition-slot \$\{hasVisibleDraft \? 'has-visible-draft' : ''\}`\}/);
  assert.match(stylesSource, /\.run-reply-transition-slot\s*\{[\s\S]*?position:\s*relative;[\s\S]*?min-height:\s*32px;/);
  assert.match(stylesSource, /\.run-reply-transition-slot > \.processing-presence\.is-exiting\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?animation:\s*processing-presence-exit \.11s/);
});

test('completed replies are handed to history before a subsequent Agent state is displayed', () => {
  assert.match(mainSource, /let pendingHandoff: Thread \| null = null;/);
  assert.match(mainSource, /const bufferedTurnEvents: any\[\] = \[\];/);
  assert.match(mainSource, /const scheduleHandoff = \(nextThread: Thread\) => \{/);
  assert.match(mainSource, /hideStatus:\s*true,/);
  assert.match(mainSource, /if \(pendingHandoff\) \{\s*bufferedTurnEvents\.push\(data\);/);
  assert.doesNotMatch(mainSource, /commitCompletedAgent/);
});

test('tool activity summary is flat until hover, keyboard focus or expansion', () => {
  assert.match(stylesSource, /\.run-activity-summary\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(stylesSource, /\.run-activity-summary:is\(:hover, :focus-visible, \[aria-expanded='true'\]\)\s*\{[\s\S]*?background:\s*color-mix\([\s\S]*?box-shadow:\s*inset/);
  assert.match(stylesSource, /\.mac-desktop-shell \.run-activity-summary\s*\{[\s\S]*?border-color:\s*transparent;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(stylesSource, /\.run-activity-count\s*\{[\s\S]*?box-shadow:\s*inset[^;]+;[\s\S]*?font-size:\s*10px;/);
  assert.doesNotMatch(stylesSource.match(/\.run-activity-count\s*\{([\s\S]*?)\}/)?.[1] || '', /,\s*0 1px/);
});
