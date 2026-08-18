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
import { pearsonTest, spearmanTest, benjaminiHochberg, requiredSampleSize, correlationRobustness, detrendedCorrelation, fisherZ, fisherZInv, partialCorrelation, maxAttainableR } from './statistics';
import { moonPhaseAt } from './astrology';
import { fromDateKey, shiftDateKey, weekdayOf } from './dates';
// Re-exported for backward compatibility (gainsAnalysis imports weekdayOf from here).
export { weekdayOf, shiftDateKey };

/** Distinct ordinal rank for each mood id (the raw number is irrelevant; Spearman
 * uses relative order). angry and bad are both low; sick slightly above bad. */
const MOOD_RANK: Record<string, number> = {
  bad: 1, angry: 2, sick: 3, tired: 4, okay: 5, calm: 6, great: 7, amazing: 8,
};

export function moodRank(moodId: string): number {
  return MOOD_RANK[moodId] ?? 5;
}

/** Enumerate every distinct date across all sources, oldest → newest. */
function allDates(checkIns: CheckIn[], moods: Record<string, string>, ratings: CapacityRating[], energies?: Record<string, number>, concentrations?: Record<string, number>): string[] {
  const set = new Set<string>();
  for (const c of checkIns) if (c.date) set.add(c.date);
  for (const k of Object.keys(moods)) set.add(k);
  for (const r of ratings) if (r.date) set.add(r.date);
  for (const k of Object.keys(energies ?? {})) set.add(k);
  for (const k of Object.keys(concentrations ?? {})) set.add(k);
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
 * numeric x/y arrays with pairwise deletion (no 0-imputation). Pairs are
 * returned in chronological order so time-based diagnostics (detrending,
 * weekday strata) see a true calendar sequence.
 */
function align(
  a: Map<string, number>,
  b: Map<string, number>,
): { xs: number[]; ys: number[]; dates: string[] } {
  const dates: string[] = [];
  for (const date of a.keys()) {
    if (b.has(date)) dates.push(date);
  }
  dates.sort();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const date of dates) {
    xs.push(a.get(date)!);
    ys.push(b.get(date)!);
  }
  return { xs, ys, dates };
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
): { xs: number[]; ys: number[]; dates: string[] } {
  const dates: string[] = [];
  for (const date of a.keys()) {
    if (b.has(shiftDateKey(date, lag))) dates.push(date);
  }
  dates.sort();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const date of dates) {
    xs.push(a.get(date)!);
    ys.push(b.get(shiftDateKey(date, lag))!);
  }
  return { xs, ys, dates };
}

/**
 * Pooled within-stratum correlation (weekday vs weekend), via Fisher-z
 * n-weighted averaging. Returns the estimate when BOTH strata have enough
 * paired days, otherwise null. Used to expose weekday/weekend confounds:
 * if the pooled estimate collapses vs the raw correlation, the "link" is
 * really a weekday/weekend contrast.
 */
