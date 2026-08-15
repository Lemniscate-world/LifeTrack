import { describe, it, expect } from 'vitest';
import {
  pearsonTest,
  spearmanTest,
  benjaminiHochberg,
  requiredSampleSize,
  wilsonInterval,
  zTwoTail,
  tTwoTail,
  invNormCdf,
  arrayRanks,
  correlationRobustness,
  winsorize,
} from '../statistics';

describe('inverse normal CDF / z', () => {
  it('zTwoTail(0.05) is ~1.96', () => {
    expect(zTwoTail(0.05)).toBeCloseTo(1.959964, 4);
  });
  it('invNormCdf(0.5) is 0', () => {
    expect(invNormCdf(0.5)).toBeCloseTo(0, 6);
  });
  it('invNormCdf(0.975) is ~1.96', () => {
    expect(invNormCdf(0.975)).toBeCloseTo(1.959964, 4);
  });
});

describe('t distribution CDF', () => {
  it('two-tailed p for t=0 is 1', () => {
    expect(tTwoTail(0, 10)).toBeCloseTo(1, 6);
  });
  it('known value: tTwoTail(1.96, Inf-like large df) ≈ 0.05', () => {
    expect(tTwoTail(1.96, 100000)).toBeCloseTo(0.05, 2);
  });
  it('known value: p(t=1, df=10) is ~0.3409 (two-tailed)', () => {
    expect(tTwoTail(1, 10)).toBeCloseTo(0.340875, 4);
  });
  it('known value: p(t=2.228, df=10) ≈ 0.05 (critical t)', () => {
    expect(tTwoTail(2.228, 10)).toBeCloseTo(0.05, 2);
  });
});

describe('pearson correlation', () => {
  it('perfect positive correlation has p=0 and r=1', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [2, 4, 6, 8, 10];
    const res = pearsonTest(xs, ys)!;
    expect(res.r).toBeCloseTo(1, 5);
    expect(res.p).toBeLessThan(0.001);
  });
  it('uncorrelated data has a high p', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys = [1, 1, 1, 1, 1, 1, 1, 1]; // no variance → null
    expect(pearsonTest(xs, ys)).toBeNull();
  });
  it('a real positive correlation is detected with small p', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = xs.map((x) => x + Math.random());
    const res = pearsonTest(xs, ys)!;
    expect(res.r).toBeGreaterThan(0.9);
    expect(res.p).toBeLessThan(0.05);
  });
});

describe('spearman correlation', () => {
  it('monotone (non-linear) relation yields high Spearman rho', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7];
    const ys = [1, 4, 9, 16, 25, 36, 49]; // perfectly monotone
    const res = spearmanTest(xs, ys)!;
    expect(res.rho).toBeCloseTo(1, 5);
  });
  it('ranks with ties assign average rank', () => {
    expect(arrayRanks([3, 1, 2])).toEqual([3, 1, 2]);
    expect(arrayRanks([1, 1, 2])).toEqual([1.5, 1.5, 3]);
  });
});

describe('Benjamini–Hochberg', () => {
  it('leaves the smallest p-value essentially unchanged for large n', () => {
    const q = benjaminiHochberg([0.001, 0.5, 0.7]);
    expect(q[0]).toBeLessThanOrEqual(0.003);
  });
  it('corrects for multiple comparisons', () => {
    const q = benjaminiHochberg([0.05, 0.05, 0.05, 0.05]);
    for (const v of q) {
      expect(v).toBeCloseTo(0.05, 3); // value passes to each
    }
  });
  it('preserves order of output vs input', () => {
    const q = benjaminiHochberg([0.2, 0.01]);
    expect(q[1]).toBeLessThan(q[0]);
  });
});

describe('requiredSampleSize', () => {
  it('scales with smaller detectable effect', () => {
    const nBig = requiredSampleSize(0.2, 0.05, 0.8);
    const nSmall = requiredSampleSize(0.5, 0.05, 0.8);
    expect(nBig).toBeGreaterThan(nSmall);
  });
  it('r≈0.5 at 80% power needs ~29 pairs', () => {
    expect(requiredSampleSize(0.5, 0.05, 0.8)).toBeGreaterThanOrEqual(28);
  });
});

describe('correlationRobustness / anti-misleading', () => {
  it('winsorize clamps extreme tails', () => {
    const out = winsorize([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.1);
    expect(Math.max(...out)).toBeLessThan(100); // 100 is clipped to the hi quantile
    expect(out.length).toBe(10);
  });

  it('a clean monotone series is highly stable and not outlier-driven', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const r = correlationRobustness(xs, ys, 'pearson');
    expect(r.stability).toBe(1);
    expect(r.outlierDriven).toBe(false);
    expect(r.winsorizedCoefficient).toBeCloseTo(1, 2);
  });

  it('flags a single dominant outlier that drives the link', () => {
    // Strong negative trend (decreasing ys) with ONE huge spike on the last day:
    // the spike flips the nominal correlation positive, but drop that single day
    // (or winsorize the tail) and the sign reverses → fragile, outlier-driven.
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [19, 18, 17, 16, 17, 15, 14, 13, 12, 400];
    const r = correlationRobustness(xs, ys, 'pearson');
    expect(r.stability).toBeLessThan(0.95); // at least one leave-one-out flips
    expect(r.outlierDriven).toBe(true);
  });
});

describe('wilsonInterval', () => {
  it('flips to zero lower bound for rare events', () => {
    const ci = wilsonInterval(0, 10, 1.96); // 0/10 successes
    expect(ci[0]).toBe(0);
    expect(ci[1]).toBeGreaterThan(0);
    expect(ci[1]).toBeLessThan(0.35);
  });
  it('is symmetric-ish for balanced proportions', () => {
    const ci = wilsonInterval(5, 10, 1.96);
    expect(ci[0]).toBeGreaterThan(0.18);
    expect(ci[1]).toBeLessThan(0.82);
  });
});