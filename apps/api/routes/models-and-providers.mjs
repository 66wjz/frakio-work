// wjz新建文件，新建原因：解耦 server.mjs 中的模型管理、模型提供商目录、OAuth 授权与能力探测路由（models-and-providers），修改时间：2026-08-18。
// 文件内容概述：/api/models, /api/model-providers/*, /api/oauth-accounts/*, /api/model-capabilities, /api/auxiliary-models, /api/auth/{codex,claude,gemini}/*。
import express from 'express';

export function createModelsAndProvidersRouter({
  readGlobalAuxiliaryModelsHandler,
  updateGlobalAuxiliaryModelsHandler,
  readState,
  writeState,
  updateState,
  publicModel,
  listOAuthAccounts,
  oauthProviderKeys,
  getOAuthCredential,
  setOAuthCredential,
  deleteOAuthCredential,
  oauthAccountSummary,
  modelCatalogCache,
  flattenProviderCatalog,
  findFrakioHermesRuntimeSync,
  capabilitiesForModels,
  catalogStatus,
  capabilityProbeStatus,
  runtimeModelNames,
  scheduleProviderCapabilityProbes,
  requestedModelProfile,
  loadProviderPresets,
  oauthProviderAuthenticated,
  oauthCatalogModel,
  oauthProviderAccessToken,
  refreshCodexOAuthModels,
  oauthProviderState,
  fetchProviderModelsForRequest,
  detectProviderConfigForRequest,
  fetchProviderModelChoicesForRequest,
  verifyProviderInferenceForModel,
  startCodexOAuthFlow,
  getCodexOAuthSession,
  refreshCodexCatalogFromToken,
  startClaudeOAuthFlow,
  submitClaudeOAuthCode,
  startGeminiOAuthFlow,
  getGeminiOAuthSession,
  saveModelHandler,
  deleteModelHandler,
  patchModelHandler,
}) {
  const router = express.Router();

  // 1. Global Auxiliary Models
  if (readGlobalAuxiliaryModelsHandler) {
    router.get('/auxiliary-models', readGlobalAuxiliaryModelsHandler);
    router.get('/hermes/config/auxiliary-models', readGlobalAuxiliaryModelsHandler);
  }
  if (updateGlobalAuxiliaryModelsHandler) {
    router.put('/auxiliary-models', updateGlobalAuxiliaryModelsHandler);
    router.put('/hermes/config/auxiliary-models', updateGlobalAuxiliaryModelsHandler);
  }

  // 2. Models List
  router.get('/models', async (_req, res) => {
    try {
      const state = await readState();
      res.json({ models: state.models.map(publicModel) });
    } catch (error) {
      res.status(500).json({ error: error.message || '读取模型列表失败。' });
    }
  });

  // 3. OAuth Accounts Management
  router.get('/oauth-accounts', async (_req, res) => {
    try {
      const state = await readState();
      const accounts = await listOAuthAccounts();
      res.json({
        accounts: accounts.map((account) => ({
          ...account,
          models: state.models
            .filter((model) => model.providerKey === account.providerKey && model.oauthAccountId === account.id)
            .map((model) => ({ id: model.id, name: model.name })),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message || '读取授权账户失败。' });
    }
  });

  router.patch('/oauth-accounts/:accountId', async (req, res) => {
    try {
      const providerKey = String(req.body?.providerKey || '').trim();
      const accountId = String(req.params.accountId || '').trim();
      const label = String(req.body?.label || '').trim().slice(0, 80);
      if (!oauthProviderKeys.has(providerKey) || !accountId || !label) {
        return res.status(400).json({ error: '授权账户参数无效。' });
      }
      const credential = await getOAuthCredential(providerKey, accountId);
      if (!credential) return res.status(404).json({ error: '授权账户不存在。' });
      const stored = await setOAuthCredential(providerKey, { ...credential, label }, accountId);
      res.json({ account: oauthAccountSummary(providerKey, stored) });
    } catch (error) {
      res.status(500).json({ error: error.message || '更新授权账户失败。' });
    }
  });

  router.delete('/oauth-accounts/:accountId', async (req, res) => {
    try {
      const providerKey = String(req.query?.providerKey || '').trim();
      const accountId = String(req.params.accountId || '').trim();
      if (!oauthProviderKeys.has(providerKey) || !accountId) {
        return res.status(400).json({ error: '授权账户参数无效。' });
      }
      const state = await readState();
      const linkedModels = state.models
        .filter((model) => model.providerKey === providerKey && model.oauthAccountId === accountId)
        .map((model) => ({ id: model.id, name: model.name }));
      if (linkedModels.length) {
        return res.status(409).json({
          error: '请先将关联模型迁移到其他账户，或删除这些模型配置。',
          code: 'OAUTH_ACCOUNT_IN_USE',
          models: linkedModels,
        });
      }
      await deleteOAuthCredential(providerKey, accountId);
      res.json({ deletedAccountId: accountId });
    } catch (error) {
      res.status(500).json({ error: error.message || '删除授权账户失败。' });
    }
  });

  // 4. Model Capabilities & Active Probing
  router.get('/model-capabilities', async (_req, res) => {
    try {
      const state = await readState();
      const providerCatalog = flattenProviderCatalog(modelCatalogCache);
      const runtime = findFrakioHermesRuntimeSync();
      res.json({
        runtimeVersion: runtime?.version || '',
        capabilities: capabilitiesForModels(state.models, { providerCatalog }),
        providers: Object.fromEntries(
          state.models.map((model) => [model.id, catalogStatus(modelCatalogCache, model)]),
        ),
        probes: Object.fromEntries(state.models.map((model) => [model.id, capabilityProbeStatus(model)])),
      });
    } catch (error) {
      res.status(500).json({ error: error.message || '获取模型能力失败。' });
    }
  });

  router.post('/models/:id/capabilities/probe', async (req, res) => {
    try {
      const state = await readState();
      const model = state.models.find((item) => item.id === req.params.id);
      if (!model) return res.status(404).json({ error: '模型 Provider 不存在。' });
      const requested = Array.from(
        new Set(
          [...(Array.isArray(req.body?.modelIds) ? req.body.modelIds : []), req.body?.modelId]
            .map((item) => String(item || '').trim())
            .filter(Boolean),
        ),
      );
      const available = new Set(runtimeModelNames(model));
      const invalid = requested.find((modelId) => !available.has(modelId));
      if (invalid) return res.status(400).json({ error: `Provider 中不存在模型 ${invalid}。` });
      const result = await scheduleProviderCapabilityProbes(model, state.models, {
        force: true,
        allowLocal: true,
        modelIds: requested,
      });
      if (result.reason === 'unavailable') {
        return res.status(409).json({ error: '当前 Provider 不支持主动能力探测。' });
      }
      if (result.reason === 'credential_missing') {
        return res.status(400).json({ error: '当前 Provider 缺少可用的 API Key。' });
      }
      res.status(202).json({ queued: result.queued, probe: capabilityProbeStatus(model) });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || '能力探测启动失败。' });
    }
  });

  // 5. Model Provider Presets
  router.get('/model-providers/presets', async (req, res) => {
    try {
      const profile = await requestedModelProfile(req);
      const selectablePresets = loadProviderPresets().filter((preset) => preset.selectable);
      const codexPreset = selectablePresets.find((preset) => preset.value === 'openai-codex');
      if (
        codexPreset &&
        oauthProviderAuthenticated(profile, codexPreset.value) &&
        catalogStatus(modelCatalogCache, oauthCatalogModel(codexPreset.value)).stale
      ) {
        const accessToken = oauthProviderAccessToken(profile, codexPreset.value);
        if (accessToken) await refreshCodexOAuthModels(accessToken).catch(() => {});
      }
      const providers = selectablePresets.map((preset) => {
        const { selectable: _selectable, ...publicPreset } = preset;
        if (!preset.authType) return { ...publicPreset, authenticated: false };
        const state = oauthProviderState(profile, preset.value);
        return { ...publicPreset, models: state.models, authenticated: state.authenticated, catalog: state.catalog };
      });
      res.json({ profile, providers });
    } catch (error) {
      res.status(500).json({ error: error.message || '获取 Provider 预设失败。' });
    }
  });

  // 6. Fetch / Detect Models & Providers
  if (fetchProviderModelsForRequest) {
    router.post('/models/fetch', async (req, res) => {
      try {
        const result = await fetchProviderModelsForRequest(req.body);
        res.json(result);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '拉取模型列表失败。' });
      }
    });
  }

  if (detectProviderConfigForRequest) {
    router.post('/model-providers/detect', async (req, res) => {
      try {
        const result = await detectProviderConfigForRequest(req.body);
        res.json(result);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '检测 Provider 配置失败。' });
      }
    });
  }

  if (fetchProviderModelChoicesForRequest) {
    router.post('/model-providers/fetch', async (req, res) => {
      try {
        const result = await fetchProviderModelChoicesForRequest(req.body);
        res.json(result);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '拉取 Provider 失败。' });
      }
    });
  }

  if (verifyProviderInferenceForModel) {
    router.post('/models/:id/verify', async (req, res) => {
      try {
        const state = await readState();
        const model = state.models.find((item) => item.id === req.params.id);
        if (!model) return res.status(404).json({ error: '模型不存在。' });
        const result = await verifyProviderInferenceForModel(model, req.body);
        res.json(result);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '验证模型推理失败。' });
      }
    });
  }

  // 7. OAuth Flows (Codex, Claude, Gemini)
  if (startCodexOAuthFlow) {
    router.post('/auth/codex/start', async (req, res) => {
      try {
        res.json(await startCodexOAuthFlow(req.body));
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '启动 Codex 授权失败。' });
      }
    });
  }
  if (getCodexOAuthSession) {
    router.get('/auth/codex/:sessionId', (req, res) => {
      const session = getCodexOAuthSession(req.params.sessionId);
      if (!session) return res.status(404).json({ error: 'OAuth session not found' });
      res.json(session);
    });
  }
  if (refreshCodexCatalogFromToken) {
    router.post('/auth/codex/catalog', async (req, res) => {
      try {
        res.json(await refreshCodexCatalogFromToken(req.body?.token));
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '刷新 Codex 模型目录失败。' });
      }
    });
  }
  if (startClaudeOAuthFlow) {
    router.post('/auth/claude/start', async (req, res) => {
      try {
        res.json(await startClaudeOAuthFlow(req.body));
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '启动 Claude 授权失败。' });
      }
    });
  }
  if (submitClaudeOAuthCode) {
    router.post('/auth/claude/:sessionId/submit', async (req, res) => {
      try {
        res.json(await submitClaudeOAuthCode(req.params.sessionId, req.body?.code));
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '提交 Claude 授权码失败。' });
      }
    });
  }
  if (startGeminiOAuthFlow) {
    router.post('/auth/gemini/start', async (req, res) => {
      try {
        res.json(await startGeminiOAuthFlow(req.body));
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || '启动 Gemini 授权失败。' });
      }
    });
  }
  if (getGeminiOAuthSession) {
    router.get('/auth/gemini/:sessionId', (req, res) => {
      const session = getGeminiOAuthSession(req.params.sessionId);
      if (!session) return res.status(404).json({ error: 'OAuth session not found' });
      res.json(session);
    });
  }

  // 8. Model CRUD (Save, Delete, Patch)
  if (saveModelHandler) {
    router.post('/models', saveModelHandler);
  }
  if (deleteModelHandler) {
    router.delete('/models/:id', deleteModelHandler);
  }
  if (patchModelHandler) {
    router.patch('/models/:id', patchModelHandler);
  }

  return router;
}
// wjz新建文件结束。
