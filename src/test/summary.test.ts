import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, UrgeEntry } from '../types';
import { windowMetrics, compareWindows, buildLocalSummary } from '../summary';
import { XP_RULES } from '../gamification';

const LARGE_YEAR = 2026;
const h1 = 'med';
function key(m: number, d: number): string {
  return `${LARGE_YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function ci(habitId: string, date: string): CheckIn {
  return { habitId, date, completed: true, count: 1 };
}
function habit(id: string): Habit {
  return { id, name: id, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function urge(startTime: string, outcome: UrgeEntry['outcome']): UrgeEntry {
  return { id: 'u', type: 'craving', intensity: 5, startTime: `${startTime}T08:00:00Z`, outcome };
}

describe('windowMetrics', () => {
  const h = habit('med');
  const checks = [ci('med', key(1, 1)), ci('med', key(1, 2)), ci('med', key(1, 3))];
  it('sums check-ins, goal-days and derived XP over the window', () => {
    const m = windowMetrics([h], checks, [], [], [], key(1, 1), key(1, 3));
    expect(m.completed).toBe(3);
    expect(m.goalDays).toBe(3);
    expect(m.xp).toBe(3 * (XP_RULES.checkIn + XP_RULES.goalDay));
    expect(m.activeDays).toBe(3);
    expect(m.windowDays).toBe(3);
  });
  it('counts urges and the surf rate, ignoring dates outside the window', () => {
    const urges = [
      urge(key(1, 1), 'surfed'),
      urge(key(1, 2), 'surfed'),
      urge(key(1, 4), 'gave_in'), // outside [1,1..1,3]
      urge(key(1, 3), 'gave_in'),
    ];
    const m = windowMetrics([], [], [], urges, [], key(1, 1), key(1, 3));
    expect(m.urgesLogged).toBe(3);
    expect(m.urgesSurfed).toBe(2);
    expect(m.surfRate).toBe(67);
  });
});

describe('compareWindows', () => {
  it('reports after-vs-before deltas with improved flags', () => {
    const checks: CheckIn[] = [];
    // "after" window: days 1..5  → 5 active
    for (let d = 1; d <= 5; d++) checks.push(ci(h1, key(1, d)));
    // "before" window: days 6..10 → none
    const cmp = compareWindows([habit(h1)], checks, [], [], [], 5, new Date(LARGE_YEAR, 0, 5));
    expect(cmp).not.toBeNull();
    const completed = cmp!.deltas.find((d) => d.key === 'completed')!;
    expect(completed.before).toBe(0);
    expect(completed.after).toBe(5);
    expect(completed.improved).toBe(true);
    expect(completed.deltaPct).toBe(100);
  });
  it('returns null when neither window has data', () => {
    expect(compareWindows([], [], [], [], [], 5, new Date(LARGE_YEAR, 0, 5))).toBeNull();
  });
});

describe('buildLocalSummary', () => {
  it('produces encouraging sentences from derived inputs', () => {
    const lines = buildLocalSummary({
      evolutionScore: 1200,
      activeDays: 40,
      xp: 900,
      level: 3,
      medals: [{ id: 'a', name: 'A', emoji: '🏅', description: '', earned: true, progress: 100 }],
      weekImproved: true,
      bestDayScore: 80,
      urgesSurfed: 7,
      moodsLogged: 12,
    });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain('900 XP');
    expect(lines.some((l) => l.includes('niveau 3'))).toBe(true);
    expect(lines.some((l) => l.includes('7 urges'))).toBe(true);
    expect(lines.some((l) => l.includes('1 médaille'))).toBe(true);
  });
});