// src/test/streakDrivers.test.ts
import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit } from '../types';
import { streakRuns, streakDrivers } from '../streakDrivers';

const h = (id: string, name = id): Habit => ({
  id, name, color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 0,
});

const ci = (habitId: string, date: string): CheckIn => ({ habitId, date, completed: true });

/** Consecutive date keys from `start` for `days` days (YYYY-MM-DD). */
function span(start: string, days: number): string[] {
  const [y, m, d] = start.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
  }
  return out;
}

describe('streakRuns', () => {
  it('détecte les séries consécutives et ignore les trous', () => {
    const runs = streakRuns('a', [
      ...span('2026-08-01', 3).map((d) => ci('a', d)),
      ...span('2026-08-10', 4).map((d) => ci('a', d)),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ start: '2026-08-01', end: '2026-08-03', length: 3 });
    expect(runs[1]).toMatchObject({ start: '2026-08-10', end: '2026-08-13', length: 4 });
  });

  it('filtre les séries trop courtes', () => {
    expect(streakRuns('a', span('2026-08-01', 2).map((d) => ci('a', d)))).toHaveLength(0);
  });

  it('ignore les jours dédoublonnés', () => {
    const runs = streakRuns('a', [
      ci('a', '2026-08-01'), ci('a', '2026-08-01'),
      ci('a', '2026-08-02'), ci('a', '2026-08-03'),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(3);
  });
});

describe('streakDrivers', () => {
  it('ne renvoie rien avec trop peu de séries', () => {
    expect(streakDrivers({ habits: [h('a')], checkIns: span('2026-08-01', 3).map((d) => ci('a', d)), moods: {} })).toEqual([]);
  });

  it('détecte le jour de lancement + humeur + énergie quand le signal est net', () => {
    // 4 séries de 5 jours démarrant un lundi (veille = dimanche, getDay 0).
    const runs = [
      { start: '2026-08-03', len: 5 }, // lundi
      { start: '2026-08-10', len: 5 },
      { start: '2026-08-17', len: 5 },
      { start: '2026-08-24', len: 5 },
    ];
    const checkIns: CheckIn[] = [];
    const moods: Record<string, string> = {};
    const energies: Record<string, number> = {};
    for (const r of runs) {
      for (const d of span(r.start, r.len)) checkIns.push(ci('a', d));
      const prev = new Date(r.start + 'T00:00:00');
      prev.setDate(prev.getDate() - 1);
      const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
      moods[prevKey] = 'great';
      energies[prevKey] = 85;
    }
    // Moods/energies de base: médiocres partout ailleurs.
    for (const d of span('2026-08-01', 35)) {
      if (!moods[d]) moods[d] = 'tired';
      if (energies[d] === undefined) energies[d] = 30;
    }
    const drivers = streakDrivers({ habits: [h('a')], checkIns, moods, energies });
    const kinds = drivers.map((d) => d.kind);
    expect(kinds).toContain('weekday');
    expect(kinds).toContain('mood');
    expect(kinds).toContain('energy');
    const wd = drivers.find((d) => d.kind === 'weekday');
    expect(wd!.lift).toBeGreaterThanOrEqual(1.25);
    expect(wd!.insight).toContain('dimanche');
  });

  it('détecte le duo d habitudes qui tient les longues séries', () => {
    const checkIns: CheckIn[] = [];
    // 2 longues séries (8j) de 'a' où 'b' est aussi fait chaque jour.
    for (const d of span('2026-08-03', 8)) { checkIns.push(ci('a', d), ci('b', d)); }
    for (const d of span('2026-08-20', 8)) { checkIns.push(ci('a', d), ci('b', d)); }
    // 1 courte série (3j) de 'a' sans 'b'.
    for (const d of span('2026-09-01', 3)) checkIns.push(ci('a', d));

    const drivers = streakDrivers({ habits: [h('a'), h('b')], checkIns, moods: {} });
    const pair = drivers.find((d) => d.kind === 'habit-pair');
    expect(pair).toBeDefined();
    expect(pair!.insight).toContain('b');
  });
});
