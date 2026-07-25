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
  | 'WEEKLY_SUMMARY'
  | 'STREAK_MILESTONE'
  | 'PERFECT_WEEK'
  | 'MANTRA_MATCH'
  | 'NOTE_POSITIVE'
  | 'NOTE_OBSTACLE'
  | 'GOAL_PROGRESS';

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
const STACK_CORRELATION_MIN = 0.3;  // parent must have ≥30% of days completed (e.g. 9/30 days)
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

  // Compute completion rate per habit over last 30 days (days-based, not check-in count).
  // Using completedDays/30 gives the true fraction of days the habit was done,
  // which is what the user sees in the grid. Previously we used completed/total
  // (check-in count), which showed 100% for a habit with only 7 check-ins in 30
  // days — misleading because 7/30 = 23% of days, not 100%.
  const ACTUAL_WINDOW_DAYS = 30;
  const rate30 = new Map<string, number>();
  for (const habit of activeHabits) {
    // window = [30 days ago, today] inclusive = 30 days
    // dateStrDaysAgo(29) = 29 days ago => window from 29 days ago to today = 30 days
    const thirtyAgo = dateStrDaysAgo(ACTUAL_WINDOW_DAYS - 1, now);
    const completedDays = new Set(
      checkIns
        .filter((ci) => ci.habitId === habit.id && ci.completed && ci.date >= thirtyAgo)
        .map((ci) => ci.date),
    ).size;
    // Require at least 5 completed days before computing a meaningful rate
    rate30.set(habit.id, completedDays >= 5 ? completedDays / ACTUAL_WINDOW_DAYS : 0);
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
          detail: `"${parent.name}" was completed on ${Math.round(parentRate * ACTUAL_WINDOW_DAYS)} of the last ${ACTUAL_WINDOW_DAYS} days (${Math.round(parentRate * 100)}%), while "${child.name}" is at ${Math.round(childRate * ACTUAL_WINDOW_DAYS)} days (${Math.round(childRate * 100)}%). Linking them could anchor the new habit to an existing routine.`,
          habitIds: [child.id, parent.id],
          strength: Math.min(100, Math.round(parentRate * 100)),
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

// --- Rule 10: Streak Milestones ---
// Celebrate when a current streak hits a meaningful number
function detectStreakMilestones(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const MILESTONES = [7, 14, 21, 30, 60, 90, 100, 180, 365];
  for (const habit of habits) {
    if (habit.archived) continue;
    const stats = computeStreakStats(habit, checkIns, now);
    const current = stats.current;
    // Check if current streak exactly hits a milestone
    for (const m of MILESTONES) {
      if (current === m) {
        recs.push({
          kind: 'STREAK_MILESTONE',
          title: `🎯 "${habit.name}" — ${m}-day streak!`,
          detail: `You've hit a ${m}-day streak on "${habit.name}". That's ${m} consecutive days of consistency — this is how habits become identity.`,
          habitIds: [habit.id],
          strength: Math.min(100, m),
          actionLabel: 'View stats',
        });
        break; // only report the highest milestone
      }
    }
    // Also check if approaching a milestone (within 2 days)
    for (const m of MILESTONES) {
      if (current === m - 1 && current >= 6) {
        recs.push({
          kind: 'STREAK_MILESTONE',
          title: `🔜 "${habit.name}" — 1 day from ${m}-day streak`,
          detail: `You're at ${current} days — one more day and you'll hit ${m} consecutive days on "${habit.name}".`,
          habitIds: [habit.id],
          strength: 70,
          actionLabel: 'View stats',
        });
        break;
      }
      if (current === m - 2 && current >= 5) {
        recs.push({
          kind: 'STREAK_MILESTONE',
          title: `🔜 "${habit.name}" — 2 days from ${m}-day streak`,
          detail: `You're at ${current} days on "${habit.name}". Keep going for 2 more days to reach ${m}.`,
          habitIds: [habit.id],
          strength: 55,
          actionLabel: 'View stats',
        });
        break;
      }
    }
  }
  return recs;
}

// --- Rule 11: Perfect Week Detection ---
// Flag when the user had a week with all habits completed every day
function detectPerfectWeeks(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const activeHabits = habits.filter((h) => !h.archived);
  if (activeHabits.length < 2) return [];

  // Look at the last completed week (Mon-Sun) and the current week
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  // Build a map of date -> completed habit IDs
  const byDate = new Map<string, Set<string>>();
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    let set = byDate.get(ci.date);
    if (!set) { set = new Set(); byDate.set(ci.date, set); }
    set.add(ci.habitId);
  }

  // Check last 4 weeks
  const recs: Recommendation[] = [];
  for (let w = 1; w <= 4; w++) {
    const weekEnd = new Date(today);
    weekEnd.setUTCDate(weekEnd.getUTCDate() - (w - 1) * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);

    let perfectDays = 0;
    let totalDays = 0;
    const perfectDates: string[] = [];

    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + d);
      const ds = date.toISOString().slice(0, 10);
      if (ds > today.toISOString().slice(0, 10)) continue;
      totalDays++;
      const completed = byDate.get(ds);
      if (completed && completed.size >= activeHabits.length) {
        perfectDays++;
        perfectDates.push(ds);
      }
    }

    if (perfectDays >= 3 && totalDays >= 5) {
      const weekLabel = w === 1 ? 'This week' : w === 2 ? 'Last week' : `${w} weeks ago`;
      recs.push({
        kind: 'PERFECT_WEEK',
        title: `✨ ${perfectDays} perfect day${perfectDays > 1 ? 's' : ''} ${weekLabel.toLowerCase()}`,
        detail: `You completed ALL ${activeHabits.length} habits on ${perfectDays} day${perfectDays > 1 ? 's' : ''} ${weekLabel.toLowerCase()}. That's exceptional consistency — these are the days that compound into real change.`,
        habitIds: activeHabits.map((h) => h.id),
        strength: Math.min(100, Math.round((perfectDays / totalDays) * 100)),
        actionLabel: 'View history',
      });
      break; // only show the most recent perfect week
    }
  }
  return recs.slice(0, 1);
}

