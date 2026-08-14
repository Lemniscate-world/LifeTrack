// src/gainsAnalysis.ts
// Pure "Gains" engine: completion percentage per habit, per domain/category,
// per period, plus the delta between periods (improvement/regression in pts).
// Also supports a weekday/weekend filter by reusing the weekdayOf helper.
//
// Everything is pure (input → output) for easy isolated testing. No store
// import here: the caller passes habits + checkIns + a date.

import type { Habit, CheckIn } from './types';
import { weekdayOf } from './correlations';
import { trackingStart, toDateKey, addDays } from './stats';

export type DayWindow = 'all' | 'weekday' | 'weekend';
export type PeriodKey = '7d' | '30d' | '90d' | 'all';

export const PERIOD_DAYS: Record<Exclude<PeriodKey, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export interface HabitGain {
  habitId: string;
  name: string;
  category?: string;
  /** Completion % over each period (0-100). */
  rates: Record<PeriodKey, number>;
  /** Delta in points between consecutive periods: 7d→30d, 30d→90d. */
  deltas: { d7to30: number; d30to90: number };
  /** Days since the habit started tracking (reliability). */
  trackingDays: number;
  /** Current streak in days (motivational context). */
  streak: number;
}

export interface DomainGain {
  categoryId: string;    // 'health' | 'work' | … or '__none__'
  categoryName: string;
  emoji: string;
  color: string;
  /** Average completion % over the selected period across domain habits. */
  avgRate: number;
  /** Count of habits in the domain. */
  count: number;
  habits: HabitGain[];
}

export interface GainsReport {
  domains: DomainGain[];
  totalHabits: number;
  overallAvg: number;    // avg over the selected period
  generatedAt: string;
}

/** Category metadata (mirrors DEFAULT_CATEGORIES in App.tsx). */
export const GAIN_CATEGORIES: { id: string; name: string; emoji: string; color: string }[] = [
  { id: 'health', name: 'Health', emoji: '💪', color: '#10b981' },
  { id: 'work', name: 'Work', emoji: '💼', color: '#6366f1' },
  { id: 'personal', name: 'Personal', emoji: '🌟', color: '#f59e0b' },
  { id: 'learning', name: 'Learning', emoji: '📚', color: '#8b5cf6' },
  { id: 'mindfulness', name: 'Mindfulness', emoji: '🧘', color: '#ec4899' },
  { id: 'finance', name: 'Finance', emoji: '💰', color: '#14b8a6' },
];

function catMeta(id: string | undefined): { id: string; name: string; emoji: string; color: string } {
  const found = GAIN_CATEGORIES.find((c) => c.id === id);
  return found ?? { id: '__none__', name: 'Non classé', emoji: '🏷️', color: '#94a3b8' };
}

function inWindow(date: string, window: DayWindow): boolean {
  if (window === 'all') return true;
  const wd = weekdayOf(date);
  return window === 'weekday' ? wd !== 0 && wd !== 6 : wd === 0 || wd === 6;
}

/**
 * Completion rate over `windowDays` (or all-time when <= 0), counting only the
 * days that fall inside the DayWindow (all / weekday / weekend). A day counts
 * as "tracked" from the habit's real start; a day in the window without a
 * completed check-in is a miss once the habit existed. This keeps the weekday
 * denominator to actual weekdays instead of dividing by the whole calendar.
 */
function rateForWindow(
  habit: Habit,
  checkIns: CheckIn[],
  windowDays: number,
  window: DayWindow,
  today: Date,
): number {
  const done = new Set(checkIns.filter((c) => c.habitId === habit.id && c.completed).map((c) => c.date));
  const start = trackingStart(habit, checkIns);
  const windowStart = windowDays > 0 ? addDays(today, -(windowDays - 1)) : start ?? addDays(today, -3650);
  const effectiveStart = start && start > windowStart ? start : windowStart;

  let completed = 0;
  let total = 0;
  for (let d = new Date(effectiveStart); d <= today; d = addDays(d, 1)) {
    const key = toDateKey(d);
    if (!inWindow(key, window)) continue;
    total++;
    if (done.has(key)) completed++;
  }
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

function computeStreak(habit: Habit, checkIns: CheckIn[], today: Date): number {
  const done = new Set(checkIns.filter((c) => c.habitId === habit.id && c.completed).map((c) => c.date));
  let streak = 0;
  const d = new Date(today);
  // Iterate backward from today until a miss (or a day with no data before start).
  const start = trackingStart(habit, checkIns);
  const startKey = start ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` : '';
  for (;;) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (done.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      // A miss today only breaks the streak if the habit existed then.
      if (key < startKey) break;
      break;
    }
  }
  return streak;
}

/**
 * Build the gains report.
 * @param period the period over which avgRate / display rates are emphasized
 *   (7d, 30d, 90d, or all-time). All period rates are always computed.
 */
export function computeGains(
  habits: Habit[],
  checkIns: CheckIn[],
  period: PeriodKey,
  window: DayWindow = 'all',
  today: Date = new Date(),
): GainsReport {
  const active = habits.filter((h) => !h.archived);

  const habitGains: HabitGain[] = active.map((h) => {
    const rates = {} as Record<PeriodKey, number>;
    (Object.keys(PERIOD_DAYS) as (keyof typeof PERIOD_DAYS)[]).forEach((k) => {
      rates[k] = rateForWindow(h, checkIns, PERIOD_DAYS[k], window, today);
    });
    rates.all = rateForWindow(h, checkIns, 0, window, today);

    const start = trackingStart(h, checkIns);
    const trackingDays = start ? Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000)) : 0;

    return {
      habitId: h.id,
      name: h.name,
      category: h.category,
      rates,
      deltas: {
        d7to30: rates['30d'] - rates['7d'],
        d30to90: rates['90d'] - rates['30d'],
      },
      trackingDays,
      streak: computeStreak(h, checkIns, today),
    };
  });

  const byDomain = new Map<string, HabitGain[]>();
  for (const g of habitGains) {
    const key = g.category ?? '__none__';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key)!.push(g);
  }

  const domains: DomainGain[] = [...byDomain.entries()].map(([catId, list]) => {
    const meta = catMeta(catId);
    const avgRate = list.length
      ? Math.round(list.reduce((s, g) => s + g.rates[period], 0) / list.length)
      : 0;
    return {
      categoryId: meta.id,
      categoryName: meta.name,
      emoji: meta.emoji,
      color: meta.color,
      avgRate,
      count: list.length,
      habits: list.sort((a, b) => b.rates[period] - a.rates[period]),
    };
  });

  // Sort domains: best average first.
  domains.sort((a, b) => b.avgRate - a.avgRate);

  return {
    domains,
    totalHabits: habitGains.length,
    overallAvg: habitGains.length ? Math.round(habitGains.reduce((s, g) => s + g.rates[period], 0) / habitGains.length) : 0,
    generatedAt: today.toISOString(),
  };
}