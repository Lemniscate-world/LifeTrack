/**
 * Challenge engine — pure, local, testable.
 *
 * Persistent, adaptive challenges: a challenge attaches to a habit and has a
 * duration + daily goal. The daily goal is intelligently derived from the
 * habit's recent completion history (adaptive), so a habit the user already
 * does 3x/day gets a harder bar than one they barely manage.
 *
 * All functions are pure (no store access) so they can be unit-tested.
 */

import type { CheckIn, Habit } from './types';

export interface ChallengeProgress {
  completedDays: number;   // days where the daily goal was met
  totalDays: number;       // challenge.days
  currentStreak: number;   // consecutive qualifying days ending today/yesterday
  pct: number;             // completedDays / totalDays * 100
  daysRemaining: number;   // days left in the window
  isToday: boolean;        // is the last window day today?
}

/** Qualifying completions for a habit on a given date (0 if none). */
export function completionsOnDate(habitId: string, date: string, checkIns: CheckIn[]): number {
  let total = 0;
  for (const ci of checkIns) {
    if (ci.habitId !== habitId || ci.date !== date) continue;
    if (!ci.completed) continue;
    total += ci.count ?? 1;
  }
  return total;
}

/**
 * Compute progress for a challenge against a snapshot of check-ins.
 * `now` defaults to today's local date string. The window runs from
 * startDate to startDate + days - 1.
 */
export function computeChallengeProgress(
  habitId: string,
  startDate: string,
  days: number,
  dailyGoal: number,
  checkIns: CheckIn[],
  now: string,
): ChallengeProgress {
  const goal = Math.max(1, dailyGoal);
  // Build a date map for the window [startDate, startDate + days - 1]
  const [y, m, d] = startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    dates.push(toLocalDateKey(dt));
  }

  const isTodayDate = (key: string) => key === now;
  const todayIdx = dates.findIndex(isTodayDate);
  const lastWindowDate = dates[dates.length - 1];
  const isToday = isTodayDate(lastWindowDate) || todayIdx === dates.length - 1;

  let completedDays = 0;
  let currentStreak = 0;

  // Walk from the newest window day backward to compute streak + count days.
  for (let i = dates.length - 1; i >= 0; i--) {
    const dateKey = dates[i];
    const completions = completionsOnDate(habitId, dateKey, checkIns);
    const qualifies = completions >= goal;
    if (qualifies) {
      completedDays++;
      // Streak only counts consecutive qualifying days (ending at the newest
      // window day OR today if today is inside the window).
      if (i === dates.length - 1 || currentStreak > 0) {
        currentStreak++;
      } else if (dateKey === now) {
        currentStreak++;
      }
    } else {
      // Break the streak if we hit a non-qualifying day after the streak began.
      if (currentStreak > 0) break;
    }
  }

  const pct = days > 0 ? Math.round((completedDays / days) * 100) : 0;
  // Days remaining = window days not yet elapsed (inclusive of today if today
  // is inside the window and not the last day).
  let daysRemaining = 0;
  const nowDate = parseLocalDate(now);
  for (let i = 0; i < dates.length; i++) {
    const dt = parseLocalDate(dates[i]);
    if (dt >= nowDate) daysRemaining++;
  }

  return { completedDays, totalDays: days, currentStreak, pct, daysRemaining, isToday };
}

function toLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today's local date as YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return toLocalDateKey(now);
}

export interface AdaptiveSuggestion {
  days: number;        // suggested duration
  dailyGoal: number;   // suggested completions per day
  difficulty: 'gentle' | 'standard' | 'stretch';
  reason: string;      // human-readable explanation
}

/**
 * Suggest an adaptive challenge target for a habit based on its recent history.
 * Uses the last `windowDays` (default 14) days: if the user already completes
 * the habit reliably and often, raise the bar; if they're struggling, keep it
 * gentle so the challenge is winnable.
 */
export function suggestAdaptiveTarget(
  habit: Habit,
  checkIns: CheckIn[],
  windowDays = 14,
  now: Date = new Date(),
): AdaptiveSuggestion {
  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - i);
    dates.push(toLocalDateKey(dt));
  }

  let trackedDays = 0;
  let totalCompletions = 0;
  let maxDaily = 0;
  for (const dateKey of dates) {
    const completions = completionsOnDate(habit.id, dateKey, checkIns);
    if (completions > 0) trackedDays++;
    totalCompletions += completions;
    maxDaily = Math.max(maxDaily, completions);
  }

  const completionRate = trackedDays > 0 ? trackedDays / windowDays : 0;
  const avgPerDay = windowDays > 0 ? totalCompletions / windowDays : 0;
  const typicalDaily = Math.max(1, Math.round(avgPerDay));

  // Difficulty tiers based on how the habit is actually going.
  if (completionRate >= 0.75 && typicalDaily >= 2) {
    return {
      days: 30,
      dailyGoal: typicalDaily,
      difficulty: 'stretch',
      reason: `You already complete "${habit.name}" ~${Math.round(completionRate * 100)}% of days (${typicalDaily}×/day). A 30-day stretch at ${typicalDaily}×/day keeps you challenged.`,
    };
  }
  if (completionRate >= 0.75) {
    return {
      days: 30,
      dailyGoal: 1,
      difficulty: 'standard',
      reason: `You complete "${habit.name}" ${Math.round(completionRate * 100)}% of days. A 30-day streak locks in the momentum you already have.`,
    };
  }
  if (completionRate >= 0.4) {
    return {
      days: 21,
      dailyGoal: 1,
      difficulty: 'standard',
      reason: `You're at ~${Math.round(completionRate * 100)}% consistency on "${habit.name}". A 21-day challenge is achievable and builds a real streak.`,
    };
  }
  return {
    days: 14,
    dailyGoal: 1,
    difficulty: 'gentle',
    reason: `"${habit.name}" is at ${Math.round(completionRate * 100)}% lately. Start with a gentle 14-day streak — winning a small challenge beats failing a big one.`,
  };
}

/**
 * Pick the habit most worth challenging right now: the most neglected active
 * habit that isn't already in an active challenge. Returns null if every
 * active habit is already challenged.
 */
export function pickSuggestion(
  habits: Habit[],
  checkIns: CheckIn[],
  activeChallengeHabitIds: Set<string>,
  now: Date = new Date(),
): Habit | null {
  const active = habits
    .filter((h) => !h.archived)
    .filter((h) => !activeChallengeHabitIds.has(h.id));
  if (active.length === 0) return null;

  const today = todayKey(now);
  // Most neglected = longest time since last completion (never done counts high).
  const scored = active.map((h) => {
    const lastDate = checkIns
      .filter((ci) => ci.habitId === h.id && ci.completed)
      .map((ci) => ci.date)
      .sort()
      .pop();
    const neglect = !lastDate
      ? 999
      : Math.max(
          0,
          Math.round(
            (parseLocalDate(today).getTime() - parseLocalDate(lastDate).getTime()) / 86400000,
          ),
        );
    return { h, neglect };
  });
  scored.sort((a, b) => b.neglect - a.neglect);
  return scored[0]?.h ?? null;
}

/** Build a friendly challenge name, e.g. "30-day streak: Meditate". */
export function buildChallengeName(habitName: string, days: number, dailyGoal: number): string {
  if (dailyGoal > 1) return `${days}-day challenge: ${habitName} (${dailyGoal}×/day)`;
  return `${days}-day streak: ${habitName}`;
}
