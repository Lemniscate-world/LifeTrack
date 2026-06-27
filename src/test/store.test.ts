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
  getCheckIn,
  getCompletionForMonth,
  addNote,
  deleteNote,
  getNotes,
  exportAllData,
  undoLastToggle,
  redoLastUndo,
  getStorageStatus,
  getChaosDimensions,
  toggleChaosTrigger,
  resetChaos,
  getChaosTriggersForDimension,
  getChaosPercentageForDimension,
  computeAutoChaos,
  computeChaosReport,
  mergeImportedData,
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

  it('filters invalid stored check-in dates and completed values on load', () => {
    const rawData = {
      habits: [{ id: 'h1', name: 'Gym', color: '#FFF', goal: 0, createdAt: '', archived: false, order: 0 }],
      checkIns: [
        { habitId: 'h1', date: '2026-06-15', completed: true },
        { habitId: 'h1', date: '2026-06-31', completed: true },
        { habitId: 'h1', date: 'oops', completed: true },
        { habitId: 'h1', date: '2026-06-16', completed: 'yes' },
      ],
      notes: [],
    };
    localStorage.setItem('lifetrack-data', makeEnvelope(rawData));
    resetStore();

    const habit = getHabits()[0];
    const checks = getMonthCheckIns(habit.id, 2026, 5);
    expect(checks.size).toBe(1);
    expect(checks.get(15)).toBe(true);
  });

  it('restores a duplicated backup by mapping repeated habit names to one habit', () => {
    const result = mergeImportedData({
      habits: [
        { id: 'old-gym-1', name: 'Gym', color: '#fff', goal: 20, createdAt: '', archived: false, order: 0 },
        { id: 'old-gym-2', name: 'Gym', color: '#fff', goal: 20, createdAt: '', archived: false, order: 1 },
        { id: 'old-fast', name: 'Fasting', color: '#fff', goal: 15, createdAt: '', archived: false, order: 2 },
      ],
      checkIns: [
        { habitId: 'old-gym-1', date: '2026-06-01', completed: true },
        { habitId: 'old-gym-2', date: '2026-06-02', completed: true },
        { habitId: 'old-fast', date: '2026-06-03', completed: true },
      ],
      notes: [],
    });

    expect(result.habitsCreated).toBe(2);
    expect(result.habitsMapped).toBe(3);
    expect(result.checkInsRestored).toBe(3);

    const habits = getHabits();
    expect(habits.map((habit) => habit.name)).toEqual(['Gym', 'Fasting']);

    const gym = habits.find((habit) => habit.name === 'Gym');
    const fasting = habits.find((habit) => habit.name === 'Fasting');
    expect(gym).toBeDefined();
    expect(fasting).toBeDefined();
    expect(getCheckIn(gym!.id, '2026-06-01')?.completed).toBe(true);
    expect(getCheckIn(gym!.id, '2026-06-02')?.completed).toBe(true);
    expect(getCheckIn(fasting!.id, '2026-06-03')?.completed).toBe(true);
  });

  it('restores check-ins onto an existing same-name habit without duplicating it', () => {
    const existing = addHabit('Gym');

    const result = mergeImportedData({
      habits: [
        { id: 'old-gym', name: 'Gym', color: '#fff', goal: 20, createdAt: '', archived: false, order: 0 },
      ],
      checkIns: [
        { habitId: 'old-gym', date: '2026-06-01', completed: true },
      ],
      notes: [],
    });

    expect(result.habitsCreated).toBe(0);
    expect(result.habitsMapped).toBe(1);
    expect(result.checkInsRestored).toBe(1);
    expect(getHabits()).toHaveLength(1);
    expect(getCheckIn(existing.id, '2026-06-01')?.completed).toBe(true);
  });

  it('rejects invalid imported check-in dates', () => {
    const result = mergeImportedData({
      habits: [{ id: 'old-gym', name: 'Gym', color: '#fff', goal: 0, createdAt: '', archived: false, order: 0 }],
      checkIns: [
        { habitId: 'old-gym', date: '2026-02-29', completed: true }, // invalid: 2026 is not leap year
        { habitId: 'old-gym', date: '2026-06-31', completed: true }, // invalid June day
        { habitId: 'old-gym', date: 'not-a-date', completed: true },
        { habitId: 'old-gym', date: '2026-06-30', completed: true },
      ],
      notes: [],
    });

    const habit = getHabits()[0];
    expect(result.checkInsRestored).toBe(1);
    expect(result.skippedCheckIns).toBe(3);
    expect(getCheckIn(habit.id, '2026-06-30')?.completed).toBe(true);
    expect(getMonthCheckIns(habit.id, 2026, 5).size).toBe(1);
  });

  it('persists metadata merged into an existing habit even without check-ins', () => {
    addHabit('Gym');

    const result = mergeImportedData({
      habits: [{ id: 'old-gym', name: 'Gym', color: '#fff', goal: 20, createdAt: '', archived: false, order: 0 }],
      checkIns: [],
      notes: [],
    });
    expect(result.habitsCreated).toBe(0);
    expect(getHabits()[0].goal).toBe(20);

    flushSave();
    resetStore();
    expect(getHabits()[0].goal).toBe(20);
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

describe('Chaos Tracker', () => {
  it('seeds 5 default dimensions on a fresh store', () => {
    const dims = getChaosDimensions();
    expect(dims).toHaveLength(5);
    const ids = dims.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['physical', 'financial', 'social', 'structural', 'spiritual']));
  });

  it('toggles a non-existent trigger gracefully (no manual triggers by default)', () => {
    // Default chaos has no manual triggers — toggleChaosTrigger should handle gracefully
    const dim = getChaosDimensions()[0];
    expect(dim.triggers).toHaveLength(0);
    // Toggling a non-existent trigger should not throw
    expect(() => toggleChaosTrigger(dim.id, 'nonexistent')).not.toThrow();
  });

  it('addHabit accepts optional chaos config (dimension, impact, threshold)', () => {
    const h = addHabit('Gym', {
      chaosDimension: 'physical',
      chaosImpact: 50,
      chaosThresholdDays: 2,
    });
    expect(h.chaosDimension).toBe('physical');
    expect(h.chaosImpact).toBe(50);
    expect(h.chaosThresholdDays).toBe(2);
  });

  it('addHabit without chaos config leaves fields undefined', () => {
    const h = addHabit('Read');
    expect(h.chaosDimension).toBeUndefined();
    expect(h.chaosImpact).toBeUndefined();
    expect(h.chaosThresholdDays).toBeUndefined();
  });

  it('computes auto chaos when habit missed beyond threshold', () => {
    const h = addHabit('Gym', {
      chaosDimension: 'physical',
      chaosImpact: 50,
      chaosThresholdDays: 2,
    });
    // Backdate creation so streak can accumulate
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    // No check-ins → 25+ days missed >= threshold 2 → trigger
    const auto = computeAutoChaos();
    const physTriggers = auto.get('physical') ?? [];
    expect(physTriggers.length).toBeGreaterThan(0);
    expect(physTriggers[0].trigger.weight).toBe(50);
    expect(physTriggers[0].habitName).toBe('Gym');
  });

  it('does NOT trigger chaos if habit is checked today', () => {
    const h = addHabit('Meditate', {
      chaosDimension: 'spiritual',
      chaosImpact: 30,
      chaosThresholdDays: 2,
    });
    // Mark today as completed
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    toggleCheckIn(h.id, dateStr);
    const auto = computeAutoChaos();
    const spiritual = auto.get('spiritual') ?? [];
    expect(spiritual).toHaveLength(0);
  });

  it('does NOT trigger chaos if habit is checked today (streak starts at 0)', () => {
    const h = addHabit('Stretch', {
      chaosDimension: 'physical',
      chaosImpact: 50,
      chaosThresholdDays: 3,
    });
    // Mark today as completed → 0-day streak → no auto chaos
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    toggleCheckIn(h.id, dateStr);
    const auto = computeAutoChaos();
    const physTriggers = auto.get('physical') ?? [];
    expect(physTriggers).toHaveLength(0);
  });

  it('REAL USER SCENARIO: brand new habit does NOT trigger chaos immediately', () => {
    // User opens app for the first time, creates a habit
    // They haven't checked anything yet
    // The habit was just created TODAY
    // Threshold 2: need 2 consecutive missed days YESTERDAY-1, YESTERDAY-2
    // But YESTERDAY-2 < creation date → break
    // So only YESTERDAY-1 counts → 1 < 2 → NO chaos
    addHabit('Gym', {
      chaosDimension: 'physical',
      chaosImpact: 50,
      chaosThresholdDays: 2,
    });
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0); // brand new habit, shouldn't trigger immediately
  });

  it('REAL USER SCENARIO: created habit 3 days ago, no check-ins → chaos triggers', () => {
    // User created habit June 23, today is June 26
    // No check-ins → streak: YESTERDAY (1), YESTERDAY-1 (2), YESTERDAY-2 (3) = 3 >= threshold 2
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-23T00:00:00.000Z' });

    const asOf = new Date(2026, 5, 26); // June 26
    const auto = computeAutoChaos(asOf);
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.label).toContain('missed 3d');
    expect(phys[0].trigger.weight).toBe(50);
  });

  it('REAL USER SCENARIO: checked yesterday only → streak of 1 (today not counted)', () => {
    // User created habit 5 days ago, checked in yesterday
    // Today is still in progress, NOT counted as missed
    // Yesterday checked → streak = 0 → no chaos
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-20T00:00:00.000Z' });

    const asOf = new Date(2026, 5, 26); // June 26
    toggleCheckIn(h.id, '2026-06-25'); // checked yesterday
    const auto = computeAutoChaos(asOf);
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0); // yesterday was checked, no streak
  });

  it('REAL USER SCENARIO: missed yesterday and the day before → chaos triggers', () => {
    // User created habit 5 days ago, last check was June 24
    // Missed: June 25 (1), June 26-as-yesterday-not-counted
    // Actually: today is June 26, so yesterday is June 25 (missed), day before is June 24 (checked)
    // → streak = 1 → below threshold 2 → NO chaos
    // For chaos, must have missed June 25 AND June 24 (or earlier un-checked)
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-20T00:00:00.000Z' });

    const asOf = new Date(2026, 5, 26);
    toggleCheckIn(h.id, '2026-06-23'); // last check 3 days ago
    const auto = computeAutoChaos(asOf);
    const phys = auto.get('physical') ?? [];
    // Streak: YESTERDAY (June 25 missed=1), YESTERDAY-1 (June 24 missed=2), YESTERDAY-2 (June 23 checked=break)
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.label).toContain('missed 2d');
  });

  it('REAL USER SCENARIO: missed 3 consecutive days (threshold 2) → +50%', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-20T00:00:00.000Z' });

    const asOf = new Date(2026, 5, 26);
    toggleCheckIn(h.id, '2026-06-22'); // last check 4 days ago
    const auto = computeAutoChaos(asOf);
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.weight).toBe(50);
    expect(phys[0].trigger.label).toContain('missed 3d');
  });

  it('auto triggers appear for dimension when habit is linked', () => {
    const dims = getChaosDimensions();
    const physical = dims.find((d) => d.id === 'physical')!;
    // No manual triggers by default
    expect(physical.triggers).toHaveLength(0);
    const triggersBefore = getChaosTriggersForDimension('physical');
    expect(triggersBefore.length).toBe(0);

    // Add a gym habit linked to physical → auto trigger appears
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const triggersAfter = getChaosTriggersForDimension('physical');
    expect(triggersAfter.length).toBe(1); // one auto trigger
    const auto = triggersAfter.find((t) => t.id.startsWith('auto_'));
    expect(auto).toBeDefined();
  });

  it('caps dimension percentage at 100', () => {
    // Add two habits each contributing 60% to physical, threshold 2
    const h1 = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 60, chaosThresholdDays: 2 });
    const h2 = addHabit('Run', { chaosDimension: 'physical', chaosImpact: 60, chaosThresholdDays: 2 });
    updateHabit(h1.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    updateHabit(h2.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const pct = getChaosPercentageForDimension('physical');
    expect(pct).toBeLessThanOrEqual(100);
    expect(pct).toBeGreaterThan(0);
  });

  it('does not include archived habits in chaos computation', () => {
    const habit = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    archiveHabit(habit.id);
    const auto = computeAutoChaos();
    const physTriggers = auto.get('physical') ?? [];
    expect(physTriggers).toHaveLength(0);
  });

  it('resetChaos restores defaults (empty triggers)', () => {
    // After reset, all dimensions have empty triggers
    resetChaos();
    const fresh = getChaosDimensions();
    expect(fresh).toHaveLength(5);
    for (const d of fresh) {
      expect(d.triggers).toEqual([]);
    }
  });

  it('auto trigger ignores today\'s missing if habit checked once ever (streak counts from today)', () => {
    // If habit is checked today, streak of missed days = 0, no chaos trigger
    const h = addHabit('Read', { chaosDimension: 'spiritual', chaosImpact: 30, chaosThresholdDays: 1 });
    // Direct insert a CheckIn for today via toggleCheckIn
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    toggleCheckIn(h.id, dateStr);
    const auto = computeAutoChaos();
    expect(auto.get('spiritual') ?? []).toHaveLength(0);
  });

  it('multiple habits contribute independently to their dimension', () => {
    const h1 = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    const h2 = addHabit('Sleep7h', { chaosDimension: 'physical', chaosImpact: 30, chaosThresholdDays: 1 });
    updateHabit(h1.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    updateHabit(h2.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const phys = getChaosTriggersForDimension('physical');
    const autoTriggers = phys.filter((t) => t.id.startsWith('auto_'));
    expect(autoTriggers.length).toBe(2);
  });

  it('habit without check-ins in past 90 days stops counting streak', () => {
    // Threshold is 2; even with 90 days missed, only 1 auto trigger should be emitted (not infinite)
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-01-01T00:00:00.000Z' });
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys.length).toBe(1); // one auto trigger for this single habit
  });

  it('getChaosPercentageForDimension returns 0 when no triggers active', () => {
    // Fresh store: all manual triggers inactive, no habits linked → 0%
    const pct = getChaosPercentageForDimension('financial');
    expect(pct).toBe(0);
  });

  it('getChaosPercentageForDimension returns correct auto chaos sum', () => {
    // Two missed habits in the same dimension → sum of their impacts
    const h1 = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 30, chaosThresholdDays: 2 });
    const h2 = addHabit('Run', { chaosDimension: 'physical', chaosImpact: 40, chaosThresholdDays: 2 });
    updateHabit(h1.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    updateHabit(h2.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const pct = getChaosPercentageForDimension('physical');
    expect(pct).toBe(70); // 30 + 40
  });

  it('toggleChaosTrigger on non-existent dimension does nothing', () => {
    const before = getChaosDimensions();
    toggleChaosTrigger('nonexistent', 'p1');
    const after = getChaosDimensions();
    expect(after).toEqual(before);
  });

  it('toggleChaosTrigger on non-existent trigger does nothing', () => {
    const before = getChaosDimensions();
    toggleChaosTrigger('physical', 'nonexistent');
    const after = getChaosDimensions();
    expect(after).toEqual(before);
  });

  it('computeAutoChaos accepts asOf date parameter', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    // Check in yesterday (relative to asOf) → 1 day missed (asOf day), then break → 1 < threshold 2
    const asOf = new Date(2026, 5, 15); // June 15, 2026
    const checkedDate = '2026-06-14'; // checked the day before asOf
    toggleCheckIn(h.id, checkedDate);
    // Streak: June 15 missed (1), June 14 checked → break → 1 < threshold 2 → no trigger
    const auto = computeAutoChaos(asOf);
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0);
  });

  it('computeAutoChaos with asOf: missed streak >= threshold triggers', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    // Check in 5 days before asOf → 4 consecutive missed days (threshold 2 → trigger)
    const asOf = new Date(2026, 5, 15); // June 15
    const checkedDate = '2026-06-10';
    toggleCheckIn(h.id, checkedDate);
    const auto = computeAutoChaos(asOf);
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.weight).toBe(50);
    expect(phys[0].trigger.label).toContain('missed');
  });

  it('auto trigger label includes missed days and threshold', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 3 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.label).toContain('Gym');
    expect(phys[0].trigger.label).toContain('missed');
  });

  it('getChaosTriggersForDimension returns empty array for non-existent dimension', () => {
    const triggers = getChaosTriggersForDimension('nonexistent');
    expect(triggers).toEqual([]);
  });

  it('auto triggers have distinct IDs per habit', () => {
    const h1 = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    const h2 = addHabit('Run', { chaosDimension: 'physical', chaosImpact: 30, chaosThresholdDays: 2 });
    updateHabit(h1.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    updateHabit(h2.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const phys = getChaosTriggersForDimension('physical');
    const autoIds = phys.filter((t) => t.id.startsWith('auto_')).map((t) => t.id);
    expect(autoIds).toContain(`auto_${h1.id}`);
    expect(autoIds).toContain(`auto_${h2.id}`);
    expect(new Set(autoIds).size).toBe(2); // distinct
  });

  it('habit with chaosImpact=0 is skipped by computeAutoChaos', () => {
    addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 0, chaosThresholdDays: 2 });
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0);
  });

  it('habit with chaosThresholdDays=0 is skipped by computeAutoChaos', () => {
    addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 0 });
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0);
  });

  it('habit without chaosDimension is skipped', () => {
    addHabit('Gym', { chaosImpact: 50, chaosThresholdDays: 2 }); // no dimension
    const auto = computeAutoChaos();
    expect(auto.size).toBe(0);
  });

  it('consecutive missed days break on first completed check-in going backward', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 3 });
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBefore = new Date(today);
    dayBefore.setDate(dayBefore.getDate() - 2);

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Check in yesterday → streak is: today missed (1), yesterday checked → break → 1 day missed
    toggleCheckIn(h.id, fmt(yesterday));
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0); // threshold 3, only 1 day missed
  });

  it('streak of 3 missed with threshold 3 triggers chaos', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 3 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    const today = new Date();
    const fourDaysAgo = new Date(today);
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Last check 4 days ago → with NEW algo (starts from yesterday):
    // YESTERDAY (1), YESTERDAY-1 (2), YESTERDAY-2 (3) = 3 missed >= threshold 3 → trigger
    toggleCheckIn(h.id, fmt(fourDaysAgo));
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
  });

  it('resetChaos does not affect habits with chaos config', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    resetChaos();
    const habit = getHabits().find((x) => x.id === h.id);
    expect(habit).toBeDefined();
    expect(habit!.chaosDimension).toBe('physical');
    expect(habit!.chaosImpact).toBe(50);
  });

  it('getChaosDimensions returns same reference (mutable, not cloned)', () => {
    const a = getChaosDimensions();
    const b = getChaosDimensions();
    expect(a).toBe(b); // same reference — by design, for reactivity
  });

  it('all 5 default dimensions exist with empty triggers (auto-only)', () => {
    const dims = getChaosDimensions();
    expect(dims).toHaveLength(5);
    for (const d of dims) {
      expect(d.triggers).toEqual([]);
    }
  });

  it('auto chaos map returns empty for dimensions with no linked habits', () => {
    const auto = computeAutoChaos();
    // No habits linked → all dimensions should be absent from the map
    expect(auto.get('social')).toBeUndefined();
    expect(auto.get('financial')).toBeUndefined();
  });

  // ── End-to-end workflow tests ──

  it('E2E: habit with backdated creation triggers chaos after 2 missed days', () => {
    // Simulate: habit created June 23, last check June 24, missed June 25-26
    // Today is June 26. Yesterday (June 25) missed → 1. June 24 checked → break.
    // So actually NO chaos with new algo (only 1 day missed from yesterday).
    // For chaos we need a check earlier than 2 days ago.
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-20T00:00:00.000Z' });

    // Last check June 23 → YESTERDAY(25) missed(1), YESTERDAY-1(24) missed(2), YESTERDAY-2(23) checked=break
    toggleCheckIn(h.id, '2026-06-23');

    const auto = computeAutoChaos(new Date(2026, 5, 26)); // June 26, 2026
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.label).toContain('missed');
    expect(phys[0].trigger.weight).toBe(50);
  });

  it('E2E: checking in today clears the chaos trigger', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });

    // With NEW algo: chaos depends on YESTERDAY, not today.
    // If no check-ins for 5+ days, chaos triggers from yesterday's streak.
    // After backdating creation, chaos is triggered by yesterday's missed streak.
    // Today being checked does NOT change yesterday's status.
    // To "clear" the chaos we need to check in YESTERDAY.
    const before = computeAutoChaos(new Date(2026, 5, 26));
    expect((before.get('physical') ?? []).length).toBeGreaterThan(0);

    // Check in YESTERDAY → breaks the streak at yesterday
    toggleCheckIn(h.id, '2026-06-25');
    const after = computeAutoChaos(new Date(2026, 5, 26));
    expect(after.get('physical') ?? []).toHaveLength(0);
  });

  it('E2E: two habits in different dimensions tracked independently', () => {
    const gym = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    const budget = addHabit('Budget', { chaosDimension: 'financial', chaosImpact: 40, chaosThresholdDays: 3 });
    updateHabit(gym.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    updateHabit(budget.id, { createdAt: '2026-06-01T00:00:00.000Z' });

    const auto = computeAutoChaos(new Date(2026, 5, 26));
    expect((auto.get('physical') ?? []).length).toBeGreaterThan(0);
    expect((auto.get('financial') ?? []).length).toBeGreaterThan(0);
    expect(auto.get('social') ?? []).toHaveLength(0);
  });

  it('E2E: check-in with completed=false still counts as missed', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-20T00:00:00.000Z' });

    // Toggle creates completed=true, toggle again makes it false
    toggleCheckIn(h.id, '2026-06-26');
    toggleCheckIn(h.id, '2026-06-26'); // now completed=false

    const auto = computeAutoChaos(new Date(2026, 5, 26));
    const phys = auto.get('physical') ?? [];
    expect(phys.length).toBeGreaterThan(0); // still counts as missed
  });

  it('E2E: habit created today with threshold 2 does NOT immediately trigger', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-26T10:00:00.000Z' }); // created today
    // createdAt = now, so only today can be counted → 1 < 2

    const auto = computeAutoChaos(new Date(2026, 5, 26));
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0);
  });

  it('E2E: habit created 2 days ago with threshold 2 triggers (2 missed days)', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-24T00:00:00.000Z' }); // 2 days before asOf

    // No check-ins → June 26 (missed), June 25 (missed), June 24 (creation day → missed), June 23 (< createdAt → break)
    // 3 missed days >= threshold 2 → trigger
    const auto = computeAutoChaos(new Date(2026, 5, 26));
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(1);
    expect(phys[0].trigger.label).toContain('missed');
  });

  it('E2E: getChaosPercentageForDimension reflects active auto triggers', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });

    const pct = getChaosPercentageForDimension('physical');
    expect(pct).toBe(50);
  });

  it('E2E: getChaosTriggersForDimension returns auto triggers for linked habits only', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });

    const triggers = getChaosTriggersForDimension('physical');
    const autoTriggers = triggers.filter((t) => t.id.startsWith('auto_'));
    expect(autoTriggers).toHaveLength(1);
    expect(autoTriggers[0].active).toBe(true);
  });

  it('E2E: dimension with no linked habits returns 0% and empty triggers', () => {
    const pct = getChaosPercentageForDimension('social');
    expect(pct).toBe(0);
    const triggers = getChaosTriggersForDimension('social');
    expect(triggers).toHaveLength(0);
  });

  // ── Bug regression tests ──

  it('BUG FIX: updateHabit with chaosDimension="" clears all chaos fields', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    expect(h.chaosDimension).toBe('physical');

    // Simulate "None" selection
    updateHabit(h.id, { chaosDimension: '' });
    const updated = getHabits().find((x) => x.id === h.id);
    expect(updated!.chaosDimension).toBeUndefined();
    expect(updated!.chaosImpact).toBeUndefined();
    expect(updated!.chaosThresholdDays).toBeUndefined();
  });

  it('BUG FIX: updateHabit with chaosDimension=null clears all chaos fields', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { chaosDimension: null as unknown as undefined });
    const updated = getHabits().find((x) => x.id === h.id);
    expect(updated!.chaosDimension).toBeUndefined();
    expect(updated!.chaosImpact).toBeUndefined();
  });

  it('BUG FIX: updateHabit clamps chaosImpact to [0,100]', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { chaosImpact: 9999 });
    const updated = getHabits().find((x) => x.id === h.id);
    expect(updated!.chaosImpact).toBe(100);

    updateHabit(h.id, { chaosImpact: -50 });
    const updated2 = getHabits().find((x) => x.id === h.id);
    expect(updated2!.chaosImpact).toBe(0);
  });

  it('BUG FIX: updateHabit rejects NaN for chaos fields', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { chaosImpact: NaN });
    const updated = getHabits().find((x) => x.id === h.id);
    expect(updated!.chaosImpact).toBeUndefined();
  });

  it('BUG FIX: updateHabit clamps chaosThresholdDays to [1,90]', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { chaosThresholdDays: 999 });
    const updated = getHabits().find((x) => x.id === h.id);
    expect(updated!.chaosThresholdDays).toBe(90);

    updateHabit(h.id, { chaosThresholdDays: 0 });
    const updated2 = getHabits().find((x) => x.id === h.id);
    expect(updated2!.chaosThresholdDays).toBe(1); // clamped to min
  });

  it('BUG FIX: habit with chaosDimension="" but chaosImpact=50 does NOT trigger chaos', () => {
    // After "None" cleanup, all three fields must be gone
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-01-01T00:00:00.000Z' });
    updateHabit(h.id, { chaosDimension: '' });
    const auto = computeAutoChaos();
    const phys = auto.get('physical') ?? [];
    expect(phys).toHaveLength(0); // unlinked → no trigger
  });

  it('BUG FIX: parseImportedHabit clamps chaos fields on import', () => {
    const result = mergeImportedData({
      habits: [{
        id: 'h1',
        name: 'Test',
        chaosDimension: 'physical',
        chaosImpact: 9999,  // out of range
        chaosThresholdDays: -5, // out of range
      }],
    });
    expect(result.habitsCreated).toBe(1);
    const habits = exportAllData().habits;
    const imported = habits.find((h) => h.name === 'Test');
    expect(imported!.chaosImpact).toBe(100); // clamped
    expect(imported!.chaosThresholdDays).toBe(1); // clamped
  });

  it('BUG FIX: parseImportedHabit rejects non-string chaosDimension', () => {
    const result = mergeImportedData({
      habits: [{
        id: 'h1',
        name: 'Test',
        chaosDimension: 42, // number, not string
        chaosImpact: 50,
        chaosThresholdDays: 2,
      }],
    });
    expect(result.habitsCreated).toBe(1);
    const habits = exportAllData().habits;
    const imported = habits.find((h) => h.name === 'Test');
    // Non-string dimension should result in undefined
    expect(imported!.chaosDimension).toBeUndefined();
  });

  // ── computeChaosReport: full dashboard picture (linked + on-track habits) ──

  it('computeChaosReport lists a linked habit even when it is on-track', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-20T00:00:00.000Z' });
    // Checked yesterday → not triggered, but must still appear in the report
    toggleCheckIn(h.id, '2026-06-25');

    const report = computeChaosReport(new Date(2026, 5, 26));
    expect(report.linkedHabitCount).toBe(1);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits).toHaveLength(1);
    expect(phys.habits[0].habitName).toBe('Gym');
    expect(phys.habits[0].triggered).toBe(false);
    expect(phys.pct).toBe(0);
  });

  it('computeChaosReport marks a habit triggered past its threshold', () => {
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-01T00:00:00.000Z' });

    const report = computeChaosReport(new Date(2026, 5, 26));
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].triggered).toBe(true);
    expect(phys.habits[0].missedStreak).toBeGreaterThanOrEqual(2);
    expect(phys.pct).toBe(50);
  });

  it('computeChaosReport excludes unlinked and archived habits', () => {
    addHabit('Read'); // unlinked
    const archived = addHabit('Run', { chaosDimension: 'physical', chaosImpact: 40, chaosThresholdDays: 2 });
    archiveHabit(archived.id);

    const report = computeChaosReport(new Date(2026, 5, 26));
    expect(report.linkedHabitCount).toBe(0);
  });

  it('computeChaosReport overall % averages only dimensions with linked habits', () => {
    const gym = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    const budget = addHabit('Budget', { chaosDimension: 'financial', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(gym.id, { createdAt: '2026-06-01T00:00:00.000Z' }); // triggered → 50%
    updateHabit(budget.id, { createdAt: '2026-06-20T00:00:00.000Z' });
    toggleCheckIn(budget.id, '2026-06-25'); // on-track → 0%

    const report = computeChaosReport(new Date(2026, 5, 26));
    // Two dimensions have linked habits: 50% and 0% → average 25%.
    // The three empty dimensions are ignored.
    expect(report.overallPct).toBe(25);
  });

  it('computeChaosReport caps a dimension at 100%', () => {
    const h1 = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 70, chaosThresholdDays: 2 });
    const h2 = addHabit('Run', { chaosDimension: 'physical', chaosImpact: 70, chaosThresholdDays: 2 });
    updateHabit(h1.id, { createdAt: '2026-06-01T00:00:00.000Z' });
    updateHabit(h2.id, { createdAt: '2026-06-01T00:00:00.000Z' });

    const report = computeChaosReport(new Date(2026, 5, 26));
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits).toHaveLength(2);
    expect(phys.pct).toBe(100);
  });

  // ── BUG FIX: marking recent days as missed must drive chaos even for a habit
  // created "today". Previously the streak broke at any day before createdAt, so
  // a freshly-created habit could never go into chaos no matter what you unchecked.

  it('computeChaosReport: unchecking recent days triggers chaos for a habit created today', () => {
    const today = new Date(2026, 5, 26); // asOf
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    // Habit created TODAY (the failing real-world case)
    updateHabit(h.id, { createdAt: '2026-06-26T08:00:00.000Z' });

    // User marks the two prior days as missed: check then uncheck → completed:false
    for (const day of ['2026-06-24', '2026-06-25']) {
      toggleCheckIn(h.id, day); // true
      toggleCheckIn(h.id, day); // false (missed)
    }

    const report = computeChaosReport(today);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].triggered).toBe(true);
    expect(phys.habits[0].missedStreak).toBeGreaterThanOrEqual(2);
    expect(phys.pct).toBe(50);
  });

  it('computeChaosReport: a brand-new untouched habit is NOT in chaos', () => {
    const today = new Date(2026, 5, 26);
    const h = addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    updateHabit(h.id, { createdAt: '2026-06-26T08:00:00.000Z' }); // created today, no check-ins

    const report = computeChaosReport(today);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].triggered).toBe(false);
    expect(phys.habits[0].missedStreak).toBe(0);
  });
});


