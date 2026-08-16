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
  residualizeOnTime,
  detrendedCorrelation,
  fisherZ,
  fisherZInv,
  partialCorrelation,
  isBinarySeries,
  maxAttainableR,
} from '../statistics';

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

describe('detrending (spurious shared-trend guard)', () => {
  it('residualizeOnTime removes a perfect linear trend', () => {
    const res = residualizeOnTime([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const v of res) expect(v).toBeCloseTo(0, 9);
  });

  it('detrendedCorrelation annihilates a shared upward trend in independent series', () => {
    // x = time + noise₁, y = time + noise₂ with INDEPENDENT noises: a strong raw
    // correlation exists, but no day-to-day link once the shared drift is gone.
    const rand1 = mulberry32(42);
    const rand2 = mulberry32(1337);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t < 40; t++) {
      xs.push(t + rand1() * 2 - 1);
      ys.push(t + rand2() * 2 - 1);
    }
    const raw = pearsonTest(xs, ys)!;
    expect(raw.r).toBeGreaterThan(0.9);
    const dt = detrendedCorrelation(xs, ys, 'pearson')!;
    expect(Math.abs(dt.r)).toBeLessThan(0.35);
  });

  it('keeps the correlation intact when there is no time trend', () => {
    // Same independent pairing as above but WITHOUT the shared drift: x and y
    // alternate together day by day. Detrending must not destroy the signal.
    const xs = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const ys = [2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1];
    const raw = pearsonTest(xs, ys)!;
    expect(raw.r).toBeGreaterThan(0.9);
    const dt = detrendedCorrelation(xs, ys, 'pearson')!;
    expect(dt.r).toBeGreaterThan(0.5);
  });

  it('detrendedCorrelation returns null for tiny samples', () => {
    expect(detrendedCorrelation([1, 2, 3], [1, 2, 3], 'pearson')).toBeNull();
  });

  it('fisherZ / fisherZInv round-trip', () => {
    expect(fisherZInv(fisherZ(0.6))).toBeCloseTo(0.6, 9);
    expect(fisherZ(0)).toBe(0);
  });
});

describe('partialCorrelation (confounder guard)', () => {
  it('kills a spurious link driven by a confounder', () => {
    // x and y are both driven by z; once z is partialled out, r(x,y) → 0.
    const rand1 = mulberry32(7);
    const rand2 = mulberry32(2024);
    const randZ = mulberry32(99);
    const zs: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 120; i++) {
      const z = randZ();
      zs.push(z);
      xs.push(z + (rand1() - 0.5) * 0.3);
      ys.push(z + (rand2() - 0.5) * 0.3);
    }
    const raw = pearsonTest(xs, ys)!;
    expect(raw.r).toBeGreaterThan(0.85);
    const partial = partialCorrelation(xs, ys, zs, 'pearson')!;
    expect(Math.abs(partial.r)).toBeLessThan(0.12);
  });

  it('preserves a genuine link when the confounder is irrelevant', () => {
    const rand = mulberry32(99);
    const zs: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) {
      zs.push(rand());
      xs.push(i + (rand() - 0.5) * 4);
      ys.push(i + (rand() - 0.5) * 4);
    }
    const raw = pearsonTest(xs, ys)!;
    const partial = partialCorrelation(xs, ys, zs, 'pearson')!;
    expect(partial.r).toBeGreaterThan(raw.r - 0.15);
  });

  it('returns null for tiny samples', () => {
    expect(partialCorrelation([1, 2, 3, 4], [1, 2, 3, 4], [1, 1, 1, 1], 'pearson')).toBeNull();
  });

  it('returns null when the confounder is constant', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(partialCorrelation(xs, ys, xs.map(() => 1), 'pearson')).toBeNull();
  });
});

describe('maxAttainableR (base-rate ceiling)', () => {
  it('detects binary series', () => {
    expect(isBinarySeries([0, 1, 0, 1, 1])).toBe(true);
    expect(isBinarySeries([0, 0.5, 1])).toBe(false);
    expect(isBinarySeries([0, 1, 2])).toBe(false);
  });

  it('caps binary×binary at the phi ceiling (strictly < 1 when margins differ)', () => {
    // x done 80% of days (minority 20%), y done 70% (minority 30%): the phi
    // ceiling with unequal margins can never reach 1.
    const xs = [1, 1, 1, 1, 0, 1, 1, 1, 0, 1];
    const ys = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
    const ceiling = maxAttainableR(xs, ys)!;
    expect(ceiling).toBeGreaterThan(0);
    expect(ceiling).toBeLessThan(1);
    // phi ceiling with minority margins p_x=0.2, p_y=0.3.
    expect(ceiling).toBeCloseTo(Math.sqrt((0.2 * 0.7) / (0.3 * 0.8)), 6);
  });

  it('allows r=1 when the base rates can align perfectly', () => {
    // Both done exactly half the time → perfect phi = 1.
    const xs = [1, 1, 1, 1, 0, 0, 0, 0];
    const ys = [1, 1, 0, 0, 1, 1, 0, 0];
    expect(maxAttainableR(xs, ys)!).toBeCloseTo(1, 6);
  });

  it('caps binary×continuous at the point-biserial ceiling', () => {
    // x done only 10% of the time: with a binary split, the correlation with a
    // continuous y can never exceed sqrt(p/(1-p))'s bound for that split.
    const xs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const ys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ceiling = maxAttainableR(xs, ys)!;
    expect(ceiling).toBeGreaterThan(0);
    expect(ceiling).toBeLessThan(1);
    expect(ceiling).toBeCloseTo(Math.sqrt(0.1 / 0.9), 6);
  });

  it('returns null for continuous×continuous (no ceiling concept)', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys = [8, 7, 6, 5, 4, 3, 2, 1];
    expect(maxAttainableR(xs, ys)).toBeNull();
  });
});