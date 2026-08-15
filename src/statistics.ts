// src/statistics.ts
// Rigorous statistical inference helpers used by the analysis engine.
// Everything is pure (input -> output) and dependency-free so it can be unit
// tested against known published values.
//
// Conventions:
//   - correlation pairs are (x_i, y_i) with NO missing values (the caller is
//     responsible for pairwise deletion — see correlations.ts).
//   - two-tailed tests by default.
//   - alpha = 0.05, power = 0.80 unless stated otherwise.

// --- Gamma / incomplete beta (used for the t-distribution CDF) ---

// Lanczos approximation of ln(Gamma(x)), x > 0. Good to ~13 digits.
export function logGamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  x -= 1;
  let a = C[0];
  const t = x + g + 0.5;
  for (let i = 1; i <= C.length - 1; i++) a += C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the incomplete beta function (Numerical Recipes).
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = ((-(a + m)) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). Returns 0..1. */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnG = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnG);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betacf(a, b, x)) / a;
  }
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Two-tailed p-value for a Student's t statistic with `df` degrees of freedom. */
export function tTwoTail(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  return ibeta(x, df / 2, 0.5);
}

/** Inverse standard-normal CDF (quantile q in (0,1)) — Acklam's approximation. */
export function invNormCdf(q: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let x: number;
  if (q < pLow) {
    const z = Math.sqrt(-2 * Math.log(q));
    x = (((((c[0] * z + c[1]) * z + c[2]) * z + c[3]) * z + c[4]) * z + c[5]) /
        ((((d[0] * z + d[1]) * z + d[2]) * z + d[3]) * z + 1);
  } else if (q <= pHigh) {
    const z = q - 0.5;
    const r = z * z;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * z /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const z = Math.sqrt(-2 * Math.log(1 - q));
    x = -(((((c[0] * z + c[1]) * z + c[2]) * z + c[3]) * z + c[4]) * z + c[5]) /
        ((((d[0] * z + d[1]) * z + d[2]) * z + d[3]) * z + 1);
  }
  return x;
}

/** Two-tailed z at alpha, e.g. zTwoTail(0.05) ≈ 1.96. */
export function zTwoTail(alpha: number): number {
  return invNormCdf(1 - alpha / 2);
}

// --- Correlation building blocks ---------------------------------------

/**
 * Pearson correlation with a two-tailed p-value and a Fisher
 * z-transform confidence interval at `alpha`.
 */
export function pearsonTest(
  xs: number[],
  ys: number[],
  alpha = 0.05,
): { r: number; p: number; ci: [number, number] } | null {
  const n = xs.length;
  if (n < 3 || xs.length !== ys.length) return null;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null; // no variance in a series
  const r = num / Math.sqrt(sxx * syy);
  const clamped = Math.max(-1, Math.min(1, r));
  if (Math.abs(clamped) === 1) {
    // Perfect (anti)correlation: t is infinite → p is exactly 0, CI degenerates.
    return { r: clamped, p: 0, ci: [clamped, clamped] as [number, number] };
  }
  const df = Math.max(1, n - 2);
  const t = (clamped * Math.sqrt(df)) / Math.sqrt(1 - clamped * clamped);
  const p = tTwoTail(t, df);

  const z = Math.atanh(clamped);
  const se = 1 / Math.sqrt(n - 3);
  const zAlpha = zTwoTail(alpha);
  const ci: [number, number] = [Math.tanh(z - zAlpha * se), Math.tanh(z + zAlpha * se)];

  return { r, p, ci };
}

/** Average ranks with ties given the mean of the tied ranks. */
export function arrayRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation (for ordinal data like mood) with p-value and CI.
 * Computed as Pearson on the ranks.
 */
export function spearmanTest(
  xs: number[],
  ys: number[],
  alpha = 0.05,
): { rho: number; p: number; ci: [number, number] } | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const res = pearsonTest(arrayRanks(xs), arrayRanks(ys), alpha);
  return res ? { rho: res.r, p: res.p, ci: res.ci } : null;
}

// --- Multiple-comparison corrections -----------------------------------

/**
 * Benjamini–Hochberg FDR correction. Returns an array of q-values in the same
 * order as the input p-values (possibly filtered before reporting).
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length;
  if (n === 0) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(n);
  let prev = 1;
  for (let rank = n - 1; rank >= 0; rank--) {
    const idx = order[rank].i;
    const p = order[rank].p;
    const qVal = (p * n) / (rank + 1);
    q[idx] = Math.min(1, Math.min(qVal, prev));
    prev = q[idx];
  }
  return q;
}

/** Min paired n to detect correlation `r` at alpha with given power. Fisher z. */
export function requiredSampleSize(r: number, alpha = 0.05, power = 0.8): number {
  const abs = Math.abs(r);
  if (abs < 1e-6) return Infinity;
  const zDetect = Math.atanh(Math.min(0.999999, abs));
  const zAlpha = zTwoTail(alpha);
  const zPower = invNormCdf(power);
  const n = Math.pow((zAlpha + zPower) / zDetect, 2) + 4;
  return Math.ceil(n);
}

