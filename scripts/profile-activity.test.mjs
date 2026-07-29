import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileActivity } from '../apps/web/src/profile-activity.mjs';

const now = new Date(2026, 6, 27, 12);

function cellFor(result, day) {
  return result.cells.find((cell) => cell.day === day);
}

test('renders a stable 53 week grid with missing days kept neutral', () => {
  const activity = buildProfileActivity([], [], 'daily', now);
  assert.equal(activity.cells.length, 371);
  assert.equal(activity.cells.every((cell) => cell.value === 0 && cell.level === 0), true);
  assert.equal(activity.months.at(-1)?.label, '7月');
  assert.equal(activity.months.filter((month) => month.label === '8月').length, 1);
});

test('aggregates the full entry range and lets byDay override matching dates', () => {
  const activity = buildProfileActivity(
    [{ day: '2026-07-25', realTotalTokens: 90 }],
    [
      { createdAt: '2025-08-01T10:00:00+08:00', realTotalTokens: 15 },
      { createdAt: '2026-07-25T09:00:00+08:00', realTotalTokens: 20 },
      { createdAt: '2026-07-25T18:00:00+08:00', realTotalTokens: 30 },
    ],
    'daily',
    now,
  );

  assert.equal(cellFor(activity, '2025-08-01')?.value, 15);
  assert.equal(cellFor(activity, '2026-07-25')?.value, 90);
});

test('weekly mode maps one natural-week total to all seven cells', () => {
  const activity = buildProfileActivity(
    [],
    [
      { createdAt: '2026-07-26T10:00:00+08:00', totalTokens: 25 },
      { createdAt: '2026-07-27T10:00:00+08:00', totalTokens: 75 },
    ],
    'weekly',
    now,
  );
  const week = activity.cells.filter((cell) => cell.week === cellFor(activity, '2026-07-27')?.week);
  assert.equal(week.length, 7);
  assert.equal(week.every((cell) => cell.value === 100), true);
  assert.match(week[0].ariaLabel, /2026年7月26日至2026年8月1日/);
});

test('total mode accumulates values in date order across a year boundary', () => {
  const activity = buildProfileActivity(
    [],
    [
      { createdAt: '2025-12-31T20:00:00+08:00', realTotalTokens: 12 },
      { createdAt: '2026-01-01T08:00:00+08:00', realTotalTokens: 8 },
    ],
    'total',
    now,
  );
  assert.equal(cellFor(activity, '2025-12-31')?.value, 12);
  assert.equal(cellFor(activity, '2026-01-01')?.value, 20);
  assert.match(cellFor(activity, '2026-01-01')?.ariaLabel || '', /累计 20 Token/);
});
