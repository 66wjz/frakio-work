// wjz新建文件，新建原因：解耦 server.mjs 中的 Agent 增删改查、Profile 改名与生命周期管理路由（agents），修改时间：2026-08-18。
// 文件内容概述：/api/agents, /api/agents/:id (DELETE, PATCH)。
import express from 'express';

export function createAgentsRouter({
  readState,
  writeState,
  updateState,
  createAgentHandler,
  deleteAgentHandler,
  patchAgentHandler,
}) {
  const router = express.Router();

  if (createAgentHandler) {
    router.post('/agents', createAgentHandler);
  }

  if (deleteAgentHandler) {
    router.delete('/agents/:id', deleteAgentHandler);
  }

  if (patchAgentHandler) {
    router.patch('/agents/:id', patchAgentHandler);
  }

  return router;
}
// wjz新建文件结束。
