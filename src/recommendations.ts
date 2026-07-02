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
import { computeStreakStats } from './stats';

// --- Recommendation types ---

export type RecKind =
  | 'MISS_PATTERN'
  | 'STACK_SUGGESTION'
  | 'RECORD_APPROACH'
  | 'CHAOS_CORRELATION'
  | 'NEGLECTED'
  | 'RECOVERY_PATTERN'
  | 'PRIME_TIME'
  | 'CORRELATION'
  | 'TREND'
  | 'WEEKLY_SUMMARY';

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

function dateStrDaysAgo(daysAgo: number, now: Date = new Date()): string {
  const d = new Date(now);
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

    // Limit the window to the habit's actual tracking period.
    const myDates = habitCheckDates(habit.id, checkIns);
    if (myDates.length === 0) continue;
    const firstDate = new Date(myDates[0] + 'T00:00:00Z');
    const weeksSinceStart = Math.max(
      1,
      Math.ceil((now.getTime() - firstDate.getTime()) / (7 * 86400000)),
    );
    const weeksToScan = Math.min(12, weeksSinceStart);

    // Count misses per day of week
    const dayMisses = new Array(7).fill(0);
    const dayTotal = new Array(7).fill(0);
    const completedSet = new Set(
      checkIns
        .filter((ci) => ci.habitId === habit.id && ci.completed)
        .map((ci) => ci.date),
    );
    const trackingStart = myDates[0]; // first completed date — ignore days before this
    for (let w = 0; w < weeksToScan; w++) {
      for (let d = 1; d < 7; d++) { // skip d=0 (today, may not be complete yet)
        const date = new Date(now);
        date.setUTCDate(date.getUTCDate() - w * 7 - d);
        const ds = date.toISOString().slice(0, 10);
        if (ds > now.toISOString().slice(0, 10)) continue;
        if (ds < trackingStart) continue; // before habit existed — don't count as miss
        const dayIdx = date.getUTCDay(); // 0=Sun...6=Sat
        dayTotal[dayIdx]++;
        if (!completedSet.has(ds)) {
          dayMisses[dayIdx]++;
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
  now: Date,
): Recommendation[] {
  const activeHabits = habits.filter((h) => !h.archived);
  const stacked = new Set(habits.filter((h) => h.stackParent).map((h) => h.id));

  // Compute completion rate per habit over last 30 days
  const rate30 = new Map<string, number>();
  for (const habit of activeHabits) {
    const thirtyAgo = dateStrDaysAgo(30, now);
    const total = checkIns.filter(
      (ci) => ci.habitId === habit.id && ci.date >= thirtyAgo,
    ).length;
    const completed = checkIns.filter(
      (ci) => ci.habitId === habit.id && ci.completed && ci.date >= thirtyAgo,
    ).length;
    // Require at least 7 data points before computing a meaningful rate
    rate30.set(habit.id, total >= 7 ? completed / total : 0);
  }

  // Track best parent per child so the same habit isn't suggested as a stack
  // target multiple times (e.g. "stack Read after Coffee" and "stack Read
  // after Gym" — only the strongest parent wins).
  const bestPerChild = new Map<string, Recommendation>();

  for (const child of activeHabits) {
    if (stacked.has(child.id)) continue; // already stacked
    for (const parent of activeHabits) {
      if (parent.id === child.id) continue;
      if (stacked.has(parent.id) && habits.find((h) => h.id === parent.id)?.stackParent === child.id) continue; // would create cycle
      const parentRate = rate30.get(parent.id) ?? 0;
      const childRate = rate30.get(child.id) ?? 0;
      if (parentRate >= STACK_CORRELATION_MIN && childRate < parentRate) {
        const candidate: Recommendation = {
          kind: 'STACK_SUGGESTION',
          title: `Stack "${child.name}" after "${parent.name}"`,
          detail: `"${parent.name}" has a ${Math.round(parentRate * 100)}% completion rate over the last 30 days, while "${child.name}" is at ${Math.round(childRate * 100)}%. Linking them could anchor the new habit to an existing strong routine.`,
          habitIds: [child.id, parent.id],
          strength: Math.round(parentRate * 100),
          actionLabel: 'Link now',
        };
        const existing = bestPerChild.get(child.id);
        if (!existing || candidate.strength > existing.strength) {
          bestPerChild.set(child.id, candidate);
        }
      }
    }
  }
  const recs = Array.from(bestPerChild.values());
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
    // Use computeStreakStats from stats.ts to stay consistent with the rest
    // of the app. This ensures the streak shown in "X days from your record"
    // matches what the user sees in the streak stats UI.
    const stats = computeStreakStats(habit, checkIns, now);
    const best = habit.bestStreak ?? stats.best;
    if (best < 5) continue; // only flag meaningful streaks
    const current = stats.current;
    const toBeat = best - current + 1; // days needed to EXCEED the record, not just tie it
    if (toBeat > 1 && toBeat <= RECORD_PROXIMITY_DAYS + 1) {
      recs.push({
        kind: 'RECORD_APPROACH',
        title: `🔥 ${toBeat} day${toBeat > 1 ? 's' : ''} from a new record on "${habit.name}"`,
        detail: `Your current streak is ${current} days. Your all-time best is ${best} days. Stay consistent for ${toBeat} more day${toBeat > 1 ? 's' : ''} to set a new personal record!`,
        habitIds: [habit.id],
        strength: Math.min(100, Math.round(((best - toBeat + 1) / best) * 100)),
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
        strength: 60, // lower than genuinely neglected habits so they appear first
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
  // Cap to top 3 to avoid drowning other recommendations on big habit lists
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 3);
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
        strength: Math.min(100, Math.round((max / completedDates.length) * 100)),
      });
    }
  }
  return recs;
}

// --- Rule 7: Correlation between habits ---
// "When you do 'Exercise', you also do 'Meditate' 85% of the time"
function detectCorrelations(
  habits: Habit[],
  checkIns: CheckIn[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  const activeHabits = habits.filter((h) => !h.archived);
  if (activeHabits.length < 2) return recs;

  // Build a map: date -> set of completed habit IDs
  // Also track ALL dates (including days with no completions) for base rate
  const byDate = new Map<string, Set<string>>();
  const allDatesSet = new Set<string>();
  for (const ci of checkIns) {
    allDatesSet.add(ci.date);
    if (!ci.completed) continue;
    let set = byDate.get(ci.date);
    if (!set) {
      set = new Set();
      byDate.set(ci.date, set);
    }
    set.add(ci.habitId);
  }

  const totalDays = allDatesSet.size;
  if (totalDays < 14) return recs;

  // Compute base rate per habit over its own tracking window (not global days).
  // Using global totalDays would artificially deflate pB for newer habits,
  // inflating the lift ratio.
  const baseRate = new Map<string, number>();
  for (const h of activeHabits) {
    const habitDates = new Set<string>();
    for (const ci of checkIns) {
      if (ci.habitId === h.id) habitDates.add(ci.date);
    }
    if (habitDates.size === 0) { baseRate.set(h.id, 0); continue; }
    let completed = 0;
    for (const [, habits] of byDate) {
      if (habits.has(h.id)) completed++;
    }
    baseRate.set(h.id, completed / habitDates.size);
  }

  for (let i = 0; i < activeHabits.length; i++) {
    for (let j = i + 1; j < activeHabits.length; j++) {
      const a = activeHabits[i];
      const b = activeHabits[j];
      let aDays = 0;
      let bothDays = 0;
      for (const [, habits] of byDate) {
        if (habits.has(a.id)) {
          aDays++;
          if (habits.has(b.id)) bothDays++;
        }
      }
      if (aDays < 10) continue;
      // Require at least 3 co-occurrences to avoid spurious "high lift" from
      // a single lucky day (e.g. 1 co-occurrence out of 10 A-days vs base 0.05
      // = 2.0x lift looks impressive but is meaningless).
      if (bothDays < 3) continue;
      const pBgivenA = bothDays / aDays;
      const pB = baseRate.get(b.id) ?? 0;
      if (pB === 0) continue;
      const lift = pBgivenA / pB;
      if (lift < 1.3) continue;
      const rate = Math.round(pBgivenA * 100);
      const anchor = rate >= 90 ? 'almost always' : rate >= 80 ? 'usually' : 'often';
      recs.push({
        kind: 'CORRELATION',
        title: `"${a.name}" → "${b.name}" (${rate}% same-day)`,
        detail: `On days you complete "${a.name}", you ${anchor} also complete "${b.name}" (${bothDays} of ${aDays} days, ${Math.round(lift * 10) / 10}x base rate). This is a naturally reinforcing pair.`,
        habitIds: [a.id, b.id],
        strength: Math.min(100, Math.round(lift * 50)),
        actionLabel: 'Link now',
      });
    }
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 3);
}

// --- Rule 8: Trend detection ---
// "Your 'Exercise' completion is +15% this month vs last month"
function detectTrends(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const habit of habits) {
    if (habit.archived) continue;
    // Use equal 30-day windows for fair comparison
    const thisStart = new Date(now);
    thisStart.setUTCDate(thisStart.getUTCDate() - 29);
    const thisStartStr = thisStart.toISOString().slice(0, 10);
    const lastEnd = new Date(now);
    lastEnd.setUTCDate(lastEnd.getUTCDate() - 30);
    const lastEndStr = lastEnd.toISOString().slice(0, 10);
    const lastStart = new Date(now);
    lastStart.setUTCDate(lastStart.getUTCDate() - 59);
    const lastStartStr = lastStart.toISOString().slice(0, 10);

    const thisPeriod = checkIns.filter(
      (ci) => ci.habitId === habit.id && ci.date >= thisStartStr,
    );
    const lastPeriod = checkIns.filter(
      (ci) => ci.habitId === habit.id && ci.date >= lastStartStr && ci.date <= lastEndStr,
    );

    const thisRate = thisPeriod.length > 0
      ? thisPeriod.filter((ci) => ci.completed).length / thisPeriod.length
      : 0;
    const lastRate = lastPeriod.length > 0
      ? lastPeriod.filter((ci) => ci.completed).length / lastPeriod.length
      : 0;

    if (thisPeriod.length < 7 || lastPeriod.length < 7) continue;
    const delta = Math.round((thisRate - lastRate) * 100);
    if (Math.abs(delta) < 10) continue; // only flag significant changes

    const direction = delta > 0 ? 'up' : 'down';
    const emoji = delta > 0 ? '📈' : '📉';
    recs.push({
      kind: 'TREND',
      title: `${emoji} "${habit.name}" ${delta > 0 ? '+' : ''}${delta}% this month`,
      detail: `Your completion rate for "${habit.name}" is ${direction} ${Math.abs(delta)}% compared to last month (${Math.round(thisRate * 100)}% vs ${Math.round(lastRate * 100)}%). ${delta > 0 ? "Whatever you're doing — keep it up!" : "A small adjustment could turn this around."}`,
      habitIds: [habit.id],
      strength: Math.min(100, Math.abs(delta) + 50),
      actionLabel: delta > 0 ? 'View stats' : 'Go to habit',
    });
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 3);
}

// --- Rule 9: Weekly summary ---
// "This week: 3 records beaten, stacks 80% done, chaos trend: down"
function generateWeeklySummary(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const weekAgo = new Date(now);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const weekChecks = checkIns.filter((ci) => ci.date >= weekAgoStr);
  const activeHabits = habits.filter((h) => !h.archived);
  if (activeHabits.length === 0 || weekChecks.length < 5) return [];

  const totalChecks = weekChecks.length;
  const completed = weekChecks.filter((ci) => ci.completed).length;
  const weekRate = Math.round((completed / totalChecks) * 100);

  // Count records beaten this week (best streaks achieved ending this week)
  let recordsBeaten = 0;
  for (const h of habits) {
    if (!h.bestStreak || !h.bestStreakAt || h.bestStreak < 3) continue;
    if (h.bestStreakAt >= weekAgoStr) recordsBeaten++;
  }

  // Stack completion this week
  const stacked = activeHabits.filter((h) => h.stackParent);
  const stackedDone = stacked.filter((h) => {
    const checks = weekChecks.filter((ci) => ci.habitId === h.id && ci.completed);
    return checks.length > 0;
  }).length;
  const stackRate = stacked.length > 0 ? Math.round((stackedDone / stacked.length) * 100) : 0;

  const parts: string[] = [];
  if (weekRate >= 80) parts.push(`✅ ${weekRate}% completion rate`);
  else if (weekRate >= 50) parts.push(`📊 ${weekRate}% completion rate`);
  else parts.push(`⚠️ ${weekRate}% completion rate`);

  if (recordsBeaten > 0) parts.push(`🏆 ${recordsBeaten} record${recordsBeaten > 1 ? 's' : ''} beaten`);
  if (stacked.length > 0) parts.push(`🔗 stacks ${stackRate}% done`);

  return [{
    kind: 'WEEKLY_SUMMARY',
    title: `📋 This week: ${parts.join(' · ')}`,
    detail: `Over the last 7 days, you completed ${completed} of ${totalChecks} check-ins across ${activeHabits.length} habits.${stacked.length > 0 ? ` Your ${stacked.length} stacked habit${stacked.length > 1 ? 's are' : ' is'} ${stackRate}% on track.` : ''}${recordsBeaten > 0 ? ` You set ${recordsBeaten} new personal record${recordsBeaten > 1 ? 's' : ''}!` : ''}`,
    habitIds: activeHabits.map((h) => h.id),
    strength: Math.min(100, weekRate),
    actionLabel: 'View history',
  }];
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
  if (activeHabits.length === 0) {
    return {
      recommendations: [],
      generatedAt: now.toISOString(),
    };
  }

  const allRecs: Recommendation[] = [
    ...detectMissPatterns(activeHabits, checkIns, now),
    ...detectStackSuggestions(activeHabits, checkIns, now),
    ...detectRecordApproaches(habits, checkIns, now),
    ...detectNeglected(activeHabits, checkIns, now),
    ...detectRecoveryPatterns(activeHabits, checkIns),
    ...detectPrimeTime(activeHabits, checkIns),
    ...detectCorrelations(activeHabits, checkIns),
    ...detectTrends(activeHabits, checkIns, now),
    ...generateWeeklySummary(habits, checkIns, now),
  ];

  // Deduplicate by title
  const seen = new Set<string>();
  const unique = allRecs.filter((r) => {
    const key = r.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by strength descending, but prioritize actionable kinds first:
  // NEGLECTED/STACK_SUGGESTION/RECORD_APPROACH > RECOVERY/PRIME_TIME > MISS_PATTERN
  const kindPriority: Record<RecKind, number> = {
    NEGLECTED: 0,
    RECORD_APPROACH: 0,
    STACK_SUGGESTION: 0,
    CORRELATION: 1,
    TREND: 1,
    WEEKLY_SUMMARY: 1,
    RECOVERY_PATTERN: 2,
    PRIME_TIME: 2,
    CHAOS_CORRELATION: 2,
    MISS_PATTERN: 3,
  };
  unique.sort((a, b) => {
    const pa = kindPriority[a.kind] ?? 2;
    const pb = kindPriority[b.kind] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.strength - a.strength;
  });

  // Limit to top 8, and max 2 per kind to avoid flooding
  const perKind = new Map<RecKind, number>();
  const limited: Recommendation[] = [];
  for (const r of unique) {
    const count = perKind.get(r.kind) ?? 0;
    if (count >= 2) continue;
    perKind.set(r.kind, count + 1);
    limited.push(r);
    if (limited.length >= 8) break;
  }

  return {
    recommendations: limited,
    generatedAt: now.toISOString(),
  };
}
