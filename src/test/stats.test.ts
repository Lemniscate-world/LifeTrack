// src/test/stats.test.ts
// Unit tests for src/stats.ts — pure streak/score functions.

import { describe, it, expect } from 'vitest';
import {
  toDateKey,
  fromDateKey,
  daysBetween,
  addDays,
  computeStreakStats,
  computeCompletionRate,
  computeWeightedScore,
  trackingStart,
} from '../stats';
import type { CheckIn, Habit } from '../types';

const TODAY = new Date(2026, 5, 27); // 2026-06-27 (month is 0-indexed)

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Test',
    color: '#FEF3C7',
    goal: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    order: 0,
    ...overrides,
  };
}

function checkIn(date: string, completed = true): CheckIn {
  return { habitId: 'h1', date, completed };
}

describe('date helpers', () => {
  it('toDateKey and fromDateKey round-trip', () => {
    const d = new Date(2026, 0, 5); // 2026-01-05
    expect(toDateKey(d)).toBe('2026-01-05');
    const back = fromDateKey('2026-01-05');
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(0);
    expect(back.getDate()).toBe(5);
  });

  it('daysBetween counts whole days', () => {
    expect(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 8))).toBe(7);
    expect(daysBetween(new Date(2026, 0, 8), new Date(2026, 0, 1))).toBe(-7);
  });

  it('addDays handles month boundary', () => {
    expect(toDateKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
    expect(toDateKey(addDays(new Date(2026, 1, 1), -1))).toBe('2026-01-31');
  });
});

describe('trackingStart', () => {
  it('returns createdAt date when no check-ins', () => {
    const h = makeHabit({ createdAt: '2026-03-15T08:00:00.000Z' });
    const start = trackingStart(h, []);
    expect(start).not.toBeNull();
    expect(toDateKey(start!)).toBe('2026-03-15');
  });

  it('returns earliest check-in when earlier than createdAt', () => {
    const h = makeHabit({ createdAt: '2026-03-15T08:00:00.000Z' });
    const start = trackingStart(h, [checkIn('2026-02-10')]);
    expect(toDateKey(start!)).toBe('2026-02-10');
  });

  it('returns createdAt when check-ins are after', () => {
    const h = makeHabit({ createdAt: '2026-03-15T08:00:00.000Z' });
    const start = trackingStart(h, [checkIn('2026-04-10'), checkIn('2026-04-11')]);
    expect(toDateKey(start!)).toBe('2026-03-15');
  });
});

describe('computeStreakStats — current', () => {
  it('returns zeros for a habit created today with no check-ins', () => {
    // When createdAt === today, today is the user's first chance to check —
    // we don't penalise them with a missed-day tally for the rest of history.
    const h = makeHabit({ createdAt: TODAY.toISOString() });
    const stats = computeStreakStats(h, [], TODAY);
    expect(stats.current).toBe(0);
    expect(stats.best).toBe(0);
    expect(stats.longestGap).toBe(0);
    expect(stats.totalTracked).toBe(1); // today itself counts as a tracked day
  });

  it('current = 1 when only today is checked', () => {
    const h = makeHabit();
    const stats = computeStreakStats(h, [checkIn('2026-06-27')], TODAY);
    expect(stats.current).toBe(1);
    expect(stats.best).toBe(1);
  });

  it('current counts consecutive completed days ending today', () => {
    const h = makeHabit();
    const stats = computeStreakStats(h, [
      checkIn('2026-06-25'),
      checkIn('2026-06-26'),
      checkIn('2026-06-27'),
    ], TODAY);
    expect(stats.current).toBe(3);
    expect(stats.best).toBe(3);
  });

  it('current = 0 when today is missed', () => {
    const h = makeHabit();
    const stats = computeStreakStats(h, [
      checkIn('2026-06-25'),
      checkIn('2026-06-26'),
      // 2026-06-27 missed
    ], TODAY);
    expect(stats.current).toBe(0);
    expect(stats.best).toBe(2);
  });

  it('current breaks on missed day in middle', () => {
    const h = makeHabit();
    const stats = computeStreakStats(h, [
      checkIn('2026-06-20'),
      checkIn('2026-06-21'),
      // 2026-06-22 missed
      checkIn('2026-06-23'),
      checkIn('2026-06-24'),
      checkIn('2026-06-25'),
      checkIn('2026-06-26'),
      checkIn('2026-06-27'),
    ], TODAY);
    expect(stats.current).toBe(5);
    expect(stats.best).toBe(5);
  });
});

