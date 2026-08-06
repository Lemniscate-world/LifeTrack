import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, Lever } from '../types';
import {
  welchTwoSample,
  habitExistenceSeries,
  dailyGlobalRate,
  validateLevers,
  detectRelapses,
  suggestLevers,
} from '../leverInsights';

function habit(id: string, name = id, createdAt = '2026-01-01T00:00:00.000Z'): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt, archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}
function lever(id: string, createdAt: string): Lever {
  return { id, content: id, createdAt };
}
// Jan 1 + (d-1) days, rolling correctly across the month boundary.
function keyOf(d: number): string {
  const dt = new Date(2026, 0, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

describe('welchTwoSample', () => {
  it('detects a clear difference between two groups', () => {
    const a = [10, 12, 14, 11, 13];
    const b = [20, 22, 24, 21, 23];
    const w = welchTwoSample(a, b)!;
    expect(w.meanA).toBe(12);
    expect(w.meanB).toBe(22);
    expect(w.delta).toBe(10);
    expect(w.p).toBeLessThan(0.05);
    expect(w.significant).toBe(true);
    expect(w.d).not.toBeNull();
  });
  it('returns p≈1 for identical groups', () => {
    const w = welchTwoSample([1, 2, 3, 4], [1, 2, 3, 4])!;
    expect(w.p).toBeGreaterThan(0.9);
    expect(w.significant).toBe(false);
  });
  it('returns null when a group is too small', () => {
    expect(welchTwoSample([1], [2, 3, 4])).toBeNull();
  });
});

describe('habitExistenceSeries', () => {
  it('uses the real existence window (unlogged days count as misses)', () => {
    const h = habit('a', 'Run');
    const checks = [ci('a', '2026-01-01'), ci('a', '2026-01-02'), ci('a', '2026-01-04')];
    const series = habitExistenceSeries(h, checks, new Date(2026, 0, 5));
    // Jan 1..5 (5 days), completed on 1, 2, 4 → missing 3 and 5 are real misses.
    expect(series).toHaveLength(5);
    expect(series[0]).toEqual({ date: '2026-01-01', value: 1 });
    expect(series[2]).toEqual({ date: '2026-01-03', value: 0 });
    expect(series[4]).toEqual({ date: '2026-01-05', value: 0 });
  });
  it('returns empty when the habit has no tracking start', () => {
    expect(habitExistenceSeries({ ...habit('x'), createdAt: '' }, [], new Date())).toEqual([]);
  });
});

describe('dailyGlobalRate', () => {
  it('uses only habits that existed on each day as the denominator', () => {
    // Habit A exists from Jan 1, Habit B from Jan 3.
    const hA = habit('a', 'A', '2026-01-01T00:00:00.000Z');
    const hB = habit('b', 'B', '2026-01-03T00:00:00.000Z');
    const checks = [ci('a', '2026-01-01'), ci('a', '2026-01-02'), ci('b', '2026-01-03')];
    const g = dailyGlobalRate([hA, hB], checks, new Date(2026, 0, 4));
    const byDate = new Map(g.map((p) => [p.date, p.value]));
    expect(byDate.get('2026-01-01')).toBe(100); // only A exists, done
    expect(byDate.get('2026-01-02')).toBe(100); // only A exists, done
    expect(byDate.get('2026-01-03')).toBe(50); // A missed (0) + B done (1) → 50%
    expect(byDate.get('2026-01-04')).toBe(0); // both exist, both missed
  });
});

describe('validateLevers', () => {
  it('flags a lever that statistically improved completion', () => {
    // Habit created Jan 1; ~1/3 completion days 1-14, 100% from day 15 on.
    const h = habit('a', 'Run', '2026-01-01T00:00:00.000Z');
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 28; d++) {
      const k = `2026-01-${String(d).padStart(2, '0')}`;
      checks.push(ci('a', k, d <= 14 ? d % 3 === 1 : true));
    }
    const v = validateLevers([lever('L1', '2026-01-15T00:00:00.000Z')], [h], checks, {}, new Date(2026, 0, 28))[0];
    expect(v.needMoreData).toBe(false);
    expect(v.nBefore).toBe(14);
    expect(v.nAfter).toBe(14);
    expect(v.beforeRate).toBeLessThan(v.afterRate);
    expect(v.delta).toBeGreaterThan(20);
    expect(v.significant).toBe(true);
    expect(v.p).toBeLessThan(0.05);
  });
  it('marks levers created too recently as needing more data', () => {
    const h = habit('a', 'Run', '2026-01-01T00:00:00.000Z');
    const checks = [ci('a', '2026-01-01')];
    const v = validateLevers([lever('L1', '2026-01-28T00:00:00.000Z')], [h], checks, {}, new Date(2026, 0, 28))[0];
    expect(v.needMoreData).toBe(true);
    expect(v.p).toBe(1);
    expect(v.significant).toBe(false);
  });
  it('includes mood comparison when moods are available', () => {
    const h = habit('a', 'Run', '2026-01-01T00:00:00.000Z');
    const checks: CheckIn[] = [];
    const moods: Record<string, string> = {};
    for (let d = 1; d <= 28; d++) {
      const k = `2026-01-${String(d).padStart(2, '0')}`;
      checks.push(ci('a', k, true));
      // Some variance inside each group so the Welch test is valid.
      moods[k] = d <= 14 ? (d % 3 === 0 ? 'okay' : 'bad') : (d % 3 === 0 ? 'okay' : 'great');
    }
    const v = validateLevers([lever('L1', '2026-01-15T00:00:00.000Z')], [h], checks, moods, new Date(2026, 0, 28))[0];
    expect(v.beforeMood).toBeLessThan(v.afterMood);
    expect(v.moodP).toBeLessThan(0.05);
    expect(v.moodSignificant).toBe(true);
  });
});

describe('detectRelapses', () => {
  it('flags a habit that collapsed recently', () => {
    // 30 days on, then 8 days off (today = Feb 7).
    const h = habit('a', 'Run', '2026-01-01T00:00:00.000Z');
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 38; d++) {
      if (d <= 30) checks.push(ci('a', keyOf(d)));
    }
    const [r] = detectRelapses([h], checks, new Date(2026, 1, 7)); // Feb 7
    expect(r).toBeDefined();
    expect(r.relapse).toBe(true);
    expect(r.recentMean).toBe(0);
    expect(r.baselineMean).toBeGreaterThan(80);
    expect(r.p).toBeLessThan(0.05);
    expect(r.significant).toBe(true);
  });
  it('does not flag a habit that stayed consistent', () => {
    const h = habit('a', 'Run', '2026-01-01T00:00:00.000Z');
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 38; d++) {
      const k = keyOf(d);
      // Brief slump mid-history, but the last week is back to 100%.
      if (d >= 20 && d <= 24) continue;
      checks.push(ci('a', k));
    }
    const r = detectRelapses([h], checks, new Date(2026, 1, 7));
    expect(r.every((x) => !x.relapse)).toBe(true);
  });
  it('skips habits with too little history', () => {
    const h = habit('a', 'Run', '2026-01-01T00:00:00.000Z');
    expect(detectRelapses([h], [ci('a', '2026-01-01')], new Date(2026, 0, 10))).toEqual([]);
  });
});

