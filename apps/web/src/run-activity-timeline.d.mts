import type { RunActivityGroup, RunActivityItem } from '@frakio/contracts';

export type RunActivityTimelineEntry = { type: 'tool'; id: string; item: RunActivityItem };

export function activityTimelineEntries(group: RunActivityGroup): RunActivityTimelineEntry[];
export function buildRunActivityTimeline(content: string, groups: RunActivityGroup[]): {
  groups: Array<{ group: RunActivityGroup; commentary: string; hasFollowingText: boolean }>;
  tail: string;
};
