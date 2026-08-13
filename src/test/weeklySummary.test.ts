// src/test/weeklySummary.test.ts
import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import { weeklySummary } from '../weeklySummary';

const NOW = new Date(2026, 5, 15); // 2026-06-15
const D = (back: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const habit = (id: string, name: string, archived = false): Habit => ({
  id, name, color: '#fff', goal: 1, createdAt: '2026-01-01', archived, order: 0,
});

const ci = (habitId: string, date: string): CheckIn => ({ habitId, date, completed: true, count: 1 });

describe('weeklySummary', () => {
  it('computes the 7-day digest with per-day completion and the best day', () => {
    const habits = [habit('h1', 'Gym'), habit('h2', 'Read')];
    const checkIns = [
      ci('h1', D(0)), ci('h2', D(0)),          // today: 2/2 → 100%
      ci('h1', D(1)),                          // yesterday: 1/2 → 50%
      ci('h1', D(3)),                          // 3 days ago: 1/2 → 50%
    ];
    const s = weeklySummary(habits, checkIns, NOW);
    expect(s.days).toHaveLength(7);
    expect(s.days[6].date).toBe(D(0));
    expect(s.days[6].pct).toBe(100);
    expect(s.totalDone).toBe(4);
    expect(s.avgPct).toBeGreaterThan(0);
    expect(s.bestDay).toBe(D(0));
    expect(s.activeHabits).toBe(2);
  });

  it('returns zeros when there is no data', () => {
    const s = weeklySummary([habit('h1', 'Gym')], [], NOW);
    expect(s.totalDone).toBe(0);
    expect(s.avgPct).toBe(0);
    expect(s.bestDay).toBeNull();
    expect(s.activeHabits).toBe(0);
  });

  it('ignores archived habits in the denominator', () => {
    const habits = [habit('h1', 'Gym'), habit('h2', 'Read', true)];
    const s = weeklySummary(habits, [ci('h1', D(0))], NOW);
    expect(s.days[6].total).toBe(1);
    expect(s.days[6].pct).toBe(100);
  });
});
