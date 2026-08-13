// src/test/autoAchievements.test.ts
import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, Note, Project, Experiment, UrgeEntry, JournalEntry } from '../types';
import { computeAutoAchievements, bestStreak, totalCompleted } from '../autoAchievements';

const habit = (id: string, name: string, createdAt = '2026-01-05T00:00:00.000Z'): Habit => ({
  id, name, color: '#fff', goal: 1, createdAt, archived: false, order: 0,
});

function c(habitId: string, day: number): CheckIn {
  return { habitId, date: `2026-01-${String(day).padStart(2, '0')}`, completed: true, count: 1 };
}

describe('autoAchievements', () => {
  it('detects the first habit, a streak and a completions milestone', () => {
    const habits = [habit('h1', 'Méditation')];
    const checkIns = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => c('h1', d));
    const result = computeAutoAchievements({
      habits, checkIns, notes: [], challenges: [], experiments: [], urges: [], journalEntries: [], projects: [],
    });
    const ids = result.map((a) => a.id);
    expect(ids).toContain('auto-first-habit');
    expect(ids).toContain('auto-streak-7');   // 8 consecutive days
    expect(ids).not.toContain('auto-10');     // only 8 completions → milestone locked
  });

  it('unlocks milestones only when thresholds are met', () => {
    const habits = [habit('h1', 'Gym')];
    const checkIns = Array.from({ length: 15 }, (_, i) => c('h1', i + 1));
    const result = computeAutoAchievements({
      habits, checkIns, notes: [], challenges: [], experiments: [], urges: [], journalEntries: [], projects: [],
    });
    expect(result.map((a) => a.id)).toContain('auto-10');
    expect(bestStreak(habits, checkIns)).toBe(15);
    expect(totalCompleted(checkIns)).toBe(15);
  });

  it('credits a win, an experiment, an urge surf, a journal and projects', () => {
    const habits = [habit('h1', 'Lecture')];
    const notes: Note[] = [{ id: 'n1', habitId: 'h1', content: 'win!', createdAt: '2026-01-06T00:00:00.000Z', achievementCategory: 'physical' }];
    const experiments: Experiment[] = [{ id: 'e1', title: 'x', hypothesis: 'h', startDate: '2026-01-01', endDate: '2026-01-14', linkedHabits: ['h1'], linkedMetrics: ['mood'], status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', conclusion: 'positive' }];
    const urges = [{ id: 'u1', type: 'sucré', startTime: '2026-01-01T10:00:00Z', outcome: 'surfed' }] as unknown as UrgeEntry[];
    const projects: Project[] = [{ id: 'p1', name: 'Landing', status: 'active', habitIds: [], tasks: [], createdAt: '2026-01-01T00:00:00.000Z' }];
    const journalEntries = [{ id: 'j1', content: 'bonjour', createdAt: '2026-01-01T00:00:00.000Z', personality: 'coach', response: '' }] as unknown as JournalEntry[];
    const result = computeAutoAchievements({ habits, checkIns: [], notes, challenges: [], experiments, urges, journalEntries, projects });
    const ids = result.map((a) => a.id);
    expect(ids).toContain('auto-first-win');
    expect(ids).toContain('auto-exp-done');
    expect(ids).toContain('auto-urge-surfed');
    expect(ids).toContain('auto-journal');
    expect(ids).toContain('auto-project');
  });
});
