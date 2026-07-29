import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertDesktopPackageLayout, desktopPackagePaths } from './verify-desktop-package.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-package-layout-test-'));
const appPath = path.join(root, 'Frakio Work.app');
const paths = desktopPackagePaths(appPath);
try {
  assert.equal(paths.mermaidPackage.endsWith(path.join('node_modules', 'beautiful-mermaid', 'package.json')), true);
  await assert.rejects(() => assertDesktopPackageLayout(appPath), /ENOENT/);
  await Promise.all([
    mkdir(path.dirname(paths.executable), { recursive: true }),
    mkdir(path.dirname(paths.serverEntry), { recursive: true }),
    mkdir(paths.webDist, { recursive: true }),
    mkdir(path.dirname(paths.mermaidPackage), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(paths.executable, ''),
    writeFile(paths.serverEntry, ''),
    writeFile(paths.mermaidPackage, '{}'),
  ]);
  await assertDesktopPackageLayout(appPath);
} finally {
  await rm(root, { recursive: true, force: true });
}