// --- Rule 12: Mantra Match ---
// Suggest a relevant mantra when a habit in that domain is neglected
function detectMantraMatches(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Map chaos dimensions to mantra domains
  const dimensionToMantra: Record<string, string> = {
    physical: 'health',
    financial: 'financial',
    spiritual: 'spiritual',
    social: 'relationships',
    structural: 'productivity',
  };

  for (const habit of habits) {
    if (habit.archived) continue;
    const lastCheck = habitCheckDates(habit.id, checkIns).pop();
    if (!lastCheck) continue;
    const ago = daysSince(lastCheck, now);
    if (ago < 3) continue; // only suggest if habit is being neglected (3+ days)

    const mantraDomain = habit.chaosDimension
      ? dimensionToMantra[habit.chaosDimension] ?? 'life'
      : 'life';

    recs.push({
      kind: 'MANTRA_MATCH',
      title: `🧘 "${habit.name}" — ${ago} days, time for a reset?`,
      detail: `It's been ${ago} days since your last "${habit.name}" check-in. Check the 🧘 Mantras tab for a ${mantraDomain} inspiration to help you restart. A small step today beats a perfect plan tomorrow.`,
      habitIds: [habit.id],
      strength: Math.min(85, ago * 20),
      actionLabel: 'View mantras',
    });
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 2);
}

