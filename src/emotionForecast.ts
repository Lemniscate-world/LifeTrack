// src/emotionForecast.ts
// Forecasting "jours restants" for emotional events.
//
// Model: hierarchical exponential decay of self-reported intensity.
//   I(t) = floor + (I0 - floor) * exp(-λ·t),  floor = 1 (scale minimum)
//
// Three layers (best possible for a small-data, local-first setting):
//  1. Literature priors — per-emotion decay rates (half-lives). Relative
//     ordering follows Verduyn et al. (2009, 2015) on emotion duration:
//     sadness/nostalgia persist longest; shame, guilt, disgust decay faster;
//     anxiety decays slowly because it tends to re-trigger.
  //     Honte (2.0j) = internal self-evaluation → brief if self-compassion present.
  //     Humiliation (3.5j) = external social-evaluative threat + injustice
  //       → longer than honte; Combs et al., Elison & Harter 2005; Kendler
  //       2003: interpersonal humiliation predicts prolonged rumination,
  //       buffered by social reconnection (hence slower decay when Solitude co-occurs).
  //     These are PRIORS, honestly labeled, replaced by personal data ASAP.
//  2. Personal posterior — λ fitted on THIS event (log-linear least squares)
//     blended with the prior by precision weighting; past resolved events of
//     the same emotion(s) sharpen the prior (empirical Bayes pooling).
//  3. Relapse detection — if recent points jump back up off the fitted curve,
//     we refit from the changepoint and flag it instead of averaging through
//     the break (averaging through a relapse is the classic way to lie).
//
// Output: days until predicted intensity ≤ threshold + interval + confidence.
// Everything is deterministic, dependency-free, and unit-tested.

export interface EmotionCheckPoint {
  date: string; // YYYY-MM-DD
  intensity: number; // 1-10
}

/** Literature half-life priors, in days. See module docstring for provenance. */
export const EMOTION_PRIOR_HALFLIFE_DAYS: Record<string, number> = {
  'Tristesse': 6.0,
  'Nostalgie': 5.0,
  'Solitude': 4.5,
  'Vide': 4.5,
  'Rancœur': 4.0,
  'Impuissance': 4.0,
  'Déception': 3.5,
  'Anxiété': 3.5,
  'Méfiance': 3.0,
  'Peur': 3.0,
  'Jalousie': 3.0,
  'Colère': 2.5,
  'Frustration': 2.5,
  'Culpabilité': 2.5,
  'Honte': 2.0,
  'Humiliation': 3.5,
  'Dégoût': 1.5,
};

export const DEFAULT_PRIOR_HALFLIFE_DAYS = 3.0;
export const INTENSITY_FLOOR = 1.0;
export const DEFAULT_THRESHOLD = 2.0;
/** Pseudo-observations anchoring the literature prior (small = learns fast). */
export const PRIOR_WEIGHT = 3;

export type ForecastConfidence = 'low' | 'medium' | 'high';
export type ForecastMethod = 'prior' | 'personal' | 'blended';

/**
 * Heuristic valence of the daily mood check (store MOODS ids).
 * Used as a covariate: bad-mood days slow the estimated decay.
 * Documented heuristic, not a clinical scale.
 */
export const MOOD_VALENCE: Record<string, number> = {
  amazing: 2,
  great: 1,
  calm: 0.5,
  okay: 0,
  tired: -1,
  sick: -1,
  bad: -1.5,
  angry: -2,
};

export interface MoodPoint {
  t: number;
  intensity: number;
  /** Centered mood valence (mean ~0). */
  mood: number;
}

export interface MoodFitResult extends FitResult {
  /** Coefficient of (centered) mood on log-intensity. Negative = bad mood slows decay. */
  moodCoef: number | null;
  moodAdjusted: boolean;
}

/**
 * Rumination tail for humiliation: the slow component's half-life in days.
 * Humiliation re-triggers through rumination (evening replays, imagined
 * comebacks), so a single exponential under-predicts the tail. 7 days is a
 * conservative prior — personal data shortens it as events resolve.
 */
export const RUMINATION_SLOW_HALFLIFE_DAYS = 7;
/** Weight of the fast (acute) component in the bi-exponential mix. */
export const RUMINATION_FAST_WEIGHT = 0.6;
/** Evening rumination micro-spikes: +0.5 pts at days 2 and 5, decaying. */
export const RUMINATION_SPIKE_DAYS = [2, 5];
export const RUMINATION_SPIKE_AMPLITUDE = 0.5;

/**
 * Bi-exponential value: fast acute decay + slow rumination tail.
 * I(t) = floor + amp · [w·exp(-λf·t) + (1-w)·exp(-λs·t)]
 */
export function biExpValue(
  t: number,
  amp: number,
  lambdaFast: number,
  lambdaSlow: number = Math.LN2 / RUMINATION_SLOW_HALFLIFE_DAYS,
  w: number = RUMINATION_FAST_WEIGHT,
): number {
  return INTENSITY_FLOOR + amp * (w * Math.exp(-lambdaFast * t) + (1 - w) * Math.exp(-lambdaSlow * t));
}

/** Days until the bi-exponential curve reaches the threshold (bisection). */
export function biExpCrossingDays(
  fittedLast: number,
  lambdaFast: number,
  threshold: number,
  lambdaSlow: number = Math.LN2 / RUMINATION_SLOW_HALFLIFE_DAYS,
  w: number = RUMINATION_FAST_WEIGHT,
): number | null {
  const amp = fittedLast - INTENSITY_FLOOR;
  if (amp <= 0) return 0;
  if (biExpValue(730, amp, lambdaFast, lambdaSlow, w) > threshold) return null;
  let lo = 0;
  let hi = 730;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (biExpValue(mid, amp, lambdaFast, lambdaSlow, w) <= threshold) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface EmotionForecast {
  /** Decay rate per day (posterior). */
  lambdaPerDay: number;
  /** Posterior half-life in days. */
  halfLifeDays: number;
  /** True when the bi-exponential rumination tail was applied (Humiliation). */
  rumination: boolean;
  /** Median estimate of days until intensity ≤ threshold. Null = no decay detected. */
  daysRemaining: number | null;
  /** Interval bounds (same unit). Null when not computable. */
  loDays: number | null;
  hiDays: number | null;
  confidence: ForecastConfidence;
  method: ForecastMethod;
  /** True when a recent relapse break was detected and the fit restarts there. */
  relapsed: boolean;
  /** Date (ISO) the fit effectively restarts from after a relapse. */
  fitStartDate: string;
  /** R² of the log-linear fit on the data actually used (null if n < 3). */
  rSquared: number | null;
  /** True when the day's mood was used as a covariate in the fit. */
  moodAdjusted: boolean;
  /** Mood coefficient (log-intensity per valence point), if fitted. */
  moodCoef: number | null;
  /** Effective sample size used in the fit. */
  n: number;
  /** Next-7-days projected intensities from the posterior curve (for chart overlay). Empty when no decay. */
  projection: { date: string; intensity: number }[];
}

const DAY_MS = 86_400_000;

function daysBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / DAY_MS;
}

