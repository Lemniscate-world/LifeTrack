import { describe, it, expect } from 'vitest';
import { detectFadedWins, MIN_BEST_STREAK } from '../boost';
import type { Habit, CheckIn } from '../types';

const NOW = new Date('2026-08-08T12:00:00');

function habit(id: string, name: string, bestStreak: number, bestStreakAt: string): Habit {
  return {
    id,
    name,
    color: '#ccc',
    goal: 1,
    createdAt: '2026-01-01',
    archived: false,
    order: 0,
    bestStreak,
    bestStreakAt,
  };
}

function completion(habitId: string, daysBack: number): CheckIn {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  d.setDate(d.getDate() - daysBack);
  return {
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    habitId,
    completed: true,
  };
}

describe('detectFadedWins', () => {
  it('is empty when there are no habits', () => {
    expect(detectFadedWins([], [], NOW)).toEqual([]);
  });

  it('flags an old 10-day win that has since gone quiet', () => {
    const h = habit('gym', 'Gym', 10, '2026-05-01');
    // Some history so computeStreakStats has data; nothing in the last 3 days.
    const checkIns = [completion('gym', 30)];
    const wins = detectFadedWins([h], checkIns, NOW);
    expect(wins.length).toBe(1);
    expect(wins[0].habit.id).toBe('gym');
    expect(wins[0].bestStreak).toBe(10);
    expect(wins[0].faded).toBe(true);
    expect(wins[0].revive.days).toBeGreaterThan(0);
    expect(wins[0].revive.adaptive).toBe(true);
  });

  it('excludes habits whose best streak is too small', () => {
    const h = habit('med', 'Meditation', MIN_BEST_STREAK - 1, '2026-05-01');
    expect(detectFadedWins([h], [], NOW)).toEqual([]);
  });

  it('excludes habits whose best streak ended only recently (< age window)', () => {
    const h = habit('gym', 'Gym', 10, '2026-08-06'); // 2 days ago
    expect(detectFadedWins([h], [], NOW)).toEqual([]);
  });

  it('excludes archived habits', () => {
    const h: Habit = { ...habit('x', 'X', 10, '2026-05-01'), archived: true };
    expect(detectFadedWins([h], [], NOW)).toEqual([]);
  });

  it('sorts oldest win first', () => {
    const older = habit('a', 'A', 10, '2026-02-01');
    const newer = habit('b', 'B', 8, '2026-06-01');
    const wins = detectFadedWins([newer, older], [], NOW);
    expect(wins[0].habit.id).toBe('a');
    expect(wins[1].habit.id).toBe('b');
  });

  it('derives an adaptive suggestion from recent completion', () => {
    const h = habit('read', 'Read', 7, '2026-05-01');
    const checkIns = [completion('read', 6), completion('read', 5)];
    const wins = detectFadedWins([h], checkIns, NOW);
    expect(wins[0].suggestion.dailyGoal).toBeGreaterThanOrEqual(1);
  });
});