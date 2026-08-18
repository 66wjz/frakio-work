// wjz新建文件，新建原因：解耦 server.mjs 中的工作区、空间、知识库 Vaults、Onboarding 与监控概要路由（workspaces-and-vaults），修改时间：2026-08-18。
// 文件内容概述：/api/state, /api/state/ui, /api/telemetry/*, /api/spaces/*, /api/workspaces/*, /api/vaults/*, /api/onboarding/*。
import express from 'express';

export function createWorkspacesAndVaultsRouter({
  readState,
  writeState,
  updateState,
  readMonitoringLogs,
  readHermesDbSummary,
  readHermesAgentUsageRows,
  aggregateModelUsage,
  collectModuleUsage,
  collectAgentUsage,
  captureTelemetry = () => {},
  captureMeaningfulActivity = () => {},
  now = () => Date.now(),
}) {
  const router = express.Router();

  // 1. User Profile Summary
  router.get('/user-profile/summary', async (_req, res) => {
    try {
      const state = await readState();
      const hermesUsage = await readHermesAgentUsageRows();
      const usage = aggregateModelUsage(
        [
          ...hermesUsage.rows,
          ...(state.observability?.modelUsage || []).map((row) => ({
            ...row,
            dataSource: row.dataSource || 'Frakio Work local usage',
          })),
        ],
        state.models || [],
      );
      const peakDay = (usage.byDay || []).reduce(
        (peak, row) =>
          Number(row.realTotalTokens || row.totalTokens || 0) > Number(peak.realTotalTokens || peak.totalTokens || 0)
            ? row
            : peak,
        { day: '', totalTokens: 0, realTotalTokens: 0 },
      );
      const agents = collectAgentUsage ? collectAgentUsage(state) : [];
      const skills = collectModuleUsage ? collectModuleUsage(state, 'skills') : [];
      const plugins = collectModuleUsage ? collectModuleUsage(state, 'plugins') : [];
      res.json({
        checkedAt: now(),
        userProfile: state.userProfile,
        stats: {
          totalTokens: Number(usage.realTotalTokens || usage.totalTokens || 0),
          peakDayTokens: Number(peakDay.realTotalTokens || peakDay.totalTokens || 0),
          peakDay: peakDay.day || '',
          requests: Number(usage.totalRequests || 0),
          conversations: (state.threads || []).length,
          activeAgents: agents.filter((agent) => agent.conversationCount > 0 || agent.messageCount > 0).length,
        },
        usage: {
          byDay: usage.byDay || [],
          entries: usage.entries || [],
        },
        hermesAgent: hermesUsage.meta,
        agents,
        modules: { skills, plugins },
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: String(error?.message || error) });
    }
  });

  // 2. Monitoring Summary
  router.get('/monitoring/summary', async (_req, res) => {
    try {
      const state = await readState();
      const logs = await readMonitoringLogs(160);
      const hermesDb = await readHermesDbSummary();
      const hermesUsage = await readHermesAgentUsageRows();
      const hermesUsageRows = hermesUsage.rows;
      const workbenchUsageRows = (state.observability?.modelUsage || [])
        .filter((row) => row.dataSource !== 'Hermes Agent' && row.provider !== 'Hermes Agent')
        .map((row) => ({ ...row, dataSource: row.dataSource || 'Frakio Work local usage' }));
      const usageRows = [...hermesUsageRows, ...workbenchUsageRows];
      res.json({
        checkedAt: now(),
        logs,
        modelRuns: (state.observability?.modelRuns || []).slice(-200).reverse(),
        usage: aggregateModelUsage(usageRows, state.models || []),
        hermesStudio: {
          databaseExists: hermesDb.exists,
          roomCount: hermesDb.rooms.length,
          sessionCount: hermesDb.sessions.length,
          usageRowCount: hermesUsageRows.length,
          usageSource: 'legacy hermes-web-ui db',
        },
        hermesAgent: hermesUsage.meta,
        modules: {
          skills: collectModuleUsage ? collectModuleUsage(state, 'skills') : [],
          plugins: collectModuleUsage ? collectModuleUsage(state, 'plugins') : [],
        },
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: String(error?.message || error) });
    }
  });

  return router;
}
// wjz新建文件结束。
