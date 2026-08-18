// src/challengeSuggestions.ts
// Challenges RECOMMENDED by behavioral analysis — the missing link that makes
// LifeTrack propose challenges instead of only letting you create them.
//
// It reads the same signals the rest of the app already computes (streaks,
// reflections, correlations) and turns them into concrete, adaptive challenge
// suggestions with an EXPLICIT rationale ("why this challenge, why now").
//
// Pure module: (data) → suggestions. No store, fully testable.

import type { Habit, CheckIn, DetectedReflection, CorrelationResult } from './types';
import { computeStreakStats } from './stats';
import { toDateKey } from './dates';

export type ChallengeSuggestionKind =
  | 'stale-recovery'   // was strong, went silent → re-ignite
  | 'neglected'        // consistently low → build a floor
  | 'correlation'      // strongly associated with better mood → consolidate
  | 'streak'           // near a record → push through

export interface ChallengeSuggestion {
  habitId: string;
  habitName: string;
  days: number;
  dailyGoal: number;
  title: string;
  rationale: string;
  kind: ChallengeSuggestionKind;
  adaptive: boolean;
}

function recentRate(habitId: string, checkIns: CheckIn[], days: number, now: Date): number {
  const start = toDateKey(new Date(now.getTime() - (days - 1) * 86400000));
  const set = new Set<string>();
  for (const c of checkIns) {
    if (c.habitId === habitId && c.completed && c.date >= start) set.add(c.date);
  }
  return set.size;
}

function dailyGoalFor(recent: number, days: number): number {
  // Adaptive (challenges.ts philosophy): goal leans on recent history.
  const avg = recent / Math.max(1, days);
  return Math.max(1, Math.round(avg * 0.75));
}

/**
 * Suggest challenges from real behavior. Returns at most `limit` suggestions,
 * sorted by strength of signal, each with a transparent rationale.
 */
export function suggestChallenges(
  habits: Habit[],
  checkIns: CheckIn[],
  reflections: DetectedReflection[],
  correlations: CorrelationResult[],
  now: Date = new Date(),
  limit = 4,
): ChallengeSuggestion[] {
  const out: ChallengeSuggestion[] = [];
  const active = habits.filter((h) => !h.archived);
  if (active.length === 0) return out;

  // 1. stale-recovery: a reflection flagged a habit that was strong then silent.
  const staleKeys = new Set<string>();
  for (const r of reflections) {
    if (r.kind === 'stale-win' && r.habitIds.length > 0) {
      for (const id of r.habitIds) staleKeys.add(id);
    }
  }
  for (const h of active) {
    if (!staleKeys.has(h.id)) continue;
    const recent = recentRate(h.id, checkIns, 7, now);
    out.push({
      habitId: h.id,
      habitName: h.name,
      days: 14,
      dailyGoal: dailyGoalFor(recent, 7),
      title: `Relancer « ${h.name} »`,
      rationale: `« ${h.name} » était fort récemment puis s'est éteint cette semaine. Un challenge de 14 jours reprend la dynamique sans objectif irréaliste.`,
      kind: 'stale-recovery',
      adaptive: true,
    });
  }

  // 2. correlation: a habit is significantly tied to a better mood → consolidate it.
  for (const corr of correlations) {
    if (!corr.significant || corr.coefficient <= 0) continue;
    const habit = active.find((h) => h.id === corr.metricA || h.name === corr.metricA)
      ?? active.find((h) => h.id === corr.metricB || h.name === corr.metricB);
    if (!habit) continue;
    if (out.some((s) => s.habitId === habit.id)) continue;
    const recent = recentRate(habit.id, checkIns, 7, now);
    out.push({
      habitId: habit.id,
      habitName: habit.name,
      days: 21,
      dailyGoal: dailyGoalFor(recent, 7),
      title: `Consolider « ${habit.name} »`,
      rationale: `« ${habit.name} » corrèle significativement avec une meilleure humeur (${corr.direction}, ${corr.strength}). Un cycle de 21 jours l'ancre en habitude.`,
      kind: 'correlation',
      adaptive: true,
    });
  }

  // 3. neglected: consistently below 40% the last 14 days → build a durable floor.
  for (const h of active) {
    if (out.some((s) => s.habitId === h.id)) continue;
    const recent = recentRate(h.id, checkIns, 14, now);
    if (recentRate(h.id, checkIns, 14, now) / 14 < 0.4 && recent > 0) {
      out.push({
        habitId: h.id,
        habitName: h.name,
        days: 14,
        dailyGoal: 1,
        title: `Poser une base sur « ${h.name} »`,
        rationale: `« ${h.name} » est tenue moins de 40% des 14 derniers jours. Un objectif minimal et durable (1×/jour) vaut mieux que rien.`,
        kind: 'neglected',
        adaptive: false,
      });
    }
  }

  // 4. streak: a habit is within 3 days of its personal best → push through.
  for (const h of active) {
    if (out.some((s) => s.habitId === h.id)) continue;
    const stats = computeStreakStats(h, checkIns, now);
    if (stats.best >= 5 && stats.current > 0 && stats.current >= stats.best - 3 && stats.current < stats.best) {
      out.push({
        habitId: h.id,
        habitName: h.name,
        days: Math.min(30, stats.current + 3),
        dailyGoal: 1,
        title: `Battre le record de « ${h.name} » (${stats.best}j)`,
        rationale: `Tu es à ${stats.current} jours, à ${stats.best - stats.current} jour(s) de ton meilleur (${stats.best}). Termine la montée.`,
        kind: 'streak',
        adaptive: false,
      });
    }
  }

  return out.slice(0, limit);
}