function withinStratumCoefficient(
  xs: number[],
  ys: number[],
  dates: string[],
  method: 'pearson' | 'spearman',
): number | null {
  const strata: { xs: number[]; ys: number[] }[] = [{ xs: [], ys: [] }, { xs: [], ys: [] }];
  for (let i = 0; i < dates.length; i++) {
    const isWeekend = weekdayOf(dates[i]) === 0 || weekdayOf(dates[i]) === 6;
    strata[isWeekend ? 1 : 0].xs.push(xs[i]);
    strata[isWeekend ? 1 : 0].ys.push(ys[i]);
  }
  const zs: { z: number; n: number }[] = [];
  for (const s of strata) {
    if (s.xs.length < 5) continue;
    const test = method === 'pearson' ? pearsonTest(s.xs, s.ys) : spearmanTest(s.xs, s.ys);
    if (!test || test.p === 1) continue;
    const r = method === 'pearson' ? (test as { r: number }).r : (test as { rho: number }).rho;
    zs.push({ z: fisherZ(r), n: s.xs.length });
  }
  if (zs.length < 2) return null;
  const weight = zs.reduce((s, z) => s + (z.n - 3), 0);
  if (weight <= 0) return null;
  const pooled = zs.reduce((s, z) => s + (z.n - 3) * z.z, 0) / weight;
  return fisherZInv(pooled);
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
  dates?: string[],
  set?: SeriesSet,
): { item: Omit<CorrelationResult, 'qValue' | 'significant'>; p: number } | null {
  const test = method === 'pearson' ? pearsonTest(xs, ys) : spearmanTest(xs, ys);
  if (!test || test.p === 1) return null;
  const coefficient = method === 'pearson' ? (test as { r: number }).r : (test as { rho: number }).rho;
  const robust = correlationRobustness(xs, ys, method);

  // "Close to reality" guards (only meaningful on non-windowed pairs):
  //   1) shared calendar trend — correlation on detrended residuals (applies
  //      to same-day AND lag pairs: a shared drift inflates both).
  //   2) weekday/weekend confound — pooled within-stratum estimate (same-day only).
  //   3) confounder control — partial correlation vs Mood / Énergie (same-day only).
  //   4) lunar phase control — mood pairs only (same-day only).
  //   5) base-rate ceiling — max attainable |r| given the marginal frequencies.
  let detrended: number | null = null;
  let trendDriven = false;
  let weekdayConfounded = false;
  let partialCoefficient: number | null = null;
  let confounder: 'Mood' | 'Énergie' | undefined;
  let confoundDriven = false;
  let lunarCoefficient: number | null = null;
  let lunarDriven = false;
  let maxR: number | null = null;
  let atCeiling = false;

  if (dates && dates.length >= 6 && !window) {
    const dt = detrendedCorrelation(xs, ys, method);
    if (dt) {
      detrended = dt.r;
      trendDriven = Math.abs(coefficient - dt.r) > 0.2 && Math.abs(dt.r) < 0.35;
    }
    if (lag === 0) {
      const within = withinStratumCoefficient(xs, ys, dates, method);
      if (within !== null && Math.abs(coefficient) >= 0.15) {
        weekdayConfounded = Math.abs(within) < Math.abs(coefficient) - 0.2;
      }

      if (set) {
        // Confounder control: pick the strongest reducer among Mood / Énergie.
        const candidates: { label: 'Mood' | 'Énergie'; series: Map<string, number> }[] = [];
        if (metricA !== 'Mood' && metricB !== 'Mood') candidates.push({ label: 'Mood', series: set.moodSeries });
        if (metricA !== 'Énergie' && metricB !== 'Énergie') candidates.push({ label: 'Énergie', series: set.energySeries });
        for (const cand of candidates) {
          const zs = dates.map((d) => cand.series.get(d)).filter((v): v is number => v !== undefined);
          if (zs.length !== dates.length || zs.length < 7) continue;
          const pc = partialCorrelation(xs, ys, zs, method);
          if (pc && (partialCoefficient === null || Math.abs(pc.r) < Math.abs(partialCoefficient))) {
            partialCoefficient = pc.r;
            confounder = cand.label;
          }
        }
        confoundDriven = partialCoefficient !== null
          && Math.abs(partialCoefficient) < Math.abs(coefficient) - 0.2
          && Math.abs(partialCoefficient) < 0.35;

        // Lunar phase control (mood pairs): the mood may follow the moon cycle.
        if (metricA === 'Mood' || metricB === 'Mood') {
          const zs = dates.map((d) => Math.sin((2 * Math.PI * moonPhaseAt(fromDateKey(d))) / 360));
          const pc = partialCorrelation(xs, ys, zs, method);
          if (pc) {
            lunarCoefficient = pc.r;
            lunarDriven = Math.abs(pc.r) < Math.abs(coefficient) - 0.2 && Math.abs(pc.r) < 0.35;
          }
        }
      }
    }
  }

  const maxRVal = maxAttainableR(xs, ys);
  if (maxRVal !== null && maxRVal > 0.05) {
    maxR = maxRVal;
    atCeiling = maxRVal < 0.5 && Math.abs(coefficient) > 0.85 * maxRVal;
  }

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
      detrendedCoefficient: detrended,
      trendDriven,
      weekdayConfounded,
      partialCoefficient,
      confounder,
      confoundDriven,
      lunarCoefficient,
      lunarDriven,
      maxR,
      atCeiling,
    },
    p: test.p,
  };
}

