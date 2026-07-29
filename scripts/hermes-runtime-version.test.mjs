import assert from 'node:assert/strict';
import test from 'node:test';
import { pinnedHermesRelease } from './hermes-runtime-version.mjs';

test('bundled Hermes runtime is pinned to the audited 0.19.0 release', () => {
  assert.deepEqual(pinnedHermesRelease, {
    version: '0.19.0',
    tag: 'v2026.7.20',
    commit: '3ef6bbd201263d354fd83ec55b3c306ded2eb72a',
  });
  assert.equal(Object.isFrozen(pinnedHermesRelease), true);
});