export function priorLambdaFor(emotions: string[]): number {
  const halves = emotions
    .map((e) => EMOTION_PRIOR_HALFLIFE_DAYS[e] ?? DEFAULT_PRIOR_HALFLIFE_DAYS);
  // The slowest-decaying emotion dominates the joint experience.
  const slowest = halves.length ? Math.max(...halves) : DEFAULT_PRIOR_HALFLIFE_DAYS;
  return Math.LN2 / slowest;
}

interface FitResult {
  lambda: number;
  intercept: number;
  seLambda: number | null;
  rSquared: number | null;
  n: number;
  tLast: number;
  fittedLast: number;
}

/** Log-linear least squares on (intensity - floor). Returns λ ≥ 0 semantics via slope. */
export function fitDecay(points: { t: number; intensity: number }[]): FitResult {
  const n = points.length;
  const tLast = n ? points[n - 1].t : 0;
  if (n === 0) {
    return { lambda: 0, intercept: 0, seLambda: null, rSquared: null, n: 0, tLast, fittedLast: INTENSITY_FLOOR };
  }
  if (n === 1) {
    return { lambda: 0, intercept: Math.log(Math.max(points[0].intensity - INTENSITY_FLOOR, 1e-6)), seLambda: null, rSquared: null, n: 1, tLast, fittedLast: points[0].intensity };
  }
  const eps = 1e-6;
  const ys = points.map((p) => Math.log(Math.max(p.intensity - INTENSITY_FLOOR, eps)));
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (points[i].t - meanT) ** 2;
    sxy += (points[i].t - meanT) * (ys[i] - meanY);
  }
  let slope = sxx > 1e-9 ? sxy / sxx : 0;
  // Robustness: with ≥5 points, replace the OLS slope by the Theil-Sen
  // median slope — a single mislogged spike no longer bends the whole curve.
  if (n >= 5) {
    const slopes: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dt = points[j]!.t - points[i]!.t;
        if (dt > 1e-9) slopes.push((ys[j]! - ys[i]!) / dt);
      }
    }
    if (slopes.length > 0) {
      slopes.sort((a, b) => a - b);
      const mid = Math.floor(slopes.length / 2);
      slope = slopes.length % 2 ? slopes[mid]! : (slopes[mid - 1]! + slopes[mid]!) / 2;
    }
  }
  const lambda = -slope; // positive when decaying
  const intercept = meanY - slope * meanT;
  // Residuals → SE(λ), R²
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * points[i].t;
    sse += (ys[i] - pred) ** 2;
    sst += (ys[i] - meanY) ** 2;
  }
  const rSquared = sst > 1e-9 ? Math.max(0, 1 - sse / sst) : null;
  const seLambda = n > 2 && sxx > 1e-9 ? Math.sqrt((sse / (n - 2)) / sxx) : null;
  const fittedLast = INTENSITY_FLOOR + Math.exp(intercept + slope * tLast);
  return { lambda, intercept, seLambda, rSquared, n, tLast, fittedLast };
}

/**
 * Multiple regression y = a + b·t + c·m (mood covariate) via 3×3 normal
 * equations solved by Gauss-Jordan with partial pivot. Returns null SE and
 * R² when the system is singular or underdetermined (caller falls back).
 */
function solve3(A: number[][], b: number[]): { x: number[]; invDiag: number[] } | null {
  const n = 3;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-9) return null; // singular
    if (piv !== col) { const tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
    const div = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return { x: [M[0][n], M[1][n], M[2][n]], invDiag: [M[0][0], M[1][1], M[2][2]] };
}

/**
 * Mood-aware decay fit: y = a − λ·t + c·m on log(intensity − floor),
 * with m = centered mood valence. Falls back to null when unusable.
 */
export function fitDecayMood(points: MoodPoint[]): (MoodFitResult & { meanMood: number }) | null {
  const n = points.length;
  if (n < 5) return null;
  const eps = 1e-6;
  const ys = points.map((p) => Math.log(Math.max(p.intensity - INTENSITY_FLOOR, eps)));
  const meanMood = points.reduce((s, p) => s + p.mood, 0) / n;
  const ms = points.map((p) => p.mood - meanMood);
  // Need real spread in the mood regressor, else the system is near-singular.
  // (t-spread is guaranteed by distinct check-in dates in practice.)
  const varM = ms.reduce((s, m) => s + m * m, 0);
  if (varM < 1e-9) return null;
  // Normal equations for [a, b=slope on t, c=slope on m].
  let sTT = 0, sTM = 0, sMM = 0, sT = 0, sM = 0, sTy = 0, sMy = 0, sY = 0;
  for (let i = 0; i < n; i++) {
    const t = points[i].t, m = ms[i], y = ys[i];
    sTT += t * t; sTM += t * m; sMM += m * m;
    sT += t; sM += m; sTy += t * y; sMy += m * y; sY += y;
  }
  const solved = solve3([[n, sT, sM], [sT, sTT, sTM], [sM, sTM, sMM]], [sY, sTy, sMy]);
  if (!solved) return null;
  const [a, slopeT, slopeM] = solved.x;
  const lambda = -slopeT;
  let sse = 0, sst = 0;
  const meanY = sY / n;
  for (let i = 0; i < n; i++) {
    const pred = a + slopeT * points[i].t + slopeM * ms[i];
    sse += (ys[i] - pred) ** 2;
    sst += (ys[i] - meanY) ** 2;
  }
  const rSquared = sst > 1e-9 ? Math.max(0, 1 - sse / sst) : null;
  const seLambda = n > 3 ? Math.sqrt(Math.max(sse / (n - 3), 0) * Math.max(solved.invDiag[1], 0)) : null;
  const tLast = points[n - 1].t;
  // Project at mean mood (future mood unknown).
  const fittedLast = INTENSITY_FLOOR + Math.exp(a + slopeT * tLast);
  return { lambda, intercept: a, seLambda, rSquared, n, tLast, fittedLast, moodCoef: slopeM, moodAdjusted: true, meanMood };
}

