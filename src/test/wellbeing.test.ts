/**
 * Wellbeing socle: playable routine steps (progress + resume), step rename /
 * delete, one-shot seeds (outing guard + depression protocol), and round-trip
 * persistence (sanitize + import) — no data loss, ever.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  addRoutine,
  deleteRoutine,
  toggleRoutineStep,
  resetRoutineProgress,
  updateRoutineStep,
  deleteRoutineStep,
  routineProgress,
  getDepressionProtocol,
  getRoutines,
  getRoutinesForTrigger,
  seedWellbeingDefaults,
  mergeImportedData,
  exportAllData,
  restoreUpgradeBackup,
  getChaosDimensions,
  updatePreferences,
  getPreferences,
} from '../store';

const TEST_KEY = 'lifetrack-upgrade-backup-2099-04-04T00-00';

function seedUpgradeBackup(d: unknown): void {
  localStorage.setItem(TEST_KEY, JSON.stringify({ v: 1, d, h: 'test' }));
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  localStorage.removeItem(TEST_KEY);
});

function makeRoutine() {
  return addRoutine({
    triggerId: 't-1',
    name: 'Proto',
    steps: [
      { id: 's-1', label: 'Un', order: 0 },
      { id: 's-2', label: 'Deux', order: 1 },
      { id: 's-3', label: 'Trois', order: 2 },
    ],
  });
}

describe('routine step progress + resume', () => {
  it('toggles steps, reports next, resumes where left', () => {
    const r = makeRoutine();
    expect(routineProgress(r)).toEqual({ done: 0, total: 3, pct: 0, next: expect.objectContaining({ id: 's-1' }) });
    toggleRoutineStep(r.id, 's-1');
    toggleRoutineStep(r.id, 's-3'); // out of order is fine
    const after = getRoutines()[0];
    const prog = routineProgress(after);
    expect(prog.done).toBe(2);
    expect(prog.next?.id).toBe('s-2'); // first undone in order = resume here
    // Untoggle works.
    toggleRoutineStep(r.id, 's-1');
    expect(routineProgress(getRoutines()[0]).done).toBe(1);
    // Unknown routine/step → null, nothing breaks.
    expect(toggleRoutineStep('nope', 's-1')).toBeNull();
    expect(toggleRoutineStep(r.id, 'ghost')).toBeNull();
  });

  it('resets progress', () => {
    const r = makeRoutine();
    toggleRoutineStep(r.id, 's-1');
    expect(resetRoutineProgress(r.id)).toBe(true);
    expect(routineProgress(getRoutines()[0]).done).toBe(0);
    expect(resetRoutineProgress('nope')).toBe(false);
  });

  it('renames and deletes steps (progress purged with them)', () => {
    const r = makeRoutine();
    toggleRoutineStep(r.id, 's-2');
    expect(updateRoutineStep(r.id, 's-2', '  Deux rename  ')).toBe(true);
    expect(getRoutines()[0].steps.find((s) => s.id === 's-2')?.label).toBe('Deux rename');
    expect(updateRoutineStep(r.id, 's-2', '   ')).toBe(false);
    expect(updateRoutineStep(r.id, 'ghost', 'x')).toBe(false);
    expect(deleteRoutineStep(r.id, 's-2')).toBe(true);
    const after = getRoutines()[0];
    expect(after.steps.map((s) => s.id)).toEqual(['s-1', 's-3']);
    expect(after.progress?.doneStepIds ?? []).not.toContain('s-2');
    expect(deleteRoutineStep(r.id, 'ghost')).toBe(false);
    deleteRoutine(r.id);
    expect(getRoutines()).toHaveLength(0);
  });
});

describe('one-shot wellbeing seeds', () => {
  it('seeds the outing guard + depression protocol once, respects deletions', () => {
    const first = seedWellbeingDefaults();
    expect(first.outingGuard).toBe(true);
    expect(first.protocol).toBe(true);
    const dims = getChaosDimensions();
    const structural = dims.find((d) => d.id === 'structural')!;
    expect(structural.triggers.some((t) => t.label.includes('Sortie sociale impromptue'))).toBe(true);
    const proto = getDepressionProtocol();
    expect(proto).toBeDefined();
    expect(proto!.steps).toHaveLength(6);
    expect(getRoutinesForTrigger(proto!.triggerId)).toHaveLength(1);
    // Second call: nothing re-seeded.
    const second = seedWellbeingDefaults();
    expect(second).toEqual({ outingGuard: false, protocol: false });
    expect(getRoutines().filter((r) => r.kind === 'depression-day')).toHaveLength(1);
    // User deletes the protocol → respected, never re-seeded.
    deleteRoutine(proto!.id);
    expect(getDepressionProtocol()).toBeUndefined();
    expect(seedWellbeingDefaults().protocol).toBe(false);
  });
});

describe('wellbeing prefs survive sanitize (threshold + seed flags)', () => {
  it('keeps a custom depression threshold and seed flags through restore', () => {
    updatePreferences({ depressionAlertThreshold: 55, wellbeingNewSeen: true });
    expect(getPreferences().depressionAlertThreshold).toBe(55);
    seedUpgradeBackup(exportAllData());
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    expect(getPreferences().depressionAlertThreshold).toBe(55);
    expect(getPreferences().wellbeingNewSeen).toBe(true);
  });
});

describe('routine persistence (no data loss)', () => {
  it('sanitize preserves kind + progress, repairs bad steps', () => {
    seedUpgradeBackup({
      habits: [],
      routines: [
        {
          id: 'r-1', triggerId: 't-1', name: 'Proto', kind: 'depression-day',
          steps: [
            { id: 's-1', label: 'Un', order: 0 },
            { id: 's-1', label: 'DUPE', order: 1 },
            { id: '', label: 'no id', order: 2 },
            { id: 's-2', label: '  Deux  ', order: 1 },
          ],
          progress: { doneStepIds: ['s-1', 'ghost'], updatedAt: '2026-09-01T00:00:00.000Z' },
          createdAt: '2026-09-01T00:00:00.000Z',
        },
        { id: 'r-bad', name: 'missing trigger' },
      ],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    expect(data.routines ?? []).toHaveLength(1);
    const r = (data.routines ?? [])[0]!;
    expect(r.kind).toBe('depression-day');
    expect(r.steps.map((s) => s.id)).toEqual(['s-1', 's-2']);
    expect(r.progress?.doneStepIds).toEqual(['s-1']); // orphan purged
  });

  it('import round-trips routines + merges progress by id', () => {
    const r = makeRoutine();
    toggleRoutineStep(r.id, 's-1');
    const snap = exportAllData();
    localStorage.clear();
    resetStore();
    const res = mergeImportedData(JSON.parse(JSON.stringify(snap)));
    expect(res.routinesRestored).toBe(1);
    const back = getRoutines()[0];
    expect(back.steps).toHaveLength(3);
    expect(back.progress?.doneStepIds).toEqual(['s-1']);
    // Second import with more progress unions done ids (no overwrite).
    toggleRoutineStep(back.id, 's-2');
    mergeImportedData(JSON.parse(JSON.stringify(snap)));
    expect(getRoutines()[0].progress?.doneStepIds.sort()).toEqual(['s-1', 's-2']);
  });
});
