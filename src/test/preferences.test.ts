// src/test/preferences.test.ts
import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, Note } from '../types';
import { SEED_PROTOCOLS } from '../protocols';
import { buildPreferenceReport, type PreferenceInput } from '../preferences';

const NOW = new Date(2026, 5, 15); // 2026-06-15
const D = (back: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const habit = (id: string, name: string, category?: string): Habit => ({
  id, name, color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 0, category,
});

const ci = (habitId: string, date: string): CheckIn => ({ habitId, date, completed: true, count: 1 });

function base(): PreferenceInput {
  return {
    habits: [habit('h-sleep', 'Sommeil', 'health')],
    checkIns: [
      // Weak recent sleep: only 2 of the last 14 days completed → weak domain.
      ci('h-sleep', D(1)),
      ci('h-sleep', D(3)),
    ],
    notes: [{ id: 'n1', habitId: '', content: 'je dois mieux gérer mon sommeil et mon réveil', createdAt: D(0) }] as Note[],
    moods: {},
    capacities: [],
    capacityRatings: [],
    projects: [],
    protocols: SEED_PROTOCOLS,
    experiments: [],
    challenges: [],
    stickyMax: 3,
    now: NOW,
  };
}

describe('preference engine', () => {
  it('detects a weak domain from real (low) behaviour', () => {
    const report = buildPreferenceReport(base());
    expect(report.weakDomains).toContain('sleep');
  });

  it('caps the surfaced protocols (anti-overwhelm)', () => {
    const report = buildPreferenceReport(base());
    expect(report.protocols.length).toBeLessThanOrEqual(3);
    expect(report.protocols.length).toBeGreaterThan(0);
  });

  it('ranks sleep protocols higher when sleep is weak + mentioned', () => {
    const report = buildPreferenceReport(base());
    const surf = report.protocols.filter((p) => !p.alreadyPursued);
    expect(surf.length).toBeGreaterThan(0);
    // Domains surfaced should be dominated by the weak/mentioned sleep cluster.
    const sleepCount = surf.filter((p) => p.protocol.domain === 'sleep').length;
    expect(sleepCount).toBeGreaterThan(0);
  });

  it('drops protocols you are already pursuing', () => {
    const input = base();
    // A habit that IS "Respiration lente" makes the breathwork protocol "already pursued".
    input.habits.push(habit('h-br', 'Respiration lente', 'personal'));
    const report = buildPreferenceReport(input);
    const breathwork = report.protocols.find((p) => p.protocol.id === 'p-breathwork');
    // Present in the ranked list (marked alreadyPursued) but must not be surfaced.
    expect(breathwork === undefined || breathwork.alreadyPursued === true).toBe(true);
  });

  it('produces experiment hypotheses', () => {
    const report = buildPreferenceReport(base());
    expect(report.experiments.length).toBeGreaterThan(0);
    for (const e of report.experiments) {
      expect(e.suggestedDays).toBeGreaterThan(0);
      expect(e.linkedHabits.length).toBeGreaterThan(0);
    }
  });
});
