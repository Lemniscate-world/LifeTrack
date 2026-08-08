import { describe, it, expect, beforeEach } from 'vitest';
import type { Habit, CheckIn } from '../types';
import {
  computeChallengeProgress,
  suggestAdaptiveTarget,
  pickSuggestion,
  buildChallengeName,
  challengePhases,
  computePhaseProgress,
  phaseVerdict,
} from '../challenges';
import {
  resetStore,
  addHabit,
  addChallenge,
  getChallenges,
  deleteChallenge,
  resolveChallengeStatuses,
  toggleCheckIn,
} from '../store';

function localDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function dateStr(base: Date, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ci(habitId: string, date: string, completed = true, count = 1): CheckIn {
  return { habitId, date, completed, count };
}
function habit(id: string, name = id): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}

describe('computeChallengeProgress', () => {
  const start = '2026-01-01';
  it('counts qualifying days and marks 100% when all meet the goal', () => {
    const checks = [ci('h', '2026-01-01'), ci('h', '2026-01-02'), ci('h', '2026-01-03')];
    const p = computeChallengeProgress('h', start, 3, 1, checks, '2026-01-03');
    expect(p.completedDays).toBe(3);
    expect(p.totalDays).toBe(3);
    expect(p.pct).toBe(100);
    expect(p.isToday).toBe(true);
  });
  it('does not count days below the daily goal', () => {
    const checks = [ci('h', '2026-01-01')]; // goal 2 unmet
    const p = computeChallengeProgress('h', start, 3, 2, checks, '2026-01-03');
    expect(p.completedDays).toBe(0);
    expect(p.pct).toBe(0);
  });
  it('only counts completions inside the challenge window', () => {
    const checks = [ci('h', '2026-01-04')]; // outside the 3-day window
    const p = computeChallengeProgress('h', start, 3, 1, checks, '2026-01-03');
    expect(p.completedDays).toBe(0);
  });
  it('reports days remaining (today and future window days)', () => {
    const p = computeChallengeProgress('h', start, 5, 1, [], '2026-01-02');
    expect(p.daysRemaining).toBe(4); // 02,03,04,05
  });
  it('computes the current streak of consecutive qualifying days', () => {
    const checks = [ci('h', '2026-01-03'), ci('h', '2026-01-02')];
    const p = computeChallengeProgress('h', start, 3, 1, checks, '2026-01-03');
    expect(p.currentStreak).toBe(2);
  });
});

describe('suggestAdaptiveTarget', () => {
  const now = new Date(2026, 0, 14); // Jan 14
  it('suggests a stretch target for a habit done often', () => {
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 11; d++) checks.push(ci('h', localDate(2026, 1, d), true, 2));
    const s = suggestAdaptiveTarget(habit('h', 'Run'), checks, 14, now);
    expect(s.difficulty).toBe('stretch');
    expect(s.dailyGoal).toBe(2);
    expect(s.days).toBe(30);
  });
  it('suggests a gentle 14-day goal for a habit barely done', () => {
    const checks = [ci('h', localDate(2026, 1, 2))];
    const s = suggestAdaptiveTarget(habit('h', 'Run'), checks, 14, now);
    expect(s.difficulty).toBe('gentle');
    expect(s.days).toBe(14);
    expect(s.dailyGoal).toBe(1);
  });
});

describe('pickSuggestion', () => {
  it('picks the most neglected habit that is not already challenged', () => {
    const a = habit('a', 'A'); // done yesterday
    const b = habit('b', 'B'); // done 3 days ago
    const now = new Date(2026, 0, 14);
    const checks = [ci('a', localDate(2026, 1, 13)), ci('b', localDate(2026, 1, 11))];
    const picked = pickSuggestion([a, b], checks, new Set(['a']), now);
    expect(picked?.id).toBe('b');
  });
  it('returns null when every active habit is already challenged', () => {
    const a = habit('a', 'A');
    expect(pickSuggestion([a], [], new Set([a.id]), new Date(2026, 0, 14))).toBeNull();
  });
});

