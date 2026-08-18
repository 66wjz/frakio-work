// wjz新建文件，新建原因：解耦 server.mjs 中的会话流式推流、审批交互、主动澄清、运行停止与 Council 消息路由（threads-and-chat），修改时间：2026-08-18。
// 文件内容概述：/api/threads/:id/turns/:turnId/events, /api/threads/:id/runs/:runId/events, /api/threads/:id/runs/:runId/{approval,clarify,stop}, /api/council/send。
import express from 'express';

export function createThreadsAndChatRouter({
  readState,
  writeState,
  runtimeStore,
  hermesTurnRuntime,
  streamHermesTurnEvents,
  requestHermesBridge,
  mergeHermesWorkflowEvent,
  formatApprovalError,
  formatClarifyError,
  clarifySkipResponse,
  runtimeHostController,
  publicThreadRunState,
  clearHermesRunState,
  latestThreadRun,
  telemetryDurationBucket,
  detectTaskType,
  taskStepsForMessage,
  runAgentRoomChat,
  captureTelemetry = () => {},
  now = () => Date.now(),
}) {
  const router = express.Router();

  // 1. Stream Hermes Turn Events
  router.get('/threads/:id/turns/:turnId/events', async (req, res) => {
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      if (!thread) return res.status(404).json({ error: '会话不存在。' });
      const storedTurnExists = runtimeStore
        ? runtimeStore.listRuns({ threadId: req.params.id, limit: 1000 }).some((run) => run.turnId === req.params.turnId)
        : false;
      if (
        thread.activeRunGroup?.turnId !== req.params.turnId &&
        !hermesTurnRuntime?.has(`${req.params.id}:${req.params.turnId}`) &&
        !storedTurnExists
      ) {
        return res.status(404).json({ error: '运行轮次不存在。' });
      }
      return streamHermesTurnEvents(req, res, { turnId: req.params.turnId, agents: state.agents });
    } catch (error) {
      res.status(500).json({ error: error.message || '获取运行轮次事件失败。' });
    }
  });

  // 2. Stream Hermes Run Events
  router.get('/threads/:id/runs/:runId/events', async (req, res) => {
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      if (!thread) return res.status(404).json({ error: '会话不存在。' });
      const turnId = thread.activeRunGroup?.turnId || thread.activeRunTurnId || req.params.runId;
      return streamHermesTurnEvents(req, res, { turnId, runId: req.params.runId, agents: state.agents });
    } catch (error) {
      res.status(500).json({ error: error.message || '获取运行事件失败。' });
    }
  });

  // 3. Run Approval Response
  router.post('/threads/:id/runs/:runId/approval', async (req, res) => {
    try {
      const approvalId = String(req.body?.approvalId || req.body?.id || req.params.runId);
      if (!approvalId || approvalId === req.params.runId) {
        return res.status(400).json({ error: '这次审批缺少 approval_id，请重新发起任务。' });
      }
      const result = await requestHermesBridge(
        {
          action: 'approval_respond',
          approval_id: approvalId,
          choice: req.body?.choice || 'deny',
          session_id: req.body?.sessionId || req.query.sessionId || '',
          run_id: req.params.runId,
        },
        { timeoutMs: 10000, retryMs: 1000 },
      );
      if (result?.resolved === false) {
        return res.status(409).json({ error: '这次审批已失效，请重新发起任务。', ...result });
      }
      res.json({ ok: true, approvalId, choice: req.body?.choice || 'deny', ...result });
    } catch (error) {
      const formatFn = formatApprovalError || defaultFormatApprovalError;
      res.status(502).json({ error: formatFn(error.message || '审批响应失败。') });
    }
  });

  // 4. Run Clarification Response
  router.post('/threads/:id/runs/:runId/clarify', async (req, res) => {
    try {
      const clarifyId = String(req.body?.clarifyId || req.body?.clarify_id || '').trim();
      const action = String(req.body?.action || 'answer').trim().toLowerCase();
      const answer = String(req.body?.response || '').trim();
      if (!clarifyId) return res.status(400).json({ error: '这次提问缺少 clarify_id，请重新发起任务。' });
      if (!['answer', 'skip'].includes(action)) return res.status(400).json({ error: '不支持的提问响应。' });
      if (action === 'answer' && !answer) return res.status(400).json({ error: '请输入回答。' });
      const result = await requestHermesBridge(
        {
          action: 'clarify_respond',
          clarify_id: clarifyId,
          response:
            action === 'skip'
              ? clarifySkipResponse ||
                '[user skipped this clarification; do not assume an answer and do not ask the same question again in this run.]'
              : answer,
          session_id: req.body?.sessionId || req.query.sessionId || '',
          run_id: req.params.runId,
        },
        { timeoutMs: 10000, retryMs: 1000 },
      );
      if (result?.resolved === false) {
        return res.status(409).json({ error: '这次提问已失效，请重新发起任务。', ...result });
      }
      if (mergeHermesWorkflowEvent) {
        await mergeHermesWorkflowEvent(req.params.id, {
          event: 'clarify.responded',
          clarifyId,
          skipped: action === 'skip',
        });
      }
      res.json({ ok: true, clarifyId, action, resolved: true });
    } catch (error) {
      const formatFn = formatClarifyError || defaultFormatClarifyError;
      res.status(502).json({ error: formatFn(error.message || '提问响应失败。') });
    }
  });

  // 5. Run Stop / Interrupt
  router.post('/threads/:id/runs/:runId/stop', async (req, res) => {
    try {
      const storedRuntimeRun = runtimeStore?.getRun(req.params.runId);
      if (storedRuntimeRun) {
        const currentState = await readState();
        const currentThread = currentState.threads.find((item) => item.id === req.params.id);
        if (['completed', 'failed', 'cancelled'].includes(storedRuntimeRun.status)) {
          const state = currentState;
          const thread = currentThread;
          if (
            thread?.runStatus === 'running' &&
            (thread.activeRunId === storedRuntimeRun.nativeRunId || thread.activeRunTurnId === storedRuntimeRun.turnId)
          ) {
            thread.runStatus = storedRuntimeRun.status === 'failed' ? 'failed' : 'idle';
            if (clearHermesRunState) clearHermesRunState(thread);
            thread.updatedAt = now();
            await writeState(state);
          }
          return res.status(202).json({
            ok: true,
            resolved: true,
            alreadyTerminal: true,
            stoppedRuns: 0,
            run: publicThreadRunState(storedRuntimeRun),
            thread: thread || null,
          });
        }
        const interrupted = await runtimeHostController.interrupt(storedRuntimeRun.id);
        return res.status(202).json({
          ok: true,
          resolved: true,
          stoppedRuns: 1,
          turnId: storedRuntimeRun.turnId,
          run: publicThreadRunState(interrupted),
        });
      }
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      if (!thread) return res.status(404).json({ error: '对话不存在。', resolved: false });
      const groupRuns = Object.values(thread.activeRunGroup?.activeRuns || {});
      const requestedRun = groupRuns.find((run) => String(run.runId) === String(req.params.runId));
      if ((!thread.activeRunId || String(thread.activeRunId) !== String(req.params.runId)) && !requestedRun) {
        const latestRun = latestThreadRun(thread);
        if (
          !latestRun ||
          ['completed', 'failed', 'cancelled'].includes(latestRun.status) ||
          thread.runStatus !== 'running'
        ) {
          if (thread.runStatus === 'running') {
            thread.runStatus = latestRun?.status === 'failed' ? 'failed' : 'idle';
            if (clearHermesRunState) clearHermesRunState(thread);
            thread.updatedAt = now();
            await writeState(state);
          }
          return res.status(202).json({
            ok: true,
            resolved: true,
            alreadyTerminal: true,
            stoppedRuns: 0,
            run: publicThreadRunState(latestRun),
            thread,
          });
        }
        return res.status(409).json({
          error: '这次运行已经结束或无法停止',
          resolved: false,
          run: publicThreadRunState(latestRun),
        });
      }
      const runsToStop = req.body?.childOnly
        ? [
            requestedRun || {
              runId: req.params.runId,
              sessionId: req.body?.sessionId || req.query.sessionId || thread.activeSessionId,
            },
          ]
        : groupRuns.length
          ? groupRuns
          : [
              {
                runId: req.params.runId,
                sessionId: req.body?.sessionId || req.query.sessionId || thread.activeSessionId,
              },
            ];
      const results = await Promise.allSettled(
        runsToStop.map((run) =>
          requestHermesBridge(
            {
              action: 'interrupt',
              session_id: String(run.sessionId || ''),
              run_id: run.runId || undefined,
              message: '用户请求停止。',
            },
            { timeoutMs: 10000, retryMs: 1000 },
          ),
        ),
      );
      const stopped = results.filter((result) => result.status === 'fulfilled' && result.value?.resolved !== false).length;
      if (!stopped) return res.status(409).json({ error: '这次运行已经结束或无法停止', resolved: false });
      captureTelemetry('agent_run_stopped', {
        duration_bucket: telemetryDurationBucket ? telemetryDurationBucket(thread.activeRunStartedAt) : 'short',
      });
      res.json({ ok: true, resolved: true, stoppedRuns: stopped, turnId: thread.activeRunGroup?.turnId || '' });
    } catch (error) {
      const message = String(error?.message || '').trim();
      const expired = /unknown run|not found|expired|already (?:ended|finished)|not running|no active/i.test(message);
      if (expired) {
        const state = await readState();
        const thread = state.threads.find((item) => item.id === req.params.id);
        const latestRun = thread ? latestThreadRun(thread) : null;
        const stillActive = Boolean(
          latestRun && ['queued', 'starting', 'running', 'waiting_approval', 'interrupting'].includes(latestRun.status),
        );
        if (thread && !stillActive) {
          if (thread.runStatus === 'running') {
            thread.runStatus = latestRun?.status === 'failed' ? 'failed' : 'idle';
            if (clearHermesRunState) clearHermesRunState(thread);
            thread.updatedAt = now();
            await writeState(state);
          }
          return res.status(202).json({
            ok: true,
            resolved: true,
            alreadyTerminal: true,
            stoppedRuns: 0,
            run: publicThreadRunState(latestRun),
            thread,
          });
        }
      }
      res.status(502).json({ error: message || '停止运行失败，请重试。', resolved: false });
    }
  });

  // 6. Council Message Send
  router.post('/council/send', async (req, res) => {
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
      if (thread) {
        const message = String(req.body?.message || '').trim();
        const taskType = detectTaskType(message);
        const runSteps = taskStepsForMessage(taskType, message, 'running');
        thread.runStatus = 'running';
        thread.workflow = runSteps.map((step) => step.title);
        thread.workflowState = runSteps;
        await writeState(state);
      }
      return runAgentRoomChat(req, res);
    } catch (error) {
      res.status(500).json({ error: error.message || '发送消息失败。' });
    }
  });

  return router;
}

function defaultFormatApprovalError(message) {
  const text = String(message || '').trim();
  if (/approval_id is required|missing approval/i.test(text)) return '这次审批缺少 approval_id，请重新发起任务。';
  if (/unknown approval|not found|expired|timeout/i.test(text)) return '这次审批已失效，请重新发起任务。';
  if (/unknown action/i.test(text)) return '本机 Hermes Bridge 不支持当前审批协议，请重启 Bridge 后重试。';
  return text || '审批响应失败。';
}

function defaultFormatClarifyError(message) {
  const text = String(message || '').trim();
  if (/clarify_id is required|missing clarify/i.test(text)) return '这次提问缺少 clarify_id，请重新发起任务。';
  if (/unknown clarify|not found|expired|timeout/i.test(text)) return '这次提问已失效，请重新发起任务。';
  if (/unknown action/i.test(text)) return '本机 Hermes Bridge 不支持当前提问协议，请重启 Bridge 后重试。';
  return text || '提问响应失败。';
}
// wjz新建文件结束。
