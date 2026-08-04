const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const preload = fs.readFileSync(path.join(__dirname, 'browser-preload.cjs'), 'utf8');

test('browser preload keeps annotation overlays without frame masks', () => {
  assert.doesNotMatch(preload, /frame-mask/);
  assert.doesNotMatch(preload, /frame-corner/);
  assert.match(preload, /data-frakio-annotation-layer/);
  assert.match(preload, /\.box\s*\{[^}]*pointer-events:\s*none/);
  assert.match(preload, /\.editor\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(preload, /ipcRenderer\.send\('frakio:browser-annotation'/);
});
