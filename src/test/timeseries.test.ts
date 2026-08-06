import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import {
  chiSquareUpperP,
  theilSenSlope,
  trendTest,
  detectChangepoint,
  seriesVolatility,
  weekdaySeasonality,
  moodTrend,
  computeHabitTrends,
  mulberry32,
} from '../timeseries';
import { moodRank } from '../correlations';

function habit(id: string, name = id): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}

describe('chiSquareUpperP', () => {
  // Famous critical values: at α=0.05 with df d, χ² = 3.841 / 5.991 / 7.815 / 9.488 / 12.592.
  const cases: [number, number][] = [
    [1, 3.841],
    [2, 5.991],
    [3, 7.815],
    [4, 9.488],
    [6, 12.592],
  ];
  it('returns ~0.05 at the classic critical values', () => {
    for (const [df, x] of cases) {
      expect(chiSquareUpperP(x, df)).toBeGreaterThan(0.049);
      expect(chiSquareUpperP(x, df)).toBeLessThan(0.051);
    }
  });
  it('returns ~0.01 for χ²(1)=6.635 and ~0.368 for χ²(2)=2', () => {
    expect(chiSquareUpperP(6.635, 1)).toBeGreaterThan(0.0095);
    expect(chiSquareUpperP(6.635, 1)).toBeLessThan(0.0105);
    expect(chiSquareUpperP(2, 2)).toBeCloseTo(Math.exp(-1), 2); // df=2 survival = e^-x/2
  });
  it('edges and monotonicity', () => {
    expect(chiSquareUpperP(0, 5)).toBe(1);
    expect(chiSquareUpperP(0.001, 2)).toBeGreaterThan(0.95);
    expect(chiSquareUpperP(2, 4)).toBeGreaterThan(chiSquareUpperP(4, 4));
  });
});

describe('mannKendall / trendTest', () => {
  it('detects a strong positive trend (tau=1, p≈0)', () => {
    const t = trendTest(Array.from({ length: 20 }, (_, i) => i + 1))!;
    expect(t.tau).toBe(1);
    expect(t.p).toBeLessThan(1e-4);
    expect(t.direction).toBe('up');
    expect(t.significant).toBe(true);
  });
  it('detects a negative trend', () => {
    const t = trendTest(Array.from({ length: 20 }, (_, i) => 20 - i))!;
    expect(t.tau).toBe(-1);
    expect(t.direction).toBe('down');
    expect(t.significant).toBe(true);
  });
  it('handles tied groups (perfectly monotone → tau-b=1)', () => {
    // Ties reduce S and the denominator equally (time has no ties):
    // S = 66 − 9 within-group ties = 57; denom = 66 − 9 = 57 → tau-b = 1.
    const arr = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
    const t = trendTest(arr)!;
    expect(t.tau).toBe(1);
    expect(t.p).toBeLessThan(0.05);
    expect(t.direction).toBe('up');
  });
  it('calls a constant series stable', () => {
    const t = trendTest(Array(20).fill(5))!;
    expect(t.tau).toBe(0);
    expect(t.p).toBe(1);
    expect(t.direction).toBe('stable');
  });
  it('returns null below the minimum sample size', () => {
    expect(trendTest([1, 2, 3])).toBeNull();
    expect(moodRank('bad')).toBe(1);
    expect(moodRank('amazing')).toBe(8);
  });
});

describe('theilSenSlope', () => {
  it('computes the median pairwise slope', () => {
    expect(theilSenSlope([1, 3, 5, 7])).toBe(2);
    expect(theilSenSlope([1, 3, 5, 7], [0, 2, 4, 6])).toBe(1); // per calendar day
  });
  it('is robust to outliers', () => {
    const slopes = [1, 3, 2, 5, 7]; // one clamped/duplicate value
    const expected = 1.4166666667; // median of the 10 pairwise slopes
    expect(theilSenSlope(slopes)).toBeCloseTo(expected, 4);
  });
  it('returns null for tiny series', () => {
    expect(theilSenSlope([1, 2])).toBeNull();
  });
});

describe('trendTest slope', () => {
  it('reports slope in calendar-day units when times are supplied', () => {
    const times = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const t = trendTest([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], times)!;
    expect(t.slopeUnit).toBe('day');
    expect(t.slope).toBeCloseTo(1, 4);
  });
});

describe('detectChangepoint', () => {
  it('finds an upward step shift around its middle', () => {
    const values = [...Array(20).fill(0), ...Array(20).fill(1)];
    const cp = detectChangepoint(values, { perms: 500, seed: 7 })!;
    expect(cp.direction).toBe('up');
    expect(cp.index).toBeGreaterThanOrEqual(15);
    expect(cp.index).toBeLessThanOrEqual(25);
    expect(cp.meanBefore).toBeCloseTo(0, 2);
    expect(cp.meanAfter).toBeCloseTo(1, 2);
    expect(cp.p).toBeLessThan(0.05);
    expect(cp.significant).toBe(true);
  });
  it('finds a downward shift', () => {
    const values = [...Array(20).fill(1), ...Array(20).fill(0)];
    const cp = detectChangepoint(values, { perms: 500, seed: 7 })!;
    expect(cp.direction).toBe('down');
    expect(cp.p).toBeLessThan(0.05);
  });
  it('does not flag pure noise as a significant shift', () => {
    const rng = mulberry32(99);
    const values = Array.from({ length: 40 }, () => Math.round(rng())); // fair coin
    const cp = detectChangepoint(values, { perms: 500, seed: 7 })!;
    expect(cp.significant).toBe(false);
  });
  it('returns null for tiny series', () => {
    expect(detectChangepoint([1, 1, 1, 1, 1])).toBeNull();
  });
});

