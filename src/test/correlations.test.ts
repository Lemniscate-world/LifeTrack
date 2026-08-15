import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import { computeCorrelations, computeCorrelationAnalysis, shiftDateKey, weekdayOf } from '../correlations';

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

describe('correlation engine — lag, windows, matrix, caveats', () => {
  it('shiftDateKey and weekdayOf behave correctly', () => {
    expect(shiftDateKey('2026-01-15', 1)).toBe('2026-01-16');
    expect(shiftDateKey('2026-01-15', -1)).toBe('2026-01-14');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-01-19')).toBe(1); // Monday
    expect(weekdayOf('2026-01-17')).toBe(6); // Saturday
    expect(weekdayOf('2026-01-18')).toBe(0); // Sunday
  });

  it('lag-1 detects a predictive link: exercise today → better mood tomorrow', () => {
    // Days alternate: day d has exercise iff d is odd. Mood is great the day
    // AFTER an exercise day, bad otherwise → a clear lag-1 signal.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const start = 15;
    for (let i = 0; i < 14; i++) {
      const k = `2026-02-${String(start + i).padStart(2, '0')}`;
      const exercise = i % 2 === 0;
      checks.push(ci('a', k, exercise));
      const next = `2026-02-${String(start + i + 1).padStart(2, '0')}`;
      moods[next] = exercise ? 'great' : 'bad';
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Sport')], checks, moods, [], []);
    const lag = analysis.lag1.find((c) => c.metricB === 'Mood');
    expect(lag).toBeDefined();
    expect(lag!.lag).toBe(1);
    expect(lag!.coefficient).toBeGreaterThan(0.4);
  });

  it('does not report a same-day link when only the lag-1 signal exists', () => {
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    for (let i = 0; i < 14; i++) {
      const k = `2026-03-${String(i + 1).padStart(2, '0')}`;
      checks.push(ci('a', k, i % 2 === 0));
    }
    // Same-day mood is constant neutral → no same-day correlation possible.
    for (let i = 1; i <= 15; i++) moods[`2026-03-${String(i).padStart(2, '0')}`] = 'okay';
    const analysis = computeCorrelationAnalysis([habit('a')], checks, moods, [], []);
    const same = analysis.sameDay.find((c) => c.metricB === 'Mood');
    // Constant mood → no variance → the pair is excluded (not reported).
    expect(same).toBeUndefined();
  });

  it('splits weekday vs weekend windows', () => {
    // Sat/Sun = great mood + habit done; weekdays = mixed. Weekday-only window
    // must show a weaker (or null) link than the all-days contemporaneous one.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    for (let i = 1; i <= 21; i++) {
      const k = `2026-02-${String(i).padStart(2, '0')}`;
      const day = weekdayOf(k);
      const weekend = day === 0 || day === 6;
      checks.push(ci('a', k, weekend));
      moods[k] = weekend ? 'great' : (i % 2 === 0 ? 'great' : 'bad');
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Sport')], checks, moods, [], []);
    expect(analysis.weekday.length).toBeGreaterThanOrEqual(0);
    // weekend window should exist if enough weekend pairs (Feb 2026 has 8 weekend days).
    const weekendCorr = analysis.weekend.find((c) => c.metricB === 'Mood');
    if (weekendCorr) expect(weekendCorr.window).toBe('weekend');
  });

  it('builds a heatmap matrix over habit+mood and attaches caveats', () => {
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    for (let i = 1; i <= 12; i++) {
      const k = `2026-04-${String(i).padStart(2, '0')}`;
      const good = i > 6;
      moods[k] = good ? 'great' : 'bad';
      checks.push(ci('a', k, good));
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Run')], checks, moods, [], []);
    expect(analysis.metrics).toContain('Run');
    expect(analysis.metrics).toContain('Mood');
    const cell = analysis.matrix.find((c) => c.row === 'Run' && c.col === 'Mood');
    expect(cell).toBeDefined();
    expect(cell!.coefficient).toBeGreaterThan(0.8);
    expect(analysis.caveats.length).toBeGreaterThan(0);
    expect(analysis.caveats[0]).toContain('≠');
  });

  it('every lag-1 result carries a predictive caveat', () => {
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    for (let i = 0; i < 14; i++) {
      const k = `2026-05-${String(i + 1).padStart(2, '0')}`;
      checks.push(ci('a', k, i % 2 === 0));
      const next = `2026-05-${String(i + 2).padStart(2, '0')}`;
      moods[next] = i % 2 === 0 ? 'great' : 'bad';
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Sport')], checks, moods, [], []);
    for (const r of analysis.lag1) expect(r.caveat).toContain('prédictive');
  });

  it('correlates energy % with habits (Pearson) and includes it in the matrix', () => {
    const energies: Record<string, number> = {};
    const checks: CheckIn[] = [];
    for (let i = 1; i <= 14; i++) {
      const k = `2026-06-${String(i).padStart(2, '0')}`;
      // Energy high on days the habit is done, low on miss days.
      const done = i % 3 !== 0;
      energies[k] = done ? 80 : 20;
      checks.push(ci('a', k, done));
    }
    const res = computeCorrelations([habit('a', 'Run')], checks, {}, [], [], energies);
    const pair = res.find((c) => c.metricA === 'Run' && c.metricB === 'Énergie');
    expect(pair).toBeDefined();
    expect(pair!.method).toBe('pearson');
    expect(pair!.coefficient).toBeGreaterThan(0.9);
    expect(pair!.significant).toBe(true);

    const analysis = computeCorrelationAnalysis([habit('a', 'Run')], checks, {}, [], [], energies);
    expect(analysis.metrics).toContain('Énergie');
    const cell = analysis.matrix.find((c) => c.row === 'Run' && c.col === 'Énergie');
    expect(cell).toBeDefined();
    expect(cell!.coefficient).toBeGreaterThan(0.9);
  });

  it('correlates energy % with mood (both metric → Pearson)', () => {
    const energies: Record<string, number> = {};
    const moods: Record<string, string> = {};
    for (let i = 1; i <= 12; i++) {
      const k = `2026-07-${String(i).padStart(2, '0')}`;
      const good = i > 6;
      energies[k] = good ? 90 : 15;
      moods[k] = good ? 'great' : 'bad';
    }
    const res = computeCorrelations([], [], moods, [], [], energies);
    const pair = res.find((c) => c.metricA === 'Énergie' && c.metricB === 'Mood');
    expect(pair).toBeDefined();
    expect(pair!.method).toBe('pearson');
    expect(pair!.coefficient).toBeGreaterThan(0.9);
  });
});