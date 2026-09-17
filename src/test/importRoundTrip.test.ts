/**
 * Import round-trip: reinstall-restore (mergeImportedData) must preserve
 * EVERYTHING a habit carries — the Gym/selfesteem `cause` incident proved
 * that a single dropped field deletes user meaning. Guards:
 * chaos cause, subHabits, ifThen, intent, and doux check-in state
 * (subIds/partial) plus provenance (checkedAt/project/task).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  addHabit,
  updateHabit,
  getHabits,
  getCheckIn,
  toggleSubCheck,
  mergeImportedData,
  exportAllData,
  getEmotionalEvents,
  getEmotionalChecks,
  addEmotionalEvent,
  upsertEmotionalCheck,
  getJournalEntries,
  addJournalEntry,
} from '../store';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

function gymBackup() {
  return {
    habits: [
      {
        id: 'old-gym', name: 'Gym', color: '#E0E7FF', goal: 0,
        createdAt: '2026-09-07T13:36:32.270Z', archived: false, order: 4,
        chaosLinks: [
          { dimension: 'structural', impact: 50 },
          { dimension: 'selfesteem', impact: 50, cause: 'Lien estime de moi-meme retrouve apres effort' },
        ],
        chaosThresholdDays: 3, category: 'health', multiClick: true,
        subHabits: [
          { id: 's-1', label: 'doux 10 min', order: 0 },
          { id: 's-2', label: 'seance complete', order: 1 },
        ],
        ifThen: [{ cue: 'vide le soir', action: 'gym doux' }],
        intent: 'do',
      },
    ],
    checkIns: [
      {
        habitId: 'old-gym', date: '2026-09-06', completed: true, count: 1,
        subIds: ['s-1'], partial: true, checkedAt: '2026-09-06T20:00:00.000Z',
        projectId: 'p-1', taskId: 't-1',
      },
    ],
    notes: [],
  };
}

describe('import preserves habit meaning (Gym/selfesteem regression)', () => {
  it('keeps cause, subHabits, ifThen and intent on created habits', () => {
    const r = mergeImportedData(gymBackup());
    expect(r.habitsCreated).toBe(1);
    const h = getHabits()[0];
    expect(h.name).toBe('Gym');
    expect(h.chaosLinks).toHaveLength(2);
    expect(h.chaosLinks?.find((l) => l.dimension === 'selfesteem')?.cause)
      .toBe('Lien estime de moi-meme retrouve apres effort');
    expect(h.subHabits).toEqual([
      { id: 's-1', label: 'doux 10 min', order: 0 },
      { id: 's-2', label: 'seance complete', order: 1 },
    ]);
    expect(h.ifThen).toEqual([{ cue: 'vide le soir', action: 'gym doux' }]);
    expect(h.intent).toBe('do');
  });

  it('keeps doux check-in state and provenance on restored check-ins', () => {
    mergeImportedData(gymBackup());
    const h = getHabits()[0];
    const ci = getCheckIn(h.id, '2026-09-06')!;
    expect(ci.completed).toBe(true);
    expect(ci.subIds).toEqual(['s-1']);
    expect(ci.partial).toBe(true);
    expect(ci.checkedAt).toBe('2026-09-06T20:00:00.000Z');
    expect(ci.projectId).toBe('p-1');
    expect(ci.taskId).toBe('t-1');
  });

  it('gap-fills a missing cause on a name-matched habit without overwriting', () => {
    // Live habit has the link but lost the cause (post-incident state).
    const h = addHabit('Gym');
    updateHabit(h.id, {
      chaosLinks: [
        { dimension: 'structural', impact: 50 },
        { dimension: 'selfesteem', impact: 50 },
      ],
      chaosThresholdDays: 3,
    });
    const r = mergeImportedData(gymBackup());
    expect(r.habitsCreated).toBe(0); // matched by name, not recreated
    const after = getHabits()[0];
    expect(after.chaosLinks?.find((l) => l.dimension === 'selfesteem')?.cause)
      .toBe('Lien estime de moi-meme retrouve apres effort');
    // …and an existing cause is never overwritten by the import.
    updateHabit(after.id, {
      chaosLinks: [
        { dimension: 'structural', impact: 50 },
        { dimension: 'selfesteem', impact: 50, cause: 'Ma version' },
      ],
    });
    mergeImportedData(gymBackup());
    expect(getHabits()[0].chaosLinks?.find((l) => l.dimension === 'selfesteem')?.cause).toBe('Ma version');
  });

  it('gap-fills doux state onto an existing bare check-in', () => {
    const h = addHabit('Gym');
    updateHabit(h.id, {
      chaosLinks: [{ dimension: 'selfesteem', impact: 50 }],
      subHabits: undefined,
    });
    // Bare completed check-in exists; import carries the doux detail.
    mergeImportedData({
      habits: [{ id: 'x', name: 'Gym', createdAt: '2026-01-01T00:00:00.000Z', order: 0 }],
      checkIns: [{ habitId: 'x', date: '2026-09-06', completed: true }],
      notes: [],
    });
    const bare = getCheckIn(h.id, '2026-09-06')!;
    expect(bare.completed).toBe(true);
    expect(bare.subIds).toBeUndefined();
    // Live user defines the subs, then the rich backup is merged.
    const live = getHabits()[0];
    updateHabit(live.id, { subHabits: [{ id: 's-1', label: 'doux', order: 0 }, { id: 's-2', label: 'full', order: 1 }] });
    mergeImportedData(gymBackup());
    const filled = getCheckIn(h.id, '2026-09-06')!;
    expect(filled.subIds).toEqual(['s-1']);
    expect(filled.partial).toBe(true);
  });

  it('imports emotional events + checks + journal entries (reinstall gap)', () => {
    // Fresh profile (post-reinstall): merge must restore emotions + journal,
    // not just habits — previously they were silently skipped.
    const r = mergeImportedData({
      habits: [],
      checkIns: [],
      notes: [],
      emotionalEvents: [
        { id: 'ev-1', title: 'Rejet', situation: 'x', emotions: ['Honte'], createdAt: '2026-09-01T00:00:00Z', closureNote: 'sens' },
      ],
      emotionalChecks: [
        { id: 'c-1', eventId: 'ev-1', date: '2026-09-04', intensity: 9, note: 'dur' },
        { id: 'bad', eventId: 'ev-1', date: 'not-a-date', intensity: 99 },
      ],
      journalEntries: [
        { id: 'j-1', content: 'hello', personality: 'coach', response: 'hi', createdAt: '2026-09-01T00:00:00Z' },
        { content: 'missing id' },
      ],
    });
    expect(r.emotionsRestored).toBe(2);
    expect(r.journalRestored).toBe(1);
    expect(getEmotionalEvents().map((e) => e.id)).toEqual(['ev-1']);
    expect(getEmotionalEvents()[0].closureNote).toBe('sens');
    expect(getEmotionalChecks('ev-1').map((c) => c.id)).toEqual(['c-1']);
    expect(getJournalEntries().map((j) => j.id)).toEqual(['j-1']);
    // Idempotent: merging the same backup twice adds nothing.
    const r2 = mergeImportedData({
      habits: [],
      checkIns: [],
      notes: [],
      emotionalEvents: [{ id: 'ev-1', title: 'Rejet', situation: 'x', emotions: ['Honte'], createdAt: '2026-09-01T00:00:00Z' }],
      emotionalChecks: [{ id: 'c-1', eventId: 'ev-1', date: '2026-09-04', intensity: 9 }],
      journalEntries: [{ id: 'j-1', content: 'hello', personality: 'coach', response: '', createdAt: '2026-09-01T00:00:00Z' }],
    });
    expect(r2.emotionsRestored).toBe(0);
    expect(r2.journalRestored).toBe(0);
    expect(getEmotionalEvents()).toHaveLength(1);
  });

  it('merges live emotional data with imported backup data (union, no clobber)', () => {
    const ev = addEmotionalEvent({ title: 'Live', situation: 'y', emotions: ['Peur'] });
    upsertEmotionalCheck(ev.id, '2026-09-07', 6);
    addJournalEntry('live note', 'coach', '', undefined, { local: true });
    mergeImportedData({
      habits: [],
      checkIns: [],
      notes: [],
      emotionalEvents: [{ id: 'ev-old', title: 'Vieux', situation: 'z', emotions: ['Tristesse'], createdAt: '2026-08-01T00:00:00Z' }],
      emotionalChecks: [{ id: 'c-old', eventId: 'ev-old', date: '2026-08-02', intensity: 4 }],
      journalEntries: [{ id: 'j-old', content: 'vieux', personality: 'sage', response: '', createdAt: '2026-08-01T00:00:00Z' }],
    });
    expect(getEmotionalEvents().map((e) => e.id).sort()).toEqual([ev.id, 'ev-old'].sort());
    expect(getEmotionalChecks(ev.id).map((c) => c.date)).toEqual(['2026-09-07']);
    expect(getJournalEntries()).toHaveLength(2);
  });

  it('imports every remaining collection type (no silent drops on reinstall)', () => {
    const r = mergeImportedData({
      habits: [],
      checkIns: [],
      notes: [],
      depressions: { '2026-09-01': 72, 'bad-date': 50, '2026-09-02': 150 },
      projects: [{
        id: 'p1', name: 'P', createdAt: '2026-09-01T00:00:00Z', status: 'active',
        habitIds: [], tasks: [],
      }, { name: 'no-id' }],
      protocols: [{ id: 'pr1', title: 'T', source: 'S', claim: 'C', evidenceLevel: 'low', domain: 'sleep', protocol: 'P', keywords: [] }],
      ingestedSources: [{ id: 's1', title: 'T', rawText: 'R', createdAt: '2026-09-01T00:00:00Z', ingested: true }],
      feeds: [{ id: 'f1', url: 'https://x', title: 'X', enabled: true, createdAt: '2026-09-01T00:00:00Z', lastGuids: [] }],
      obsidianNotes: [{ id: 'o1', fileName: 'a.md', content: 'c', importedAt: '2026-09-01T00:00:00Z' }],
      missions: [{
        id: 'm1', name: 'M', habitIds: [], window: { kind: 'fixed', startDate: '2026-09-01', endDate: '2026-09-30' },
        createdAt: '2026-09-01T00:00:00Z', status: 'active',
      }],
      journalThreads: [{ id: 't1', question: 'Q?' }],
      patternTracks: [{ patternId: 'pp', step: 2, seenCount: 3, lastSeen: '2026-09-01', createdAt: '2026-09-01T00:00:00Z' }],
      reflections: [{
        id: 'r1', kind: 'streak', title: 'T', question: 'Q?', context: 'C', habitIds: [],
        dedupeKey: 'dk1', createdAt: '2026-09-01T00:00:00Z', status: 'open',
      }],
      psychoHistory: [{ role: 'user', content: 'hi', frame: 'general', createdAt: '2026-09-01T00:00:00Z' }],
      dismissedRecs: ['rec-a', '', 42],
    });
    expect(r.miscRestored).toBeGreaterThan(10);
    const d = exportAllData();
    expect(d.depressions?.['2026-09-01']).toBe(72);
    expect(d.depressions?.['bad-date']).toBeUndefined();
    expect(d.projects?.map((p) => p.id)).toEqual(['p1']);
    expect(d.protocols?.map((p) => p.id)).toEqual(['pr1']);
    expect(d.ingestedSources?.map((p) => p.id)).toEqual(['s1']);
    expect(d.feeds?.map((p) => p.id)).toEqual(['f1']);
    expect(d.obsidianNotes?.map((p) => p.id)).toEqual(['o1']);
    expect(d.missions?.map((p) => p.id)).toEqual(['m1']);
    expect(d.journalThreads?.map((p) => p.id)).toEqual(['t1']);
    expect(d.patternTracks?.map((p) => p.patternId)).toEqual(['pp']);
    expect(d.reflections?.map((p) => p.id)).toEqual(['r1']);
    expect(d.psychoHistory).toHaveLength(1);
    expect(d.dismissedRecs).toEqual(['rec-a']);
    // Idempotent: second identical merge adds nothing.
    const before = r.miscRestored;
    expect(before).toBeGreaterThan(0);
    const r2 = mergeImportedData({
      habits: [], checkIns: [], notes: [],
      depressions: { '2026-09-01': 72 },
      dismissedRecs: ['rec-a'],
      reflections: [{
        id: 'r1', kind: 'streak', title: 'T', question: 'Q?', context: 'C', habitIds: [],
        dedupeKey: 'dk1', createdAt: '2026-09-01T00:00:00Z', status: 'open',
      }],
    });
    expect(r2.miscRestored).toBe(0);
  });

  it('full export round-trips the doux day byte-identically', () => {
    const h = addHabit('Gym');
    updateHabit(h.id, { subHabits: [{ id: 's-9', label: 'doux', order: 0 }, { id: 's-8', label: 'full', order: 1 }] });
    // Toggle one of two subs → partial doux day.
    toggleSubCheck(h.id, getHabits()[0].subHabits![0].id, '2026-09-05');
    const before = getCheckIn(h.id, '2026-09-05')!;
    expect(before.partial).toBe(true);
    const snap = exportAllData();
    localStorage.clear();
    resetStore();
    mergeImportedData(JSON.parse(JSON.stringify(snap)));
    const after = getCheckIn(getHabits()[0].id, '2026-09-05')!;
    expect(after.completed).toBe(true);
    expect(after.partial).toBe(true);
    expect(after.subIds).toEqual(before.subIds);
  });
});
