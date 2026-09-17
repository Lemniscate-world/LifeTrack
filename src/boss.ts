// src/boss.ts
// Weekly Boss: turn the week into a fight you can win.
//
// Design (rubber-banding, never punishing):
// - Each completed check-in deals 1 damage to the week's boss.
// - The boss HP = median damage of your last 4 FULL weeks (min 10). Bad
//   month? Small boss. Great month? Bigger boss. Always ~50/50 winnable.
// - Slay it (damage >= HP before Sunday 23:59) → kill streak grows.
// - Kill streak counts consecutive slain weeks BEFORE the current one
//   (each past week judged against the CURRENT hp — an approximation,
//   documented, that keeps the function O(n) instead of recursive).
//
// Pure + deterministic: same inputs → same output, unit-tested.

import type { CheckIn, Habit } from './types';
import { toDateKey } from './dates';

export interface WeeklyBoss {
  /** Monday (YYYY-MM-DD) of the current fighting week. */
  weekKey: string;
  /** Boss HP (adaptive). */
  maxHp: number;
  /** Damage dealt so far (completed check-ins, Monday → today). */
  damage: number;
  /** HP left (0 when slain). */
  remaining: number;
  /** True once damage >= HP — the boss is slain, week is won. */
  slain: boolean;
  /** Days left to fight, today included (Mon=7 … Sun=1). */
  daysLeft: number;
  /** Consecutive slain weeks before this one (against current HP). */
  killStreak: number;
  /** Damage per day this week (Mon..today) for the HP bar segments. */
  dailyDamage: number[];
}

/** Monday (local) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Mon=0 … Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Weekly boss state as of `now`. Counts completed check-ins only;
 * archived habits are excluded from the HP fallback.
 */
export function weeklyBoss(habits: Habit[], checkIns: CheckIn[], now: Date = new Date()): WeeklyBoss {
  const monday = mondayOf(now);
  const weekKey = toDateKey(monday);
  const todayKey = toDateKey(now);
  const active = habits.filter((h) => !h.archived);
  const activeIds = new Set(active.map((h) => h.id));

  // Damage per day Mon..today.
  const dailyDamage: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    if (key > todayKey) break;
    let n = 0;
    for (const c of checkIns) {
      if (c.date === key && c.completed && activeIds.has(c.habitId)) n++;
    }
    dailyDamage.push(n);
  }
  const damage = dailyDamage.reduce((a, b) => a + b, 0);

  // Reference: damage of the last 4 FULL weeks (before this Monday).
  const pastWeeks: number[] = [];
  for (let w = 1; w <= 4; w++) {
    const start = new Date(monday);
    start.setDate(start.getDate() - 7 * w);
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = toDateKey(d);
      for (const c of checkIns) {
        if (c.date === key && c.completed && activeIds.has(c.habitId)) n++;
      }
    }
    pastWeeks.push(n);
  }
  const withHistory = pastWeeks.filter((n) => n > 0);
  const maxHp = withHistory.length > 0
    ? Math.max(10, Math.round(median(withHistory)))
    : Math.max(10, 5 * active.length);

  const slain = damage >= maxHp;

  // Kill streak: consecutive past weeks (newest first) at/above current HP.
  let killStreak = 0;
  for (const n of pastWeeks) {
    if (n >= maxHp) killStreak++;
    else break;
  }

  const daysLeft = 7 - dailyDamage.length + 1;

  return {
    weekKey,
    maxHp,
    damage,
    remaining: Math.max(0, maxHp - damage),
    slain,
    daysLeft,
    killStreak,
    dailyDamage,
  };
}
