// src/urgeInsights.ts
// Rigorous analysis of urges and mood: how urges behave, whether they predict
// the next day, and how emotionally volatile the user is.
//
//   - survival       : urge-surfing success rate with a Wilson confidence
//                      interval (no arbitrary thresholds, no bare averages).
//   - lag correlations: does urge intensity on day D predict mood or habit
//                      completion on day D+1? (Spearman, two-tailed p-value.)
//   - surf vs give-in : does surfing (vs giving in) lead to a better mood the
//                      next day?
//   - urge success    : Mann-Kendall trend of the daily surfed fraction.
//   - emotional vol   : volatility of the daily mood-rank series.
//
// Same principles as correlations.ts / timeseries.ts: pure functions, no
// imputed missing days, minimum sample sizes, honest p-values.

import type { CheckIn, Habit, UrgeEntry } from './types';
import { spearmanTest, wilsonInterval } from './statistics';
import { moodRank } from './correlations';
import { trendTest, seriesVolatility, dayOffsets, type TrendResult } from './timeseries';

// --- Small date helpers (local civil dates, YYYY-MM-DD) ---

function dateKeyOf(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// --- Wilson proportion ---------------------------------------------------

export interface ProportionCI {
  rate: number; // 0-100
  low: number;  // 0-100
  high: number; // 0-100
  k: number;
  n: number;
}

/** Wilson score interval for k successes in n trials (95% by default). */
export function proportionWithCI(k: number, n: number, z = 1.96): ProportionCI | null {
  if (n < 1 || k < 0 || k > n) return null;
  const [lo, hi] = wilsonInterval(k, n, z);
  return { rate: (k / n) * 100, low: lo * 100, high: hi * 100, k, n };
}

// --- Daily urge series ---------------------------------------------------

export interface DailyUrge {
  date: string;
  maxIntensity: number;
  count: number;
  surfed: number;
  ended: number; // urges with an outcome (surfed or gave_in)
  surfedFrac: number; // surfed / ended, 0 when nothing ended that day
}

/** Aggregate urges per day (by the local date of startTime). */
export function dailyUrgeSeries(urges: UrgeEntry[]): DailyUrge[] {
  const byDate = new Map<string, { max: number; count: number; surfed: number; ended: number }>();
  for (const u of urges) {
    const d = dateKeyOf(u.startTime);
    if (!d) continue;
    const cur = byDate.get(d) ?? { max: 0, count: 0, surfed: 0, ended: 0 };
    cur.count += 1;
    cur.max = Math.max(cur.max, u.intensity);
    if (u.outcome === 'surfed' || u.outcome === 'gave_in') {
      cur.ended += 1;
      if (u.outcome === 'surfed') cur.surfed += 1;
    }
    byDate.set(d, cur);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({
      date,
      maxIntensity: v.max,
      count: v.count,
      surfed: v.surfed,
      ended: v.ended,
      surfedFrac: v.ended > 0 ? v.surfed / v.ended : 0,
    }));
}

// --- Lag correlations ----------------------------------------------------

export interface LagCorrelation {
  lagDays: number;
  n: number;
  rho: number;
  p: number;
  significant: boolean;
  direction: 'positive' | 'negative';
}

/**
 * Correlation between x on day t and y on day t+lagDays (Spearman). Only
 * overlapping pairs are used; missing days are never imputed.
 */
export function lagCorrelate(
  x: { date: string; value: number }[],
  y: { date: string; value: number }[],
  lagDays: number,
): LagCorrelation | null {
  const xByDate = new Map(x.map((p) => [p.date, p.value]));
  const yByDate = new Map(y.map((p) => [p.date, p.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, yv] of yByDate) {
    const prev = shiftDateKey(date, -lagDays);
    const xv = xByDate.get(prev);
    if (xv !== undefined) {
      xs.push(xv);
      ys.push(yv);
    }
  }
  if (xs.length < 10) return null;
  const test = spearmanTest(xs, ys);
  if (!test) return null;
  return {
    lagDays,
    n: xs.length,
    rho: test.rho,
    p: test.p,
    significant: test.p < 0.05,
    direction: test.rho >= 0 ? 'positive' : 'negative',
  };
}

// --- Daily mood / completion series --------------------------------------

function dailyMoodSeries(moods: Record<string, string>): { date: string; value: number }[] {
  return Object.entries(moods)
    .map(([date, id]) => ({ date, value: moodRank(id) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Daily completion rate across active habits: completed / habit-days tracked. */
function dailyCompletionSeries(habits: Habit[], checkIns: CheckIn[]): { date: string; value: number }[] {
  const activeIds = new Set(habits.filter((h) => !h.archived).map((h) => h.id));
  const byDate = new Map<string, { done: number; tracked: number }>();
  for (const c of checkIns) {
    if (!activeIds.has(c.habitId)) continue;
    const cur = byDate.get(c.date) ?? { done: 0, tracked: 0 };
    cur.tracked += 1;
    if (c.completed) cur.done += 1;
    byDate.set(c.date, cur);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .filter(([, v]) => v.tracked > 0)
    .map(([date, v]) => ({ date, value: (v.done / v.tracked) * 100 }));
}

// --- Surf vs give-in → next-day mood -------------------------------------

export interface SurfVsGiveIn {
  surfedNextMood: number;
  gaveInNextMood: number;
  nSurfed: number;
  nGaveIn: number;
}

/**
 * Average mood rank on the day AFTER an urge, split by whether the urge was
 * surfed or given in. Returns null when either group is too small.
 */
export function surfedVsGiveInNextMood(urges: UrgeEntry[], moods: Record<string, string>): SurfVsGiveIn | null {
  const moodByDate = new Map(Object.entries(moods).map(([d, id]) => [d, moodRank(id)]));
  const surfed: number[] = [];
  const gaveIn: number[] = [];
  for (const u of urges) {
    if (u.outcome !== 'surfed' && u.outcome !== 'gave_in') continue;
    const d = dateKeyOf(u.endTime ?? u.startTime);
    if (!d) continue;
    const next = moodByDate.get(shiftDateKey(d, 1));
    if (next === undefined) continue;
    (u.outcome === 'surfed' ? surfed : gaveIn).push(next);
  }
  if (surfed.length < 3 || gaveIn.length < 3) return null;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    surfedNextMood: mean(surfed),
    gaveInNextMood: mean(gaveIn),
    nSurfed: surfed.length,
    nGaveIn: gaveIn.length,
  };
}

// --- Emotional volatility ------------------------------------------------

export interface EmotionalVolatility {
  n: number;
  stdDev: number;
  meanAbsChange: number;
  mad: number;
}

/** Volatility of the daily mood-rank series (swingy mood → high values). */
export function emotionalVolatility(moods: Record<string, string>): EmotionalVolatility | null {
  const dates = Object.keys(moods).sort();
  if (dates.length < 2) return null;
  const v = seriesVolatility(dates.map((d) => moodRank(moods[d])));
  if (!v) return null;
  return { n: dates.length, ...v };
}

// --- Urge success trend --------------------------------------------------

/** Mann-Kendall trend of the daily surfed fraction (days with ≥1 ended urge). */
export function urgeSuccessTrend(urges: UrgeEntry[]): TrendResult | null {
  const daily = dailyUrgeSeries(urges).filter((d) => d.ended >= 1);
  if (daily.length < 10) return null;
  const times = dayOffsets(daily.map((d) => d.date));
  return trendTest(daily.map((d) => d.surfedFrac), times);
}

// --- Aggregate insight summary -------------------------------------------

export interface UrgeInsightSummary {
  survival: ProportionCI | null;
  perType: { typeId: string; survival: ProportionCI }[];
  nextDayMood: LagCorrelation | null;
  nextDayCompletion: LagCorrelation | null;
  surfVsGiveIn: SurfVsGiveIn | null;
  successTrend: TrendResult | null;
  emotionalVolatility: EmotionalVolatility | null;
}

export function computeUrgeInsights(
  urges: UrgeEntry[],
  moods: Record<string, string>,
  habits: Habit[],
  checkIns: CheckIn[],
): UrgeInsightSummary {
  const resolved = urges.filter((u) => u.outcome === 'surfed' || u.outcome === 'gave_in');
  const surfedCount = resolved.filter((u) => u.outcome === 'surfed').length;

  const byType = new Map<string, { k: number; n: number }>();
  for (const u of resolved) {
    const cur = byType.get(u.type) ?? { k: 0, n: 0 };
    cur.n += 1;
    if (u.outcome === 'surfed') cur.k += 1;
    byType.set(u.type, cur);
  }

  const daily = dailyUrgeSeries(urges);
  const moodDaily = dailyMoodSeries(moods);
  const completionDaily = dailyCompletionSeries(habits, checkIns);
  const intensityDaily = daily
    .filter((d) => d.maxIntensity > 0)
    .map((d) => ({ date: d.date, value: d.maxIntensity }));

  return {
    survival: proportionWithCI(surfedCount, resolved.length),
    perType: [...byType.entries()]
      .filter(([, v]) => v.n >= 3)
      .map(([typeId, v]) => ({ typeId, survival: proportionWithCI(v.k, v.n)! }))
      .sort((a, b) => b.survival.rate - a.survival.rate),
    nextDayMood: lagCorrelate(intensityDaily, moodDaily, 1),
    nextDayCompletion: lagCorrelate(intensityDaily, completionDaily, 1),
    surfVsGiveIn: surfedVsGiveInNextMood(urges, moods),
    successTrend: urgeSuccessTrend(urges),
    emotionalVolatility: emotionalVolatility(moods),
  };
}