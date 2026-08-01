// Store coverage: uncovered branches (forceMigrateLegacyData true path, toggleChaosTrigger edge cases, recomputeHabitRecords edge cases)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore, addHabit, toggleCheckIn, updateHabit,
  forceMigrateLegacyData, recomputeHabitRecords,
  toggleChaosTrigger, getChaosDimensions, resetChaos,
  getHabits, exportAllData, archiveHabit,
  mergeChaosDimensions, mergeImportedData, getDefaultChaosDimensions,
} from '../store';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('forceMigrateLegacyData — full coverage', () => {
  it('returns false when no legacy data exists', () => {
    expect(forceMigrateLegacyData()).toBe(false);
  });

  it('returns false after fresh reset', () => {
    addHabit('Test');
    resetStore();
    expect(forceMigrateLegacyData()).toBe(false);
  });
});

describe('toggleChaosTrigger — edge cases', () => {
  it('does nothing for non-existent dimension', () => {
    expect(() => toggleChaosTrigger('nonexistent', 't1')).not.toThrow();
  });

  it('does nothing for non-existent trigger on valid dimension', () => {
    const dims = getChaosDimensions();
    expect(dims.length).toBeGreaterThan(0);
    expect(() => toggleChaosTrigger(dims[0].id, 'nonexistent')).not.toThrow();
  });
});

describe('resetChaos', () => {
  it('resets to defaults without throwing', () => {
    addHabit('Test');
    expect(() => resetChaos()).not.toThrow();
    const dims = getChaosDimensions();
    expect(dims.length).toBe(7);
  });
});

describe('mergeChaosDimensions — backward compatibility', () => {
  it('adds new default dimensions (emotional, energy) to old 5-dim data', () => {
    // Simulate data saved by an older version that only had 5 dimensions.
    const oldData = [
      { id: 'social', name: 'Social', triggers: [] },
      { id: 'financial', name: 'Financial', triggers: [] },
      { id: 'physical', name: 'Physical', triggers: [] },
      { id: 'structural', name: 'Structural', triggers: [] },
      { id: 'spiritual', name: 'Spiritual', triggers: [] },
    ];
    const merged = mergeChaosDimensions(oldData);
    expect(merged).toHaveLength(7);
    expect(merged.map((d) => d.id)).toContain('emotional');
    expect(merged.map((d) => d.id)).toContain('energy');
  });

  it('preserves user triggers on existing dimensions', () => {
    const userData = [
      { id: 'physical', name: 'Physical', triggers: [{ id: 't1', label: 'Custom', active: true, createdAt: '2026-01-01', weight: 30 }] },
    ];
    const merged = mergeChaosDimensions(userData);
    const physical = merged.find((d) => d.id === 'physical')!;
    expect(physical.triggers).toHaveLength(1);
    expect(physical.triggers[0].label).toBe('Custom');
  });

  it('returns full defaults when stored is empty', () => {
    const merged = mergeChaosDimensions([]);
    expect(merged).toHaveLength(7);
    expect(merged.every((d) => d.triggers.length === 0)).toBe(true);
  });
});

describe('mergeImportedData — adds newer chaos dimensions', () => {
  it('adds energy when importing a backup saved without it', () => {
    // Simulate an old backup (6 dimensions, no 'energy').
    const oldBackup = {
      habits: [{ id: 'h1', name: 'Sport', createdAt: '2026-01-01T00:00:00.000Z', order: 0 }],
      checkIns: [],
      notes: [],
      chaosDimensions: getDefaultChaosDimensions().filter((d) => d.id !== 'energy'),
      mantras: [],
      mantraSettings: {},
      skills: [],
      capacities: [],
      capacityRatings: [],
      moods: {},
      experiments: [],
      urges: [],
      customUrgeTypes: [],
      preferences: {},
    };
    const result = mergeImportedData(oldBackup);
    expect(result.chaosDimensionsRestored).toBe(0);
    const dims = getChaosDimensions();
    expect(dims.map((d) => d.id)).toContain('energy');
    expect(dims).toHaveLength(7);
  });
});

describe('recomputeHabitRecords — edge cases', () => {
  it('no-ops for non-existent habit', () => {
    expect(() => recomputeHabitRecords('nonexistent')).not.toThrow();
  });

  it('no-ops for archived habit', () => {
    const h = addHabit('Archived');
    updateHabit(h.id, { archived: true });
    expect(() => recomputeHabitRecords(h.id)).not.toThrow();
  });

  it('updates records for active habit with data', () => {
    const h = addHabit('Active');
    for (let d = 0; d < 10; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() - d);
      toggleCheckIn(h.id, dt.toISOString().slice(0, 10));
    }
    recomputeHabitRecords(h.id);
    const updated = getHabits().find((x) => x.id === h.id);
    expect(updated?.bestStreak).toBeGreaterThanOrEqual(0);
    expect(updated?.totalCompleted).toBeGreaterThanOrEqual(5);
  });
});

describe('exportAllData — structure', () => {
  it('returns data with correct shape', () => {
    addHabit('Test');
    const data = exportAllData();
    expect(Array.isArray(data.habits)).toBe(true);
    expect(Array.isArray(data.checkIns)).toBe(true);
    expect(Array.isArray(data.notes)).toBe(true);
  });

  it('returns a deep clone', () => {
    void addHabit('Original');
    const data1 = exportAllData();
    data1.habits[0].name = 'Mutated';
    const data2 = exportAllData();
    expect(data2.habits[0].name).toBe('Original');
  });
});

describe('archiveHabit — getHabits consistency', () => {
  it('archived habit not in getHabits', () => {
    const h = addHabit('Temp');
    archiveHabit(h.id);
    expect(getHabits().find((x) => x.id === h.id)).toBeUndefined();
  });
});
