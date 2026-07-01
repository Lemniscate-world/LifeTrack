/**
 * Tests for previously untested store functions.
 * Coverage target: store.ts from 84% → 90%+
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addHabit,
  toggleCheckIn,
  getLastSaved,
  flushSave,
  resetStore,
  getStorageStatus,
  forceMigrateLegacyData,
  recomputeHabitRecords,
  toggleChaosTrigger,
  exportAllData,
  getCheckInsForHabit,
  getHabits,
} from '../store';

beforeEach(() => {
  resetStore();
});

describe('getLastSaved', () => {
  it('returns 0 when no save has happened', () => {
    expect(getLastSaved()).toBe(0);
  });

  it('returns timestamp after save', () => {
    addHabit('Test');
    flushSave();
    expect(getLastSaved()).toBeGreaterThan(0);
  });
});

describe('getStorageStatus', () => {
  it('returns a valid status string', () => {
    const status = getStorageStatus();
    expect(['ok', 'warning', 'error']).toContain(status);
  });
});

describe('forceMigrateLegacyData', () => {
  it('handles empty store gracefully', () => {
    expect(() => forceMigrateLegacyData()).not.toThrow();
  });

  it('returns boolean', () => {
    const result = forceMigrateLegacyData();
    expect(typeof result).toBe('boolean');
  });
});

describe('recomputeHabitRecords', () => {
  it('handles non-existent habit id', () => {
    expect(() => recomputeHabitRecords('nonexistent')).not.toThrow();
  });

  it('recomputes records for existing habit with check-ins', () => {
    addHabit('Test Habit');
    const habits = getHabits();
    const habitId = habits[0].id;
    toggleCheckIn(habitId, '2026-06-15');
    toggleCheckIn(habitId, '2026-06-16');
    recomputeHabitRecords(habitId);
    const updated = getHabits().find((h) => h.id === habitId);
    expect(updated?.totalCompleted).toBe(2);
    expect(updated?.bestStreak).toBe(2);
  });
});

describe('toggleChaosTrigger', () => {
  it('does not throw for non-existent dimension', () => {
    expect(() => toggleChaosTrigger('nonexistent', 'trigger1')).not.toThrow();
  });
});

describe('exportAllData', () => {
  it('returns data with correct structure', () => {
    addHabit('Any');
    const exported = exportAllData();
    expect(exported.habits.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(exported.checkIns)).toBe(true);
    expect(Array.isArray(exported.notes)).toBe(true);
    expect(Array.isArray(exported.chaosDimensions)).toBe(true);
  });

  it('includes check-ins', () => {
    addHabit('Test');
    const habits = getHabits();
    toggleCheckIn(habits[0].id, '2026-07-01');
    const exported = exportAllData();
    expect(exported.checkIns.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getCheckInsForHabit', () => {
  it('returns empty array for non-existent habit', () => {
    const result = getCheckInsForHabit('nonexistent');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('returns check-ins for existing habit', () => {
    addHabit('Test');
    const habits = getHabits();
    toggleCheckIn(habits[0].id, '2026-07-01');
    const result = getCheckInsForHabit(habits[0].id);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].date).toBe('2026-07-01');
  });
});
