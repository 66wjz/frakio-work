import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');

test('approval, clarification, and Plan questions share the compact decision tray', () => {
  for (const component of ['DecisionTray', 'DecisionOptionRow', 'DecisionPager', 'DecisionOtherRow']) {
    assert.match(mainSource, new RegExp(`function ${component}\\(`));
  }
  assert.match(mainSource, /className="plan-question-panel"[\s\S]*?<DecisionPager/);
  assert.match(mainSource, /className=\{`run-decision-panel \$\{isClarification/);
  assert.match(mainSource, /recommended=\{option\.recommended\}/);
  assert.match(mainSource, /footer=\{<button type="button" className="decision-skip"/);
});

test('permission approval only renders the four compact decisions', () => {
  const panel = mainSource.match(/function RunDecisionPanel[\s\S]*?(?=\nfunction MessageActions)/)?.[0] || '';
  for (const label of ['允许一次', '本会话允许', '始终允许', '拒绝']) assert.match(panel, new RegExp(label));
  assert.doesNotMatch(panel, /approval\?\.(?:title|command|cwd|tool)|run-decision-command|此操作需要你的允许|请选择本次操作的允许范围/);
  assert.doesNotMatch(panel, /recommended=/);
  assert.match(panel, /onInterrupt/);
  assert.match(panel, /approval\?\.smartDenied/);
  assert.match(panel, /\['once', 'deny'\]/);
  assert.match(panel, /approval\?\.allowPermanent !== false/);
});

test('decision tray consumes the composer material and stays compact', () => {
  const tray = stylesSource.match(/\.decision-tray\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(tray, /max-width:\s*820px/);
  assert.match(tray, /border:\s*1px solid var\(--mac-composer-border/);
  assert.match(tray, /background:\s*var\(--mac-composer-surface/);
  assert.match(tray, /box-shadow:\s*var\(--mac-composer-shadow/);
  assert.match(stylesSource, /\.decision-option-row\s*\{[\s\S]*?min-height:\s*42px/);
  assert.match(stylesSource, /\.decision-option-copy\s*\{\s*display:\s*flex/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.decision-tray\s*\{\s*animation:\s*none;/);
  assert.doesNotMatch(stylesSource, /\.run-decision-command|\.run-decision-option|\.plan-question-options|\.plan-other-answer/);
});

test('Plan question close has a batch-only cancel endpoint', () => {
  assert.match(mainSource, /plans\/\$\{activeProposal\.id\}\/questions\/\$\{batch\.id\}\/cancel/);
  assert.match(serverSource, /plans\/:planId\/questions\/:requestId\/cancel/);
  assert.match(serverSource, /cancelPlanQuestionBatch\(plan, req\.params\.requestId/);
});
