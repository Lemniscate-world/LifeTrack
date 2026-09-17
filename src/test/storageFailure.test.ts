/**
 * Storage failure surfacing: when localStorage writes fail (quota), the
 * failure must PURGE + RETRY, then SHOUT (queryable error for the banner) —
 * never silently eat the user's checks (Sept 8 emotional-checks incident:
 * on disk via files, gone from localStorage).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resetStore,
  addHabit,
  getLastStorageError,
  clearStorageError,
  forceSaveNow,
  exportAllData,
} from '../store';

const QUOTA_KEYS = ['lifetrack-data', 'lifetrack-data-backup', 'lifetrack-raw'];

let setItemSpy: ReturnType<typeof vi.spyOn> | null = null;

function simulateQuotaFull(): void {
  const target = window.localStorage;
  const orig = target.setItem.bind(target);
  setItemSpy = vi.spyOn(target, 'setItem').mockImplementation((key: string, value: string) => {
    if (QUOTA_KEYS.some((k) => key.startsWith(k))) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    return orig(key, value);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  clearStorageError();
});

afterEach(() => {
  setItemSpy?.mockRestore();
  setItemSpy = null;
  vi.useRealTimers();
  localStorage.clear();
});

describe('quota failure surfacing', () => {
  it('notes a queryable error when every write fails', () => {
    simulateQuotaFull();
    addHabit('Gym');
    vi.advanceTimersByTime(500);
    const err = getLastStorageError();
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/stockage plein|impossible/i);
  });

  it('recovers on retry once space is available (purge + rewrite)', () => {
    simulateQuotaFull();
    addHabit('Gym');
    vi.advanceTimersByTime(500);
    expect(getLastStorageError()).not.toBeNull();
    // Space frees up (user cleared browser data / purge made room).
    setItemSpy?.mockRestore();
    setItemSpy = null;
    clearStorageError();
    forceSaveNow();
    expect(getLastStorageError()).toBeNull();
    // And the habit that was "lost" is actually persisted.
    const raw = localStorage.getItem('lifetrack-data');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).d.habits.map((h: { name: string }) => h.name)).toContain('Gym');
  });

  it('no error is noted when storage works', () => {
    addHabit('Gym');
    vi.advanceTimersByTime(500);
    expect(getLastStorageError()).toBeNull();
    expect(exportAllData().habits.map((h) => h.name)).toContain('Gym');
  });
});
