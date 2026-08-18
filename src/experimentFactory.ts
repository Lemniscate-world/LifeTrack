// src/experimentFactory.ts
// Turns analysis into ACTION: a correlation (or a weakness) becomes a
// testable N=1 experiment hypothesis. This is the bridge that makes LifeTrack
// PROPOSE experiments instead of just displaying correlations.
//
// Pure module, no store access — unit-testable in isolation.

import type { CorrelationResult, Habit } from './types';
import { toDateKey, shiftDateKey } from './dates';

export interface ExperimentDraft {
  title: string;
  hypothesis: string;
  rationale: string;
  linkedHabits: string[];
  linkedMetrics: string[];   // 'mood' | capacity ids
  startDate: string;         // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD (startDate + suggestedDays - 1)
  suggestedDays: number;
}

const MOOD_NAMES = new Set(['mood', 'humeur', 'Mood']);

/**
 * Convert a significant correlation into a testable experiment.
 *
 * Strategy: whichever side of the correlation is a HABIT becomes the
 * intervention; the other side (mood / capacity) becomes the metric. Sample
 * size is honest: we use the number of days the stats engine says is needed to
 * detect that effect size at 80% power (min 14, max 90).
 */
export function correlationToExperiment(
  corr: CorrelationResult,
  habits: Habit[],
  now: Date = new Date(),
): ExperimentDraft | null {
  const nameOf = (id: string): string => habits.find((h) => h.id === id)?.name ?? id;

  // Find the habit side.
  const findHabitIn = (metric: string): string | undefined =>
    habits.find((h) => h.id === metric || h.name === metric)?.id;

  let habitId: string | undefined;
  let other: string;
  if (findHabitIn(corr.metricA)) {
    habitId = findHabitIn(corr.metricA);
    other = corr.metricB;
  } else if (findHabitIn(corr.metricB)) {
    habitId = findHabitIn(corr.metricB);
    other = corr.metricA;
  } else {
    return null;
  }

  const habitName = nameOf(habitId!);
  const isMood = MOOD_NAMES.has(other);
  const outcome = isMood ? 'mood' : other;
  const outcomeName = isMood ? 'l’humeur' : other;

  const positive = corr.coefficient >= 0;
  const direction = positive ? 'améliore' : 'dégrade';
  const startDate = toDateKey(now);
  const suggestedDays = Math.max(14, Math.min(90, corr.requiredN || 30));
  const endDate = shiftDateKey(startDate, suggestedDays - 1);

  return {
    title: `Hypothèse : « ${habitName} » et ${outcomeName}`,
    hypothesis: `Si je pratique « ${habitName} » plus régulièrement, ${outcomeName} ${direction} (constaté : ${corr.direction}, ${corr.strength}).`,
    rationale: `Corrélation ${corr.method === 'spearman' ? 'de rang' : 'de Pearson'} ${corr.coefficient >= 0 ? '+' : ''}${corr.coefficient.toFixed(2)} (n=${corr.sampleSize}, p=${corr.pValue.toFixed(3)}). ${suggestedDays} jours suffisent pour détecter cet effet à 80 % de puissance.`,
    linkedHabits: [habitId!],
    linkedMetrics: [outcome],
    startDate,
    endDate,
    suggestedDays,
  };
}

/**
 * A weakness → experiment: a habit that is falling behind can become a small,
 * safe N=1 test instead of a source of guilt.
 */
export function weaknessToExperiment(
  habit: Habit,
  recentRate: number,   // 0-100 over the last 7 days
  now: Date = new Date(),
): ExperimentDraft {
  const startDate = toDateKey(now);
  const suggestedDays = 21;
  const endDate = shiftDateKey(startDate, suggestedDays - 1);
  return {
    title: `Micro-expérience sur « ${habit.name} »`,
    hypothesis: `Si je réduis la barre de « ${habit.name} » (objectif ≤${Math.max(1, Math.round((recentRate / 100) * 7))}/sem) pendant ${suggestedDays} jours, ma constance remonte sans culpabilité.`,
    rationale: `Seulement ${Math.round(recentRate)}% des 7 derniers jours réussis. Plutôt que d'exiger plus, tester une barre minimale durable.`,
    linkedHabits: [habit.id],
    linkedMetrics: ['mood'],
    startDate,
    endDate,
    suggestedDays,
  };
}
