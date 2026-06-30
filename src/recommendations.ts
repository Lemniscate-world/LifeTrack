/**
 * Recommendations Engine — Heuristic, local-only, zero-cloud.
 *
 * Analyzes habit patterns and generates actionable, non-judgmental suggestions.
 * Inspired by BJ Fogg (Tiny Habits), James Clear (Atomic Habits), and Nir Eyal.
 *
 * ALL rules are pure functions: habits + checkIns → insights.
 * No external API, no user data leaves the device.
 */

import type { Habit, CheckIn } from './types';

// --- Recommendation types ---

export type RecKind =
  | 'MISS_PATTERN'       // User tends to skip habit X on specific day
  | 'STACK_SUGGESTION'   // Habit X + Y would make a good stack
  | 'RECORD_APPROACH'    // Close to beating all-time best streak
  | 'CHAOS_CORRELATION'  // Chaos dimension linked to habit misses
  | 'NEGLECTED'          // Habit not checked in > N days
  | 'RECOVERY_PATTERN'   // How quickly user recovers after a miss
  | 'PRIME_TIME';        // Day pattern where habit completion is highest

export interface Recommendation {
  kind: RecKind;
  title: string;           // one-line summary, e.g. "Stack 'meditate' after 'coffee'"
  detail: string;          // 2-3 sentence explanation with data
  habitIds: string[];      // related habits (for UI linking)
  strength: number;        // 0-100 confidence/potency
  actionLabel?: string;    // e.g. "Link now", "Set reminder", "View history"
}

// --- Constants ---

const MIN_CHECKINS_FOR_ANALYSIS = 7;
const NEGLECT_DAYS = 4;             // warn if no check-in for this many days
const STACK_CORRELATION_MIN = 0.7;  // parent must have ≥70% completion for stack suggestion
const MISS_PATTERN_THRESHOLD = 0.5; // must miss on this day >50% of weeks to flag
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RECORD_PROXIMITY_DAYS = 5;    // warn when within N days of beating best streak

// --- Helpers ---

function isoToDayIndex(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun
}

function daysSince(dateStr: string, now: Date): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

function dateStrDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function habitCheckDates(habitId: string, checkIns: CheckIn[]): string[] {
  const dates: string[] = [];
  for (const ci of checkIns) {
    if (ci.habitId === habitId && ci.completed) {
      dates.push(ci.date);
    }
  }
  dates.sort();
  return dates;
}

