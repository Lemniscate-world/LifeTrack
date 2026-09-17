/**
 * Weekly Boss: adaptive HP (median of last 4 full weeks), damage from this
 * week's check-ins, kill streak of consecutive slain weeks.
 */
import { describe, it, expect } from 'vitest';
import { weeklyBoss, mondayOf } from '../boss';
import type { Habit, CheckIn } from '../types';

function habit(id: string): Habit {
  return {
    id, name: id, color: '', goal: 0,
    createdAt: '2026-01-01T00:00:00.000Z', archived: false, order: 0,
  };
}

// Monday 2026-09-07 — a fixed "now" for determinism.
const NOW = new Date(2026, 8, 9, 12, 0, 0); // Wed 2026-09-09

function checksFor(days: Record<string, number>, ids = ['a', 'b']): CheckIn[] {
  const out: CheckIn[] = [];
  for (const [date, n] of Object.entries(days)) {
    for (let i = 0; i < n; i++) {
      out.push({ habitId: ids[i % ids.length]!, date, completed: true });
    }
  }
  return out;
}

describe('mondayOf', () => {
  it('returns the Monday of any week', () => {
    expect(mondayOf(new Date(2026, 8, 9)).toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(mondayOf(new Date(2026, 8, 7)).toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(mondayOf(new Date(2026, 8, 13)).toISOString().slice(0, 10)).toBe('2026-09-07');
  });
});

describe('weeklyBoss', () => {
  const habits = [habit('a'), habit('b')];

  it('adapts HP to the median of the last 4 full weeks', () => {
    const checks = checksFor({
      '2026-08-10': 10, '2026-08-17': 20, '2026-08-24': 30, '2026-08-31': 40,
      '2026-09-07': 5, '2026-09-08': 5,
    });
    const boss = weeklyBoss(habits, checks, NOW);
    expect(boss.weekKey).toBe('2026-09-07');
    expect(boss.maxHp).toBe(25); // median(10,20,30,40)
    expect(boss.damage).toBe(10);
    expect(boss.remaining).toBe(15);
    expect(boss.slain).toBe(false);
    expect(boss.daysLeft).toBe(5); // Wed → 5 days left incl. today
    expect(boss.dailyDamage).toEqual([5, 5, 0]); // Mon..today incl.
  });

  it('declares victory and counts the kill streak', () => {
    const checks = checksFor({
      '2026-08-24': 30, '2026-08-31': 30,
      '2026-09-07': 20, '2026-09-08': 15,
    });
    const boss = weeklyBoss(habits, checks, NOW);
    expect(boss.maxHp).toBe(30);
    expect(boss.damage).toBe(35);
    expect(boss.slain).toBe(true);
    expect(boss.remaining).toBe(0);
    expect(boss.killStreak).toBe(2);
  });

  it('falls back without history and floors HP at 10', () => {
    const boss = weeklyBoss(habits, [], NOW);
    expect(boss.maxHp).toBe(10); // max(10, 5*2)
    expect(boss.slain).toBe(false);
    expect(boss.killStreak).toBe(0);
    const solo = weeklyBoss([habit('a')], [], NOW);
    expect(solo.maxHp).toBe(10); // max(10, 5*1)
  });

  it('ignores archived habits and uncompleted check-ins', () => {
    const archived = { ...habit('c'), archived: true };
    const checks: CheckIn[] = [
      { habitId: 'c', date: '2026-09-07', completed: true },
      { habitId: 'a', date: '2026-09-07', completed: false },
    ];
    const boss = weeklyBoss([...habits, archived], checks, NOW);
    expect(boss.damage).toBe(0);
  });
});