describe('computeStreakStats — best (historical)', () => {
  it('best survives current streak break', () => {
    const h = makeHabit();
    // Past streak of 10, then break, then current streak of 3
    const checkIns: CheckIn[] = [];
    for (let d = 1; d <= 10; d++) checkIns.push(checkIn(`2026-05-${String(d).padStart(2, '0')}`));
    // gap May 11–15
    for (let d = 16; d <= 27; d++) checkIns.push(checkIn(`2026-05-${String(d).padStart(2, '0')}`));
    // gap May 28 – June 25
    checkIns.push(checkIn('2026-06-26'));
    checkIns.push(checkIn('2026-06-27'));
    const stats = computeStreakStats(h, checkIns, TODAY);
    expect(stats.best).toBe(12); // 10 + 12 days = max(10, 12)
    expect(stats.current).toBe(2);
    expect(stats.bestAt).toBe('2026-05-27');
  });

  it('best includes current streak if it is the longest', () => {
    const h = makeHabit();
    const stats = computeStreakStats(h, [
      checkIn('2026-06-25'),
      checkIn('2026-06-26'),
      checkIn('2026-06-27'),
    ], TODAY);
    expect(stats.best).toBe(3);
    expect(stats.bestAt).toBe('2026-06-27');
  });

  it('best is 0 when no completions at all', () => {
    const h = makeHabit({ createdAt: '2026-06-01T00:00:00.000Z' });
    const stats = computeStreakStats(h, [], TODAY);
    expect(stats.best).toBe(0);
    expect(stats.bestAt).toBe('');
  });
});

describe('computeStreakStats — longest gap', () => {
  it('detects a 14-day gap between two streaks', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [];
    // 5 days
    for (let d = 1; d <= 5; d++) checkIns.push(checkIn(`2026-04-${String(d).padStart(2, '0')}`));
    // 14 days gap (April 6–19)
    // 7 days
    for (let d = 20; d <= 26; d++) checkIns.push(checkIn(`2026-04-${String(d).padStart(2, '0')}`));
    const stats = computeStreakStats(h, checkIns, new Date(2026, 3, 30));
    expect(stats.longestGap).toBeGreaterThanOrEqual(14);
  });

  it('longest gap is the trailing open run after the last completion', () => {
    const h = makeHabit({ createdAt: '2026-03-15T00:00:00.000Z' });
    const stats = computeStreakStats(h, [
      checkIn('2026-03-20'),
      checkIn('2026-03-21'),
    ], new Date(2026, 3, 1));
    // March 22 → April 1 = 11 missed days (trailing open gap wins over the
    // 5-day opening gap from March 15–19).
    expect(stats.longestGap).toBe(11);
    expect(stats.longestGapAt).toBe('2026-04-01');
  });

  it('longest gap includes trailing days until today', () => {
    // createdAt is recent so we only count the trailing missed days, not the
    // pre-history days (which would otherwise dwarf the trailing gap).
    const h = makeHabit({ createdAt: '2026-06-19T00:00:00.000Z' });
    const stats = computeStreakStats(h, [
      checkIn('2026-06-20'),
      checkIn('2026-06-21'),
      // nothing after that until today (2026-06-27)
    ], TODAY);
    // gap from 2026-06-22 to 2026-06-27 = 6 missed days
    expect(stats.longestGap).toBe(6);
    expect(stats.longestGapAt).toBe('2026-06-27');
  });
});

