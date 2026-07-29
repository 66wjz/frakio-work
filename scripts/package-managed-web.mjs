import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runtimePlatformDir } from '../apps/api/lib/platform.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const apiPackage = JSON.parse(await readFile(path.join(root, 'apps', 'api', 'package.json'), 'utf8'));
const platform = runtimePlatformDir(process.platform, process.arch);
const outputRoot = path.join(root, 'release', 'managed-web');
const stagingParent = await mkdtemp(path.join(os.tmpdir(), 'frakio-managed-web-'));
const staging = path.join(stagingParent, 'frakio-work');
const archiveBase = `Frakio.Work.Web-${sourcePackage.version}-${platform}`;

async function copyFiltered(source, destination, filter) {
  await cp(source, destination, { recursive: true, filter });
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await mkdir(path.join(staging, 'scripts'), { recursive: true });
await Promise.all([
  copyFiltered(path.join(root, 'apps', 'api'), path.join(staging, 'apps', 'api'), (source) => !source.endsWith('.test.mjs')),
  cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true }),
  cp(path.join(root, 'bin'), path.join(staging, 'bin'), { recursive: true }),
  cp(path.join(root, 'scripts', 'install.sh'), path.join(staging, 'scripts', 'install.sh')),
  cp(path.join(root, 'scripts', 'install.ps1'), path.join(staging, 'scripts', 'install.ps1')),
  cp(path.join(root, 'runtime', 'agent-bridge'), path.join(staging, 'runtime', 'agent-bridge'), { recursive: true }),
  cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE')),
]);
const notices = path.join(root, 'THIRD_PARTY_NOTICES.txt');
await cp(notices, path.join(staging, 'THIRD_PARTY_NOTICES.txt')).catch(() => {});

const runtimeRoot = path.join(root, 'runtime', 'hermes');
const versions = (await readdir(runtimeRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
let copiedRuntime = false;
for (const version of versions) {
  const source = path.join(runtimeRoot, version.name, platform);
  try {
    await cp(source, path.join(staging, 'runtime', 'hermes', version.name, platform), { recursive: true });
    copiedRuntime = true;
  } catch {}
}
if (!copiedRuntime) throw new Error(`No bundled Hermes runtime found for ${platform}. Run npm run runtime:build first.`);

await writeFile(path.join(staging, 'package.json'), `${JSON.stringify({
  name: 'frakio-work-managed-web',
  version: sourcePackage.version,
  private: true,
  type: 'module',
  dependencies: { ...sourcePackage.dependencies, ...apiPackage.dependencies },
}, null, 2)}\n`);
await execFileAsync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staging, timeout: 10 * 60 * 1000 });
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const npmArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd sbom --sbom-format cyclonedx']
  : ['sbom', '--sbom-format', 'cyclonedx'];
const { stdout: sbom } = await execFileAsync(npmCommand, npmArgs, { cwd: staging, maxBuffer: 50 * 1024 * 1024 });
await writeFile(path.join(staging, 'sbom.json'), sbom, 'utf8');
await mkdir(outputRoot, { recursive: true });
const archive = path.join(outputRoot, `${archiveBase}${process.platform === 'win32' ? '.zip' : '.tar.gz'}`);
if (process.platform === 'win32') await execFileAsync('tar', ['-a', '-cf', archive, '-C', stagingParent, 'frakio-work']);
else await execFileAsync('tar', ['-czf', archive, '-C', stagingParent, 'frakio-work']);
await rm(stagingParent, { recursive: true, force: true });
const archiveHash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(path.join(outputRoot, `${archiveBase}.SHA256SUMS.txt`), `${archiveHash}  ${path.basename(archive)}\n`);
await writeFile(path.join(outputRoot, `${archiveBase}.sbom.json`), sbom, 'utf8');
console.log(archive);
