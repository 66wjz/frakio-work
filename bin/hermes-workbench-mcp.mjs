#!/usr/bin/env node
const workbenchUrl = String(process.env.HERMES_WORKBENCH_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const profile = String(process.env.HERMES_WORKBENCH_PROFILE || 'default');
const toolset = String(process.env.HERMES_WORKBENCH_MCP_TOOLSET || process.argv[2] || 'use').toLowerCase();
const protocolVersion = 3;
let sessionCookie = '';

const apiCatalog = [
  { method: 'GET', path: '/api/state', description: 'Frakio Work UI state and integrations' },
  { method: 'GET', path: '/api/agents', description: 'Agent list' },
  { method: 'GET', path: '/api/models', description: 'Model list' },
  { method: 'GET', path: '/api/workspaces', description: 'Project list' },
  { method: 'GET', path: '/api/workspaces/:id/threads', description: 'Project thread list' },
  { method: 'GET', path: '/api/threads/:id', description: 'Thread detail' },
  { method: 'GET', path: '/api/hermes-runtime/status', description: 'Hermes runtime status' },
  { method: 'GET', path: '/api/hermes/network-status?profile=:name', description: 'Hermes web search and read-only browser readiness' },
  { method: 'GET', path: '/api/hermes-bootstrap/status', description: 'Hermes bootstrap status' },
  { method: 'GET', path: '/api/hermes/mcp/servers', description: 'MCP server list for a profile' },
  { method: 'GET', path: '/api/user-profile', description: 'Frakio Work user profile' },
  { method: 'GET', path: '/api/threads/:id/collaboration', description: 'Collaboration workflow snapshot for a thread' },
  { method: 'PATCH', path: '/api/threads/:id/mode', description: 'Switch a thread between Chat and Work execution modes' },
  { method: 'POST', path: '/api/threads/:id/plans/:planId/questions', description: 'Request structured user input while drafting a Plan' },
  { method: 'POST', path: '/api/threads/:id/plans/:planId/submit', description: 'Submit a structured Plan draft for user approval' },
  { method: 'GET', path: '/api/threads/:id/collaboration/plans/:rootTaskId', description: 'Read a Work execution plan and revision' },
  { method: 'POST', path: '/api/threads/:id/collaboration/plans', description: 'Publish a validated Work execution plan revision' },
];

const toolsBySet = {
  api: [
    {
      name: 'hermes_workbench_api_catalog_get',
      description: 'Get a compact catalog of Frakio Work local API routes that are safe for Hermes Agent discovery.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'hermes_workbench_api_request',
      description: 'Call an allowlisted Frakio Work local API route. Only safe local /api paths are accepted.',
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET'] },
          path: { type: 'string', description: 'Allowlisted /api path, including optional query string.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ],
  use: [
    { name: 'hermes_workbench_protocol_get', description: 'Return the Frakio Workbench MCP protocol version and collaboration capabilities.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_threads_list', description: 'List Frakio Work project and direct conversation threads.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'hermes_workbench_use_thread_get',
      description: 'Read one Frakio Work thread by id.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'], additionalProperties: false },
    },
    { name: 'hermes_workbench_use_projects_list', description: 'List Frakio Work projects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_agents_list', description: 'List Frakio Work Agents and Hermes profile bindings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_models_list', description: 'List configured Frakio Work models.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_runtime_status', description: 'Read local Hermes runtime and bootstrap status as seen by Frakio Work.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_mcp_servers_list', description: 'List MCP servers configured for the current Hermes profile.', inputSchema: { type: 'object', properties: { profile: { type: 'string' } }, additionalProperties: false } },
    { name: 'hermes_workbench_use_user_profile_get', description: 'Read the Frakio Work user profile.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'hermes_workbench_plan_user_input_request',
      description: 'Ask one to three decision questions for the active Frakio Plan. Prefer one question. Each question must have a short header and two or three mutually exclusive options; the first option is treated as recommended. The call waits for the user answer or optional auto-resolution.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: { type: 'string' },
          planId: { type: 'string' },
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                header: { type: 'string' },
                question: { type: 'string' },
                options: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 3,
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      description: { type: 'string' },
                      recommended: { type: 'boolean' },
                    },
                    required: ['label', 'description'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['id', 'header', 'question', 'options'],
              additionalProperties: false,
            },
          },
          autoResolutionMs: { type: 'integer', minimum: 60000, maximum: 240000 },
        },
        required: ['threadId', 'planId', 'questions'],
        additionalProperties: false,
      },
    },
    {
      name: 'hermes_workbench_plan_submit',
      description: 'Submit the complete structured draft for the active Frakio Plan. This ends planning and waits for explicit user approval; it does not execute or publish Work tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: { type: 'string' },
          planId: { type: 'string' },
          baseRevision: { type: 'integer', minimum: 0 },
          title: { type: 'string' },
          summary: { type: 'string' },
          steps: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } },
                assigneeAgentId: { type: 'string' },
                expectedResult: { type: 'string' },
                dependsOnKeys: { type: 'array', items: { type: 'string' } },
              },
              required: ['key', 'title', 'description', 'expectedResult', 'dependsOnKeys'],
              additionalProperties: false,
            },
          },
          tests: { type: 'array', items: { type: 'string' } },
          assumptions: { type: 'array', items: { type: 'string' } },
          idempotencyKey: { type: 'string' },
        },
        required: ['threadId', 'planId', 'baseRevision', 'title', 'summary', 'steps', 'tests', 'assumptions', 'idempotencyKey'],
        additionalProperties: false,
      },
    },
    {
      name: 'hermes_workbench_collaboration_workflow_create',
      description: 'Create and bind a durable Hermes Kanban workflow to a Frakio Work thread. Use once for a new workstream, then reuse the returned workflowId.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, coordinatorAgentId: { type: 'string' }, idempotencyKey: { type: 'string' } }, required: ['threadId', 'name', 'idempotencyKey'], additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_context_resolve',
      description: 'Resolve the Frakio threadId and workflowId that own a Hermes Kanban task or board. Kanban workers should call this first when their prompt only provides a task id.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, boardSlug: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_root_create',
      description: 'Create a new root task in an existing collaboration workflow.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, workflowId: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, assigneeAgentId: { type: 'string' }, actorAgentId: { type: 'string' }, idempotencyKey: { type: 'string' } }, required: ['threadId', 'workflowId', 'title', 'idempotencyKey'], additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_plan_get',
      description: 'Read the current structured execution plan and revision for a Work mode root task before publishing a revision.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, workflowId: { type: 'string' }, rootTaskId: { type: 'string' } }, required: ['threadId', 'workflowId', 'rootTaskId'], additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_plan_publish',
      description: 'Publish or revise the complete structured execution plan for a Work mode root task. Frakio validates Agents, stable keys, revision, dependencies, and DAG safety before dispatch.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: { type: 'string' }, workflowId: { type: 'string' }, rootTaskId: { type: 'string' }, baseRevision: { type: 'integer', minimum: 0 },
          goal: { type: 'string' }, summary: { type: 'string' }, idempotencyKey: { type: 'string' },
          tasks: { type: 'array', minItems: 1, items: { type: 'object', properties: { key: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, assigneeAgentId: { type: 'string' }, expectedResult: { type: 'string' }, dependsOnKeys: { type: 'array', items: { type: 'string' } }, cancelled: { type: 'boolean' } }, required: ['key', 'title', 'assigneeAgentId'], additionalProperties: false } },
        },
        required: ['threadId', 'workflowId', 'rootTaskId', 'baseRevision', 'summary', 'tasks', 'idempotencyKey'],
        additionalProperties: false,
      },
    },
    {
      name: 'hermes_workbench_collaboration_dependency_request',
      description: 'Request missing work from another Agent. Creates a parent task, links it to the requester, and waits until the dependency completes.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, workflowId: { type: 'string' }, requesterTaskId: { type: 'string' }, targetAgentId: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, reason: { type: 'string' }, actorAgentId: { type: 'string' }, idempotencyKey: { type: 'string' } }, required: ['threadId', 'workflowId', 'requesterTaskId', 'targetAgentId', 'title', 'idempotencyKey'], additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_blocker_report',
      description: 'Report a typed blocker. needs_input/capability escalate to the workflow coordinator and then the fallback decision Agent; transient records a retryable failure. Use dependency_request for dependency blockers.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, workflowId: { type: 'string' }, taskId: { type: 'string' }, taskTitle: { type: 'string' }, kind: { type: 'string', enum: ['needs_input', 'capability', 'transient'] }, evidence: { type: 'string' }, actorAgentId: { type: 'string' }, requiresUserApproval: { type: 'boolean', description: 'True for payments, authorization, deletion, external publishing, or any action reserved for the user.' }, idempotencyKey: { type: 'string' } }, required: ['threadId', 'workflowId', 'taskId', 'kind', 'evidence', 'idempotencyKey'], additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_artifact_publish',
      description: 'Publish an artifact summary or local file path to a collaboration task.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, workflowId: { type: 'string' }, taskId: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string' }, path: { type: 'string' }, actorAgentId: { type: 'string' } }, required: ['threadId', 'workflowId', 'taskId'], additionalProperties: false },
    },
    {
      name: 'hermes_workbench_collaboration_task_complete',
      description: 'Complete a collaboration task with a durable summary so dependent tasks can resume automatically.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, workflowId: { type: 'string' }, taskId: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, actorAgentId: { type: 'string' } }, required: ['threadId', 'workflowId', 'taskId', 'summary'], additionalProperties: false },
    },
  ],
};

