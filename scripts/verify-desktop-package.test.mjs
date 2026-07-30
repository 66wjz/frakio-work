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
    ...[
      paths.piWorker,
      paths.codexAdapter,
      paths.claudeAdapter,
      paths.geminiAdapter,
      paths.piCorePackage,
      paths.piCodingPackage,
      paths.claudeSdkPackage,
      paths.acpSdkPackage,
      paths.braceExpansionPackage,
    ].map((target) => mkdir(path.dirname(target), { recursive: true })),
  ]);
  await Promise.all([
    writeFile(paths.executable, ''),
    writeFile(paths.serverEntry, ''),
    writeFile(paths.mermaidPackage, '{}'),
    writeFile(paths.piWorker, ''),
    writeFile(paths.codexAdapter, ''),
    writeFile(paths.claudeAdapter, ''),
    writeFile(paths.geminiAdapter, ''),
    writeFile(paths.piCorePackage, '{}'),
    writeFile(paths.piCodingPackage, '{}'),
    writeFile(paths.claudeSdkPackage, '{}'),
    writeFile(paths.acpSdkPackage, '{}'),
    writeFile(paths.braceExpansionPackage, '{"version":"5.0.8"}'),
  ]);
  await assertDesktopPackageLayout(appPath);
} finally {
  await rm(root, { recursive: true, force: true });
}