interface SeriesSet {
  habitSeries: Map<string, Map<string, number>>;
  activeHabits: Habit[];
  moodSeries: Map<string, number>;
  energySeries: Map<string, number>;
  concentrationSeries: Map<string, number>;
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
  concentrations?: Record<string, number>,
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

  let concentrationSeries = new Map<string, number>();
  for (const [date, v] of Object.entries(concentrations ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) concentrationSeries.set(date, v);
  }
  if (window) {
    const sub = new Map<string, number>();
    for (const [date, v] of concentrationSeries) if (weekdayOf(date) !== 0 && weekdayOf(date) !== 6 ? window === 'weekday' : window === 'weekend') sub.set(date, v);
    concentrationSeries = sub;
  }

  return { habitSeries, activeHabits, moodSeries, energySeries, concentrationSeries, capSeries };
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
  return Boolean(
    r.significant && !r.outlierDriven && (r.stability === undefined || r.stability >= 0.7)
    && !r.trendDriven && !r.weekdayConfounded,
  );
}

/** Attach FDR-adjusted q-values and sort by |coefficient| (strongest first).
 * Single-run version used by the standalone computeCorrelations entry point. */
function finalize(raw: Raw[]): CorrelationResult[] {
  if (raw.length === 0) return [];
  const qValues = benjaminiHochberg(raw.map((r) => r.p));
  return raw
    .map((r, idx): CorrelationResult => ({
      ...r.item,
      qValue: qValues[idx],
      significant: qValues[idx] < 0.05,
      directionSupported: r.item.reversePValue === undefined
        ? undefined
        : qValues[idx] < 0.05 && r.item.reversePValue >= 0.05,
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
  concentrations?: Record<string, number>,
): CorrelationResult[] {
  return finalize(runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: undefined }, energies, concentrations));
}

/**
 * Compute the full correlation analysis: contemporaneous, lag-1..7, weekday and
 * weekend windows, heatmap matrices (all days + weekday/weekend), interpretive
 * caveats. The FDR correction is applied ONCE over all windows combined — a
 * pair significant in same-day is judged against the total number of tests the
 * user can browse, not the per-tab count (honesty across the whole analysis).
 */
export function computeCorrelationAnalysis(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
  energies?: Record<string, number>,
  concentrations?: Record<string, number>,
): CorrelationAnalysis {
  const dates = allDates(checkIns, moods, ratings, energies, concentrations);
  if (dates.length < 5) {
    return { sameDay: [], lag1: [], weekday: [], weekend: [], matrix: [], metrics: [], caveats: defaultCaveats() };
  }
  const raws = [
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: undefined }, energies, concentrations),
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 1, window: undefined }, energies, concentrations),
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 2, window: undefined }, energies, concentrations),
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 3, window: undefined }, energies, concentrations),
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 7, window: undefined }, energies, concentrations),
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: 'weekday' }, energies, concentrations),
    runPairs(habits, checkIns, moods, capacities, ratings, { lag: 0, window: 'weekend' }, energies, concentrations),
  ];
  const [sameDay, lag1, lag2, lag3, lag7, weekday, weekend] = globalFinalize(raws);

  const set = buildSeries(habits, checkIns, moods, capacities, ratings, undefined, energies, concentrations);
  const matrixInfo = buildMatrix(set, capacities);
  const weekdaySet = buildSeries(habits, checkIns, moods, capacities, ratings, 'weekday', energies, concentrations);
  const weekendSet = buildSeries(habits, checkIns, moods, capacities, ratings, 'weekend', energies, concentrations);
  const matrixWeekday = buildMatrix(weekdaySet, capacities).cells;
  const matrixWeekend = buildMatrix(weekendSet, capacities).cells;

  return {
    sameDay,
    lag1,
    lag2,
    lag3,
    lag7,
    weekday,
    weekend,
    matrix: matrixInfo.cells,
    matrixWeekday,
    matrixWeekend,
    metrics: matrixInfo.metrics,
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
  if (label === 'Concentration') return set.concentrationSeries;
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
  concentrations?: Record<string, number>,
): Raw[] {
  const set = buildSeries(habits, checkIns, moods, capacities, ratings, opts.window, energies, concentrations);
  const raw: Raw[] = [];

  const habitArr = [...set.habitSeries.entries()];
  for (let i = 0; i < habitArr.length; i++) {
    for (let j = i + 1; j < habitArr.length; j++) {
      const [idA, mapA] = habitArr[i];
      const [idB, mapB] = habitArr[j];
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(mapA, mapB, opts.lag) : align(mapA, mapB);
      if (xs.length >= 6) {
        const r = build(nameOf(idA, set, capacities), nameOf(idB, set, capacities), 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) {
          attachReverse(r.item, mapA, mapB, nameOf(idA, set, capacities), nameOf(idB, set, capacities), opts, set);
          raw.push(r);
        }
      }
    }
  }

  for (const [id, map] of set.habitSeries) {
    const { xs, ys, dates } = opts.lag > 0 ? alignLag(map, set.moodSeries, opts.lag) : align(map, set.moodSeries);
    if (xs.length >= 6) {
      const r = build(nameOf(id, set, capacities), 'Mood', 'spearman', xs, ys, opts.lag, opts.window, dates, set);
      if (r) {
        attachReverse(r.item, map, set.moodSeries, nameOf(id, set, capacities), 'Mood', opts, set);
        raw.push(r);
      }
    }
  }

  for (const [, cm] of set.capSeries) {
    const { xs, ys, dates } = opts.lag > 0 ? alignLag(cm, set.moodSeries, opts.lag) : align(cm, set.moodSeries);
    if (xs.length >= 6) {
      const r = build('Capacité', 'Mood', 'spearman', xs, ys, opts.lag, opts.window, dates, set);
      if (r) raw.push(r);
    }
  }

  // Energy (continuous %) ↔ habits, mood and capacities — Pearson everywhere
  // (both sides are metric). Lag-1: does today's energy predict tomorrow's habit?
  if (set.energySeries.size >= 3) {
    for (const [habitId, hm] of set.habitSeries) {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(hm, set.energySeries, opts.lag) : align(hm, set.energySeries);
      if (xs.length >= 6) {
        const r = build(nameOf(habitId, set, capacities), 'Énergie', 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) {
          attachReverse(r.item, hm, set.energySeries, nameOf(habitId, set, capacities), 'Énergie', opts, set);
          raw.push(r);
        }
      }
    }
    {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(set.energySeries, set.moodSeries, opts.lag) : align(set.energySeries, set.moodSeries);
      if (xs.length >= 6) {
        const r = build('Énergie', 'Mood', 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) {
          attachReverse(r.item, set.energySeries, set.moodSeries, 'Énergie', 'Mood', opts, set);
          raw.push(r);
        }
      }
    }
  }

  // Concentration (continuous %) ↔ habits, mood, capacities and energy.
  if (set.concentrationSeries.size >= 3) {
    for (const [habitId, hm] of set.habitSeries) {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(hm, set.concentrationSeries, opts.lag) : align(hm, set.concentrationSeries);
      if (xs.length >= 6) {
        const r = build(nameOf(habitId, set, capacities), 'Concentration', 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) {
          attachReverse(r.item, hm, set.concentrationSeries, nameOf(habitId, set, capacities), 'Concentration', opts, set);
          raw.push(r);
        }
      }
    }
    {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(set.concentrationSeries, set.moodSeries, opts.lag) : align(set.concentrationSeries, set.moodSeries);
      if (xs.length >= 6) {
        const r = build('Concentration', 'Mood', 'spearman', xs, ys, opts.lag, opts.window, dates, set);
        if (r) {
          attachReverse(r.item, set.concentrationSeries, set.moodSeries, 'Concentration', 'Mood', opts, set);
          raw.push(r);
        }
      }
    }
    for (const [capId, cm] of set.capSeries) {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(cm, set.concentrationSeries, opts.lag) : align(cm, set.concentrationSeries);
      if (xs.length >= 6) {
        const r = build(nameOf(capId, set, capacities), 'Concentration', 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) raw.push(r);
      }
    }
    if (set.energySeries.size >= 3) {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(set.energySeries, set.concentrationSeries, opts.lag) : align(set.energySeries, set.concentrationSeries);
      if (xs.length >= 6) {
        const r = build('Énergie', 'Concentration', 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) raw.push(r);
      }
    }
  }

  for (const [capId, cm] of set.capSeries) {
const { xs, ys, dates } = opts.lag > 0 ? alignLag(cm, set.energySeries, opts.lag) : align(cm, set.energySeries);
      if (xs.length >= 6) {
        const r = build(nameOf(capId, set, capacities), 'Énergie', 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) raw.push(r);
      }
    }

  for (const [capId, cm] of set.capSeries) {
    for (const [habitId, hm] of set.habitSeries) {
      const { xs, ys, dates } = opts.lag > 0 ? alignLag(hm, cm, opts.lag) : align(hm, cm);
      if (xs.length >= 6) {
        const r = build(nameOf(habitId, set, capacities), nameOf(capId, set, capacities), 'pearson', xs, ys, opts.lag, opts.window, dates, set);
        if (r) raw.push(r);
      }
    }
  }

  return raw;
}

