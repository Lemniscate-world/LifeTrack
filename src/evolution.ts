// src/evolution.ts
// Pure, local "life evolution" engine. Every value is DERIVED from the user's
// real data (check-ins, achievements, urges, challenges) — never stored — so
// a reload, import or rollback can never lose progress and no double
// bookkeeping is possible.
//
// The core idea: each day the user "grows" a life score. The score reuses the
// exact same weights as the XP engine (gamification.ts) so the numbers are
// consistent everywhere in the app. This module answers the question
// "how much have I evolved compared to yesterday / last week / last month?"

import type { Challenge, CheckIn, Habit, Note, UrgeEntry } from './types';
import { XP_RULES } from './gamification';
import { toDateKey, shiftDateKey, isoToDateKey, isDateKey } from './dates';

// --- Per-day derived score ---

export interface DayScore {
  date: string;             // YYYY-MM-DD
  score: number;            // composite "growth" score for that day
  completed: number;        // completed check-ins
  goalDays: number;         // habits whose daily goal was met
  achievements: number;     // notes tagged as achievements that day
  urgesSurfed: number;      // urges ridden to the end that day
  challengesDone: number;   // challenges completed that day
}

/** ISO/date strings → YYYY-MM-DD (safe for notes/urges/challenges timestamps). */

/**
 * Life score for one day.
 *
 * Weights mirror XP_RULES (10 / 15 / 20 / 50) plus 10 per urge surfed, so the
 * daily score is comparable to the XP the user sees elsewhere — one number to
 * answer "how much did I grow today?".
 */
export function dayLifeScore(
  day: string,
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
): DayScore {
  const goalByHabit = new Map<string, number>();
  for (const h of habits) goalByHabit.set(h.id, Math.max(1, h.goal || 1));

  let completed = 0;
  let goalDays = 0;
  const perHabit = new Map<string, number>();
  for (const ci of checkIns) {
    if (!ci.completed || ci.date !== day) continue;
    completed += ci.count ?? 1;
    perHabit.set(ci.habitId, (perHabit.get(ci.habitId) ?? 0) + (ci.count ?? 1));
  }
  for (const [habitId, count] of perHabit) {
    if (count >= (goalByHabit.get(habitId) ?? 1)) goalDays++;
  }

  const achievements = notes.filter(
    (n) => n.achievementCategory && isoToDateKey(n.createdAt) === day,
  ).length;

  const urgesSurfed = urges.filter(
    (u) => u.outcome === 'surfed' && isoToDateKey(u.startTime) === day,
  ).length;

  const challengesDone = challenges.filter(
    (c) => c.status === 'completed' && isoToDateKey(c.completedAt ?? c.startDate) === day,
  ).length;

  const score =
    completed * XP_RULES.checkIn +
    goalDays * XP_RULES.goalDay +
    achievements * XP_RULES.achievement +
    challengesDone * XP_RULES.challenge +
    urgesSurfed * 10;

  return { date: day, score, completed, goalDays, achievements, urgesSurfed, challengesDone };
}

/** Life score series over [fromKey, toKey] inclusive, oldest → newest. */
export function lifeScoreSeries(
  fromKey: string,
  toKey: string,
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
): DayScore[] {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return [];
  if (fromKey > toKey) return [];
  const out: DayScore[] = [];
  let cursor = fromKey;
  let guard = 0;
  while (cursor <= toKey && guard < 2000) {
    out.push(dayLifeScore(cursor, habits, checkIns, notes, urges, challenges));
    cursor = shiftDateKey(cursor, 1);
    guard++;
  }
  return out;
}

