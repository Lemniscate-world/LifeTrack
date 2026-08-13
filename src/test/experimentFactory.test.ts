// src/test/experimentFactory.test.ts
import { describe, it, expect } from 'vitest';
import type { CorrelationResult, Habit } from '../types';
import { correlationToExperiment, weaknessToExperiment } from '../experimentFactory';

const habits: Habit[] = [
  { id: 'h1', name: 'Méditation', color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 0 },
  { id: 'h2', name: 'Sommeil', color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 1 },
];

function corr(over: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    metricA: 'Méditation',
    metricB: 'Mood',
    coefficient: 0.55,
    strength: 'moderate',
    direction: 'positive',
    sampleSize: 30,
    method: 'spearman',
    pValue: 0.001,
    qValue: 0.01,
    significant: true,
    ciLow: 0.2,
    ciHigh: 0.8,
    requiredN: 17,
    ...over,
  };
}

describe('experimentFactory', () => {
  it('converts a habit↔mood correlation into a testable hypothesis', () => {
    const draft = correlationToExperiment(corr(), habits, new Date(2026, 1, 1));
    expect(draft).not.toBeNull();
    expect(draft!.linkedHabits).toEqual(['h1']);
    expect(draft!.linkedMetrics).toEqual(['mood']);
    expect(draft!.hypothesis).toContain('Méditation');
    expect(draft!.suggestedDays).toBe(17); // uses requiredN, not a lazy default
    expect(draft!.startDate).toBe('2026-02-01');
  });

  it('detects the habit on either side of the correlation', () => {
    const draft = correlationToExperiment(corr({ metricA: 'Mood', metricB: 'Sommeil' }), habits, new Date(2026, 1, 1));
    expect(draft!.linkedHabits).toEqual(['h2']);
  });

  it('returns null when neither side is a known habit', () => {
    expect(correlationToExperiment(corr({ metricA: 'Foo', metricB: 'Bar' }), habits, new Date())).toBeNull();
  });

  it('builds a low-bar micro-experiment from a weakness', () => {
    const draft = weaknessToExperiment(habits[1], 28.5, new Date(2026, 1, 1));
    expect(draft.title).toContain('Sommeil');
    expect(draft.linkedHabits).toEqual(['h2']);
    expect(draft.suggestedDays).toBe(21);
  });
});
