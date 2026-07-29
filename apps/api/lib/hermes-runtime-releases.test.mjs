import assert from 'node:assert/strict';
import test from 'node:test';
import { isOfficialHermesReleaseTag, parseOfficialHermesReleaseTags } from './hermes-runtime-releases.mjs';

test('official Hermes release tags are deduplicated and sorted newest first', () => {
  const releases = parseOfficialHermesReleaseTags([
    '1111111\trefs/tags/v2026.7.3',
    '2222222\trefs/tags/v2026.7.20',
    '3333333\trefs/tags/v2026.7.20^{}',
    '4444444\trefs/tags/v2025.12.31',
    '5555555\trefs/tags/nightly',
  ].join('\n'));

  assert.deepEqual(releases.map((release) => release.tag), [
    'v2026.7.20',
    'v2026.7.3',
    'v2025.12.31',
  ]);
  assert.equal(releases[0].commit, '3333333');
  assert.equal(releases[0].releaseDate, '2026-07-20');
  assert.equal(releases[0].url, 'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.20');
});

test('official Hermes release tag validation rejects branches and arbitrary refs', () => {
  assert.equal(isOfficialHermesReleaseTag('v2026.7.20'), true);
  assert.equal(isOfficialHermesReleaseTag('v2026.7.20.1'), true);
  assert.equal(isOfficialHermesReleaseTag('main'), false);
  assert.equal(isOfficialHermesReleaseTag('v1.2.3'), false);
  assert.equal(isOfficialHermesReleaseTag('../v2026.7.20'), false);
});
