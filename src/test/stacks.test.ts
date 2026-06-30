// src/test/stacks.test.ts
// Tests for habit stacking (links, cycle detection, propagation, suggestion).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addHabit,
  getHabits,
  toggleCheckIn,
  linkHabitToParent,
  unlinkHabitFromParent,
  getStacks,
  getNextStackSuggestionFor,
  archiveHabit,
  deleteHabit,
  resetStore,
  exportAllData,
} from '../store';

const TODAY = new Date(2026, 5, 27); // 2026-06-27
function todayKey() {
  return '2026-06-27';
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('linkHabitToParent — basic', () => {
  it('sets stackParent on the child', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    const habits = exportAllData().habits;
    expect(habits.find((h) => h.id === b.id)!.stackParent).toBe(a.id);
  });

  it('returns false when habit or parent not found', () => {
    const a = addHabit('Coffee');
    expect(linkHabitToParent(a.id, 'nonexistent')).toBe(false);
    expect(linkHabitToParent('nonexistent', a.id)).toBe(false);
  });

  it('returns false when linking a habit to itself', () => {
    const a = addHabit('Coffee');
    expect(linkHabitToParent(a.id, a.id)).toBe(false);
  });
});

describe('linkHabitToParent — cycle detection', () => {
  it('refuses direct cycle (A->B then B->A)', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    expect(linkHabitToParent(b.id, a.id)).toBe(true);
    expect(linkHabitToParent(a.id, b.id)).toBe(false);
  });

  it('refuses transitive cycle (A->B->C then C->A)', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    expect(linkHabitToParent(b.id, a.id)).toBe(true);
    expect(linkHabitToParent(c.id, b.id)).toBe(true);
    expect(linkHabitToParent(a.id, c.id)).toBe(false);
  });

  it('refuses transitive cycle in other direction (C->B then B->A then A->C)', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    expect(linkHabitToParent(c.id, b.id)).toBe(true);
    expect(linkHabitToParent(b.id, a.id)).toBe(true);
    expect(linkHabitToParent(a.id, c.id)).toBe(false);
  });
});

describe('unlinkHabitFromParent', () => {
  it('clears stackParent', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    unlinkHabitFromParent(b.id);
    const habits = exportAllData().habits;
    expect(habits.find((h) => h.id === b.id)!.stackParent).toBeUndefined();
  });

  it('is a no-op for habits without a parent', () => {
    const a = addHabit('A');
    expect(() => unlinkHabitFromParent(a.id)).not.toThrow();
  });
});

describe('deleteHabit — dangling parent cleanup', () => {
  it('clears stackParent of children when parent is deleted', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    deleteHabit(a.id);
    const habits = exportAllData().habits;
    expect(habits.find((h) => h.id === b.id)!.stackParent).toBeUndefined();
  });

  it('does not affect unrelated habits', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, b.id);
    deleteHabit(a.id);
    const habits = exportAllData().habits;
    expect(habits.find((h) => h.id === c.id)!.stackParent).toBe(b.id);
  });
});

describe('archiveHabit — preserves children', () => {
  it('archived parent does not delete its children', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    archiveHabit(a.id);
    expect(getHabits().map((h) => h.name)).toEqual(['B']); // a is hidden
    const habits = exportAllData().habits;
    expect(habits.find((h) => h.id === b.id)!.stackParent).toBe(a.id); // link kept
  });
});

describe('computeStacks — basic shape', () => {
  it('returns empty list when no children exist', () => {
    addHabit('A');
    addHabit('B');
    expect(getStacks(TODAY)).toEqual([]);
  });

  it('returns one stack when one parent has children', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, a.id);
    const stacks = getStacks(TODAY);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].rootId).toBe(a.id);
    expect(stacks[0].steps.map((s) => s.habitName).sort()).toEqual(['A', 'B', 'C'].sort());
  });

  it('returns multiple stacks for multiple roots', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    const d = addHabit('D');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(d.id, c.id);
    const stacks = getStacks(TODAY);
    expect(stacks).toHaveLength(2);
    const names = stacks.map((s) => s.rootName).sort();
    expect(names).toEqual(['A', 'C']);
  });
});

describe('computeStacks — state propagation', () => {
  it('root undone → all children blocked', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    const stacks = getStacks(TODAY);
    expect(stacks[0].steps.find((s) => s.habitName === 'A')!.state).toBe('pending');
    expect(stacks[0].steps.find((s) => s.habitName === 'B')!.state).toBe('blocked');
  });

  it('root done, child untouched → child pending', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, todayKey());
    const stacks = getStacks(TODAY);
    expect(stacks[0].steps.find((s) => s.habitName === 'A')!.state).toBe('done');
    expect(stacks[0].steps.find((s) => s.habitName === 'B')!.state).toBe('pending');
  });

  it('root done + child done → both done', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, todayKey());
    toggleCheckIn(b.id, todayKey());
    const stacks = getStacks(TODAY);
    expect(stacks[0].doneCount).toBe(2);
    expect(stacks[0].pendingCount).toBe(0);
    expect(stacks[0].blockedCount).toBe(0);
  });

  it('root done + child explicit false → child pending (not blocked)', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, todayKey());
    // toggle creates true, toggle again creates false
    toggleCheckIn(b.id, todayKey());
    toggleCheckIn(b.id, todayKey());
    const stacks = getStacks(TODAY);
    expect(stacks[0].steps.find((s) => s.habitName === 'B')!.state).toBe('pending');
  });

  it('3-level chain: ancestor blocker cascades to all descendants', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, b.id);
    // A is not checked today
    const stacks = getStacks(TODAY);
    expect(stacks[0].steps.find((s) => s.habitName === 'A')!.state).toBe('pending');
    expect(stacks[0].steps.find((s) => s.habitName === 'B')!.state).toBe('blocked');
    expect(stacks[0].steps.find((s) => s.habitName === 'C')!.state).toBe('blocked');
  });

  it('completionPct is computed on active (non-archived) steps only', () => {
    const a = addHabit('A');
    const b = addHabit('B');
    const c = addHabit('C');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, a.id);
    toggleCheckIn(a.id, todayKey());
    toggleCheckIn(b.id, todayKey());
    archiveHabit(c.id); // c archived, excluded from progress
    const stacks = getStacks(TODAY);
    expect(stacks[0].totalCount).toBe(2); // a + b only
    expect(stacks[0].completionPct).toBe(100);
  });
});

describe('getNextStackSuggestionForToday', () => {
  it('returns null when no stacks exist', () => {
    addHabit('A');
    expect(getNextStackSuggestionFor(TODAY)).toBeNull();
  });

  it('returns the first pending step in a stack', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    // No checks today → Coffee (root) is the first pending step.
    // Meditate is blocked until Coffee is done.
    const next = getNextStackSuggestionFor(TODAY);
    expect(next!.habitName).toBe('Coffee');
    expect(next!.rootName).toBe('Coffee');
  });

  it('returns child when parent is done', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, todayKey());
    const next = getNextStackSuggestionFor(TODAY);
    expect(next).not.toBeNull();
    expect(next!.habitName).toBe('Meditate');
  });

  it('skips already-done steps', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    const c = addHabit('Journal');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, a.id);
    toggleCheckIn(a.id, todayKey());
    toggleCheckIn(b.id, todayKey()); // done
    const next = getNextStackSuggestionFor(TODAY);
    expect(next!.habitName).toBe('Journal');
  });

  it('returns null when all done', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, todayKey());
    toggleCheckIn(b.id, todayKey());
    expect(getNextStackSuggestionFor(TODAY)).toBeNull();
  });
});
