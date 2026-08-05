import { describe, it, expect } from 'vitest';
import type { Habit, CheckIn, Note, UrgeEntry, Challenge } from '../types';
import {
  dayLifeScore,
  lifeScoreSeries,
  scoredDays,
  evolutionSummary,
  windowDelta,
} from '../evolution';
import { XP_RULES } from '../gamification';

const YEAR = 2026;
function key(m: number, d: number): string {
  return `${YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function habit(id: string, goal = 1): Habit {
  return { id, name: id, color: '#fff', goal, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true, count = 1): CheckIn {
  return { habitId, date, completed, count };
}

describe('dayLifeScore', () => {
  it('reward check-ins, goal days, achievements, urges and challenges', () => {
    const day = key(1, 1);
    const h = habit('a', 2);
    const checkIns = [ci('a', day, true, 2), ci('b', day, true, 1)];
    const notes: Note[] = [
      { id: 'n1', habitId: 'a', content: 'win', createdAt: `${day}T10:00:00Z`, achievementCategory: 'physical' },
    ];
    const urges: UrgeEntry[] = [
      { id: 'u1', type: 'craving', intensity: 6, startTime: `${day}T09:00:00Z`, outcome: 'surfed' },
    ];
    const challenges: Challenge[] = [
      { id: 'c1', habitId: 'a', name: 'x', days: 7, dailyGoal: 1, startDate: day, status: 'completed', createdAt: `${day}T00:00:00Z`, completedAt: `${day}T12:00:00Z` },
    ];
    expect(dayLifeScore(day, [h, habit('b')], checkIns, notes, urges, challenges).score)
      .toBe(
        3 * XP_RULES.checkIn +      // 2 + 1 completed
        2 * XP_RULES.goalDay +      // both habit a (goal 2) and habit b (goal 1) met
        XP_RULES.achievement +      // 1 win
        XP_RULES.challenge +        // 1 challenge
        10,                         // 1 urge surfed
      );
  });

  it('scores zero on an empty day', () => {
    const s = dayLifeScore(key(1, 2), [habit('a')], [], [], [], []);
    expect(s.score).toBe(0);
    expect(s.completed).toBe(0);
  });
});

describe('lifeScoreSeries / scoredDays', () => {
  it('generates a contiguous series oldest → newest', () => {
    const h = habit('a');
    const checks = [ci('a', key(1, 1)), ci('a', key(1, 3))];
    const series = lifeScoreSeries(key(1, 1), key(1, 3), [h], checks, [], [], []);
    expect(series.map((s) => s.date)).toEqual([key(1, 1), key(1, 2), key(1, 3)]);
    expect(series[0].score).toBe(XP_RULES.checkIn + XP_RULES.goalDay);
    expect(series[1].score).toBe(0);
  });

  it('scoredDays finds the min/max from check-ins, wins, urges', () => {
    const h = habit('a');
    const checks = [ci('a', key(1, 5)), ci('a', key(1, 2))];
    const notes: Note[] = [{ id: 'n1', habitId: 'a', content: '', createdAt: `${key(1, 8)}T00:00:00Z`, achievementCategory: 'x' }];
    const series = scoredDays([h], checks, notes, [], []);
    expect(series[0].date).toBe(key(1, 2));
    expect(series[series.length - 1].date).toBe(key(1, 8));
  });
});

describe('evolutionSummary', () => {
  it('reports today vs yesterday and lifecycle totals', () => {
    const h = habit('a');
    const checks = [
      ci('a', key(5, 14)), // yesterday (5/14)
      ci('a', key(5, 15)), // today
    ];
    const summary = evolutionSummary([h], checks, [], [], [], new Date(YEAR, 4, 15, 12));
    expect(summary.today).not.toBeNull();
    expect(summary.yesterday).not.toBeNull();
    expect(summary.dayDelta!.delta).toBe(0);
    expect(summary.dayDelta!.improved).toBe(true);
    expect(summary.totalScore).toBe(2 * (XP_RULES.checkIn + XP_RULES.goalDay));
    expect(summary.activeDays).toBe(2);
    expect(summary.bestDay).not.toBeNull();
  });

  it('returns empty summary when there is no data', () => {
    const summary = evolutionSummary([], [], [], [], [], new Date());
    expect(summary.today).toBeNull();
    expect(summary.activeDays).toBe(0);
    expect(summary.totalScore).toBe(0);
    expect(summary.dayDelta).toBeNull();
  });

  it('compares last 7 days to the 7 before', () => {
    const h = habit('a');
    const checks: CheckIn[] = [];
    for (let i = 0; i < 7; i++) checks.push(ci('a', key(5, 14 - i))); // prev week (5/8..5/14)
    for (let i = 0; i < 14; i++) checks.push(ci('a', key(5, 21 - i))); // cur week+ (5/8..5/21)
    // now = 5/22
    const delta = windowDelta([h], checks, [], [], [], key(5, 22), 7);
    expect(delta.current).toBeGreaterThan(0);
    expect(delta.previous).toBeGreaterThan(0);
  });
});