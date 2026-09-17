/**
 * Chaos frequency (cry-wolf guard): a 3×/week habit must NOT heat chaos
 * after 2 calendar days off. Chaos counts MISSED SESSIONS in a trailing
 * window — proven identical to consecutive-day streaks for daily habits.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  addHabit,
  updateHabit,
  toggleCheckIn,
  computeChaosReport,
  computeMissedSessions,
  chaosPerWeekOf,
  mergeImportedData,
  getHabits,
} from '../store';

// Fixed "today": Monday 2026-09-07 (deterministic trailing windows).
const TODAY = new Date(2026, 8, 7, 12, 0, 0);
const dkey = (month: number, day: number): string =>
  `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

function linkGym(perWeek?: number, threshold = 2) {
  const h = addHabit('Gym');
  updateHabit(h.id, {
    // Fixed creation date (Aug): the Sept windows under test are fully tracked.
    createdAt: '2026-08-01T00:00:00.000Z',
    chaosLinks: [{ dimension: 'physical', impact: 50 }],
    chaosThresholdDays: threshold,
    ...(perWeek === undefined ? {} : { chaosPerWeek: perWeek }),
  });
  return getHabits()[0];
}

describe('chaosPerWeekOf', () => {
  it('defaults to 7 and clamps 1-7', () => {
    expect(chaosPerWeekOf({})).toBe(7);
    expect(chaosPerWeekOf({ chaosPerWeek: 3 })).toBe(3);
    expect(chaosPerWeekOf({ chaosPerWeek: 0 })).toBe(1);
    expect(chaosPerWeekOf({ chaosPerWeek: 99 })).toBe(7);
    expect(chaosPerWeekOf({ chaosPerWeek: NaN })).toBe(7);
  });
});

describe('daily equivalence (no behavior change)', () => {
  it('matches the consecutive streak exactly', () => {
    const h = linkGym(undefined, 2);
    // Done 09-05, missed 09-06 (yesterday relative to Mon 09-07).
    toggleCheckIn(h.id, dkey(9, 5));
    const s = computeMissedSessions(getHabits()[0], 2, TODAY);
    expect(s.perWeek).toBe(7);
    expect(s.windowDays).toBe(2);
    expect(s.expected).toBe(2);
    expect(s.missed).toBe(1);
    const report = computeChaosReport(TODAY);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].missedStreak).toBe(1);
    expect(phys.habits[0].triggered).toBe(false);
    expect(phys.habits[0].perWeek).toBe(7);
  });

  it('triggers after threshold consecutive misses (daily)', () => {
    const h = linkGym(undefined, 2);
    toggleCheckIn(h.id, dkey(9, 3));
    const report = computeChaosReport(TODAY);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    // Display streak stays calendar-based (09-06,05,04 missed = 3),
    // while the trigger uses the occurrence model.
    expect(phys.habits[0].missedStreak).toBe(3);
    expect(phys.habits[0].triggered).toBe(true);
    expect(phys.pct).toBe(50);
  });
});

describe('non-daily habits (cry-wolf guard)', () => {
  it('3×/week does NOT trigger after 2 calendar days off', () => {
    const h = linkGym(3, 2);
    // Last session 09-04 (Thu): Fri+Sat+Sun off is NORMAL for 3×/week.
    toggleCheckIn(h.id, dkey(9, 4));
    toggleCheckIn(h.id, dkey(9, 2));
    toggleCheckIn(h.id, dkey(8, 31));
    const report = computeChaosReport(TODAY);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].perWeek).toBe(3);
    expect(phys.habits[0].triggered).toBe(false);
    expect(phys.pct).toBe(0);
  });

  it('3×/week triggers when the whole trailing week is empty', () => {
    linkGym(3, 3);
    const report = computeChaosReport(TODAY);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].missedStreak).toBe(3);
    expect(phys.habits[0].triggered).toBe(true);
  });

  it('1×/week tolerates 6 off days, fires on a fully missed week', () => {
    const h = linkGym(1, 1);
    // Session done Mon 09-01 (inside the trailing 7d window 09-06..08-31):
    // 6 calendar days off, yet NO alarm — the weekly session is done.
    toggleCheckIn(h.id, dkey(9, 1));
    const calm = computeChaosReport(TODAY);
    const calmPhys = calm.dimensions.find((d) => d.id === 'physical')!;
    expect(calmPhys.habits[0].missedStreak).toBe(0);
    expect(calmPhys.habits[0].triggered).toBe(false);
    expect(calmPhys.pct).toBe(0);
  });

  it('1×/week fires when the trailing week has no session at all', () => {
    const h = linkGym(1, 1);
    // Last session Sun 08-30: outside the trailing window → week fully missed.
    toggleCheckIn(h.id, dkey(8, 30));
    const report = computeChaosReport(TODAY);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].missedStreak).toBe(1);
    expect(phys.habits[0].triggered).toBe(true);
    void h;
  });

  it('1×/week stays calm when the session was done this week', () => {
    linkGym(1, 1);
    toggleCheckIn(getHabits()[0].id, dkey(9, 6)); // yesterday: session done
    const report = computeChaosReport(TODAY);
    const phys = report.dimensions.find((d) => d.id === 'physical')!;
    expect(phys.habits[0].missedStreak).toBe(0);
    expect(phys.habits[0].triggered).toBe(false);
  });
});

describe('frequency persistence (Gym lesson)', () => {
  it('sanitize clamps chaosPerWeek instead of dropping the habit', () => {
    const h = addHabit('Gym');
    updateHabit(h.id, { chaosPerWeek: 99 });
    expect(getHabits()[0].chaosPerWeek).toBe(7);
    updateHabit(h.id, { chaosPerWeek: 0 });
    expect(getHabits()[0].chaosPerWeek).toBe(1);
    updateHabit(h.id, { chaosPerWeek: 'x' as unknown as number });
    expect(getHabits()[0].chaosPerWeek).toBeUndefined();
    expect(getHabits()).toHaveLength(1);
  });

  it('survives import round-trip (create + gap-fill)', () => {
    const r = mergeImportedData({
      habits: [{
        id: 'old-gym', name: 'Gym', color: '', goal: 0,
        createdAt: '2026-09-01T00:00:00.000Z', archived: false, order: 0,
        chaosLinks: [{ dimension: 'physical', impact: 50 }],
        chaosThresholdDays: 2, chaosPerWeek: 3,
      }],
      checkIns: [],
      notes: [],
    });
    expect(r.habitsCreated).toBe(1);
    expect(getHabits()[0].chaosPerWeek).toBe(3);
    // Gap-fill on a name-matched habit that lacks it.
    const live = getHabits()[0];
    updateHabit(live.id, { chaosPerWeek: undefined });
    mergeImportedData({
      habits: [{
        id: 'old-gym', name: 'Gym', color: '', goal: 0,
        createdAt: '2026-09-01T00:00:00.000Z', archived: false, order: 0,
        chaosPerWeek: 3,
      }],
      checkIns: [],
      notes: [],
    });
    expect(getHabits()[0].chaosPerWeek).toBe(3);
  });
});
