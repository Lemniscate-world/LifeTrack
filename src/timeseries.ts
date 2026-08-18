// src/timeseries.ts
// Rigorous, dependency-free time-series analysis for the life-tracking data:
//   - trend detection   : Mann-Kendall test (tie-corrected, two-tailed) +
//                         robust Theil-Sen slope.
//   - changepoints      : CUSUM statistic with a permutation significance
//                         test (seeded RNG, so results are reproducible).
//   - volatility        : sample standard deviation, mean absolute successive
//                         change and median absolute deviation.
//   - seasonality       : per-weekday completion rates + chi-square test of
//                         independence between weekday and outcome.
//
// Principles (same as correlations.ts):
//   - no fallback numbers: a trend/changepoint/seasonality is only reported
//     when the test has enough data AND a meaningful p-value.
//   - missing days are never imputed: a day with no check-in is ambiguous and
//     is excluded rather than guessed (pairwise philosophy).
//   - every function is pure and deterministic (seeded RNG) for unit testing.

import type { CheckIn, Habit } from './types';
import { logGamma } from './statistics';
import { moodRank } from './correlations';
import { weekdayOf } from './dates';

// --- Basic helpers -------------------------------------------------------

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Deterministic PRNG (mulberry32) so permutation tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- Chi-square upper-tail p-value (regularized upper incomplete gamma) --

function gser(a: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  if (x <= 0) return 0;
  const gln = logGamma(a);
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let i = 1; i <= MAXIT; i++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gln);
}

function gcf(a: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const gln = logGamma(a);
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAXIT; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Regularized upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x < a + 1) return 1 - gser(a, x);
  return gcf(a, x);
}

/**
 * Upper-tail p-value for a chi-square statistic with `df` degrees of freedom.
 * P(χ²_ν > x) = Q(ν/2, x/2) where Q is the regularized upper incomplete gamma.
 */
export function chiSquareUpperP(x: number, df: number): number {
  if (df <= 0 || !(x >= 0)) return 1;
  if (x === 0) return 1;
  return gammaQ(df / 2, x / 2);
}

/**
 * Two-tailed p-value for a normal z-statistic. Uses erfc(|z|/√2) = Q(1/2, z²/2),
 * exact and stable for both tiny and moderate p-values.
 */
export function normalTwoTail(z: number): number {
  return gammaQ(0.5, (z * z) / 2);
}

// --- Mann-Kendall trend test -------------------------------------------

export interface KendallTest {
  tau: number;
  s: number;
  variance: number;
  z: number;
  p: number;
}

/**
 * Mann-Kendall test for monotonic trend. Two-tailed, corrected for ties in
 * the values (the time index has no ties). The normal approximation (with a
 * continuity correction) is standard and adequate for n >= 10.
 */
export function mannKendall(values: number[]): KendallTest | null {
  const n = values.length;
  if (n < 10) return null;

  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (values[j] > values[i]) s += 1;
      else if (values[j] < values[i]) s -= 1;
    }
  }

  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);

  let tieTerm = 0;
  for (const t of freq.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  let tieDenom = 0;
  for (const t of freq.values()) tieDenom += (t * (t - 1)) / 2;
  const denom = (n * (n - 1)) / 2 - tieDenom;

  if (denom <= 0 || variance <= 0) return { tau: 0, s: 0, variance: 0, z: 0, p: 1 };

  const tau = s / denom;
  const z = s > 0 ? (s - 0.5) / Math.sqrt(variance) : s < 0 ? (s + 0.5) / Math.sqrt(variance) : 0;
  const p = normalTwoTail(Math.abs(z));

  return { tau, s, variance, z, p };
}

/** Robust trend slope (Theil-Sen): median of all pairwise slopes. */
export function theilSenSlope(values: number[], times?: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const t = times ?? values.map((_, i) => i);
  if (t.length !== n) return null;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dt = t[j] - t[i];
      if (dt === 0) continue;
      slopes.push((values[j] - values[i]) / dt);
    }
  }
  if (slopes.length === 0) return null;
  return median(slopes);
}

export type TrendDirection = 'up' | 'down' | 'stable';

