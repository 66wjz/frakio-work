import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = new URL('../web/src/main.tsx', import.meta.url);
const stylesPath = new URL('../web/src/styles.css', import.meta.url);

test('Provider editor exposes only the supported user-facing protocols', async () => {
  const source = await readFile(sourcePath, 'utf8');
  const editor = source.slice(source.indexOf('function ModelEditorModal'), source.indexOf('function ProviderPresetCombobox'));
  assert.match(editor, /自动适配（推荐）/);
  assert.match(editor, /OpenAI Chat Completions/);
  assert.match(editor, /OpenAI Responses/);
  assert.match(editor, /Anthropic Messages/);
  assert.doesNotMatch(editor, /OpenAI Codex Responses/);
  assert.doesNotMatch(editor, /Bedrock Converse/);
  assert.doesNotMatch(editor, /Codex App Server/);
  assert.doesNotMatch(editor, /模型目录 URL/);
  assert.doesNotMatch(editor, />手动</);
});

test('Provider detection UI includes v1 guidance, elapsed time and accessible live status', async () => {
  const [source, styles] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(stylesPath, 'utf8')]);
  assert.match(source, /当前地址可能缺少 \/v1/);
  assert.match(source, /正在探测模型能力，通常需要 10–15 秒/);
  assert.match(source, /已等待 \{elapsedSeconds\} 秒/);
  assert.match(source, /aria-live="polite"/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.provider-detection-progress/);
});