const allowlist = [
  /^\/api\/state(?:\?.*)?$/,
  /^\/api\/agents(?:\?.*)?$/,
  /^\/api\/models(?:\?.*)?$/,
  /^\/api\/workspaces(?:\?.*)?$/,
  /^\/api\/workspaces\/[A-Za-z0-9_-]+\/threads(?:\?.*)?$/,
  /^\/api\/threads\/[A-Za-z0-9_-]+(?:\?.*)?$/,
  /^\/api\/hermes-runtime\/status(?:\?.*)?$/,
  /^\/api\/hermes\/network-status(?:\?.*)?$/,
  /^\/api\/hermes-bootstrap\/status(?:\?.*)?$/,
  /^\/api\/hermes\/mcp\/servers(?:\?.*)?$/,
  /^\/api\/user-profile(?:\?.*)?$/,
  /^\/api\/threads\/[A-Za-z0-9_-]+\/collaboration(?:\?.*)?$/,
];

function currentTools() {
  return toolsBySet[toolset] || toolsBySet.use;
}

function content(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function requestJson(path, options = {}) {
  const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  const method = options.method || 'GET';
  if (!['GET', 'HEAD'].includes(method) && !sessionCookie) {
    const sessionResponse = await fetch(`${workbenchUrl}/api/session`, { headers: { Accept: 'application/json' } });
    if (!sessionResponse.ok) throw new Error(`Frakio Work session bootstrap failed: ${sessionResponse.status}`);
    sessionCookie = String(sessionResponse.headers.get('set-cookie') || '').split(';')[0];
  }
  const res = await fetch(`${workbenchUrl}${cleanPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { 'X-Frakio-Request': '1', Cookie: sessionCookie } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Frakio Work API ${res.status}`);
  return data;
}

function assertAllowedPath(path) {
  const clean = String(path || '');
  if (!clean.startsWith('/api/')) throw new Error('Only local /api paths are allowed.');
  if (!allowlist.some((pattern) => pattern.test(clean))) throw new Error(`Path is not allowlisted: ${clean}`);
  return clean;
}

async function listThreads() {
  const [{ workspaces = [] }, { conversations = [] }] = await Promise.all([
    requestJson('/api/workspaces?includeArchived=true'),
    requestJson('/api/conversations'),
  ]);
  const projectThreads = [];
  for (const workspace of workspaces) {
    const data = await requestJson(`/api/workspaces/${encodeURIComponent(workspace.id)}/threads`);
    projectThreads.push(...(data.threads || []).map((thread) => ({ ...thread, workspaceName: workspace.name })));
  }
  return { conversations, projectThreads };
}

async function callTool(name, args = {}) {
  if (name === 'hermes_workbench_protocol_get') return { protocolVersion, toolset, capabilities: { collaborationPlans: true, planMode: true, structuredPlanQuestions: true, planRevision: true, steerQueue: true } };
  if (name === 'hermes_workbench_api_catalog_get') return { profile, workbenchUrl, routes: apiCatalog };
  if (name === 'hermes_workbench_api_request') return requestJson(assertAllowedPath(args.path || ''));
  if (name === 'hermes_workbench_use_threads_list') return listThreads();
  if (name === 'hermes_workbench_use_thread_get') return requestJson(`/api/threads/${encodeURIComponent(String(args.threadId || ''))}`);
  if (name === 'hermes_workbench_use_projects_list') return requestJson('/api/workspaces?includeArchived=true');
  if (name === 'hermes_workbench_use_agents_list') return requestJson('/api/agents');
  if (name === 'hermes_workbench_use_models_list') return requestJson('/api/models');
  if (name === 'hermes_workbench_use_runtime_status') {
    const [runtime, bootstrap] = await Promise.all([
      requestJson('/api/hermes-runtime/status').catch((error) => ({ error: error.message })),
      requestJson('/api/hermes-bootstrap/status').catch((error) => ({ error: error.message })),
    ]);
    return { runtime, bootstrap };
  }
  if (name === 'hermes_workbench_use_mcp_servers_list') {
    const selectedProfile = encodeURIComponent(String(args.profile || profile || 'default'));
    return requestJson(`/api/hermes/mcp/servers?profile=${selectedProfile}`);
  }
  if (name === 'hermes_workbench_use_user_profile_get') return requestJson('/api/user-profile');
  if (name === 'hermes_workbench_plan_user_input_request') {
    const { threadId, planId, ...body } = args;
    const encodedThreadId = encodeURIComponent(String(threadId || ''));
    const encodedPlanId = encodeURIComponent(String(planId || ''));
    const created = await requestJson(`/api/threads/${encodedThreadId}/plans/${encodedPlanId}/questions`, { method: 'POST', body });
    const requestId = created?.batch?.id;
    if (!requestId) throw new Error('Frakio Work did not return a Plan question request id.');
    while (true) {
      const status = await requestJson(`/api/threads/${encodedThreadId}/plans/${encodedPlanId}/questions/${encodeURIComponent(String(requestId))}`);
      if (status?.batch?.status !== 'pending') return status;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (name === 'hermes_workbench_plan_submit') {
    const { threadId, planId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/plans/${encodeURIComponent(String(planId || ''))}/submit`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_workflow_create') {
    const { threadId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/workflows`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_context_resolve') {
    const params = new URLSearchParams();
    if (args.taskId) params.set('taskId', String(args.taskId));
    if (args.boardSlug) params.set('boardSlug', String(args.boardSlug));
    return requestJson(`/api/collaboration/resolve?${params.toString()}`);
  }
  if (name === 'hermes_workbench_collaboration_root_create') {
    const { threadId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/roots`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_plan_get') {
    const params = new URLSearchParams({ workflowId: String(args.workflowId || '') });
    return requestJson(`/api/threads/${encodeURIComponent(String(args.threadId || ''))}/collaboration/plans/${encodeURIComponent(String(args.rootTaskId || ''))}?${params.toString()}`);
  }
  if (name === 'hermes_workbench_collaboration_plan_publish') {
    const { threadId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/plans`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_dependency_request') {
    const { threadId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/dependencies`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_blocker_report') {
    const { threadId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/blockers`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_artifact_publish') {
    const { threadId, taskId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/tasks/${encodeURIComponent(String(taskId || ''))}/artifacts`, { method: 'POST', body });
  }
  if (name === 'hermes_workbench_collaboration_task_complete') {
    const { threadId, taskId, ...body } = args;
    return requestJson(`/api/threads/${encodeURIComponent(String(threadId || ''))}/collaboration/tasks/${encodeURIComponent(String(taskId || ''))}/complete`, { method: 'POST', body });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  const { id, method, params = {} } = message || {};
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: `hermes-workbench-${toolset}`, version: '0.1.0' },
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: currentTools() } };
  if (method === 'tools/call') {
    try {
      const result = await callTool(params.name, params.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: content(result) } };
    } catch (error) {
      return { jsonrpc: '2.0', id, result: { content: content(error.message || 'Tool failed.'), isError: true } };
    }
  }
  return errorResponse(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    Promise.resolve()
      .then(() => handle(JSON.parse(trimmed)))
      .then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => process.stdout.write(`${JSON.stringify(errorResponse(null, -32700, error.message || 'Parse error'))}\n`));
  }
});
