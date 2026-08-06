// src/correlations.ts
// Pure, rigorous correlation engine between habits, mood and capacities.
//
// Compared with the previous version this engine:
//   - uses PAIRWISE DELETION: each correlation is computed only over days where
//     BOTH series have real data, so a missing mood is never imputed as "neutral"
//     and a missing check-in is never treated as "not done" just because a habit
//     did not exist yet.
//   - uses Spearman (rank) whenever an ordinal variable (mood) is involved and
//     Pearson for metric×metric (habit vs habit).
//   - reports a two-tailed p-value, a 95% confidence interval, a Benjamini–
//     Hochberg FDR-adjusted q-value, and the sample size needed to reach 80%
//     power — instead of hiding behind arbitrary |r| thresholds.
// All functions are pure (input → output) for easy isolated testing.

import type { CheckIn, Habit, CapacityRating, CorrelationResult } from './types';
import { pearsonTest, spearmanTest, benjaminiHochberg, requiredSampleSize } from './statistics';

/** Distinct ordinal rank for each mood id (the raw number is irrelevant; Spearman
 * uses relative order). angry and bad are both low; sick slightly above bad. */
const MOOD_RANK: Record<string, number> = {
  bad: 1, angry: 2, sick: 3, tired: 4, okay: 5, calm: 6, great: 7, amazing: 8,
};

function moodRank(moodId: string): number {
  return MOOD_RANK[moodId] ?? 5;
}

/** Enumerate every distinct date across all sources, oldest → newest. */
function allDates(checkIns: CheckIn[], moods: Record<string, string>, ratings: CapacityRating[]): string[] {
  const set = new Set<string>();
  for (const c of checkIns) if (c.date) set.add(c.date);
  for (const k of Object.keys(moods)) set.add(k);
  for (const r of ratings) if (r.date) set.add(r.date);
  return [...set].sort();
}

/**
 * Daily state for a habit: number of completions on days it was done, 0 on
 * days with an explicit miss, and absent on days with no check-in at all
 * (ambiguous — excluded by pairwise deletion). This keeps a series from being
 * constant "all done" just because missing days were never recorded.
 */
function habitSeriesByDate(habitId: string, checkIns: CheckIn[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of checkIns) {
    if (c.habitId !== habitId) continue;
    if (c.completed) {
      m.set(c.date, (m.get(c.date) ?? 0) + (c.count ?? 1));
    } else if (!m.has(c.date)) {
      m.set(c.date, 0);
    }
  }
  return m;
}

/**
 * Align two data sources on the days where BOTH have an entry, returning
 * numeric x/y arrays with pairwise deletion (no 0-imputation).
 */
function align(
  a: Map<string, number>,
  b: Map<string, number>,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const date of a.keys()) {
    if (b.has(date)) {
      xs.push(a.get(date)!);
      ys.push(b.get(date)!);
    }
  }
  return { xs, ys };
}

/** Classify effect-size strength by |coefficient|. */
function classifyStrength(r: number): CorrelationResult['strength'] {
  const abs = Math.abs(r);
  if (abs >= 0.6) return 'strong';
  if (abs >= 0.3) return 'moderate';
  if (abs >= 0.1) return 'weak';
  return 'none';
}

/** Build a CorrelationResult from a test outcome. */
function build(
  metricA: string,
  metricB: string,
  method: 'pearson' | 'spearman',
  xs: number[],
  ys: number[],
): { item: Omit<CorrelationResult, 'qValue' | 'significant'>; p: number } | null {
  const test = method === 'pearson' ? pearsonTest(xs, ys) : spearmanTest(xs, ys);
  if (!test || test.p === 1) return null;
  const coefficient = method === 'pearson' ? (test as { r: number }).r : (test as { rho: number }).rho;
  return {
    item: {
      metricA,
      metricB,
      coefficient,
      strength: classifyStrength(coefficient),
      direction: coefficient >= 0 ? 'positive' : 'negative',
      sampleSize: xs.length,
      method,
      pValue: test.p,
      ciLow: test.ci[0],
      ciHigh: test.ci[1],
      requiredN: requiredSampleSize(coefficient, 0.05, 0.8),
    },
    p: test.p,
  };
}

