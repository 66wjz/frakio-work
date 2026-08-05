import { randomUUID } from 'node:crypto';

function text(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((item) => typeof item === 'string' ? item : item?.text || item?.content || '').filter(Boolean).join('\n');
}

function chatRole(role) {
  return role === 'developer' ? 'system' : role;
}

function responseInputMessages(input = []) {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  const messages = [];
  for (const item of Array.isArray(input) ? input : []) {
    if (item?.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id || item.id, content: text(item.output) });
      continue;
    }
    if (item?.type === 'function_call') {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: item.call_id || item.id, type: 'function', function: { name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}) } }] });
      continue;
    }
    const content = Array.isArray(item?.content)
      ? item.content.map((part) => part?.type === 'input_text' || part?.type === 'output_text' ? { type: 'text', text: part.text || '' } : null).filter(Boolean)
      : text(item?.content);
    messages.push({ role: chatRole(item?.role || 'user'), content });
  }
  return messages;
}

function anthropicMessagesToChat(body = {}) {
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: text(body.system) });
  for (const message of body.messages || []) {
    if (!Array.isArray(message.content)) {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    const content = [];
    const toolCalls = [];
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text || '' });
      if (block.type === 'tool_use') toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
      if (block.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: text(block.content) });
    }
    if (content.length || toolCalls.length) messages.push({ role: message.role, content: content.length ? content : '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
  }
  return messages;
}

function chatTools(tools = []) {
  return tools.flatMap((tool) => {
    const name = tool?.function?.name || tool?.name;
    if (!name) return [];
    return [{
      type: 'function',
      function: {
        name,
        description: tool?.function?.description || tool?.description || '',
        parameters: tool?.function?.parameters || tool?.parameters || tool?.input_schema || { type: 'object', properties: {} },
      },
    }];
  });
}

function anthropicTools(tools = []) {
  return tools.map((tool) => tool.input_schema ? tool : { name: tool.function?.name || tool.name, description: tool.function?.description || tool.description || '', input_schema: tool.function?.parameters || tool.parameters || { type: 'object', properties: {} } });
}

export function transformBridgeRequest(body = {}, route = {}) {
  const harness = route.harnessApiMode || route.apiMode;
  const upstream = route.upstreamApiMode || route.apiMode;
  const clean = { ...body, model: route.modelId };
  for (const key of ['thinking', 'cache_control', 'betas']) delete clean[key];
  if (harness === upstream || (harness === 'openai_responses' && upstream === 'codex_responses')) return clean;
  if (harness === 'openai_responses' && upstream === 'chat_completions') {
    return {
      model: route.modelId,
      messages: responseInputMessages(body.input),
      ...(body.instructions ? { messages: [{ role: 'system', content: body.instructions }, ...responseInputMessages(body.input)] } : {}),
      ...(body.tools ? { tools: chatTools(body.tools) } : {}),
      ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
      stream: body.stream !== false,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.max_output_tokens ? { max_tokens: body.max_output_tokens } : {}),
    };
  }
  if (harness === 'openai_responses' && upstream === 'anthropic_messages') {
    const messages = responseInputMessages(body.input);
    return {
      model: route.modelId,
      system: body.instructions || undefined,
      messages: messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role === 'tool' ? 'user' : message.role, content: message.role === 'tool' ? [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }] : message.content })),
      ...(body.tools ? { tools: anthropicTools(body.tools) } : {}),
      max_tokens: body.max_output_tokens || route.maxOutputTokens || 8192,
      stream: body.stream !== false,
    };
  }
  if (harness === 'anthropic_messages' && upstream === 'chat_completions') {
    return { model: route.modelId, messages: anthropicMessagesToChat(body), ...(body.tools ? { tools: chatTools(body.tools) } : {}), stream: body.stream !== false, max_tokens: body.max_tokens };
  }
  if (harness === 'anthropic_messages' && ['openai_responses', 'codex_responses'].includes(upstream)) {
    const messages = anthropicMessagesToChat(body);
    return {
      model: route.modelId,
      instructions: messages.filter((message) => message.role === 'system').map((message) => text(message.content)).join('\n') || undefined,
      input: messages.filter((message) => message.role !== 'system').map((message) => message.role === 'tool'
        ? { type: 'function_call_output', call_id: message.tool_call_id, output: message.content }
        : { role: message.role, content: text(message.content) }),
      ...(body.tools ? { tools: body.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description || '', parameters: tool.input_schema })) } : {}),
      stream: body.stream !== false,
      max_output_tokens: body.max_tokens,
    };
  }
  throw Object.assign(new Error(`不支持的协议桥：${harness} → ${upstream}`), { code: 'RUNTIME_PROTOCOL_BRIDGE_UNSUPPORTED', status: 409 });
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || '';
  const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  if (!raw || raw === '[DONE]') return { event, data: null, done: raw === '[DONE]' };
  try { return { event, data: JSON.parse(raw), done: false }; } catch { return { event, data: null, done: false }; }
}

