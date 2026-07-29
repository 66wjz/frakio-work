import type { RunActivityGroup, RunActivityItem } from '@frakio/contracts';

export type RunPresentationPhase = 'thinking' | 'activity' | 'responding' | 'waiting-input' | 'finished';

export const PROCESSING_CYCLE_MS: number;
export const PROCESSING_MESSAGES: readonly string[];
export const RUN_PRESENTATION_PHASES: readonly RunPresentationPhase[];
export function formatRunElapsed(seconds: number): string;
export function processingMessageAt(startedAt: number | null | undefined, elapsedSeconds: number, identity?: string): string;
export function nextRunPresentationPhase(currentPhase: RunPresentationPhase, eventName: string, context?: { delta?: string; hasActivity?: boolean }): RunPresentationPhase;
export function shouldShowRunPresence(phase: RunPresentationPhase): boolean;
export function nextActivityExpanded(expanded: boolean, eventName?: string): boolean;
export function activityGroupPreview(group: Partial<RunActivityGroup> | null | undefined): string;
export function activityElapsedMs(item: Partial<RunActivityItem> | null | undefined, now?: number): number;
export function formatActivityDuration(milliseconds: number): string;
