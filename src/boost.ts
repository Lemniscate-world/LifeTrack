// src/boost.ts
// "Relance des anciennes victoires" — the anti-forgetting engine for past wins.
// A habit that once hit a great streak (bestStreak >= MIN_BEST) then went quiet
// is a LIVING memory of capability. LifeTrack surfaces these so the user can
// revive them deliberately as a fresh adaptive challenge — instead of silently
// losing a record they've already proven they can hit.
//
// Pure module: (habits, checkIns) → candidate old wins. No UI, no store.

import type { Habit, CheckIn } from './types';
import { computeStreakStats } from './stats';
import { suggestAdaptiveTarget, type AdaptiveSuggestion } from './challenges';
import { todayKey, daysBetweenKeys } from './dates';

/** Minimum best-streak length a habit needs to count as a "won" past. */
export const MIN_BEST_STREAK = 5;
/** A best streak only counts as "old" once it ended at least this many days ago. */
export const MIN_WIN_AGE_DAYS = 7;
/** How quiet a habit must now be before we call it faded (days since completion). */
export const MIN_FADE_DAYS = 3;

export interface FadedWin {
  habit: Habit;
  bestStreak: number;
  bestStreakEndedAt: string;   // bestStreakAt value
  daysSinceBest: number;       // how old the win is
  currentStreak: number;       // current ongoing streak
  lastCompletedOn: string | null;
  daysSinceLastCompletion: number;
  faded: boolean;              // currently quiet (>= MIN_FADE_DAYS since completion)
  suggestion: AdaptiveSuggestion;
/** The exact challenge config a "Relancer" button would create. */
  revive: { days: number; dailyGoal: number; adaptive: boolean };
  /** Short human call-to-action for this revival. */
  revival: string;}

/**
 * Find habits whose all-time best streak has gone quiet, and whose record is
 * now at risk of being forgotten. Deterministic; oldest-win first.
 */
export function detectFadedWins(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date = new Date(),
): FadedWin[] {
  const today = todayKey(now);
  const active = habits.filter((h) => !h.archived);
  const wins: FadedWin[] = [];

  for (const habit of active) {
    const stats = computeStreakStats(habit, checkIns, now);
    const best = habit.bestStreak ?? Math.max(stats.best, 0);
    const bestAt = habit.bestStreakAt ?? stats.bestAt ?? '';
    if (best < MIN_BEST_STREAK || !bestAt) continue;

    const daysSinceBest = Math.max(0, daysBetweenKeys(bestAt, today));
    if (daysSinceBest < MIN_WIN_AGE_DAYS) continue;

    const lastDone = checkIns
      .filter((ci) => ci.habitId === habit.id && ci.completed)
      .map((ci) => ci.date)
      .sort()
      .pop();
    const daysSinceLast = lastDone
      ? Math.max(0, daysBetweenKeys(lastDone, today))
      : Infinity;

    // Faded = records quiet now: nothing completed for a while, and the win is old.
    const faded = daysSinceLast >= MIN_FADE_DAYS;

    const suggestion = suggestAdaptiveTarget(habit, checkIns, 14, now);
    const reviveDays = best >= 14 ? 21 : best >= 7 ? 14 : MIN_WIN_AGE_DAYS;

    wins.push({
      habit,
      bestStreak: best,
      bestStreakEndedAt: bestAt,
      daysSinceBest,
      currentStreak: stats.current,
      lastCompletedOn: lastDone ?? null,
      daysSinceLastCompletion: daysSinceLast,
      faded,
      suggestion,
      revive: {
        days: reviveDays,
        dailyGoal: suggestion.dailyGoal,
        adaptive: true,
      },
      revival: buildRevivalLabel(habit.name, best, reviveDays),
    });
  }

  // Oldest faded wins first (most at risk of being forgotten), faded first.
  wins.sort((a, b) => {
    if (a.faded !== b.faded) return a.faded ? -1 : 1;
    return b.daysSinceBest - a.daysSinceBest;
  });
  return wins;
}

function buildRevivalLabel(name: string, best: number, days: number): string {
  return `Relance « ${name} » — re-monte ton record de ${best} jours sur ${days} jours.`;
}