import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

const artifactDir = path.resolve(process.argv[2] || 'release');
const packageVersion = JSON.parse(await (await import('node:fs/promises')).readFile(path.resolve('package.json'), 'utf8')).version;
async function collectFiles(directory) {
  const files = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, nestedPath] of await collectFiles(fullPath)) files.set(name, nestedPath);
    } else if (entry.isFile()) {
      files.set(entry.name, fullPath);
    }
  }
  return files;
}

const files = await collectFiles(artifactDir);
const required = [
  `Frakio.Work-${packageVersion}-arm64.dmg`,
  `Frakio.Work-${packageVersion}-arm64.zip`,
  `Frakio.Work-${packageVersion}-x64.dmg`,
  `Frakio.Work-${packageVersion}-x64.zip`,
  'Frakio-Work-mac-arm64-SHA256SUMS.txt',
  'Frakio-Work-mac-arm64-sbom.json',
  'Frakio-Work-mac-x64-SHA256SUMS.txt',
  'Frakio-Work-mac-x64-sbom.json',
  'THIRD_PARTY_NOTICES.txt',
  'install.sh',
  'install.ps1',
  ...['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'].flatMap((platform) => [
    `Frakio.Work.Web-${packageVersion}-${platform}${platform === 'win-x64' ? '.zip' : '.tar.gz'}`,
    `Frakio.Work.Web-${packageVersion}-${platform}.SHA256SUMS.txt`,
    `Frakio.Work.Web-${packageVersion}-${platform}.sbom.json`,
  ]),
];

const missing = required.filter((name) => !files.has(name));
if (missing.length) throw new Error(`Release artifacts are incomplete: ${missing.join(', ')}`);
for (const name of required) await access(files.get(name));
console.log(`Verified ${required.length} Frakio Work ${packageVersion} release artifacts in ${artifactDir}.`);