/** All scored days that actually have data, oldest → newest (chart-friendly). */
export function scoredDays(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
): DayScore[] {
  let min = '';
  let max = '';
  for (const ci of checkIns) {
    if (!ci.completed || !isDateKey(ci.date)) continue;
    if (!min || ci.date < min) min = ci.date;
    if (!max || ci.date > max) max = ci.date;
  }
  for (const n of notes) {
    if (!n.achievementCategory) continue;
    const k = isoToDateKey(n.createdAt);
    if (!k) continue;
    if (!min || k < min) min = k;
    if (!max || k > max) max = k;
  }
  for (const u of urges) {
    if (u.outcome !== 'surfed') continue;
    const k = isoToDateKey(u.startTime);
    if (!k) continue;
    if (!min || k < min) min = k;
    if (!max || k > max) max = k;
  }
  if (!min) return [];
  return lifeScoreSeries(min, max, habits, checkIns, notes, urges, challenges);
}

// --- Comparisons ("vs who you were yesterday / last week / last month") ---

export interface EvolutionDelta {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number;   // relative change vs previous, rounded
  improved: boolean;
}

function sum(scores: DayScore[]): number {
  return scores.reduce((s, x) => s + x.score, 0);
}

/** Compare a trailing window ending `endKey` with the same-length window before it. */
export function windowDelta(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
  endKey: string,
  windowDays: number,
): EvolutionDelta {
  const fromCur = shiftDateKey(endKey, -(windowDays - 1));
  const toPrev = shiftDateKey(endKey, -windowDays);
  const fromPrev = shiftDateKey(toPrev, -(windowDays - 1));

  const current = sum(lifeScoreSeries(fromCur, endKey, habits, checkIns, notes, urges, challenges));
  const previous = sum(lifeScoreSeries(fromPrev, toPrev, habits, checkIns, notes, urges, challenges));
  const delta = current - previous;
  const deltaPct = previous > 0
    ? Math.round((delta / previous) * 100)
    : current > 0 ? 100 : 0;

  return { current, previous, delta, deltaPct, improved: current >= previous };
}

export interface EvolutionSummary {
  today: DayScore | null;
  yesterday: DayScore | null;
  dayDelta: EvolutionDelta | null;       // today vs yesterday (single day)
  weekDelta: EvolutionDelta | null;      // last 7 days vs the 7 before
  monthDelta: EvolutionDelta | null;     // last 30 days vs the 30 before
  bestDay: { date: string; score: number } | null;
  activeDays: number;                    // days in the series with score > 0
  totalScore: number;                    // lifetime growth score
}

export function evolutionSummary(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
  now: Date = new Date(),
): EvolutionSummary {
  const todayKey = toDateKey(now);
  const series = scoredDays(habits, checkIns, notes, urges, challenges);
  if (series.length === 0) {
    return { today: null, yesterday: null, dayDelta: null, weekDelta: null, monthDelta: null, bestDay: null, activeDays: 0, totalScore: 0 };
  }

  const today = series.find((s) => s.date === todayKey) ?? null;
  const yesterdayKey = shiftDateKey(todayKey, -1);
  const yesterday = series.find((s) => s.date === yesterdayKey) ?? null;

  const dayDelta: EvolutionDelta | null =
    today && yesterday
      ? {
          current: today.score,
          previous: yesterday.score,
          delta: today.score - yesterday.score,
          deltaPct: yesterday.score > 0 ? Math.round(((today.score - yesterday.score) / yesterday.score) * 100) : today.score > 0 ? 100 : 0,
          improved: today.score >= yesterday.score,
        }
      : today
        ? { current: today.score, previous: 0, delta: today.score, deltaPct: 100, improved: true }
        : null;

  const weekDelta = windowDelta(habits, checkIns, notes, urges, challenges, todayKey, 7);
  const monthDelta = windowDelta(habits, checkIns, notes, urges, challenges, todayKey, 30);

  let bestDay: { date: string; score: number } | null = null;
  let activeDays = 0;
  let totalScore = 0;
  for (const s of series) {
    totalScore += s.score;
    if (s.score > 0) activeDays++;
    if (!bestDay || s.score > bestDay.score) bestDay = { date: s.date, score: s.score };
  }

  return { today, yesterday, dayDelta, weekDelta, monthDelta, bestDay, activeDays, totalScore };
}
