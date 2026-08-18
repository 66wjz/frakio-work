// wjz新建文件，新建原因：解耦 server.mjs 中的协作规划模式、提问交互、Plan 执行反馈与 Council 仿真路由（collaboration-and-kanban），修改时间：2026-08-18。
// 文件内容概述：/api/threads/:id/plans/*, /api/council/simulate。
import express from 'express';
import { createHash } from 'node:crypto';

export function createCollaborationAndKanbanRouter({
  readState,
  writeState,
  updateState,
  activePlanSession = (thread) => thread?.planSessions?.find((p) => p.id === thread?.activePlanId) || null,
  autoResolvePlanQuestionBatch = () => null,
  publicPlanSession = (plan) => plan,
  hasActivePlanningSession = (thread) => Boolean(thread?.activePlanId),
  createPlanQuestionBatch = (_plan, body) => ({ id: 'batch', questions: body?.questions || [] }),
  resolvePlanQuestionBatch = () => ({ id: 'batch', questions: [] }),
  cancelPlanQuestionBatch = () => ({ id: 'batch', questions: [] }),
  submitPlanReviewProposal = () => null,
  recordPlanUserFeedback = () => null,
  cancelPlanSession = () => null,
  executeApprovedPlanSession,
  simulateCouncilRun,
  captureTelemetry = () => {},
  now = () => Date.now(),
}) {
  const router = express.Router();

  // 1. SSE Stream for Plan Events
  router.get('/threads/:id/plans/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    let lastDigest = '';
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    while (!closed) {
      try {
        const state = await readState();
        const thread = state.threads.find((item) => item.id === req.params.id);
        if (!thread) {
          res.write(`data: ${JSON.stringify({ event: 'plan.not_found' })}\n\n`);
          break;
        }
        const plan = activePlanSession(thread);
        let autoResolved = false;
        if (plan) {
          for (const batch of plan.questions || []) {
            if (batch.status === 'pending' && batch.autoResolutionMs) {
              const before = batch.status;
              autoResolvePlanQuestionBatch(plan, batch.id, now());
              if (before !== batch.status) autoResolved = true;
            }
          }
        }
        if (autoResolved) await writeState(state);
        const payload = {
          event: 'plan.snapshot',
          collaborationMode: thread.collaborationMode,
          activePlanId: thread.activePlanId || '',
          plan: publicPlanSession(plan),
        };
        const digest = createHash('sha1').update(JSON.stringify(payload)).digest('hex');
        if (digest !== lastDigest) {
          lastDigest = digest;
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } else {
          res.write(': keep-alive\n\n');
        }
      } catch (error) {
        res.write(`data: ${JSON.stringify({ event: 'plan.error', error: String(error?.message || error) })}\n\n`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    res.end();
  });

  // 2. Ask Plan Questions
  router.post('/threads/:id/plans/:planId/questions', async (req, res) => {
    try {
      const result = await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
        if (!thread || !plan) return null;
        if (thread.activePlanId !== plan.id || !hasActivePlanningSession(thread)) {
          throw Object.assign(new Error('Plan session is not active.'), { status: 409, code: 'PLAN_NOT_ACTIVE' });
        }
        const batch = createPlanQuestionBatch(plan, req.body || {}, now());
        thread.updatedAt = now();
        return { batch, plan: publicPlanSession(plan) };
      });
      if (!result) return res.status(404).json({ error: 'Plan session not found.' });
      captureTelemetry('plan_question_requested', {
        question_count: result.batch.questions.length,
        auto_resolve: Boolean(result.batch.autoResolutionMs),
      });
      res.json(result);
    } catch (error) {
      res
        .status(error.status || 500)
        .json({ error: error.message || 'Plan question request failed.', code: error.code || '', details: error.details || {} });
    }
  });

  // 3. Get Plan Question Request Status
  router.get('/threads/:id/plans/:planId/questions/:requestId', async (req, res) => {
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
      if (!thread || !plan) return res.status(404).json({ error: 'Plan session not found.' });
      const batch = autoResolvePlanQuestionBatch(plan, req.params.requestId, now());
      if (!batch) return res.status(404).json({ error: 'Plan question request not found.' });
      if (batch.status === 'auto_resolved') await writeState(state);
      res.json({ batch, planStatus: plan.status });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Plan question read failed.', code: error.code || '' });
    }
  });

  // 4. Answer Plan Questions
  router.post('/threads/:id/plans/:planId/questions/:requestId/answer', async (req, res) => {
    try {
      const result = await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
        if (!thread || !plan) return null;
        const batch = resolvePlanQuestionBatch(plan, req.params.requestId, req.body?.answers || {}, now());
        thread.updatedAt = now();
        return { batch, plan: publicPlanSession(plan) };
      });
      if (!result) return res.status(404).json({ error: 'Plan session not found.' });
      captureTelemetry('plan_question_answered', { question_count: result.batch.questions.length });
      res.json(result);
    } catch (error) {
      res
        .status(error.status || 500)
        .json({ error: error.message || 'Plan answer failed.', code: error.code || '', details: error.details || {} });
    }
  });

  // 5. Cancel Plan Question Batch
  router.post('/threads/:id/plans/:planId/questions/:requestId/cancel', async (req, res) => {
    try {
      const result = await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
        if (!thread || !plan) return null;
        const batch = cancelPlanQuestionBatch(plan, req.params.requestId, now());
        thread.updatedAt = now();
        return { batch, plan: publicPlanSession(plan) };
      });
      if (!result) return res.status(404).json({ error: 'Plan session not found.' });
      res.json(result);
    } catch (error) {
      res
        .status(error.status || 500)
        .json({ error: error.message || 'Plan question cancel failed.', code: error.code || '', details: error.details || {} });
    }
  });

  // 6. Submit Plan Proposal
  router.post('/threads/:id/plans/:planId/submit', async (req, res) => {
    try {
      const result = await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
        if (!thread || !plan) return null;
        const proposal = submitPlanReviewProposal(plan, req.body || {}, now());
        thread.updatedAt = now();
        return { proposal, plan: publicPlanSession(plan) };
      });
      if (!result) return res.status(404).json({ error: 'Plan session not found.' });
      res.json(result);
    } catch (error) {
      res
        .status(error.status || 500)
        .json({ error: error.message || 'Plan proposal submit failed.', code: error.code || '', details: error.details || {} });
    }
  });

  // 7. Record Plan Feedback
  router.post('/threads/:id/plans/:planId/feedback', async (req, res) => {
    try {
      const result = await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
        if (!thread || !plan) return null;
        const feedback = recordPlanUserFeedback(plan, req.body?.feedback, now());
        thread.updatedAt = now();
        return { feedback, plan: publicPlanSession(plan) };
      });
      if (!result) return res.status(404).json({ error: 'Plan session not found.' });
      res.json(result);
    } catch (error) {
      res
        .status(error.status || 500)
        .json({ error: error.message || 'Plan feedback failed.', code: error.code || '', details: error.details || {} });
    }
  });

  // 8. Cancel Plan Session
  router.post('/threads/:id/plans/:planId/cancel', async (req, res) => {
    try {
      const result = await updateState(async (state) => {
        const thread = state.threads.find((item) => item.id === req.params.id);
        const plan = thread?.planSessions?.find((item) => item.id === req.params.planId);
        if (!thread || !plan) return null;
        cancelPlanSession(thread, plan, now());
        thread.updatedAt = now();
        return { plan: publicPlanSession(plan), thread };
      });
      if (!result) return res.status(404).json({ error: 'Plan session not found.' });
      res.json(result);
    } catch (error) {
      res
        .status(error.status || 500)
        .json({ error: error.message || 'Plan session cancel failed.', code: error.code || '', details: error.details || {} });
    }
  });

  // 9. Execute Approved Plan
  if (executeApprovedPlanSession) {
    router.post('/threads/:id/plans/:planId/execute', async (req, res) => {
      try {
        const result = await executeApprovedPlanSession(req.params.id, req.params.planId, req.body);
        res.json(result);
      } catch (error) {
        res
          .status(error.status || 500)
          .json({ error: error.message || 'Plan execution failed.', code: error.code || '', details: error.details || {} });
      }
    });
  }

  // 10. Council Simulate
  if (simulateCouncilRun) {
    router.post('/council/simulate', simulateCouncilRun);
  }

  return router;
}
// wjz新建文件结束。
