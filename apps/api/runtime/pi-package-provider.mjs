import { createHash, verify as verifySignature } from 'node:crypto';
import { access, cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const packageName = '@earendil-works/pi-coding-agent';
const registryUrl = 'https://registry.npmjs.org/@earendil-works%2fpi-coding-agent';
const hostProtocolVersion = 1;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw Object.assign(new Error('Pi Runtime 版本号无效。'), { status: 400 });
  return version;
}

function versionParts(value) {
  return String(value || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
}

function versionAtLeast(actual, minimum) {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function nodeRequirementSatisfied(requirement, actual = process.versions.node) {
  const minimum = String(requirement || '').match(/>=\s*v?(\d+\.\d+\.\d+)/)?.[1];
  return !minimum || versionAtLeast(actual, minimum);
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function createPiRuntimeProvider({
  appRoot,
  managedRoot,
  stagingRoot,
  catalogPath,
  catalogUrl = '',
  catalogPublicKey = '',
  npmCommand = 'npm',
  execFile,
  resolveCommand,
  bridgeFactory,
  fetchImpl = fetch,
} = {}) {
  let releaseCache = null;

  async function bundledPackage() {
    return readJson(path.join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'));
  }

  async function loadCatalog() {
    const bundled = await readJson(catalogPath, { schema: 1, runtimeId: 'pi', versions: [] });
    if (!catalogUrl || !catalogPublicKey) return bundled;
    try {
      const [catalogResponse, signatureResponse] = await Promise.all([
        fetchImpl(catalogUrl, { signal: AbortSignal.timeout(15000) }),
        fetchImpl(`${catalogUrl}.sig`, { signal: AbortSignal.timeout(15000) }),
      ]);
      if (!catalogResponse.ok || !signatureResponse.ok) return bundled;
      const raw = await catalogResponse.text();
      const signature = Buffer.from((await signatureResponse.text()).trim(), 'base64');
      if (!verifySignature(null, Buffer.from(raw), catalogPublicKey, signature)) return bundled;
      const parsed = JSON.parse(raw);
      return parsed?.runtimeId === 'pi' && Array.isArray(parsed.versions) ? parsed : bundled;
    } catch {
      return bundled;
    }
  }

  async function packument({ refresh = false } = {}) {
    if (!refresh && releaseCache && Date.now() - releaseCache.cachedAt < 15 * 60_000) return releaseCache.value;
    const response = await fetchImpl(registryUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'Frakio-Work' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`npm Registry 返回 HTTP ${response.status}。`);
    const value = await response.json();
    releaseCache = { cachedAt: Date.now(), value };
    return value;
  }

  async function releases({ refresh = false } = {}) {
    const catalog = await loadCatalog();
    const metadata = !refresh && !releaseCache ? { versions: {}, 'dist-tags': {}, time: {} } : await packument({ refresh });
    const versions = metadata?.versions || {};
    const verified = (catalog.versions || []).flatMap((entry) => {
      const npm = versions[entry.version];
      if (npm && (!npm.dist?.integrity || npm.dist.integrity !== entry.integrity)) return [];
      return [{ ...entry, tarball: npm?.dist?.tarball || '', node: npm?.engines?.node || entry.node || '' }];
    });
    const latestVersion = String(metadata?.['dist-tags']?.latest || '');
    return {
      verified,
      upstreamLatest: latestVersion ? {
        version: latestVersion,
        integrity: versions[latestVersion]?.dist?.integrity || '',
        publishedAt: metadata?.time?.[latestVersion] || '',
      } : null,
      checkedAt: releaseCache?.cachedAt ? new Date(releaseCache.cachedAt).toISOString() : String(catalog.generatedAt || ''),
      source: registryUrl,
      catalogSource: catalogUrl && catalogPublicKey ? catalogUrl : 'bundled',
    };
  }

  async function inspectBundled() {
    const pkg = await bundledPackage();
    if (!pkg?.version) return null;
    const lock = await readFile(path.join(appRoot, 'package-lock.json'), 'utf8').catch(() => '');
    const digest = sha256(`${pkg.version}\n${lock}`);
    return {
      runtimeVersion: pkg.version,
      runtimeBuildId: `pi-bundled-${pkg.version}-${digest.slice(0, 16)}`,
      runtimeDir: appRoot,
      platform: process.platform,
      arch: process.arch,
      artifactDigest: digest,
      adapterProtocolVersion: hostProtocolVersion,
      verificationState: 'verified',
      verificationReceipt: { kind: 'bundled', packageName, version: pkg.version, hostProtocolVersion },
      metadata: { packageName },
    };
  }

  async function importLegacyBundled(runtimePackage) {
    const sourceRoot = path.resolve(String(runtimePackage?.runtimeDir || appRoot));
    const names = ['pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-tui'];
    const manifests = await Promise.all(names.map((name) => readJson(path.join(sourceRoot, 'node_modules', '@earendil-works', name, 'package.json'))));
    const version = String(runtimePackage?.runtimeVersion || manifests[2]?.version || '');
    const mismatched = names.filter((_, index) => !version || manifests[index]?.version !== version);
    if (mismatched.length) throw new Error(`旧 bundled Pi 不完整：${mismatched.join(', ')}。`);

    const platform = `${process.platform}-${process.arch}`;
    const destination = path.join(managedRoot, version, platform);
    if (!isInside(managedRoot, destination)) throw Object.assign(new Error('旧 Pi Runtime 导入路径无效。'), { status: 403 });
    const existingManifest = await readJson(path.join(destination, 'runtime-manifest.json'));
    if (existingManifest?.runtimeVersion === version && existingManifest?.metadata?.legacyBundledImport) {
      return { ...existingManifest, runtimeDir: destination };
    }

    const staging = path.join(stagingRoot, `pi-legacy-${version}-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      await cp(path.join(sourceRoot, 'node_modules'), path.join(staging, 'node_modules'), { recursive: true, force: false, errorOnExist: true });
      const artifactDigest = String(runtimePackage?.artifactDigest || sha256(JSON.stringify(manifests.map((manifest) => ({ name: manifest.name, version: manifest.version })))));
      const runtimeBuildId = `pi-managed-${version}-${artifactDigest.slice(0, 16)}`;
      const manifest = {
        schema: 1, runtimeId: 'pi', runtimeVersion: version, runtimeBuildId, source: 'managed',
        platform: process.platform, arch: process.arch, artifactDigest,
        adapterProtocolVersion: hostProtocolVersion, installationState: 'installed', verificationState: 'unverified',
        installedAt: new Date().toISOString(), metadata: { packageName, legacyBundledImport: true },
      };
      await writeFile(path.join(staging, 'package.json'), `${JSON.stringify({ private: true, name: `frakio-pi-runtime-${version}`, version: '1.0.0', type: 'module' }, null, 2)}\n`, 'utf8');
      await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const verification = await verify({ ...manifest, runtimeDir: staging });
      if (!verification.ok) throw new Error(verification.error || '旧 bundled Pi 导入后自检失败。');
      const finalManifest = { ...manifest, verificationState: 'verified', availability: 'ready', verificationReceipt: verification, verifiedAt: new Date().toISOString() };
      await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
      await mkdir(path.dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      return { ...finalManifest, runtimeDir: destination };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function findPiPackageRoot(executablePath) {
    let current = path.dirname(executablePath);
    for (let depth = 0; depth < 12; depth += 1) {
      const manifest = await readJson(path.join(current, 'package.json'));
      if (manifest?.name === packageName) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return '';
  }

  async function inspectNative({ executablePath, expectedFingerprint = '' } = {}) {
    const resolved = await realpath(String(executablePath || '')).catch(() => '');
    if (!resolved) throw Object.assign(new Error('Pi 可执行文件不存在。'), { status: 404, code: 'RUNTIME_EXECUTABLE_MISSING' });
    const packageRoot = await findPiPackageRoot(resolved);
    if (!packageRoot) throw Object.assign(new Error('无法从该可执行文件定位完整 Pi npm 包。'), { status: 409, code: 'PI_PACKAGE_ROOT_MISSING' });
    const runtimeDir = path.dirname(path.dirname(path.dirname(packageRoot)));
    const names = ['pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-tui'];
    const manifests = await Promise.all(names.map((name) => readJson(path.join(runtimeDir, 'node_modules', '@earendil-works', name, 'package.json'))));
    const version = String(manifests[2]?.version || '');
    const mismatched = names.filter((_, index) => !version || manifests[index]?.version !== version);
    if (mismatched.length) {
      throw Object.assign(new Error(`Pi 核心包版本不一致：${mismatched.join(', ')}。`), { status: 409, code: 'PI_PACKAGE_VERSION_MISMATCH' });
    }
    const info = await stat(resolved);
    const executableDigest = sha256(await readFile(resolved));
    const fingerprint = sha256(`${resolved}\n${version}\n${info.size}\n${executableDigest}`);
    if (expectedFingerprint && expectedFingerprint !== fingerprint) {
      throw Object.assign(new Error('Pi 可执行文件在确认后发生了变化。'), { status: 409, code: 'RUNTIME_FINGERPRINT_CHANGED' });
    }
    const runtimeBuildId = `pi-native-${version}-${fingerprint.slice(0, 16)}`;
    const candidate = {
      runtimeId: 'pi', runtimeVersion: version, runtimeBuildId, source: 'native', runtimeDir,
      executablePath: resolved, packageRoot, fingerprint, platform: process.platform, arch: process.arch,
      artifactDigest: fingerprint, adapterProtocolVersion: hostProtocolVersion, installationState: 'installed',
      verificationState: 'verified', availability: 'ready', installedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString(), metadata: { packageName, packages: names },
    };
    const handshake = await verify(candidate, { nativeInspection: true });
    if (!handshake.ok) throw Object.assign(new Error(handshake.error || 'Pi Worker 握手失败。'), { status: 409, code: 'RUNTIME_PROTOCOL_INCOMPATIBLE' });
    return { ...candidate, verificationReceipt: { ...handshake, executablePath: resolved, fingerprint } };
  }

  async function discover({ executablePath = '' } = {}) {
    const command = executablePath || await resolveCommand?.('pi');
    if (!command) return [];
    try {
      const inspected = await inspectNative({ executablePath: command });
      return [{
        runtimeId: 'pi', path: command, realPath: inspected.executablePath, packageRoot: inspected.packageRoot,
        version: inspected.runtimeVersion, platform: inspected.platform, arch: inspected.arch,
        fingerprint: inspected.fingerprint, compatibility: 'compatible', detail: '四个 Pi 核心包和 Worker 协议验证通过。',
      }];
    } catch (error) {
      return [{ runtimeId: 'pi', path: command, realPath: await realpath(command).catch(() => command), packageRoot: '', version: '', platform: process.platform, arch: process.arch, fingerprint: '', compatibility: 'incompatible', detail: error.message || String(error) }];
    }
  }

  async function verify(runtimePackage, { nativeInspection = false } = {}) {
    if (!nativeInspection && runtimePackage?.source === 'native' && runtimePackage?.executablePath) {
      try {
        const inspected = await inspectNative({ executablePath: runtimePackage.executablePath, expectedFingerprint: runtimePackage.fingerprint });
        return { ok: inspected.runtimeBuildId === runtimePackage.runtimeBuildId, ...inspected.verificationReceipt };
      } catch (error) {
        return { ok: false, kind: 'native_package_probe', error: error.message || String(error) };
      }
    }
    if (!bridgeFactory) return { ok: true, kind: 'metadata', hostProtocolVersion };
    const bridge = bridgeFactory({
      runtimeId: 'pi', runtimeVersion: runtimePackage.runtimeVersion, runtimeBuildId: runtimePackage.runtimeBuildId,
      runtimeDir: runtimePackage.runtimeDir, adapterProtocolVersion: hostProtocolVersion,
    });
    try {
      const ready = await bridge.inspect();
      const ok = ready?.runtimeVersion === runtimePackage.runtimeVersion
        && ready?.runtimeBuildId === runtimePackage.runtimeBuildId
        && Number(ready?.hostProtocolVersion) === hostProtocolVersion;
      return { ok, kind: 'worker_handshake', ...ready, error: ok ? '' : 'Pi Worker 握手与安装清单不一致。' };
    } catch (error) {
      return { ok: false, kind: 'worker_handshake', error: error.message || String(error) };
    } finally {
      await bridge.close().catch(() => {});
    }
  }

  async function install(versionValue) {
    const version = safeVersion(versionValue);
    const releaseState = await releases({ refresh: true });
    const release = releaseState.verified.find((item) => item.version === version);
    if (!release) throw Object.assign(new Error('该 Pi 版本尚未进入 Frakio 稳定兼容目录。'), { status: 409, code: 'PI_VERSION_NOT_VERIFIED' });
    if (Number(release.adapterProtocolVersion || 0) !== hostProtocolVersion) {
      throw Object.assign(new Error('该 Pi 版本与当前 Runtime Host 协议不兼容。'), { status: 409, code: 'PI_HOST_PROTOCOL_INCOMPATIBLE' });
    }
    const appPackage = await readJson(path.join(appRoot, 'package.json'), {});
    if (release.minimumFrakioVersion && !versionAtLeast(appPackage.version, release.minimumFrakioVersion)) {
      throw Object.assign(new Error(`该 Pi 版本需要 Frakio Work ${release.minimumFrakioVersion} 或更高版本。`), { status: 409, code: 'PI_FRAKIO_VERSION_INCOMPATIBLE' });
    }
    if (!nodeRequirementSatisfied(release.node)) {
      throw Object.assign(new Error(`该 Pi 版本需要 Node ${release.node}，当前为 ${process.versions.node}。`), { status: 409, code: 'PI_NODE_VERSION_INCOMPATIBLE' });
    }
    const platform = `${process.platform}-${process.arch}`;
    const destination = path.join(managedRoot, version, platform);
    if (!isInside(managedRoot, destination)) throw Object.assign(new Error('Pi Runtime 安装路径无效。'), { status: 403 });
    const existingManifest = await readJson(path.join(destination, 'runtime-manifest.json'));
    if (existingManifest?.runtimeVersion === version && existingManifest?.integrity === release.integrity) {
      return { ...existingManifest, runtimeDir: destination, verificationState: existingManifest.verificationState || 'verified' };
    }
    const staging = path.join(stagingRoot, `pi-${version}-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      const packageJson = {
        private: true,
        name: `frakio-pi-runtime-${version}`,
        version: '1.0.0',
        type: 'module',
        dependencies: {
          '@earendil-works/pi-agent-core': version,
          '@earendil-works/pi-ai': version,
          '@earendil-works/pi-coding-agent': version,
          '@earendil-works/pi-tui': version,
          'brace-expansion': '5.0.8',
        },
        overrides: { 'brace-expansion': '5.0.8' },
      };
      await writeFile(path.join(staging, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      await execFile(npmCommand, ['install', '--omit=dev', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], {
        cwd: staging, timeout: 20 * 60_000, maxBuffer: 10 * 1024 * 1024,
      });
      const piPackages = ['pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-tui'];
      const installedPackages = await Promise.all(piPackages.map((name) => readJson(path.join(staging, 'node_modules', '@earendil-works', name, 'package.json'))));
      const safeBrace = await readJson(path.join(staging, 'node_modules', 'brace-expansion', 'package.json'));
      const mismatched = installedPackages.map((pkg, index) => ({ name: piPackages[index], version: pkg?.version || '' })).filter((item) => item.version !== version);
      if (mismatched.length) throw new Error(`Pi 核心包版本不一致：${mismatched.map((item) => `${item.name}@${item.version || '未知'}`).join(', ')}。`);
      if (safeBrace?.version !== '5.0.8') throw new Error(`Pi 安全依赖版本不一致：${safeBrace?.version || '未知'}。`);
      const lock = await readFile(path.join(staging, 'package-lock.json'));
      const lockJson = JSON.parse(lock.toString('utf8'));
      const installedIntegrity = lockJson.packages?.['node_modules/@earendil-works/pi-coding-agent']?.integrity || '';
      if (!installedIntegrity || installedIntegrity !== release.integrity) throw new Error('Pi 下载内容与兼容目录的 npm integrity 不一致。');
      const artifactDigest = sha256(lock);
      const runtimeBuildId = `pi-managed-${version}-${artifactDigest.slice(0, 16)}`;
      const manifest = {
        schema: 1, runtimeId: 'pi', runtimeVersion: version, runtimeBuildId, source: 'managed',
        platform: process.platform, arch: process.arch, artifactDigest, integrity: release.integrity,
        adapterProtocolVersion: hostProtocolVersion, installationState: 'installed', verificationState: 'unverified',
        installedAt: new Date().toISOString(), metadata: { packageName, tarball: release.tarball || '' },
      };
      await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const verification = await verify({ ...manifest, runtimeDir: staging });
      if (!verification.ok) throw new Error(verification.error || 'Pi Runtime 自检失败。');
      const finalManifest = { ...manifest, verificationState: 'verified', verificationReceipt: verification, verifiedAt: new Date().toISOString() };
      await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
      await mkdir(path.dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      return { ...finalManifest, runtimeDir: destination };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function remove(runtimePackage) {
    if (!isInside(managedRoot, runtimePackage.runtimeDir)) throw Object.assign(new Error('Pi Runtime 删除路径无效。'), { status: 403 });
    await access(runtimePackage.runtimeDir).catch(() => null);
    await rm(runtimePackage.runtimeDir, { recursive: true, force: true });
  }

  return { runtimeId: 'pi', hostProtocolVersion, registryUrl, inspectBundled, importLegacyBundled, releases, discover, inspectNative, install, verify, remove };
}