/**
 * Relapse detection: scan the last 3 points for a sharp rebound (jump ≥ 2.5
 * pts) that breaks a previously declining segment. The segment BEFORE the
 * jump is fitted on its own, so the rebound itself cannot mask the decline.
 * Returns the index to refit from, or 0 (no break).
 */
export function detectRelapseIndex(points: { t: number; intensity: number }[]): number {
  if (points.length < 4) return 0;
  const start = Math.max(1, points.length - 3);
  for (let i = start; i < points.length; i++) {
    const jump = points[i].intensity - points[i - 1].intensity;
    if (jump < 2.5) continue;
    const segment = points.slice(0, i);
    if (segment.length < 3) continue;
    const segFit = fitDecay(segment);
    if (segFit.lambda > 0.05) return i;
  }
  return 0;
}

/** Fit λ on the user's OTHER events sharing at least one emotion (empirical prior). */
export function pooledPersonalLambda(
  emotions: string[],
  otherEvents: { emotions: string[]; checks: EmotionCheckPoint[] }[],
): { lambda: number; weight: number } | null {
  const lambdas: number[] = [];
  for (const ev of otherEvents) {
    if (!ev.emotions.some((e) => emotions.includes(e))) continue;
    if (ev.checks.length < 4) continue;
    const t0 = ev.checks[0].date;
    const fit = fitDecay(ev.checks.map((c) => ({ t: daysBetween(t0, c.date), intensity: c.intensity })));
    if (fit.lambda > 0 && fit.rSquared !== null && fit.rSquared >= 0.3) lambdas.push(fit.lambda);
  }
  if (!lambdas.length) return null;
  const mean = lambdas.reduce((s, l) => s + l, 0) / lambdas.length;
  return { lambda: mean, weight: Math.min(lambdas.length * 2, 6) };
}

export interface ForecastOptions {
  threshold?: number;
  todayIso?: string;
  /** Fitted λs from the user's past events of the same emotions (empirical prior). */
  personalHistory?: { emotions: string[]; checks: EmotionCheckPoint[] }[];
  /** Daily mood checks (store MOODS ids by ISO date) used as a decay covariate. */
  moods?: Record<string, string>;
}

function crossingDays(lambda: number, fittedLast: number, threshold: number): number | null {
  if (!(lambda > 0)) return null;
  const denom = Math.max(threshold - INTENSITY_FLOOR, 1e-6);
  const numer = Math.max(fittedLast - INTENSITY_FLOOR, 1e-6);
  if (numer <= denom) return 0;
  return Math.max(0, Math.log(numer / denom) / lambda);
}

