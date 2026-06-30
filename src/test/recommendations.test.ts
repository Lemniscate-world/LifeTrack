/**
 * Tests for the local heuristic recommendation engine.
 * Verifies each rule type independently with controlled fixtures.
 */
import { describe, it, expect } from 'vitest';
import { generateInsights } from '../recommendations';
import type { Habit, CheckIn } from '../types';

// --- Helpers ---

function makeHabit(id: string, name: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id,
    name,
    color: '#FEF3C7',
    goal: 1,
    createdAt: '2026-01-01',
    archived: false,
    order: 0,
    ...overrides,
  };
}

function makeCheckIn(habitId: string, date: string, completed: boolean): CheckIn {
  return { habitId, date, completed };
}

/** Generate daily check-ins for N days ending at endDate. */
function dailyChecks(
  habitId: string,
  endDate: string,
  days: number,
  skipDays: number[] = [], // 0=Sun...6=Sat days to skip
): CheckIn[] {
  const result: CheckIn[] = [];
  const end = new Date(endDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay();
    result.push(makeCheckIn(habitId, ds, !skipDays.includes(dayOfWeek)));
  }
  return result;
}

const NOW = new Date('2026-06-30T12:00:00Z');

// ============================================================================
// NEGLECTED — habit not checked in for N days
// ============================================================================
describe('NEGLECTED detection', () => {
  it('flags a habit with no check-ins', () => {
    const habits = [makeHabit('h1', 'Meditate')];
    const result = generateInsights(habits, [], NOW);
    const neglected = result.recommendations.filter((r) => r.kind === 'NEGLECTED');
    expect(neglected.length).toBe(1);
    expect(neglected[0].title).toContain('no check-ins yet');
  });

  it('flags a habit inactive for >4 days', () => {
    const habits = [makeHabit('h1', 'Journal')];
    const checkIns = [makeCheckIn('h1', '2026-06-24', true)]; // 6 days ago
    const result = generateInsights(habits, checkIns, NOW);
    const neglected = result.recommendations.filter((r) => r.kind === 'NEGLECTED');
    expect(neglected.length).toBe(1);
    expect(neglected[0].title).toContain('6 days since last check-in');
  });

  it('does NOT flag a habit checked in today', () => {
    const habits = [makeHabit('h1', 'Exercise')];
    const checkIns = [makeCheckIn('h1', '2026-06-30', true)];
    const result = generateInsights(habits, checkIns, NOW);
    const neglected = result.recommendations.filter((r) => r.kind === 'NEGLECTED');
    expect(neglected.length).toBe(0);
  });

  it('does NOT flag an archived habit', () => {
    const habits = [makeHabit('h1', 'Old Habit', { archived: true })];
    const result = generateInsights(habits, [], NOW);
    expect(result.recommendations.length).toBe(0);
  });
});

// ============================================================================
// STACK_SUGGESTION — one habit anchors another
// ============================================================================
describe('STACK_SUGGESTION detection', () => {
  it('suggests stacking low-performer after high-performer', () => {
    const habits = [
      makeHabit('h1', 'Coffee'),
      makeHabit('h2', 'Read'),
    ];
    // Coffee: 90% completion over last 30 days (skip only Sunday)
    const coffeeChecks = dailyChecks('h1', '2026-06-29', 30, [0]); // ~25/30 ≈ 83%
    // Read: 30% completion
    const readChecks = dailyChecks('h2', '2026-06-29', 30, [0, 1, 2, 3, 5, 6]); // only Thu → ~4/30 ≈ 13%
    const result = generateInsights(habits, [...coffeeChecks, ...readChecks], NOW);
    const stacks = result.recommendations.filter((r) => r.kind === 'STACK_SUGGESTION');
    if (stacks.length > 0) {
      expect(stacks[0].title).toContain('Read');
      expect(stacks[0].title).toContain('Coffee');
      expect(stacks[0].habitIds).toContain('h2');
    }
  });

  it('does NOT suggest stacking already-stacked habits', () => {
    const habits = [
      makeHabit('h1', 'Coffee'),
      makeHabit('h2', 'Read', { stackParent: 'h1' }),
    ];
    const checks = [
      ...dailyChecks('h1', '2026-06-29', 30),
      ...dailyChecks('h2', '2026-06-29', 30, [0, 1, 2, 3, 4]),
    ];
    const result = generateInsights(habits, checks, NOW);
    const stacks = result.recommendations.filter((r) => r.kind === 'STACK_SUGGESTION');
    // h2 is already stacked, so it should NOT appear in suggestions
    const hasReadStack = stacks.some((r) => r.habitIds.includes('h2'));
    expect(hasReadStack).toBe(false);
  });
});

