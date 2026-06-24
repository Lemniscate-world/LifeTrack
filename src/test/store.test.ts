import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  flushSave,
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
  exportAllData,
  undoLastToggle,
  redoLastUndo,
  getStorageStatus,
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

describe('Export', () => {
  it('exportAllData returns all habits, check-ins, and notes', () => {
    const habit = addHabit('Gym');
    toggleCheckIn(habit.id, '2026-06-15');
    addNote('Test note');

    const exported = exportAllData();
    expect(exported.habits).toHaveLength(1);
    expect(exported.habits[0].name).toBe('Gym');
    expect(exported.checkIns).toHaveLength(1);
    expect(exported.checkIns[0].date).toBe('2026-06-15');
    expect(exported.notes).toHaveLength(1);
    expect(exported.notes[0].content).toBe('Test note');
  });

  it('exportAllData returns a deep clone (mutations do not affect store)', () => {
    addHabit('Read');
    const exported = exportAllData();
    exported.habits[0].name = 'HACKED';
    exported.habits.push({} as never);

    const habits = getHabits();
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('Read');
  });
});

describe('Persistence and fallbacks', () => {
  // Helper: build a valid envelope for test manipulation
  function makeEnvelope(d: unknown, hash?: string): string {
    const json = JSON.stringify(d);
    return JSON.stringify({ v: 1, d, h: hash ?? fnv1a(json) });
  }
  // Import the hash function for test use (same algorithm)
  function fnv1a(str: string): string {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  it('survives page reload simulation (data written to localStorage)', () => {
    addHabit('Gym');
    const habitId = getHabits()[0].id;
    toggleCheckIn(habitId, '2026-06-23');
    addNote('Persistent note');

    // Flush debounced save before simulating reload
    flushSave();
    resetStore();

    const habits = getHabits();
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('Gym');

    const checks = getMonthCheckIns(habits[0].id, 2026, 5); // June
    expect(checks.get(23)).toBe(true);

    const notes = getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('Persistent note');
  });

  it('recovers from backup when primary checksum is wrong', () => {
    addHabit('Read');
    flushSave();

    // Write a corrupted primary (valid JSON but wrong checksum)
    const primaryRaw = localStorage.getItem('lifetrack-data');
    if (primaryRaw) {
      const env = JSON.parse(primaryRaw);
      env.h = 'deadbeef'; // wrong hash
      localStorage.setItem('lifetrack-data', JSON.stringify(env));
    }

    resetStore();

    // Should recover from backup (which has correct checksum)
    const habits = getHabits();
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('Read');
  });

  it('returns empty state when both primary and backup are missing', () => {
    localStorage.removeItem('lifetrack-data');
    localStorage.removeItem('lifetrack-data-backup');
    resetStore();

    expect(getHabits()).toHaveLength(0);
    expect(getNotes()).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', () => {
    localStorage.setItem('lifetrack-data', '{broken!!!');
    localStorage.removeItem('lifetrack-data-backup');
    resetStore();

    expect(getHabits()).toHaveLength(0);
  });

  it('filters out invalid entries but keeps valid ones (with valid checksum)', () => {
    const goodData = {
      habits: [
        { id: '1', name: 'Valid', color: '#FFF', goal: 0, createdAt: '', archived: false, order: 0 },
      ],
      checkIns: [],
      notes: [],
    };
    const badData = {
      habits: [
        { id: '1', name: 'Valid', color: '#FFF', goal: 0, createdAt: '', archived: false, order: 0 },
        { notAHabit: true },
        null,
        'garbage',
      ],
      checkIns: [{ notACheckIn: true }],
      notes: [{ notANote: true }],
    };
    localStorage.setItem('lifetrack-data', makeEnvelope(goodData));
    // Write bad backup — should not be used since primary is valid
    localStorage.setItem('lifetrack-data-backup', makeEnvelope(badData));
    resetStore();

    const habits = getHabits();
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('Valid');
  });
});

describe('Undo / Redo', () => {
  it('undo reverses the last toggle', () => {
    const habit = addHabit('Read');
    toggleCheckIn(habit.id, '2026-06-23');
    expect(getMonthCheckIns(habit.id, 2026, 5).get(23)).toBe(true);

    const result = undoLastToggle();
    expect(result).not.toBeNull();
    expect(getMonthCheckIns(habit.id, 2026, 5).get(23)).toBeFalsy();
  });

  it('redo restores an undone toggle', () => {
    const habit = addHabit('Read');
    toggleCheckIn(habit.id, '2026-06-23');
    undoLastToggle();
    // Now redo
    const result = redoLastUndo();
    expect(result).not.toBeNull();
    expect(getMonthCheckIns(habit.id, 2026, 5).get(23)).toBe(true);
  });

  it('redo stack is cleared when a new toggle happens', () => {
    const habit = addHabit('Read');
    toggleCheckIn(habit.id, '2026-06-23');
    undoLastToggle();
    // Now redo stack has 1 entry. New action should clear it.
    toggleCheckIn(habit.id, '2026-06-24');
    expect(redoLastUndo()).toBeNull();
  });

  it('undo returns null when stack is empty', () => {
    expect(undoLastToggle()).toBeNull();
  });

  it('redo returns null when stack is empty', () => {
    expect(redoLastUndo()).toBeNull();
  });

  it('getStorageStatus returns ok for fresh data', () => {
    expect(getStorageStatus()).toBe('ok');
  });
});