// --- Rule 13: Note Keyword Insights ---
// Scan recent check-in notes for keywords indicating triggers, wins, or obstacles.
// Pure local analysis — no AI needed.
const NOTE_KEYWORDS: Record<string, { label: string; sentiment: 'positive' | 'negative' | 'neutral' }> = {
  tired: { label: 'fatigue', sentiment: 'negative' },
  exhausted: { label: 'épuisement', sentiment: 'negative' },
  stress: { label: 'stress', sentiment: 'negative' },
  anxious: { label: 'anxiété', sentiment: 'negative' },
  'hard day': { label: 'journée difficile', sentiment: 'negative' },
  sick: { label: 'maladie', sentiment: 'negative' },
  'no energy': { label: "manque d'énergie", sentiment: 'negative' },
  skipped: { label: 'oubli', sentiment: 'negative' },
  forgot: { label: 'oubli', sentiment: 'negative' },
  'didn\'t feel': { label: 'manque de motivation', sentiment: 'negative' },
  lazy: { label: 'paresse', sentiment: 'negative' },
  great: { label: 'super journée', sentiment: 'positive' },
  awesome: { label: 'excellente session', sentiment: 'positive' },
  amazing: { label: 'session incroyable', sentiment: 'positive' },
  proud: { label: 'fierté', sentiment: 'positive' },
  'felt good': { label: 'bien-être', sentiment: 'positive' },
  energized: { label: 'plein d\'énergie', sentiment: 'positive' },
  'best streak': { label: 'record personnel', sentiment: 'positive' },
  easy: { label: 'facilité', sentiment: 'positive' },
  morning: { label: 'routine du matin', sentiment: 'neutral' },
  evening: { label: 'routine du soir', sentiment: 'neutral' },
  weekend: { label: 'week-end', sentiment: 'neutral' },
  travel: { label: 'voyage', sentiment: 'neutral' },
  busy: { label: 'emploi du temps chargé', sentiment: 'negative' },
};

function detectNoteInsights(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  // Early exit: no notes in any check-in
  const hasAnyNotes = checkIns.some(ci => {
    if (ci.date < cutoff) return false;
    if (ci.notes && ci.notes.length > 0) return true;
    const legacyNote = (ci as unknown as Record<string, unknown>).note;
    return typeof legacyNote === 'string' && legacyNote.trim().length > 0;
  });
  if (!hasAnyNotes) return [];

  // Collect keyword matches per habit
  const habitKeywords = new Map<string, Map<string, { count: number; sentiment: string; label: string }>>();

  for (const ci of checkIns) {
    if (ci.date < cutoff) continue;
    const notes: string[] = ci.notes ?? [];
    const legacyNote = (ci as unknown as Record<string, unknown>).note;
    if (typeof legacyNote === 'string' && legacyNote.trim()) notes.push(legacyNote.trim());
    if (notes.length === 0) continue;

    const combinedText = notes.join(' ').toLowerCase();

    for (const [keyword, info] of Object.entries(NOTE_KEYWORDS)) {
      if (combinedText.includes(keyword)) {
        let hk = habitKeywords.get(ci.habitId);
        if (!hk) { hk = new Map(); habitKeywords.set(ci.habitId, hk); }
        const existing = hk.get(keyword);
        if (existing) {
          existing.count++;
        } else {
          hk.set(keyword, { count: 1, sentiment: info.sentiment, label: info.label });
        }
      }
    }
  }

  // Generate insights from keyword matches
  for (const habit of habits) {
    if (habit.archived) continue;
    const hk = habitKeywords.get(habit.id);
    if (!hk || hk.size === 0) continue;

    const positives: string[] = [];
    const negatives: string[] = [];
    for (const [, info] of hk) {
      if (info.sentiment === 'positive') positives.push(info.label);
      if (info.sentiment === 'negative') negatives.push(info.label);
    }

    if (positives.length > 0) {
      recs.push({
        kind: 'NOTE_POSITIVE',
        title: `✨ "${habit.name}" — you're doing great!`,
        detail: `Your recent notes show positive patterns: ${positives.slice(0, 3).join(', ')}. Whatever approach you're using — it's working. Keep that momentum.`,
        habitIds: [habit.id],
        strength: 75,
        actionLabel: 'View notes',
      });
    }

    if (negatives.length > 0) {
      recs.push({
        kind: 'NOTE_OBSTACLE',
        title: `💡 "${habit.name}" — obstacles detected`,
        detail: `Your notes mention: ${negatives.slice(0, 3).join(', ')}. Consider adjusting your approach — smaller steps, different timing, or stacking with a stronger habit can help overcome these.`,
        habitIds: [habit.id],
        strength: 70,
        actionLabel: 'Adjust habit',
      });
    }
  }

  return recs.slice(0, 3);
}

