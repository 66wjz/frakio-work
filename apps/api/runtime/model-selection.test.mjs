import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelSelection, resolveModelSelectionByPrecedence } from './model-selection.mjs';

const models = [{
  id: 'model_deepseek',
  name: 'DeepSeek',
  provider: 'DeepSeek',
  model: 'deepseek-v4-pro',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
}];

test('model selection preserves a concrete model listed under a provider profile', () => {
  const resolved = resolveModelSelection('deepseek-v4-flash', models);
  assert.equal(resolved.selectedModel.id, 'model_deepseek');
  assert.equal(resolved.selectedName, 'deepseek-v4-flash');
  assert.equal(resolved.selectionValue, 'model_deepseek::deepseek-v4-flash');
});

test('model selection supports canonical profile and model values', () => {
  const resolved = resolveModelSelection('model_deepseek::deepseek-v4-flash', models);
  assert.equal(resolved.selectedModel.id, 'model_deepseek');
  assert.equal(resolved.selectedName, 'deepseek-v4-flash');
});

test('thread selection wins over Agent and global defaults', () => {
  const resolved = resolveModelSelectionByPrecedence({
    threadModel: 'model_deepseek::deepseek-v4-flash',
    agentModel: 'model_deepseek::deepseek-v4-pro',
    globalModel: 'model_deepseek',
    models,
  });
  assert.equal(resolved.source, 'thread');
  assert.equal(resolved.selectedName, 'deepseek-v4-flash');
});

test('invalid concrete model does not silently fall back to provider default', () => {
  const resolved = resolveModelSelection('model_deepseek::missing-model', models);
  assert.equal(resolved.selectedModel, null);
  assert.equal(resolved.selectedName, 'missing-model');
});
