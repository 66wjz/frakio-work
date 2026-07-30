function taskKey(task) {
  return `${task.assigneeAgentId || 'unassigned'}:${task.runtimeId || 'unassigned'}`;
}

export function createWorkScheduler({ store, defaultConcurrency = 2, leaseMs = 120000 }) {
  return {
    reconcile(workflowId) {
      const recovered = store.recoverExpiredWorkTasks(workflowId);
      const promoted = [];
      for (const task of store.listWorkTasks(workflowId, ['blocked', 'planned'])) {
        const dependencies = task.dependencies || [];
        if (!dependencies.length || dependencies.every((dependencyId) => store.getWorkTask(dependencyId)?.status === 'completed')) {
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
    runnable(workflowId, { concurrency = defaultConcurrency, runtimeLimits = {} } = {}) {
      const maximum = Math.max(1, Math.min(16, Number(concurrency) || defaultConcurrency));
      const running = store.listWorkTasks(workflowId, ['running']);
      const occupiedAgents = new Set(running.map(taskKey));
      const runtimeCounts = running.reduce((counts, task) => {
        const runtimeId = task.runtimeId || 'unassigned';
        counts[runtimeId] = (counts[runtimeId] || 0) + 1;
        return counts;
      }, {});
      const selected = [];
      for (const task of store.listWorkTasks(workflowId, ['ready'])) {
        if (running.length + selected.length >= maximum) break;
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
    heartbeat(taskId) {
      return store.heartbeatWorkTask(taskId, { leaseMs });
    },
  };
}