describe('computeStreakStats — totals', () => {
  it('totalCompleted counts only completed=true entries', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [
      checkIn('2026-06-20', true),
      checkIn('2026-06-21', false), // explicit miss
      checkIn('2026-06-22', true),
      checkIn('2026-06-23', true),
    ];
    const stats = computeStreakStats(h, checkIns, TODAY);
    expect(stats.totalCompleted).toBe(3);
  });

  it('totalTracked is from tracking start to today inclusive', () => {
    const h = makeHabit({ createdAt: '2026-06-25T00:00:00.000Z' });
    const stats = computeStreakStats(h, [], TODAY);
    // June 25, 26, 27 = 3 days
    expect(stats.totalTracked).toBe(3);
  });
});

describe('computeCompletionRate', () => {
  it('returns 0 for empty check-ins', () => {
    const h = makeHabit();
    expect(computeCompletionRate(h, [], 30, TODAY)).toBe(0);
  });

  it('returns 100 when every day in window is completed', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [];
    for (let d = 21; d <= 27; d++) checkIns.push(checkIn(`2026-06-${String(d).padStart(2, '0')}`));
    expect(computeCompletionRate(h, checkIns, 7, TODAY)).toBe(100);
  });

  it('returns 50 for half completed', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [
      checkIn('2026-06-24'),
      checkIn('2026-06-26'),
    ];
    // window 7 days, 2/7 ≈ 29%, round to 29
    expect(computeCompletionRate(h, checkIns, 7, TODAY)).toBe(29);
  });

  it('respects tracking start: does not divide by pre-history days', () => {
    const h = makeHabit({ createdAt: '2026-06-25T00:00:00.000Z' });
    // only June 25–27 are tracked
    const checkIns = [checkIn('2026-06-25'), checkIn('2026-06-27')];
    expect(computeCompletionRate(h, checkIns, 30, TODAY)).toBe(67); // 2/3
  });

  it('30-day window returns rate over last 30 days', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [];
    // Complete last 15 days
    for (let d = 13; d <= 27; d++) checkIns.push(checkIn(`2026-06-${String(d).padStart(2, '0')}`));
    // 15/30 = 50%
    expect(computeCompletionRate(h, checkIns, 30, TODAY)).toBe(50);
  });
});

describe('computeWeightedScore', () => {
  it('is 0 for brand new habit', () => {
    const h = makeHabit();
    expect(computeWeightedScore(h, [], TODAY)).toBe(0);
  });

  it('caps streak bonus at 20', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [];
    for (let d = 1; d <= 27; d++) checkIns.push(checkIn(`2026-06-${String(d).padStart(2, '0')}`));
    // rate 27/27 = 100, streak bonus min(20, 27) = 20 → 120 capped to 100
    expect(computeWeightedScore(h, checkIns, TODAY)).toBe(100);
  });

  it('adds streak bonus to rate', () => {
    const h = makeHabit();
    const checkIns: CheckIn[] = [];
    // last 5 days completed out of 30 = 17%
    for (let d = 23; d <= 27; d++) checkIns.push(checkIn(`2026-06-${String(d).padStart(2, '0')}`));
    // 17 + min(20, 5) = 22
    expect(computeWeightedScore(h, checkIns, TODAY)).toBe(22);
  });
});

describe('edge cases — determinism', () => {
  it('returns identical results for identical inputs', () => {
    const h = makeHabit();
    const checkIns = [
      checkIn('2026-06-25'),
      checkIn('2026-06-26'),
      checkIn('2026-06-27'),
    ];
    const a = computeStreakStats(h, checkIns, TODAY);
    const b = computeStreakStats(h, checkIns, TODAY);
    expect(a).toEqual(b);
  });

  it('handles far-future check-ins without crashing', () => {
    const h = makeHabit();
    const stats = computeStreakStats(h, [checkIn('2099-01-01')], TODAY);
    expect(stats.current).toBe(0); // future date doesn't extend current
    expect(stats.best).toBe(0); // future date is beyond today
  });
});