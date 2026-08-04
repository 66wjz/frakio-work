import { randomUUID } from 'node:crypto';

function bindingFromPackage(pkg, activation) {
  if (!pkg) return null;
  return {
    runtimeId: pkg.runtimeId,
    runtimeVersion: pkg.runtimeVersion,
    runtimeBuildId: pkg.runtimeBuildId,
    source: pkg.source,
    runtimeDir: pkg.runtimeDir,
    executablePath: pkg.executablePath || '',
    packageRoot: pkg.packageRoot || '',
    fingerprint: pkg.fingerprint || '',
    platform: pkg.platform,
    arch: pkg.arch,
    artifactDigest: pkg.artifactDigest,
    adapterProtocolVersion: pkg.adapterProtocolVersion,
    activationRevision: activation?.activationRevision || '',
    verificationState: pkg.verificationState,
    availability: pkg.availability || (pkg.verificationState === 'verified' ? 'ready' : 'unavailable'),
    lastVerifiedAt: pkg.lastVerifiedAt || pkg.verifiedAt || null,
  };
}

export function createRuntimePackageManager({ store, providers = new Map() } = {}) {
  const providerMap = providers instanceof Map ? providers : new Map(Object.entries(providers || {}));
  const bundledCache = new Map();

  async function ensureBundled(runtimeId) {
    if (bundledCache.has(runtimeId)) return bundledCache.get(runtimeId);
    const provider = providerMap.get(runtimeId);
    if (!provider?.inspectBundled) return null;
    const bundled = await provider.inspectBundled();
    if (!bundled) return null;
    const existing = store.getRuntimePackage(bundled.runtimeBuildId);
    const stored = store.putRuntimePackage({
      ...bundled,
      runtimeId,
      source: 'bundled',
      installationState: 'installed',
      verificationState: bundled.verificationState || 'verified',
      installedAt: existing?.installedAt || bundled.installedAt,
      verifiedAt: existing?.verifiedAt || bundled.verifiedAt || new Date().toISOString(),
    });
    let activation = store.getRuntimeActivation(runtimeId);
    if (!activation?.activeBuildId || !store.getRuntimePackage(activation.activeBuildId)) {
      activation = store.putRuntimeActivation({
        runtimeId,
        activeBuildId: stored.runtimeBuildId,
        previousBuildId: activation?.activeBuildId || '',
        activationRevision: `activation_${randomUUID()}`,
      });
    }
    const result = { package: stored, activation };
    bundledCache.set(runtimeId, result);
    return result;
  }

  async function resolveBinding(runtimeId, { buildId = '' } = {}) {
    const provider = providerMap.get(runtimeId);
    if (provider?.autoActivateBundled) await ensureBundled(runtimeId);
    const activation = store.getRuntimeActivation(runtimeId);
    const requested = buildId ? store.getRuntimePackage(buildId) : null;
    const active = requested || store.getRuntimePackage(activation?.activeBuildId || '');
    if (!active || active.runtimeId !== runtimeId || active.installationState !== 'installed') return null;
    if (active.source === 'native' && provider?.verify) {
      const verified = await provider.verify(active);
      if (!verified?.ok) {
        store.putRuntimePackage({
          ...active,
          verificationState: 'failed',
          availability: 'broken',
          verificationReceipt: verified || {},
          lastVerifiedAt: new Date().toISOString(),
        });
        return null;
      }
      store.putRuntimePackage({ ...active, verificationState: 'verified', availability: 'ready', verificationReceipt: verified, lastVerifiedAt: new Date().toISOString() });
    }
    return bindingFromPackage(store.getRuntimePackage(active.runtimeBuildId), activation);
  }

  async function status(runtimeId, { refresh = false } = {}) {
    const provider = providerMap.get(runtimeId);
    if (provider?.autoActivateBundled) await ensureBundled(runtimeId);
    const releases = provider?.releases ? await provider.releases({ refresh }) : { verified: [], upstreamLatest: null, checkedAt: '' };
    const activation = store.getRuntimeActivation(runtimeId);
    const packages = store.listRuntimePackages(runtimeId);
    return {
      runtimeId,
      activation,
      activeBinding: bindingFromPackage(packages.find((item) => item.runtimeBuildId === activation?.activeBuildId), activation),
      previousBinding: bindingFromPackage(packages.find((item) => item.runtimeBuildId === activation?.previousBuildId), activation),
      bundledBinding: bindingFromPackage(packages.find((item) => item.source === 'bundled'), activation),
      packages,
      releases,
    };
  }

  async function install(runtimeId, version) {
    const provider = providerMap.get(runtimeId);
    if (!provider?.install) throw Object.assign(new Error(`Runtime ${runtimeId} does not support managed installation.`), { status: 409 });
    const installed = await provider.install(String(version || '').trim());
    const stored = store.putRuntimePackage({
      ...installed,
      runtimeId,
      source: 'managed',
      installationState: 'installed',
    });
    const activation = store.getRuntimeActivation(runtimeId);
    if (!activation?.activeBuildId) await activate(runtimeId, stored.runtimeBuildId);
    return store.getRuntimePackage(stored.runtimeBuildId);
  }

  async function migrateLegacyBundled(runtimeId) {
    const provider = providerMap.get(runtimeId);
    if (!provider?.inspectBundled || !provider?.importLegacyBundled) return { status: 'unsupported' };
    const currentActivation = store.getRuntimeActivation(runtimeId);
    let bundled = store.listRuntimePackages(runtimeId).find((item) => item.source === 'bundled') || null;
    if (!bundled) {
      const inspected = await provider.inspectBundled().catch(() => null);
      if (inspected) bundled = store.putRuntimePackage({
        ...inspected,
        runtimeId,
        source: 'bundled',
        installationState: 'installed',
        verificationState: inspected.verificationState || 'verified',
        availability: 'ready',
      });
    }
    if (!bundled) {
      const marker = store.putRuntimePackage({
        runtimeId,
        runtimeVersion: 'legacy',
        runtimeBuildId: `${runtimeId}-legacy-bundled-unavailable`,
        source: 'bundled',
        runtimeDir: '',
        platform: process.platform,
        arch: process.arch,
        adapterProtocolVersion: 1,
        installationState: 'missing',
        verificationState: 'failed',
        availability: 'broken',
        verificationReceipt: { kind: 'legacy_bundled_import', error: '旧 bundled Runtime 已无法访问，请在 Runtime Center 重新安装。' },
      });
      return { status: 'broken', package: marker };
    }

    try {
      const imported = await provider.importLegacyBundled(bundled);
      const managed = store.putRuntimePackage({ ...imported, runtimeId, source: 'managed', installationState: 'installed', availability: 'ready' });
      if (!currentActivation?.activeBuildId || currentActivation.activeBuildId === bundled.runtimeBuildId) {
        store.putRuntimeActivation({
          runtimeId,
          activeBuildId: managed.runtimeBuildId,
          previousBuildId: '',
          activationRevision: `activation_${randomUUID()}`,
        });
      } else if (currentActivation.previousBuildId === bundled.runtimeBuildId) {
        store.putRuntimeActivation({ ...currentActivation, previousBuildId: '', activationRevision: `activation_${randomUUID()}` });
      }
      store.deleteRuntimePackage(bundled.runtimeBuildId);
      return { status: 'imported', package: managed, activation: store.getRuntimeActivation(runtimeId) };
    } catch (error) {
      const broken = store.putRuntimePackage({
        ...bundled,
        verificationState: 'failed',
        availability: 'broken',
        verificationReceipt: { kind: 'legacy_bundled_import', error: error.message || String(error) },
        lastVerifiedAt: new Date().toISOString(),
      });
      return { status: 'broken', package: broken };
    }
  }

  async function discover(runtimeId, input = {}) {
    const provider = providerMap.get(runtimeId);
    if (!provider?.discover) return [];
    return provider.discover(input);
  }

  async function bindNative(runtimeId, { executablePath = '', fingerprint = '' } = {}) {
    const provider = providerMap.get(runtimeId);
    if (!provider?.inspectNative) throw Object.assign(new Error(`Runtime ${runtimeId} does not support native binding.`), { status: 409 });
    const inspected = await provider.inspectNative({ executablePath, expectedFingerprint: fingerprint });
    const stored = store.putRuntimePackage({ ...inspected, runtimeId, source: 'native', installationState: 'installed', availability: 'ready' });
    const activation = store.getRuntimeActivation(runtimeId);
    if (!activation?.activeBuildId) await activate(runtimeId, stored.runtimeBuildId);
    return { package: store.getRuntimePackage(stored.runtimeBuildId), activation: store.getRuntimeActivation(runtimeId) };
  }

  async function unbindNative(runtimeId, buildId) {
    const pkg = store.getRuntimePackage(String(buildId || ''));
    if (!pkg || pkg.runtimeId !== runtimeId || pkg.source !== 'native') throw Object.assign(new Error('找不到系统 Runtime 绑定。'), { status: 404 });
    const activation = store.getRuntimeActivation(runtimeId);
    if (activation?.activeBuildId === pkg.runtimeBuildId) {
      store.putRuntimeActivation({
        runtimeId,
        activeBuildId: '',
        previousBuildId: activation?.previousBuildId === pkg.runtimeBuildId ? '' : activation?.previousBuildId || '',
        activationRevision: `activation_${randomUUID()}`,
      });
    } else if (activation?.previousBuildId === pkg.runtimeBuildId) {
      store.putRuntimeActivation({ ...activation, previousBuildId: '', activationRevision: `activation_${randomUUID()}` });
    }
    store.deleteRuntimePackage(pkg.runtimeBuildId);
    return pkg;
  }

  async function activate(runtimeId, buildId) {
    const provider = providerMap.get(runtimeId);
    const target = store.getRuntimePackage(String(buildId || ''));
    if (!target || target.runtimeId !== runtimeId || target.installationState !== 'installed') {
      throw Object.assign(new Error('目标 Runtime 版本尚未安装。'), { status: 404, code: 'RUNTIME_PACKAGE_NOT_INSTALLED' });
    }
    const verified = provider?.verify ? await provider.verify(target) : { ok: target.verificationState === 'verified' };
    if (!verified?.ok) {
      store.putRuntimePackage({ ...target, verificationState: 'incompatible', verificationReceipt: verified || {}, verifiedAt: new Date().toISOString() });
      throw Object.assign(new Error(verified?.error || 'Runtime 兼容性验证失败。'), { status: 409, code: 'RUNTIME_PACKAGE_INCOMPATIBLE' });
    }
    store.putRuntimePackage({ ...target, verificationState: 'verified', availability: 'ready', verificationReceipt: verified, verifiedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() });
    const current = store.getRuntimeActivation(runtimeId);
    if (current?.activeBuildId === target.runtimeBuildId) return current;
    return store.putRuntimeActivation({
      runtimeId,
      activeBuildId: target.runtimeBuildId,
      previousBuildId: current?.activeBuildId || '',
      activationRevision: `activation_${randomUUID()}`,
    });
  }

  async function repairBroken(runtimeId) {
    const provider = providerMap.get(runtimeId);
    if (!provider?.verify) return { status: 'unsupported', repaired: [] };
    const candidates = store.listRuntimePackages(runtimeId).filter((pkg) => (
      pkg.installationState === 'installed'
      && (pkg.availability === 'broken' || ['failed', 'incompatible'].includes(pkg.verificationState))
    ));
    const repaired = [];
    for (const candidate of candidates) {
      const verified = await provider.verify(candidate).catch((error) => ({ ok: false, error: error.message || String(error) }));
      if (!verified?.ok) continue;
      store.putRuntimePackage({
        ...candidate,
        verificationState: 'verified',
        availability: 'ready',
        verificationReceipt: verified,
        verifiedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
      });
      repaired.push(candidate.runtimeBuildId);
    }
    const activation = store.getRuntimeActivation(runtimeId);
    if (!activation?.activeBuildId && repaired[0]) {
      store.putRuntimeActivation({ runtimeId, activeBuildId: repaired[0], previousBuildId: '', activationRevision: `activation_${randomUUID()}` });
    }
    return { status: repaired.length ? 'repaired' : 'unchanged', repaired, activation: store.getRuntimeActivation(runtimeId) };
  }

  async function remove(runtimeId, version) {
    const provider = providerMap.get(runtimeId);
    const pkg = store.listRuntimePackages(runtimeId).find((item) => item.runtimeVersion === String(version || '') && item.source === 'managed');
    if (!pkg) throw Object.assign(new Error('找不到已安装的 Runtime 版本。'), { status: 404 });
    const activation = store.getRuntimeActivation(runtimeId);
    if ([activation?.activeBuildId, activation?.previousBuildId].includes(pkg.runtimeBuildId)) {
      throw Object.assign(new Error('当前版本或回退版本不能删除。'), { status: 409, code: 'RUNTIME_PACKAGE_IN_USE' });
    }
    const liveSession = store.listSessions({ runtimeId, limit: 500 }).find((item) => item.runtimeBuildId === pkg.runtimeBuildId && !['closed', 'failed', 'stale'].includes(item.lifecycleState));
    const liveRun = store.listRuns({ runtimeId, runtimeBuildId: pkg.runtimeBuildId, limit: 500 }).find((item) => ['starting', 'running', 'waiting_approval'].includes(item.status));
    if (liveSession || liveRun) throw Object.assign(new Error('该版本仍被可恢复 Session 或进行中的 Run 使用。'), { status: 409, code: 'RUNTIME_PACKAGE_IN_USE' });
    if (provider?.remove) await provider.remove(pkg);
    store.deleteRuntimePackage(pkg.runtimeBuildId);
    return pkg;
  }

  return { providers: providerMap, ensureBundled, resolveBinding, status, install, migrateLegacyBundled, repairBroken, discover, bindNative, unbindNative, activate, remove };
}
