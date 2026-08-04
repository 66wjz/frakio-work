export function createRuntimeOutputState() {
  return { text: '', activityGroupOpen: false };
}

export function appendRuntimeOutputDelta(outputState, delta) {
  const state = outputState || createRuntimeOutputState();
  const text = String(delta || '');
  if (!text) return state;
  state.text += text;
  // A new assistant segment starts a fresh activity group on the next tool call.
  state.activityGroupOpen = false;
  return state;
}
