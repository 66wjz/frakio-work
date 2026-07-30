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
};

const definitions = [
  { id: 'hermes', name: 'Hermes Agent', kind: 'core', bundled: true, capabilities: coreCapabilities },
  {
    id: 'pi',
    name: 'Pi',
    kind: 'core',
    bundled: true,
    capabilities: { ...coreCapabilities, approvals: false },
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'channel',
    bundled: false,
    command: 'codex',
    capabilities: { ...coreCapabilities, customModels: false, managedCredentials: false },
  },
  {
    id: 'claude',
    name: 'Claude Code',
    kind: 'channel',
    bundled: false,
    command: 'claude',
    capabilities: { ...coreCapabilities, steering: false, customModels: false, managedCredentials: false },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    kind: 'channel',
    bundled: false,
    command: 'gemini',
    capabilities: { ...coreCapabilities, steering: false, customModels: false, managedCredentials: false },
  },
];

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

export function createRuntimeRegistry({ resolveCommand, execFile, piVersion = '', hermesStatus }) {
  const installations = new Map();
  const checking = new Map();
  const pendingInstallation = (definition) => ({
    runtimeId: definition.id,
    kind: definition.kind,
    status: 'checking',
    installed: false,
    version: '',
    command: definition.command,
    authMode: definition.kind === 'core' ? 'frakio-managed' : 'native',
    detail: '正在检测运行时。',
    checkedAt: '',
  });
  const serialize = (definition) => ({
    ...definition,
    enabled: definition.kind === 'core' || installations.get(definition.id)?.installed === true,
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
      if (runtimeId === 'pi') {
        return {
          runtimeId,
          kind: definition.kind,
          status: piVersion ? 'ready' : 'missing',
          installed: Boolean(piVersion),
          version: piVersion,
          authMode: 'frakio-managed',
          detail: piVersion ? 'Frakio Work 内置 Pi Worker 已就绪。' : 'Pi SDK 未包含在当前安装包中。',
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
      const commandPath = await resolveCommand(definition.command);
      const version = await commandVersion(commandPath, execFile);
      return {
        runtimeId,
        kind: definition.kind,
        status: commandPath ? 'ready' : 'missing',
        installed: Boolean(commandPath),
        version,
        command: commandPath || definition.command,
        authMode: 'native',
        detail: commandPath ? '已检测到本机 CLI；登录状态会在首次运行时验证。' : `未检测到 ${definition.command} CLI。`,
        checkedAt,
      };
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
    : hasHermesProfile ? 'hermes' : 'pi';
  const allowedRuntimeIds = Array.from(new Set([
    ...(Array.isArray(policy.allowedRuntimeIds) ? policy.allowedRuntimeIds : []),
    defaultRuntimeId,
  ])).filter((runtimeId) => known.has(runtimeId));
  return {
    defaultRuntimeId,
    allowedRuntimeIds,
    permissionProfileId: String(policy.permissionProfileId || 'default').slice(0, 120),
  };
}

export function runtimeForAgent(agent, override = '') {
  const policy = normalizeRuntimePolicy(agent?.runtimePolicy, { hasHermesProfile: Boolean(agent?.profileName) });
  return override && policy.allowedRuntimeIds.includes(override) ? override : policy.defaultRuntimeId;
}
