export function normalizeApprovalPresentation(value: any): { approval: any | null; missingId: boolean };
export function normalizeClarificationPresentation(value: any): { clarification: any | null; missingId: boolean };
export function mergeThreadWithPendingMessages<T>(current: T, incoming: T, pendingMessageIds?: string[]): T;
export function canApplyPresentation(currentRevision: number, nextRevision: number): boolean;
export function canApplyRuntimeCursor(currentCursor: number, nextCursor: number): boolean;
export function runtimeEventKey(event?: Record<string, any>): string;
export function shouldApplyRuntimeEvent(seenKeys: Set<string>, event?: Record<string, any>): boolean;
export function canApplyRunSnapshot(terminalRunId: string, nextRunId: string, nextStatus: string): boolean;
