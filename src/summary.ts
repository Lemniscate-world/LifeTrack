// src/summary.ts
// Pure, local "deep summary" engine. Everything here is DERIVED from the user's
// real data (check-ins, notes/achievements, urges, challenges) — never stored —
// so a reload, import or rollback can never lose progress.
//
// Two kinds of output:
//   1. Local sentences: short French phrases generated on-device from the
//      current evolution + XP + medals. These work with zero network and give
//      an instant "here is where you are" recap.
//   2. Window comparison: a structured "before vs after" snapshot of two
//      periods of equal length, which the Rust side can turn into a
//      before/after narrative via the AI provider.

import type { Challenge, CheckIn, Habit, Note, UrgeEntry } from './types';
import { XP_RULES, type Medal } from './gamification';
import { lifeScoreSeries, type DayScore } from './evolution';
import { toDateKey, shiftDateKey, isoToDateKey } from './dates';

// --- Window metrics (one period of the user's life) ---

export interface WindowMetrics {
  windowDays: number;
  xp: number;             // XP from check-ins + goal-days inside the window
  score: number;          // daily life-growth score summed over the window
  completed: number;      // completed check-ins
  goalDays: number;       // habit-days where the daily goal was met
  achievements: number;   // notes tagged as achievements in the window
  urgesLogged: number;    // urges recorded in the window
  urgesSurfed: number;    // urges ridden to the end in the window
  surfRate: number;       // % of recorded urges that were surfed (0-100)
  challenges: number;     // challenges completed in the window
  activeDays: number;     // days in the window with a score > 0
}

/** Aggregate one inclusive [fromKey, toKey] window. Keys are YYYY-MM-DD. */
export function windowMetrics(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
  fromKey: string,
  toKey: string,
): WindowMetrics {
  const series: DayScore[] = lifeScoreSeries(fromKey, toKey, habits, checkIns, notes, urges, challenges);

  let xp = 0;
  let completed = 0;
  let goalDays = 0;
  let score = 0;
  let activeDays = 0;
  let achievements = 0;
  let challengesDone = 0;
  for (const d of series) {
    xp += d.completed * XP_RULES.checkIn + d.goalDays * XP_RULES.goalDay;
    completed += d.completed;
    goalDays += d.goalDays;
    score += d.score;
    achievements += d.achievements;
    challengesDone += d.challengesDone;
    if (d.score > 0) activeDays++;
  }

  // Urges are not part of a scored day — derive them directly.
  let urgesSurfed = 0;
  let urgesInWindow = 0;
  for (const u of urges) {
    const k = isoToDateKey(u.startTime);
    if (!k || k < fromKey || k > toKey) continue;
    urgesInWindow++;
    if (u.outcome === 'surfed') urgesSurfed++;
  }

  const windowDays = Math.max(1, Math.round((new Date(toKey).getTime() - new Date(fromKey).getTime()) / 86400000) + 1);
  return {
    windowDays,
    xp,
    score,
    completed,
    goalDays,
    achievements,
    urgesSurfed,
    urgesLogged: urgesInWindow,
    surfRate: urgesInWindow > 0 ? Math.round((urgesSurfed / urgesInWindow) * 100) : 0,
    challenges: challengesDone,
    activeDays,
  };
}

// --- Two-window comparison ("before vs after") ------------------------

export interface PeriodDelta {
  key: string;
  label: string;          // human label for the metric
  before: number;
  after: number;
  delta: number;          // after - before
  deltaPct: number;       // relative change, rounded
  improved: boolean;      // which direction counts as an improvement
}

export interface DeepCompare {
  before: WindowMetrics;
  after: WindowMetrics;
  deltas: PeriodDelta[];
}

/**
 * Compare the most recent `windowDays` against the `windowDays` before it.
 * Returns null when neither period has any scored days (no story to tell).
 */
export function compareWindows(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  challenges: Challenge[],
  windowDays = 30,
  now: Date = new Date(),
): DeepCompare | null {
  const toAfter = toDateKey(now);
  const fromAfter = shiftDateKey(toAfter, -(windowDays - 1));
  const toBefore = shiftDateKey(toAfter, -windowDays);
  const fromBefore = shiftDateKey(toBefore, -(windowDays - 1));

  const before = windowMetrics(habits, checkIns, notes, urges, challenges, fromBefore, toBefore);
  const after = windowMetrics(habits, checkIns, notes, urges, challenges, fromAfter, toAfter);

  if (before.activeDays === 0 && after.activeDays === 0) return null;

  const mk = (key: string, label: string, b: number, a: number): PeriodDelta => {
    const delta = a - b;
    const deltaPct = b !== 0 ? Math.round((delta / Math.abs(b)) * 100) : a !== 0 ? 100 : 0;
    const improved = a >= b;
    return { key, label, before: b, after: a, delta, deltaPct, improved };
  };

  const deltas: PeriodDelta[] = [
    mk('xp', 'XP gagnée', before.xp, after.xp),
    mk('score', 'Score de vie', before.score, after.score),
    mk('completed', 'Check-ins', before.completed, after.completed),
    mk('goalDays', 'Objectifs tenus', before.goalDays, after.goalDays),
    mk('achievements', 'Victoires', before.achievements, after.achievements),
    mk('challenges', 'Défis', before.challenges, after.challenges),
    mk('surfRate', 'Urges surfées (%)', before.surfRate, after.surfRate),
    mk('activeDays', 'Jours actifs', before.activeDays, after.activeDays),
  ];

  return { before, after, deltas };
}

// --- Local (no-AI) summary sentences ---------------------------------

export interface DeepSummaryInput {
  evolutionScore: number;        // lifetime growth score
  activeDays: number;
  xp: number;
  level: number;
  medals: Medal[];
  weekImproved: boolean;
  bestDayScore: number;
  urgesSurfed: number;
  moodsLogged: number;
}

/**
 * Generate a short list (3-5) of encouraging sentences, entirely on-device.
 * Ordered from most concrete/encouraging to most neutral.
 */
export function buildLocalSummary(input: DeepSummaryInput): string[] {
  const lines: string[] = [];
  const earned = input.medals.filter((m) => m.earned).length;

  if (input.activeDays > 0) {
    lines.push(
      `${
        input.xp > 0 ? `Vous avez gagné ${input.xp} XP, ` : 'Vous êtes à '
      }niveau ${input.level} avec un score de vie de ${input.evolutionScore} sur ${input.activeDays} jours actifs.`,
    );
  } else {
    lines.push(`Vous totalisez ${input.evolutionScore} points de croissance.`);
  }

  if (input.weekImproved) {
    lines.push('Cette semaine bat la précédente : votre élan continue de grandir.');
  } else {
    lines.push('Chaque jour est une occasion de repartir plus fort.');
  }

  if (input.urgesSurfed > 0) {
    lines.push(`Vous avez surfé ${input.urgesSurfed} urge${input.urgesSurfed > 1 ? 's' : ''} au lieu d'y céder.`);
  }
  if (input.moodsLogged > 0) {
    lines.push(`Vous avez consigné votre humeur sur ${input.moodsLogged} jour${input.moodsLogged > 1 ? 's' : ''}.`);
  }

  lines.push(`Vous avez remporté ${earned} médaille${earned > 1 ? 's' : ''}.`);

  return lines.slice(0, 5);
}