import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const hostProtocolVersion = 1;

function isolatedProbeEnvironment(runtimeHome) {
  const allowed = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'];
  return {
    ...Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])),
    CODEX_HOME: runtimeHome,
  };
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return fallback; }
}

function semver(value) {
  return String(value || '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] || '';
}

function safeVersion(value) {
  const version = semver(value);
  if (!version || version !== String(value || '').trim()) throw Object.assign(new Error('Runtime 版本号无效。'), { status: 400 });
  return version;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).once('end', resolve).once('error', reject));
  return hash.digest('hex');
}

async function executableFingerprint(filePath, version) {
  const info = await stat(filePath);
  const digest = await sha256File(filePath);
  // Managed packages are verified after their staging directory is atomically
  // moved into the runtime inventory, so their identity cannot include a path.
  return createHash('sha256').update(`runtime-executable-v2\n${version}\n${info.size}\n${digest}`).digest('hex');
}

async function commandVersion(executablePath, execFile) {
  for (const args of [['--version'], ['version']]) {
    try {
      const result = await execFile(executablePath, args, { timeout: 10000, maxBuffer: 1024 * 1024 });
      const version = semver(`${result?.stdout || ''}\n${result?.stderr || ''}`);
      if (version) return version;
    } catch {}
  }
  return '';
}

async function findPackageRoot(start, packageName = '') {
  let current = path.dirname(start);
  for (let depth = 0; depth < 12; depth += 1) {
    const pkg = await readJson(path.join(current, 'package.json'));
    if (pkg && (!packageName || pkg.name === packageName)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

export async function probeCodexAppServer(executablePath, runtimeHome, spawnProcess = spawn) {
  await mkdir(runtimeHome, { recursive: true });
  return new Promise((resolve) => {
    const child = spawnProcess(executablePath, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: isolatedProbeEnvironment(runtimeHome),
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'Codex app-server 握手超时。' }), 15000);
    child.once('error', (error) => finish({ ok: false, error: error.message || String(error) }));
    child.once('exit', (code, signal) => {
      if (!settled) finish({ ok: false, error: `Codex app-server 提前退出 code=${code ?? ''} signal=${signal ?? ''}。` });
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id === 'frakio_probe' && message.result) finish({ ok: true, kind: 'app_server_initialize' });
        if (message.id === 'frakio_probe' && message.error) finish({ ok: false, error: message.error.message || JSON.stringify(message.error) });
      } catch {}
    });
    child.stdin.write(`${JSON.stringify({ method: 'initialize', id: 'frakio_probe', params: { clientInfo: { name: 'frakio_work_probe', title: 'Frakio Work', version: '1.1.1' } } })}\n`);
  });
}