export interface TrendResult {
  n: number;
  tau: number;
  slope: number; // units per time step (calendar day when `times` are given)
  slopeUnit: 'step' | 'day';
  p: number;
  direction: TrendDirection;
  significant: boolean;
}

export function trendTest(values: number[], times?: number[]): TrendResult | null {
  const mk = mannKendall(values);
  if (!mk) return null;
  const slope = theilSenSlope(values, times);
  const direction: TrendDirection = mk.tau > 0 ? 'up' : mk.tau < 0 ? 'down' : 'stable';
  return {
    n: values.length,
    tau: mk.tau,
    slope: slope ?? 0,
    slopeUnit: times ? 'day' : 'step',
    p: mk.p,
    direction,
    significant: mk.p < 0.05,
  };
}

// --- Changepoint detection (CUSUM + permutation test) ------------------

export interface ChangepointResult {
  /** First index (0-based) of the new regime. 0..bestIdx is the old one. */
  index: number;
  meanBefore: number;
  meanAfter: number;
  delta: number;
  direction: 'up' | 'down';
  p: number;
  significant: boolean;
}

/**
 * Detect the most likely mean shift via the CUSUM statistic, restricted to
 * splits between minFrac and 1−minFrac of the series, and assess significance
 * with a permutation test (seeded, so reproducible).
 */
export function detectChangepoint(
  values: number[],
  options: { perms?: number; seed?: number; minFrac?: number } = {},
): ChangepointResult | null {
  const { perms = 1000, seed = 20260806, minFrac = 0.2 } = options;
  const n = values.length;
  if (n < 10) return null;

  const mean = avg(values);
  const lo = Math.max(1, Math.floor(minFrac * n));
  const hi = Math.min(n - 1, Math.ceil((1 - minFrac) * n));

  let c = 0;
  let bestIdx = -1;
  let bestAbs = -1;
  for (let i = 0; i < n; i++) {
    c += values[i] - mean;
    if (i >= lo && i < hi) {
      const a = Math.abs(c);
      if (a > bestAbs) {
        bestAbs = a;
        bestIdx = i;
      }
    }
  }
  if (bestIdx < 0) return null;

  const split = bestIdx + 1; // left = 0..bestIdx, right = bestIdx+1..n-1
  const meanBefore = avg(values.slice(0, split));
  const meanAfter = avg(values.slice(split));
  const delta = meanAfter - meanBefore;

  const rng = mulberry32(seed);
  const buf = values.slice();
  let exceed = 0;
  for (let it = 0; it < perms; it++) {
    shuffle(buf, rng);
    const m = avg(buf);
    let c2 = 0;
    let mx = 0;
    for (let i = 0; i < n; i++) {
      c2 += buf[i] - m;
      if (i >= lo && i < hi) mx = Math.max(mx, Math.abs(c2));
    }
    if (mx >= bestAbs) exceed++;
  }
  const p = (exceed + 1) / (perms + 1);

  return {
    index: split,
    meanBefore,
    meanAfter,
    delta,
    direction: delta >= 0 ? 'up' : 'down',
    p,
    significant: p < 0.05,
  };
}

// --- Volatility --------------------------------------------------------

export interface Volatility {
  stdDev: number;
  meanAbsChange: number;
  mad: number;
}

export function seriesVolatility(values: number[]): Volatility | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = avg(values);
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  const stdDev = Math.sqrt(ss / (n - 1));
  let mac = 0;
  for (let i = 1; i < n; i++) mac += Math.abs(values[i] - values[i - 1]);
  mac /= n - 1;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return { stdDev, meanAbsChange: mac, mad };
}

// --- Weekday seasonality -----------------------------------------------

export const WEEKDAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export interface WeekdayProfile {
  /** Completion rate [0-100] per weekday (0=Sun .. 6=Sat). */
  rates: number[];
  /** Completed days per weekday. */
  counts: number[];
  /** Recorded days per weekday. */
  totals: number[];
  overall: number;
  best: number;
  worst: number;
  chi2: number;
  df: number;
  p: number;
  significant: boolean;
}

/**
 * Completion rate by weekday, with a chi-square test of independence between
 * weekday and done/missed outcome. Only recorded days are used (a day with no
 * check-in is ambiguous and excluded — pairwise philosophy).
 */
