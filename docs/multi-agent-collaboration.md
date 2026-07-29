# Multi-Agent collaboration execution

## Chat and Work modes

Every thread persists an `executionMode`. `chat` is the default and keeps the existing multi-Agent mention routing without touching Hermes Kanban. `work` is entered through `PATCH /api/threads/:threadId/mode`; the transition verifies the live Bridge tool registry, reloads an outdated Workbench MCP connection, and only then creates or reuses a workflow and board. Switching back to Chat does not stop already-dispatched Kanban workers.

The pre-existing `Thread.mode` field still represents workspace versus direct conversation, so the execution selector is stored as `Thread.executionMode` for backward compatibility. `workerOutputMode` is `summary` by default and can be changed to `all` when every worker result should also appear in the main conversation.

Frakio Work treats a conversation, workflow, Hermes Kanban board, task, and task run as different scopes. A conversation may contain multiple workflows. Each workflow binds to one Hermes board and may contain multiple root tasks. Hermes remains the source of truth for task status, links, comments, attachments, and runs; Frakio persists only the conversation binding, idempotency receipts, and an event projection.

## Agent protocol

The `hermes-workbench-use` MCP server exposes structured collaboration tools and protocol version 3. Frakio creates the workflow and root task before starting a Work coordinator. The coordinator reads the current revision with `hermes_workbench_collaboration_plan_get` and publishes a complete DAG through `hermes_workbench_collaboration_plan_publish`. Stable task keys, Agents, revision, duplicate keys, unknown dependencies, and cycles are validated before any dispatch. Ready tasks are immediately offered to the Hermes Kanban dispatcher instead of waiting for its normal gateway interval.

## Plan mode

Plan is a separate `collaborationMode` layered over Chat or Work. It locks the current `executionMode` for one planning session and leaves `permissionMode` unchanged. Existing state files need no migration: missing Plan fields normalize to `collaborationMode: default`, an empty `activePlanId`, and an empty session list.

During Plan, the Bridge receives `runtime_overrides.plan_mode=true`. A `tool_execution` guard runs before permission approval and only permits direct reads, search and extraction, image viewing, narrowly allowlisted read-only terminal commands, Workbench context reads, `hermes_workbench_plan_user_input_request`, and `hermes_workbench_plan_submit`. Write, patch, code execution, delegation, unknown MCP, publishing, task creation, and other mutations return `PLAN_MUTATION_BLOCKED`.

Questions and drafts are stored on the thread and streamed from `/api/threads/:threadId/plans/events`. The question tool waits on the persisted request, so refreshing the UI restores the same choices without interrupting the Agent run. Drafts use `planId`, `baseRevision`, and `idempotencyKey`; Work drafts additionally require valid assignees and an acyclic dependency graph.

Approving a Chat plan starts a hidden run on the author Agent without appending a fabricated user message. Approving a Work plan creates the root task, publishes the approved DAG, links dependencies, and dispatches workers in that order. No Kanban task is created while the Plan is still drafting or waiting for approval.

Missing work is requested with `hermes_workbench_collaboration_dependency_request`. Frakio creates a new Hermes task, links it as a parent of the requester, and blocks the requester with `--kind dependency`. Hermes promotes the requester after every parent completes. Artifacts and completion summaries are written back with the corresponding publish and complete tools.

`needs_input` and `capability` blockers first create a decision task for the workflow coordinator. If the coordinator reports another blocker, the decision task is assigned to the global fallback decision Agent. A blocker reported by that fallback, a repeated escalation, or `requiresUserApproval=true` becomes `human.required`. `transient` blockers remain retryable Hermes failures.

## API surface

Thread collaboration lives under `/api/threads/:threadId/collaboration`. The snapshot endpoint returns hydrated workflows, tasks, recent events, and the durable cursor. Mutation routes create workflows, root tasks, dependencies, blockers, artifacts, completions, and user interventions. `/api/collaboration/overview` aggregates active workflows across conversations. `/api/collaboration/resolve` maps a task or board back to its workflow.

The SSE endpoint is `/api/threads/:threadId/collaboration/events`. Clients send `afterCursor` or `Last-Event-ID`. Durable events are replayed first. A changed snapshot is then emitted as `collaboration.snapshot` within 1.5 seconds; unchanged connections receive heartbeat comments. Reconnecting clients should replace their task snapshot and de-duplicate durable events by event id.

Work messages sent while a root task is unfinished become durable `steer` interventions. Frakio first tries the Bridge safe-point steer path. If no coordinator session can accept it, the intervention remains queued and a coordinator replanning run consumes it. Plans use optimistic revision control, so stale coordinator output cannot overwrite a newer user adjustment.

Hermes parity routes under `/api/hermes/kanban` expose task detail, links, comments, attachments, logs, diagnostics, reclaim, reassign, board archive, and dynamic CLI capability detection.

## Safety and recovery

Every Agent-created workflow, root task, dependency, and blocker requires a stable idempotency key. Frakio retains the latest 200 receipts per thread. Hermes task creation receives the same key, while task links are idempotent upstream. Dependency cycles return `KANBAN_DEPENDENCY_CYCLE`. User-only operations such as payment, authorization, deletion, and external publishing must set `requiresUserApproval` and cannot be resolved by a decision Agent.
