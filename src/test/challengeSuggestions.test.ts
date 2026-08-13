// src/test/challengeSuggestions.test.ts
import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, DetectedReflection, CorrelationResult } from '../types';
import { suggestChallenges } from '../challengeSuggestions';

const habit = (id: string, name: string, category?: string): Habit => ({
  id, name, color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 0, category,
});

function ci(habitId: string, date: string): CheckIn {
  return { habitId, date, completed: true, count: 1 };
}

const NOW = new Date(2026, 5, 15); // 2026-06-15
const D = (back: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('challengeSuggestions', () => {
  it('recommends a recovery challenge from a stale-win reflection', () => {
    const habits = [habit('h1', 'Gym', 'health')];
    const reflection: DetectedReflection = {
      kind: 'stale-win',
      title: 'Gym was strong then silent',
      question: 'why?',
      context: 'x',
      habitIds: ['h1'],
      dedupeKey: 'stale-win:h1',
    };
    const suggestions = suggestChallenges(habits, [], [reflection], [], NOW, 4);
    expect(suggestions.some((s) => s.kind === 'stale-recovery' && s.habitId === 'h1')).toBe(true);
  });

  it('suggests consolidating a habit with a significant positive correlation', () => {
    const habits = [habit('h1', 'Méditation', 'personal')];
    const corr: CorrelationResult = {
      metricA: 'Méditation', metricB: 'Mood', coefficient: 0.6, strength: 'moderate',
      direction: 'positive', sampleSize: 30, method: 'spearman', pValue: 0.001,
      qValue: 0.01, significant: true, ciLow: 0.2, ciHigh: 0.8, requiredN: 17,
    };
    const suggestions = suggestChallenges(habits, [], [], [corr], NOW, 4);
    expect(suggestions.some((s) => s.kind === 'correlation' && s.habitId === 'h1')).toBe(true);
  });

  it('suggests a floor challenge for a neglected habit', () => {
    const habits = [habit('h1', 'Lecture', 'learning')];
    // Only 3 completed days in the last 14.
    const checkIns = [ci('h1', D(1)), ci('h1', D(2)), ci('h1', D(4))];
    const suggestions = suggestChallenges(habits, checkIns, [], [], NOW, 4);
    expect(suggestions.some((s) => s.kind === 'neglected')).toBe(true);
  });

  it('does not duplicate suggestions for the same habit', () => {
    const habits = [habit('h1', 'Gym', 'health')];
    const reflection: DetectedReflection = {
      kind: 'stale-win', title: 'x', question: 'q', context: 'c', habitIds: ['h1'], dedupeKey: 's:h1',
    };
    const corr: CorrelationResult = {
      metricA: 'Gym', metricB: 'Mood', coefficient: 0.6, strength: 'moderate',
      direction: 'positive', sampleSize: 30, method: 'spearman', pValue: 0.001,
      qValue: 0.01, significant: true, ciLow: 0.2, ciHigh: 0.8, requiredN: 17,
    };
    const suggestions = suggestChallenges(habits, [], [reflection], [corr], NOW, 4);
    const forH1 = suggestions.filter((s) => s.habitId === 'h1');
    expect(forH1.length).toBe(1);
  });

  it('returns no suggestions when there are no habits', () => {
    expect(suggestChallenges([], [], [], [], NOW, 4)).toHaveLength(0);
  });
});
