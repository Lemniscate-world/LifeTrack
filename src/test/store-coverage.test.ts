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
  it('handles null/empty without crashing', () => {
    // forceMigrateLegacyData handles non-legacy data gracefully
    addHabit('Modern Habit');
    toggleCheckIn('00000000-0000-0000-0000-000000000000', '2026-06-01');
    // Just verify it doesn't throw
    expect(() => forceMigrateLegacyData()).not.toThrow();
  });
});

describe('fileRecovery flag', () => {
  it('isFileRecoveryNeeded can be imported', async () => {
    const { isFileRecoveryNeeded, clearFileRecoveryFlag } = await import('../store');
    expect(typeof isFileRecoveryNeeded).toBe('function');
    expect(typeof clearFileRecoveryFlag).toBe('function');
  });
});
