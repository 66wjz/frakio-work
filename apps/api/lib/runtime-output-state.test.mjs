import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRunActivityToTranscript } from './run-activity.mjs';
import { appendRuntimeOutputDelta, createRuntimeOutputState } from './runtime-output-state.mjs';

test('external runtime output state records text offsets and closes the prior tool group', () => {
  const state = createRuntimeOutputState();
  state.activityGroupOpen = true;

  appendRuntimeOutputDelta(state, '先确认城市坐标。');
  assert.equal(state.text.length, '先确认城市坐标。'.length);
  assert.equal(state.activityGroupOpen, false);

  state.activityGroupOpen = true;
  appendRuntimeOutputDelta(state, '坐标已确认，现在获取天气。');
  assert.equal(state.text, '先确认城市坐标。坐标已确认，现在获取天气。');
  assert.equal(state.activityGroupOpen, false);
});

test('empty deltas do not alter external runtime output state', () => {
  const state = createRuntimeOutputState();
  state.activityGroupOpen = true;
  appendRuntimeOutputDelta(state, '');
  assert.equal(state.text, '');
  assert.equal(state.activityGroupOpen, true);
});

test('external runtimes retain text-tool-text order for every runtime adapter', () => {
  for (const runtimeId of ['pi', 'codex', 'claude']) {
    const state = createRuntimeOutputState();
    const transcript = { runId: `${runtimeId}-run`, groups: [] };
    appendRuntimeOutputDelta(state, '先确认地点。');
    const first = applyRunActivityToTranscript(transcript, {
      tool_call_id: `${runtimeId}-geocode`, tool: 'web_search', args: { query: '慈利县坐标' }, status: 'completed',
    }, { contentOffset: state.text.length, groupOpen: state.activityGroupOpen });
    state.activityGroupOpen = first.groupOpen;

    appendRuntimeOutputDelta(state, '地点已确认，现在拉取天气。');
    const second = applyRunActivityToTranscript(first.transcript, {
      tool_call_id: `${runtimeId}-weather`, tool: 'web_search', args: { query: '慈利天气预报' }, status: 'completed',
    }, { contentOffset: state.text.length, groupOpen: state.activityGroupOpen });

    assert.deepEqual(second.transcript.groups.map((group) => group.contentOffset), [
      '先确认地点。'.length,
      state.text.length,
    ], runtimeId);
  }
});