// --- Rule 14: Mood-Habit Link ---
// Identify habits whose completion correlates with better mood days.
// Pure local analysis — uses mood data stored in AppData.
function detectMoodHabitLink(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  _now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const moodDates = Object.keys(moods);
  if (moodDates.length < 7) return []; // need at least a week of mood data

  // Mood value mapping (higher = better)
  const moodValue: Record<string, number> = {
    amazing: 5, great: 4, calm: 3, okay: 2, tired: 1, sick: 0, bad: -1, angry: -2,
  };

  // Build a map: date -> habit completion count
  const byDate = new Map<string, number>();
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    byDate.set(ci.date, (byDate.get(ci.date) ?? 0) + (ci.count ?? 1));
  }

  // Days with BOTH mood and habit data
  const sharedDates = moodDates.filter(d => byDate.has(d) || checkIns.some(ci => ci.habitId && ci.date === d));
  if (sharedDates.length < 7) return [];

  for (const habit of habits) {
    if (habit.archived) continue;
    const habitDates = habitCheckDates(habit.id, checkIns);
    const habitSet = new Set(habitDates);
    const firstHabitDate = habitDates[0] ?? '';
    const moodDatesWithHabit = moodDates.filter(d => d >= firstHabitDate);
    if (moodDatesWithHabit.length < 7) continue;

    // Compare mood on days with vs without this habit
    const withHabitMoods: number[] = [];
    const withoutHabitMoods: number[] = [];
    for (const d of moodDatesWithHabit) {
      const mv = moodValue[moods[d]] ?? 0;
      if (habitSet.has(d)) {
        withHabitMoods.push(mv);
      } else {
        withoutHabitMoods.push(mv);
      }
    }

    if (withHabitMoods.length < 3 || withoutHabitMoods.length < 3) continue;

    const avgWith = withHabitMoods.reduce((a, b) => a + b, 0) / withHabitMoods.length;
    const avgWithout = withoutHabitMoods.reduce((a, b) => a + b, 0) / withoutHabitMoods.length;
    const delta = avgWith - avgWithout;

    // Only flag meaningful differences
    if (delta >= 1.0) {
      recs.push({
        kind: 'CORRELATION',
        title: `😊 "${habit.name}" linked to better mood days`,
        detail: `On days you complete "${habit.name}", your average mood is ${avgWith.toFixed(1)}/5 vs ${avgWithout.toFixed(1)}/5 when you skip it (${withHabitMoods.length} vs ${withoutHabitMoods.length} days). This habit seems to lift your mood — protect it.`,
        habitIds: [habit.id],
        strength: Math.min(90, Math.round(delta * 20 + 40)),
        actionLabel: 'Track mood',
      });
    } else if (delta <= -1.0) {
      recs.push({
        kind: 'CORRELATION',
        title: `🤔 "${habit.name}" — lower mood on completion days`,
        detail: `Interestingly, your mood averages ${avgWith.toFixed(1)}/5 on days you complete "${habit.name}" vs ${avgWithout.toFixed(1)}/5 on days you skip. It might be a tough habit — or it might be something you turn to on harder days. Either way, awareness helps.`,
        habitIds: [habit.id],
        strength: Math.min(80, Math.round(Math.abs(delta) * 15 + 30)),
        actionLabel: 'View stats',
      });
    }
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 2);
}

// --- Rule 15: Chaos Habit Link ---
// Flag habits whose neglect is actively contributing to chaos.
function detectChaosHabitLink(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const chaosHabits = habits.filter(h => !h.archived && h.chaosDimension && h.chaosThresholdDays);
  if (chaosHabits.length === 0) return [];

  for (const habit of chaosHabits) {
    const dates = habitCheckDates(habit.id, checkIns);
    if (dates.length === 0) continue;

    // Find consecutive missed days
    const today = now.toISOString().slice(0, 10);
    const lastCompleted = dates[dates.length - 1];
    const missedDays = Math.floor((new Date(today + 'T00:00:00Z').getTime() - new Date(lastCompleted + 'T00:00:00Z').getTime()) / 86400000);
    const threshold = habit.chaosThresholdDays ?? 3;

    if (missedDays >= threshold && threshold > 0) {
      const impact = habit.chaosImpact ?? 50;
      const dimName = habit.chaosDimension ?? 'unknown';
      recs.push({
        kind: 'CHAOS_CORRELATION',
        title: `🌀 "${habit.name}" — ${missedDays} days missed, chaos risk +${impact}%`,
        detail: `You've missed "${habit.name}" for ${missedDays} consecutive days (threshold: ${threshold}d). This is adding ~${impact}% to your "${dimName}" chaos dimension. One check-in today reduces it.`,
        habitIds: [habit.id],
        strength: Math.min(95, Math.round((missedDays / threshold) * 60 + 30)),
        actionLabel: 'Check in now',
      });
    }
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 2);
}