function defaultManagedExecutable(runtimeId, runtimeRoot) {
  if (runtimeId === 'codex') return path.join(runtimeRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch;
  const packages = [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`, `@anthropic-ai/claude-agent-sdk-${platform}-${arch}-musl`];
  return packages.map((name) => path.join(runtimeRoot, 'node_modules', ...name.split('/'), process.platform === 'win32' ? 'claude.exe' : 'claude'));
}

export function createCliRuntimeProvider({
  runtimeId, commandName, packageName, managedRoot, stagingRoot, catalogPath, resolveCommand, execFile,
  npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm', spawnProcess = spawn,
} = {}) {
  const probeCache = new Map();

  async function catalog() {
    const value = await readJson(catalogPath, { schema: 1, runtimeId, versions: [] });
    return value?.runtimeId === runtimeId && Array.isArray(value.versions) ? value : { schema: 1, runtimeId, versions: [] };
  }

  async function resolveManagedExecutable(root) {
    const candidates = defaultManagedExecutable(runtimeId, root);
    for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
      if (await access(candidate).then(() => true).catch(() => false)) return candidate;
    }
    return '';
  }

  async function inspectExecutable(executableValue, { expectedFingerprint = '', source = 'native', runtimeDir = '' } = {}) {
    const resolved = await realpath(executableValue).catch(() => '');
    if (!resolved) throw Object.assign(new Error(`${commandName} 可执行文件不存在。`), { status: 404, code: 'RUNTIME_EXECUTABLE_MISSING' });
    const version = await commandVersion(resolved, execFile);
    if (!version) throw Object.assign(new Error(`无法读取 ${commandName} 版本。`), { status: 409, code: 'RUNTIME_VERSION_UNKNOWN' });
    const fingerprint = await executableFingerprint(resolved, version);
    if (expectedFingerprint && fingerprint !== expectedFingerprint) {
      throw Object.assign(new Error('Runtime 可执行文件在确认前已发生变化。'), { status: 409, code: 'RUNTIME_FINGERPRINT_CHANGED' });
    }
    const packageRoot = await findPackageRoot(resolved, packageName);
    const probeKey = `${resolved}:${fingerprint}`;
    let protocol = probeCache.get(probeKey);
    if (!protocol) {
      protocol = runtimeId === 'codex'
        ? await probeCodexAppServer(resolved, path.join(runtimeDir || managedRoot, '.probe-home'), spawnProcess)
        : { ok: true, kind: 'claude_agent_sdk_compatible' };
      if (protocol.ok) probeCache.set(probeKey, protocol);
    }
    if (!protocol.ok) throw Object.assign(new Error(protocol.error || 'Runtime 协议握手失败。'), { status: 409, code: 'RUNTIME_PROTOCOL_INCOMPATIBLE' });
    const buildId = `${runtimeId}-${source}-${version}-${fingerprint.slice(0, 16)}`;
    return {
      runtimeId, runtimeVersion: version, runtimeBuildId: buildId, source,
      runtimeDir: runtimeDir || packageRoot || path.dirname(resolved), executablePath: resolved, packageRoot,
      fingerprint, platform: process.platform, arch: process.arch, artifactDigest: fingerprint,
      adapterProtocolVersion: hostProtocolVersion, installationState: 'installed', verificationState: 'verified',
      availability: 'ready', verificationReceipt: { ...protocol, version, executablePath: resolved, fingerprint },
      installedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString(),
      metadata: { packageName, commandName },
    };
  }

  async function discover({ executablePath = '' } = {}) {
    const command = executablePath || await resolveCommand(commandName);
    if (!command) return [];
    try {
      const inspected = await inspectExecutable(command, { source: 'native' });
      return [{
        runtimeId, path: command, realPath: inspected.executablePath, packageRoot: inspected.packageRoot,
        version: inspected.runtimeVersion, platform: inspected.platform, arch: inspected.arch,
        fingerprint: inspected.fingerprint, compatibility: 'compatible', detail: '协议和版本验证通过。',
      }];
    } catch (error) {
      return [{ runtimeId, path: command, realPath: await realpath(command).catch(() => command), packageRoot: '', version: '', platform: process.platform, arch: process.arch, fingerprint: '', compatibility: 'incompatible', detail: error.message || String(error) }];
    }
  }

  async function inspectNative({ executablePath, expectedFingerprint = '' } = {}) {
    return inspectExecutable(executablePath, { expectedFingerprint, source: 'native' });
  }

  async function releases() {
    const value = await catalog();
    return { verified: value.versions || [], upstreamLatest: null, checkedAt: value.generatedAt || '', source: 'bundled-compatibility-catalog' };
  }

  async function verify(runtimePackage) {
    try {
      const inspected = await inspectExecutable(runtimePackage.executablePath, {
        expectedFingerprint: runtimePackage.fingerprint,
        source: runtimePackage.source,
        runtimeDir: runtimePackage.runtimeDir,
      });
      return { ok: inspected.runtimeVersion === runtimePackage.runtimeVersion, kind: 'runtime_executable_probe', ...inspected.verificationReceipt };
    } catch (error) {
      return { ok: false, kind: 'runtime_executable_probe', error: error.message || String(error) };
    }
  }

  async function install(versionValue) {
    const requested = safeVersion(versionValue);
    const value = await catalog();
    const release = value.versions.find((item) => item.version === requested);
    if (!release) throw Object.assign(new Error('该版本尚未进入 Frakio 兼容目录。'), { status: 409, code: 'RUNTIME_VERSION_NOT_VERIFIED' });
    const packageVersion = release.packageVersion || release.version;
    const destination = path.join(managedRoot, requested, `${process.platform}-${process.arch}`);
    const staging = path.join(stagingRoot, `${runtimeId}-${requested}-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      const manifestPackage = { private: true, name: `frakio-${runtimeId}-runtime`, version: '1.0.0', dependencies: { [packageName]: packageVersion } };
      await writeFile(path.join(staging, 'package.json'), `${JSON.stringify(manifestPackage, null, 2)}\n`, 'utf8');
      await execFile(npmCommand, ['install', '--omit=dev', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], { cwd: staging, timeout: 20 * 60_000, maxBuffer: 10 * 1024 * 1024 });
      const lock = await readJson(path.join(staging, 'package-lock.json'), {});
      const packageEntry = lock.packages?.[`node_modules/${packageName}`] || {};
      if (release.integrity && packageEntry.integrity !== release.integrity) {
        throw Object.assign(new Error('Runtime 下载内容与兼容目录的 npm integrity 不一致。'), { code: 'RUNTIME_INTEGRITY_MISMATCH' });
      }
      const executablePath = await resolveManagedExecutable(staging);
      if (!executablePath) throw new Error(`${runtimeId} 托管包未提供当前平台的可执行文件。`);
      const inspected = await inspectExecutable(executablePath, { source: 'managed', runtimeDir: staging });
      if (inspected.runtimeVersion !== requested) throw new Error(`${runtimeId} 运行版本 ${inspected.runtimeVersion} 与兼容目录 ${requested} 不一致。`);
      const stagingRealPath = await realpath(staging);
      const executableRelative = path.relative(stagingRealPath, inspected.executablePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      try {
        const finalized = await inspectExecutable(path.join(destination, executableRelative), { source: 'managed', runtimeDir: destination });
        return {
          ...finalized,
          metadata: { ...finalized.metadata, packageVersion, integrity: release.integrity || '', fingerprintScheme: 'runtime-executable-v2' },
        };
      } catch (error) {
        await rm(destination, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function remove(runtimePackage) {
    if (runtimePackage.source !== 'managed') return;
    const relative = path.relative(path.resolve(managedRoot), path.resolve(runtimePackage.runtimeDir));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('Runtime 删除路径无效。'), { status: 403 });
    await rm(runtimePackage.runtimeDir, { recursive: true, force: true });
  }

  return { runtimeId, hostProtocolVersion, releases, discover, inspectNative, install, verify, remove };
}
