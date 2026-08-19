// src/streakDrivers.ts
// What actually makes your streaks start — and last?
//
// Every streak is a tiny experiment the user already ran. This module reads the
// moments BEFORE a streak (weekday, mood, energy) and the habits that co-occur
// DURING long streaks, then compares them against the user's baseline.
// Pure module, no store access — unit-testable in isolation.

import type { CheckIn, Habit } from './types';
import { fromDateKey, toDateKey, addDays, daysBetween } from './dates';

const DAY_ZERO = new Date(2020, 0, 1); // fixed reference for calendar-day offsets
const dayNum = (key: string) => daysBetween(DAY_ZERO, fromDateKey(key));

export interface StreakRun {
  habitId: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  length: number;
}

/** Consecutive completed-day runs for a habit (calendar-day arithmetic, no DST bug). */
export function streakRuns(habitId: string, checkIns: CheckIn[], minLength = 3): StreakRun[] {
  const sorted = [
    ...new Set(
      checkIns
        .filter((c) => c.habitId === habitId && c.completed)
        .map((c) => c.date),
    ),
  ].sort();
  const runs: StreakRun[] = [];
  let run: string[] = [];
  let prev = -Infinity;
  for (const d of sorted) {
    const t = dayNum(d);
    if (t - prev === 1) {
      run.push(d);
    } else {
      if (run.length >= minLength) {
        runs.push({ habitId, start: run[0], end: run[run.length - 1], length: run.length });
      }
      run = [d];
    }
    prev = t;
  }
  if (run.length >= minLength) {
    runs.push({ habitId, start: run[0], end: run[run.length - 1], length: run.length });
  }
  return runs;
}

export interface StreakDriver {
  kind: 'weekday' | 'mood' | 'energy' | 'habit-pair';
  label: string;
  insight: string;
  /** % of streak-starts (or streak-days) where the condition holds. */
  support: number;
  /** % of baseline days where the condition holds. */
  baseline: number;
  /** support / baseline — how much the condition multiplies the odds. */
  lift: number;
}

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const GOOD_MOODS = new Set(['great', 'amazing', 'calm', 'okay']);

export interface StreakDriversInput {
  habits: Habit[];
  checkIns: CheckIn[];
  moods: Record<string, string>;
  energies?: Record<string, number>;
  concentrations?: Record<string, number>;
}

const clampLift = (v: number) => Math.round(v * 10) / 10;

/**
 * Detect the strongest, data-backed drivers of the user's streaks. Returns an
 * empty array when there is not enough data (fewer than a few streaks).
 */
