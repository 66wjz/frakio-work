export const STREAM_REVEAL_INITIAL_BUFFER_MS: number;
export const STREAM_REVEAL_MIN_COMMIT_MS: number;
export const STREAM_REVEAL_MAX_LAG_MS: number;
export const STREAM_REVEAL_ANIMATION_MS: number;
export function segmentStreamGraphemes(value: string): string[];
export function streamRevealTransition(input?: {
  displayedContent?: string;
  rawContent?: string;
  queueStartedAt?: number;
  lastCommitAt?: number;
  now?: number;
  force?: boolean;
}): {
  kind: 'wait' | 'append' | 'reset' | 'settled';
  displayedContent: string;
  appendedGraphemes: number;
  settled: boolean;
};
