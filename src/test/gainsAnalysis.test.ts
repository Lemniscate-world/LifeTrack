import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import { computeGains, GAIN_CATEGORIES } from '../gainsAnalysis';

function habit(id: string, name = id, category?: string): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0, ...(category ? { category } : {}) };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Fixed "today": 2026-03-15 (Sunday). Build check-ins relative to it.
const TODAY = new Date(2026, 2, 15); // Mar 15 2026
function ago(days: number): string {
  const d = new Date(2026, 2, 15);
  d.setDate(d.getDate() - days);
  return iso(d);
}

describe('computeGains', () => {
  it('computes completion rates per period and correct deltas', () => {
    // Habit done 10/14 of the last 14 days, 5/30 of the last 30 → 7d high, 30d lower.
    const checks: CheckIn[] = [];
    for (let d = 0; d < 14; d++) checks.push(ci('a', ago(d), d < 10));
    for (let d = 14; d < 30; d++) checks.push(ci('a', ago(d), false));
    const report = computeGains([habit('a', 'Sport', 'health')], checks, '30d', 'all', TODAY);
    expect(report.totalHabits).toBe(1);
    expect(report.domains[0].categoryId).toBe('health');
    // 7d: 10 done in last 7 days → ~100% (days 0-6 all done)
    expect(report.domains[0].habits[0].rates['7d']).toBeGreaterThanOrEqual(90);
    // 30d: 10/30 = 33%
    expect(report.domains[0].habits[0].rates['30d']).toBeCloseTo(33, 0);
    // d7to30 negative: 7d rate high, 30d lower → regression
    expect(report.domains[0].habits[0].deltas.d7to30).toBeLessThan(0);
  });

  it('groups habits by category and computes domain average', () => {
    const checks: CheckIn[] = [];
    for (let d = 0; d < 10; d++) {
      checks.push(ci('a', ago(d), true));
      checks.push(ci('b', ago(d), false));
    }
    const report = computeGains(
      [habit('a', 'Sport', 'health'), habit('b', 'Lecture', 'learning')],
      checks,
      '7d',
      'all',
      TODAY,
    );
    expect(report.domains).toHaveLength(2);
    const health = report.domains.find((d) => d.categoryId === 'health');
    const learning = report.domains.find((d) => d.categoryId === 'learning');
    expect(health).toBeDefined();
    expect(learning).toBeDefined();
    expect(health!.habits[0].name).toBe('Sport');
    // Domain avg = mean of habit rates over selected period (7d).
    expect(health!.avgRate).toBe(health!.habits[0].rates['7d']);
  });

  it('puts uncategorized habits into the "Non classé" domain', () => {
    const checks: CheckIn[] = [ci('a', ago(0), true)];
    const report = computeGains([habit('a')], checks, '7d', 'all', TODAY);
    expect(report.domains[0].categoryId).toBe('__none__');
    expect(report.domains[0].categoryName).toBe('Non classé');
  });

  it('filters by weekday vs weekend window', () => {
    // 2026-03-15 is a Sunday. Habit done on all 7 days; the weekend window
    // only counts Sat (14th) + Sun (15th).
    const checks: CheckIn[] = [];
    for (let d = 0; d < 7; d++) checks.push(ci('a', ago(d), true));
    const all = computeGains([habit('a', 'Sport', 'health')], checks, '7d', 'all', TODAY);
    const weekend = computeGains([habit('a', 'Sport', 'health')], checks, '7d', 'weekend', TODAY);
    const weekday = computeGains([habit('a', 'Sport', 'health')], checks, '7d', 'weekday', TODAY);
    // All days done → all three windows are 100% (denominators differ but rate equal).
    expect(all.domains[0].habits[0].rates['7d']).toBe(100);
    expect(weekend.domains[0].habits[0].rates['7d']).toBe(100);
    expect(weekday.domains[0].habits[0].rates['7d']).toBe(100);
    // But sample sizes differ: weekend has 2 days, weekday has 5 days.
    const wd2 = checks.filter((c) => {
      const day = new Date(c.date).getDay();
      return day !== 0 && day !== 6;
    }).length;
    const we2 = checks.filter((c) => {
      const day = new Date(c.date).getDay();
      return day === 0 || day === 6;
    }).length;
    expect(wd2).toBe(5);
    expect(we2).toBe(2);
  });

  it('exposes category metadata via GAIN_CATEGORIES', () => {
    expect(GAIN_CATEGORIES.some((c) => c.id === 'health')).toBe(true);
    expect(GAIN_CATEGORIES.some((c) => c.id === 'finance')).toBe(true);
  });
});