import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import { computeCorrelations } from '../correlations';

function habit(id: string, name = id): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}

describe('computeCorrelations', () => {
  it('returns an empty list when there are too few paired days', () => {
    const res = computeCorrelations([habit('a')], [ci('a', '2026-01-01')], {}, [], []);
    expect(res).toEqual([]);
  });

  it('detects a significant positive habit↔habit correlation', () => {
    // Both habits move together: done together ~2/3 of days, explicit-missed together otherwise.
    const habits = [habit('a', 'Run'), habit('b', 'Meditation')];
    const done: number[] = [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0];
    const checks: CheckIn[] = [];
    done.forEach((v, i) => {
      const k = `2026-01-${String(i + 1).padStart(2, '0')}`;
      checks.push(ci('a', k, v === 1), ci('b', k, v === 1));
    });
    const res = computeCorrelations(habits, checks, {}, [], []);
    const pair = res.find((c) => c.metricA === 'Run' && c.metricB === 'Meditation');
    expect(pair).toBeDefined();
    expect(pair!.method).toBe('pearson');
    expect(pair!.sampleSize).toBe(15); // all 15 days had check-ins for both
    expect(pair!.coefficient).toBeCloseTo(1, 4);
    expect(pair!.significant).toBe(true);
    expect(pair!.pValue).toBeLessThan(0.05);
  });

  it('uses Spearman and the mood rank when mood is involved, with pairwise n', () => {
    // Mood and habit move together: bad days 1-6 are habit misses, great days 7-12 are done.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 12; d++) {
      const k = `2026-01-${String(d).padStart(2, '0')}`;
      const good = d > 6;
      moods[k] = good ? 'great' : 'bad';
      checks.push(ci('a', k, good));
    }
    const res = computeCorrelations([habit('a')], checks, moods, [], []);
    const moodPair = res.find((c) => c.metricB === 'Mood' && c.metricA === 'a');
    expect(moodPair).toBeDefined();
    expect(moodPair!.method).toBe('spearman');
    expect(moodPair!.sampleSize).toBe(12); // all 12 days have both habit & mood
    expect(moodPair!.pValue).toBeLessThan(0.05);
  });

  it('does NOT impute missing moods as neutral (pairwise deletion)', () => {
    // 12 habit days, but only 6 have mood entries. Habit varies: odd days done, even missed.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 12; d++) {
      const k = `2026-01-${String(d).padStart(2, '0')}`;
      checks.push(ci('a', k, d % 2 === 1));
      if (d <= 6) moods[k] = d <= 3 ? 'bad' : 'great';
    }
    const res = computeCorrelations([habit('a')], checks, moods, [], []);
    const moodPair = res.find((c) => c.metricB === 'Mood' && c.metricA === 'a');
    // sampleSize must equal days with BOTH habit AND mood = 6, not 12.
    expect(moodPair).toBeDefined();
    expect(moodPair!.sampleSize).toBe(6);
  });
});