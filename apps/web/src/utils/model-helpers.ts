// wjz新建文件，新建原因：解耦 main.tsx 中的模型选择与解析工具函数，修改时间：2026-08-17。
// 文件内容概述：处理 ModelProfile、Agent 覆盖模型、Hermes Profile 模型匹配等纯函数。
// wjz新建文件结束。

import type { Agent, AgentModelOverrides, HermesProfile, ModelProfile } from '../types/workbench';

export function modelNamesForProvider(model: ModelProfile): string[] {
  return Array.from(new Set([...(model.models || []), model.model].map((item) => String(item || '').trim()).filter(Boolean)));
}

export function modelChoiceValue(model: ModelProfile, modelName = model.model): string {
  return `${model.id}::${modelName || model.model}`;
}

export function splitModelChoiceValue(value: string): { modelId: string; modelName: string } {
  const separator = '::';
  if (!value.includes(separator)) return { modelId: value, modelName: '' };
  const [modelId, ...rest] = value.split(separator);
  return { modelId, modelName: rest.join(separator) };
}

export function resolveModelChoice(value: string, models: ModelProfile[]): { model: ModelProfile | null; modelName: string; value: string } {
  const clean = String(value || '').trim();
  const { modelId, modelName } = splitModelChoiceValue(clean);
  const model =
    models.find((item) => item.id === modelId) ||
    models.find((item) => [item.id, item.name, item.model].includes(clean)) ||
    models.find((item) => modelNamesForProvider(item).includes(modelName || clean));
  const resolvedName = modelName || (model && modelNamesForProvider(model).includes(clean) ? clean : model?.model) || '';
  return { model: model || null, modelName: resolvedName, value: model ? modelChoiceValue(model, resolvedName || model.model) : clean };
}

export function modelValueForAgent(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = ''): string {
  const override = overrides[agent.id];
  if (override && resolveModelChoice(override, models).model) return resolveModelChoice(override, models).value;
  const direct = resolveModelChoice(agent.model || '', models);
  if (direct.model) return direct.value;
  const fallback = resolveModelChoice(fallbackModelId || '', models);
  if (fallback.model) return fallback.value;
  const first = models[0];
  return first ? modelChoiceValue(first, first.model) : '';
}

export function agentDefaultModelLabel(agent: Agent, models: ModelProfile[]): string {
  const value = modelValueForAgent(agent, models);
  const choice = resolveModelChoice(value, models);
  return choice.modelName || choice.model?.model || agent.model || '未配置模型';
}

export function agentSessionModelLabel(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = ''): string {
  const override = overrides[agent.id];
  if (override) {
    const resolved = resolveModelChoice(override, models);
    return resolved.model ? `${resolved.model.name} · ${resolved.modelName || resolved.model.model}` : '已覆盖';
  }
  const resolved = modelForAgent(agent, models, overrides, fallbackModelId);
  const value = modelValueForAgent(agent, models, overrides, fallbackModelId);
  const choice = resolveModelChoice(value, models);
  return choice.model ? `${choice.model.name} · ${choice.modelName || choice.model.model}` : resolved?.name || agent.model || '未配置模型';
}

export function modelForAgent(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = ''): ModelProfile | null {
  const override = overrides[agent.id];
  return (
    resolveModelChoice(override || '', models).model ||
    resolveModelChoice(agent.model || '', models).model ||
    resolveModelChoice(fallbackModelId || '', models).model ||
    models[0] ||
    null
  );
}

export function hermesProfileModels(models: ModelProfile[]): ModelProfile[] {
  return models.filter((model) => model.baseUrl && modelNamesForProvider(model).length);
}

export function resolveHermesProfileNameForAgent(agent: Agent | null, profiles: HermesProfile[]): string {
  if (!agent) return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
  if (agent.profileName && profiles.some((profile) => profile.name === agent.profileName)) return agent.profileName;
  if (profiles.some((profile) => profile.name === agent.id)) return agent.id;
  const normalizedName = agent.name.trim().toLowerCase();
  const byName = profiles.find((profile) => profile.name.toLowerCase() === normalizedName);
  if (byName) return byName.name;
  return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
}

export function modelValueForHermesProfile(profileName: string, profiles: HermesProfile[], models: ModelProfile[]): string {
  const profile = profiles.find((item) => item.name === profileName);
  const provider = profile?.provider || '';
  const model = profile?.model || '';
  const exact = hermesProfileModels(models).find((item) => {
    const providerMatch =
      item.providerKey === provider ||
      item.provider === provider ||
      item.providerKey === provider.replace(/^custom:/, '') ||
      `custom:${item.providerKey}` === provider;
    return providerMatch && modelNamesForProvider(item).includes(model);
  });
  if (exact) return modelChoiceValue(exact, model);
  const sameModel = hermesProfileModels(models).find((item) => modelNamesForProvider(item).includes(model));
  if (sameModel) return modelChoiceValue(sameModel, model);
  return '';
}

export function profileModelLabel(profileName: string, profiles: HermesProfile[]): string {
  const profile = profiles.find((item) => item.name === profileName);
  if (!profile) return `${profileName} · 未发现 Profile`;
  return `${profile.name} · ${profile.provider || 'provider default'} / ${profile.model || 'provider default'}`;
}
