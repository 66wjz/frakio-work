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
      paths.runtimePlatform,
      paths.adapterContract,
      paths.sessionManager,
      paths.contextCompiler,
      paths.skillProjector,
      paths.permissionBroker,
      paths.eventJournal,
      paths.runtimePackageManager,
      paths.piPackageProvider,
      paths.cliPackageProvider,
      paths.hostController,
      paths.modelGateway,
      paths.piRuntimeCatalog,
      paths.claudeSdkPackage,
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
    writeFile(paths.runtimePlatform, ''),
    writeFile(paths.adapterContract, ''),
    writeFile(paths.sessionManager, ''),
    writeFile(paths.contextCompiler, ''),
    writeFile(paths.skillProjector, ''),
    writeFile(paths.permissionBroker, ''),
    writeFile(paths.eventJournal, ''),
    writeFile(paths.runtimePackageManager, ''),
    writeFile(paths.piPackageProvider, ''),
    writeFile(paths.cliPackageProvider, ''),
    writeFile(paths.hostController, ''),
    writeFile(paths.modelGateway, ''),
    writeFile(paths.piRuntimeCatalog, '{}'),
    writeFile(paths.claudeSdkPackage, '{}'),
    writeFile(paths.braceExpansionPackage, '{"version":"5.0.8"}'),
  ]);
  await assertDesktopPackageLayout(appPath);
} finally {
  await rm(root, { recursive: true, force: true });
}
