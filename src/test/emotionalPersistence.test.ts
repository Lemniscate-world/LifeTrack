/**
 * Regression test for the v0.6.2 sanitize-drop incident:
 * sanitizeData() silently dropped emotionalEvents, emotionalChecks and
 * routines on every load/recovery pass, deleting the user's emotional event.
 * These fields must survive a sanitize round-trip (exercised here through
 * the public restoreUpgradeBackup path, which runs sanitizeData).
 *
 * The full-shape test below types its fixture as Required<AppData>: adding
 * a field to AppData without updating the fixture is a COMPILE error, and
 * dropping a field in sanitizeData is a TEST failure. Both directions guarded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { restoreUpgradeBackup, exportAllData, upsertEmotionalCheck, getEmotionalChecks, addEmotionalEvent } from '../store';
import type { AppData } from '../types';

const TEST_KEY = 'lifetrack-upgrade-backup-2099-01-01T00-00';

function seedUpgradeBackup(d: unknown): void {
  localStorage.setItem(TEST_KEY, JSON.stringify({ v: 1, d, h: 'test' }));
}

beforeEach(() => {
  localStorage.removeItem(TEST_KEY);
});

afterEach(() => {
  localStorage.removeItem(TEST_KEY);
});

describe('emotional + routine persistence through sanitize', () => {
  it('preserves emotionalEvents, emotionalChecks and routines on restore', () => {
    seedUpgradeBackup({
      habits: [],
      emotionalEvents: [
        {
          id: 'ev-1',
          title: 'Rejet Par Raina',
          situation: 'test',
          emotions: ['Honte', 'Culpabilité'],
          createdAt: '2026-09-04T09:01:34.144Z',
        },
      ],
      emotionalChecks: [
        { id: 'c-1', eventId: 'ev-1', date: '2026-09-04', intensity: 9 },
      ],
      routines: [
        {
          id: 'r-1',
          triggerId: 't-1',
          name: 'SOS',
          steps: [{ id: 's-1', label: 'Respirer', order: 0 }],
          createdAt: '2026-09-04T09:00:00.000Z',
        },
      ],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    expect(data.emotionalEvents ?? []).toHaveLength(1);
    expect((data.emotionalEvents ?? [])[0].title).toBe('Rejet Par Raina');
    expect(data.emotionalChecks ?? []).toHaveLength(1);
    expect(data.routines ?? []).toHaveLength(1);
  });

  it('preserves EVERY AppData collection through sanitize (guard against future drops)', () => {
    // Required<AppData> = compile error if AppData gains a key not listed here.
    const full: Required<AppData> = {
      habits: [{ id: 'h-1', name: 'H' } as AppData['habits'][number]],
      checkIns: [{ habitId: 'h-1', date: '2026-09-04', completed: true }],
      notes: [{ id: 'n-1', habitId: 'h-1', content: 'c', createdAt: '2026-09-04T00:00:00.000Z' }],
      chaosDimensions: [],
      achievementCategories: [],
      mantras: [],
      mantraSettings: { morningEnabled: true, eveningEnabled: true, showOnEntry: true, morningTime: '08:00', eveningTime: '20:00', lastMorningDate: '', lastEveningDate: '', lastEntryDate: '' },
      skills: [],
      capacities: [],
      capacityRatings: [],
      moods: { '2026-09-04': 'okay' },
      energies: {},
      concentrations: {},
      depressions: {},
      experiments: [],
      urges: [],
      customUrgeTypes: [],
      journalEntries: [],
      journalThreads: [],
      challenges: [],
      personas: [],
      levers: [],
      patternTracks: [],
      reflections: [],
      psychoHistory: [],
      dismissedRecs: ['x'],
      projects: [],
      protocols: [],
      ingestedSources: [],
      feeds: [],
      obsidianNotes: [],
      missions: [],
      routines: [{ id: 'r-1', triggerId: 't-1', name: 'R', steps: [], createdAt: '2026-09-04T00:00:00.000Z' }],
      emotionalEvents: [{
        id: 'ev-1', title: 'E', situation: 's', emotions: ['Peur'], createdAt: '2026-09-04T00:00:00.000Z',
        plans: [
          { id: 'p-1', title: 'Plan', sourceNote: 'note', steps: [{ id: 's-1', label: 'step', done: true }], createdAt: '2026-09-04T00:00:00.000Z' },
          { id: '', title: '', steps: 'nope' } as unknown as import('../types').EmotionalActionPlan,
        ],
      }],
      emotionalChecks: [{ id: 'c-1', eventId: 'ev-1', date: '2026-09-04', intensity: 5 }],
      preferences: { darkMode: false, theme: '' },
    };
    seedUpgradeBackup(full);
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    // Every collection with content must survive (validated shape aside,
    // nothing may be silently dropped by the allowlist).
    expect((data.emotionalEvents ?? []).map((e) => e.id)).toEqual(['ev-1']);
    const plans = (data.emotionalEvents ?? [])[0]!.plans ?? [];
    expect(plans.map((p) => p.id)).toEqual(['p-1']);
    expect(plans[0]!.steps).toEqual([{ id: 's-1', label: 'step', done: true }]);
    expect((data.emotionalChecks ?? []).map((c) => c.id)).toEqual(['c-1']);
    expect((data.routines ?? []).map((r) => r.id)).toEqual(['r-1']);
    expect(data.moods['2026-09-04']).toBe('okay');
    expect(data.dismissedRecs).toEqual(['x']);
    expect(data.habits.map((h) => h.id)).toEqual(['h-1']);
    expect(data.checkIns).toHaveLength(1);
  });

  it('preserves per-emotion intensities and timestamps, drops garbage ones', () => {
    seedUpgradeBackup({
      habits: [],
      emotionalEvents: [
        { id: 'ev-1', title: 'E', situation: 's', emotions: ['Peur'], createdAt: '2026-09-04T00:00:00.000Z' },
      ],
      emotionalChecks: [
        {
          id: 'c-1', eventId: 'ev-1', date: '2026-09-04', intensity: 7,
          intensities: { Peur: 8, Honte: 5, '': 3, x: 99, y: 'high' },
          createdAt: '2026-09-04T22:15:00.000Z',
        },
      ],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    const check = (data.emotionalChecks ?? [])[0]!;
    // Valid per-emotion values kept, out-of-range clamped, garbage keys/values dropped.
    expect(check.intensities).toEqual({ Peur: 8, Honte: 5, x: 10 });
    expect(check.createdAt).toBe('2026-09-04T22:15:00.000Z');
  });

  it('upserted checks are retrievable and exported (never silently lost)', () => {
    const ev = addEmotionalEvent({ title: 'Test', situation: 's', emotions: ['Peur'] });
    const c1 = upsertEmotionalCheck(ev.id, '2026-09-07', 7, 'soir difficile', { Peur: 7 });
    expect(c1.id).toBeTruthy();
    expect(getEmotionalChecks(ev.id).map((c) => c.date)).toEqual(['2026-09-07']);
    // Same-day update keeps one row, refreshes values.
    upsertEmotionalCheck(ev.id, '2026-09-07', 5);
    expect(getEmotionalChecks(ev.id)).toHaveLength(1);
    expect(getEmotionalChecks(ev.id)[0].intensity).toBe(5);
    expect(getEmotionalChecks(ev.id)[0].note).toBe('soir difficile');
    // And the export carries them (what files persist).
    const data = exportAllData();
    expect((data.emotionalChecks ?? []).map((c) => c.date)).toContain('2026-09-07');
  });

  it('preserves per-emotion note tags and plan targets, drops garbage ones', () => {
    seedUpgradeBackup({
      habits: [],
      emotionalEvents: [
        {
          id: 'ev-1', title: 'E', situation: 's', emotions: ['Honte', 'Colère'], createdAt: '2026-09-04T00:00:00.000Z',
          plans: [
            {
              id: 'p-1', title: 'Plan', steps: [{ id: 's-1', label: 'step', done: false }], createdAt: '2026-09-04T00:00:00.000Z',
              emotions: ['Honte', 'Honte', '', 42, '  ', 'x'.repeat(50)],
            },
          ],
        },
      ],
      emotionalChecks: [
        {
          id: 'c-1', eventId: 'ev-1', date: '2026-09-04', intensity: 7, note: 'dur',
          noteEmotions: ['Honte', ' Honte ', '', 7, 'Colère'],
        },
      ],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    // Trimmed, deduped, non-strings and overlong dropped.
    expect((data.emotionalChecks ?? [])[0]!.noteEmotions).toEqual(['Honte', 'Colère']);
    expect((data.emotionalEvents ?? [])[0]!.plans?.[0]!.emotions).toEqual(['Honte']);
  });

  it('upsert stores and clears per-emotion note tags', () => {
    const ev = addEmotionalEvent({ title: 'Test', situation: 's', emotions: ['Peur', 'Honte'] });
    const c1 = upsertEmotionalCheck(ev.id, '2026-09-07', 7, 'soir difficile', { Peur: 7 }, ['Peur', 'Peur', '']);
    expect(c1.noteEmotions).toEqual(['Peur']);
    // Clearing all tags removes the field (not an empty array).
    upsertEmotionalCheck(ev.id, '2026-09-07', 7, 'soir difficile', { Peur: 7 }, []);
    expect(getEmotionalChecks(ev.id)[0].noteEmotions).toBeUndefined();
    // Omitting the param leaves existing tags untouched.
    upsertEmotionalCheck(ev.id, '2026-09-07', 6, 'toujours dur', undefined, ['Honte']);
    upsertEmotionalCheck(ev.id, '2026-09-07', 6);
    expect(getEmotionalChecks(ev.id)[0].noteEmotions).toEqual(['Honte']);
    const data = exportAllData();
    expect((data.emotionalChecks ?? []).find((c) => c.eventId === ev.id)!.noteEmotions).toEqual(['Honte']);
  });

  it('drops malformed emotional entries but keeps valid ones', () => {
    seedUpgradeBackup({
      habits: [],
      emotionalEvents: [
        { id: 'ev-good', title: 'OK', situation: 's', emotions: ['Peur'], createdAt: '2026-09-04T09:00:00.000Z' },
        { title: 'missing id' },
        { id: 'ev-bad-date', title: 'x', situation: 's', emotions: 'not-an-array', createdAt: '2026-09-04' },
      ],
      emotionalChecks: [
        { id: 'c-good', eventId: 'ev-good', date: '2026-09-04', intensity: 5 },
        { id: 'c-bad', eventId: 'ev-good', date: 'not-a-date', intensity: 99 },
      ],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    expect((data.emotionalEvents ?? []).map((e) => e.id)).toEqual(['ev-good']);
    expect((data.emotionalChecks ?? []).map((c) => c.id)).toEqual(['c-good']);
  });
});
