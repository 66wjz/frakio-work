import { randomUUID } from 'node:crypto';

export function createRuntimeHostController({ platform, store }) {
  const cancellationTimers = new Map();

  function finish(runId, status, patch = {}) {
    const terminal = store.transitionRunTerminal(runId, status, patch);
    if (!terminal.changed) return terminal.run;
    clearTimeout(cancellationTimers.get(runId));
    cancellationTimers.delete(runId);
    platform.events.append({
      runId,
      type: status === 'completed' ? 'run.completed' : status === 'cancelled' ? 'run.cancelled' : 'run.failed',
      payload: { error: patch.error || '', hostFinalized: true, nativeTerminal: Boolean(patch.nativeTerminal) },
      nativeEventKey: `host-terminal:${runId}`,
      hostVisible: true,
    });
    return terminal.run;
  }

  platform.setTerminalTransition?.(finish);

  async function begin(prepareInput, runInput = {}) {
    const prepared = await platform.prepare(prepareInput);
    const run = platform.createRun(prepared, {
      ...runInput,
      id: String(runInput.id || `runtime_run_${randomUUID()}`),
    });
    return { prepared, run };
  }

  async function dispatch(prepared, run, payload = {}) {
    try {
      const accepted = await platform.dispatch(prepared, run, payload);
      const session = platform.markStarted(prepared, run, accepted);
      return { accepted, session, run: store.getRun(run.id) };
    } catch (error) {
      const current = store.getRun(run.id);
      finish(run.id, current?.stopRequestedAt ? 'cancelled' : 'failed', { error: current?.stopRequestedAt ? '' : error.message || String(error) });
      throw error;
    }
  }

  function fail(run, error) {
    if (!run) return null;
    return finish(run.id, 'failed', { error: error?.message || String(error || '') });
  }

  async function interrupt(runId, { timeoutMs = 5000 } = {}) {
    const current = store.getRun(runId);
    if (!current) return null;
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current;
    const run = store.requestRunInterrupt(runId);
    const session = store.getSession(run.sessionId);
    const cancellationCapability = session?.capabilitySnapshot?.capabilities?.cancellation;
    const cancellationUnsupported = cancellationCapability === false || cancellationCapability === 'unsupported';
    platform.events.append({
      runId,
      type: 'run.interrupting',
      payload: { requestedAt: run.stopRequestedAt, phase: run.phase, deferred: cancellationUnsupported, capability: cancellationUnsupported ? 'unsupported' : 'supported_or_unknown' },
      nativeEventKey: `host-interrupt:${runId}`,
      hostVisible: true,
    });
    if (cancellationUnsupported) {
      store.updateRun(runId, { metadata: { cancellationDeferred: true, cancellationCapability: 'unsupported' } });
      return store.getRun(runId);
    }
    const adapter = platform.adapters.get(run.runtimeId);
    void Promise.resolve(adapter?.cancel?.(session?.id || run.sessionId, { runId })).catch(() => {});
    if (!cancellationTimers.has(runId)) {
      const timer = setTimeout(async () => {
        const latest = store.getRun(runId);
        if (!latest || ['completed', 'failed', 'cancelled'].includes(latest.status)) return;
        await Promise.resolve(adapter?.disposeSession?.(latest.sessionId)).catch(() => {});
        finish(runId, 'cancelled', { metadata: { forcedSessionTermination: true } });
      }, Math.max(100, Number(timeoutMs) || 5000));
      timer.unref?.();
      cancellationTimers.set(runId, timer);
    }
    return store.getRun(runId);
  }

  return {
    begin,
    dispatch,
    fail,
    finish,
    interrupt,
    async reconcileAfterRestart() {
      const recovery = await platform.recoverAfterRestart();
      const runs = [];
      for (const item of recovery.runs) {
        const { run, inspection } = item;
        const inspectedStatus = String(inspection?.status || 'unknown');
        if (inspectedStatus === 'running') {
          runs.push(store.getRun(run.id));
          continue;
        }
        if (inspectedStatus === 'terminal') {
          const status = ['completed', 'failed', 'cancelled'].includes(inspection.runStatus) ? inspection.runStatus : 'failed';
          runs.push(finish(run.id, status, { error: inspection.error || '', metadata: { recoveredAfterRestart: true } }));
          continue;
        }
        const interrupted = run.status === 'interrupting';
        const error = interrupted ? '' : '运行因应用重启中断，可继续。';
        runs.push(finish(run.id, interrupted ? 'cancelled' : 'failed', {
          error,
          metadata: { recoveredAfterRestart: true, errorCode: 'HOST_RESTART_INTERRUPTED', inspectionStatus: inspectedStatus },
        }));
      }
      return { sessions: recovery.sessions, runs };
    },
  };
}