// --- Correlation robustness (anti-misleading) ------------------------------
// Adds "close to reality" diagnostics to any correlation:
//   - a winsorized (tail-trimmed) coefficient so a single outlier can't fake an effect,
//   - a jackknife sign-stability score (does the direction survive dropping each day?),
//   - an outlier-driven flag when the effect is fragile,
//   - an autocorrelation warning for time-series (inflated p-values / spurious trends).

/** Winsorize an array: clamp the `trim`-fraction of extreme values to the nearest
 * within-sample quantiles. This makes the coefficient robust to outlier leverage
 * without discarding data. */
export function winsorize(arr: number[], trim = 0.1): number[] {
  if (arr.length < 4) return [...arr];
  const s = [...arr].sort((a, b) => a - b);
  const lo = s[Math.floor(trim * s.length)];
  const hi = s[Math.max(0, Math.ceil((1 - trim) * s.length) - 1)];
  return arr.map((v) => Math.max(lo, Math.min(hi, v)));
}

export interface RobustnessReport {
  /** Coefficient recomputed after 10% tail-winsorizing (outlier-robust). */
  winsorizedCoefficient: number | null;
  /** Jackknife: fraction of leave-one-out estimates that keep the original sign. 0..1. */
  stability: number;
  /** True when the link is fragile: an unstable sign, or winsorizing flips the direction. */
  outlierDriven: boolean;
  /** True when residuals are lag-1 autocorrelated → p-values may be inflated. */
  autocorrelatedResiduals: boolean;
}

/** Residual AR(1) autocorrelation from the OLS fit of y on x. */
function residualAutocorr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return 0;
  const b = sxy / sxx;
  const a = my - b * mx;
  const res: number[] = ys.map((y, i) => y - (a + b * xs[i]));
  let num = 0, den = 0;
  for (let i = 1; i < res.length; i++) { num += res[i] * res[i - 1]; den += res[i - 1] ** 2; }
  return den === 0 ? 0 : num / den;
}

function rawCoeff(xs: number[], ys: number[], method: 'pearson' | 'spearman'): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const t = method === 'pearson' ? pearsonTest(xs, ys) : spearmanTest(xs, ys);
  if (!t) return null;
  const v = method === 'pearson' ? (t as { r: number }).r : (t as { rho: number }).rho;
  return Number.isFinite(v) ? v : null;
}

export function correlationRobustness(
  xs: number[],
  ys: number[],
  method: 'pearson' | 'spearman',
): RobustnessReport {
  const n = xs.length;
  if (n < 6) {
    return { winsorizedCoefficient: null, stability: 0, outlierDriven: true, autocorrelatedResiduals: false };
  }
  const base = rawCoeff(xs, ys, method);
  if (base === null) {
    return { winsorizedCoefficient: null, stability: 0, outlierDriven: true, autocorrelatedResiduals: false };
  }

  const wins = rawCoeff(winsorize(xs), winsorize(ys), method) ?? base;
  const signBase = base >= 0 ? 1 : -1;

  // Jackknife: drop each paired observation, re-estimate, track sign agreement.
  let stable = 0;
  const usable = n >= 6;
  for (let i = 0; i < n; i++) {
    const xr = xs.filter((_, k) => k !== i);
    const yr = ys.filter((_, k) => k !== i);
    const c = rawCoeff(xr, yr, method);
    if (c === null) continue;
    if ((c >= 0 ? 1 : -1) === signBase) stable++;
  }
  const stability = usable ? stable / n : 0;

  const signFlipped = (wins >= 0 ? 1 : -1) !== signBase;
  const shifted = Math.abs(wins - base) > 0.4;
  const outlierDriven = stability < 0.7 || signFlipped || shifted;

  const autocorrelatedResiduals = n >= 8 && Math.abs(residualAutocorr(xs, ys)) > 0.3;

  return {
    winsorizedCoefficient: Number.isFinite(wins) ? wins : null,
    stability: Math.round(stability * 100) / 100,
    outlierDriven,
    autocorrelatedResiduals,
  };
}

// --- Proportions -------------------------------------------------------

/** Wilson score interval for a proportion (k successes in n trials). */
export function wilsonInterval(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return [
    Math.max(0, (centre - margin) / denom),
    Math.min(1, (centre + margin) / denom),
  ];
}