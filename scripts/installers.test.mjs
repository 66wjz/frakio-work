import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Linux installer only offers the Linux x64 package and verifies the release digest', async () => {
  const script = await readFile(path.join(root, 'scripts', 'install.sh'), 'utf8');
  execFileSync('/bin/sh', ['-n', path.join(root, 'scripts', 'install.sh')]);
  assert.match(script, /releases\/latest/);
  assert.match(script, /releases\/tags\/\$TAG/);
  assert.match(script, /Frakio\.Work\.Web-\$VERSION-\$PLATFORM\.tar\.gz/);
  assert.match(script, /sha256:/);
  assert.doesNotMatch(script, /SHA256SUMS/);
  assert.match(script, /macOS users should download the desktop DMG/);
});

test('Windows installer selects the release asset digest instead of a checksum download', async () => {
  const script = await readFile(path.join(root, 'scripts', 'install.ps1'), 'utf8');
  assert.match(script, /releases\/tags\/\$RequestedTag/);
  assert.match(script, /\$Release\.assets \| Where-Object/);
  assert.match(script, /\.digest\.StartsWith\(\"sha256:\"\)/);
  assert.doesNotMatch(script, /ChecksumAsset/);
  assert.match(script, /"Arm64" \{ "arm64" \}/);
  assert.match(script, /supports x64 and ARM64 only/);
});