function responseStart(res, state) {
  if (state.started) return;
  state.started = true;
  sse(res, 'response.created', { type: 'response.created', response: { id: state.id, object: 'response', status: 'in_progress', output: [] } });
}

function responseTextDelta(res, state, delta) {
  if (!delta) return;
  responseStart(res, state);
  if (!state.textStarted) {
    state.textStarted = true;
    sse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { id: state.messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
    sse(res, 'response.content_part.added', { type: 'response.content_part.added', item_id: state.messageId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } });
  }
  state.text += delta;
  sse(res, 'response.output_text.delta', { type: 'response.output_text.delta', item_id: state.messageId, output_index: 0, content_index: 0, delta });
}

function responseToolDelta(res, state, index, id, name, delta) {
  responseStart(res, state);
  let tool = state.tools.get(index);
  if (!tool) {
    tool = { id: id || `call_${randomUUID()}`, itemId: `fc_${randomUUID()}`, name: name || '', arguments: '' };
    state.tools.set(index, tool);
    sse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: index + 1, item: { id: tool.itemId, type: 'function_call', call_id: tool.id, name: tool.name, arguments: '', status: 'in_progress' } });
  }
  if (name) tool.name = name;
  if (delta) {
    tool.arguments += delta;
    sse(res, 'response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: tool.itemId, output_index: index + 1, delta });
  }
}

function responseComplete(res, state, usage = {}) {
  responseStart(res, state);
  if (state.textStarted) {
    sse(res, 'response.output_text.done', { type: 'response.output_text.done', item_id: state.messageId, output_index: 0, content_index: 0, text: state.text });
    sse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: 0, item: { id: state.messageId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: state.text }] } });
  }
  for (const [index, tool] of state.tools) {
    sse(res, 'response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: tool.itemId, output_index: index + 1, arguments: tool.arguments });
    sse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: index + 1, item: { id: tool.itemId, type: 'function_call', call_id: tool.id, name: tool.name, arguments: tool.arguments, status: 'completed' } });
  }
  sse(res, 'response.completed', { type: 'response.completed', response: { id: state.id, object: 'response', status: 'completed', output: [], usage: { input_tokens: usage.prompt_tokens || usage.input_tokens || 0, output_tokens: usage.completion_tokens || usage.output_tokens || 0, total_tokens: usage.total_tokens || 0 } } });
  res.write('data: [DONE]\n\n');
}

function anthropicStart(res, state, usage = {}) {
  if (state.started) return;
  state.started = true;
  sse(res, 'message_start', { type: 'message_start', message: { id: state.id, type: 'message', role: 'assistant', content: [], model: state.model, stop_reason: null, usage: { input_tokens: usage.prompt_tokens || usage.input_tokens || 0, output_tokens: 0 } } });
}

function anthropicTextDelta(res, state, delta) {
  if (!delta) return;
  anthropicStart(res, state);
  if (!state.textStarted) {
    state.textStarted = true;
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  }
  state.text += delta;
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } });
}

function anthropicToolDelta(res, state, index, id, name, delta) {
  anthropicStart(res, state);
  let tool = state.tools.get(index);
  if (!tool) {
    tool = { id: id || `toolu_${randomUUID()}`, name: name || '', arguments: '' };
    state.tools.set(index, tool);
    sse(res, 'content_block_start', { type: 'content_block_start', index: index + 1, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
  }
  if (name) tool.name = name;
  if (delta) {
    tool.arguments += delta;
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: index + 1, delta: { type: 'input_json_delta', partial_json: delta } });
  }
}

