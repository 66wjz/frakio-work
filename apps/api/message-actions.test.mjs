import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');

test('jump-to-latest is a 32px icon-only button', () => {
  const button = mainSource.match(/<button\s+className=\{isRunning \? 'thread-jump-latest is-running'[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(button, /aria-label="回到最新消息"/);
  assert.match(button, /<ArrowDownToLine size=\{16\}/);
  assert.doesNotMatch(button, /<span>|回到最新<\/span>|thread-jump-latest-dot/);
  assert.match(stylesSource, /\.thread-jump-latest\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?padding:\s*0;/);
});

test('persisted Agent replies expose copy feedback branch and durable duration actions', () => {
  assert.match(mainSource, /const showMessageActions = message\.agentId !== 'user'[\s\S]*?!message\.id\.startsWith\('local-'\)[\s\S]*?transcript\?\.status !== 'running'/);
  assert.match(mainSource, /<MessageActions[\s\S]*?onCopy=\{\(\) => void copyAgentMessage\(message\)\}[\s\S]*?onFeedback=\{\(value\) => void updateMessageFeedback\(message, value\)\}[\s\S]*?onBranch=\{\(\) => void branchFromMessage\(message\)\}/);
  const actions = mainSource.match(/function MessageActions[\s\S]*?(?=\nfunction AgentEditorModal)/)?.[0] || '';
  assert.match(actions, /ariaLabel=\{copied \? '已复制回复' : '复制回复'\}[\s\S]*?tooltip=\{copied \? '已复制' : '复制'\}/);
  assert.match(actions, /ariaLabel=\{message\.feedback === 'up' \? '取消喜欢' : '喜欢'\}[\s\S]*?aria-pressed=\{message\.feedback === 'up'\}/);
  assert.match(actions, /ariaLabel=\{message\.feedback === 'down' \? '取消不喜欢' : '不喜欢'\}[\s\S]*?aria-pressed=\{message\.feedback === 'down'\}/);
  assert.match(actions, /ariaLabel="在新对话中继续"[\s\S]*?tooltip=\{branching \? '正在创建新对话' : '在新对话中继续'\}/);
  assert.equal((actions.match(/hoverDelayMs=\{180\}/g) || []).length, 4);
  assert.equal((actions.match(/placement="top"/g) || []).length, 4);
  assert.doesNotMatch(actions, /\btitle=/);
  assert.match(actions, /已处理 \{formatDuration\(duration \/ 1000\)\}/);
  assert.match(stylesSource, /\.message-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(stylesSource, /\.message-actions button:focus-visible\s*\{/);
});

test('message action tooltips use the shared portal with delayed hover and immediate keyboard focus', () => {
  const tooltipButton = mainSource.match(/function IconTooltipButton[\s\S]*?(?=\nfunction CollaborationRuntimeErrorCard)/)?.[0] || '';
  assert.match(tooltipButton, /window\.setTimeout\([\s\S]*?hoverDelayMs/);
  assert.match(tooltipButton, /onFocus=\{updateTooltipPosition\}/);
  assert.match(tooltipButton, /onMouseEnter=\{showTooltipAfterDelay\}/);
  assert.match(tooltipButton, /onMouseLeave=\{hideTooltip\}/);
  assert.match(tooltipButton, /window\.addEventListener\('scroll', hideTooltip, true\)/);
  assert.match(tooltipButton, /aria-describedby=\{tooltipPosition \? tooltipId : undefined\}/);
  assert.match(tooltipButton, /createPortal\([\s\S]*?role="tooltip"/);
  assert.match(tooltipButton, /window\.innerWidth - 12 - halfWidth/);
  assert.match(stylesSource, /\.icon-tooltip\.placement-top\s*\{\s*transform:\s*translate\(-50%, -100%\);/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.icon-tooltip\s*\{\s*animation:\s*none;/);
});

test('completed divider is removed and duration is persisted when an Agent message lands', () => {
  assert.doesNotMatch(mainSource, /CompletedRunStatus|run-complete-summary|completedSummary/);
  assert.doesNotMatch(stylesSource, /run-complete-summary/);
  assert.match(serverSource, /processingDurationMs = Number\.isFinite\(runStartedAtMs\)/);
  assert.match(serverSource, /agentEvent\(agent, finalOutput,[\s\S]*?\.\.\.\(processingDurationMs \? \{ processingDurationMs \} : \{\}\)/);
});

test('new threads stay empty and legacy synthetic intros remain outside visible and runtime history', () => {
  assert.match(serverSource, /function createThreadRecord[\s\S]*?messages:\s*\[\]/);
  assert.doesNotMatch(serverSource, /\bintro:/);
  assert.match(mainSource, /已开启临时对话/);
  assert.match(serverSource, /function isSyntheticThreadIntroMessage[\s\S]*?已开启临时对话/);
  assert.match(serverSource, /function threadHistoryForHermes[\s\S]*?!isSyntheticThreadIntroMessage\(message\)/);
  assert.match(serverSource, /sourceThread\.messages\.slice\(0, targetIndex \+ 1\)\.filter\(\(message\) => !isSyntheticThreadIntroMessage\(message\)\)/);
});