/**
 * Granger-lite direction test: for lag-1 pairs, also compute the reverse
 * (Y(t) → X(t+1)). If only the forward direction is significant, the temporal
 * order is supported — the link is not just "everything predicts everything".
 */
function attachReverse(
  item: Omit<CorrelationResult, 'qValue' | 'significant'>,
  mapA: Map<string, number>,
  mapB: Map<string, number>,
  nameA: string,
  nameB: string,
  opts: RunOptions,
  set: SeriesSet,
): void {
  if (opts.lag !== 1 || opts.window) return;
  const rev = alignLag(mapB, mapA, 1);
  if (rev.xs.length < 6) return;
  const method = nameA === 'Mood' || nameB === 'Mood' ? 'spearman' : 'pearson';
  const rb = build(nameB, nameA, method, rev.xs, rev.ys, 1, undefined, rev.dates, set);
  if (rb) {
    item.reverseLagCoefficient = rb.item.coefficient;
    item.reversePValue = rb.p;
  }
}

/**
 * Global FDR: all windows are pooled into ONE Benjamini–Hochberg correction,
 * then split back into the per-window lists (honest across the whole browseable
 * analysis). Each list is sorted by |coefficient|.
 */
function globalFinalize(raws: Raw[][]): CorrelationResult[][] {
  const all: { raw: Raw; windowIdx: number }[] = [];
  raws.forEach((list, windowIdx) => list.forEach((raw) => all.push({ raw, windowIdx })));
  if (all.length === 0) return raws.map(() => []);
  const qValues = benjaminiHochberg(all.map((e) => e.raw.p));
  const out: CorrelationResult[][] = raws.map(() => []);
  all.forEach((e, idx) => {
    out[e.windowIdx].push({
      ...e.raw.item,
      qValue: qValues[idx],
      significant: qValues[idx] < 0.05,
      directionSupported: e.raw.item.reversePValue === undefined
        ? undefined
        : qValues[idx] < 0.05 && e.raw.item.reversePValue >= 0.05,
      pairKey: `${e.raw.item.metricA}↔${e.raw.item.metricB}${e.raw.item.window ? `@${e.raw.item.window}` : ''}`,
    });
  });
  return out.map((list) => list.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient)));
}

