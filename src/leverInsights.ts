// src/leverInsights.ts
// Rigorous habits & levers analysis.
//
//   - real denominators : completion is computed over every day the habit
//                         actually existed (from its tracking start), never
//                         just over days with a check-in. An unlogged day
//                         counts as a miss once the habit exists.
//   - lever validation  : two-sample Welch t-test of the daily completion
//                         rate (and mood rank) before vs after a lever was
//                         created, with a p-value and Cohen's d effect size.
//   - relapse detection : is the last ~7 days significantly below the
//                         previous ~4 weeks? (Welch t-test, honest flag.)
//
// Pure functions, minimum sample sizes, no fabricated numbers.

import type { CheckIn, Habit, Lever } from './types';
import { toDateKey, addDays, trackingStart } from './stats';
import { tTwoTail } from './statistics';
import { moodRank } from './correlations';

// --- Date helpers --------------------------------------------------------

function dateKeyOf(iso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateKey(dt);
}

function rangeKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 4000) {
    out.push(cur);
    cur = shiftKey(cur, 1);
    guard++;
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

// --- Real-denominator daily series ---------------------------------------

/**
 * Daily 0/1 series for one habit over its FULL existence window (tracking
 * start → today). An unlogged day is a real miss because the habit existed.
 */
export function habitExistenceSeries(
  habit: Habit,
  checkIns: CheckIn[],
  today: Date = new Date(),
): { date: string; value: number }[] {
  const start = trackingStart(habit, checkIns);
  if (!start) return [];
  const done = new Set<string>();
  for (const c of checkIns) if (c.habitId === habit.id && c.completed) done.add(c.date);
  const out: { date: string; value: number }[] = [];
  const todayKey = toDateKey(today);
  let d = start;
  let guard = 0;
  while (guard < 3700) {
    const key = toDateKey(d);
    out.push({ date: key, value: done.has(key) ? 1 : 0 });
    if (key >= todayKey) break;
    d = addDays(d, 1);
    guard++;
  }
  return out;
}

/** Daily completion % across active habits, using real existence windows. */
export function dailyGlobalRate(
  habits: Habit[],
  checkIns: CheckIn[],
  today: Date = new Date(),
): { date: string; value: number }[] {
  const byHabit = habits
    .filter((h) => !h.archived)
    .map((h) => habitExistenceSeries(h, checkIns, today))
    .filter((s) => s.length > 0);
  if (byHabit.length === 0) return [];

  const byDate = new Map<string, { done: number; tracked: number }>();
  for (const series of byHabit) {
    for (const { date, value } of series) {
      const cur = byDate.get(date) ?? { done: 0, tracked: 0 };
      cur.tracked += 1;
      if (value === 1) cur.done += 1;
      byDate.set(date, cur);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, value: v.tracked ? (v.done / v.tracked) * 100 : 0 }));
}

// --- Welch two-sample t-test ---------------------------------------------

export interface WelchResult {
  meanA: number;
  meanB: number;
  delta: number; // meanB − meanA
  t: number;
  df: number;
  p: number;
  significant: boolean;
  d: number | null; // Cohen's d effect size
}

/** Welch's t-test (unequal variances) with Satterthwaite degrees of freedom. */
export function welchTwoSample(a: number[], b: number[]): WelchResult | null {
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 || nB < 2) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = nA > 1 ? a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (nA - 1) : 0;
  const varB = nB > 1 ? b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (nB - 1) : 0;
  const se = Math.sqrt(varA / nA + varB / nB);
  if (!(se > 0)) return null;
  const t = (meanB - meanA) / se;
  const num = varA / nA + varB / nB;
  const den = Math.pow(varA / nA, 2) / (nA - 1) + Math.pow(varB / nB, 2) / (nB - 1);
  const df = den > 0 ? (num * num) / den : nA + nB - 2;
  const p = tTwoTail(Math.abs(t), df);
  const pooledVar = ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2);
  const d = pooledVar > 0 ? (meanB - meanA) / Math.sqrt(pooledVar) : null;
  return { meanA, meanB, delta: meanB - meanA, t, df, p, significant: p < 0.05, d };
}

// --- Lever before/after validation ---------------------------------------

export interface LeverValidation {
  leverId: string;
  content: string;
  createdAt: string;
  windowDays: number;
  needMoreData: boolean;
  beforeRate: number;
  afterRate: number;
  delta: number;
  p: number;
  d: number | null;
  significant: boolean;
  nBefore: number;
  nAfter: number;
  beforeMood: number;
  afterMood: number;
  moodDelta: number;
  moodP: number;
  moodSignificant: boolean;
  moodN: number;
}

const LEVER_WINDOW = 14;

/**
 * For each lever: compare the daily completion rate (real denominators) and
 * mood rank in the 14 days before vs after it was created.
 */
