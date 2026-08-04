import { compileContextDelta, contextPacketForAdapter } from './context-compiler.mjs';
import { createRuntimeAdapterRegistry } from './adapter-contract.mjs';
import { createEventJournal } from './event-journal.mjs';
import { createRuntimeExecutionRealm } from './execution-realm.mjs';
import { permissionCoverageForRuntime, permissionPolicySnapshot } from './permission-broker.mjs';
import { createSessionManager, runtimeLane } from './session-manager.mjs';
import { createSkillProjector, resolveSkillSet } from './skill-projector.mjs';

function now() {
  return new Date().toISOString();
}

function capabilitySupport(value) {
  return value === true ? 'supported' : value === false ? 'unsupported' : 'unknown';
}

function publicCapabilitySnapshot(runtime, installation) {
  const checkedAt = installation?.checkedAt || now();
  return {
    runtimeId: runtime.id,
    capabilities: Object.fromEntries(Object.entries(runtime.capabilities || {}).map(([key, value]) => [key, capabilitySupport(value)])),
    // Installation probing proves that the runtime is reachable. It does not by
    // itself prove every advertised adapter capability, so keep the provenance
    // explicit until a runtime receipt upgrades individual evidence.
    source: 'static_fallback',
    evidence: {
      installationStatus: installation?.status || 'unknown',
      command: installation?.command || '',
      authMode: installation?.authMode || 'none',
      detail: installation?.detail || '',
    },
    runtimeVersion: installation?.version || '',
    authFingerprint: `${installation?.authMode || 'none'}:${installation?.status || 'unknown'}`,
    checkedAt,
    expiresAt: new Date(Date.parse(checkedAt || now()) + 30 * 24 * 60 * 60_000).toISOString(),
  };
}

