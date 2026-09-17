/**
 * Psychology features: implementation intentions (si-alors), self-compassion
 * breaks (Neff), and the closure ritual (meaning-making at archive).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetStore,
  addHabit,
  updateHabit,
  getHabits,
  restoreUpgradeBackup,
  exportAllData,
} from '../store';
import { selfCompassionFor } from '../selfCompassion';
import { buildTherapistReport } from '../emotionForecast';
import { MAX_IF_THEN } from '../types';

const TEST_KEY = 'lifetrack-upgrade-backup-2099-03-03T00-00';

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

describe('implementation intentions (si-alors)', () => {
  it('adds cue→action plans via updateHabit, trims and caps at 3', () => {
    const h = addHabit('Work');
    updateHabit(h.id, { ifThen: [{ cue: '  je suis vidé le soir ', action: '  j\u2019ouvre Work-doux 10 min ' }] });
    expect(getHabits()[0].ifThen).toEqual([{ cue: 'je suis vidé le soir', action: 'j\u2019ouvre Work-doux 10 min' }]);
    // Dupes + empties dropped, capped.
    updateHabit(h.id, {
      ifThen: [
        { cue: 'je suis vidé le soir', action: 'j\u2019ouvre Work-doux 10 min' },
        { cue: '', action: 'x' },
        { cue: 'a', action: 'b' },
        { cue: 'c', action: 'd' },
        { cue: 'e', action: 'f' },
      ],
    });
    expect(getHabits()[0].ifThen).toHaveLength(MAX_IF_THEN);
    // Empty list clears.
    updateHabit(h.id, { ifThen: [] });
    expect(getHabits()[0].ifThen).toBeUndefined();
    // Non-array discarded, habit survives.
    updateHabit(h.id, { ifThen: 'nope' as unknown as [] });
    expect(getHabits()[0].name).toBe('Work');
    expect(getHabits()[0].ifThen).toBeUndefined();
  });

  it('survives sanitize: repairs corrupt plans instead of dropping the habit', () => {
    seedUpgradeBackup({
      habits: [
        {
          id: 'h-1', name: 'Work', color: '', goal: 0,
          createdAt: '2026-09-01T00:00:00.000Z', archived: false, order: 0,
          ifThen: [
            { cue: 'vide', action: 'doux' },
            { cue: 'vide', action: 'doux' },
            { cue: '', action: 'x' },
            { cue: 'a' },
            'garbage',
          ],
        },
      ],
      checkIns: [],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    expect(data.habits).toHaveLength(1);
    expect(data.habits[0].ifThen).toEqual([{ cue: 'vide', action: 'doux' }]);
  });
});

describe('selfCompassionFor (Neff break)', () => {
  it('returns null below 2 missed days', () => {
    expect(selfCompassionFor('Gym', 0)).toBeNull();
    expect(selfCompassionFor('Gym', 1)).toBeNull();
  });

  it('switches to dormant mode past the threshold (redefine, not pep-talk)', () => {
    const b = selfCompassionFor('Podcast', 35)!;
    expect(b.mode).toBe('dormant');
    expect(b.title).toContain('dort');
    expect(b.phrases.join(' ')).toMatch(/archiver|redéfinir/i);
    expect(selfCompassionFor('Gym', 3)!.mode).toBe('lapse');
    expect(selfCompassionFor('Gym', 14)!.mode).toBe('lapse');
    expect(selfCompassionFor('Gym', 15)!.mode).toBe('dormant');
  });

  it('names the pain, normalizes, and invites a tiny doux step', () => {
    const b = selfCompassionFor('Gym', 3)!;
    expect(b.title).toContain('Gym');
    expect(b.title).toContain('3 jours');
    expect(b.phrases).toHaveLength(3);
    const all = b.phrases.join(' ');
    expect(all).toMatch(/pleine conscience|humanité|bienveillance/i);
    expect(b.cta).toContain('Gym');
    // Deterministic.
    expect(selfCompassionFor('Gym', 3)).toEqual(b);
  });
});

describe('closure ritual (meaning-making)', () => {
  it('persists closureNote through sanitize and surfaces it in the report', () => {
    seedUpgradeBackup({
      habits: [],
      emotionalEvents: [
        {
          id: 'ev-1', title: 'Rejet', situation: 's', emotions: ['Honte'],
          createdAt: '2026-09-01T00:00:00.000Z', archived: true,
          closureNote: '  J\u2019ai appris que le silence n\u2019est pas un verdict  ',
        },
        {
          id: 'ev-2', title: 'X', situation: 's', emotions: ['Peur'],
          createdAt: '2026-09-01T00:00:00.000Z', closureNote: '   ',
        },
      ],
      emotionalChecks: [],
    });
    expect(restoreUpgradeBackup(TEST_KEY)).toBe(true);
    const data = exportAllData();
    expect(data.emotionalEvents?.find((e) => e.id === 'ev-1')?.closureNote)
      .toBe('J\u2019ai appris que le silence n\u2019est pas un verdict');
    expect(data.emotionalEvents?.find((e) => e.id === 'ev-2')?.closureNote).toBeUndefined();
    const md = buildTherapistReport(
      {
        title: 'Rejet', situation: 's', emotions: ['Honte'], createdAt: '2026-09-01T00:00:00Z',
        closureNote: 'J\u2019ai appris que le silence n\u2019est pas un verdict',
      },
      [],
      null,
      [],
      [],
    );
    expect(md).toContain('Sens à la clôture');
    expect(md).toContain('le silence n\u2019est pas un verdict');
  });
});