export function streakDrivers(input: StreakDriversInput, minLength = 3): StreakDriver[] {
  const { habits, checkIns, moods, energies } = input;
  const active = habits.filter((h) => !h.archived);
  const runs: StreakRun[] = [];
  for (const h of active) runs.push(...streakRuns(h.id, checkIns, minLength));
  if (runs.length < 3) return [];

  const drivers: StreakDriver[] = [];

  // --- Baseline: every completed day the user has ever logged ---
  const allDoneDays = new Set<string>();
  for (const c of checkIns) if (c.completed) allDoneDays.add(c.date);
  const baseTotal = Math.max(1, allDoneDays.size);

  // --- 1. Weekday of the day BEFORE a streak starts ---
  const startsByWd = new Array(7).fill(0);
  for (const r of runs) startsByWd[fromDateKey(toDateKey(addDays(fromDateKey(r.start), -1))).getDay()]++;
  const baseWd = new Array(7).fill(0);
  for (const d of allDoneDays) baseWd[fromDateKey(d).getDay()]++;
  let bestWd = -1;
  let bestWdLift = 0;
  for (let i = 0; i < 7; i++) {
    const support = (startsByWd[i] / runs.length) * 100;
    const baseline = (baseWd[i] / baseTotal) * 100;
    const lift = baseline > 0 ? support / baseline : (support > 0 ? Infinity : 0);
    if (lift > bestWdLift) {
      bestWdLift = lift;
      bestWd = i;
    }
  }
  if (bestWd >= 0 && bestWdLift >= 1.25 && startsByWd[bestWd] >= 2) {
    drivers.push({
      kind: 'weekday',
      label: 'Jour de lancement',
      insight: `Tes séries démarrent surtout la veille du ${DAY_NAMES[bestWd]} (×${clampLift(bestWdLift)} vs ta moyenne).`,
      support: Math.round((startsByWd[bestWd] / runs.length) * 100),
      baseline: Math.round((baseWd[bestWd] / baseTotal) * 100),
      lift: clampLift(bestWdLift),
    });
  }

  // --- 2. Mood on the day BEFORE a streak starts ---
  const moodKeys = Object.keys(moods);
  if (moodKeys.length >= 5) {
    let goodBefore = 0;
    let goodBase = 0;
    for (const r of runs) {
      const beforeKey = toDateKey(addDays(fromDateKey(r.start), -1));
      const m = moods[beforeKey];
      if (m && GOOD_MOODS.has(m)) goodBefore++;
    }
    for (const m of Object.values(moods)) {
      if (GOOD_MOODS.has(m)) goodBase++;
    }
    const support = (goodBefore / runs.length) * 100;
    const baseline = (goodBase / Object.keys(moods).length) * 100;
    const lift = baseline > 0 ? support / baseline : 0;
    if (goodBefore >= 2 && lift >= 1.25) {
      drivers.push({
        kind: 'mood',
        label: 'Humeur la veille',
        insight: `Dans ${support.toFixed(0)} % des cas, ta série commence après une journée à l'humeur positive (vs ${baseline.toFixed(0)} % de jours de base) — ×${clampLift(lift)}.`,
        support: Math.round(support),
        baseline: Math.round(baseline),
        lift: clampLift(lift),
      });
    }
  }

  // --- 3. Energy ≥ 70 % the day BEFORE a streak starts ---
  const energyKeys = Object.keys(energies ?? {});
  if (energyKeys.length >= 5) {
    let highBefore = 0;
    let highBase = 0;
    for (const r of runs) {
      const beforeKey = toDateKey(addDays(fromDateKey(r.start), -1));
      const e = energies?.[beforeKey];
      if (e !== undefined && e >= 70) highBefore++;
    }
    for (const e of Object.values(energies ?? {})) {
      if (e >= 70) highBase++;
    }
    const support = (highBefore / runs.length) * 100;
    const baseline = (highBase / Object.keys(energies ?? {}).length) * 100;
    const lift = baseline > 0 ? support / baseline : 0;
    if (highBefore >= 2 && lift >= 1.25) {
      drivers.push({
        kind: 'energy',
        label: 'Énergie ≥ 70 % la veille',
        insight: `Dans ${support.toFixed(0)} % des cas, la veille d'une série, ton énergie était ≥ 70 % (vs ${baseline.toFixed(0)} % en moyenne) — ×${clampLift(lift)}.`,
        support: Math.round(support),
        baseline: Math.round(baseline),
        lift: clampLift(lift),
      });
    }
  }

  // --- 4. Habit pairs: which habit co-occurs during LONG streaks (≥ 7 days)? ---
  const longRuns = runs.filter((r) => r.length >= 7);
  if (longRuns.length >= 2 && active.length >= 2) {
    const byHabit: Record<string, { long: number; short: number; hit: number }> = {};
    for (const h of active) byHabit[h.id] = { long: 0, short: 0, hit: 0 };
    for (const r of runs) {
      const days = new Set<string>();
      for (const c of checkIns) {
        if (c.habitId === r.habitId && c.completed && c.date >= r.start && c.date <= r.end) days.add(c.date);
      }
      for (const other of active) {
        if (other.id === r.habitId) continue;
        const otherDays = new Set(
          checkIns.filter((c) => c.habitId === other.id && c.completed).map((c) => c.date),
        );
        let hits = 0;
        for (const d of days) if (otherDays.has(d)) hits++;
        const ratio = days.size > 0 ? hits / days.size : 0;
        if (r.length >= 7) byHabit[other.id].long++;
        else byHabit[other.id].short++;
        if (ratio >= 0.5) byHabit[other.id].hit++;
      }
    }
    let bestPair: { habitId: string; lift: number; long: number; hit: number } | null = null;
    for (const [habitId, stats] of Object.entries(byHabit)) {
      const total = stats.long + stats.short;
      const rawLift = stats.long > 0 && stats.short > 0 && total > 0
        ? (stats.hit / stats.long) / (stats.hit / total)
        : 0;
      if (stats.hit >= 2 && rawLift >= 1.3 && (!bestPair || rawLift > bestPair.lift)) {
        bestPair = { habitId, lift: rawLift, long: stats.hit, hit: stats.hit };
      }
    }
    if (bestPair) {
      const other = active.find((h) => h.id === bestPair!.habitId);
      if (other) {
        drivers.push({
          kind: 'habit-pair',
          label: 'Duo gagnant',
          insight: `Quand tu fais « ${other.name} » pendant une série, celle-ci atteint beaucoup plus souvent ≥ 7 jours (×${clampLift(bestPair.lift)}).`,
          support: Math.round((bestPair.long / Math.max(1, longRuns.length)) * 100),
          baseline: Math.round((bestPair.hit / Math.max(1, bestPair.long + bestPair.hit)) * 100),
          lift: clampLift(bestPair.lift),
        });
      }
    }
  }

  return drivers;
}
