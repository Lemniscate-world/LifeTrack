// src/test/reorder.test.ts
// Unit tests for the reorderHabits() store function.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addHabit,
  getHabits,
  archiveHabit,
  reorderHabits,
  flushSave,
  resetStore,
  exportAllData,
} from '../store';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('reorderHabits — basic moves', () => {
  it('moves the top habit to the bottom', () => {
    addHabit('A'); // order 0
    addHabit('B'); // order 1
    addHabit('C'); // order 2
    expect(getHabits().map((h) => h.name)).toEqual(['A', 'B', 'C']);

    // @hello-pangea/dnd convention: drop at the bottom of a 3-item list
    // is destination.index = 3 (becomes index 2 after removing the source).
    reorderHabits(0, 2);

    expect(getHabits().map((h) => h.name)).toEqual(['B', 'C', 'A']);
    // Orders reassigned sequentially
    const orders = getHabits().map((h) => h.order);
    expect(orders).toEqual([0, 1, 2]);
  });

  it('moves the bottom habit to the top', () => {
    addHabit('A');
    addHabit('B');
    addHabit('C');
    reorderHabits(2, 0);
    expect(getHabits().map((h) => h.name)).toEqual(['C', 'A', 'B']);
  });

  it('moves a middle habit one slot', () => {
    addHabit('A');
    addHabit('B');
    addHabit('C');
    addHabit('D');
    // Move B (index 1) down one — destination index in dnd convention is 2
    reorderHabits(1, 2);
    expect(getHabits().map((h) => h.name)).toEqual(['A', 'C', 'B', 'D']);
  });

  it('same-position drop is a no-op', () => {
    addHabit('A');
    addHabit('B');
    reorderHabits(1, 1);
    expect(getHabits().map((h) => h.name)).toEqual(['A', 'B']);
  });
});

describe('reorderHabits — guards', () => {
  it('ignores negative source index without throwing', () => {
    addHabit('A');
    expect(() => reorderHabits(-1, 0)).not.toThrow();
    expect(getHabits().map((h) => h.name)).toEqual(['A']);
  });

  it('ignores out-of-range source index without throwing', () => {
    addHabit('A');
    addHabit('B');
    expect(() => reorderHabits(99, 0)).not.toThrow();
    expect(getHabits().map((h) => h.name)).toEqual(['A', 'B']);
  });

  it('clamps destination index to the valid range (huge dest)', () => {
    addHabit('A');
    addHabit('B');
    reorderHabits(0, 999);
    expect(getHabits().map((h) => h.name)).toEqual(['B', 'A']);
  });

  it('clamps destination index to the valid range (negative dest)', () => {
    addHabit('A');
    addHabit('B');
    addHabit('C');
    reorderHabits(2, -5); // clamped to 0
    expect(getHabits().map((h) => h.name)).toEqual(['C', 'A', 'B']);
  });
});

describe('reorderHabits — archived habits', () => {
  it('does NOT include archived habits in the reorder operation', () => {
    const a = addHabit('A');
    addHabit('B');
    addHabit('C');
    addHabit('D');
    archiveHabit(a.id);

    // Visible: ['B', 'C', 'D']
    reorderHabits(2, 0); // move D to top
    expect(getHabits().map((h) => h.name)).toEqual(['D', 'B', 'C']);
  });

  it('bumps archived habit order after reorder (highest slot)', () => {
    addHabit('A');
    const b = addHabit('B');
    addHabit('C');
    archiveHabit(b.id); // b.order was 1, now archived

    reorderHabits(0, 1); // move A down (visible: A, C)
    // getHabits() filters archived → only ['C', 'A']
    expect(getHabits().map((h) => h.name)).toEqual(['C', 'A']);
    // exportAllData() returns everything — B should have the highest order (2)
    const all = exportAllData().habits;
    const ordered = [...all].sort((x, y) => x.order - y.order);
    expect(ordered.map((h) => h.name)).toEqual(['C', 'A', 'B']);
    expect(ordered.map((h) => h.order)).toEqual([0, 1, 2]);
  });
});

describe('reorderHabits — order field hygiene', () => {
  it('assigns orders contiguously after multiple reorders (no holes)', () => {
    addHabit('A');
    addHabit('B');
    addHabit('C');
    addHabit('D');

    reorderHabits(0, 3);
    reorderHabits(2, 0);
    reorderHabits(1, 3);

    const orders = getHabits().map((h) => h.order);
    expect(orders).toEqual([0, 1, 2, 3]);
    expect(new Set(orders).size).toBe(4); // all distinct
  });

  it('persists new order across a save and reload cycle', () => {
    addHabit('A');
    addHabit('B');
    addHabit('C');
    reorderHabits(2, 0);
    expect(getHabits().map((h) => h.name)).toEqual(['C', 'A', 'B']);

    flushSave();
    resetStore();
    expect(getHabits().map((h) => h.name)).toEqual(['C', 'A', 'B']);
  });

  it('preserves the new order when a habit is added afterwards', () => {
    addHabit('A');
    addHabit('B');
    addHabit('C');
    reorderHabits(0, 2);
    expect(getHabits().map((h) => h.name)).toEqual(['B', 'C', 'A']);

    addHabit('D');
    expect(getHabits().map((h) => h.name)).toEqual(['B', 'C', 'A', 'D']);
  });

  it('preserves the order when a habit is archived afterwards', () => {
    const a = addHabit('A');
    addHabit('B');
    addHabit('C');
    reorderHabits(0, 2); // → B, C, A
    archiveHabit(a.id);
    expect(getHabits().map((h) => h.name)).toEqual(['B', 'C']);
  });
});