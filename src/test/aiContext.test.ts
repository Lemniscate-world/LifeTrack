/**
 * Tests for the AI Context Builder.
 * Verifies that the report aggregates EVERY data domain so the local AI
 * has access to all the user's data and notes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAiContext } from '../aiContext';
import {
  addHabit,
  toggleCheckIn,
  addCheckInNote,
  setMood,
  resetStore,
  exportAllData,
  addSkill,
  addCapacity,
  logCapacityObservation,
  addExperiment,
  addNote,
} from '../store';
import { addUrgeEntry, addCustomUrgeType } from '../urgeSurfing';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('buildAiContext — coverage of all data domains', () => {
  it('includes every habit with completion stats and all notes', () => {
    const h = addHabit('Méditation', { chaosDimension: 'physical', chaosImpact: 40, chaosThresholdDays: 2 });
    toggleCheckIn(h.id, isoDaysAgo(1));
    toggleCheckIn(h.id, isoDaysAgo(2));
    addCheckInNote(h.id, isoDaysAgo(2), 'calme');
    addCheckInNote(h.id, isoDaysAgo(2), 'esprit clair');
    addNote('Ancienne note importante');

    const report = buildAiContext(exportAllData());
    expect(report).toContain('Méditation');
    expect(report).toContain('chaos:physical');
    expect(report).toContain('calme');
    expect(report).toContain('esprit clair');
    expect(report).toContain('Ancienne note importante');
    expect(report).toMatch(/\d+\/\d+ done/);
  });

  it('includes moods, skills, capacities and capacity trends', () => {
    setMood(isoDaysAgo(1), 'great');
    setMood(isoDaysAgo(2), 'tired');
    const skill = addSkill('Analyse personnelle', 'Comprendre mes patterns', '🔍', '#FEF3C7');
    const cap = addCapacity(skill.id, 'Clarté mentale', 'Mesure de clarté', '1-10', 3, 8);
    if (cap) logCapacityObservation(cap.id, { date: isoDaysAgo(1), rating: 6, note: 'bonne journée' });

    const report = buildAiContext(exportAllData());
    expect(report).toContain('MOODS');
    expect(report).toContain('Great');
    expect(report).toContain('Tired');
    expect(report).toContain('Analyse personnelle');
    expect(report).toContain('Clarté mentale');
    expect(report).toContain('bonne journée');
  });

  it('includes experiments, urges, chaos pressure and custom mantras', () => {
    addExperiment({
      title: 'Méditation matinale',
      hypothesis: 'Si je médite 10min le matin, mon focus s’améliore',
      startDate: isoDaysAgo(10),
      endDate: '',
      linkedHabits: [],
      linkedMetrics: [],
    });
    addCustomUrgeType('Craving', '🍫', '#DC2626');
    addUrgeEntry({ type: 'Craving', intensity: 7, startTime: new Date().toISOString(), outcome: 'surfed', trigger: 'stress au travail' });
    addHabit('Sport', { chaosDimension: 'energy', chaosImpact: 50, chaosThresholdDays: 2 });

    const report = buildAiContext(exportAllData());
    expect(report).toContain('EXPERIMENTS');
    expect(report).toContain('Méditation matinale');
    expect(report).toContain('URGES');
    expect(report).toContain('surfed');
    expect(report).toContain('CHAOS PRESSURE');
    expect(report).toContain('Energy');
  });

  it('reports zero / empty sections gracefully for empty stores', () => {
    const report = buildAiContext(exportAllData());
    expect(report).toContain('HABITS (0 active)');
    expect(report).toContain('(no moods logged)');
    expect(report).toContain('(no capacity ratings)');
    expect(report).toContain('(no experiments)');
    expect(report).toContain('(no urges logged)');
    expect(report).toContain('(none)');
  });

  it('includes overview counts', () => {
    const h = addHabit('Lecture');
    toggleCheckIn(h.id, isoDaysAgo(1));
    const report = buildAiContext(exportAllData());
    expect(report).toContain('## OVERVIEW');
    expect(report).toMatch(/1 habits \(1 active\)/);
    expect(report).toMatch(/1 check-ins \(1 completed\)/);
  });

  it('survives corrupted data (no throw)', () => {
    const data = exportAllData();
    // @ts-expect-error — deliberately corrupt
    data.checkIns = 'garbage';
    // @ts-expect-error — deliberately corrupt
    data.moods = null;
    expect(() => buildAiContext(data)).not.toThrow();
  });
});
