import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  flushSave,
  addLever,
  getLevers,
  deleteLever,
  addHabit,
  getHabits,
  updateHabit,
  exportAllData,
  mergeImportedData,
} from '../store';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('Levers CRUD', () => {
  it('adds a lever with content only', () => {
    const l = addLever('Magnésium B2 le matin');
    expect(l.id).toBeTruthy();
    expect(l.content).toBe('Magnésium B2 le matin');
    expect(l.effect).toBeUndefined();
    expect(l.notes).toBeUndefined();
    expect(l.createdAt).toBeTruthy();
    expect(getLevers()).toHaveLength(1);
  });

  it('stores effect and notes when provided', () => {
    const l = addLever('  Matin calme  ', '  +15 d\'énergie  ', '  avant 10h  ');
    expect(l.content).toBe('Matin calme');
    expect(l.effect).toBe('+15 d\'énergie');
    expect(l.notes).toBe('avant 10h');
  });

  it('rejects an empty content', () => {
    expect(() => addLever('   ')).toThrow();
    expect(getLevers()).toHaveLength(0);
  });

  it('deletes a lever by id', () => {
    const l = addLever('Pause 5 min');
    expect(getLevers()).toHaveLength(1);
    deleteLever(l.id);
    expect(getLevers()).toHaveLength(0);
  });

  it('returns all levers regardless of insertion order', () => {
    const a = addLever('A');
    const b = addLever('B');
    const ids = getLevers().map((l) => l.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toHaveLength(2);
  });
});

describe('Levers persistence', () => {
  it('persists levers through a save/load cycle', () => {
    const l = addLever('Protéines au petit-déj', 'Moins de fringales', 'Test');
    flushSave;
    localStorage.clear();
    resetStore();
    expect(getLevers()).toHaveLength(0);
    // Re-seed by importing the previously exported data.
    mergeImportedData({ levers: [l] });
    const restored = getLevers();
    expect(restored).toHaveLength(1);
    expect(restored[0].content).toBe('Protéines au petit-déj');
  });

  it('exports levers in exportAllData', () => {
    addLever('Lit à heure fixe');
    const all = exportAllData();
    expect(all.levers).toHaveLength(1);
    expect(all.levers[0].content).toBe('Lit à heure fixe');
  });
});

describe('Lever import', () => {
  it('imports levers from raw data without id remapping', () => {
    const raw = {
      levers: [
        { id: 'l1', content: 'Magnésium B2', effect: '+15 d\'énergie', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const result = mergeImportedData(raw as never);
    expect(result.leversImported).toBe(1);
    const all = exportAllData();
    expect(all.levers).toHaveLength(1);
    expect(all.levers[0].content).toBe('Magnésium B2');
    expect(all.levers[0].effect).toBe('+15 d\'énergie');
  });

  it('skips malformed levers on import', () => {
    const raw = {
      levers: [
        { id: 'l1', content: 'OK', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'l2', createdAt: '2026-01-01T00:00:00.000Z' }, // missing content
        'garbage',
      ],
    };
    const result = mergeImportedData(raw as never);
    const all = exportAllData();
    expect(all.levers).toHaveLength(1);
    expect(result.leversImported).toBe(1);
  });

  it('does not duplicate levers with an existing id', () => {
    const l = addLever('Breathe');
    const raw = { levers: [l] };
    const result = mergeImportedData(raw as never);
    expect(getLevers()).toHaveLength(1);
    expect(result.leversImported).toBe(0);
  });
});

describe('Lever conversion helper flow', () => {
  it('uses lever content to create a habit and attaches the effect as why', () => {
    const l = addLever('Magnesium B2', '+15 d\'énergie', 'le matin');
    // Mirror what handleConvertLever does in the UI.
    const why: string[] = [];
    why.push(`Le facteur : ${l.content}`);
    why.push(`Effet attendu : ${l.effect}`);
    const habit = addHabit(l.content);
    updateHabit(habit.id, { why });
    deleteLever(l.id);

    const created = getHabits().find((h) => h.name === l.content);
    expect(created).toBeTruthy();
    expect(created!.why).toEqual([
      'Le facteur : Magnesium B2',
      'Effet attendu : +15 d\'énergie',
    ]);
    expect(getLevers()).toHaveLength(0);
  });
});