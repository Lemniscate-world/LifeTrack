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
//   - extends beyond same-day only: lag-1 correlations (X on day t vs Y on day
//     t+1), weekday/weekend split to expose weekday confounds, a full heatmap
//     matrix, and interpretive caveats that separate correlation from causation.
// All functions are pure (input → output) for easy isolated testing.

import type { CheckIn, Habit, CapacityRating, CorrelationResult, CorrelationCell, CorrelationAnalysis } from './types';
import { pearsonTest, spearmanTest, benjaminiHochberg, requiredSampleSize, correlationRobustness } from './statistics';

/** Distinct ordinal rank for each mood id (the raw number is irrelevant; Spearman
 * uses relative order). angry and bad are both low; sick slightly above bad. */
const MOOD_RANK: Record<string, number> = {
  bad: 1, angry: 2, sick: 3, tired: 4, okay: 5, calm: 6, great: 7, amazing: 8,
};

export function moodRank(moodId: string): number {
  return MOOD_RANK[moodId] ?? 5;
}

/** Weekday number for a YYYY-MM-DD key: 0=Sun … 6=Sat. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Shift a YYYY-MM-DD key by ±days. */
export function shiftDateKey(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Enumerate every distinct date across all sources, oldest → newest. */
function allDates(checkIns: CheckIn[], moods: Record<string, string>, ratings: CapacityRating[], energies?: Record<string, number>): string[] {
  const set = new Set<string>();
  for (const c of checkIns) if (c.date) set.add(c.date);
  for (const k of Object.keys(moods)) set.add(k);
  for (const r of ratings) if (r.date) set.add(r.date);
  for (const k of Object.keys(energies ?? {})) set.add(k);
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

/**
 * Align with a LEAD: x values come from the earlier series (day t), y values
 * from the later series (day t+lag). This powers predictive lag correlations:
 * "habit on day t vs mood on day t+1". Pairwise deletion applies to BOTH ends.
 */
function alignLag(
  a: Map<string, number>,
  b: Map<string, number>,
  lag: number,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const date of a.keys()) {
    const target = shiftDateKey(date, lag);
    if (b.has(target)) {
      xs.push(a.get(date)!);
      ys.push(b.get(target)!);
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

/** Grounding caveat for a correlation pair (corrélation ≠ causation). */
function caveatFor(method: 'pearson' | 'spearman', lag: number, window?: 'weekday' | 'weekend'): string {
  const scope = window === 'weekday' ? ' sur les jours ouvrés uniquement' : window === 'weekend' ? ' sur les week-ends uniquement' : '';
  const stat = method === 'pearson' ? 'coefficient de Pearson' : 'coefficient de rang de Spearman';
  if (lag > 0) {
    return `Corrélation prédictive (X jour t → Y jour t+${lag})${scope}, via ${stat}. La temporalité soutient la direction, mais n'implique pas une causalité : un facteur tiers (sommeil, stress, week-end) peut piloter les deux.`;
  }
  return `Corrélation contemporaine${scope}, via ${stat}. Le lien est statistique, pas causal : un facteur confondant (saison, humeur générale, événements de vie) peut expliquer les deux.`;
}

/** Build a CorrelationResult from a test outcome (with lag/window metadata). */
function build(
  metricA: string,
  metricB: string,
  method: 'pearson' | 'spearman',
  xs: number[],
  ys: number[],
  lag = 0,
  window?: 'weekday' | 'weekend',
): { item: Omit<CorrelationResult, 'qValue' | 'significant'>; p: number } | null {
  const test = method === 'pearson' ? pearsonTest(xs, ys) : spearmanTest(xs, ys);
  if (!test || test.p === 1) return null;
  const coefficient = method === 'pearson' ? (test as { r: number }).r : (test as { rho: number }).rho;
  const robust = correlationRobustness(xs, ys, method);
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
      lag: lag > 0 ? lag : undefined,
      window,
      caveat: caveatFor(method, lag, window),
      winsorizedCoefficient: robust.winsorizedCoefficient,
      stability: robust.stability,
      outlierDriven: robust.outlierDriven,
      autocorrelatedResiduals: robust.autocorrelatedResiduals,
    },
    p: test.p,
  };
}

interface SeriesSet {
  habitSeries: Map<string, Map<string, number>>;
  activeHabits: Habit[];
  moodSeries: Map<string, number>;
  energySeries: Map<string, number>;
  capSeries: Map<string, Map<string, number>>;
}

/** Build all date→value series, optionally filtered to a weekday subset. */
function buildSeries(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
  window?: 'weekday' | 'weekend',
  energies?: Record<string, number>,
): SeriesSet {
  const activeHabits = habits.filter((h) => !h.archived);
  const habitSeries = new Map<string, Map<string, number>>();
  for (const h of activeHabits) {
    let hd = habitSeriesByDate(h.id, checkIns);
    if (window) {
      const sub = new Map<string, number>();
      for (const [date, v] of hd) if (weekdayOf(date) !== 0 && weekdayOf(date) !== 6 ? window === 'weekday' : window === 'weekend') sub.set(date, v);
      hd = sub;
    }
    if (hd.size >= 3) habitSeries.set(h.id, hd);
  }

  let moodSeries = new Map<string, number>();
  for (const [date, moodId] of Object.entries(moods)) moodSeries.set(date, moodRank(moodId));
  if (window) {
    const sub = new Map<string, number>();
    for (const [date, v] of moodSeries) if (weekdayOf(date) !== 0 && weekdayOf(date) !== 6 ? window === 'weekday' : window === 'weekend') sub.set(date, v);
    moodSeries = sub;
  }

  const capSeries = new Map<string, Map<string, number>>();
  for (const cap of capacities) {
    const cm = new Map<string, number>();
    for (const r of ratings) {
      if (r.capacityId === cap.id && r.rating !== undefined) {
        if (!window || (weekdayOf(r.date) !== 0 && weekdayOf(r.date) !== 6 ? window === 'weekday' : window === 'weekend')) {
          cm.set(r.date, r.rating);
        }
      }
    }
    if (cm.size >= 3) capSeries.set(cap.id, cm);
  }

  let energySeries = new Map<string, number>();
  for (const [date, v] of Object.entries(energies ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) energySeries.set(date, v);
  }
  if (window) {
    const sub = new Map<string, number>();
    for (const [date, v] of energySeries) if (weekdayOf(date) !== 0 && weekdayOf(date) !== 6 ? window === 'weekday' : window === 'weekend') sub.set(date, v);
    energySeries = sub;
  }

  return { habitSeries, activeHabits, moodSeries, energySeries, capSeries };
}

function nameOf(id: string, set: SeriesSet, capacities: { id: string; name: string }[]): string {
  const h = set.activeHabits.find((x) => x.id === id);
  if (h) return h.name;
  const cap = capacities.find((c) => c.id === id);
  return cap ? cap.name : id;
}

interface Raw { item: Omit<CorrelationResult, 'qValue' | 'significant'>; p: number }

/**
 * A correlation is "trustworthy" (close to reality) only when it survives all
 * the anti-misleading checks: FDR-significant, not driven by a single outlier,
 * and its direction is stable under jackknife. Used by the UI to de-emphasise
 * fragile results instead of treating every star as a real discovery.
 */
export function isTrustworthy(r: CorrelationResult): boolean {
  return Boolean(r.significant && !r.outlierDriven && (r.stability === undefined || r.stability >= 0.7));
}

/** Attach FDR-adjusted q-values and sort by |coefficient| (strongest first). */
function finalize(raw: Raw[]): CorrelationResult[] {
  if (raw.length === 0) return [];
  const qValues = benjaminiHochberg(raw.map((r) => r.p));
  return raw
    .map((r, idx): CorrelationResult => ({
      ...r.item,
      qValue: qValues[idx],
      significant: qValues[idx] < 0.05,
      pairKey: `${r.item.metricA}↔${r.item.metricB}${r.item.window ? `@${r.item.window}` : ''}`,
    }))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
}

/**
 * Compute contemporaneous (lag=0) correlations between habits, mood and
 * capacities over ALL days. Returns results sorted by absolute coefficient
 * with FDR-adjusted q. Backwards-compatible entry point.
 */
export function computeCorrelations(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
  energies?: Record<string, number>,
): CorrelationResult[] {
  return runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: undefined }, energies);
}

