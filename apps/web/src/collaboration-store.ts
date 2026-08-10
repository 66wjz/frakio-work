import { useEffect, useSyncExternalStore } from 'react';

type CollaborationEventLike = { id?: string; cursor?: number; type?: string };

export type CollaborationSnapshotLike = {
  threadId: string;
  cursor: number;
  events: CollaborationEventLike[];
};

export type CollaborationStoreState<T extends CollaborationSnapshotLike = CollaborationSnapshotLike> = {
  snapshot: T | null;
  loading: boolean;
  syncPending: boolean;
  error: string;
};

type Entry = {
  threadId: string;
  state: CollaborationStoreState;
  listeners: Set<() => void>;
  source: EventSource | null;
  abortController: AbortController | null;
  requestRevision: number;
  reconnectTimer: number | null;
  reconnectAttempt: number;
  disposeTimer: number | null;
};

const entries = new Map<string, Entry>();
const emptyState: CollaborationStoreState = { snapshot: null, loading: false, syncPending: false, error: '' };
const terminalSignals = new Set(['task.completed', 'workflow.completed', 'workflow.failed', 'workflow.paused', 'workflow.resumed', 'workflow.cancelled', 'workflow.delivery_ready', 'workflow.finalization_failed']);

function entryFor(threadId: string) {
  let entry = entries.get(threadId);
  if (!entry) {
    entry = {
      threadId,
      state: { snapshot: null, loading: true, syncPending: false, error: '' },
      listeners: new Set(),
      source: null,
      abortController: null,
      requestRevision: 0,
      reconnectTimer: null,
      reconnectAttempt: 0,
      disposeTimer: null,
    };
    entries.set(threadId, entry);
  }
  return entry;
}

function emit(entry: Entry, next: Partial<CollaborationStoreState>) {
  entry.state = { ...entry.state, ...next };
  for (const listener of entry.listeners) listener();
}

function applySnapshot(entry: Entry, snapshot: CollaborationSnapshotLike, broadcast = false) {
  if (!snapshot || snapshot.threadId !== entry.threadId) return;
  const previousCursor = Math.max(0, Number(entry.state.snapshot?.cursor || 0));
  const nextCursor = Math.max(0, Number(snapshot.cursor || 0));
  if (nextCursor < previousCursor) {
    emit(entry, { syncPending: true, error: '协作状态需要重新同步' });
    void refreshThreadCollaboration(entry.threadId);
    return;
  }
  emit(entry, { snapshot, loading: false, syncPending: false, error: '' });
  if (nextCursor > previousCursor && snapshot.events?.some((event) => Number(event.cursor || 0) > previousCursor && terminalSignals.has(String(event.type || '')))) {
    window.dispatchEvent(new CustomEvent('frakio:thread-refresh-request', { detail: { threadId: snapshot.threadId } }));
  }
  if (broadcast) window.dispatchEvent(new CustomEvent('frakio:collaboration-snapshot', { detail: snapshot }));
}

async function fetchSnapshot(entry: Entry) {
  const revision = ++entry.requestRevision;
  entry.abortController?.abort();
  const controller = new AbortController();
  entry.abortController = controller;
  emit(entry, { loading: !entry.state.snapshot, syncPending: Boolean(entry.state.snapshot), error: '' });
  try {
    const response = await fetch(`/api/threads/${encodeURIComponent(entry.threadId)}/collaboration`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '协作状态读取失败');
    if (revision !== entry.requestRevision || controller.signal.aborted) return;
    applySnapshot(entry, data.snapshot, true);
  } catch (error) {
    if (controller.signal.aborted || revision !== entry.requestRevision) return;
    emit(entry, {
      loading: false,
      syncPending: Boolean(entry.state.snapshot),
      error: error instanceof Error ? error.message : '协作状态读取失败',
    });
  } finally {
    if (entry.abortController === controller) entry.abortController = null;
  }
}

function scheduleReconnect(entry: Entry) {
  if (!entry.listeners.size || entry.reconnectTimer) return;
  const delay = Math.min(15000, 750 * 2 ** Math.min(5, entry.reconnectAttempt));
  entry.reconnectAttempt += 1;
  entry.reconnectTimer = window.setTimeout(() => {
    entry.reconnectTimer = null;
    connect(entry);
  }, delay);
}

function connect(entry: Entry) {
  if (!entry.listeners.size || entry.source) return;
  const cursor = Math.max(0, Number(entry.state.snapshot?.cursor || 0));
  const source = new EventSource(`/api/threads/${encodeURIComponent(entry.threadId)}/collaboration/events?afterCursor=${cursor}`);
  entry.source = source;
  source.addEventListener('collaboration.snapshot', (event: MessageEvent) => {
    try {
      const snapshot = JSON.parse(event.data) as CollaborationSnapshotLike;
      entry.reconnectAttempt = 0;
      applySnapshot(entry, snapshot, true);
    } catch {
      emit(entry, { syncPending: true, error: '协作实时数据无法解析' });
      void fetchSnapshot(entry);
    }
  });
  source.addEventListener('collaboration.error', () => {
    emit(entry, { syncPending: true, error: '协作实时状态需要重新同步' });
  });
  source.onerror = () => {
    if (entry.source === source) entry.source = null;
    source.close();
    emit(entry, { syncPending: true, error: '实时连接正在重连…' });
    scheduleReconnect(entry);
  };
}

function start(entry: Entry) {
  if (entry.disposeTimer) {
    window.clearTimeout(entry.disposeTimer);
    entry.disposeTimer = null;
  }
  if (!entry.state.snapshot && !entry.abortController) void fetchSnapshot(entry);
  connect(entry);
}

function stopLater(entry: Entry) {
  if (entry.listeners.size || entry.disposeTimer) return;
  entry.disposeTimer = window.setTimeout(() => {
    entry.disposeTimer = null;
    if (entry.listeners.size) return;
    entry.source?.close();
    entry.source = null;
    entry.abortController?.abort();
    entry.abortController = null;
    if (entry.reconnectTimer) window.clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
    entry.reconnectAttempt = 0;
  }, 250);
}

export function publishThreadCollaborationSnapshot(snapshot: CollaborationSnapshotLike | null | undefined) {
  if (!snapshot?.threadId) return;
  applySnapshot(entryFor(snapshot.threadId), snapshot, false);
}

export function refreshThreadCollaboration(threadId: string) {
  if (!threadId) return Promise.resolve();
  return fetchSnapshot(entryFor(threadId));
}

export function useThreadCollaboration<T extends CollaborationSnapshotLike>(threadId?: string | null): CollaborationStoreState<T> {
  const key = String(threadId || '');
  const state = useSyncExternalStore(
    (listener) => {
      if (!key) return () => {};
      const entry = entryFor(key);
      entry.listeners.add(listener);
      start(entry);
      return () => {
        entry.listeners.delete(listener);
        stopLater(entry);
      };
    },
    () => key ? entryFor(key).state : emptyState,
    () => emptyState,
  ) as CollaborationStoreState<T>;

  useEffect(() => {
    if (!key) return;
    const entry = entryFor(key);
    if (!entry.state.snapshot && !entry.abortController) void fetchSnapshot(entry);
  }, [key]);

  return state;
}

if (typeof window !== 'undefined') {
  window.addEventListener('frakio:collaboration-snapshot', (event: Event) => {
    publishThreadCollaborationSnapshot((event as CustomEvent<CollaborationSnapshotLike>).detail);
  });
}
