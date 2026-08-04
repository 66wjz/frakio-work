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
      payload: { error: patch.error || '', hostFinalized: true },
      nativeEventKey: `host-terminal:${runId}`,
      hostVisible: true,
    });
    return terminal.run;
  }

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
    platform.events.append({
      runId,
      type: 'run.interrupting',
      payload: { requestedAt: run.stopRequestedAt, phase: run.phase },
      nativeEventKey: `host-interrupt:${runId}`,
      hostVisible: true,
    });
    const session = store.getSession(run.sessionId);
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
    reconcileAfterRestart: () => platform.recoverAfterRestart(),
  };
}
