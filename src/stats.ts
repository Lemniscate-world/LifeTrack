// src/stats.ts
// Pure, dependency-free statistics functions for habit completion data.
// All functions are pure (input → output) so they are easy to test in isolation.
// They operate on arrays of CheckIn objects plus a reference date.
//
// Definitions:
//   - "completed day"  : a CheckIn with completed=true for a (habitId, date) pair
//   - "missed day"     : either no CheckIn OR a CheckIn with completed=false
//   - "current streak" : count of consecutive completed days ending at the most
//                        recent completion, with no missed days in between.
//                        If the most recent day relative to `today` is missed,
//                        the current streak is 0.
//   - "best streak"    : longest run of consecutive completed days across ALL
//                        history for the habit (the all-time record).
//   - "longest gap"    : longest run of consecutive missed days in history.
//   - "completion rate": ratio of completed days to total trackable days in a
//                        given window (rolling 30/90/365).
//
// Tracking boundary:
//   A habit only "exists" from its createdAt onward (or earlier if a back-dated
//   check-in exists). Days before the tracking start are excluded from gaps and
//   rates so the user is not penalised for not having a tool yet.

import type { CheckIn, Habit } from './types';

// --- Date helpers (date-only, UTC-naive — local civil date strings) ---

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000;
  const ad = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bd = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bd - ad) / ms);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// --- Internal: build a date-keyed map of completion status for a habit ---

type CompletionMap = Map<string, boolean>; // true = completed, false = missed-but-recorded

function buildCompletionMap(habitId: string, checkIns: CheckIn[]): CompletionMap {
  const m: CompletionMap = new Map();
  for (const c of checkIns) {
    if (c.habitId !== habitId) continue;
    m.set(c.date, c.completed);
  }
  return m;
}

// Tracking start: earliest of createdAt (date part) or earliest check-in date.
// Returns null when neither is known.
export function trackingStart(habit: Habit, checkIns: CheckIn[]): Date | null {
  let start: Date | null = null;
  if (habit.createdAt) {
    const c = new Date(habit.createdAt);
    if (!Number.isNaN(c.getTime())) {
      start = new Date(c.getFullYear(), c.getMonth(), c.getDate());
    }
  }
  for (const ci of checkIns) {
    if (ci.habitId !== habit.id) continue;
    // Reject malformed dates (e.g. '2026-02-30', '2026-13-01') that JS would
    // otherwise silently normalize to a different valid date.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ci.date)) continue;
    const [y, m, dd] = ci.date.split('-').map(Number);
    if (!y || !m || !dd || m < 1 || m > 12 || dd < 1 || dd > 31) continue;
    const d = new Date(y, m - 1, dd);
    // Belt-and-braces: if Date normalization happened (e.g. '2026-02-30' → Mar 2),
    // verify the round-trip. If they differ, skip this entry.
    if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) continue;
    if (!start || d < start) start = d;
  }
  return start;
}

// --- Public API ---

export interface StreakStats {
  current: number;     // current completed-days streak ending today (0 if today missed)
  best: number;        // longest completed-days streak ever recorded
  bestAt: string;      // YYYY-MM-DD of the END of the best streak (null when 0)
  longestGap: number;  // longest run of consecutive missed days
  longestGapAt: string; // YYYY-MM-DD of the END of the longest gap (null when 0)
  totalCompleted: number; // total completed check-ins (all time)
  totalTracked: number;   // total days from trackingStart to today (inclusive)
}

/**
 * Compute full streak statistics for a habit as of `today` (defaults to now).
 * Pure: same inputs → same output. Safe to call on every render.
 */
