import assert from 'node:assert/strict';
import test from 'node:test';
import { fencedBlocks, normalizeRepairedOutput, validateRichContentOutput } from './rich-content-output.mjs';

test('rich output accepts valid Mermaid and Craft table specs', () => {
  const result = validateRichContentOutput('```mermaid\ngraph LR\nA["开始"] --> B["结束"]\n```\n\n```datatable\n{"columns":[{"key":"name","label":"名称","type":"text"}],"rows":[{"name":"Frakio"}]}\n```');
  assert.equal(result.valid, true);
});

test('rich output identifies PlantUML, invalid Mermaid, JSON, and unclosed fences', () => {
  assert.equal(validateRichContentOutput('```plantuml\n@startuml\nA --> B\n@enduml\n```').issues[0].code, 'UNSUPPORTED_DIAGRAM');
  assert.equal(validateRichContentOutput('```mermaid\nnot a diagram\n```').issues[0].code, 'INVALID_MERMAID');
  assert.equal(validateRichContentOutput('```image-preview\n{bad}\n```').issues[0].code, 'INVALID_RICH_JSON');
  assert.equal(validateRichContentOutput('```json\n{}').issues[0].code, 'UNCLOSED_FENCE');
});

test('fence parser respects longer fences and repaired markdown wrappers', () => {
  assert.equal(fencedBlocks('````markdown\n```js\nx\n```\n````').blocks.length, 1);
  assert.equal(normalizeRepairedOutput('```markdown\n# Fixed\n```'), '# Fixed');
});
