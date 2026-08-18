// wjz新建文件，新建原因：解耦工作区收件箱、全景协作中心与看板组件（WorkspaceSurface, InboxPage, CollaborationCenterPage, KanbanPage 等），修改时间：2026-08-17。
// 文件内容概述：跨会话审批与事项提醒收件箱、多 Workflow 执行进度大盘、多看板任务状态列与任务评论流转。
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  LoaderCircle,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  AppPopover,
  AppPopoverContent,
  AppPopoverTrigger,
} from '../../overlay-primitives';
import { requestJson } from '../../utils/api-client';
import { formatTime } from '../../utils/formatters';
import {
  collaborationStatusLabel,
  kanbanStatusLabels,
  kanbanStatusOrder,
} from '../../utils/workbench-helpers';
import type {
  Agent,
  CollaborationWorkflowSnapshot,
  InboxItem,
  KanbanBoard,
  KanbanTask,
  KanbanTaskStatus,
} from '../../types/workbench';

export function WorkspaceSurface({ children }: { children: React.ReactNode }) {
  return <section className="workspace-surface-content">{children}</section>;
}

export function InboxPage({
  items,
  loading,
  error,
  onRefresh,
  onOpen,
}: {
  items: InboxItem[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onOpen: (item: InboxItem) => void;
}) {
  const pending = items.filter((item) => item.actionRequired && !item.resolvedAt);
  const updates = items.filter((item) => !item.actionRequired || item.resolvedAt);
  const renderItem = (item: InboxItem) => (
    <button
      type="button"
      className={`inbox-item priority-${item.priority}${item.readAt ? '' : ' unread'}${item.actionRequired && !item.resolvedAt ? ' action-required' : ''}`}
      key={item.id}
      onClick={() => onOpen(item)}
    >
      <span className="inbox-item-icon">
        {item.type === 'workflow_completed' ? (
          <CheckCircle2 size={16} />
        ) : item.type === 'approval_required' ||
          item.type === 'answer_required' ? (
          <CircleHelp size={16} />
        ) : (
          <TriangleAlert size={16} />
        )}
      </span>
      <span className="inbox-item-copy">
        <small>
          {item.threadTitle || '对话'} · {formatTime(item.updatedAt)}
        </small>
        <strong>{item.title}</strong>
        <p>{item.summary || '点击查看详情'}</p>
      </span>
      <span className="inbox-item-state">
        {item.actionRequired && !item.resolvedAt
          ? '待处理'
          : !item.readAt
            ? '未读'
            : ''}
        <ChevronRight size={15} />
      </span>
    </button>
  );
  return (
    <section className="inbox-page">
      <header>
        <div>
          <small>跨会话提醒</small>
          <h1>收件箱</h1>
          <p>协作完成、失败、审批和需要回答的事项会集中在这里。</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          刷新
        </button>
      </header>
      {error && <div className="resource-error">{error}</div>}
      {loading && !items.length ? (
        <div className="inbox-loading">
          <LoaderCircle size={18} className="spin" />
          正在读取提醒…
        </div>
      ) : (
        <div className="inbox-groups">
          {pending.length > 0 && (
            <section>
              <header>
                <strong>待处理</strong>
                <span>{pending.length}</span>
              </header>
              <div>{pending.map(renderItem)}</div>
            </section>
          )}
          <section>
            <header>
              <strong>最新消息</strong>
              <span>{updates.filter((item) => !item.readAt).length || ''}</span>
            </header>
            <div>
              {updates.map(renderItem)}
              {!updates.length && !pending.length && (
                <div className="inbox-empty">
                  <Bell size={24} />
                  <strong>暂时没有提醒</strong>
                  <p>协作任务的关键状态会出现在这里。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export function CollaborationCenterPage({ agents }: { agents: Agent[] }) {
  const [workflows, setWorkflows] = useState<
    Array<CollaborationWorkflowSnapshot & { threadId: string; threadTitle: string }>
  >([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await requestJson<{
        workflows: Array<
          CollaborationWorkflowSnapshot & {
            threadId: string;
            threadTitle: string;
          }
        >;
      }>('/api/collaboration/overview');
      setWorkflows(data.workflows || []);
      setError('');
    } catch (err) {
      if (!silent)
        setError(err instanceof Error ? err.message : '协作状态读取失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = workflows.filter((workflow) => workflow.status !== 'archived');
  const activeCount = visible.filter(
    (workflow) => workflow.status === 'active',
  ).length;
  const pausedCount = visible.filter(
    (workflow) => workflow.status === 'paused',
  ).length;
  const waitingCount = visible.reduce(
    (count, workflow) =>
      count +
      workflow.tasks.filter((task) =>
        [
          'blocked',
          'scheduled',
          'todo',
          'pending_confirmation',
          'waiting_dependency',
          'waiting_input',
          'paused',
        ].includes(task.status),
      ).length,
    0,
  );
  const selected =
    visible.find((workflow) => workflow.id === selectedWorkflowId) || null;

  return (
    <section className="collaboration-center-page">
      <div className="collaboration-center-hero">
        <div>
          <small>Frakio Collaboration</small>
          <h2>协作</h2>
          <p>跨会话查看正在执行、等待和已完成的 Workflow。</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void load()}
          aria-label="刷新协作状态"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="collaboration-center-stats">
        <span>
          <strong>{activeCount}</strong>
          <small>执行中</small>
        </span>
        <span>
          <strong>{pausedCount}</strong>
          <small>已暂停</small>
        </span>
        <span>
          <strong>{waitingCount}</strong>
          <small>等待处理</small>
        </span>
        <span>
          <strong>{visible.length}</strong>
          <small>全部 Workflow</small>
        </span>
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <div className="empty-state">正在读取协作状态...</div>
      ) : visible.length ? (
        <div className="collaboration-center-grid">
          {visible.map((workflow) => {
            const tasks = workflow.tasks.filter(
              (task) => task.status !== 'archived',
            );
            const done = tasks.filter((task) =>
              ['done', 'completed'].includes(task.status),
            ).length;
            const coordinator = agents.find(
              (agent) => agent.id === workflow.coordinatorAgentId,
            );
            return (
              <button
                type="button"
                key={`${workflow.threadId}:${workflow.id}`}
                onClick={() => setSelectedWorkflowId(workflow.id)}
              >
                <header>
                  <span>
                    <small>{workflow.threadTitle}</small>
                    <strong>{workflow.name}</strong>
                  </span>
                  <em className={`status-${workflow.status}`}>
                    {workflow.status === 'active'
                      ? '执行中'
                      : workflow.status === 'paused'
                        ? '已暂停'
                        : workflow.status === 'completed'
                          ? '已完成'
                          : workflow.status}
                  </em>
                </header>
                <div className="collaboration-progress">
                  <span
                    style={{
                      width: `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%`,
                    }}
                  />
                </div>
                <footer>
                  <span>
                    {done}/{tasks.length} 完成
                  </span>
                  <span>{coordinator?.name || '未指定协调 Agent'}</span>
                </footer>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          暂无协作 Workflow。复杂任务的计划确认后会出现在这里。
        </div>
      )}
      {selected &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => setSelectedWorkflowId('')}
          >
            <div
              className="modal collaboration-center-detail"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-head">
                <div>
                  <small>{selected.threadTitle}</small>
                  <h2>{selected.name}</h2>
                  <p>
                    {selected.tasks.length} 个任务 · {selected.status}
                  </p>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setSelectedWorkflowId('')}
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="collaboration-center-task-list">
                {selected.tasks
                  .filter((task) => task.status !== 'archived')
                  .map((task) => (
                    <div key={task.id}>
                      <span
                        className={`collaboration-task-dot status-${task.status}`}
                      />
                      <span>
                        <strong>{task.title}</strong>
                        <small>
                          {task.assignee || '未分配'} ·{' '}
                          {collaborationStatusLabel(task.status)}
                        </small>
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function KanbanPage({ agents }: { agents: Agent[] }) {
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [board, setBoard] = useState('default');
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [boardForm, setBoardForm] = useState({ slug: '', name: '' });
  const [stats, setStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [boardComposerOpen, setBoardComposerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [taskComment, setTaskComment] = useState('');

  async function loadBoards() {
    try {
      const data = await requestJson<{ boards: KanbanBoard[] }>(
        '/api/hermes/kanban/boards',
      );
      setBoards(
        data.boards?.length
          ? data.boards
          : [{ slug: 'default', name: 'Default', total: 0 }],
      );
    } catch (err: any) {
      setError(err.message || '看板读取失败');
    }
  }

  async function loadTasks(nextBoard = board, silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const [taskData, statsData] = await Promise.all([
        requestJson<{ tasks: KanbanTask[] }>(
          `/api/hermes/kanban/tasks?board=${encodeURIComponent(nextBoard)}&includeArchived=true`,
        ),
        requestJson<{ stats: Record<string, any> }>(
          `/api/hermes/kanban/stats?board=${encodeURIComponent(nextBoard)}`,
        ),
      ]);
      setTasks(taskData.tasks || []);
      setStats(statsData.stats || {});
    } catch (err: any) {
      if (!silent) setError(err.message || '任务读取失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadBoards();
  }, []);

  useEffect(() => {
    void loadTasks(board);
    const timer = window.setInterval(() => void loadTasks(board, true), 2000);
    return () => window.clearInterval(timer);
  }, [board]);

  useEffect(() => {
    if (!selectedTask) {
      setTaskDetail(null);
      return;
    }
    void requestJson<{ detail: any }>(
      `/api/hermes/kanban/tasks/${encodeURIComponent(selectedTask.id)}?board=${encodeURIComponent(board)}`,
    )
      .then((data) => setTaskDetail(data.detail))
      .catch((err) => setError(err.message || '任务详情读取失败'));
  }, [selectedTask?.id, board]);

  async function createBoard() {
    if (!boardForm.slug.trim()) return;
    await requestJson('/api/hermes/kanban/boards', {
      method: 'POST',
      body: JSON.stringify(boardForm),
    });
    setBoard(boardForm.slug.trim());
    setBoardForm({ slug: '', name: '' });
    setBoardMenuOpen(false);
    setBoardComposerOpen(false);
    await loadBoards();
  }

  async function setTaskStatus(task: KanbanTask, status: KanbanTaskStatus) {
    await requestJson(
      `/api/hermes/kanban/tasks/${encodeURIComponent(task.id)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ board, status }) },
    );
    await Promise.all([loadBoards(), loadTasks(board)]);
  }

  async function addTaskComment() {
    if (!selectedTask || !taskComment.trim()) return;
    await requestJson(
      `/api/hermes/kanban/tasks/${encodeURIComponent(selectedTask.id)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          board,
          body: taskComment.trim(),
          author: 'user',
        }),
      },
    );
    setTaskComment('');
    const data = await requestJson<{ detail: any }>(
      `/api/hermes/kanban/tasks/${encodeURIComponent(selectedTask.id)}?board=${encodeURIComponent(board)}`,
    );
    setTaskDetail(data.detail);
  }

  async function archiveCurrentBoard() {
    if (board === 'default') return;
    await requestJson(
      `/api/hermes/kanban/boards/${encodeURIComponent(board)}`,
      { method: 'DELETE' },
    );
    setBoard('default');
    await loadBoards();
  }

  const grouped = Object.fromEntries(
    kanbanStatusOrder.map((status) => [
      status,
      tasks.filter((task) => task.status === status),
    ]),
  ) as Record<KanbanTaskStatus, KanbanTask[]>;
  const currentBoard = boards.find((item) => item.slug === board) || {
    slug: board,
    name: board === 'default' ? 'Default' : board,
    total: tasks.length,
  };
  const boardTitle = currentBoard.name || currentBoard.slug;
  const visibleStatuses = kanbanStatusOrder.filter(
    (status) => status !== 'archived' || grouped.archived.length > 0,
  );
  const statsEntries = kanbanStatusOrder
    .map((status: KanbanTaskStatus) => ({
      status,
      count: Number((stats.by_status as Record<string, number> | undefined)?.[status] ?? (grouped[status]?.length ?? 0)),
    }))
    .filter((item) => item.count > 0);

  return (
    <section className="management-page kanban-page">
      <div className="kanban-hero">
        <div className="kanban-title-stack">
          <span className="kanban-kicker">Hermes Kanban</span>
          <h2>{boardTitle}</h2>
        </div>
        <div className="kanban-top-actions">
          <AppPopover open={boardMenuOpen} onOpenChange={setBoardMenuOpen}>
            <div className="board-switcher">
              <AppPopoverTrigger asChild>
                <button className="notion-btn">
                  <Boxes size={15} /> 看板 <ChevronDown size={14} />
                </button>
              </AppPopoverTrigger>
              <AppPopoverContent
                className="board-popover-v2"
                side="bottom"
                align="end"
                aria-label="选择看板"
              >
                <div className="board-popover-head">
                  <strong>所有看板</strong>
                  <span>{boards.length} 个</span>
                </div>
                <div className="board-list">
                  {boards.map((item) => {
                    const selected = item.slug === board;
                    return (
                      <button
                        className={selected ? 'selected' : ''}
                        key={item.slug}
                        onClick={() => {
                          setBoard(item.slug);
                          setBoardMenuOpen(false);
                        }}
                      >
                        <span>
                          <Circle
                            size={9}
                            fill={selected ? 'currentColor' : 'none'}
                          />
                          {item.name || item.slug}
                        </span>
                        <em>{item.total || 0}</em>
                      </button>
                    );
                  })}
                </div>
              </AppPopoverContent>
            </div>
          </AppPopover>
          <button
            className="send-btn kanban-new-board"
            onClick={() => setBoardComposerOpen((open) => !open)}
            aria-label="新建看板"
            title="新建看板"
          >
            <Plus size={15} /> 新建看板
          </button>
          {board !== 'default' && (
            <button
              className="secondary-btn"
              onClick={() => void archiveCurrentBoard()}
            >
              <Archive size={14} />
              归档看板
            </button>
          )}
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="kanban-status-strip">
        {statsEntries.length ? (
          statsEntries.map((item) => (
            <span className={`status-${item.status}`} key={item.status}>
              <i />
              {kanbanStatusLabels[item.status]} {item.count}
            </span>
          ))
        ) : (
          <span>
            <i />
            暂无任务
          </span>
        )}
      </div>
      {boardComposerOpen && (
        <div className="kanban-board-composer">
          <input
            autoFocus
            value={boardForm.name}
            onChange={(event) =>
              setBoardForm({ ...boardForm, name: event.target.value })
            }
            placeholder="看板名称"
          />
          <input
            value={boardForm.slug}
            onChange={(event) =>
              setBoardForm({ ...boardForm, slug: event.target.value })
            }
            placeholder="board-slug"
          />
          <button className="send-btn" onClick={() => void createBoard()}>
            创建并进入
          </button>
          <button
            className="secondary-btn"
            onClick={() => {
              setBoardComposerOpen(false);
              setBoardForm({ slug: '', name: '' });
            }}
          >
            取消
          </button>
        </div>
      )}
      {loading ? (
        <div className="empty-state">读取看板中...</div>
      ) : (
        <div className="kanban-columns">
          {visibleStatuses.map((status) => (
            <section
              className={`kanban-column status-${status}`}
              key={status}
            >
              <header>
                <strong>
                  <i />
                  {kanbanStatusLabels[status]}
                </strong>
                <span>{grouped[status]?.length ?? 0}</span>
              </header>
              {(grouped[status]?.length ?? 0) > 0 ? (
                grouped[status].map((task: KanbanTask) => (
                  <article
                    className="kanban-card"
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    role="button"
                    tabIndex={0}
                  >
                    <strong>{task.title}</strong>
                    <p>{task.body || task.result || '无说明'}</p>
                    <div className="kanban-card-meta">
                      <span>{task.assignee || '未分配'}</span>
                      <span>P{task.priority ?? 0}</span>
                    </div>
                    <div className="kanban-actions">
                      {task.status !== 'done' && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void setTaskStatus(task, 'done');
                          }}
                        >
                          完成
                        </button>
                      )}
                      {task.status !== 'blocked' && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void setTaskStatus(task, 'blocked');
                          }}
                        >
                          阻塞
                        </button>
                      )}
                      {task.status === 'blocked' && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void setTaskStatus(task, 'ready');
                          }}
                        >
                          恢复
                        </button>
                      )}
                      {task.status !== 'archived' && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void setTaskStatus(task, 'archived');
                          }}
                        >
                          归档
                        </button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="kanban-empty">暂无任务</div>
              )}
            </section>
          ))}
        </div>
      )}
      {selectedTask &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => setSelectedTask(null)}
          >
            <div
              className="modal kanban-task-detail-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-head">
                <div>
                  <h2>{selectedTask.title}</h2>
                  <p>
                    {selectedTask.assignee || '未分配'} ·{' '}
                    {collaborationStatusLabel(selectedTask.status)}
                  </p>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setSelectedTask(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="kanban-task-detail-body">
                <section>
                  <h3>任务说明</h3>
                  <p>
                    {selectedTask.body ||
                      taskDetail?.latest_summary ||
                      selectedTask.result ||
                      '暂无说明'}
                  </p>
                </section>
                <section className="kanban-task-relations">
                  <h3>任务关系</h3>
                  <span>
                    父任务：{taskDetail?.parents?.join('、') || '无'}
                  </span>
                  <span>
                    子任务：{taskDetail?.children?.join('、') || '无'}
                  </span>
                </section>
                <section>
                  <h3>运行历史</h3>
                  {taskDetail?.runs?.length ? (
                    taskDetail.runs
                      .slice(-8)
                      .reverse()
                      .map((run: any) => (
                        <div className="kanban-detail-row" key={run.id}>
                          <strong>{run.profile || 'worker'}</strong>
                          <span>
                            {run.status} ·{' '}
                            {formatTime(
                              run.started_at
                                ? new Date(run.started_at * 1000).toISOString()
                                : '',
                            )}
                          </span>
                          <small>{run.summary || run.error || ''}</small>
                        </div>
                      ))
                  ) : (
                    <div className="resource-empty">暂无运行记录</div>
                  )}
                </section>
                <section>
                  <h3>评论与交付</h3>
                  {taskDetail?.comments?.map((comment: any) => (
                    <div
                      className="kanban-detail-row"
                      key={
                        comment.id ||
                        `${comment.author}:${comment.created_at}`
                      }
                    >
                      <strong>{comment.author}</strong>
                      <span>
                        {formatTime(
                          comment.created_at
                            ? new Date(comment.created_at * 1000).toISOString()
                            : '',
                        )}
                      </span>
                      <small>{comment.body}</small>
                    </div>
                  ))}
                  <div className="kanban-comment-composer">
                    <input
                      value={taskComment}
                      onChange={(event) => setTaskComment(event.target.value)}
                      placeholder="添加评论…"
                    />
                    <button
                      className="send-btn"
                      onClick={() => void addTaskComment()}
                      disabled={!taskComment.trim()}
                    >
                      发送
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
// wjz新建文件结束。
