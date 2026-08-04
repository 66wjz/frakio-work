import path from 'node:path';

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function cleanProfile(value) {
  const name = String(value || '').trim().toLowerCase();
  return PROFILE_PATTERN.test(name) ? name : '';
}

function unique(values) {
  return Array.from(new Set((values || []).map(cleanProfile).filter(Boolean)));
}

function readPlistValues(raw, key) {
  const match = String(raw || '').match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  if (!match) return [];
  return Array.from(match[1].matchAll(new RegExp('<string>([\\s\\S]*?)</string>', 'g'))).map((item) => item[1]);
}

function readPlistString(raw, key) {
  const match = String(raw || '').match(new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)<\\/string>`));
  return match?.[1] || '';
}

function serviceFileForProfile(homeDir, profileName) {
  const suffix = profileName === 'default' ? '' : `-${profileName}`;
  return path.join(homeDir, 'Library', 'LaunchAgents', `ai.hermes.gateway${suffix}.plist`);
}

function expectedHermesHome(hermesHome, profileName) {
  return profileName === 'default' ? path.resolve(hermesHome) : path.resolve(hermesHome, 'profiles', profileName);
}

function runtimeIsOwned(runtimePath, roots) {
  if (!runtimePath) return false;
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), path.resolve(runtimePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

export function createHermesGatewayRepair({
  hermesHome,
  frakioWorkHome,
  homeDir,
  platform = process.platform,
  readFile,
  readdir,
  writeFile,
  writeState,
  exists,
  mkdir,
  rename,
  now = () => new Date().toISOString(),
  stopGateway,
  uninstallService,
  inspectService,
  inspectProcesses,
  allowedRuntimeRoots = [],
  legacyRuntimeRoots = [],
  log = () => {},
} = {}) {
  async function readService(profileName) {
    if (inspectService) return inspectService(profileName);
    const expectedHome = expectedHermesHome(hermesHome, profileName);
    if (platform === 'darwin') {
      const plistPath = serviceFileForProfile(homeDir, profileName);
      if (!(await exists(plistPath))) return null;
      const raw = await readFile(plistPath, 'utf8').catch(() => '');
      const args = readPlistValues(raw, 'ProgramArguments');
      const configuredHome = readPlistString(raw, 'HERMES_HOME');
      const command = args.join(' ');
      if (!/hermes_cli\.main/.test(command) || !args.includes('gateway') || !args.includes('run')) return null;
      if (path.resolve(configuredHome || '') !== expectedHome) return null;
      if (profileName !== 'default' && !(args.includes('--profile') && args.includes(profileName))) return null;
      const runtimePath = path.resolve(args[0] || '');
      return { profileName, path: plistPath, command, runtimePath, kind: 'launchd', owned: runtimeIsOwned(runtimePath, allowedRuntimeRoots), legacy: runtimeIsOwned(runtimePath, legacyRuntimeRoots) };
    }
    if (platform === 'linux') {
      const suffix = profileName === 'default' ? '' : `-${profileName}`;
      const unitPath = path.join(homeDir, '.config', 'systemd', 'user', `hermes-gateway${suffix}.service`);
      if (!(await exists(unitPath))) return null;
      const raw = await readFile(unitPath, 'utf8').catch(() => '');
      const command = raw.match(/^ExecStart=(.+)$/m)?.[1]?.trim() || '';
      const configuredHome = raw.match(/HERMES_HOME=([^"\s]+)/)?.[1] || '';
      const runtimePath = command.match(/^"([^"]+)"/)?.[1] || command.split(/\s+/)[0] || '';
      if (!/gateway\s+run/.test(command) || path.resolve(configuredHome) !== expectedHome) return null;
      return { profileName, path: unitPath, command, runtimePath, kind: 'systemd', owned: runtimeIsOwned(runtimePath, allowedRuntimeRoots), legacy: runtimeIsOwned(runtimePath, legacyRuntimeRoots) };
    }
    if (platform === 'win32') {
      const taskName = profileName === 'default' ? 'Hermes_Gateway' : `Hermes_Gateway_${profileName}`;
      const scriptPath = path.join(expectedHome, 'gateway-service', `${taskName}.cmd`);
      if (!(await exists(scriptPath))) return null;
      const command = await readFile(scriptPath, 'utf8').catch(() => '');
      const runtimePath = command.match(/"([^"]+(?:python|python3)\.exe)"/i)?.[1] || '';
      if (!/hermes_cli\.main/i.test(command) || !/gateway\s+run/i.test(command)) return null;
      return { profileName, path: scriptPath, command, runtimePath, kind: 'scheduled-task', owned: runtimeIsOwned(runtimePath, allowedRuntimeRoots), legacy: runtimeIsOwned(runtimePath, legacyRuntimeRoots) };
    }
    return null;
  }

  async function removeService(service, backupDir, result) {
    try {
      if (uninstallService) await uninstallService(service);
      if (service.path && await exists(service.path)) {
        const destination = path.join(backupDir, 'services', path.basename(service.path));
        await mkdir(path.dirname(destination), { recursive: true });
        await rename(service.path, destination);
      }
      result.stoppedServices.push(`${service.kind}:${service.profileName}`);
    } catch (error) {
      result.unresolved.push({ profileName: service.profileName, reason: `旧 Gateway 服务未能卸载：${error?.message || error}` });
    }
  }

  async function run(inputState, { force = false } = {}) {
    const state = structuredClone(inputState || {});
    const existingMigration = state.runtimeMigrations?.hermesGatewayLegacyCleanupV1;
    const freshResult = {
      version: 1,
      status: 'completed',
      repairedAt: now(),
      stoppedServices: [],
      archivedProfiles: [],
      cleanedAutoStartNames: [],
      unresolved: [],
    };
    const result = existingMigration && !force
      ? { ...structuredClone(existingMigration), cleanedAutoStartNames: [...(existingMigration.cleanedAutoStartNames || [])] }
      : freshResult;
    const agents = Array.isArray(state.agents) ? state.agents : [];
    const registered = new Set(['default', ...agents.map((agent) => cleanProfile(agent.profileName || agent.id)).filter(Boolean)]);
    const autoStart = state.integrations?.hermesAgent?.gatewayAutoStart || {};
    const previousInclude = unique(autoStart.include);
    const previousExclude = unique(autoStart.exclude);
    const historicalEvidence = new Set([
      ...previousInclude,
      ...previousExclude,
      ...(state.integrations?.hermesAgent?.importedProfileNames || []).map(cleanProfile),
      ...(state.integrations?.hermesStudio?.importedProfileNames || []).map(cleanProfile),
      ...Object.values(state.integrations?.hermesAgent?.agentCreationRequests || {}).map((item) => cleanProfile(item?.profileName || item?.name || item?.agentId || '')),
    ]);
    const staleNames = unique([...previousInclude, ...previousExclude]).filter((name) => name !== 'default' && !registered.has(name));
    if (staleNames.length) {
      state.integrations = state.integrations || {};
      state.integrations.hermesAgent = {
        ...(state.integrations.hermesAgent || {}),
        gatewayAutoStart: {
          ...autoStart,
          include: previousInclude.filter((name) => name === 'default' || registered.has(name)),
          exclude: previousExclude.filter((name) => name === 'default' || registered.has(name)),
        },
        lastCheckedAt: now(),
      };
      result.cleanedAutoStartNames.push(...staleNames);
    }

    const profileRoot = path.join(hermesHome, 'profiles');
    let diskProfiles = [];
    try {
      diskProfiles = await readdir(profileRoot, { withFileTypes: true });
    } catch {}
    const diskNames = diskProfiles.filter((entry) => entry.isDirectory()).map((entry) => cleanProfile(entry.name)).filter(Boolean);
    const managedOrphans = diskNames.filter((name) => !registered.has(name) && historicalEvidence.has(name));
    const serviceNames = unique([...registered, ...historicalEvidence]);
    const backupDir = path.join(frakioWorkHome, 'backups', 'hermes-gateway-cleanup', result.repairedAt.replace(/[:.]/g, '-'));
    result.backupPath = backupDir;
    if (!existingMigration || force) {
      await mkdir(backupDir, { recursive: true });
      await writeFile(path.join(backupDir, 'repair.json'), `${JSON.stringify({ ...result, status: 'running' }, null, 2)}\n`, 'utf8');
      const serviceProfiles = new Set();
      for (const profileName of serviceNames) {
        const service = await readService(profileName);
        if (!service) continue;
        if (service.owned === false) {
          result.unresolved.push({ profileName, reason: `Gateway 服务来自无法确认的 Runtime：${service.runtimePath || service.command || '未知路径'}` });
          continue;
        }
        if (!service.legacy && !managedOrphans.includes(profileName)) continue;
        serviceProfiles.add(profileName);
        await removeService(service, backupDir, result);
      }
      for (const profileName of managedOrphans) {
        const source = path.join(profileRoot, profileName);
        if (!(await exists(source))) continue;
        try {
          if (!serviceProfiles.has(profileName) && stopGateway) await stopGateway(profileName);
          const destination = path.join(backupDir, 'profiles', profileName);
          await mkdir(path.dirname(destination), { recursive: true });
          await rename(source, destination);
          result.archivedProfiles.push(profileName);
        } catch (error) {
          result.unresolved.push({ profileName, reason: `孤儿 Profile 无法归档：${error?.message || error}` });
        }
      }
      for (const profileName of diskNames.filter((name) => !registered.has(name) && !historicalEvidence.has(name))) {
        result.unresolved.push({ profileName, reason: '发现未注册的外部 Hermes Profile；缺少 Frakio 管理证据，未自动移动。' });
      }
      const remainingProcesses = inspectProcesses ? await inspectProcesses() : [];
      for (const processInfo of remainingProcesses) {
        result.unresolved.push({
          profileName: cleanProfile(processInfo.profileName) || 'default',
          reason: `发现未由服务管理的旧 Gateway 进程 PID ${processInfo.pid || '未知'}：${processInfo.runtimePath || processInfo.command || '未知路径'}`,
        });
      }
    }
    const cleanedNames = new Set([...staleNames, ...result.archivedProfiles]);
    if (cleanedNames.size) {
      const removeCleaned = (items) => unique(items).filter((name) => !cleanedNames.has(name));
      state.integrations = state.integrations || {};
      state.integrations.hermesAgent = {
        ...(state.integrations.hermesAgent || {}),
        importedProfileNames: removeCleaned(state.integrations.hermesAgent?.importedProfileNames),
        agentCreationRequests: Object.fromEntries(Object.entries(state.integrations.hermesAgent?.agentCreationRequests || {}).filter(([, item]) => {
          const profileName = cleanProfile(item?.profileName || item?.name || item?.agentId || '');
          return !cleanedNames.has(profileName);
        })),
        ...(cleanedNames.has(cleanProfile(state.integrations.hermesAgent?.selectedProfile)) ? { selectedProfile: 'default' } : {}),
      };
      state.integrations.hermesStudio = {
        ...(state.integrations.hermesStudio || {}),
        importedProfileNames: removeCleaned(state.integrations.hermesStudio?.importedProfileNames),
        ...(cleanedNames.has(cleanProfile(state.integrations.hermesStudio?.selectedProfile)) ? { selectedProfile: 'default' } : {}),
      };
    }
    result.cleanedAutoStartNames = unique([...result.cleanedAutoStartNames, ...staleNames]);
    if (result.unresolved.length) result.status = 'completed_with_warnings';
    state.runtimeMigrations = {
      ...(state.runtimeMigrations || {}),
      hermesGatewayLegacyCleanupV1: result,
    };
    if ((!existingMigration || force) && writeFile) await writeFile(path.join(backupDir, 'repair.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (writeState && (staleNames.length || !existingMigration || force || result.unresolved.length)) await writeState(state);
    log(result);
    return { state, result };
  }

  return { run };
}

export { cleanProfile, readPlistValues, readPlistString };
