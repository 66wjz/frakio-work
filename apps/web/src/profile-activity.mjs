const PROFILE_ACTIVITY_WEEKS = 53;
const PROFILE_ACTIVITY_DAYS = PROFILE_ACTIVITY_WEEKS * 7;

function safeTokenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDayKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function activityLevel(value, maxValue) {
  if (value <= 0) return 0;
  const ratio = value / maxValue;
  if (ratio > 0.75) return 4;
  if (ratio > 0.45) return 3;
  if (ratio > 0.18) return 2;
  return 1;
}

function activityCopy(cell, mode, weekStart, weekEnd, value) {
  const formatted = Math.round(value).toLocaleString('zh-CN');
  if (mode === 'weekly') {
    return {
      heading: `${formatDate(weekStart)}至${formatDate(weekEnd)}`,
      detail: `本周 ${formatted} Token`,
      ariaLabel: `${formatDate(weekStart)}至${formatDate(weekEnd)}，本周 ${formatted} Token`,
    };
  }
  if (mode === 'total') {
    return {
      heading: formatDate(cell.date),
      detail: `累计 ${formatted} Token`,
      ariaLabel: `截至${formatDate(cell.date)}，累计 ${formatted} Token`,
    };
  }
  return {
    heading: formatDate(cell.date),
    detail: `${formatted} Token`,
    ariaLabel: `${formatDate(cell.date)}，当日 ${formatted} Token`,
  };
}

export function buildProfileActivity(days = [], entries = [], mode = 'daily', now = new Date()) {
  const byDay = new Map();

  for (const entry of entries || []) {
    const day = localDayKey(entry?.createdAt);
    if (!day) continue;
    const tokens = safeTokenCount(entry?.realTotalTokens ?? entry?.totalTokens);
    byDay.set(day, (byDay.get(day) || 0) + tokens);
  }

  for (const row of days || []) {
    const parsed = parseDayKey(row?.day);
    if (!parsed) continue;
    byDay.set(localDayKey(parsed), safeTokenCount(row?.realTotalTokens ?? row?.totalTokens));
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - ((PROFILE_ACTIVITY_WEEKS - 1) * 7));

  const rawCells = [];
  for (let index = 0; index < PROFILE_ACTIVITY_DAYS; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const day = localDayKey(date);
    rawCells.push({
      day,
      date,
      value: byDay.get(day) || 0,
      week: Math.floor(index / 7),
      row: index % 7,
      index,
      future: date.getTime() > today.getTime(),
    });
  }

  const weekTotals = rawCells.reduce((totals, cell) => {
    totals.set(cell.week, (totals.get(cell.week) || 0) + cell.value);
    return totals;
  }, new Map());

  let running = 0;
  const modeValues = rawCells.map((cell) => {
    if (mode === 'weekly') return weekTotals.get(cell.week) || 0;
    if (mode === 'total') {
      running += cell.value;
      return running;
    }
    return cell.value;
  });
  const maxValue = Math.max(1, ...modeValues);

  const cells = rawCells.map((cell, index) => {
    const value = modeValues[index];
    const weekStart = rawCells[cell.week * 7].date;
    const weekEnd = rawCells[Math.min((cell.week * 7) + 6, rawCells.length - 1)].date;
    return {
      day: cell.day,
      value,
      level: activityLevel(value, maxValue),
      week: cell.week,
      row: cell.row,
      index: cell.index,
      future: cell.future,
      ...activityCopy(cell, mode, weekStart, weekEnd, value),
    };
  });

  const months = [];
  let lastMonth = '';
  for (const cell of rawCells) {
    if (cell.future) continue;
    const month = `${cell.date.getFullYear()}-${cell.date.getMonth()}`;
    if (month !== lastMonth && cell.date.getDate() <= 7) {
      months.push({ label: `${cell.date.getMonth() + 1}月`, index: cell.week });
      lastMonth = month;
    }
  }

  return { cells, months: months.slice(-13) };
}
