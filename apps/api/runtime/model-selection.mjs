export function splitModelSelection(value) {
  const raw = String(value || '').trim();
  const separator = '::';
  if (!raw.includes(separator)) return { modelId: raw, modelName: '' };
  const [modelId, ...rest] = raw.split(separator);
  return { modelId: modelId.trim(), modelName: rest.join(separator).trim() };
}

export function modelNames(model = {}) {
  return Array.from(new Set([
    ...(Array.isArray(model.models) ? model.models : []),
    model.model,
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

export function modelSelectionValue(model, modelName = '') {
  const selectedName = String(modelName || model?.model || modelNames(model)[0] || '').trim();
  return model?.id && selectedName ? `${model.id}::${selectedName}` : '';
}

export function resolveModelSelection(modelValue, models = []) {
  const raw = String(modelValue || '').trim();
  const { modelId, modelName } = splitModelSelection(raw);
  const normalized = Array.isArray(models) ? models : [];
  const byProfileId = normalized.find((model) => model.id === modelId);
  if (byProfileId) {
    const availableNames = modelNames(byProfileId);
    const selectedName = modelName || byProfileId.model || availableNames[0] || '';
    if (modelName && !availableNames.includes(modelName)) {
      return { selectedModel: null, selectedName: modelName, selectionValue: '', requestedValue: raw };
    }
    return {
      selectedModel: byProfileId,
      selectedName,
      selectionValue: modelSelectionValue(byProfileId, selectedName),
      requestedValue: raw,
    };
  }

  const byConcreteModel = normalized.find((model) => modelNames(model).includes(raw));
  if (byConcreteModel) {
    return {
      selectedModel: byConcreteModel,
      selectedName: raw,
      selectionValue: modelSelectionValue(byConcreteModel, raw),
      requestedValue: raw,
    };
  }

  const byProfileLabel = normalized.find((model) => model.name === raw);
  if (byProfileLabel) {
    const selectedName = byProfileLabel.model || modelNames(byProfileLabel)[0] || '';
    return {
      selectedModel: byProfileLabel,
      selectedName,
      selectionValue: modelSelectionValue(byProfileLabel, selectedName),
      requestedValue: raw,
    };
  }

  return {
    selectedModel: null,
    selectedName: modelName || raw,
    selectionValue: '',
    requestedValue: raw,
  };
}

export function resolveModelSelectionByPrecedence({ threadModel = '', agentModel = '', globalModel = '', models = [] } = {}) {
  const candidates = [
    ['thread', threadModel],
    ['agent', agentModel],
    ['global', globalModel],
  ];
  for (const [source, value] of candidates) {
    if (!String(value || '').trim()) continue;
    return { ...resolveModelSelection(value, models), source };
  }
  return { ...resolveModelSelection('', models), source: 'fallback' };
}