export function forecastEmotion(
  checks: EmotionCheckPoint[],
  emotions: string[],
  opts: ForecastOptions = {},
): EmotionForecast {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const sorted = [...checks].sort((a, b) => a.date.localeCompare(b.date));
  let priorLambda = priorLambdaFor(emotions);
  // Social buffer: isolated humiliation (Humiliation + Solitude/Méfiance/Vide)
  // lingers ~18% longer than connected humiliation (Combs/Kendler).
  // We keep priors honest — personal data overwrites this quickly.
  if (
    emotions.includes('Humiliation') &&
    (emotions.includes('Solitude') || emotions.includes('Méfiance') || emotions.includes('Vide'))
  ) {
    priorLambda *= 0.85;
  }

  // Bi-exponential rumination tail: humiliation decays fast at first, then
  // lingers on replays. The mono-exponential systematically lies (short) here.
  const ruminating = emotions.includes('Humiliation');

  if (sorted.length < 2) {
    // Cold start: prior only.
    const halfLife = Math.LN2 / priorLambda;
    const daysRemaining = ruminating
      ? (biExpCrossingDays(sorted[0]?.intensity ?? 5, priorLambda, threshold) ?? Math.log(Math.max((sorted[0]?.intensity ?? 5) - INTENSITY_FLOOR, 1e-6) / Math.max(threshold - INTENSITY_FLOOR, 1e-6)) / priorLambda)
      : Math.max(0, Math.log(Math.max((sorted[0]?.intensity ?? 5) - INTENSITY_FLOOR, 1e-6) / Math.max(threshold - INTENSITY_FLOOR, 1e-6)) / priorLambda);
    return {
      lambdaPerDay: priorLambda,
      halfLifeDays: halfLife,
      rumination: ruminating,
      daysRemaining: Math.ceil(daysRemaining),
      loDays: Math.ceil(daysRemaining * 0.4),
      hiDays: Math.ceil(daysRemaining * 1.8),
      confidence: 'low',
      method: 'prior',
      relapsed: false,
      fitStartDate: sorted[0]?.date ?? opts.todayIso ?? '',
      rSquared: null,
      moodAdjusted: false,
      moodCoef: null,
      n: sorted.length,
      projection: [],
    };
  }

  const t0 = sorted[0].date;
  const fullPoints = sorted.map((c) => ({ t: daysBetween(t0, c.date), intensity: c.intensity }));
  const breakIdx = detectRelapseIndex(fullPoints);
  const relapsed = breakIdx > 0;
  let usedPoints = relapsed ? fullPoints.slice(breakIdx) : fullPoints;
  let usedDates = relapsed ? sorted.slice(breakIdx).map((c) => c.date) : sorted.map((c) => c.date);
  // Robustness: a gap > 10 days without checks means life happened in between
  // (travel, avoidance, forgotten) — fitting across the hole pretends the
  // decay was observed. Restart the fit segment after the last big hole.
  // NOTE: relapse detection runs first so a genuine rebound still wins.
  let gapSplit = false;
  for (let i = usedPoints.length - 1; i > 0; i--) {
    if (usedPoints[i]!.t - usedPoints[i - 1]!.t > 10) {
      usedPoints = usedPoints.slice(i);
      usedDates = usedDates.slice(i);
      gapSplit = true;
      break;
    }
  }
  const fit = fitDecay(usedPoints.map((p, i) => ({ t: i === 0 ? 0 : p.t - usedPoints[0]!.t, intensity: p.intensity })));

  // Mood-aware refinement: same-day mood as a covariate (needs ≥5 points
  // with a known mood and a non-singular system; otherwise keep plain fit).
  let moodAdjusted = false;
  let moodCoef: number | null = null;
  let fitLambda = fit.lambda;
  let fitSe = fit.seLambda;
  let fitR2 = fit.rSquared;
  let fitFittedLast = fit.fittedLast;
  if (opts.moods && usedPoints.length >= 5) {
    const moodPts: MoodPoint[] = [];
    for (let i = 0; i < usedPoints.length; i++) {
      const v = MOOD_VALENCE[opts.moods[usedDates[i]!] ?? ''];
      if (v === undefined) continue;
      moodPts.push({ t: usedPoints[i]!.t, intensity: usedPoints[i]!.intensity, mood: v });
    }
    if (moodPts.length >= 5) {
      const mf = fitDecayMood(moodPts);
      if (mf && mf.lambda > 0 && (mf.rSquared ?? 0) >= Math.max((fit.rSquared ?? 0) - 0.05, 0)) {
        // Adopt only if it doesn't degrade the plain fit materially.
        moodAdjusted = true;
        moodCoef = mf.moodCoef;
        fitLambda = mf.lambda;
        fitSe = mf.seLambda;
        fitR2 = mf.rSquared;
        fitFittedLast = mf.fittedLast;
      }
    }
  }

  // Empirical prior from the user's own history (same emotions, other events).
  const pooled = opts.personalHistory?.length
    ? pooledPersonalLambda(emotions, opts.personalHistory)
    : null;
  const priorW = PRIOR_WEIGHT;
  const empW = pooled?.weight ?? 0;
  const effectivePriorLambda = pooled
    ? (priorW * priorLambda + empW * pooled.lambda) / (priorW + empW)
    : priorLambda;
  const effectivePriorW = priorW + empW;

  // Posterior: precision-weight personal fit vs prior. Data weight ≈ n.
  const dataW = fit.n;
  let lambdaPost: number;
  let method: ForecastMethod;
  if (fitLambda > 0 && fit.n >= 3) {
    lambdaPost = (dataW * fitLambda + effectivePriorW * effectivePriorLambda) / (dataW + effectivePriorW);
    method = 'blended';
  } else if (fit.n >= 3) {
    // Personal fit says "no decay" — trust data direction but keep it bounded:
    // fall back to a slow prior rather than predicting infinity.
    lambdaPost = effectivePriorLambda * 0.5;
    method = 'blended';
  } else {
    lambdaPost = effectivePriorLambda;
    method = 'prior';
  }

  // Median estimate: bi-exponential when ruminating (tail-aware), else mono.
  let daysRemainingRaw = crossingDays(lambdaPost, fitFittedLast, threshold);
  if (ruminating) {
    daysRemainingRaw = biExpCrossingDays(fitFittedLast, lambdaPost, threshold);
  }
  let loDays: number | null = null;
  let hiDays: number | null = null;
  if (daysRemainingRaw !== null) {
    if (fitSe !== null && fit.n >= 4 && !relapsed && !gapSplit) {
      // Faster decay (λ+SE) → fewer days = lower bound; slower decay → upper bound.
      const fast = crossingDays(lambdaPost + 1.96 * fitSe, fitFittedLast, threshold);
      const slow = crossingDays(Math.max(lambdaPost - 1.96 * fitSe, 1e-6), fitFittedLast, threshold);
      loDays = fast !== null ? Math.floor(fast) : null;
      hiDays = slow !== null ? Math.ceil(slow) : null;
    } else {
      // Wide sensitivity band when the fit is thin, post-relapse, or restarted
      // after an observation gap.
      loDays = Math.floor(daysRemainingRaw * 0.4);
      hiDays = Math.ceil(daysRemainingRaw * 1.8);
    }
    // The rumination tail can only extend the estimate, never shorten the
    // upper bound below the median — keep the interval honest.
    if (ruminating && hiDays !== null) hiDays = Math.max(hiDays, Math.ceil(daysRemainingRaw));
  }

  const confidence: ForecastConfidence =
    relapsed || fit.n < 3 || daysRemainingRaw === null
      ? 'low'
      : fit.n >= 7 && (fit.rSquared ?? 0) >= 0.5
        ? 'high'
        : 'medium';

  // Cap absurd projections (near-zero λ on flat series): beyond a year the
  // number stops meaning anything — report the ceiling honestly.
  const MAX_DAYS = 365;
  // 7-day forward projection from the posterior curve, anchored on the last
  // fitted value. Powers the ghost bars on the chart. When ruminating, the
  // projection follows the slow tail and adds honest evening micro-spikes
  // (rumination replays ≈ days 2 and 5 — heuristic, labeled as such in UI).
  const projection: { date: string; intensity: number }[] = [];
  if (lambdaPost > 0 && usedDates.length > 0) {
    const lastT = fit.tLast;
    const lastDate = usedDates[usedDates.length - 1]!;
    const amp = Math.max(fitFittedLast - INTENSITY_FLOOR, 1e-6);
    const lambdaSlow = Math.LN2 / RUMINATION_SLOW_HALFLIFE_DAYS;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(lastDate + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      let v: number;
      if (ruminating) {
        v = biExpValue(i, amp, lambdaPost, lambdaSlow);
        if (RUMINATION_SPIKE_DAYS.includes(i)) {
          v += RUMINATION_SPIKE_AMPLITUDE * Math.exp(-i / RUMINATION_SLOW_HALFLIFE_DAYS);
        }
      } else {
        v = INTENSITY_FLOOR + amp * Math.exp(-lambdaPost * (lastT + i - lastT));
      }
      projection.push({ date: iso, intensity: Math.max(INTENSITY_FLOOR, Math.min(10, Math.round(v * 10) / 10)) });
    }
  }
  return {
    lambdaPerDay: lambdaPost,
    halfLifeDays: Math.LN2 / Math.max(lambdaPost, 1e-9),
    rumination: ruminating,
    daysRemaining: daysRemainingRaw === null ? null : Math.min(MAX_DAYS, Math.ceil(daysRemainingRaw)),
    loDays: loDays === null ? null : Math.min(MAX_DAYS, loDays),
    hiDays: hiDays === null ? null : Math.min(MAX_DAYS, hiDays),
    confidence,
    method,
    relapsed,
    fitStartDate: usedDates[0] ?? t0,
    rSquared: fitR2,
    moodAdjusted,
    moodCoef,
    n: fit.n,
    projection,
  };
}

/**
 * Consecutive days with a check, ending today (or yesterday if today is not
 * checked yet — the streak is still alive). Drives the "régularité" display.
 */
export function checkStreak(checks: { date: string }[], todayIso: string): number {
  const dates = new Set(checks.map((c) => c.date));
  let streak = 0;
  const cursor = new Date(todayIso + 'T00:00:00Z');
  // Allow today to be unchecked (day not over yet).
  if (!dates.has(todayIso)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (true) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!dates.has(iso)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (streak > 3650) break; // sanity cap
  }
  return streak;
}

/** Per-emotion decay fit for one event (uses per-emotion intensities when present). */
export interface PerEmotionFit {
  emotion: string;
  n: number;
  halfLifeDays: number | null;
  daysRemaining: number | null;
  rSquared: number | null;
}