function anthropicComplete(res, state, usage = {}) {
  anthropicStart(res, state, usage);
  if (state.textStarted) sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  for (const [index] of state.tools) sse(res, 'content_block_stop', { type: 'content_block_stop', index: index + 1 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: state.tools.size ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.completion_tokens || usage.output_tokens || 0 } });
  sse(res, 'message_stop', { type: 'message_stop' });
}

export async function pipeBridgedResponse(upstream, res, route = {}) {
  const harness = route.harnessApiMode || route.apiMode;
  const upstreamMode = route.upstreamApiMode || route.apiMode;
  const state = { id: `${harness === 'anthropic_messages' ? 'msg' : 'resp'}_${randomUUID()}`, messageId: `msg_${randomUUID()}`, model: route.modelId, started: false, textStarted: false, text: '', tools: new Map(), usage: {} };
  res.status(upstream.status);
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  if (!upstream.ok) {
    const errorText = await upstream.text();
    return res.end(JSON.stringify({ error: { message: errorText || 'Upstream request failed.', code: 'RUNTIME_PROTOCOL_BRIDGE_UPSTREAM' } }));
  }
  const reader = upstream.body?.getReader();
  if (!reader) return res.end();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (!parsed.data) continue;
      const data = parsed.data;
      if (upstreamMode === 'chat_completions') {
        const choice = data.choices?.[0] || {};
        const delta = choice.delta || {};
        if (harness === 'openai_responses') responseTextDelta(res, state, delta.content);
        else anthropicTextDelta(res, state, delta.content);
        for (const tool of delta.tool_calls || []) {
          if (harness === 'openai_responses') responseToolDelta(res, state, tool.index || 0, tool.id, tool.function?.name, tool.function?.arguments);
          else anthropicToolDelta(res, state, tool.index || 0, tool.id, tool.function?.name, tool.function?.arguments);
        }
        if (data.usage) state.usage = data.usage;
        if (choice.finish_reason) completed = true;
      } else if (upstreamMode === 'anthropic_messages') {
        if (data.type === 'message_start') state.usage = data.message?.usage || {};
        if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') responseToolDelta(res, state, data.index || 0, data.content_block.id, data.content_block.name, '');
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') responseTextDelta(res, state, data.delta.text);
        if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') responseToolDelta(res, state, data.index || 0, '', '', data.delta.partial_json);
        if (data.type === 'message_delta') state.usage = { ...state.usage, ...(data.usage || {}) };
        if (data.type === 'message_stop') completed = true;
      } else {
        if (data.type === 'response.output_text.delta') anthropicTextDelta(res, state, data.delta);
        if (data.type === 'response.output_item.added' && data.item?.type === 'function_call') anthropicToolDelta(res, state, data.output_index || 0, data.item.call_id, data.item.name, data.item.arguments || '');
        if (data.type === 'response.function_call_arguments.delta') anthropicToolDelta(res, state, data.output_index || 0, '', '', data.delta);
        if (data.type === 'response.completed') { state.usage = data.response?.usage || {}; completed = true; }
      }
    }
    if (done) break;
  }
  if (!state.text && !state.tools.size) {
    if (harness === 'openai_responses') {
      responseStart(res, state);
      sse(res, 'response.failed', { type: 'response.failed', response: { id: state.id, status: 'failed', error: { code: 'RUNTIME_PROTOCOL_BRIDGE_EMPTY_STREAM', message: completed ? '上游返回了空结果。' : '上游流在产生有效内容前中断。' } } });
    } else {
      sse(res, 'error', { type: 'error', error: { type: 'runtime_protocol_bridge_empty_stream', message: completed ? '上游返回了空结果。' : '上游流在产生有效内容前中断。' } });
    }
    return res.end();
  }
  if (harness === 'openai_responses') responseComplete(res, state, state.usage);
  else anthropicComplete(res, state, state.usage);
  res.end();
}