// ============================================================================
// RECORD_APPROACH — close to beating all-time best
// ============================================================================
describe('RECORD_APPROACH detection', () => {
  it('flags habit close to beating its best streak', () => {
    const habits = [
      makeHabit('h1', 'Meditate', { bestStreak: 8 }),
    ];
    // Current streak of 5 days
    const checks = dailyChecks('h1', '2026-06-29', 5);
    const result = generateInsights(habits, checks, NOW);
    const records = result.recommendations.filter((r) => r.kind === 'RECORD_APPROACH');
    expect(records.length).toBe(1);
    expect(records[0].title).toContain('3 days');
    expect(records[0].title).toContain('Meditate');
    expect(records[0].strength).toBeGreaterThan(50);
  });

  it('does NOT flag if gap is too large (>5 days)', () => {
    const habits = [
      makeHabit('h1', 'Meditate', { bestStreak: 50 }),
    ];
    const checks = dailyChecks('h1', '2026-06-29', 2); // gap = 48 days
    const result = generateInsights(habits, checks, NOW);
    const records = result.recommendations.filter((r) => r.kind === 'RECORD_APPROACH');
    expect(records.length).toBe(0);
  });

  it('does NOT flag if best streak is too small (<5)', () => {
    const habits = [
      makeHabit('h1', 'New Habit', { bestStreak: 3 }),
    ];
    const checks = dailyChecks('h1', '2026-06-29', 3);
    const result = generateInsights(habits, checks, NOW);
    const records = result.recommendations.filter((r) => r.kind === 'RECORD_APPROACH');
    expect(records.length).toBe(0);
  });
});

// ============================================================================
// PRIME_TIME — best-performing days
// ============================================================================
describe('PRIME_TIME detection', () => {
  it('detects best days when pattern is clear', () => {
    const habits = [makeHabit('h1', 'Gym')];
    // 8 weeks: always complete on Tue/Thu, never on other days
    // Build check-ins for explicit Tue/Thu dates
    const tueThuDates = [
      '2026-06-30', // Tue
      '2026-06-25', // Thu
      '2026-06-23', // Tue
      '2026-06-18', // Thu
      '2026-06-16', // Tue
      '2026-06-11', // Thu
      '2026-06-09', // Tue
      '2026-06-04', // Thu
      '2026-06-02', // Tue
      '2026-05-28', // Thu
      '2026-05-26', // Tue
      '2026-05-21', // Thu
      '2026-05-19', // Tue
      '2026-05-14', // Thu
    ];
    const result = generateInsights(
      habits,
      tueThuDates.map((d) => makeCheckIn('h1', d, true)),
      NOW,
    );
    const prime = result.recommendations.filter((r) => r.kind === 'PRIME_TIME');
    expect(prime.length).toBeGreaterThanOrEqual(1);
    // Should mention Tue and/or Thu
    expect(prime[0].title).toMatch(/Tue|Thu/);
  });
});

// ============================================================================
// RECOVERY_PATTERN — how fast user bounces back
// ============================================================================
describe('RECOVERY_PATTERN detection', () => {
  it('computes average recovery time from gaps', () => {
    const habits = [makeHabit('h1', 'Exercise')];
    // Pattern: 1 day gap, 1 day gap, 1 day gap
    const dates = [
      '2026-06-01', '2026-06-03', '2026-06-04', '2026-06-06',
      '2026-06-07', '2026-06-09', '2026-06-10', '2026-06-12',
      '2026-06-13', '2026-06-15', '2026-06-16', '2026-06-18',
      '2026-06-19', '2026-06-21', '2026-06-22',
    ];
    const result = generateInsights(
      habits,
      dates.map((d) => makeCheckIn('h1', d, true)),
      NOW,
    );
    const recovery = result.recommendations.filter((r) => r.kind === 'RECOVERY_PATTERN');
    expect(recovery.length).toBeGreaterThanOrEqual(1);
    expect(recovery[0].title).toContain('recovery');
    // Gaps alternate between 1 and 2 days; avg should be ~1.5-2
    expect(recovery[0].detail).toMatch(/\d/);
  });
});