/**
 * Compute the full correlation analysis: contemporaneous, lag-1, weekday and
 * weekend windows, plus a heatmap matrix and interpretive caveats.
 */
export function computeCorrelationAnalysis(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
  energies?: Record<string, number>,
): CorrelationAnalysis {
  const dates = allDates(checkIns, moods, ratings, energies);
  if (dates.length < 5) {
    return { sameDay: [], lag1: [], weekday: [], weekend: [], matrix: [], metrics: [], caveats: defaultCaveats() };
  }
  const sameDay = runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: undefined }, energies);
  const lag1 = runPairs(habits, checkIns, moods, capacities, ratings, { lag: 1, window: undefined }, energies);
  const weekday = runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: 'weekday' }, energies);
  const weekend = runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: 'weekend' }, energies);

  // Heatmap matrix over all metric pairs (all habits + Mood + Énergie + capacities).
  const set = buildSeries(habits, checkIns, moods, capacities, ratings, undefined, energies);
  const hasEnergy = set.energySeries.size >= 3;
  const metrics = [
    ...set.activeHabits.map((h) => h.name),
    ...(Object.keys(moods).length > 0 ? ['Mood'] : []),
    ...(hasEnergy ? ['Énergie'] : []),
    ...capacities.map((c) => c.name),
  ];
  const matrix: CorrelationCell[] = [];
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const a = seriesForLabel(metrics[i], set, capacities);
      const b = seriesForLabel(metrics[j], set, capacities);
      if (!a || !b) continue;
      const { xs, ys } = align(a, b);
      if (xs.length >= 6) {
        const usesMood = metrics[i] === 'Mood' || metrics[j] === 'Mood';
        const test = usesMood ? spearmanTest(xs, ys) : pearsonTest(xs, ys);
        if (test && test.p !== 1) {
          const coeff = usesMood ? (test as { rho: number }).rho : (test as { r: number }).r;
          matrix.push({
            row: metrics[i],
            col: metrics[j],
            coefficient: coeff,
            sampleSize: xs.length,
            significant: test.p < 0.05,
            qValue: test.p,
          });
        }
      }
    }
  }

  return {
    sameDay,
    lag1,
    weekday,
    weekend,
    matrix,
    metrics,
    caveats: defaultCaveats(),
  };
}

