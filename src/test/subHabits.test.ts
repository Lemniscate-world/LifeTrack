/**
 * Sub-habits ("sous-coches", validation douce).
 * - add/rename/delete with caps (6 max, dedupe, trim)
 * - toggleSubCheck: 1 sub → partial (streak survives), all subs → full,
 *   last sub unchecked → day cleared, direct parent check → full
 * - undo restores sub-state, sanitize repairs orphans, streaks count partials
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetStore,
  addHabit,
  addSubHabit,
  renameSubHabit,
  deleteSubHabit,
  toggleSubCheck,
  toggleCheckIn,
  getCheckIn,
  getHabits,
  countPartialDays,
  undoLastToggle,
  restoreUpgradeBackup,
  exportAllData,
} from '../store';
import { computeStreakStats } from '../stats';
import { MAX_SUB_HABITS } from '../types';

const TEST_KEY = 'lifetrack-upgrade-backup-2099-02-02T00-00';

function seedUpgradeBackup(d: unknown): void {
  localStorage.setItem(TEST_KEY, JSON.stringify({ v: 1, d, h: 'test' }));
}

beforeEach(() => {
  resetStore();
  localStorage.removeItem(TEST_KEY);
});

afterEach(() => {
  localStorage.removeItem(TEST_KEY);
});

describe('sub-habit CRUD', () => {
  it('adds, dedupes, trims and caps at 6', () => {
    const h = addHabit('Work');
    expect(addSubHabit(h.id, '  working while depressed · 10 min  ')?.label).toBe('working while depressed · 10 min');
    // Case-insensitive dupe rejected.
    expect(addSubHabit(h.id, 'Working While Depressed · 10 MIN')).toBeNull();
    expect(addSubHabit(h.id, '   ')).toBeNull();
    expect(addSubHabit('nope', 'x')).toBeNull();
    for (let i = 0; i < 10; i++) addSubHabit(h.id, `sub ${i}`);
    expect(getHabits()[0].subHabits).toHaveLength(MAX_SUB_HABITS);
  });

  it('renames and deletes (purging subIds from check-ins)', () => {
    const h = addHabit('Work');
    const a = addSubHabit(h.id, 'depressed mode')!;
    const b = addSubHabit(h.id, 'full mode')!;
    expect(renameSubHabit(h.id, a.id, '  doux  ')).toBe(true);
    expect(getHabits()[0].subHabits?.[0].label).toBe('doux');
    expect(renameSubHabit(h.id, a.id, '  ')).toBe(false);
    toggleSubCheck(h.id, a.id, '2026-09-01');
    toggleSubCheck(h.id, b.id, '2026-09-01');
    // Both subs → full day.
    expect(getCheckIn(h.id, '2026-09-01')?.partial).toBeFalsy();
    expect(deleteSubHabit(h.id, a.id)).toBe(true);
    const ci = getCheckIn(h.id, '2026-09-01')!;
    // One sub left and done → still full, orphan purged.
    expect(ci.subIds).toEqual([b.id]);
    expect(ci.partial).toBeFalsy();
    expect(deleteSubHabit(h.id, 'nope')).toBe(false);
  });
});

describe('toggleSubCheck semantics', () => {
  it('one sub → partial doux, all subs → full, last off → cleared', () => {
    const h = addHabit('Work');
    const a = addSubHabit(h.id, 'depressed')!;
    const b = addSubHabit(h.id, 'normal')!;
    const d = '2026-09-02';
    toggleSubCheck(h.id, a.id, d);
    let ci = getCheckIn(h.id, d)!;
    expect(ci.completed).toBe(true);
    expect(ci.partial).toBe(true);
    expect(ci.subIds).toEqual([a.id]);
    toggleSubCheck(h.id, b.id, d);
    ci = getCheckIn(h.id, d)!;
    expect(ci.completed).toBe(true);
    expect(ci.partial).toBeFalsy();
    toggleSubCheck(h.id, a.id, d);
    ci = getCheckIn(h.id, d)!;
    expect(ci.partial).toBe(true);
    toggleSubCheck(h.id, b.id, d);
    ci = getCheckIn(h.id, d)!;
    expect(ci.completed).toBe(false);
    expect(ci.subIds).toBeUndefined();
    expect(toggleSubCheck(h.id, 'ghost', d)).toBeNull();
  });

  it('single-sub habit: checking the only sub is a full validation', () => {
    const h = addHabit('Work');
    const a = addSubHabit(h.id, 'only')!;
    toggleSubCheck(h.id, a.id, '2026-09-03');
    const ci = getCheckIn(h.id, '2026-09-03')!;
    expect(ci.completed).toBe(true);
    expect(ci.partial).toBeFalsy();
  });

  it('direct parent check always resolves to full', () => {
    const h = addHabit('Work');
    const a = addSubHabit(h.id, 'depressed')!;
    addSubHabit(h.id, 'normal');
    toggleSubCheck(h.id, a.id, '2026-09-04');
    expect(getCheckIn(h.id, '2026-09-04')?.partial).toBe(true);
    toggleCheckIn(h.id, '2026-09-04');
    const ci = getCheckIn(h.id, '2026-09-04')!;
    expect(ci.completed).toBe(false); // toggle flips off…
    expect(ci.partial).toBeFalsy();
    toggleCheckIn(h.id, '2026-09-04');
    const ci2 = getCheckIn(h.id, '2026-09-04')!;
    expect(ci2.completed).toBe(true);
    expect(ci2.partial).toBeFalsy();
    expect(ci2.subIds).toBeUndefined();
  });

  it('partial days keep the streak alive but stay countable', () => {
    const h = addHabit('Work');
    const a = addSubHabit(h.id, 'depressed')!;
    addSubHabit(h.id, 'normal');
    const today = new Date();
    const iso = (off: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - off);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    toggleCheckIn(h.id, iso(2));
    toggleSubCheck(h.id, a.id, iso(1));
    toggleSubCheck(h.id, a.id, iso(0));
    const stats = computeStreakStats(getHabits()[0], exportAllData().checkIns, today);
    expect(stats.current).toBe(3);
    expect(countPartialDays(h.id)).toBe(2);
  });

  it('undo restores the previous sub-state', () => {
    const h = addHabit('Work');
    const a = addSubHabit(h.id, 'depressed')!;
    addSubHabit(h.id, 'normal');
    const d = '2026-09-05';
    toggleSubCheck(h.id, a.id, d);
    expect(getCheckIn(h.id, d)?.partial).toBe(true);
    undoLastToggle();
    const ci = getCheckIn(h.id, d)!;
    expect(ci.completed).toBe(false);
    expect(ci.subIds).toBeUndefined();
  });
});

describe('sub-habit persistence through sanitize', () => {
  it('survives restore, orphans repaired, partial recomputed', () => {
    seedUpgradeBackup({
      habits: [
        {
          id: 'h-1', name: 'Work', color: '', goal: 0,
          createdAt: '2026-09-01T00:00:00.000Z', archived: false, order: 0,
          subHabits: [
            { id: 's-1', label: 'depressed', order: 0 },
            { id: 's-1', label: 'DUPE ID', order: 1 },
            { id: '', label: 'no id', order: 2 },
            { id: 's-2', label: '  normal  ', order: 1 },
          ],
        },
      ],
      checkIns: [
        // Claims full but only 1/2 subs done → recomputed to partial.
        { habitId: 'h-1', date: '2026-09-01', completed: true, subIds: ['s-1', 'ghost'], partial: false },
        // Not completed but carries subs → subs dropped.
        { habitId: 'h-1', date: '2026-09-02', completed: false, subIds: ['s-1'], partial: true },
      ],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    expect(data.habits[0].subHabits?.map((s) => s.id)).toEqual(['s-1', 's-2']);
    expect(data.habits[0].subHabits?.[1].label).toBe('normal');
    const c1 = data.checkIns.find((c) => c.date === '2026-09-01')!;
    expect(c1.subIds).toEqual(['s-1']);
    expect(c1.partial).toBe(true);
    const c2 = data.checkIns.find((c) => c.date === '2026-09-02')!;
    expect(c2.subIds).toBeUndefined();
    expect(c2.partial).toBeUndefined();
  });
});
