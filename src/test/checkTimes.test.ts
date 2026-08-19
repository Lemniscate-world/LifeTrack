// src/test/checkTimes.test.ts
// Tests for the "when do I log?" analysis (checkTimes.ts) + the store capture
// of the check-in timestamp (checkedAt).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CheckIn, Habit } from '../types';
import {
  hourOfCheckIn,
  slotOfHour,
  slotInfo,
  loggedHours,
  preferredLogSlot,
  habitLogPatterns,
  logTimeInsights,
} from '../checkTimes';
import { resetStore, addHabit, getHabits, toggleCheckIn, getCheckIn } from '../store';

/** Check-in recorded at `localHour` on `date` (timezone-safe via ISO). */
function at(habitId: string, date: string, localHour: number): CheckIn {
  const [y, m, d] = date.split('-').map(Number);
  return {
    habitId,
    date,
    completed: true,
    checkedAt: new Date(y, m - 1, d, localHour, 15).toISOString(),
  };
}

const h = (id: string, name = id): Habit => ({
  id,
  name,
  color: '#fff',
  goal: 1,
  createdAt: '2026-01-01',
  archived: false,
  order: 0,
});

describe('checkTimes — heure des check-ins', () => {
  it('extrait l’heure locale d’un timestamp ISO', () => {
    expect(hourOfCheckIn(at('a', '2026-08-01', 8))).toBe(8);
    expect(hourOfCheckIn(at('a', '2026-08-01', 20))).toBe(20);
  });

  it('renvoie null sans timestamp ou avec un timestamp invalide', () => {
    const plain: CheckIn = { habitId: 'a', date: '2026-08-01', completed: true };
    expect(hourOfCheckIn(plain)).toBeNull();
    expect(hourOfCheckIn({ ...plain, checkedAt: 'not-a-date' })).toBeNull();
  });

  it('découpe les heures en créneaux', () => {
    expect(slotOfHour(0)).toBe('nuit');
    expect(slotOfHour(4)).toBe('nuit');
    expect(slotOfHour(5)).toBe('matin');
    expect(slotOfHour(11)).toBe('matin');
    expect(slotOfHour(12)).toBe('midi');
    expect(slotOfHour(14)).toBe('midi');
    expect(slotOfHour(15)).toBe('après-midi');
    expect(slotOfHour(17)).toBe('après-midi');
    expect(slotOfHour(18)).toBe('soir');
    expect(slotOfHour(23)).toBe('soir');
    expect(slotInfo('matin').emoji).toBe('🌅');
  });

  it('regroupe les check-ins par heure et filtre par horizon', () => {
    const now = new Date(2026, 7, 10); // 2026-08-10
    const checkIns = [
      at('a', '2026-08-09', 8),
      at('a', '2026-08-08', 8),
      at('a', '2026-08-07', 20),
      at('a', '2026-01-01', 8), // hors horizon 90 jours
    ];
    const hours = loggedHours(checkIns, 90, now);
    const total = hours.reduce((s, e) => s + e.count, 0);
    expect(total).toBe(3);
    expect(hours.find((e) => e.hour === 8)?.count).toBe(2);
    expect(hours.find((e) => e.hour === 20)?.count).toBe(1);
  });

  it('détermine le créneau préféré', () => {
    const checkIns = [at('a', '2026-08-09', 8), at('a', '2026-08-08', 9), at('a', '2026-08-07', 21)];
    const pref = preferredLogSlot(checkIns, 90, new Date(2026, 7, 10));
    expect(pref).not.toBeNull();
    expect(pref!.slot).toBe('matin');
    expect(pref!.pct).toBe(67);
  });

  it('renvoie null sans aucun check-in horodaté', () => {
    const plain: CheckIn = { habitId: 'a', date: '2026-08-01', completed: true };
    expect(preferredLogSlot([plain])).toBeNull();
  });

  it('calcule l’heure modale et la stabilité par habitude', () => {
    const patterns = habitLogPatterns(
      [h('a', 'Matin'), h('b', 'Variable')],
      [
        at('a', '2026-08-09', 7),
        at('a', '2026-08-08', 7),
        at('a', '2026-08-07', 7),
        at('b', '2026-08-09', 8),
        at('b', '2026-08-08', 22),
      ],
    );
    const matin = patterns.find((p) => p.habitId === 'a');
    expect(matin).toBeDefined();
    expect(matin!.modalHour).toBe(7);
    expect(matin!.modalSlot).toBe('matin');
    expect(matin!.stability).toBe(1);
    const variable = patterns.find((p) => p.habitId === 'b');
    expect(variable!.stability).toBeLessThan(1);
  });

  it('génère des insights FR quand il y a assez de données', () => {
    const insights = logTimeInsights(
      [h('a', 'Matin')],
      [at('a', '2026-08-09', 7), at('a', '2026-08-08', 7), at('a', '2026-08-07', 7), at('a', '2026-08-06', 8), at('a', '2026-08-05', 9)],
      90,
      new Date(2026, 7, 10),
    );
    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0]).toContain('matin');
    expect(insights.some((s) => s.includes('rituel'))).toBe(true);
  });

  it('ne produit rien sans données horodatées', () => {
    const plain: CheckIn = { habitId: 'a', date: '2026-08-01', completed: true };
    expect(logTimeInsights([h('a')], [plain])).toEqual([]);
  });
});

describe('store — capture de checkedAt', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('horodate un nouveau check-in et remplit un check-in existant sans heure', () => {
    addHabit('Gym');
    const habit = getHabits()[0];
    const before = Date.now();
    toggleCheckIn(habit.id, '2026-08-01');
    const ci = getCheckIn(habit.id, '2026-08-01');
    expect(ci).toBeDefined();
    expect(ci!.checkedAt).toBeDefined();
    const ts = new Date(ci!.checkedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);

    // Ré-check → l'heure reste celle du premier enregistrement.
    toggleCheckIn(habit.id, '2026-08-01'); // uncheck
    toggleCheckIn(habit.id, '2026-08-01'); // recheck
    expect(getCheckIn(habit.id, '2026-08-01')!.checkedAt).toBe(ci!.checkedAt);
  });
});
