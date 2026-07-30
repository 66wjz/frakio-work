import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeBraceExpansion = path.join(root, 'node_modules', 'brace-expansion');
const piBraceExpansion = path.join(
  root,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'node_modules',
  'brace-expansion',
);

async function packageVersion(packageRoot) {
  const source = await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8');
  return JSON.parse(source).version;
}

try {
  const safeVersion = await packageVersion(safeBraceExpansion);
  if (safeVersion !== '5.0.8') {
    throw new Error(`Expected brace-expansion 5.0.8, received ${safeVersion}.`);
  }

  const bundledVersion = await packageVersion(piBraceExpansion).catch(() => '');
  if (bundledVersion === safeVersion) process.exit(0);

  await fs.rm(piBraceExpansion, { recursive: true, force: true });
  await fs.cp(safeBraceExpansion, piBraceExpansion, { recursive: true });

  const patchedVersion = await packageVersion(piBraceExpansion);
  if (patchedVersion !== safeVersion) {
    throw new Error(`Pi dependency patch verification failed: ${patchedVersion}.`);
  }
  console.log(`Patched Pi runtime brace-expansion ${bundledVersion || 'missing'} -> ${patchedVersion}.`);
} catch (error) {
  console.error(`Unable to patch Pi runtime dependencies: ${error.message || String(error)}`);
  process.exitCode = 1;
}