// --- Rule 16: Goal Progress ---
// Warn when habits are far from or approaching their monthly goal.
function detectGoalProgress(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const monthProgress = dayOfMonth / daysInMonth; // 0..1

  for (const habit of habits) {
    if (habit.archived) continue;
    if (!habit.goal || habit.goal <= 0) continue;

    // Count completions this month
    const monthCompletions = checkIns
      .filter(ci => ci.habitId === habit.id && ci.date >= monthStartStr && ci.date <= todayStr && ci.completed)
      .reduce((sum, ci) => sum + (ci.count ?? 1), 0);

    // Require at least 5 check-ins total for meaningful goal analysis
    const totalCheckIns = checkIns.filter(ci => ci.habitId === habit.id).length;
    if (totalCheckIns < 5) continue;

    const expectedAtThisPoint = Math.round(habit.goal * monthProgress);
    const remaining = habit.goal - monthCompletions;
    const daysLeft = daysInMonth - dayOfMonth;

    // Ahead of pace
    if (monthCompletions >= expectedAtThisPoint * 1.3 && monthCompletions >= 3) {
      const ahead = monthCompletions - expectedAtThisPoint;
      recs.push({
        kind: 'GOAL_PROGRESS',
        title: `🚀 "${habit.name}" — ${ahead} ahead of monthly pace`,
        detail: `You've completed ${monthCompletions}/${habit.goal} (${Math.round(monthCompletions / habit.goal * 100)}%). At this rate, you'll finish ${Math.round(monthCompletions / monthProgress - habit.goal)} above your goal of ${habit.goal}.`,
        habitIds: [habit.id],
        strength: 85,
        actionLabel: 'View stats',
      });
    }

    // Behind pace and goal at risk
    if (monthProgress > 0.4 && remaining > daysLeft * 1.5 && remaining >= 3) {
      const shortfall = expectedAtThisPoint - monthCompletions;
      recs.push({
        kind: 'GOAL_PROGRESS',
        title: `⚠️ "${habit.name}" — ${shortfall} behind monthly goal`,
        detail: `You're at ${monthCompletions}/${habit.goal} with ${daysLeft} days left. You need ${remaining} more — about ${Math.ceil(remaining / Math.max(1, daysLeft))}/day. A small push now prevents a big gap later.`,
        habitIds: [habit.id],
        strength: Math.min(90, Math.round((shortfall / habit.goal) * 100) + 40),
        actionLabel: 'Go to habit',
      });
    }

    // Goal achieved!
    if (monthCompletions >= habit.goal && habit.goal > 0) {
      recs.push({
        kind: 'GOAL_PROGRESS',
        title: `🎉 "${habit.name}" — monthly goal REACHED!`,
        detail: `You've hit ${monthCompletions}/${habit.goal} with ${daysLeft} days to spare. Time to celebrate — and maybe raise the bar next month!`,
        habitIds: [habit.id],
        strength: 95,
        actionLabel: 'View stats',
      });
    }
  }
  return recs.slice(0, 3);
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
  moods: Record<string, string> = {},
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
    ...detectStreakMilestones(habits, checkIns, now),
    ...detectPerfectWeeks(activeHabits, checkIns, now),
    ...detectMantraMatches(activeHabits, checkIns, now),
    // v0.3.2: New insight rules
    ...detectNoteInsights(activeHabits, checkIns, now),
    ...detectGoalProgress(habits, checkIns, now),
    // v0.3.3: Mood & Chaos insights
    ...detectMoodHabitLink(activeHabits, checkIns, moods, now),
    ...detectChaosHabitLink(habits, checkIns, now),
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
    STREAK_MILESTONE: 0,
    PERFECT_WEEK: 0,
    GOAL_PROGRESS: 0,
    NOTE_POSITIVE: 0,
    NOTE_OBSTACLE: 0,
    CORRELATION: 1,
    TREND: 1,
    WEEKLY_SUMMARY: 1,
    MANTRA_MATCH: 1,
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
