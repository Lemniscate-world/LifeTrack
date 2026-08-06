import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  flushSave,
  addHabit,
  getHabits,
  getPersonas,
  addPersona,
  updatePersona,
  deletePersona,
  exportAllData,
  mergeImportedData,
} from '../store';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('Personas CRUD', () => {
  it('adds a persona linked to existing habits', () => {
    const h = addHabit('Meditate');
    const p = addPersona('Calm under pressure', '🧘', [h.id]);
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('Calm under pressure');
    expect(p.emoji).toBe('🧘');
    expect(p.habitIds).toEqual([h.id]);
    expect(getPersonas()).toHaveLength(1);
  });

  it('filters out habit ids that do not exist', () => {
    const p = addPersona('Ghost', '👻', ['missing-id']);
    expect(p.habitIds).toEqual([]);
    expect(getPersonas()).toHaveLength(1);
  });

  it('trims the name and defaults the emoji', () => {
    const p = addPersona('  Early riser  ', '', []);
    expect(p.name).toBe('Early riser');
    expect(p.emoji).toBe('⭐');
  });

  it('updates a persona, keeping only valid habits', () => {
    const h1 = addHabit('Read');
    const p = addPersona('Learner', '📚', [h1.id]);
    updatePersona(p.id, { description: 'Read 20 pages daily', habitIds: [h1.id, 'orphan'] });
    const updated = getPersonas().find((x) => x.id === p.id);
    expect(updated?.description).toBe('Read 20 pages daily');
    expect(updated?.habitIds).toEqual([h1.id]);
  });

  it('deletes a persona', () => {
    const p = addPersona('Temp', '⭐', []);
    deletePersona(p.id);
    expect(getPersonas()).toHaveLength(0);
  });

  it('survives an export → import round trip with habit remapping', () => {
    const h = addHabit('Workout');
    addPersona('Athlete', '💪', [h.id]);
    const exported = exportAllData();

    localStorage.clear();
    resetStore();
    flushSave();

    const result = mergeImportedData(exported);
    expect(result.habitsCreated).toBeGreaterThan(0);
    const imported = getPersonas();
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe('Athlete');
    // The persona's habitId must point to a habit that actually exists post-import.
    const importedHabitIds = new Set(getHabits().map((x) => x.id));
    for (const hid of imported[0].habitIds) {
      expect(importedHabitIds.has(hid)).toBe(true);
    }
  });

  it('drops personas whose habits do not exist in the import', () => {
    const raw = {
      habits: [{ id: 'h1', name: 'Meditate' }],
      personas: [
        { id: 'p1', name: 'Calm', emoji: '🧘', habitIds: ['h1'], createdAt: new Date().toISOString() },
        { id: 'p2', name: 'Orphan', emoji: '⭐', habitIds: ['nope'], createdAt: new Date().toISOString() },
      ],
    };
    const result = mergeImportedData(raw);
    expect(result.habitsCreated).toBe(1);
    const imported = getPersonas();
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe('Calm');
  });

  it('persists an accepted reflective persona with zero habits (was dropped on reload)', () => {
    addPersona('Observateur·rice de soi', '🔍', [], 'Vous écrivez ce que vous ressentez.', 'reflective');
    expect(getPersonas()).toHaveLength(1);

    // Simulate an app restart: purge localStorage, reset, then reload from disk.
    const exported = exportAllData();
    localStorage.clear();
    resetStore();
    flushSave();
    const result = mergeImportedData(exported);
    expect(result.habitsCreated).toBe(0);
    const after = getPersonas();
    expect(after).toHaveLength(1);
    expect(after[0].kind).toBe('reflective');
  });

  it('never loses existing data when importing legacy data without a personas field', () => {
    const h = addHabit('Sleep');
    const legacy = {
      habits: [{ id: 'old-1', name: 'Sleep' }],
      checkIns: [{ habitId: 'old-1', date: '2026-01-01', completed: true }],
    }; // pre-v0.5.0 shape: no `personas`, no `challenges`
    const result = mergeImportedData(legacy);
    expect(result.habitsMapped).toBeGreaterThanOrEqual(1);
    expect(getHabits().some((x) => x.id === h.id)).toBe(true);
    expect(getPersonas()).toHaveLength(0);
  });
});