function currentStreak(habitId: string, checkIns: CheckIn[], now: Date): number {
  let streak = 0;
  let cursor = new Date(now);
  cursor.setUTCHours(0, 0, 0, 0);
  const completedSet = new Set(habitCheckDates(habitId, checkIns));
  while (true) {
    const ds = cursor.toISOString().slice(0, 10);
    if (completedSet.has(ds)) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else if (ds > now.toISOString().slice(0, 10)) {
      // today hasn't happened yet, look at yesterday
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function bestStreakFromCheckIns(habitId: string, checkIns: CheckIn[]): number {
  const dates = habitCheckDates(habitId, checkIns);
  if (dates.length === 0) return 0;
  const dateSet = new Set(dates);
  let best = 0;
  let run = 0;
  // Iterate from earliest to latest
  const minDate = new Date(dates[0] + 'T00:00:00Z');
  const maxDate = new Date(dates[dates.length - 1] + 'T00:00:00Z');
  const cursor = new Date(minDate);
  while (cursor <= maxDate) {
    const ds = cursor.toISOString().slice(0, 10);
    if (dateSet.has(ds)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return best;
}

// --- Rule 1: Miss pattern detection ---
// "You tend to skip 'exercise' on Wednesdays"
function detectMissPatterns(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const habit of habits) {
    if (habit.archived) continue;
    if (checkIns.filter((ci) => ci.habitId === habit.id).length < MIN_CHECKINS_FOR_ANALYSIS) continue;

    // Count misses per day of week over the last 12 weeks
    const dayMisses = new Array(7).fill(0);
    const dayTotal = new Array(7).fill(0);
    const completedSet = new Set(
      checkIns
        .filter((ci) => ci.habitId === habit.id && ci.completed)
        .map((ci) => ci.date),
    );
    for (let w = 0; w < 12; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(now);
        date.setUTCDate(date.getUTCDate() - w * 7 - d);
        const ds = date.toISOString().slice(0, 10);
        if (ds > now.toISOString().slice(0, 10)) continue;
        dayTotal[(7 - d) % 7]++;
        if (!completedSet.has(ds)) {
          dayMisses[(7 - d) % 7]++;
        }
      }
    }
    for (let d = 0; d < 7; d++) {
      if (dayTotal[d] < 4) continue; // not enough data
      const missRate = dayMisses[d] / dayTotal[d];
      if (missRate >= MISS_PATTERN_THRESHOLD) {
        recs.push({
          kind: 'MISS_PATTERN',
          title: `You skip "${habit.name}" on ${DAY_NAMES[d]}s`,
          detail: `Over the last 12 weeks, you missed ${habit.name} on ${Math.round(missRate * 100)}% of ${DAY_NAMES[d]}s (${dayMisses[d]} of ${dayTotal[d]}). Consider lowering the bar or planning a backup routine for that day.`,
          habitIds: [habit.id],
          strength: Math.round(missRate * 100),
          actionLabel: 'View history',
        });
      }
    }
  }
  return recs;
}

// --- Rule 2: Stack suggestion ---
// "'Read' could be stacked after 'Coffee' — Coffee has 92% completion"
function detectStackSuggestions(
  habits: Habit[],
  checkIns: CheckIn[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  const activeHabits = habits.filter((h) => !h.archived);
  const stacked = new Set(habits.filter((h) => h.stackParent).map((h) => h.id));

  // Compute completion rate per habit over last 30 days
  const rate30 = new Map<string, number>();
  for (const habit of activeHabits) {
    const thirtyAgo = dateStrDaysAgo(30);
    const total = checkIns.filter(
      (ci) => ci.habitId === habit.id && ci.date >= thirtyAgo,
    ).length;
    const completed = checkIns.filter(
      (ci) => ci.habitId === habit.id && ci.completed && ci.date >= thirtyAgo,
    ).length;
    rate30.set(habit.id, total > 0 ? completed / total : 0);
  }

  for (const child of activeHabits) {
    if (stacked.has(child.id)) continue; // already stacked
    for (const parent of activeHabits) {
      if (parent.id === child.id) continue;
      if (stacked.has(parent.id) && habits.find((h) => h.id === parent.id)?.stackParent === child.id) continue; // would create cycle
      const parentRate = rate30.get(parent.id) ?? 0;
      const childRate = rate30.get(child.id) ?? 0;
      if (parentRate >= STACK_CORRELATION_MIN && childRate < parentRate) {
        recs.push({
          kind: 'STACK_SUGGESTION',
          title: `Stack "${child.name}" after "${parent.name}"`,
          detail: `"${parent.name}" has a ${Math.round(parentRate * 100)}% completion rate over the last 30 days, while "${child.name}" is at ${Math.round(childRate * 100)}%. Linking them could anchor the new habit to an existing strong routine.`,
          habitIds: [child.id, parent.id],
          strength: Math.round(parentRate * 100),
          actionLabel: 'Link now',
        });
      }
    }
  }
  // Only return top 2
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 2);
}

// --- Rule 3: Record proximity ---
// "You're 3 days from beating your all-time best streak of 47 days on 'Meditate'"
function detectRecordApproaches(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const habit of habits) {
    if (habit.archived) continue;
    const best = habit.bestStreak ?? bestStreakFromCheckIns(habit.id, checkIns);
    if (best < 5) continue; // only flag meaningful streaks
    const current = currentStreak(habit.id, checkIns, now);
    const gap = best - current;
    if (gap > 0 && gap <= RECORD_PROXIMITY_DAYS) {
      recs.push({
        kind: 'RECORD_APPROACH',
        title: `🔥 ${gap} day${gap > 1 ? 's' : ''} from your record on "${habit.name}"`,
        detail: `Your current streak is ${current} days. Your all-time best is ${best} days. Stay consistent for ${gap} more day${gap > 1 ? 's' : ''} to beat it!`,
        habitIds: [habit.id],
        strength: Math.round((current / best) * 100),
        actionLabel: 'View stats',
      });
    }
  }
  return recs;
}

// --- Rule 4: Neglected habits ---
// "You haven't logged 'Journal' in 8 days"
function detectNeglected(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const habit of habits) {
    if (habit.archived) continue;
    const lastCheck = habitCheckDates(habit.id, checkIns).pop();
    if (!lastCheck) {
      recs.push({
        kind: 'NEGLECTED',
        title: `"${habit.name}" has no check-ins yet`,
        detail: 'Start tracking this habit to build momentum. Even a single check-in counts.',
        habitIds: [habit.id],
        strength: 100,
        actionLabel: 'Track now',
      });
      continue;
    }
    const ago = daysSince(lastCheck, now);
    if (ago >= NEGLECT_DAYS) {
      recs.push({
        kind: 'NEGLECTED',
        title: `"${habit.name}" — ${ago} days since last check-in`,
        detail: `Your last check-in was ${ago} days ago. A small step today can restart the momentum.`,
        habitIds: [habit.id],
        strength: Math.min(100, ago * 15),
        actionLabel: 'Go to habit',
      });
    }
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 3);
}

// --- Rule 5: Recovery pattern ---
// "After missing 'Exercise', you recover on average in 1.2 days"
function detectRecoveryPatterns(
  habits: Habit[],
  checkIns: CheckIn[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const habit of habits) {
    if (habit.archived) continue;
    const checks = checkIns
      .filter((ci) => ci.habitId === habit.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (checks.length < 14) continue;

    // Find gaps and recovery speed
    const gaps: number[] = [];
    for (let i = 1; i < checks.length; i++) {
      const prev = new Date(checks[i - 1].date + 'T00:00:00Z');
      const curr = new Date(checks[i].date + 'T00:00:00Z');
      const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      if (diff > 1 && diff <= 7) {
        gaps.push(diff);
      }
    }
    if (gaps.length < 2) continue;
    const avgGap = Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
    recs.push({
      kind: 'RECOVERY_PATTERN',
      title: `"${habit.name}" recovery: ${avgGap} days average`,
      detail: `When you miss a day of "${habit.name}", you typically resume within ${avgGap} days (based on ${gaps.length} recovery events). Knowing this helps you plan — even a miss doesn't derail you permanently.`,
      habitIds: [habit.id],
      strength: Math.min(100, Math.round((7 - Math.min(avgGap, 7)) / 7 * 100)),
    });
  }
  return recs;
}

// --- Rule 6: Prime time ---
// "You complete 'Exercise' most often on Tuesday and Thursday"
function detectPrimeTime(
  habits: Habit[],
  checkIns: CheckIn[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const habit of habits) {
    if (habit.archived) continue;
    const completedDates = habitCheckDates(habit.id, checkIns);
    if (completedDates.length < 14) continue;

    const dayCounts = new Array(7).fill(0);
    for (const ds of completedDates) {
      dayCounts[isoToDayIndex(ds)]++;
    }
    const max = Math.max(...dayCounts);
    if (max < 3) continue;
    const bestDays = dayCounts
      .map((count, i) => ({ day: DAY_NAMES[i], count }))
      .filter((d) => d.count >= max * 0.75)
      .map((d) => d.day);

    if (bestDays.length >= 1 && bestDays.length <= 3) {
      recs.push({
        kind: 'PRIME_TIME',
        title: `"${habit.name}" prime days: ${bestDays.join(', ')}`,
        detail: `Over your tracking history, you complete "${habit.name}" most consistently on ${bestDays.join(' and ')}. These are the days where your routine is strongest — protect them.`,
        habitIds: [habit.id],
        strength: Math.round((max / completedDates.length) * 7 * 100),
      });
    }
  }
  return recs;
}

// --- Main entry point ---

export interface InsightsResult {
  recommendations: Recommendation[];
  generatedAt: string; // ISO date string
}

export function generateInsights(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date = new Date(),
): InsightsResult {
  const activeHabits = habits.filter((h) => !h.archived);
  if (activeHabits.length === 0 || checkIns.length < 5) {
    return {
      recommendations: [],
      generatedAt: now.toISOString(),
    };
  }

  const allRecs: Recommendation[] = [
    ...detectMissPatterns(activeHabits, checkIns, now),
    ...detectStackSuggestions(activeHabits, checkIns),
    ...detectRecordApproaches(habits, checkIns, now),
    ...detectNeglected(activeHabits, checkIns, now),
    ...detectRecoveryPatterns(activeHabits, checkIns),
    ...detectPrimeTime(activeHabits, checkIns),
  ];

  // Deduplicate by title
  const seen = new Set<string>();
  const unique = allRecs.filter((r) => {
    const key = r.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by strength descending
  unique.sort((a, b) => b.strength - a.strength);

  return {
    recommendations: unique.slice(0, 6), // top 6 most relevant
    generatedAt: now.toISOString(),
  };
}