/**
 * Compute correlations between habits, mood and capacities. Returns results
 * sorted by absolute coefficient (strongest first) with FDR-adjusted q.
 */
export function computeCorrelations(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
): CorrelationResult[] {
  const dates = allDates(checkIns, moods, ratings);
  if (dates.length < 5) return [];

  // --- Build each series as a date→value map for clean pairwise alignment ---
  const habitSeries = new Map<string, Map<string, number>>();
  for (const h of habits) {
    if (h.archived) continue;
    const hd = habitSeriesByDate(h.id, checkIns);
    if (hd.size >= 3) habitSeries.set(h.id, hd);
  }
  const activeHabits = habits.filter((h) => !h.archived);

  // Mood series as rank values (only on days a mood exists).
  const moodSeries = new Map<string, number>();
  for (const [date, moodId] of Object.entries(moods)) {
    moodSeries.set(date, moodRank(moodId));
  }

  // Capacity series as rated values.
  const capSeries = new Map<string, Map<string, number>>();
  for (const cap of capacities) {
    const cm = new Map<string, number>();
    for (const r of ratings) {
      if (r.capacityId === cap.id && r.rating !== undefined) {
        cm.set(r.date, r.rating);
      }
    }
    if (cm.size >= 3) capSeries.set(cap.id, cm);
  }

  // --- compute raw results with p-values ---
  interface Raw { item: Omit<CorrelationResult, 'qValue' | 'significant'>; p: number }
  const raw: Raw[] = [];

  // habit ↔ habit (Pearson: both are metric counts)
  const habitArr = [...habitSeries.entries()];
  for (let i = 0; i < habitArr.length; i++) {
    for (let j = i + 1; j < habitArr.length; j++) {
      const [idA, mapA] = habitArr[i];
      const [idB, mapB] = habitArr[j];
      const { xs, ys } = align(mapA, mapB);
      if (xs.length >= 6) {
        const r = build(nameOf(idA), nameOf(idB), 'pearson', xs, ys);
        if (r) raw.push(r);
      }
    }
  }

  // habit ↔ mood (Spearman, mood is ordinal)
  for (const [id, map] of habitSeries) {
    const { xs, ys } = align(map, moodSeries);
    if (xs.length >= 6) {
      const r = build(nameOf(id), 'Mood', 'spearman', xs, ys);
      if (r) raw.push(r);
    }
  }

  // capacity ↔ mood (Spearman, mood is ordinal)
  for (const [, cm] of capSeries) {
    const { xs, ys } = align(cm, moodSeries);
    if (xs.length >= 6) {
      const r = build('Capacité', 'Mood', 'spearman', xs, ys);
      if (r) raw.push(r);
    }
  }

  // habit ↔ capacity (Pearson, both metric) — rare but rigorous
  for (const [capId, cm] of capSeries) {
    for (const [habitId, hm] of habitSeries) {
      const { xs, ys } = align(hm, cm);
      if (xs.length >= 6) {
        const r = build(nameOf(habitId), nameOf(capId), 'pearson', xs, ys);
        if (r) raw.push(r);
      }
    }
  }

  if (raw.length === 0) return [];

  // --- multiple-comparison correction (Benjamini–Hochberg) ---
  const qValues = benjaminiHochberg(raw.map((r) => r.p));

  return raw
    .map((r, idx): CorrelationResult => ({
      ...r.item,
      qValue: qValues[idx],
      significant: qValues[idx] < 0.05,
    }))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));

  function nameOf(id: string): string {
    const h = activeHabits.find((x) => x.id === id);
    if (h) return h.name;
    const cap = capacities.find((c) => c.id === id);
    return cap ? cap.name : id;
  }
}