export function createRuntimePlatform({ store, registry, packageManager = null, adapters = {}, contextFactory, contextCoordinator = null, skillResolver, onHostEvent = null } = {}) {
  const adapterMap = createRuntimeAdapterRegistry(adapters);
  const sessions = createSessionManager({ store });
  const events = createEventJournal({ store, onAppend: onHostEvent });
  const skillProjector = createSkillProjector({ store, adapters: adapterMap });
  let terminalTransition = null;

  async function capability(runtimeId, { refresh = false, binding = null } = {}) {
    const cached = binding?.runtimeBuildId
      ? store.getBuildCapabilitySnapshot(runtimeId, binding.runtimeBuildId)
      : store.getCapabilitySnapshot(runtimeId);
    if (!refresh && cached && Date.parse(cached.expiresAt || '') > Date.now()) return cached;
    const runtime = registry.get(runtimeId);
    if (!runtime) return null;
    const installation = await registry.detect(runtimeId);
    const snapshot = {
      ...publicCapabilitySnapshot(runtime, installation),
      runtimeVersion: binding?.runtimeVersion || installation?.version || '',
      runtimeBuildId: binding?.runtimeBuildId || '',
      runtimeSource: binding?.source || '',
    };
    return binding?.runtimeBuildId ? store.putBuildCapabilitySnapshot(snapshot) : store.putCapabilitySnapshot(snapshot);
  }

  async function prepare(input) {
    input = {
      ...input,
      threadId: String(input.threadId || input.thread?.id || ''),
      workspace: input.workspace || null,
    };
    if (!input.threadId) throw new Error('Runtime Platform requires a Thread ID.');
    const platformEnabled = input.state?.features?.runtimePlatformV2 !== false;
    const laneEnabled = platformEnabled && input.state?.features?.runtimeSessionLanes !== false;
    const deltaEnabled = platformEnabled && input.state?.features?.runtimeContextDelta !== false;
    const skillProjectionEnabled = platformEnabled && input.state?.features?.runtimeSkillProjection !== false;
    const permissionBrokerEnabled = platformEnabled && input.state?.features?.runtimePermissionBroker !== false;
    const lane = input.lane || (laneEnabled
      ? runtimeLane({ threadId: input.threadId, taskId: input.taskId, worktreeId: input.worktreeId })
      : runtimeLane({ threadId: input.threadId }));
    const policy = permissionPolicySnapshot({
      mode: input.permissionMode,
      agentId: input.agent.id,
      workspaceId: input.workspace?.id || '',
      planMode: input.planMode,
      permissionProfileId: input.agent.runtimePolicy?.permissionProfileId || 'default',
    });
    let existing = store.findSession({
      threadId: input.threadId,
      agentId: input.agent.id,
      runtimeId: input.runtimeId,
      workspaceId: input.workspace?.id || '',
      laneType: lane.type,
      laneId: lane.id,
    });
    let runtimeBinding = null;
    if (packageManager) {
      const pinnedBuildId = lane.type === 'work_task' ? existing?.runtimeBuildId || '' : '';
      runtimeBinding = await packageManager.resolveBinding(input.runtimeId, { buildId: pinnedBuildId });
      if (!runtimeBinding && existing?.runtimeBuildId) {
        sessions.markStale(existing, `Runtime build is unavailable: ${existing.runtimeBuildId}`);
        throw Object.assign(new Error('当前 Session 绑定的 Runtime 版本已不存在。'), { code: 'RUNTIME_BUILD_UNAVAILABLE', status: 409 });
      }
      if (lane.type === 'chat' && existing?.runtimeBuildId && runtimeBinding?.runtimeBuildId && existing.runtimeBuildId !== runtimeBinding.runtimeBuildId) {
        const oldBinding = await packageManager.resolveBinding(input.runtimeId, { buildId: existing.runtimeBuildId });
        await Promise.resolve(adapterMap.get(input.runtimeId)?.disposeSession?.(existing.id, { runtimeBinding: oldBinding })).catch(() => {});
        existing = store.upsertSession({
          ...existing,
          nativeSessionId: '',
          lifecycleState: 'recovering',
          resumeStrategy: 'handoff_resumed',
          checkpoint: {
            ...existing.checkpoint,
            previousNativeSessionId: existing.nativeSessionId,
            previousRuntimeVersion: existing.runtimeVersion,
            previousRuntimeBuildId: existing.runtimeBuildId,
            reason: 'runtime_version_changed',
          },
          runtimeVersion: runtimeBinding.runtimeVersion,
          runtimeBuildId: runtimeBinding.runtimeBuildId,
          activationRevision: runtimeBinding.activationRevision,
        });
      }
    }
    const capabilitySnapshot = await capability(input.runtimeId, { binding: runtimeBinding });
    const rawPacket = input.contextPacket || await contextFactory(input);
    const contextAssessment = contextCoordinator?.assess({
      packet: { ...rawPacket, threadId: input.threadId },
      contextWindow: input.contextWindow || input.modelRoute?.contextWindow || input.model?.contextWindow,
      maxOutputTokens: input.maxOutputTokens || input.modelRoute?.maxOutputTokens || input.model?.maxTokens,
      usageTokens: input.contextUsageTokens,
    }) || null;
    const packet = contextAssessment?.packet || rawPacket;
    const resolvedSkills = skillProjectionEnabled
      ? input.skillSet || resolveSkillSet(await (skillResolver?.(input) || {}))
      : resolveSkillSet();
    const adapter = adapterMap.get(input.runtimeId);
    const modelRoute = lane.type === 'work_task' && existing?.metadata?.modelRoute
      ? existing.metadata.modelRoute
      : input.modelRoute || {};
    let executionRealm = createRuntimeExecutionRealm({
      runtimeId: input.runtimeId,
      runtimeBinding,
      modelRoute,
      agentId: input.agent.id,
      skillSetRevision: resolvedSkills.revision,
      runtimeConfigRevision: input.runtimeConfigRevision || '',
    });
    if (lane.type === 'work_task' && existing?.executionRealmRevision) {
      executionRealm = { ...executionRealm, id: `realm_${existing.executionRealmRevision.slice(0, 24)}`, revision: existing.executionRealmRevision };
    }
    const realmChanged = Boolean(existing?.executionRealmRevision && existing.executionRealmRevision !== executionRealm.revision);
    if (lane.type === 'chat' && existing?.nativeSessionId && realmChanged) {
      await Promise.resolve(adapter?.disposeSession?.(existing.id, { runtimeBinding, executionRealm })).catch(() => {});
      existing = store.upsertSession({
        ...existing,
        nativeSessionId: '',
        lifecycleState: 'recovering',
        resumeStrategy: 'handoff_resumed',
        checkpoint: {
          ...existing.checkpoint,
          previousNativeSessionId: existing.nativeSessionId,
          previousExecutionRealmRevision: existing.executionRealmRevision,
          reason: 'execution_realm_changed',
        },
      });
    }
    const skillRevisionChanged = Boolean(existing && existing.skillSetRevision !== resolvedSkills.revision
      && (existing.skillSetRevision || resolvedSkills.skills.length));
    const skillRestartRequired = Boolean(existing?.nativeSessionId && skillRevisionChanged && adapter?.skillHotReload !== true);
    if (skillRestartRequired) {
      await Promise.resolve(adapter.disposeSession?.(existing.id)).catch(() => {});
      existing = store.upsertSession({
        ...existing,
        nativeSessionId: '',
        lifecycleState: 'recovering',
        resumeStrategy: 'handoff_resumed',
        checkpoint: { ...existing.checkpoint, previousNativeSessionId: existing.nativeSessionId, reason: 'skill_revision_changed' },
      });
    }
    const contextDelta = compileContextDelta(packet, existing, {
      profileRevision: input.profileSnapshot.revision,
      forceFull: !deltaEnabled || !existing?.nativeSessionId,
    });
    const checkpointCandidate = !existing?.nativeSessionId && Boolean(existing?.checkpoint && Object.keys(existing.checkpoint).length);
    const activated = sessions.activate({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      agentId: input.agent.id,
      workspaceId: input.workspace?.id || '',
      lane,
      profileRevision: input.profileSnapshot.revision,
      skillSetRevision: resolvedSkills.revision,
      permissionPolicyRevision: policy.revision,
      runtimeVersion: runtimeBinding?.runtimeVersion || capabilitySnapshot?.runtimeVersion || '',
      runtimeBuildId: runtimeBinding?.runtimeBuildId || '',
      activationRevision: runtimeBinding?.activationRevision || '',
      executionRealmRevision: executionRealm.revision,
      modelRouteRevision: String(modelRoute.routeRevision || ''),
      metadata: {
        ...(existing?.metadata || {}),
        handoff: packet.handoff || {},
        contextSourceIds: contextDelta.sourceIds,
        contextMemoryEntryIds: (packet.memory || []).map((entry) => String(entry.id || '')).filter(Boolean),
        contextMemoryExclusions: Array.isArray(packet.memorySelection?.excluded) ? packet.memorySelection.excluded : [],
        executionRealm,
        modelRoute,
      },
    });
    const session = store.upsertSession({
      ...activated.session,
      capabilitySnapshot,
      runtimeBinding,
      executionRealm,
      modelRoute,
      executionRealm,
      modelRoute,
      lifecycleState: existing?.nativeSessionId ? 'restoring' : checkpointCandidate ? 'recovering' : 'opening',
      resumeStrategy: checkpointCandidate ? 'handoff_resumed' : existing?.nativeSessionId ? '' : 'new_session',
    });
    const existingApplications = existing?.skillSetRevision === resolvedSkills.revision
      ? store.listSkillApplications({ sessionId: session.id })
      : [];
    const existingAppliedIds = new Set(existingApplications.filter((item) => item.status === 'applied').map((item) => item.skillId));
    const canReuseApplications = resolvedSkills.skills.every((skill) => existingAppliedIds.has(skill.id))
      && !existingApplications.some((item) => item.loadMethod === 'host_instruction');
    const skillApplication = canReuseApplications
      ? { revision: resolvedSkills.revision, receipts: existingApplications }
      : await skillProjector.apply({
        runtimeId: input.runtimeId,
        agentId: input.agent.id,
        sessionId: session.id,
        skillSet: resolvedSkills,
        requiredSkillIds: Array.from(new Set([
          ...(input.requiredSkillIds || []),
          ...(resolvedSkills.skills.some((skill) => skill.id === 'frakio-llm-wiki') ? ['frakio-llm-wiki'] : []),
        ])),
      });
    const runtimeDefinition = registry.get(input.runtimeId) || { capabilities: {} };
    return {
      ...input,
      lane,
      session,
      contextPacket: {
        ...contextPacketForAdapter(contextDelta, packet),
        hostInstructions: skillApplication.hostInstructions || [],
      },
      originalContextPacket: packet,
      contextAssessment,
      contextDelta,
      skillSet: resolvedSkills,
      skillApplications: skillApplication.receipts,
      permissionPolicy: policy,
      permissionCoverage: permissionBrokerEnabled
        ? permissionCoverageForRuntime(input.runtimeId, runtimeDefinition.capabilities)
        : 'unobservable',
      capabilitySnapshot,
      runtimeBinding,
      resumeCandidate: Boolean(existing?.nativeSessionId),
      handoffCandidate: checkpointCandidate,
      featureState: {
        platformEnabled,
        laneEnabled,
        deltaEnabled,
        skillProjectionEnabled,
        permissionBrokerEnabled,
      },
    };
  }

  function createRun(prepared, input = {}) {
    const run = store.createRun({
      id: input.id,
      sessionId: prepared.session.id,
      runtimeId: prepared.runtimeId,
      threadId: prepared.threadId,
      agentId: prepared.agent.id,
      turnId: input.turnId,
      profileRevision: prepared.profileSnapshot.revision,
      modelId: input.modelId || '',
      status: 'queued',
      phase: 'opening',
      contextWatermarkFrom: prepared.contextDelta.fromWatermark,
      contextWatermarkTo: prepared.contextDelta.toWatermark,
      skillSetRevision: prepared.skillSet.revision,
      permissionPolicyRevision: prepared.permissionPolicy.revision,
      permissionCoverage: prepared.permissionCoverage,
      runtimeVersion: prepared.runtimeBinding?.runtimeVersion || prepared.session.runtimeVersion || '',
      runtimeBuildId: prepared.runtimeBinding?.runtimeBuildId || prepared.session.runtimeBuildId || '',
      activationRevision: prepared.runtimeBinding?.activationRevision || prepared.session.activationRevision || '',
      executionRealmRevision: prepared.executionRealm?.revision || prepared.session.executionRealmRevision || '',
      modelRouteRevision: String(prepared.modelRoute?.routeRevision || prepared.session.modelRouteRevision || ''),
      metadata: { ...(input.metadata || {}), permissionPolicy: prepared.permissionPolicy },
    });
    events.append({ runId: run.id, type: 'run.accepted', payload: {
      turnId: run.turnId,
      agentId: run.agentId,
      runtimeId: run.runtimeId,
      runtimeVersion: run.runtimeVersion,
      runtimeBuildId: run.runtimeBuildId,
      lane: prepared.lane,
      profileRevision: run.profileRevision,
    } });
    events.append({ runId: run.id, type: 'permission.coverage_changed', payload: {
      permissionPolicyRevision: prepared.permissionPolicy.revision,
      mode: prepared.permissionPolicy.mode,
      coverage: prepared.permissionCoverage,
    } });
    for (const application of prepared.skillApplications) {
      events.append({
        runId: run.id,
        type: application.status === 'applied' ? 'skill.applied' : application.status === 'failed' || application.status === 'incompatible' ? 'skill.apply_failed' : 'skill.application_started',
        payload: application,
      });
    }
    events.append({ runId: run.id, type: prepared.resumeCandidate || prepared.handoffCandidate ? 'session.resume_started' : 'session.opening', payload: {
      sessionId: prepared.session.id,
      nativeSessionId: prepared.session.nativeSessionId,
      lane: prepared.lane,
    } });
    return run;
  }

  function markStarted(prepared, run, accepted = {}) {
    const strategy = accepted.resumeStrategy || (prepared.resumeCandidate
      ? accepted.nativeSessionId ? 'native_resumed' : 'handoff_resumed'
      : prepared.handoffCandidate ? 'handoff_resumed' : 'new_session');
    const session = sessions.markActive(prepared.session, {
      nativeSessionId: accepted.nativeSessionId || prepared.session.nativeSessionId,
      contextWatermark: prepared.contextDelta.toWatermark,
      skillSetRevision: prepared.skillSet.revision,
      permissionPolicyRevision: prepared.permissionPolicy.revision,
      resumeStrategy: strategy,
      checkpoint: { ...prepared.session.checkpoint, nativeTurnId: accepted.nativeTurnId || '', startedAt: now() },
      metadata: {
        ...prepared.session.metadata,
        nativeTurnId: accepted.nativeTurnId || '',
        contextSourceIds: prepared.contextDelta.sourceIds,
        contextMemoryEntryIds: (prepared.originalContextPacket.memory || []).map((entry) => String(entry.id || '')).filter(Boolean),
        contextMemoryExclusions: Array.isArray(prepared.originalContextPacket.memorySelection?.excluded) ? prepared.originalContextPacket.memorySelection.excluded : [],
      },
    });
    const currentRun = store.getRun(run.id);
    store.updateRun(run.id, {
      status: currentRun?.stopRequestedAt ? 'interrupting' : 'running',
      phase: currentRun?.phase === 'compaction' ? 'compaction' : 'model',
      nativeRunId: accepted.nativeRunId || '',
      nativeTurnId: accepted.nativeTurnId || '',
      metadata: { nativeTurnId: accepted.nativeTurnId || '', nativeRunId: accepted.nativeRunId || '' },
    });
    events.append({ runId: run.id, type: prepared.resumeCandidate || prepared.handoffCandidate ? 'session.resumed' : 'run.started', payload: {
      nativeSessionId: session.nativeSessionId,
      nativeTurnId: accepted.nativeTurnId || '',
      resumeStrategy: strategy,
    } });
    if (prepared.contextDelta.changed) events.append({ runId: run.id, type: 'context.delta_applied', payload: {
      fromWatermark: prepared.contextDelta.fromWatermark,
      toWatermark: prepared.contextDelta.toWatermark,
      sourceIds: prepared.contextDelta.sourceIds,
      full: prepared.contextDelta.full,
    } });
    for (const application of prepared.skillApplications.filter((item) => item.status === 'projecting')) {
      const applied = store.putSkillApplication({
        ...application,
        status: 'applied',
        loadMethod: application.loadMethod ? `${application.loadMethod}:runtime_start_confirmed` : 'runtime_start_confirmed',
        error: '',
      });
      events.append({ runId: run.id, type: 'skill.applied', payload: applied });
    }
    return session;
  }

  async function dispatch(prepared, run, payload = {}) {
    const adapter = adapterMap.get(prepared.runtimeId);
    if (!adapter?.startRun) throw new Error(`Runtime Adapter is not available: ${prepared.runtimeId}`);
    if (prepared.contextAssessment?.level === 'hard' && contextCoordinator) {
      store.updateRun(run.id, { status: 'running', phase: 'compaction' });
      const checkpoint = await contextCoordinator.compact({
        threadId: run.threadId,
        runId: run.id,
        runtimeId: run.runtimeId,
        modelId: run.modelId,
        trigger: prepared.contextTrigger || 'threshold',
        strategy: 'host',
        packet: prepared.originalContextPacket,
        records: prepared.contextAssessment.records,
        tokensBefore: prepared.contextAssessment.tokens,
        emit: (type, eventPayload) => events.append({ runId: run.id, type, payload: eventPayload, hostVisible: true }),
      });
      const compactedPacket = contextCoordinator.compile(prepared.originalContextPacket, checkpoint);
      const fullDelta = compileContextDelta(compactedPacket, null, { profileRevision: prepared.profileSnapshot.revision, forceFull: true });
      prepared.contextPacket = contextPacketForAdapter(fullDelta, compactedPacket);
      prepared.originalContextPacket = compactedPacket;
      prepared.contextDelta = fullDelta;
      store.updateRun(run.id, { phase: 'opening', contextWatermarkTo: fullDelta.toWatermark });
    } else if (prepared.contextAssessment?.level === 'soft' && contextCoordinator) {
      void contextCoordinator.compact({
        threadId: run.threadId,
        runId: run.id,
        runtimeId: run.runtimeId,
        modelId: run.modelId,
        trigger: prepared.contextTrigger || 'threshold',
        strategy: 'host_background',
        packet: prepared.originalContextPacket,
        records: prepared.contextAssessment.records,
        tokensBefore: prepared.contextAssessment.tokens,
        emit: (type, eventPayload) => events.append({ runId: run.id, type, payload: eventPayload, hostVisible: true }),
      }).catch(() => {});
    }
    if (typeof payload.refreshContext === 'function') payload = await payload.refreshContext(prepared, payload);
    const { refreshContext: _refreshContext, ...dispatchPayload } = payload;
    const initialPayload = {
      ...dispatchPayload,
      runId: run.id,
      sessionId: prepared.session.id,
      nativeSessionId: prepared.session.nativeSessionId,
      profileSnapshot: prepared.profileSnapshot,
      contextPacket: prepared.contextPacket,
      runtimeBinding: prepared.runtimeBinding,
      executionRealm: prepared.executionRealm,
      modelRoute: prepared.modelRoute,
    };
    try {
      const accepted = await adapter.startRun(initialPayload);
      if (accepted?.status === 'unsupported') throw Object.assign(new Error(`Runtime Adapter cannot run ${prepared.runtimeId}.`), { code: 'RUNTIME_ADAPTER_UNSUPPORTED' });
      const stopped = store.getRun(run.id)?.stopRequestedAt;
      if (stopped) await Promise.resolve(adapter.cancel?.(prepared.session.id, { runId: run.id, nativeSessionId: accepted?.nativeSessionId || '' })).catch(() => {});
      return { ...accepted, resumeStrategy: prepared.resumeCandidate ? 'native_resumed' : prepared.handoffCandidate ? 'handoff_resumed' : 'new_session' };
    } catch (error) {
      if (!prepared.resumeCandidate) {
        sessions.fail(prepared.session, error.message || String(error));
        throw error;
      }
      events.append({ runId: run.id, type: 'session.resume_failed', payload: {
        nativeSessionId: prepared.session.nativeSessionId,
        error: error.message || String(error),
        fallback: 'handoff_resumed',
      } });
      await Promise.resolve(adapter.disposeSession?.(prepared.session.id)).catch(() => {});
      store.upsertSession({ ...prepared.session, nativeSessionId: '', lifecycleState: 'recovering', resumeStrategy: 'handoff_resumed', lastError: error.message || String(error) });
      const fullDelta = compileContextDelta(prepared.originalContextPacket, null, { profileRevision: prepared.profileSnapshot.revision, forceFull: true });
      const accepted = await adapter.startRun({
        ...initialPayload,
        nativeSessionId: '',
        sessionFile: '',
        contextPacket: contextPacketForAdapter(fullDelta, prepared.originalContextPacket),
      });
      if (accepted?.status === 'unsupported') throw Object.assign(new Error(`Runtime Adapter cannot resume ${prepared.runtimeId}.`), { code: 'RUNTIME_ADAPTER_UNSUPPORTED' });
      events.append({ runId: run.id, type: 'session.recovered', payload: {
        nativeSessionId: accepted.nativeSessionId || '',
        previousNativeSessionId: prepared.session.nativeSessionId,
        resumeStrategy: 'handoff_resumed',
        checkpointId: prepared.originalContextPacket?.contextCheckpoint?.id || '',
      } });
      return { ...accepted, resumeStrategy: 'handoff_resumed' };
    }
  }

  function receipt(runId, patch = {}) {
    const run = store.getRun(runId);
    if (!run) return null;
    const session = store.getSession(run.sessionId);
    const runtimePackage = run.runtimeBuildId ? store.getRuntimePackage(run.runtimeBuildId) : null;
    const applications = store.listSkillApplications({ sessionId: session.id });
    const toolSummary = patch.toolSummary || store.eventsAfter(run.id, 0, 2000)
      .filter((event) => event.type === 'tool.completed')
      .reduce((summary, event) => {
        const name = String(event.payload?.toolName || event.payload?.tool || 'other');
        summary[name] = Number(summary[name] || 0) + 1;
        return summary;
      }, {});
    const next = {
      runId: run.id,
      sessionId: run.sessionId,
      threadId: run.threadId,
      agentId: run.agentId,
      runtimeId: run.runtimeId,
      runtimeVersion: run.runtimeVersion,
      runtimeBuildId: run.runtimeBuildId,
      runtimeSource: runtimePackage?.source || session.capabilitySnapshot?.runtimeSource || '',
      activationRevision: run.activationRevision || session.activationRevision || '',
      versionSwitchReason: String(session.checkpoint?.reason || ''),
      modelId: run.modelId,
      lane: { type: session.laneType, id: session.laneId, worktreeId: session.worktreeId },
      worktreePath: String(run.metadata?.worktreePath || ''),
      profileRevision: run.profileRevision,
      contextWatermarkFrom: run.contextWatermarkFrom,
      contextWatermarkTo: run.contextWatermarkTo,
      skillSetRevision: run.skillSetRevision,
      permissionPolicyRevision: run.permissionPolicyRevision,
      permissionCoverage: run.permissionCoverage,
      resumeStrategy: session.resumeStrategy || '',
      memoryEntryIds: Array.from(new Set(Array.isArray(session.metadata?.contextMemoryEntryIds)
        ? session.metadata.contextMemoryEntryIds.map(String).filter(Boolean)
        : [])),
      memoryExclusions: Array.isArray(session.metadata?.contextMemoryExclusions)
        ? session.metadata.contextMemoryExclusions.map((item) => ({ id: String(item.id || ''), reason: String(item.reason || '') })).filter((item) => item.id && item.reason)
        : [],
      skillApplications: applications.map((item) => ({ skillId: item.skillId, skillVersion: item.skillVersion, status: item.status, loadMethod: item.loadMethod })),
      toolSummary: Object.keys(toolSummary).length ? toolSummary : run.receipt?.toolSummary || {},
      status: patch.status || run.status,
      error: patch.error === undefined ? run.error : String(patch.error || ''),
      startedAt: run.startedAt,
      completedAt: patch.completedAt === undefined ? run.completedAt || null : patch.completedAt,
    };
    return store.updateRun(run.id, { receipt: next }).receipt;
  }

  function ingestEvent(runId, envelope = {}) {
    const run = store.getRun(runId);
    if (!run) return null;
    const event = envelope.event || envelope;
    const nativeSequence = Math.max(0, Number(envelope.nativeSequence || event.nativeSequence || 0));
    if (nativeSequence && nativeSequence <= run.lastNativeEventSequence) {
      return events.eventsAfter(runId, 0, 2000).find((item) => item.nativeEventKey === String(envelope.nativeEventKey || '')) || null;
    }
    const terminalStatus = event.type === 'run.completed' ? 'completed'
      : event.type === 'run.failed' ? 'failed'
        : event.type === 'run.cancelled' ? 'cancelled' : '';
    if (terminalStatus) {
      if (terminalTransition) {
        const before = store.getRun(runId);
        const terminalRun = terminalTransition(runId, terminalStatus, { error: event.payload?.error || '', nativeTerminal: true });
        if (!before || before.status === terminalRun?.status) return events.eventsAfter(runId, 0, 2000).find((item) => item.type === event.type) || null;
        return events.eventsAfter(runId, 0, 2000).find((item) => item.type === event.type) || null;
      }
      const terminal = store.transitionRunTerminal(runId, terminalStatus, { error: event.payload?.error || '' });
      if (!terminal.changed) return events.eventsAfter(runId, 0, 2000).find((item) => item.type === event.type) || null;
    }
    const appended = events.append({
      runId,
      nativeEventKey: String(envelope.nativeEventKey || (nativeSequence ? `${run.runtimeId}:${nativeSequence}` : '')),
      type: event.type,
      payload: event.payload || {},
    });
    const patch = nativeSequence ? { lastNativeEventSequence: nativeSequence } : {};
    if (event.type === 'run.started') {
      Object.assign(patch, {
        status: 'running',
        phase: 'model',
        nativeRunId: event.payload?.nativeRunId || event.payload?.runId || run.nativeRunId,
        nativeTurnId: event.payload?.nativeTurnId || run.nativeTurnId,
      });
    } else if (event.type === 'approval.requested') Object.assign(patch, { status: 'running', phase: 'approval' });
    else if (event.type === 'approval.resolved') Object.assign(patch, { status: 'running', phase: 'model' });
    else if (event.type === 'tool.started' || event.type === 'tool.updated') patch.phase = 'tool';
    else if (event.type === 'tool.completed') patch.phase = 'model';
    else if (event.type === 'context.compaction.started') Object.assign(patch, { status: 'running', phase: 'compaction' });
    else if (event.type === 'context.compaction.completed' || event.type === 'context.compaction.failed') patch.phase = 'model';
    if (Object.keys(patch).length) store.updateRun(runId, patch);
    return appended;
  }

  return {
    adapters: adapterMap,
    sessions,
    events,
    capability,
    prepare,
    createRun,
    dispatch,
    markStarted,
    receipt,
    ingestEvent,
    setTerminalTransition(handler) {
      terminalTransition = typeof handler === 'function' ? handler : null;
    },
    async recoverAfterRestart() {
      const recoveredSessions = sessions.reconcileAfterRestart();
      const inspectedRuns = [];
      for (const status of ['queued', 'starting', 'running', 'interrupting', 'waiting_approval']) {
        for (const run of store.listRuns({ status, limit: 1000 })) {
          const session = store.getSession(run.sessionId);
          const adapter = adapterMap.get(run.runtimeId);
          let inspection;
          try {
            inspection = await adapter?.inspectRun?.({ session, run, afterNativeSequence: run.lastNativeEventSequence });
          } catch (error) {
            inspection = { status: 'unknown', error: error?.message || String(error) };
          }
          inspectedRuns.push({ run, session, inspection: inspection || { status: 'unknown' } });
        }
      }
      return { sessions: recoveredSessions, runs: inspectedRuns };
    },
    switchRuntime({ threadId, agentId, workspaceId = '', fromRuntimeId = '', toRuntimeId }) {
      const source = fromRuntimeId ? store.findSession({ threadId, agentId, runtimeId: fromRuntimeId, workspaceId, laneType: 'chat', laneId: threadId }) : null;
      if (source) sessions.park(source, { checkpoint: { ...source.checkpoint, parkedAt: now() } });
      const target = store.findSession({ threadId, agentId, runtimeId: toRuntimeId, workspaceId, laneType: 'chat', laneId: threadId });
      return {
        sourceSession: source ? store.getSession(source.id) : null,
        targetSession: target,
        resumeCandidate: Boolean(target?.nativeSessionId || (target?.checkpoint && Object.keys(target.checkpoint).length)),
        resumeStrategy: '',
        status: 'selected_for_next_run',
      };
    },
  };
}