export function fitPerEmotion(
  checks: { date: string; intensity: number; intensities?: Record<string, number> }[],
  emotions: string[],
  threshold: number = DEFAULT_THRESHOLD,
): PerEmotionFit[] {
  return emotions.map((emotion) => {
    const series: { t: number; intensity: number }[] = [];
    const sorted = [...checks].sort((a, b) => a.date.localeCompare(b.date));
    const t0 = sorted.length ? sorted[0]!.date : '';
    for (const c of sorted) {
      const v = c.intensities?.[emotion];
      if (typeof v === 'number' && Number.isFinite(v)) {
        series.push({ t: daysBetween(t0, c.date), intensity: v });
      }
    }
    if (series.length < 3) return { emotion, n: series.length, halfLifeDays: null, daysRemaining: null, rSquared: null };
    const fit = fitDecay(series);
    if (!(fit.lambda > 0)) return { emotion, n: series.length, halfLifeDays: null, daysRemaining: null, rSquared: fit.rSquared };
    const remaining = crossingDays(fit.lambda, fit.fittedLast, threshold);
    return {
      emotion,
      n: series.length,
      halfLifeDays: Math.LN2 / fit.lambda,
      daysRemaining: remaining === null ? null : Math.min(365, Math.ceil(remaining)),
      rSquared: fit.rSquared,
    };
  });
}

export interface EmotionSeriesPoint {
  date: string;
  /** Per-emotion intensity, or null when that day has no per-emotion value. */
  value: number | null;
}

/**
 * Per-emotion trajectory for one event: one point per check day, value taken
 * from the check's per-emotion intensities. Days without a per-emotion value
 * stay null (honest gap — never silently substituted with the global score).
 */
export function perEmotionSeries(
  checks: { date: string; intensities?: Record<string, number> }[],
  emotion: string,
): EmotionSeriesPoint[] {
  return [...checks]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => {
      const v = c.intensities?.[emotion];
      return {
        date: c.date,
        value: typeof v === 'number' && Number.isFinite(v) ? Math.min(10, Math.max(1, Math.round(v))) : null,
      };
    });
}

export interface TemporalPattern {
  /** Day-of-week (0=Sun..6=Sat) with most high-intensity (≥7) checks. */
  peakDow: number | null;
  peakDowCount: number;
  /** Hour-of-day bucket (0-23) with most checks, from createdAt timestamps. */
  peakHour: number | null;
  peakHourCount: number;
  totalChecks: number;
}

/**
 * When do spikes land? Day-of-week concentration of high-intensity checks
 * plus hour-of-day concentration from check timestamps (when available).
 * Purely descriptive — needs ≥3 checks to say anything.
 */
export function temporalPatterns(
  checks: { date: string; intensity: number; createdAt?: string }[],
): TemporalPattern {
  const byDow = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  let highTotal = 0;
  for (const c of checks) {
    if (c.intensity >= 7) {
      const dow = new Date(c.date + 'T00:00:00Z').getUTCDay();
      if (Number.isFinite(dow)) { byDow[dow]!++; highTotal++; }
    }
    if (c.createdAt) {
      const h = new Date(c.createdAt).getHours();
      if (Number.isFinite(h) && h >= 0 && h < 24) byHour[h]++;
    }
  }
  let peakDow: number | null = null;
  let peakDowCount = 0;
  if (highTotal >= 3) {
    for (let d = 0; d < 7; d++) {
      if (byDow[d]! > peakDowCount) { peakDowCount = byDow[d]!; peakDow = d; }
    }
    if (peakDowCount < 2) { peakDow = null; peakDowCount = 0; }
  }
  let peakHour: number | null = null;
  let peakHourCount = 0;
  const hourTotal = byHour.reduce((a, b) => a + b, 0);
  if (hourTotal >= 3) {
    for (let h = 0; h < 24; h++) {
      if (byHour[h]! > peakHourCount) { peakHourCount = byHour[h]!; peakHour = h; }
    }
    if (peakHourCount < 2) { peakHour = null; peakHourCount = 0; }
  }
  return { peakDow, peakDowCount, peakHour, peakHourCount, totalChecks: checks.length };
}

export interface ParsedActionPlan {
  title: string;
  steps: string[];
}

/**
 * Strict parser for AI-generated action plans. Accepts `{title, steps[]}`,
 * trims, caps (title 80 chars, 6 steps max, 140 chars each), rejects
 * anything malformed → null (caller falls back gracefully, never stores junk).
 */
export function parseActionPlan(raw: string): ParsedActionPlan | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      value = JSON.parse(fenced ? fenced[1] : raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 80) : '';
  const steps = Array.isArray(obj.steps)
    ? obj.steps
      .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 140))
      .slice(0, 6)
    : [];
  if (!title || steps.length === 0) return null;
  return { title, steps };
}