describe('suggestLevers', () => {
  it('detects a habit that co-occurs with a better mood', () => {
    // Days 1-10 of Jan 2026: habit done + mostly great mood; days 12-21:
    // miss + low mood. Moods vary so the Welch test has variance.
    const h = habit('a', 'Méditation');
    const checks: CheckIn[] = [];
    const moods: Record<string, string> = {};
    for (let d = 1; d <= 10; d++) { checks.push(ci('a', keyOf(d))); moods[keyOf(d)] = d % 2 ? 'amazing' : 'great'; }
    for (let d = 12; d <= 21; d++) { checks.push(ci('a', keyOf(d), false)); moods[keyOf(d)] = d % 2 ? 'bad' : 'tired'; }
    const sug = suggestLevers([h], checks, moods);
    expect(sug.length).toBe(1);
    expect(sug[0].habitId).toBe('a');
    expect(sug[0].delta).toBeGreaterThan(0);
    expect(sug[0].significant).toBe(true);
  });

  it('returns nothing without enough mood data', () => {
    const h = habit('a');
    const checks = [ci('a', '2026-01-01')];
    expect(suggestLevers([h], checks, {})).toEqual([]);
  });

  it('excludes a habit associated with LOWER mood', () => {
    const h = habit('a', 'Écran tardif');
    const checks: CheckIn[] = [];
    const moods: Record<string, string> = {};
    for (let d = 1; d <= 10; d++) { checks.push(ci('a', keyOf(d))); moods[keyOf(d)] = 'bad'; }
    for (let d = 12; d <= 21; d++) { checks.push(ci('a', keyOf(d), false)); moods[keyOf(d)] = 'great'; }
    expect(suggestLevers([h], checks, moods)).toEqual([]);
  });
});