// src/weeklySummary.ts
// A compact, data-derived "your last 7 days" digest. Pure + local, so it lands
// in the Today view and Insights without touching any network. Nothing here is
// opinionated — just honest numbers from the user's own check-ins.

import type { CheckIn, Habit } from './types';
import { toDateKey } from './dates';

const DAYS = 7;

export interface WeeklyDay {
  date: string;   // YYYY-MM-DD
  done: number;   // habits completed that day
  total: number;  // active habits that day
  pct: number;    // 0-100
}

export interface WeeklySummary {
  days: WeeklyDay[];
  totalDone: number;     // sum of done over the week
  avgPct: number;        // average daily completion % (0-100)
  bestDay: string | null; // date with the highest pct
  activeHabits: number;  // distinct habits completed at least once this week
}

/** Build the trailing-7-day digest (ends today, includes today). */
export function weeklySummary(habits: Habit[], checkIns: CheckIn[], now: Date = new Date()): WeeklySummary {
  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(toDateKey(d));
  }

  const inWeek = new Set(dates);
  const activeIds = habits.filter((h) => !h.archived).map((h) => h.id);
  const total = activeIds.length;

  const perDay = new Map<string, Set<string>>();
  for (const ci of checkIns) {
    if (!ci.completed || !inWeek.has(ci.date)) continue;
    const set = perDay.get(ci.date) ?? new Set<string>();
    set.add(ci.habitId);
    perDay.set(ci.date, set);
  }

  let totalDone = 0;
  let bestDay: string | null = null;
  let bestPct = -1;
  const activeThisWeek = new Set<string>();

  const days: WeeklyDay[] = dates.map((date) => {
    const done = (perDay.get(date) ?? new Set()).size;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    totalDone += done;
    if (pct > 0 && pct > bestPct) { bestPct = pct; bestDay = date; }
    for (const id of perDay.get(date) ?? []) activeThisWeek.add(id);
    return { date, done, total, pct };
  });

  const avgPct = days.length > 0 ? Math.round(days.reduce((s, d) => s + d.pct, 0) / days.length) : 0;

  return { days, totalDone, avgPct, bestDay, activeHabits: activeThisWeek.size };
}