export function validateLevers(
  levers: Lever[],
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  today: Date = new Date(),
): LeverValidation[] {
  const rateByDate = new Map(dailyGlobalRate(habits, checkIns, today).map((p) => [p.date, p.value]));
  const moodByDate = new Map(Object.entries(moods).map(([d, id]) => [d, moodRank(id)]));
  const todayKey = toDateKey(today);

  return levers.map((l) => {
    const created = dateKeyOf(l.createdAt) ?? todayKey;
    const beforeDates = rangeKeys(shiftKey(created, -LEVER_WINDOW), shiftKey(created, -1));
    const afterEnd = shiftKey(created, LEVER_WINDOW - 1) < todayKey ? shiftKey(created, LEVER_WINDOW - 1) : todayKey;
    const afterDates = rangeKeys(created, afterEnd);

    const beforeRates = beforeDates.map((d) => rateByDate.get(d)).filter((v): v is number => v !== undefined);
    const afterRates = afterDates.map((d) => rateByDate.get(d)).filter((v): v is number => v !== undefined);
    const beforeMoods = beforeDates.map((d) => moodByDate.get(d)).filter((v): v is number => v !== undefined);
    const afterMoods = afterDates.map((d) => moodByDate.get(d)).filter((v): v is number => v !== undefined);

    const needMoreData = beforeRates.length < 5 || afterRates.length < 5;
    const wt = needMoreData ? null : welchTwoSample(beforeRates, afterRates);
    const wtMood = beforeMoods.length >= 5 && afterMoods.length >= 5
      ? welchTwoSample(beforeMoods, afterMoods)
      : null;

    return {
      leverId: l.id,
      content: l.content,
      createdAt: created,
      windowDays: LEVER_WINDOW,
      needMoreData,
      beforeRate: mean(beforeRates),
      afterRate: mean(afterRates),
      delta: wt ? wt.delta : 0,
      p: wt ? wt.p : 1,
      d: wt ? wt.d : null,
      significant: wt ? wt.significant : false,
      nBefore: beforeRates.length,
      nAfter: afterRates.length,
      beforeMood: mean(beforeMoods),
      afterMood: mean(afterMoods),
      moodDelta: wtMood ? wtMood.delta : 0,
      moodP: wtMood ? wtMood.p : 1,
      moodSignificant: wtMood ? wtMood.significant : false,
      moodN: (beforeMoods.length + afterMoods.length) / 2,
    };
  });
}

// --- Relapse detection ---------------------------------------------------

export interface RelapseCheck {
  habitId: string;
  name: string;
  recentMean: number;
  baselineMean: number;
  delta: number;
  p: number;
  d: number | null;
  significant: boolean;
  recentDays: number;
  baselineDays: number;
  relapse: boolean;
}

/**
 * Flag habits whose last ~7 days are significantly below the previous ~4
 * weeks (Welch t-test, threshold: >10 points lower to avoid trivial flags).
 */
export function detectRelapses(
  habits: Habit[],
  checkIns: CheckIn[],
  today: Date = new Date(),
): RelapseCheck[] {
  const out: RelapseCheck[] = [];
  for (const h of habits) {
    if (h.archived) continue;
    const series = habitExistenceSeries(h, checkIns, today);
    if (series.length < 21) continue;
    const recent = series.slice(-7).map((p) => p.value);
    const baseline = series.slice(-35, -7).map((p) => p.value);
    if (recent.length < 5 || baseline.length < 14) continue;
    const wt = welchTwoSample(baseline, recent);
    if (!wt) continue;
    // Report means as percentages (the Welch test itself ran on 0/1 values).
    const recentMean = mean(recent) * 100;
    const baselineMean = mean(baseline) * 100;
    out.push({
      habitId: h.id,
      name: h.name,
      recentMean,
      baselineMean,
      delta: wt.delta * 100,
      p: wt.p,
      d: wt.d,
      significant: wt.significant,
      recentDays: recent.length,
      baselineDays: baseline.length,
      relapse: wt.significant && recentMean < baselineMean - 10,
    });
  }
  return out;
}

// --- Automatic lever suggestions ------------------------------------------
// We mine the user's OWN data for behaviours that measurably co-occur with a
// better mood — no user input required. For every habit we Welch-test the mood
// rank (ordinal) on days the habit was done against days it was not (using only
// days with an explicit check-in, so unlogged days are excluded as ambiguous).
// A significant POSITIVE delta means "when I do X, my mood is better" → a
// candidate lever. The user validates with one click to make it a real lever.

export interface LeverSuggestion {
  habitId: string;
  name: string;
  emoji: string | null;
  meanWith: number;      // mean mood rank on days the habit was done
  meanWithout: number;   // mean mood rank on days it was not done
  delta: number;         // meanWith − meanWithout (positive = better mood)
  p: number;
  significant: boolean;
  d: number | null;      // Cohen's d
  doneDays: number;
  notDoneDays: number;
}

export function suggestLevers(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
): LeverSuggestion[] {
  const moodDates = Object.keys(moods).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (moodDates.length < 5) return [];
  const out: LeverSuggestion[] = [];

  for (const h of habits) {
    if (h.archived) continue;
    const state = new Map<string, number>();
    for (const c of checkIns) {
      if (c.habitId !== h.id) continue;
      if (c.completed) state.set(c.date, 1);
      else if (!state.has(c.date)) state.set(c.date, 0);
    }
    const done: number[] = [];
    const notDone: number[] = [];
    for (const date of moodDates) {
      if (!state.has(date)) continue; // ambiguous day (unlogged) → pairwise exclusion
      const rank = moodRank(moods[date]);
      if (state.get(date) === 1) done.push(rank);
      else notDone.push(rank);
    }
    const w = welchTwoSample(done, notDone);
    if (!w) continue;
    const delta = w.meanA - w.meanB; // done − notDone (positive = better mood)
    if (delta <= 0 || !w.significant) continue;
    if (done.length < 5) continue; // require a real sample of done days
    out.push({
      habitId: h.id,
      name: h.name,
      emoji: (h as unknown as Record<string, string | undefined>).emoji ?? null,
      meanWith: w.meanA,
      meanWithout: w.meanB,
      delta,
      p: w.p,
      significant: true,
      d: w.d,
      doneDays: done.length,
      notDoneDays: notDone.length,
    });
  }

  return out.sort((a, b) => b.delta - a.delta).slice(0, 8);
}