/** Heatmap matrix over all metric pairs for a (possibly windowed) series set. */
function buildMatrix(
  set: SeriesSet,
  capacities: { id: string; name: string }[],
  window?: 'weekday' | 'weekend',
): { cells: CorrelationCell[]; metrics: string[] } {
  const hasEnergy = set.energySeries.size >= 3;
  const hasConcentration = set.concentrationSeries.size >= 3;
  const metrics = [
    ...set.activeHabits.map((h) => h.name),
    ...(set.moodSeries.size > 0 ? ['Mood'] : []),
    ...(hasEnergy ? ['Énergie'] : []),
    ...(hasConcentration ? ['Concentration'] : []),
    ...capacities.map((c) => c.name),
  ];
  const matrixRaw: { row: string; col: string; coefficient: number; sampleSize: number; p: number; detrendedCoefficient: number | null; trendDriven: boolean; weekdayConfounded: boolean; maxR: number | null; atCeiling: boolean }[] = [];
  const matrixPs: number[] = [];
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const a = seriesForLabel(metrics[i], set, capacities);
      const b = seriesForLabel(metrics[j], set, capacities);
      if (!a || !b) continue;
      const { xs, ys, dates } = align(a, b);
      if (xs.length >= 6) {
        const usesMood = metrics[i] === 'Mood' || metrics[j] === 'Mood';
        const method = usesMood ? 'spearman' : 'pearson';
        const test = method === 'spearman' ? spearmanTest(xs, ys) : pearsonTest(xs, ys);
        if (test && test.p !== 1) {
          const coeff = usesMood ? (test as { rho: number }).rho : (test as { r: number }).r;
          const dt = detrendedCorrelation(xs, ys, method);
          const within = window ? null : withinStratumCoefficient(xs, ys, dates, method);
          const maxR = maxAttainableR(xs, ys);
          matrixPs.push(test.p);
          matrixRaw.push({
            row: metrics[i],
            col: metrics[j],
            coefficient: coeff,
            sampleSize: xs.length,
            p: test.p,
            detrendedCoefficient: dt ? dt.r : null,
            trendDriven: dt !== null && Math.abs(coeff - dt.r) > 0.2 && Math.abs(dt.r) < 0.35,
            weekdayConfounded: within !== null && Math.abs(coeff) >= 0.15 && Math.abs(within) < Math.abs(coeff) - 0.2,
            maxR: maxR !== null && maxR > 0.05 ? maxR : null,
            atCeiling: maxR !== null && maxR > 0.05 && maxR < 0.5 && Math.abs(coeff) > 0.85 * maxR,
          });
        }
      }
    }
  }
  const matrixQs = benjaminiHochberg(matrixPs);
  const cells: CorrelationCell[] = matrixRaw.map((raw, idx) => ({
    row: raw.row,
    col: raw.col,
    coefficient: raw.coefficient,
    sampleSize: raw.sampleSize,
    significant: matrixQs[idx] < 0.05,
    qValue: matrixQs[idx],
    detrendedCoefficient: raw.detrendedCoefficient,
    trendDriven: raw.trendDriven,
    weekdayConfounded: raw.weekdayConfounded,
    maxR: raw.maxR,
    atCeiling: raw.atCeiling,
  }));
  return { cells, metrics };
}

/**
 * Average-linkage clustering order for the matrix: metrics that correlate
 * together become adjacent, so correlated blocks are visible at a glance.
 * Returns the same labels, reordered (idempotent for ≤2 metrics).
 */
export function clusterOrder(metrics: string[], matrix: CorrelationCell[]): string[] {
  if (metrics.length <= 2) return [...metrics];
  const r = (a: string, b: string): number => {
    const c = matrix.find((m) => (m.row === a && m.col === b) || (m.row === b && m.col === a));
    return c && c.coefficient !== null ? Math.abs(c.coefficient) : 0;
  };
  let clusters: string[][] = metrics.map((m) => [m]);
  const clusterR = (ca: string[], cb: string[]): number => {
    let s = 0;
    let n = 0;
    for (const a of ca) for (const b of cb) { s += r(a, b); n++; }
    return n > 0 ? s / n : 0;
  };
  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let best = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const v = clusterR(clusters[i], clusters[j]);
        if (v > best) { best = v; bestI = i; bestJ = j; }
      }
    }
    clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
    clusters.splice(bestJ, 1);
  }
  return clusters[0];
}