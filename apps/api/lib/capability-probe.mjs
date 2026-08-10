import { normalizeCapabilityRecord, REASONING_LEVELS } from './provider-adapters.mjs';

const clean = (value) => String(value || '').trim();

function responseError(result) {
  return clean(result?.body?.error?.message || result?.error || (result?.status ? `HTTP ${result.status}` : '网络请求失败')).slice(0, 500);
}

export function classifyProbeResult(result) {
  if (result?.ok) return { status: 'accepted', error: '' };
  if (result?.status === 401 || result?.status === 403) return { status: 'auth_failed', error: responseError(result) };
  if (result?.status === 400 || result?.status === 422) return { status: 'unsupported', error: responseError(result) };
  return { status: 'unknown', error: responseError(result) };
}

function probeResult(kind, option, mappedValue, result) {
  const classified = classifyProbeResult(result);
  return { kind, option, mappedValue, ...classified };
}

function createRequestBody(modelId, patch = {}) {
  return { model: modelId, input: 'Reply OK.', max_output_tokens: 8, ...patch };
}

export function chatCapabilityProbeCandidates(model = {}) {
  const providerKey = clean(model.providerKey).toLowerCase();
  const baseUrl = clean(model.baseUrl).toLowerCase();
  const modelId = clean(model.model).toLowerCase();
  const preferred = [];
  if (providerKey.includes('openrouter') || baseUrl.includes('openrouter')) preferred.push('openrouter');
  if (providerKey.includes('deepseek') || baseUrl.includes('deepseek') || modelId.includes('deepseek')) preferred.push('deepseek');
  if (providerKey.includes('qwen') || baseUrl.includes('dashscope') || modelId.includes('qwen')) preferred.push('qwen', 'chat_template');
  if (providerKey.includes('zai') || baseUrl.includes('bigmodel') || /(?:^|[/_-])glm/.test(modelId)) preferred.push('zai');
  return Array.from(new Set([...preferred, 'openai', 'openrouter', 'deepseek', 'qwen', 'chat_template', 'zai'])).map((format) => {
    if (format === 'openrouter') return { format, off: { reasoning: { effort: 'none' } }, on: { reasoning: { effort: 'high' } }, effort: 'high' };
    if (format === 'deepseek') return { format, off: { thinking: { type: 'disabled' } }, on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, effort: 'high' };
    if (format === 'qwen') return { format, off: { enable_thinking: false }, on: { enable_thinking: true }, effort: 'high' };
    if (format === 'chat_template') return { format, off: { chat_template_kwargs: { enable_thinking: false } }, on: { chat_template_kwargs: { enable_thinking: true } }, effort: 'high' };
    if (format === 'zai') return { format, off: { thinking: { type: 'disabled' } }, on: { thinking: { type: 'enabled' } }, effort: 'high' };
    return { format: 'openai', off: { reasoning_effort: 'none' }, on: { reasoning_effort: 'low' }, effort: 'low' };
  });
}

export async function probeChatCapabilities({ model, modelId, request, onStage = () => {} }) {
  const results = [];
  let acceptedFormat = null;
  onStage('正在探测推理档位');
  for (const candidate of chatCapabilityProbeCandidates({ ...model, model: modelId })) {
    const disabled = await request(candidate.off);
    const disabledResult = probeResult('reasoning', 'off', 'none', disabled);
    results.push(disabledResult);
    if (disabledResult.status === 'auth_failed') throw Object.assign(new Error(`配置验证失败：${disabledResult.error}`), { status: 401 });
    if (!disabled?.ok) continue;
    const enabled = await request(candidate.on);
    const enabledResult = probeResult('reasoning', candidate.effort, candidate.effort, enabled);
    results.push(enabledResult);
    if (enabledResult.status === 'auth_failed') throw Object.assign(new Error(`配置验证失败：${enabledResult.error}`), { status: 401 });
    if (enabled?.ok) {
      acceptedFormat = candidate;
      break;
    }
  }

  onStage('正在检测快速模式');
  const priority = await request({ service_tier: 'priority' });
  const priorityResult = probeResult('service_tier', 'priority', 'priority', priority);
  results.push(priorityResult);
  if (priorityResult.status === 'auth_failed') throw Object.assign(new Error(`配置验证失败：${priorityResult.error}`), { status: 401 });

  const reasoningStatus = acceptedFormat
    ? 'confirmed'
    : results.filter((item) => item.kind === 'reasoning').some((item) => item.status === 'unknown') ? 'unknown' : 'unsupported';
  const serviceTierStatus = priorityResult.status === 'accepted' ? 'confirmed' : priorityResult.status === 'unsupported' ? 'unsupported' : 'unknown';
  const reasoningMap = acceptedFormat ? { off: 'none', [acceptedFormat.effort]: acceptedFormat.effort } : {};
  const serviceTiers = priorityResult.status === 'accepted'
    ? [{ id: 'priority', name: '快速', description: '中转线路接受 Priority 服务层', requestValue: 'priority', billingNotice: '厂商可能额外计费' }]
    : [];
  const status = acceptedFormat || serviceTiers.length
    ? 'confirmed'
    : reasoningStatus === 'unsupported' && serviceTierStatus === 'unsupported' ? 'unsupported' : 'unknown';
  const verifiedAt = new Date().toISOString();
  return {
    capability: normalizeCapabilityRecord({
      modelId,
      defaultReasoning: acceptedFormat?.effort || '',
      reasoningMap,
      serviceTiers,
      thinkingFormat: acceptedFormat?.format || '',
      source: 'active_probe',
      confidence: 'inferred',
      status,
      reasoningStatus,
      serviceTierStatus,
      updatedAt: verifiedAt,
    }, modelId),
    probeResults: results,
    verifiedAt,
  };
}

