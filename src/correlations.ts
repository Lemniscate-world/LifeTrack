// src/correlations.ts
// Pure computation engine for finding correlations between habits, mood, and capacities.
// All functions are pure (input → output) for easy testing.

import type { CheckIn, Habit, CapacityRating, CorrelationResult } from './types';
import { toDateKey } from './stats';

/** Mood value mapping for numerical correlation (higher = better) */
const MOOD_VALUES: Record<string, number> = {
  amazing: 5, great: 4, calm: 3, okay: 2, tired: 1, sick: 0, bad: -1, angry: -2,
};

/** Compute Pearson correlation coefficient between two arrays of equal length */
export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0; // too few points
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const sumY2 = ys.reduce((a, y) => a + y * y, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (den === 0) return 0;
  return num / den;
}

/** Build a daily time series for a habit's completion count */
function habitTimeSeries(habitId: string, checkIns: CheckIn[], days: string[]): number[] {
  const ciMap = new Map<string, number>();
  for (const c of checkIns) {
    if (c.habitId === habitId && c.completed) {
      ciMap.set(c.date, (ciMap.get(c.date) ?? 0) + (c.count ?? 1));
    }
  }
  return days.map(d => ciMap.get(d) ?? 0);
}

/** Build a daily time series for mood */
function moodTimeSeries(moods: Record<string, string>, days: string[]): number[] {
  return days.map(d => {
    const m = moods[d];
    return m ? (MOOD_VALUES[m] ?? 0) : 0;
  });
}

/** Build a daily time series for a capacity rating */
function capacityTimeSeries(capacityId: string, ratings: CapacityRating[], days: string[]): number[] {
  const rMap = new Map<string, number>();
  for (const r of ratings) {
    if (r.capacityId === capacityId && r.rating !== undefined) {
      rMap.set(r.date, r.rating);
    }
  }
  return days.map(d => rMap.get(d) ?? 0);
}

/** Get all dates with at least some data in a range */
function getActiveDays(
  startDate: string,
  endDate: string,
  checkIns: CheckIn[],
  moods: Record<string, string>,
): string[] {
  const days: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const d = new Date(start);
  while (d <= end) {
    days.push(toDateKey(d));
    d.setDate(d.getDate() + 1);
  }
  // Only keep days with at least 1 check-in or mood entry
  const ciDates = new Set(checkIns.map(c => c.date));
  const moodDates = new Set(Object.keys(moods));
  return days.filter(day => ciDates.has(day) || moodDates.has(day));
}

/** Classify correlation strength */
function classifyStrength(r: number): CorrelationResult['strength'] {
  const abs = Math.abs(r);
  if (abs >= 0.6) return 'strong';
  if (abs >= 0.3) return 'moderate';
  if (abs >= 0.1) return 'weak';
  return 'none';
}

/** Compute correlations between all habits and mood */
export function computeCorrelations(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  capacities: { id: string; name: string }[],
  ratings: CapacityRating[],
): CorrelationResult[] {
  const results: CorrelationResult[] = [];
  
  // Determine date range: last 90 days or all data
  const allDates = [
    ...checkIns.map(c => c.date),
    ...Object.keys(moods),
    ...ratings.map(r => r.date),
  ].sort();
  if (allDates.length < 3) return results;
  
  const startDate = allDates[0];
  const endDate = allDates[allDates.length - 1];
  const days = getActiveDays(startDate, endDate, checkIns, moods);
  if (days.length < 5) return results; // need minimum data

  // Habit vs Habit correlations
  const activeHabits = habits.filter(h => !h.archived);
  for (let i = 0; i < activeHabits.length; i++) {
    for (let j = i + 1; j < activeHabits.length; j++) {
      const xs = habitTimeSeries(activeHabits[i].id, checkIns, days);
      const ys = habitTimeSeries(activeHabits[j].id, checkIns, days);
      const r = pearsonR(xs, ys);
      if (Math.abs(r) >= 0.15) {
        results.push({
          metricA: activeHabits[i].name,
          metricB: activeHabits[j].name,
          coefficient: Math.round(r * 100) / 100,
          strength: classifyStrength(r),
          direction: r >= 0 ? 'positive' : 'negative',
          sampleSize: days.length,
        });
      }
    }
  }

  // Habit vs Mood correlations
  const moodSeries = moodTimeSeries(moods, days);
  for (const habit of activeHabits) {
    const xs = habitTimeSeries(habit.id, checkIns, days);
    const r = pearsonR(xs, moodSeries);
    if (Math.abs(r) >= 0.15) {
      results.push({
        metricA: habit.name,
        metricB: 'Mood',
        coefficient: Math.round(r * 100) / 100,
        strength: classifyStrength(r),
        direction: r >= 0 ? 'positive' : 'negative',
        sampleSize: days.length,
      });
    }
  }

  // Capacity vs Mood correlations
  for (const cap of capacities) {
    const xs = capacityTimeSeries(cap.id, ratings, days);
    const r = pearsonR(xs, moodSeries);
    if (Math.abs(r) >= 0.15) {
      results.push({
        metricA: cap.name,
        metricB: 'Mood',
        coefficient: Math.round(r * 100) / 100,
        strength: classifyStrength(r),
        direction: r >= 0 ? 'positive' : 'negative',
        sampleSize: days.length,
      });
    }
  }

  // Sort by absolute correlation strength (strongest first)
  return results.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
}