export function weekdaySeasonality(
  series: { date: string; value: number }[],
): WeekdayProfile | null {
  if (series.length < 14) return null;
  const counts = new Array(7).fill(0);
  const totals = new Array(7).fill(0);
  let totalDone = 0;
  for (const { date, value } of series) {
    const w = weekdayOf(date);
    counts[w] += value ? 1 : 0;
    totals[w] += 1;
    totalDone += value ? 1 : 0;
  }
  if (totals.some((t) => t === 0)) return null; // some weekday never recorded
  const totalDays = series.length;
  const overall = totalDays ? (totalDone / totalDays) * 100 : 0;
  const rates = totals.map((t, i) => (t ? (counts[i] / t) * 100 : 0));

  const missed = totalDays - totalDone;
  let chi2 = 0;
  for (let w = 0; w < 7; w++) {
    const eDone = (totalDone * totals[w]) / totalDays;
    const eMissed = (missed * totals[w]) / totalDays;
    if (eDone > 0) chi2 += (counts[w] - eDone) ** 2 / eDone;
    if (eMissed > 0) chi2 += (totals[w] - counts[w] - eMissed) ** 2 / eMissed;
  }
  const df = 6;
  const p = chiSquareUpperP(chi2, df);

  let best = 0;
  let worst = 0;
  for (let w = 1; w < 7; w++) {
    if (rates[w] > rates[best]) best = w;
    if (rates[w] < rates[worst]) worst = w;
  }
  return { rates, counts, totals, overall, best, worst, chi2, df, p, significant: p < 0.05 };
}

// --- Habit / mood summary builders -------------------------------------

export interface HabitTrend {
  habitId: string;
  name: string;
  days: number;
  from: string;
  to: string;
  trend: TrendResult | null;
  changepoint: ChangepointResult | null;
  changepointAt: string | null;
  volatility: Volatility | null;
  weekday: WeekdayProfile | null;
}

/** Daily binary state for a habit: 1 done, 0 explicit miss, absent if unlogged. */
function habitBinarySeries(habitId: string, checkIns: CheckIn[]): { date: string; value: number }[] {
  const byDate = new Map<string, number>();
  for (const c of checkIns) {
    if (c.habitId !== habitId) continue;
    if (c.completed) byDate.set(c.date, 1);
    else if (!byDate.has(c.date)) byDate.set(c.date, 0);
  }
  return [...byDate.keys()].sort().map((date) => ({ date, value: byDate.get(date)! }));
}

/** Calendar-day offsets (days since the first date), ascending. */
export function dayOffsets(dates: string[]): number[] {
  const [y0, m0, d0] = dates[0].split('-').map(Number);
  const t0 = new Date(y0, m0 - 1, d0).getTime();
  return dates.map((date) => {
    const [y, m, d] = date.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d).getTime() - t0) / 86400000);
  });
}

export function computeHabitTrends(habits: Habit[], checkIns: CheckIn[]): HabitTrend[] {
  return habits
    .filter((h) => !h.archived)
    .map((h) => {
      const series = habitBinarySeries(h.id, checkIns);
      const days = series.length;
      if (days < 10) {
        return {
          habitId: h.id,
          name: h.name,
          days,
          from: series[0]?.date ?? '',
          to: series[series.length - 1]?.date ?? '',
          trend: null,
          changepoint: null,
          changepointAt: null,
          volatility: null,
          weekday: null,
        };
      }
      const values = series.map((s) => s.value);
      const times = dayOffsets(series.map((s) => s.date));
      const cp = detectChangepoint(values);
      return {
        habitId: h.id,
        name: h.name,
        days,
        from: series[0].date,
        to: series[series.length - 1].date,
        trend: trendTest(values, times),
        changepoint: cp,
        changepointAt: cp ? (series[cp.index]?.date ?? null) : null,
        volatility: seriesVolatility(values),
        weekday: weekdaySeasonality(series),
      };
    });
}

/** Mann-Kendall trend of daily mood (ordinal rank), calendar-dated. */
export function moodTrend(moods: Record<string, string>): TrendResult | null {
  const dates = Object.keys(moods).sort();
  if (dates.length < 10) return null;
  const values = dates.map((d) => moodRank(moods[d]));
  const times = dayOffsets(dates);
  return trendTest(values, times);
}