/** Build a plain-text therapist report (markdown) for one event. */
export function buildTherapistReport(
  event: { title: string; situation: string; emotions: string[]; createdAt: string; notes?: string; closureNote?: string },
  checks: { date: string; intensity: number; note?: string; noteEmotions?: string[] }[],
  forecast: { daysRemaining: number | null; loDays: number | null; hiDays: number | null; halfLifeDays: number; confidence: string; method: string; relapsed: boolean } | null,
  helpful: HelpfulNote[],
  perEmotion: PerEmotionFit[],
): string {
  const lines: string[] = [];
  lines.push(`# Suivi émotionnel — ${event.title}`);
  lines.push('');
  lines.push(`Situation : ${event.situation || '—'}`);
  lines.push(`Émotions associées : ${event.emotions.join(', ') || '—'}`);
  lines.push(`Depuis le : ${event.createdAt.slice(0, 10)}`);
  if (event.notes) lines.push(`Actions notées : ${event.notes}`);
  if (event.closureNote) lines.push(`Sens à la clôture : « ${event.closureNote} »`);
  lines.push('');
  lines.push(`## Relevés (${checks.length})`);
  const sorted = [...checks].sort((a, b) => a.date.localeCompare(b.date));
  for (const c of sorted) {
    const tags = (c.noteEmotions ?? []).length > 0 ? ` [→ ${(c.noteEmotions ?? []).join(', ')}]` : '';
    lines.push(`- ${c.date} : ${c.intensity}/10${c.note ? ` — ${c.note}` : ''}${tags}`);
  }
  lines.push('');
  const taggedByEmotion = new Map<string, { date: string; note: string }[]>();
  for (const c of sorted) {
    if (!c.note) continue;
    for (const t of c.noteEmotions ?? []) {
      const list = taggedByEmotion.get(t) ?? [];
      list.push({ date: c.date, note: c.note });
      taggedByEmotion.set(t, list);
    }
  }
  if (taggedByEmotion.size > 0) {
    lines.push(`## Notes par émotion`);
    for (const emo of event.emotions) {
      const list = taggedByEmotion.get(emo);
      if (!list || list.length === 0) continue;
      lines.push(`### ${emo}`);
      for (const n of list) lines.push(`- ${n.date} : « ${n.note} »`);
    }
    lines.push('');
  }
  if (forecast && forecast.daysRemaining !== null) {
    lines.push(`## Estimation`);
    lines.push(`Intensité ≤ 2/10 estimée dans ≈${forecast.daysRemaining} j` +
      (forecast.loDays !== null && forecast.hiDays !== null ? ` (fourchette ${forecast.loDays}–${forecast.hiDays} j)` : '') +
      ` — confiance ${forecast.confidence}, demi-vie ≈${forecast.halfLifeDays < 10 ? forecast.halfLifeDays.toFixed(1) : Math.round(forecast.halfLifeDays)} j` +
      (forecast.relapsed ? ` — rebond récent détecté, estimation repartie après la cassure` : '') + `.`);
    lines.push('');
  }
  const fitted = perEmotion.filter((p) => p.halfLifeDays !== null);
  if (fitted.length > 0) {
    lines.push(`## Par émotion`);
    for (const p of fitted) {
      lines.push(`- ${p.emotion} : demi-vie ≈${p.halfLifeDays! < 10 ? p.halfLifeDays!.toFixed(1) : Math.round(p.halfLifeDays!)} j` +
        (p.daysRemaining !== null ? `, ≈${p.daysRemaining} j restants` : '') + ` (n=${p.n})`);
    }
    lines.push('');
  }
  if (helpful.length > 0) {
    lines.push(`## Pistes ayant précédé une baisse (corrélation, pas preuve)`);
    for (const h of helpful) {
      const tags = h.copingTags.length > 0 ? ` [${h.copingTags.join(', ')}]` : '';
      lines.push(`- ${h.date} : « ${h.note} » (−${h.drop} pts le relevé suivant)${tags}`);
    }
    lines.push('');
  }
  const coping = suggestCoping(event.emotions);
  if (coping.length > 0) {
    lines.push(`## Pistes de coping adaptées`);
    for (const c of coping) {
      lines.push(`- ${c.emotion} → ${c.track} : ${c.detail} _(${c.source})_`);
    }
    lines.push('');
  }
  lines.push(`_Généré par LifeTrack — suivi d'auto-observation, pas un diagnostic._`);
  return lines.join('\n');
}

export interface CopingSuggestion {
  /** Emotion this track answers to ('Honte' | 'Humiliation' | ...). */
  emotion: string;
  /** Short track label, reused as tag on helpful notes. */
  track: string;
  /** One actionable sentence. */
  detail: string;
  /** Literature pointer (short). */
  source: string;
}

/**
 * Differentiated coping library. Shame and humiliation look alike but heal
 * differently — this is the core clinical distinction (Elison & Harter 2005):
 * - Honte = INTERNAL self-evaluation → auto-compassion + réévaluation interne.
 * - Humiliation = EXTERNAL social-evaluative threat + injustice → recadrer
 *   l'injustice, poser des limites, se reconnecter (chosen, not imposed).
 */
const COPING_LIBRARY: Record<string, Omit<CopingSuggestion, 'emotion'>[]> = {
  'Honte': [
    {
      track: 'Auto-compassion',
      detail: 'Parle-toi comme à un ami qui aurait fait la même erreur : bienveillance, humanité commune (« ça arrive à tout le monde »), pleine conscience sans dramatiser.',
      source: 'Neff 2003 — self-compassion vs auto-critique',
    },
    {
      track: 'Réévaluation interne',
      detail: 'Sépare l\u2019acte de l\u2019identité : « j\u2019ai raté X » n\u2019est pas « je suis nul ». Réécris la phrase honteuse en phrase factuelle.',
      source: 'Gross 2002 — réévaluation cognitive',
    },
  ],
  'Humiliation': [
    {
      track: 'Recadrage injustice',
      detail: 'Nomme l\u2019injustice comme un fait extérieur (« on m\u2019a manqué de respect »), pas comme une valeur de toi. Le problème est le comportement de l\u2019autre, pas ta valeur.',
      source: 'Elison & Harter 2005 — externalité de l\u2019humiliation',
    },
    {
      track: 'Pose de limites',
      detail: 'Prépare UNE phrase-limite pour la prochaine fois (« ça ne me convient pas »). L\u2019humiliation prospère sur l\u2019impuissance ; une limite préparée rend du pouvoir.',
      source: 'Alberti & Emmons — assertivité',
    },
    {
      track: 'Reconnexion choisie',
      detail: 'Recontacte UNE personne sûre sous 48 h. L\u2019humiliation guérit en lien, pas en isolement — mais c\u2019est toi qui choisis qui.',
      source: 'Hartling & Luchetta ; buffer social Combs/Kendler',
    },
  ],
};

