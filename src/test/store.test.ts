import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  addHabit,
  updateHabit,
  archiveHabit,
  unarchiveHabit,
  deleteHabit,
  getHabits,
  toggleCheckIn,
  getMonthCheckIns,
  getCompletionForMonth,
  addNote,
  deleteNote,
  getNotes,
} from '../store';

// Reset store state between tests for full isolation
beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('Habits CRUD', () => {
  it('adds a habit with a name and auto-assigned color', () => {
    const habit = addHabit('Exercise');
    expect(habit.name).toBe('Exercise');
    expect(habit.color).toBeTruthy();
    expect(habit.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(habit.archived).toBe(false);
    expect(habit.order).toBeGreaterThanOrEqual(0);
  });

  it('lists only non-archived habits sorted by order', () => {
    addHabit('First');
    addHabit('Second');
    const habits = getHabits();
    expect(habits).toHaveLength(2);
    expect(habits[0].name).toBe('First');
    expect(habits[1].name).toBe('Second');
  });

  it('updates a habit name', () => {
    const habit = addHabit('Old Name');
    updateHabit(habit.id, { name: 'New Name' });
    const habits = getHabits();
    expect(habits[0].name).toBe('New Name');
  });

  it('archives a habit so it no longer appears in getHabits', () => {
    const habit = addHabit('To Archive');
    archiveHabit(habit.id);
    expect(getHabits()).toHaveLength(0);
  });

  it('unarchives a habit', () => {
    const habit = addHabit('To Unarchive');
    archiveHabit(habit.id);
    unarchiveHabit(habit.id);
    expect(getHabits()).toHaveLength(1);
  });

  it('deletes a habit and its check-ins and notes', () => {
    const habit = addHabit('To Delete');
    toggleCheckIn(habit.id, '2026-06-01');
    addNote('some note');
    deleteHabit(habit.id);
    expect(getHabits()).toHaveLength(0);
    // Check-ins are cleaned up
    const checks = getMonthCheckIns(habit.id, 2026, 5); // June = month 5 (0-indexed)
    expect(checks.size).toBe(0);
  });
});

describe('Check-ins', () => {
  it('toggles a check-in on and off', () => {
    const habit = addHabit('Read');
    const ci1 = toggleCheckIn(habit.id, '2026-06-15');
    expect(ci1.completed).toBe(true);

    const ci2 = toggleCheckIn(habit.id, '2026-06-15');
    expect(ci2.completed).toBe(false);
  });

  it('getMonthCheckIns returns only days for the given month', () => {
    const habit = addHabit('Meditate');
    toggleCheckIn(habit.id, '2026-06-05');
    toggleCheckIn(habit.id, '2026-06-20');
    toggleCheckIn(habit.id, '2026-07-01'); // Different month

    const juneChecks = getMonthCheckIns(habit.id, 2026, 5); // 5 = June
    expect(juneChecks.get(5)).toBe(true);
    expect(juneChecks.get(20)).toBe(true);
    expect(juneChecks.get(1)).toBeUndefined(); // July 1 not in June
  });

  it('getCompletionForMonth returns percentage completed vs goal', () => {
    const habit = addHabit('Water');
    updateHabit(habit.id, { goal: 10 });
    // June has 30 days, check in 5 days
    for (let d = 1; d <= 5; d++) {
      toggleCheckIn(habit.id, `2026-06-${String(d).padStart(2, '0')}`);
    }
    const pct = getCompletionForMonth(habit.id, 2026, 5);
    // 5/10 = 50%
    expect(pct).toBe(50);
  });
});

describe('Notes CRUD', () => {
  it('adds and retrieves notes', () => {
    addNote('My first note');
    const notes = getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('My first note');
  });

  it('deletes a note', () => {
    const note = addNote('To delete');
    deleteNote(note.id);
    expect(getNotes()).toHaveLength(0);
  });

  it('sorts notes by most recent first', async () => {
    addNote('Old note');
    // Ensure distinct timestamps for reliable sort order
    await new Promise((r) => setTimeout(r, 5));
    addNote('New note');
    const notes = getNotes();
    expect(notes[0].content).toBe('New note');
    expect(notes[1].content).toBe('Old note');
  });
});