describe('buildChallengeName', () => {
  it('builds a streak label for a single daily goal', () => {
    expect(buildChallengeName('Meditate', 30, 1)).toBe('30-day streak: Meditate');
  });
  it('builds a multi-count label for a higher daily goal', () => {
    expect(buildChallengeName('Meditate', 21, 3)).toBe('21-day challenge: Meditate (3×/day)');
  });
});

describe('store challenge lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });
  it('adds and deletes a challenge', () => {
    const h = addHabit('Run');
    const c = addChallenge(h.id, '30-day streak: Run', 30, 1);
    expect(getChallenges()).toHaveLength(1);
    expect(c.status).toBe('active');
    deleteChallenge(c.id);
    expect(getChallenges()).toHaveLength(0);
  });
  it('marks a stale challenge as failed when the goal was never met', () => {
    const h = addHabit('Run');
    addChallenge(h.id, '3-day streak: Run', 3, 1);
    const beyond = new Date();
    beyond.setDate(beyond.getDate() + 5);
    expect(resolveChallengeStatuses(beyond)).toBe(1);
    expect(getChallenges()[0].status).toBe('failed');
  });
  it('marks a stale challenge as completed when >=80% of days qualified', () => {
    const h = addHabit('Run');
    addChallenge(h.id, '3-day streak: Run', 3, 1);
    for (let offset = 0; offset < 3; offset++) {
      toggleCheckIn(h.id, dateStr(new Date(), offset));
    }
    const beyond = new Date();
    beyond.setDate(beyond.getDate() + 5);
    resolveChallengeStatuses(beyond);
    expect(getChallenges()[0].status).toBe('completed');
    expect(getChallenges()[0].completedAt).toBeTruthy();
  });
});

describe('challengePhases', () => {
  it('splits a 30-day challenge into 3 ordered phases covering all days', () => {
    const phases = challengePhases(30);
    expect(phases).toHaveLength(3);
    expect(phases[0].startDay).toBe(1);
    expect(phases[2].endDay).toBe(30);
    // Contiguous, non-overlapping: each phase's start === previous end + 1.
    expect(phases[1].startDay).toBe(phases[0].endDay + 1);
    expect(phases[2].startDay).toBe(phases[1].endDay + 1);
    // Grep multipliers ramp up: gentle → peak.
    expect(phases[0].multiplier).toBeLessThan(phases[1].multiplier);
    expect(phases[1].multiplier).toBeLessThan(phases[2].multiplier);
  });

  it('handles tiny challenges without error', () => {
    const phases = challengePhases(1);
    expect(phases).toHaveLength(3);
    expect(phases[0].endDay).toBeGreaterThanOrEqual(1);
  });
});

describe('computePhaseProgress', () => {
  const start = '2026-06-01';

  it('marks a fully-met phase when every non-future day qualifies', () => {
    const checks = [
      ci('h', '2026-06-01'), ci('h', '2026-06-02'), ci('h', '2026-06-03'),
    ];
    const phases = computePhaseProgress('h', start, 9, 1, checks, '2026-06-03');
    expect(phases[0].met).toBe(true);
    expect(phases[0].completedDays).toBe(3);
  });

  it('judges future window days as not-yet-counted', () => {
    const checks = [ci('h', '2026-06-01')];
    const phases = computePhaseProgress('h', start, 9, 1, checks, '2026-06-01');
    expect(phases[0].completedDays).toBe(1);
    expect(phases[1].completedDays).toBe(0);
  });

  it('applies the phase multiplier to the daily goal', () => {
    const checks = [ci('h', '2026-06-01', true, 1)]; // 1× on a 1× goal day qualifies
    const phases = computePhaseProgress('h', start, 9, 1, checks, '2026-06-01');
    expect(phases[0].completedDays).toBe(1); // gentle 0.75× → 1× qualifies
  });
});

describe('phaseVerdict', () => {
  it('Recognizes a peak reached', () => {
    const p = { phase: { multiplier: 1.25 }, met: true };
    expect(phaseVerdict(p as Parameters<typeof phaseVerdict>[0])).toContain('🏔️');
  });
  it('flags a missed threshold', () => {
    const p = { phase: { multiplier: 0.75 }, met: false };
    expect(phaseVerdict(p as Parameters<typeof phaseVerdict>[0])).toContain('manqué');
  });
});