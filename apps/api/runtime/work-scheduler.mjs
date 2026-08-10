function taskKey(task) {
  return task.assigneeAgentId || 'unassigned';
}

export function createWorkScheduler({ store, defaultConcurrency = 2, leaseMs = 120000 }) {
  return {
    reconcile(workflowId) {
      const recovered = store.recoverExpiredWorkTasks(workflowId);
      const promoted = [];
      for (const task of store.listWorkTasks(workflowId, ['waiting_dependency'])) {
        const dependencies = task.dependencies || [];
        if (!dependencies.length || dependencies.every((dependencyId) => ['completed', 'done'].includes(store.getWorkTask(dependencyId)?.status))) {
          const next = store.upsertWorkTask({
            ...task,
            status: 'ready',
            idempotencyKey: task.idempotencyKey,
            metadata: { ...task.metadata, promotedAt: new Date().toISOString() },
          });
          promoted.push(next);
        }
      }
      return { recovered, promoted };
    },
    runnable(workflowId, { concurrency = defaultConcurrency, runtimeLimits = {}, occupiedAgentIds = [] } = {}) {
      const maximum = Math.max(1, Math.min(16, Number(concurrency) || defaultConcurrency));
      const active = store.listWorkTasks(workflowId, ['running', 'waiting_input']);
      const occupiedAgents = new Set([
        ...active.map(taskKey),
        ...(occupiedAgentIds || []).map((agentId) => String(agentId || '')).filter(Boolean),
      ]);
      const runtimeCounts = active.reduce((counts, task) => {
        const runtimeId = task.runtimeId || 'unassigned';
        counts[runtimeId] = (counts[runtimeId] || 0) + 1;
        return counts;
      }, {});
      const selected = [];
      for (const task of store.listWorkTasks(workflowId, ['ready'])) {
        if (active.length + selected.length >= maximum) break;
        const key = taskKey(task);
        if (occupiedAgents.has(key)) continue;
        const runtimeId = task.runtimeId || 'unassigned';
        const runtimeLimit = Math.max(1, Number(runtimeLimits[runtimeId] || maximum));
        if ((runtimeCounts[runtimeId] || 0) >= runtimeLimit) continue;
        selected.push(task);
        occupiedAgents.add(key);
        runtimeCounts[runtimeId] = (runtimeCounts[runtimeId] || 0) + 1;
      }
      return selected;
    },
    claim(taskId, input = {}) {
      return store.claimWorkTask(taskId, { leaseMs, ...input });
    },
    heartbeat(taskId, leaseToken = '') {
      return store.heartbeatWorkTask(taskId, { leaseMs, leaseToken });
    },
  };
}