/** Coping tracks for the given emotions (deduped, order-stable). */
export function suggestCoping(emotions: string[]): CopingSuggestion[] {
  const out: CopingSuggestion[] = [];
  const seen = new Set<string>();
  for (const e of emotions) {
    for (const c of COPING_LIBRARY[e] ?? []) {
      const key = `${e}::${c.track}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ emotion: e, ...c });
    }
  }
  return out;
}

// Keyword stems (accent-insensitive) mapping free-text notes to coping tracks.
const COPING_TAG_STEMS: Record<string, string[]> = {
  'Auto-compassion': ['compassion', 'bienveill', 'pardon', 'douceur', 'indulgen', 'ami envers moi'],
  'Réévaluation interne': ['recadr', 'relativis', 'perspective', 'pas si grave', 'réévalu', 'reevalu', 'factuel'],
  'Recadrage injustice': ['injust', 'respect', 'mérit', 'merit', 'droit', 'pas de ma faute'],
  'Pose de limites': ['limite', 'frontière', 'frontiere', 'distance', 'bloqu', 'dire non', 'confronter', 'quitté la'],
  'Reconnexion choisie': ['appelé', 'appeler', 'parlé à', 'parle à', 'sorti avec', 'voir un ami', 'soutien', 'proche', 'confiance à'],
};

/** Tag a free-text note with the coping tracks it seems to describe. */
export function tagCoping(note: string): string[] {
  const norm = ` ${normalizeFr(note)} `;
  const tags: string[] = [];
  for (const [track, stems] of Object.entries(COPING_TAG_STEMS)) {
    if (stems.some((s) => norm.includes(normalizeFr(s)))) tags.push(track);
  }
  return tags;
}

export interface HelpfulNote {
  date: string;
  note: string;
  /** Drop in intensity observed at the NEXT check after this note. */
  drop: number;
  /** Coping tracks this note seems to describe (keyword match, may be empty). */
  copingTags: string[];
}

/**
 * "Ce qui a marché" — notes written on days that were followed by a drop of
 * ≥ 2 intensity points at the next check. Correlation, not proof: surfaced
 * as candidates the user can deliberately re-apply, sorted by drop size.
 * Each note carries copingTags so the user sees WHICH track it belongs to
 * (auto-compassion vs limites vs reconnexion…).
 */
export function findHelpfulNotes(
  checks: { date: string; intensity: number; note?: string }[],
): HelpfulNote[] {
  const sorted = [...checks].sort((a, b) => a.date.localeCompare(b.date));
  const out: HelpfulNote[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const note = (sorted[i].note ?? '').trim();
    if (!note) continue;
    const drop = sorted[i].intensity - sorted[i + 1].intensity;
    if (drop >= 2) out.push({ date: sorted[i].date, note, drop, copingTags: tagCoping(note) });
  }
  out.sort((a, b) => b.drop - a.drop);
  return out.slice(0, 5);
}

export interface LearnedHalfLife {
  emotion: string;
  /** Median posterior half-life in days across the user's resolved events. */
  halfLifeDays: number;
  /** Number of past events this is learned from. */
  events: number;
}

export interface MemoryEpisode {
  id: string;
  title: string;
  emotions: string[];
  createdAt: string;
  archived?: boolean;
  notes?: string;
  checks: { date: string; intensity: number; note?: string }[];
}

/**
 * Compact "mémoire des émotions" for AI prompts: past episodes (peak,
 * span, status), learned half-lives, and what previously helped.
 * Capped so prompts stay small. Empty string when nothing to remember.
 */
export function buildEmotionalMemory(episodes: MemoryEpisode[], excludeId?: string): string {
  const past = episodes.filter((e) => e.id !== excludeId && e.checks.length > 0).slice(-6);
  if (past.length === 0) return '';
  const lines: string[] = ['MÉMOIRE ÉMOTIONNELLE (épisodes passés de l\u2019utilisateur) :'];
  for (const e of past) {
    const sorted = [...e.checks].sort((a, b) => a.date.localeCompare(b.date));
    const peak = sorted.reduce((m, c) => Math.max(m, c.intensity), 0);
    const last = sorted[sorted.length - 1]!;
    const status = e.archived ? 'résolu/archivé' : last.intensity <= 2 ? 'quasi éteint' : 'encore actif';
    lines.push(`- « ${e.title} » (${e.emotions.join(', ')}) : pic ${peak}/10, ${sorted.length} j suivis, ${status}.`);
  }
  try {
    const hls = learnedHalfLives(past.map((e) => ({ emotions: e.emotions, checks: e.checks.map((c) => ({ date: c.date, intensity: c.intensity })) })));
    if (hls.length > 0) {
      lines.push(`Demi-vies apprises : ${hls.map((h) => `${h.emotion} ≈${h.halfLifeDays < 10 ? h.halfLifeDays.toFixed(1) : Math.round(h.halfLifeDays)} j`).join(', ')}.`);
    }
    const helped: string[] = [];
    for (const e of past) {
      for (const h of findHelpfulNotes(e.checks)) {
        if (helped.length < 3) helped.push(`« ${h.note} » (−${h.drop} pts)`);
      }
    }
    if (helped.length > 0) lines.push(`Ce qui avait aidé : ${helped.join(' ; ')}.`);
  } catch { /* memory stays partial rather than failing */ }
  return lines.join('\n');
}

/** Local keyword fallback → emotions (offline, no AI). Normalized FR stems. */
const EMOTION_KEYWORDS: Record<string, string[]> = {
  'Colère': ['coler', 'colèr', 'énerv', 'enerv', 'rage', 'furieux', 'irrit'],
  'Tristesse': ['trist', 'pleur', 'larme', 'chagrin', 'peine', 'morose'],
  'Peur': ['peur', 'angoiss', 'anxie', 'crain', 'phobie', 'paniqu'],
  'Honte': ['honte', 'ridicul', 'gên', 'gen'],
  'Humiliation': ['humili', 'humiliation', 'humilie'],
  'Culpabilité': ['culpab', 'coupable', 'faute', 'remord', 'regret'],
  'Anxiété': ['anxi', 'stress', 'tendu', 'tension', 'inquiet', 'souci'],
  'Dégoût': ['dégout', 'degout', 'dégoût', 'répugn', 'repugn', 'écoeur', 'ecoeur'],
  'Jalousie': ['jalou', 'envie', 'envieux'],
  'Solitude': ['seul', 'solitude', 'isol', 'abandonn', 'rejet'],
  'Impuissance': ['impuiss', 'impuissant', 'contrôle', 'controle', 'démuni', 'demuni'],
  'Déception': ['décev', 'decev', 'déçu', 'decu', 'désillus', 'desillus'],
  'Frustration': ['frustr', 'bloqu', 'énerv', 'ras-le-bol', 'marre'],
  'Nostalgie': ['nostalg', 'manque', 'souvenir', 'autrefois'],
  'Rancœur': ['rancoeur', 'rancœur', 'rancune', 'ressentiment', 'amertume'],
  'Méfiance': ['méfi', 'mefi', 'suspic', 'dout'],
  'Vide': ['vide', 'néant', 'neant', 'sens', 'absurde'],
};

function normalizeFr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Offline emotion guess from free text (max 4, ordered by hits). */
export function detectEmotionsFromText(text: string): string[] {
  const norm = ` ${normalizeFr(text)} `;
  const scored: { emotion: string; hits: number }[] = [];
  for (const [emotion, stems] of Object.entries(EMOTION_KEYWORDS)) {
    let hits = 0;
    for (const stem of stems) {
      if (norm.includes(normalizeFr(stem))) hits++;
    }
    if (hits > 0) scored.push({ emotion, hits });
  }
  scored.sort((a, b) => b.hits - a.hits || a.emotion.localeCompare(b.emotion));
  return scored.slice(0, 4).map((s) => s.emotion);
}

export interface CapacityTrend {
  emotion: string;
  /** 'growing' = half-lives shrink over time (you process faster). */
  direction: 'growing' | 'stable' | 'declining' | 'unknown';
  /** Percent change first → last half-life (negative = faster now). */
  changePct: number | null;
  events: number;
}

/**
 * Processing capacity per emotion: do YOUR half-lives shrink across
 * successive events? First vs last fitted event (median when 3+).
 * This is the "capacity growth" metric — recovery speed as a skill.
 */
export function capacityTrendByEmotion(
  events: { emotions: string[]; checks: EmotionCheckPoint[] }[],
): CapacityTrend[] {
  const perEmotion = new Map<string, { date: string; halfLife: number }[]>();
  for (const ev of events) {
    if (ev.checks.length < 4) continue;
    const sorted = [...ev.checks].sort((a, b) => a.date.localeCompare(b.date));
    const t0 = sorted[0]!.date;
    const fit = fitDecay(sorted.map((c) => ({ t: daysBetween(t0, c.date), intensity: c.intensity })));
    if (!(fit.lambda > 0) || fit.rSquared === null || fit.rSquared < 0.3) continue;
    const hl = Math.LN2 / fit.lambda;
    if (!Number.isFinite(hl) || hl <= 0 || hl > 365) continue;
    for (const emo of ev.emotions) {
      const arr = perEmotion.get(emo) ?? [];
      arr.push({ date: sorted[0]!.date, halfLife: hl });
      perEmotion.set(emo, arr);
    }
  }
  const out: CapacityTrend[] = [];
  for (const [emotion, arr] of perEmotion) {
    if (arr.length < 2) {
      out.push({ emotion, direction: 'unknown', changePct: null, events: arr.length });
      continue;
    }
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const first = arr[0]!.halfLife;
    const last = arr[arr.length - 1]!.halfLife;
    const changePct = first > 0 ? Math.round(((last - first) / first) * 100) : null;
    const direction =
      changePct === null ? 'unknown' : changePct <= -15 ? 'growing' : changePct >= 15 ? 'declining' : 'stable';
    out.push({ emotion, direction, changePct, events: arr.length });
  }
  out.sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0));
  return out;
}

export interface EventComparison {
  sharedEmotions: string[];
  currentPeak: number;
  pastPeak: number;
  currentDays: number;
  pastDays: number;
  currentHalfLife: number | null;
  pastHalfLife: number | null;
  /** Days for the fitted curve to reach the threshold (null = no decay). */
  currentDaysToCalm: number | null;
  pastDaysToCalm: number | null;
  /**>0 means the current event is resolving faster (in half-life terms). */
  halfLifeDeltaPct: number | null;
  verdict: 'faster' | 'slower' | 'similar' | 'unknown';
}

/**
 * Compare the current event against one past event of the same type
 * (≥1 shared emotion). Purely descriptive + fitted-curve based: peak,
 * span, half-life and projected days-to-calm side by side.
 */
export function compareEmotionalEvents(
  current: { emotions: string[]; checks: EmotionCheckPoint[] },
  past: { emotions: string[]; checks: EmotionCheckPoint[] },
  threshold: number = DEFAULT_THRESHOLD,
): EventComparison | null {
  const shared = current.emotions.filter((e) => past.emotions.includes(e));
  if (!shared.length) return null;
  const peakOf = (cs: EmotionCheckPoint[]) => cs.reduce((m, c) => Math.max(m, c.intensity), 0);
  const fitOf = (cs: EmotionCheckPoint[]) => {
    if (cs.length < 2) return null;
    const sorted = [...cs].sort((a, b) => a.date.localeCompare(b.date));
    const t0 = sorted[0]!.date;
    return fitDecay(sorted.map((c) => ({ t: daysBetween(t0, c.date), intensity: c.intensity })));
  };
  const fitC = fitOf(current.checks);
  const fitP = fitOf(past.checks);
  const hlC = fitC && fitC.lambda > 0 ? Math.LN2 / fitC.lambda : null;
  const hlP = fitP && fitP.lambda > 0 ? Math.LN2 / fitP.lambda : null;
  const calmC = fitC && fitC.lambda > 0 ? crossingDays(fitC.lambda, fitC.fittedLast, threshold) : null;
  const calmP = fitP && fitP.lambda > 0 ? crossingDays(fitP.lambda, fitP.fittedLast, threshold) : null;
  let verdict: EventComparison['verdict'] = 'unknown';
  let halfLifeDeltaPct: number | null = null;
  if (hlC !== null && hlP !== null && hlP > 0) {
    halfLifeDeltaPct = Math.round(((hlP - hlC) / hlP) * 100);
    verdict = halfLifeDeltaPct >= 15 ? 'faster' : halfLifeDeltaPct <= -15 ? 'slower' : 'similar';
  }
  return {
    sharedEmotions: shared,
    currentPeak: peakOf(current.checks),
    pastPeak: peakOf(past.checks),
    currentDays: current.checks.length,
    pastDays: past.checks.length,
    currentHalfLife: hlC,
    pastHalfLife: hlP,
    currentDaysToCalm: calmC === null ? null : Math.ceil(calmC),
    pastDaysToCalm: calmP === null ? null : Math.ceil(calmP),
    halfLifeDeltaPct,
    verdict,
  };
}

/**
 * Per-emotion half-lives learned from the user's own past events (needs ≥4
 * checks and a positive, minimally-explaining fit per event). Median across
 * events for robustness. Empty when nothing is learnable yet.
 */
export function learnedHalfLives(
  events: { emotions: string[]; checks: EmotionCheckPoint[] }[],
): LearnedHalfLife[] {
  const byEmotion = new Map<string, number[]>();
  for (const ev of events) {
    if (ev.checks.length < 4) continue;
    const sorted = [...ev.checks].sort((a, b) => a.date.localeCompare(b.date));
    const t0 = sorted[0].date;
    const fit = fitDecay(sorted.map((c) => ({ t: daysBetween(t0, c.date), intensity: c.intensity })));
    if (!(fit.lambda > 0) || fit.rSquared === null || fit.rSquared < 0.3) continue;
    const hl = Math.LN2 / fit.lambda;
    if (!Number.isFinite(hl) || hl <= 0 || hl > 365) continue;
    for (const emo of ev.emotions) {
      const arr = byEmotion.get(emo) ?? [];
      arr.push(hl);
      byEmotion.set(emo, arr);
    }
  }
  const out: LearnedHalfLife[] = [];
  for (const [emotion, hls] of byEmotion) {
    hls.sort((a, b) => a - b);
    const mid = Math.floor(hls.length / 2);
    const median = hls.length % 2 ? hls[mid]! : (hls[mid - 1]! + hls[mid]!) / 2;
    out.push({ emotion, halfLifeDays: median, events: hls.length });
  }
  out.sort((a, b) => b.halfLifeDays - a.halfLifeDays);
  return out;
}