export function computeStreakStats(
  habit: Habit,
  checkIns: CheckIn[],
  today: Date = new Date(),
): StreakStats {
  const completions = buildCompletionMap(habit.id, checkIns);
  const start = trackingStart(habit, checkIns);
  const todayKey = toDateKey(today);

  // --- Current streak ---
  // Walk backward from today. Today counts only if explicitly completed.
  // Yesterday onward counts as completed only when an entry exists and is true.
  let current = 0;
  if (completions.get(todayKey) === true) {
    current = 1;
    let cursor = addDays(today, -1);
    while (true) {
      const key = toDateKey(cursor);
      if (start) {
        const startKey = toDateKey(start);
        if (key < startKey) break;
      }
      if (completions.get(key) === true) {
        current++;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }
  }

  // --- Iterate every tracked day once to find best streak and longest gap ---
  let best = 0;
  let bestAt = '';
  let bestRunStart: string | null = null;

  let longestGap = 0;
  let longestGapAt = '';
  let gapRunStart: string | null = null;

  let runCompleted = 0;
  let runCompletedStart: string | null = null;
  let runMissed = 0;
  let runMissedStart: string | null = null;

  let totalCompleted = 0;
  let totalTracked = 0;

  // Walk from trackingStart (or earliest completion) to today, inclusive.
  // Special case: if trackingStart === today, there is only one tracked day
  // (today itself) — and the user has not yet had a chance to mark it.
  // We still iterate so current/best/totalTracked are consistent, but we do
  // not promote a same-day "miss" into the longestGap tally.
  const cursor = start ?? today;
  let d = new Date(cursor);
  const sameDay = cursor.getFullYear() === today.getFullYear()
    && cursor.getMonth() === today.getMonth()
    && cursor.getDate() === today.getDate();

  while (d <= today) {
    totalTracked++;
    const key = toDateKey(d);
    const v = completions.get(key);

    if (v === true) {
      totalCompleted++;
      if (runCompleted === 0) runCompletedStart = key;
      runCompleted++;
      if (runCompleted > best) {
        best = runCompleted;
        bestRunStart = runCompletedStart;
        bestAt = key;
      }
      // A completed day breaks a missed run.
      if (runMissed > 0) {
        if (!sameDay && runMissed > longestGap) {
          longestGap = runMissed;
          gapRunStart = runMissedStart;
          longestGapAt = key; // gap ends the day BEFORE this completion
        }
        runMissed = 0;
        runMissedStart = null;
      }
    } else {
      // v === undefined (no entry) OR v === false (explicitly uncompleted)
      // Both count as a missed day for streak/gap purposes — UNLESS this is
      // the same-day creation case (see comment above).
      if (runMissed === 0) runMissedStart = key;
      runMissed++;
      if (runCompleted > 0) {
        if (runCompleted > best) {
          best = runCompleted;
          bestRunStart = runCompletedStart;
          bestAt = key; // ends the day before this miss
        }
        runCompleted = 0;
        runCompletedStart = null;
      }
    }

    d = addDays(d, 1);
  }

  // Tally trailing open runs (streak/gap still in progress at today).
  // Suppress gap tally in the same-day-creation case.
  if (runCompleted > best) {
    best = runCompleted;
    bestRunStart = runCompletedStart;
    bestAt = toDateKey(today);
  }
  if (!sameDay && runMissed > longestGap) {
    longestGap = runMissed;
    gapRunStart = runMissedStart;
    longestGapAt = toDateKey(today);
  }

  // Suppress unused-var warnings while keeping the code self-documenting
  void bestRunStart;
  void gapRunStart;

  return {
    current,
    best,
    bestAt,
    longestGap,
    longestGapAt,
    totalCompleted,
    totalTracked,
  };
}

/**
 * Completion rate over a rolling window of `windowDays` ending at `today`.
 * Returns a number in [0, 100]. If the window extends before the tracking
 * start, only the days from tracking start to today are considered.
 */
export function computeCompletionRate(
  habit: Habit,
  checkIns: CheckIn[],
  windowDays: number,
  today: Date = new Date(),
): number {
  if (windowDays <= 0) return 0;
  const completions = buildCompletionMap(habit.id, checkIns);
  const start = trackingStart(habit, checkIns);

  const windowStart = addDays(today, -(windowDays - 1));
  const effectiveStart = start && start > windowStart ? start : windowStart;

  let completed = 0;
  let total = 0;
  for (let d = new Date(effectiveStart); d <= today; d = addDays(d, 1)) {
    total++;
    if (completions.get(toDateKey(d)) === true) completed++;
  }
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Weighted score for a habit over a 30-day window.
 *
 * The score combines:
 *   - Completion rate (0–100) over the window.
 *   - A small streak bonus: +1 point per consecutive completed day, capped
 *     at +20. This rewards consistency without overweighting single long runs.
 *
 * Final score is clamped to [0, 100].
 */
export function computeWeightedScore(
  habit: Habit,
  checkIns: CheckIn[],
  today: Date = new Date(),
): number {
  const rate = computeCompletionRate(habit, checkIns, 30, today);
  const stats = computeStreakStats(habit, checkIns, today);
  const streakBonus = Math.min(20, stats.current);
  return Math.max(0, Math.min(100, rate + streakBonus));
}