export async function probeAnthropicCapabilities({ modelId, request, onStage = () => {} }) {
  const results = [];
  const reasoningMap = {};
  onStage('正在探测推理档位');
  for (const level of ['low', 'medium', 'high', 'max']) {
    const result = probeResult('reasoning', level, level, await request({ thinking: { type: 'adaptive' }, output_config: { effort: level } }));
    results.push(result);
    if (result.status === 'auth_failed') throw Object.assign(new Error(`配置验证失败：${result.error}`), { status: 401 });
    if (result.status === 'accepted') reasoningMap[level] = level;
    else if (result.status === 'unsupported') reasoningMap[level] = null;
  }
  if (Object.values(reasoningMap).some((value) => typeof value === 'string')) reasoningMap.off = 'none';

  onStage('正在检测快速模式');
  const fastResult = probeResult('service_tier', 'fast', 'fast', await request({ speed: 'fast' }));
  results.push(fastResult);
  if (fastResult.status === 'auth_failed') throw Object.assign(new Error(`配置验证失败：${fastResult.error}`), { status: 401 });
  const acceptedReasoning = Object.values(reasoningMap).some((value) => typeof value === 'string');
  const reasoningStatus = acceptedReasoning ? 'confirmed' : results.filter((item) => item.kind === 'reasoning').every((item) => item.status === 'unsupported') ? 'unsupported' : 'unknown';
  const serviceTierStatus = fastResult.status === 'accepted' ? 'confirmed' : fastResult.status === 'unsupported' ? 'unsupported' : 'unknown';
  const serviceTiers = fastResult.status === 'accepted'
    ? [{ id: 'fast', name: '快速', description: '线路接受 Anthropic Fast Mode', requestValue: 'fast', billingNotice: '厂商可能额外计费' }]
    : [];
  const status = acceptedReasoning || serviceTiers.length
    ? 'confirmed'
    : reasoningStatus === 'unsupported' && serviceTierStatus === 'unsupported' ? 'unsupported' : 'unknown';
  const verifiedAt = new Date().toISOString();
  return {
    capability: normalizeCapabilityRecord({
      modelId,
      defaultReasoning: acceptedReasoning ? 'medium' : '',
      reasoningMap,
      serviceTiers,
      source: 'active_probe',
      confidence: 'inferred',
      status,
      reasoningStatus,
      serviceTierStatus,
      updatedAt: verifiedAt,
    }, modelId),
    probeResults: results,
    verifiedAt,
  };
}

export async function probeResponsesCapabilities({ modelId, request, deadlineMs = 90000, onStage = () => {} }) {
  const startedAt = Date.now();
  const send = async (patch = {}) => {
    if (Date.now() - startedAt >= deadlineMs) return { ok: false, status: 0, error: '能力探测超过整体时间限制。' };
    try {
      return await request(createRequestBody(modelId, patch));
    } catch (error) {
      return { ok: false, status: 0, error: clean(error?.message || error) };
    }
  };

  onStage('正在验证连接');
  const baseline = await send();
  const baselineStatus = classifyProbeResult(baseline);
  if (!baseline.ok) {
    const error = new Error(`配置验证失败：${baselineStatus.error}`);
    error.status = baseline.status || 502;
    throw error;
  }

  const results = [{ kind: 'connection', option: 'standard', mappedValue: 'standard', status: 'accepted', error: '' }];
  const reasoningMap = {};
  onStage('正在探测推理档位');
  for (const level of REASONING_LEVELS) {
    const mappedValue = level === 'off' ? 'none' : level;
    const result = probeResult('reasoning', level, mappedValue, await send({ reasoning: { effort: mappedValue } }));
    if (result.status === 'auth_failed') {
      const error = new Error(`配置验证失败：${result.error}`);
      error.status = 401;
      throw error;
    }
    results.push(result);
    if (result.status === 'accepted') reasoningMap[level] = mappedValue;
    else if (result.status === 'unsupported') reasoningMap[level] = null;
  }

  onStage('正在检测快速模式');
  const priorityResult = probeResult('service_tier', 'priority', 'priority', await send({ service_tier: 'priority' }));
  if (priorityResult.status === 'auth_failed') {
    const error = new Error(`配置验证失败：${priorityResult.error}`);
    error.status = 401;
    throw error;
  }
  results.push(priorityResult);

  const reasoningResults = results.filter((item) => item.kind === 'reasoning');
  const acceptedReasoning = reasoningResults.filter((item) => item.status === 'accepted');
  const reasoningStatus = acceptedReasoning.length
    ? 'confirmed'
    : reasoningResults.every((item) => item.status === 'unsupported') ? 'unsupported' : 'unknown';
  const serviceTierStatus = priorityResult.status === 'accepted' ? 'confirmed' : priorityResult.status === 'unsupported' ? 'unsupported' : 'unknown';
  const serviceTiers = priorityResult.status === 'accepted'
    ? [{ id: 'priority', name: '快速', description: '中转线路接受 Priority 服务层', requestValue: 'priority', billingNotice: '厂商可能额外计费' }]
    : [];
  const status = acceptedReasoning.length || serviceTiers.length
    ? 'confirmed'
    : reasoningStatus === 'unsupported' && serviceTierStatus === 'unsupported' ? 'unsupported' : 'unknown';
  const verifiedAt = new Date().toISOString();
  const capability = normalizeCapabilityRecord({
    modelId,
    defaultReasoning: acceptedReasoning[0]?.option || '',
    reasoningMap,
    serviceTiers,
    source: 'active_probe',
    confidence: 'inferred',
    status,
    reasoningStatus,
    serviceTierStatus,
    updatedAt: verifiedAt,
  }, modelId);

  return { capability, probeResults: results, verifiedAt };
}