function defaultCaveats(): string[] {
  return [
    'Corrélation ≠ causalité : une association forte ne prouve pas qu’un facteur cause l’autre.',
    'Confondant possible : un tiers (sommeil, stress, week-end, événements de vie) peut piloter les deux variables.',
    'Une corrélation contemporaine ne dit rien sur la direction du lien.',
    'Les corrélations lag (X → Y le lendemain) soutiennent la direction temporelle, mais n’éliminent pas les confondants.',
    'N faible = faible puissance : vérifie toujours N (jours alignés) vs requiredN avant de conclure.',
  ];
}

function seriesForLabel(
  label: string,
  set: SeriesSet,
  capacities: { id: string; name: string }[],
): Map<string, number> | null {
  if (label === 'Mood') return set.moodSeries;
  if (label === 'Énergie') return set.energySeries;
  const h = set.activeHabits.find((x) => x.name === label);
  if (h) return set.habitSeries.get(h.id) ?? null;
  const cap = capacities.find((c) => c.name === label);
  if (cap) return set.capSeries.get(cap.id) ?? null;
  return null;
}

interface RunOptions {
  lag: number;
  window?: 'weekday' | 'weekend';
}

function runPairs(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
  opts: RunOptions,
  energies?: Record<string, number>,
): CorrelationResult[] {
  const set = buildSeries(habits, checkIns, moods, capacities, ratings, opts.window, energies);
  const raw: Raw[] = [];

  const habitArr = [...set.habitSeries.entries()];
  for (let i = 0; i < habitArr.length; i++) {
    for (let j = i + 1; j < habitArr.length; j++) {
      const [idA, mapA] = habitArr[i];
      const [idB, mapB] = habitArr[j];
      const { xs, ys } = opts.lag > 0 ? alignLag(mapA, mapB, opts.lag) : align(mapA, mapB);
      if (xs.length >= 6) {
        const r = build(nameOf(idA, set, capacities), nameOf(idB, set, capacities), 'pearson', xs, ys, opts.lag, opts.window);
        if (r) raw.push(r);
      }
    }
  }

  for (const [id, map] of set.habitSeries) {
    const { xs, ys } = opts.lag > 0 ? alignLag(map, set.moodSeries, opts.lag) : align(map, set.moodSeries);
    if (xs.length >= 6) {
      const r = build(nameOf(id, set, capacities), 'Mood', 'spearman', xs, ys, opts.lag, opts.window);
      if (r) raw.push(r);
    }
  }

  for (const [, cm] of set.capSeries) {
    const { xs, ys } = opts.lag > 0 ? alignLag(cm, set.moodSeries, opts.lag) : align(cm, set.moodSeries);
    if (xs.length >= 6) {
      const r = build('Capacité', 'Mood', 'spearman', xs, ys, opts.lag, opts.window);
      if (r) raw.push(r);
    }
  }

  // Energy (continuous %) ↔ habits, mood and capacities — Pearson everywhere
  // (both sides are metric). Lag-1: does today's energy predict tomorrow's habit?
  if (set.energySeries.size >= 3) {
    for (const [habitId, hm] of set.habitSeries) {
      const { xs, ys } = opts.lag > 0 ? alignLag(hm, set.energySeries, opts.lag) : align(hm, set.energySeries);
      if (xs.length >= 6) {
        const r = build(nameOf(habitId, set, capacities), 'Énergie', 'pearson', xs, ys, opts.lag, opts.window);
        if (r) raw.push(r);
      }
    }
    {
      const { xs, ys } = opts.lag > 0 ? alignLag(set.energySeries, set.moodSeries, opts.lag) : align(set.energySeries, set.moodSeries);
      if (xs.length >= 6) {
        const r = build('Énergie', 'Mood', 'pearson', xs, ys, opts.lag, opts.window);
        if (r) raw.push(r);
      }
    }
    for (const [capId, cm] of set.capSeries) {
      const { xs, ys } = opts.lag > 0 ? alignLag(cm, set.energySeries, opts.lag) : align(cm, set.energySeries);
      if (xs.length >= 6) {
        const r = build(nameOf(capId, set, capacities), 'Énergie', 'pearson', xs, ys, opts.lag, opts.window);
        if (r) raw.push(r);
      }
    }
  }

  for (const [capId, cm] of set.capSeries) {
    for (const [habitId, hm] of set.habitSeries) {
      const { xs, ys } = opts.lag > 0 ? alignLag(hm, cm, opts.lag) : align(hm, cm);
      if (xs.length >= 6) {
        const r = build(nameOf(habitId, set, capacities), nameOf(capId, set, capacities), 'pearson', xs, ys, opts.lag, opts.window);
        if (r) raw.push(r);
      }
    }
  }

  return finalize(raw);
}