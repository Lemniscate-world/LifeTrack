import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, CorrelationAnalysis } from '../types';
import { computeCorrelationAnalysis } from '../correlations';
import { topInsights } from '../insights';

function habit(id: string, name = id): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}

/** Build a strong clean signal: habit done on days 1..10 → energy high the NEXT
 * day (lag-1). Same-day energy is random, so only the lag-1 pair should shine. */
function lag1Signal(): CorrelationAnalysis {
  const checks: CheckIn[] = [];
  const energies: Record<string, number> = {};
  for (let d = 1; d <= 30; d++) {
    const k = `2026-01-${String(d).padStart(2, '0')}`;
    const done = d <= 10 || (d >= 12 && d <= 20);
    checks.push(ci('a', k, done));
    // Energy high one day AFTER a done day; low after a miss day.
    const prevDone = d <= 11 ? d > 1 && d - 1 <= 10 : d <= 21 ? d - 1 >= 12 && d - 1 <= 20 : false;
    energies[k] = prevDone ? 85 : 20;
  }
  return computeCorrelationAnalysis([habit('a', 'Sport')], checks, {}, [], [], energies);
}

describe('lag multi-jours', () => {
  it('exposes lag2/lag3/lag7 results and keeps lag1 in sync', () => {
    const analysis = lag1Signal();
    expect(analysis.lag1).toBeDefined();
    expect(analysis.lag2).toBeDefined();
    expect(analysis.lag3).toBeDefined();
    expect(analysis.lag7).toBeDefined();
    const lag1 = analysis.lag1!.find((r) => r.metricA === 'Sport' && r.metricB === 'Énergie');
    expect(lag1).toBeDefined();
    expect(lag1!.coefficient).toBeGreaterThan(0.5);
    // Lag-7 should be much weaker than lag-1 on this clean signal.
    const lag7 = analysis.lag7!.find((r) => r.metricA === 'Sport' && r.metricB === 'Énergie');
    if (lag7) expect(Math.abs(lag7.coefficient)).toBeLessThan(Math.abs(lag1!.coefficient));
  });

  it('carries the right lag metadata and caveat', () => {
    const analysis = lag1Signal();
    const lag3 = analysis.lag3!.find((r) => r.metricA === 'Sport');
    if (lag3) {
      expect(lag3.lag).toBe(3);
      expect(lag3.caveat).toContain('t+3');
    }
  });
});

describe('topInsights', () => {
  it('returns at most `limit` insights, trustworthy only, strongest first', () => {
    const analysis = lag1Signal();
    const insights = topInsights(analysis, 5);
    expect(insights.length).toBeLessThanOrEqual(5);
    for (const i of insights) {
      expect(i.magnitude).toBeGreaterThan(0);
      expect(i.n).toBeGreaterThanOrEqual(8);
      expect(i.sentence.length).toBeGreaterThan(10);
      expect(i.label).toContain('→');
    }
    // Sorted by score (magnitude dominant) — non-increasing magnitude.
    const magnitudes = insights.map((i) => i.magnitude);
    for (let i = 1; i < magnitudes.length; i++) {
      expect(magnitudes[i]).toBeLessThanOrEqual(magnitudes[i - 1] + 0.001);
    }
  });

  it('builds a French sentence describing the lag-1 relationship', () => {
    const analysis = lag1Signal();
    const insights = topInsights(analysis, 5);
    const sport = insights.find((i) => i.label.startsWith('Sport → Énergie'));
    expect(sport).toBeDefined();
    expect(sport!.lag).toBe(1);
    expect(sport!.direction).toBe('positive');
    expect(sport!.sentence).toMatch(/Quand tu fais sport, énergie a tendance à monter le lendemain/i);
  });

  it('returns empty when nothing is trustworthy', () => {
    const analysis = computeCorrelationAnalysis([habit('a')], [ci('a', '2026-01-01')], {}, [], []);
    expect(topInsights(analysis)).toEqual([]);
  });
});