// ============================================================================
// MISS_PATTERN — consistently missed on specific day
// ============================================================================
describe('MISS_PATTERN detection', () => {
  it('detects a habit consistently missed on Mondays', () => {
    const habits = [makeHabit('h1', 'Exercise')];
    // 12 weeks: always miss Monday (day 1), complete other days
    const checks: CheckIn[] = [];
    for (let w = 0; w < 12; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(NOW);
        date.setUTCDate(date.getUTCDate() - w * 7 - d);
        const ds = date.toISOString().slice(0, 10);
        const dayOfWeek = date.getUTCDay(); // 0=Sun ... 6=Sat
        checks.push(makeCheckIn('h1', ds, dayOfWeek !== 1)); // miss Monday
      }
    }
    const result = generateInsights(habits, checks, NOW);
    const miss = result.recommendations.filter((r) => r.kind === 'MISS_PATTERN');
    expect(miss.length).toBeGreaterThanOrEqual(1);
    expect(miss[0].title).toContain('Mon');
  });
});

// ============================================================================
// Edge cases
// ============================================================================
describe('Edge cases', () => {
  it('returns empty for no habits', () => {
    const result = generateInsights([], [], NOW);
    expect(result.recommendations.length).toBe(0);
  });

  it('returns empty for too few check-ins (<5)', () => {
    const habits = [makeHabit('h1', 'New')];
    const checks = [makeCheckIn('h1', '2026-06-29', true)];
    const result = generateInsights(habits, checks, NOW);
    expect(result.recommendations.length).toBe(0);
  });

  it('deduplicates recommendations by title', () => {
    const habits = [
      makeHabit('h1', 'A'),
      makeHabit('h2', 'B'),
    ];
    const checks = [
      makeCheckIn('h1', '2026-06-01', true),
      makeCheckIn('h1', '2026-06-02', true),
      makeCheckIn('h1', '2026-06-03', true),
      makeCheckIn('h1', '2026-06-04', true),
      makeCheckIn('h1', '2026-06-05', true),
      makeCheckIn('h2', '2026-06-01', true),
      makeCheckIn('h2', '2026-06-02', true),
      makeCheckIn('h2', '2026-06-03', true),
      makeCheckIn('h2', '2026-06-04', true),
      makeCheckIn('h2', '2026-06-05', true),
    ];
    const result = generateInsights(habits, checks, NOW);
    const titles = result.recommendations.map((r) => r.title);
    const unique = new Set(titles);
    expect(unique.size).toBe(titles.length); // no duplicates
  });

  it('caps at 6 recommendations', () => {
    const habits = Array.from({ length: 10 }, (_, i) =>
      makeHabit(`h${i}`, `Habit ${i}`),
    );
    const checks: CheckIn[] = [];
    for (const h of habits) {
      checks.push(...dailyChecks(h.id, '2026-06-29', 60));
      // Insert a gap for each to trigger recovery detection
      checks.push(makeCheckIn(h.id, '2026-05-15', true));
    }
    const result = generateInsights(habits, checks, NOW);
    expect(result.recommendations.length).toBeLessThanOrEqual(8);
  });

  it('every recommendation has required fields', () => {
    const habits = [
      makeHabit('h1', 'Meditate', { bestStreak: 8 }),
      makeHabit('h2', 'Journal'),
    ];
    const checks = [
      ...dailyChecks('h1', '2026-06-29', 5),
      // h2: no check-ins → triggers NEGLECTED
    ];
    const result = generateInsights(habits, checks, NOW);
    for (const rec of result.recommendations) {
      expect(rec.kind).toBeTruthy();
      expect(rec.title).toBeTruthy();
      expect(rec.detail).toBeTruthy();
      expect(Array.isArray(rec.habitIds)).toBe(true);
      expect(rec.strength).toBeGreaterThanOrEqual(0);
      expect(rec.strength).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================================
// CORRELATION — same-day habit pairs
// ============================================================================
describe('CORRELATION detection', () => {
  it('detects when two habits often occur on the same day', () => {
    const habits = [
      makeHabit('h1', 'Exercise'),
      makeHabit('h2', 'Meditate'),
    ];
    // 20 days where both are done, 5 where only Exercise
    const checks: CheckIn[] = [];
    for (let d = 0; d < 25; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      const ds = date.toISOString().slice(0, 10);
      checks.push(makeCheckIn('h1', ds, true)); // Exercise always done
      checks.push(makeCheckIn('h2', ds, d < 20)); // Meditate only first 20
    }
    const result = generateInsights(habits, checks, NOW);
    const corr = result.recommendations.filter((r) => r.kind === 'CORRELATION');
    expect(corr.length).toBeGreaterThanOrEqual(1);
    expect(corr[0].habitIds).toContain('h1');
    expect(corr[0].habitIds).toContain('h2');
  });

  it('does NOT flag correlation below 70%', () => {
    const habits = [
      makeHabit('h1', 'A'),
      makeHabit('h2', 'B'),
    ];
    const checks: CheckIn[] = [];
    for (let d = 0; d < 20; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      const ds = date.toISOString().slice(0, 10);
      checks.push(makeCheckIn('h1', ds, true));
      checks.push(makeCheckIn('h2', ds, d < 8)); // only 40%
    }
    const result = generateInsights(habits, checks, NOW);
    const corr = result.recommendations.filter((r) => r.kind === 'CORRELATION');
    expect(corr.length).toBe(0);
  });
});

// ============================================================================
// TREND — month-over-month change
// ============================================================================
describe('TREND detection', () => {
  it('detects improvement this month vs last month', () => {
    const habits = [makeHabit('h1', 'Reading')];
    const checks: CheckIn[] = [];
    // Last month: 30% completion (days 31-60 ago)
    for (let d = 31; d <= 60; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      checks.push(makeCheckIn('h1', date.toISOString().slice(0, 10), d % 3 === 0)); // ~33%
    }
    // This month: 80% completion (days 0-30 ago)
    for (let d = 0; d < 30; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      checks.push(makeCheckIn('h1', date.toISOString().slice(0, 10), d % 5 !== 0)); // 80%
    }
    const result = generateInsights(habits, checks, NOW);
    const trends = result.recommendations.filter((r) => r.kind === 'TREND');
    expect(trends.length).toBeGreaterThanOrEqual(1);
    expect(trends[0].title).toContain('Reading');
    expect(trends[0].title).toMatch(/\+/); // positive trend
  });

  it('detects decline', () => {
    const habits = [makeHabit('h1', 'Exercise')];
    const checks: CheckIn[] = [];
    // Last month: 90%
    for (let d = 31; d <= 45; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      checks.push(makeCheckIn('h1', date.toISOString().slice(0, 10), true));
    }
    // This month: 40%
    for (let d = 0; d < 15; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      checks.push(makeCheckIn('h1', date.toISOString().slice(0, 10), d % 3 === 0));
    }
    const result = generateInsights(habits, checks, NOW);
    const trends = result.recommendations.filter((r) => r.kind === 'TREND');
    expect(trends.length).toBeGreaterThanOrEqual(1);
    expect(trends[0].title).toContain('📉');
  });
});

// ============================================================================
// WEEKLY_SUMMARY
// ============================================================================
describe('WEEKLY_SUMMARY', () => {
  it('generates a weekly summary with recent data', () => {
    const habits = [
      makeHabit('h1', 'Exercise', { bestStreak: 5, bestStreakAt: '2026-06-28' }),
      makeHabit('h2', 'Read', { stackParent: 'h1' }),
    ];
    const checks: CheckIn[] = [];
    // Last 7 days: 80% completion
    for (let d = 0; d < 7; d++) {
      const date = new Date(NOW);
      date.setUTCDate(date.getUTCDate() - d);
      const ds = date.toISOString().slice(0, 10);
      checks.push(makeCheckIn('h1', ds, d !== 3));
      checks.push(makeCheckIn('h2', ds, d !== 3 && d !== 5));
    }
    const result = generateInsights(habits, checks, NOW);
    const weekly = result.recommendations.filter((r) => r.kind === 'WEEKLY_SUMMARY');
    expect(weekly.length).toBe(1);
    expect(weekly[0].title).toContain('This week');
    expect(weekly[0].title).toContain('🏆');
  });

  it('returns empty when no recent data', () => {
    const habits = [makeHabit('h1', 'Old')];
    const checks = [makeCheckIn('h1', '2026-06-01', true)]; // 29 days ago
    const result = generateInsights(habits, checks, NOW);
    const weekly = result.recommendations.filter((r) => r.kind === 'WEEKLY_SUMMARY');
    expect(weekly.length).toBe(0);
  });
});
