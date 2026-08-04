function unsupported(capability) {
  return { status: 'unsupported', capability };
}

const capabilityValues = new Set(['native', 'host', 'unsupported', 'unobservable']);

function controlCapabilities(adapter) {
  const declared = adapter.controlCapabilities || {};
  const value = (key, fallback) => capabilityValues.has(declared[key]) ? declared[key] : fallback;
  return {
    contextUsage: value('contextUsage', typeof adapter.contextUsage === 'function' ? 'native' : 'host'),
    compaction: value('compaction', typeof adapter.compact === 'function' ? 'native' : 'host'),
    recovery: value('recovery', typeof adapter.resume === 'function' || typeof adapter.startRun === 'function' ? 'native' : 'host'),
    cancellation: value('cancellation', typeof adapter.cancel === 'function' ? 'native' : 'unsupported'),
    permissions: value('permissions', typeof adapter.resolveApproval === 'function' ? 'native' : 'unobservable'),
  };
}

export function normalizeRuntimeAdapter(runtimeId, adapter = {}) {
  const start = typeof adapter.startRun === 'function' ? adapter.startRun.bind(adapter) : null;
  const normalized = {
    ...adapter,
    runtimeId,
    controlCapabilities: controlCapabilities(adapter),
    async probe(input = {}) {
      return typeof adapter.probe === 'function' ? adapter.probe(input) : unsupported('probe');
    },
    async open(input = {}) {
      return typeof adapter.open === 'function'
        ? adapter.open(input)
        : start ? start({ ...input, nativeSessionId: '' }) : unsupported('open');
    },
    async resume(input = {}) {
      if (!input.nativeSessionId) return unsupported('resume');
      return typeof adapter.resume === 'function'
        ? adapter.resume(input)
        : start ? start(input) : unsupported('resume');
    },
    async run(input = {}) {
      return typeof adapter.run === 'function'
        ? adapter.run(input)
        : start ? start(input) : unsupported('run');
    },
    async steer(...args) {
      return typeof adapter.steer === 'function' ? adapter.steer(...args) : unsupported('steer');
    },
    async resolveApproval(...args) {
      return typeof adapter.resolveApproval === 'function' ? adapter.resolveApproval(...args) : unsupported('resolveApproval');
    },
    async cancel(...args) {
      return typeof adapter.cancel === 'function' ? adapter.cancel(...args) : unsupported('cancel');
    },
    async contextUsage(...args) {
      return typeof adapter.contextUsage === 'function' ? adapter.contextUsage(...args) : unsupported('contextUsage');
    },
    async compact(...args) {
      return typeof adapter.compact === 'function' ? adapter.compact(...args) : unsupported('compact');
    },
    async recover(...args) {
      if (typeof adapter.recover === 'function') return adapter.recover(...args);
      return unsupported('recover');
    },
    async inspectRun(input = {}) {
      if (typeof adapter.inspectRun === 'function') return adapter.inspectRun(input);
      return unsupported('inspectRun');
    },
    async resumeRun(input = {}) {
      if (typeof adapter.resumeRun === 'function') return adapter.resumeRun(input);
      return unsupported('resumeRun');
    },
    async applySkills(input = {}) {
      return typeof adapter.applySkills === 'function' ? adapter.applySkills(input) : unsupported('applySkills');
    },
    async inspect(input = {}) {
      return typeof adapter.inspect === 'function' ? adapter.inspect(input) : unsupported('inspect');
    },
    async close(input = {}) {
      if (typeof adapter.closeSession === 'function') return adapter.closeSession(input);
      if (typeof adapter.disposeSession === 'function') return adapter.disposeSession(input.sessionId || input);
      return unsupported('close');
    },
    async closeRealm(input = {}) {
      if (typeof adapter.closeRealm === 'function') return adapter.closeRealm(input);
      return unsupported('closeRealm');
    },
  };
  normalized.startRun = start || normalized.run;
  normalized.disposeSession = typeof adapter.disposeSession === 'function'
    ? adapter.disposeSession.bind(adapter)
    : (sessionId) => normalized.close({ sessionId });
  return normalized;
}

export function createRuntimeAdapterRegistry(adapters = new Map()) {
  const source = adapters instanceof Map ? adapters : new Map(Object.entries(adapters || {}));
  return new Map(Array.from(source, ([runtimeId, adapter]) => [runtimeId, normalizeRuntimeAdapter(runtimeId, adapter)]));
}
