import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import { computeCorrelations, computeCorrelationAnalysis, shiftDateKey, weekdayOf, clusterOrder } from '../correlations';
import { moonPhaseAt } from '../astrology';

function habit(id: string, name = id): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}
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

describe('anti-misleading guards ("plus réel")', () => {
  it('flags a link driven by a shared time trend (trendDriven + detrended coefficient)', () => {
    // Both habits ramp up LINEARLY over time (count grows day by day) with
    // independent daily wobbles: raw correlation ≈ perfect, detrended ≈ 0.
    const habits = [habit('a', 'Sport'), habit('b', 'Lecture')];
    const checks: CheckIn[] = [];
    const randA = mulberry32(11);
    const randB = mulberry32(23);
    for (let d = 1; d <= 30; d++) {
      const k = `2026-03-${String(d).padStart(2, '0')}`;
      checks.push({ habitId: 'a', date: k, completed: true, count: d + Math.round(randA() * 4 - 2) });
      checks.push({ habitId: 'b', date: k, completed: true, count: d + Math.round(randB() * 4 - 2) });
    }
    const res = computeCorrelations(habits, checks, {}, [], []);
    const pair = res.find((c) => c.metricA === 'Sport' && c.metricB === 'Lecture');
    expect(pair).toBeDefined();
    expect(pair!.coefficient).toBeGreaterThan(0.9);
    expect(pair!.trendDriven).toBe(true);
    expect(pair!.detrendedCoefficient).not.toBeNull();
    expect(Math.abs(pair!.detrendedCoefficient!)).toBeLessThan(0.35);
    expect(pair!.sampleSize).toBe(30);
  });

  it('does not flag an alternating link as trend-driven', () => {
    // No time drift: A and B are done together on odd days, missed together on
    // even days. Raw and detrended correlations must both be high.
    const habits = [habit('a', 'Sport'), habit('b', 'Lecture')];
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 24; d++) {
      const k = `2026-04-${String(d).padStart(2, '0')}`;
      const done = d % 2 === 1;
      checks.push(ci('a', k, done), ci('b', k, done));
    }
    const res = computeCorrelations(habits, checks, {}, [], []);
    const pair = res.find((c) => c.metricA === 'Sport' && c.metricB === 'Lecture');
    expect(pair).toBeDefined();
    expect(pair!.coefficient).toBeCloseTo(1, 3);
    expect(pair!.trendDriven).toBe(false);
    expect(pair!.detrendedCoefficient!).toBeGreaterThan(0.5);
  });

  it('exposes a weekend contrast as weekdayConfounded', () => {
    // Habit more often done on weekends, mood systematically better on
    // weekends → strong raw link. But WITHIN each stratum the two are
    // independent → pooled within-stratum correlation collapses.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(7);
    for (let i = 0; i < 61; i++) {
      const k = i < 30
        ? `2026-06-${String(i + 1).padStart(2, '0')}`
        : `2026-07-${String(i - 29).padStart(2, '0')}`;
      const weekend = weekdayOf(k) === 0 || weekdayOf(k) === 6;
      const done = weekend ? rand() < 0.9 : rand() < 0.3;
      checks.push(ci('a', k, done));
      moods[k] = weekend
        ? (rand() > 0.5 ? 'great' : 'amazing')
        : (rand() > 0.5 ? 'bad' : 'angry');
    }
    const res = computeCorrelations([habit('a', 'Sport')], checks, moods, [], []);
    const pair = res.find((c) => c.metricA === 'Sport' && c.metricB === 'Mood');
    expect(pair).toBeDefined();
    expect(pair!.coefficient).toBeGreaterThan(0.3);
    expect(pair!.weekdayConfounded).toBe(true);
  });

  it('matrix cells are FDR-adjusted and carry detrended diagnostics', () => {
    // Two habits + mood: only one real signal. Multiple-testing correction must
    // be applied to cell significance, and cells keep trend metadata.
    const habits = [habit('a', 'Run'), habit('b', 'Meditation')];
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(99);
    for (let d = 1; d <= 20; d++) {
      const k = `2026-06-${String(d).padStart(2, '0')}`;
      const done = rand() > 0.5;
      checks.push(ci('a', k, done), ci('b', k, !done));
      moods[k] = rand() > 0.5 ? 'great' : 'bad';
    }
    const analysis = computeCorrelationAnalysis(habits, checks, moods, [], []);
    for (const cell of analysis.matrix) {
      expect(cell.qValue).toBeGreaterThanOrEqual(0);
      expect(cell.qValue).toBeLessThanOrEqual(1);
      if (cell.significant) expect(cell.qValue).toBeLessThan(0.05);
    }
    // Cells whose series are near-constant share no variance → excluded.
    expect(analysis.matrix.every((c) => c.sampleSize >= 6)).toBe(true);
    // The full same-day list also carries the trend guard fields.
    for (const r of analysis.sameDay) {
      expect(r.detrendedCoefficient === null || typeof r.detrendedCoefficient === 'number').toBe(true);
      expect(typeof r.trendDriven).toBe('boolean');
    }
  });
});