describe('seriesVolatility', () => {
  it('constant series → zero volatility', () => {
    const v = seriesVolatility([1, 1, 1, 1, 1])!;
    expect(v.stdDev).toBe(0);
    expect(v.meanAbsChange).toBe(0);
    expect(v.mad).toBe(0);
  });
  it('alternating series is highly volatile', () => {
    const v = seriesVolatility([0, 1, 0, 1, 0, 1])!;
    expect(v.stdDev).toBeCloseTo(Math.sqrt(1.5 / 5), 6); // sample σ, n-1
    expect(v.meanAbsChange).toBe(1);
    expect(v.mad).toBe(0.5);
  });
});

describe('weekdaySeasonality', () => {
  const start = '2026-01-01'; // a Thursday (getDay()=4)
  const next = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  it('flags a strong weekday effect and identifies the best day', () => {
    // 28 consecutive days; done only on the 2nd, 9th, 16th, 23rd day (same weekday).
    const series: { date: string; value: number }[] = [];
    let key = start;
    for (let i = 0; i < 28; i++) {
      series.push({ date: key, value: i % 7 === 1 ? 1 : 0 });
      key = next(key);
    }
    const prof = weekdaySeasonality(series)!;
    const targetWeekday = (4 + 1) % 7; // start weekday + 1
    expect(prof.best).toBe(targetWeekday);
    expect(prof.rates[targetWeekday]).toBe(100);
    expect(prof.overall).toBeCloseTo((4 / 28) * 100, 6);
    expect(prof.chi2).toBeGreaterThan(20);
    expect(prof.p).toBeLessThan(0.05);
    expect(prof.significant).toBe(true);
  });
  it('uniform completion → not significant', () => {
    const series: { date: string; value: number }[] = [];
    let key = start;
    for (let i = 0; i < 28; i++) {
      series.push({ date: key, value: 1 });
      key = next(key);
    }
    const prof = weekdaySeasonality(series)!;
    expect(prof.chi2).toBe(0);
    expect(prof.p).toBe(1);
    expect(prof.significant).toBe(false);
    expect(prof.overall).toBe(100);
  });
  it('returns null when a weekday is never recorded', () => {
    // 15 weekdays only (skip Sat/Sun).
    const series: { date: string; value: number }[] = [];
    let key = start;
    let added = 0;
    while (added < 15) {
      const [y, m, d] = key.split('-').map(Number);
      const wd = new Date(y, m - 1, d).getDay();
      if (wd !== 0 && wd !== 6) {
        series.push({ date: key, value: 1 });
        added++;
      }
      key = next(key);
    }
    expect(weekdaySeasonality(series)).toBeNull();
  });
  it('returns null for too few days', () => {
    expect(weekdaySeasonality([{ date: start, value: 1 }])).toBeNull();
  });
});

describe('moodTrend', () => {
  it('improving daily moods → upward trend (Spearman-based rank series)', () => {
    const moods: Record<string, string> = {};
    for (let d = 1; d <= 14; d++) {
      moods[`2026-02-${String(d).padStart(2, '0')}`] = d <= 6 ? 'bad' : d <= 10 ? 'okay' : 'great';
    }
    const t = moodTrend(moods)!;
    expect(t.direction).toBe('up');
    expect(t.significant).toBe(true);
  });
  it('returns null with too few moods', () => {
    expect(moodTrend({ '2026-02-01': 'bad', '2026-02-02': 'okay' })).toBeNull();
  });
});

describe('computeHabitTrends', () => {
  it('down-trending habit is detected; fresh habits are skipped', () => {
    const habits = [
      habit('good', 'Good'),
      habit('fresh', 'Fresh'),
    ];
    const checks: CheckIn[] = [];
    // 'good' done first 6 days then missed last 6 (12 recorded days → down).
    for (let d = 1; d <= 12; d++) {
      const k = `2026-03-${String(d).padStart(2, '0')}`;
      checks.push(ci('good', k, d <= 6));
    }
    // 'fresh' has only 3 days → statistics skipped.
    for (let d = 1; d <= 3; d++) {
      checks.push(ci('fresh', `2026-03-${String(d).padStart(2, '0')}`));
    }
    const [good, fresh] = computeHabitTrends(habits, checks);
    expect(good.days).toBe(12);
    expect(good.trend!.direction).toBe('down');
    expect(good.trend!.significant).toBe(true);
    expect(fresh.days).toBe(3);
    expect(fresh.trend).toBeNull();
  });
});