const coreCapabilities = {
  streaming: true,
  tools: true,
  approvals: true,
  steering: true,
  cancellation: true,
  sessionResume: true,
  customModels: true,
  managedCredentials: true,
  workTasks: true,
  contextUsage: true,
  compaction: true,
};

const definitions = [
  { id: 'hermes', name: 'Hermes Agent', kind: 'core', bundled: true, capabilities: coreCapabilities },
  {
    id: 'pi',
    name: 'Pi',
    kind: 'core',
    bundled: false,
    capabilities: { ...coreCapabilities, approvals: false },
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'channel',
    bundled: false,
    command: 'codex',
    capabilities: coreCapabilities,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    kind: 'channel',
    bundled: false,
    command: 'claude',
    capabilities: { ...coreCapabilities, steering: false },
  },
];

export function normalizeHarnessId(value, fallback = 'native') {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'pi' || id === 'native') return 'native';
  if (id === 'hermes' || id === 'codex' || id === 'claude') return id;
  return fallback;
}

export function runtimeIdForHarness(value) {
  return normalizeHarnessId(value) === 'native' ? 'pi' : normalizeHarnessId(value);
}

export function harnessIdForRuntime(value) {
  return normalizeHarnessId(value);
}

async function commandVersion(commandPath, execFile) {
  if (!commandPath || !execFile) return '';
  for (const args of [['--version'], ['version']]) {
    try {
      const result = await execFile(commandPath, args, { timeout: 5000 });
      const version = String(result?.stdout || result?.stderr || '').trim().split(/\r?\n/)[0];
      if (version) return version.slice(0, 120);
    } catch {
      // Try the next conventional version command.
    }
  }
  return '';
}

export function createRuntimeRegistry({ bindingStatus = null, hermesStatus }) {
  const installations = new Map();
  const checking = new Map();
  const pendingInstallation = (definition) => ({
    runtimeId: definition.id,
    kind: definition.kind,
    status: 'checking',
    installed: false,
    version: '',
    command: definition.command,
    authMode: 'frakio-managed',
    detail: '正在检测运行时。',
    checkedAt: '',
  });
  const serialize = (definition) => ({
    ...definition,
    enabled: definition.id === 'hermes' || installations.get(definition.id)?.installed === true,
    capabilities: { ...definition.capabilities },
    installation: installations.get(definition.id) || pendingInstallation(definition),
  });
  return {
    definitions() {
      return definitions.map((definition) => ({ ...definition, capabilities: { ...definition.capabilities } }));
    },
    get(runtimeId) {
      const definition = definitions.find((item) => item.id === runtimeId);
      return definition ? { ...definition, capabilities: { ...definition.capabilities } } : null;
    },
    async detect(runtimeId) {
      const definition = definitions.find((item) => item.id === runtimeId);
      if (!definition) return null;
      if (checking.has(runtimeId)) return checking.get(runtimeId);
      const detection = (async () => {
      const checkedAt = new Date().toISOString();
      if (runtimeId !== 'hermes') {
        const managed = typeof bindingStatus === 'function' ? await bindingStatus(runtimeId).catch(() => null) : null;
        const active = managed?.activeBinding || null;
        return {
          runtimeId,
          kind: definition.kind,
          status: active?.availability === 'broken' ? 'broken' : active ? 'ready' : 'missing',
          installed: Boolean(active && active.availability !== 'broken'),
          version: active?.runtimeVersion || '',
          command: active?.executablePath || '',
          authMode: 'frakio-managed',
          detail: active ? `${active.source === 'managed' ? 'Frakio 托管安装' : '已确认系统二进制'}，模型由 Frakio Model Center 提供。` : '尚未安装或确认绑定。',
          checkedAt,
        };
      }
      if (runtimeId === 'hermes') {
        const status = await hermesStatus().catch((error) => ({ error: error.message || String(error) }));
        const ready = Boolean(status?.runtime?.runtimeDir || status?.runtime?.python || status?.ready || status?.bridge?.ready || status?.bridge?.connected || status?.installed);
        return {
          runtimeId,
          kind: definition.kind,
          status: ready ? 'ready' : 'error',
          installed: ready,
          version: String(status?.runtime?.version || status?.displayVersion || status?.version || ''),
          authMode: 'frakio-managed',
          detail: ready ? 'Hermes Runtime 已就绪。' : String(status?.error || 'Hermes Runtime 尚未就绪。'),
          checkedAt,
        };
      }
      })();
      checking.set(runtimeId, detection);
      try {
        const installation = await detection;
        installations.set(runtimeId, installation);
        return installation;
      } finally {
        checking.delete(runtimeId);
      }
    },
    snapshot() {
      return definitions.map(serialize);
    },
    async refresh(runtimeId = '') {
      if (runtimeId) {
        await this.detect(runtimeId);
        const definition = definitions.find((item) => item.id === runtimeId);
        return definition ? serialize(definition) : null;
      }
      await Promise.all(definitions.map((definition) => this.detect(definition.id)));
      return this.snapshot();
    },
    async list() {
      return this.refresh();
    },
  };
}

export function normalizeRuntimePolicy(policy = {}, { hasHermesProfile = true } = {}) {
  const known = new Set(definitions.map((item) => item.id));
  const defaultRuntimeId = known.has(policy.defaultRuntimeId)
    ? policy.defaultRuntimeId
    : 'hermes';
  const allowedRuntimeIds = Array.from(new Set([
    ...(Array.isArray(policy.allowedRuntimeIds) ? policy.allowedRuntimeIds : []),
    defaultRuntimeId,
  ])).filter((runtimeId) => known.has(runtimeId));
  return {
    defaultRuntimeId,
    allowedRuntimeIds,
    permissionProfileId: String(policy.permissionProfileId || 'default').slice(0, 120),
    defaultHarnessId: normalizeHarnessId(policy.defaultHarnessId || policy.defaultRuntimeId, hasHermesProfile ? 'hermes' : 'native'),
  };
}

export function runtimeForAgent(agent, override = '') {
  const policy = normalizeRuntimePolicy(agent?.runtimePolicy, { hasHermesProfile: Boolean(agent?.profileName) });
  return override && policy.allowedRuntimeIds.includes(override) ? override : policy.defaultRuntimeId;
}