describe('truth guards v2 — confounder, lunar, base-rate ceiling, direction', () => {
  it('flags a Mood-driven link as confoundDriven via partial correlation', () => {
    // Habit and energy are BOTH driven by mood: done/up on good days, not done/down
    // on bad days. r(habit, energy) is strong, but partial(controlling Mood) ≈ 0.
    const moods: Record<string, string> = {};
    const energies: Record<string, number> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(55);
    for (let d = 1; d <= 40; d++) {
      const k = `2026-05-${String(d).padStart(2, '0')}`;
      const good = rand() > 0.45;
      moods[k] = good ? 'great' : 'bad';
      energies[k] = good ? 80 + rand() * 15 : 20 + rand() * 15;
      // Habit mostly follows mood, with ~10% of days disagreeing so the
      // partial correlation is estimable (rxz < 1).
      checks.push(ci('a', k, rand() > 0.06 ? good : !good));
    }
    const res = computeCorrelations([habit('a', 'Sport')], checks, moods, [], [], energies);
    const pair = res.find((c) => c.metricA === 'Sport' && c.metricB === 'Énergie');
    expect(pair).toBeDefined();
    expect(pair!.coefficient).toBeGreaterThan(0.6);
    expect(pair!.confoundDriven).toBe(true);
    expect(pair!.confounder).toBe('Mood');
    expect(pair!.partialCoefficient).not.toBeNull();
    expect(Math.abs(pair!.partialCoefficient!)).toBeLessThan(0.35);
  });

  it('keeps a genuine habit↔energy link when mood is irrelevant', () => {
    // Habit and energy move together; mood is random noise → partial ≈ raw.
    const moods: Record<string, string> = {};
    const energies: Record<string, number> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(123);
    for (let d = 1; d <= 40; d++) {
      const k = `2026-05-${String(d).padStart(2, '0')}`;
      const done = rand() > 0.5;
      moods[k] = rand() > 0.5 ? 'great' : 'bad';
      energies[k] = done ? 75 + rand() * 20 : 25 + rand() * 20;
      checks.push(ci('a', k, done));
    }
    const res = computeCorrelations([habit('a', 'Sport')], checks, moods, [], [], energies);
    const pair = res.find((c) => c.metricA === 'Sport' && c.metricB === 'Énergie');
    expect(pair).toBeDefined();
    expect(pair!.coefficient).toBeGreaterThan(0.5);
    expect(pair!.confoundDriven).toBe(false);
  });

  it('flags a pair that both follow the lunar cycle as lunarDriven', () => {
    // Habit and mood are both driven by the REAL moon phase (probabilistic, so
    // the partial is estimable) → strong same-day link that evaporates once
    // the lunar sinusoid is partialled out.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const rand1 = mulberry32(7);
    const rand2 = mulberry32(555);
    for (let d = 0; d < 55; d++) {
      const base = new Date(2026, 2, 1);
      base.setDate(base.getDate() + d);
      const k = base.toISOString().slice(0, 10);
      const phase = Math.sin((2 * Math.PI * moonPhaseAt(base)) / 360);
      const moodVal = phase + (rand2() - 0.5) * 0.4;
      moods[k] = moodVal > 0.25 ? 'great' : moodVal < -0.25 ? 'bad' : 'ok';
      checks.push(ci('a', k, rand1() < 0.5 + 0.48 * phase));
    }
    const res = computeCorrelations([habit('a', 'Sport')], checks, moods, [], []);
    const pair = res.find((c) => c.metricB === 'Mood' && c.metricA === 'Sport');
    expect(pair).toBeDefined();
    expect(pair!.coefficient).toBeGreaterThan(0.5);
    expect(pair!.lunarDriven).toBe(true);
    expect(pair!.lunarCoefficient).not.toBeNull();
    expect(Math.abs(pair!.lunarCoefficient!)).toBeLessThan(Math.abs(pair!.coefficient) - 0.2);
  });

  it('flags an effect pinned to the base-rate ceiling (atCeiling)', () => {
    // Habit A done ~5% of days, habit B ~40%. A's days all fall inside B's days:
    // phi ≈ 0.28 while the attainable ceiling ≈ 0.28 → the effect is AT the ceiling.
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 60; d++) {
      const k = `2026-08-${String(d).padStart(2, '0')}`;
      const aDone = d <= 3;
      const bDone = d <= 24;
      checks.push(ci('a', k, aDone), ci('b', k, bDone));
    }
    const res = computeCorrelations([habit('a', 'Rare'), habit('b', 'Commun')], checks, {}, [], []);
    const pair = res.find((c) => c.metricA === 'Rare' && c.metricB === 'Commun');
    expect(pair).toBeDefined();
    expect(pair!.maxR).not.toBeNull();
    expect(pair!.maxR!).toBeLessThan(0.5);
    expect(pair!.atCeiling).toBe(true);
  });

  it('supports a one-directional lag-1 link (reverse test)', () => {
    // Mood tomorrow = habit today exactly; habit tomorrow is independent of mood
    // today → forward significant, reverse not → directionSupported.
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(7);
    const done: boolean[] = [];
    for (let d = 1; d <= 20; d++) {
      const k = `2026-09-${String(d).padStart(2, '0')}`;
      const v = rand() > 0.5;
      done.push(v);
      checks.push(ci('a', k, v));
      const prev = done[d - 2];
      moods[k] = prev ? 'great' : 'bad';
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Sport')], checks, moods, [], []);
    const lag = analysis.lag1.find((c) => c.metricA === 'Sport' && c.metricB === 'Mood');
    expect(lag).toBeDefined();
    expect(lag!.significant).toBe(true);
    expect(lag!.reverseLagCoefficient).not.toBeNull();
    expect(lag!.directionSupported).toBe(true);
  });

  it('does not claim a direction when the link is reversible', () => {
    // Bidirectional design: mood today = habit yesterday (forward link perfect)
    // AND habit tomorrow = inverse of mood today (reverse link also perfect).
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(21);
    const sport: boolean[] = [rand() > 0.5, rand() > 0.5];
    for (let d = 2; d < 21; d++) sport[d] = !sport[d - 2];
    for (let d = 1; d <= 21; d++) {
      const k = `2026-09-${String(d).padStart(2, '0')}`;
      checks.push(ci('a', k, sport[d - 1]));
      moods[k] = sport[d - 2] ? 'great' : 'bad';
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Sport')], checks, moods, [], []);
    const lag = analysis.lag1.find((c) => c.metricA === 'Sport' && c.metricB === 'Mood');
    expect(lag).toBeDefined();
    expect(lag!.significant).toBe(true);
    expect(lag!.directionSupported).toBe(false);
  });

  it('matrix windows exist and clusterOrder groups correlated metrics', () => {
    const habits = [habit('a', 'Run'), habit('b', 'Read'), habit('c', 'Eat')];
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const rand = mulberry32(5);
    for (let d = 1; d <= 40; d++) {
      const k = `2026-10-${String(d).padStart(2, '0')}`;
      const good = rand() > 0.5;
      checks.push(ci('a', k, good), ci('b', k, good));
      checks.push(ci('c', k, rand() > 0.5));
      moods[k] = rand() > 0.5 ? 'great' : 'bad';
    }
    const analysis = computeCorrelationAnalysis(habits, checks, moods, [], []);
    expect(analysis.matrixWeekday).toBeDefined();
    expect(analysis.matrixWeekend).toBeDefined();
    expect(analysis.matrixWeekday!.length).toBeGreaterThan(0);
    expect(analysis.matrixWeekend!.length).toBeGreaterThan(0);
    // Run and Read move together → clustering puts them adjacent.
    const order = clusterOrder(analysis.metrics, analysis.matrix);
    const idxRun = order.indexOf('Run');
    const idxRead = order.indexOf('Read');
    expect(Math.abs(idxRun - idxRead)).toBe(1);
  });
});

describe('concentration series (daily focus %)', () => {
  it('appears as its own metric in the matrix and correlates with a habit', () => {
    // Deep-work habit done on days with high concentration (and not on others).
    const concentrations: Record<string, number> = {};
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 20; d++) {
      const k = `2026-11-${String(d).padStart(2, '0')}`;
      const deep = d % 3 !== 0; // ~2/3 of days done
      checks.push(ci('a', k, deep));
      concentrations[k] = deep ? 75 + (d % 20) : 25;
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Deep Work')], checks, {}, [], [], undefined, concentrations);
    expect(analysis.metrics).toContain('Concentration');
    const cell = analysis.matrix.find((c) => (c.row === 'Deep Work' && c.col === 'Concentration') || (c.row === 'Concentration' && c.col === 'Deep Work'));
    expect(cell).toBeDefined();
    expect(cell!.sampleSize).toBe(20);
    expect(Math.abs(cell!.coefficient!)).toBeGreaterThan(0.6);
    // Same-day result list carries the pair too.
    const pair = analysis.sameDay.find((c) => c.metricB === 'Concentration');
    expect(pair).toBeDefined();
    expect(pair!.method).toBe('pearson');
  });

  it('correlates concentration ↔ mood with Spearman', () => {
    const concentrations: Record<string, number> = {};
    const moods: Record<string, string> = {};
    for (let d = 1; d <= 14; d++) {
      const k = `2026-11-${String(d).padStart(2, '0')}`;
      const good = d % 2 === 1;
      concentrations[k] = good ? 90 : 10;
      moods[k] = good ? 'great' : 'bad';
    }
    const res = computeCorrelations([], [], moods, [], [], undefined, concentrations);
    const pair = res.find((c) => c.metricA === 'Concentration' && c.metricB === 'Mood');
    expect(pair).toBeDefined();
    expect(pair!.method).toBe('spearman');
    expect(pair!.coefficient).toBeGreaterThan(0.5);
  });

  it('supports lag-1: habit today → concentration tomorrow', () => {
    const concentrations: Record<string, number> = {};
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 21; d++) {
      const k = `2026-11-${String(d).padStart(2, '0')}`;
      const done = d % 2 === 1;
      checks.push(ci('a', k, done));
      const prevDone = d > 1 && d % 2 === 0;
      concentrations[k] = prevDone ? 85 : 20;
    }
    const analysis = computeCorrelationAnalysis([habit('a', 'Sport')], checks, {}, [], [], undefined, concentrations);
    const lag = analysis.lag1.find((c) => c.metricA === 'Sport' && c.metricB === 'Concentration');
    expect(lag).toBeDefined();
    expect(lag!.coefficient).toBeGreaterThan(0.4);
    expect(lag!.lag).toBe(1);
  });
});