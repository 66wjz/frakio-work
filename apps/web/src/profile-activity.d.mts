export type ProfileActivityMode = 'daily' | 'weekly' | 'total';

export type ProfileActivityCell = {
  day: string;
  value: number;
  level: number;
  week: number;
  row: number;
  index: number;
  future: boolean;
  heading: string;
  detail: string;
  ariaLabel: string;
};

export type ProfileActivityResult = {
  cells: ProfileActivityCell[];
  months: Array<{ label: string; index: number }>;
};

type UsageDayLike = {
  day?: string;
  totalTokens?: number;
  realTotalTokens?: number;
};

type UsageEntryLike = {
  createdAt?: string;
  totalTokens?: number;
  realTotalTokens?: number;
};

export function buildProfileActivity(
  days?: UsageDayLike[],
  entries?: UsageEntryLike[],
  mode?: ProfileActivityMode,
  now?: Date,
): ProfileActivityResult;
