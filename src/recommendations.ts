/**
 * Recommendations Engine — Heuristic, local-only, zero-cloud.
 *
 * Analyzes habit patterns and generates actionable, non-judgmental suggestions.
 * Inspired by BJ Fogg (Tiny Habits), James Clear (Atomic Habits), and Nir Eyal.
 *
 * ALL rules are pure functions: habits + checkIns → insights.
 * No external API, no user data leaves the device.
 */

import type { Habit, CheckIn, Note, UrgeEntry, Capacity, CapacityRating, Experiment, JournalEntry, ReflectionEntry } from './types';
import { computeStreakStats } from './stats';
import { twoMeanP } from './deepInsights';

// --- helpers for statistical depth (Cohen's h, Wilson, normal approx) ---
function cohenH(p1: number, p2: number): number {
  const h = 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, p1)))) - 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, p2))));
  return h;
}
function normalCDF(z: number): number {
  // Abramowitz & Stegun approx
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}
function diffProportionsP(p1: number, n1: number, p2: number, n2: number): number | null {
  if (n1 < 5 || n2 < 5) return null;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  if (se === 0) return p1 === p2 ? 1 : 0.001;
  const z = (p1 - p2) / se;
  return 2 * (1 - normalCDF(Math.abs(z)));
}

// --- Recommendation types ---

export type RecKind =
  | 'MISS_PATTERN'
  | 'STACK_SUGGESTION'
  | 'RECORD_APPROACH'
  | 'CHAOS_CORRELATION'
  | 'NEGLECTED'
  | 'PRIME_TIME'
  | 'CORRELATION'
  | 'WEEKLY_SUMMARY'
  | 'STREAK_MILESTONE'
  | 'MANTRA_MATCH'
  | 'BURNOUT_RISK'
  | 'URGE_TRIGGER'
  | 'EXPERIMENT_RESULT'
  | 'NOTE_THEME'
  | 'PERFECT_DAY'
  | 'WEEKLY_LETTER'
  | 'JOURNAL_THEME'
  | 'REFLECTION_DUE'
  | 'REFLECTION_REVIEW'
  | 'AI_PRIORITY'
  | 'AI_TREND'
  | 'AI_RISK';

/** Number of distinct insight rule kinds — kept in sync with RecKind. */
export const INSIGHT_RULES_COUNT = 22;

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
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
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
        // Deep: is this weekday really worse than the rest? (two-proportion z)
        const otherMiss = dayMisses.reduce((s, v, i) => (i === d ? s : s + v), 0);
        const otherTotal = dayTotal.reduce((s, v, i) => (i === d ? s : s + v), 0);
        const pVal = diffProportionsP(dayMisses[d], dayTotal[d], otherMiss, Math.max(1, otherTotal));
        const sig = pVal !== null && pVal < 0.05;
        const pTxt = pVal === null ? 'n insuffisant' : pVal < 0.001 ? 'p<0.001' : `p=${pVal.toFixed(3)}`;
        const baseRate = otherTotal > 0 ? otherMiss / otherTotal : 0;
        const ratio = baseRate > 0 ? missRate / baseRate : 0;
        recs.push({
          kind: 'MISS_PATTERN',
          title: `${sig ? '🚨' : '👀'} "${habit.name}" : les ${DAY_NAMES[d]}s sont ton point noir`,
          detail: `Sur 12 semaines tu rates "${habit.name}" ${Math.round(missRate * 100)}% des ${DAY_NAMES[d]}s (${dayMisses[d]}/${dayTotal[d]}) vs ${Math.round(baseRate * 100)}% les autres jours${ratio > 0 ? ` — ×${ratio.toFixed(1)} plus de ratés` : ''} · ${pTxt}. ${sig ? `Ce n'est pas du hasard : prévois dès maintenant une version réduite du ${DAY_NAMES[d]} (2 minutes suffisent à garder la chaîne vivante), ou décale vers ton meilleur jour.` : "Tendance à surveiller — si ça se confirme encore 2 semaines, adapte ce jour-là."}`,
          habitIds: [habit.id],
          strength: Math.min(95, Math.round(missRate * 60 + (sig ? 35 : 10))),
          actionLabel: 'Voir historique',
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
        // Deep: co-occurrence lift — when the parent is done, how often is the
        // child done the SAME day vs its baseline? (two-proportion z)
        const thirtyAgo = dateStrDaysAgo(ACTUAL_WINDOW_DAYS - 1, now);
        const parentDone = new Set(
          checkIns.filter((c) => c.habitId === parent.id && c.completed && c.date >= thirtyAgo).map((c) => c.date),
        );
        const childDone = new Set(
          checkIns.filter((c) => c.habitId === child.id && c.completed && c.date >= thirtyAgo).map((c) => c.date),
        );
        let both = 0;
        for (const d of parentDone) if (childDone.has(d)) both++;
        const pVal = diffProportionsP(both, parentDone.size, childDone.size - both, Math.max(1, ACTUAL_WINDOW_DAYS - parentDone.size));
        const sig = pVal !== null && pVal < 0.05;
        const lift = parentDone.size > 0 ? (both / parentDone.size) / Math.max(0.01, childRate) : 1;
        const liftTxt = lift >= 1.3 ? ` · quand "${parent.name}" est faite, tu fais "${child.name}" ×${lift.toFixed(1)} plus souvent${sig ? ' (significatif)' : ''}` : '';
        const candidate: Recommendation = {
          kind: 'STACK_SUGGESTION',
          title: `🔗 Attache "${child.name}" après "${parent.name}"`,
          detail: `"${parent.name}" tient ${Math.round(parentRate * 100)}% des jours (${Math.round(parentRate * ACTUAL_WINDOW_DAYS)}/${ACTUAL_WINDOW_DAYS}) contre ${Math.round(childRate * 100)}% pour "${child.name}"${liftTxt}. Ancre la faible sur la forte : même lieu, juste après. ${pVal !== null ? `${pVal < 0.001 ? 'p<0.001' : `p=${pVal.toFixed(3)}`}${sig ? '' : ' · tendance à confirmer'}.` : ''}`,
          habitIds: [child.id, parent.id],
          strength: Math.min(100, Math.round(parentRate * 70 + (sig ? 25 : 5))),
          actionLabel: 'Lier maintenant',
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
        title: `🔥 Plus que ${toBeat} jour${toBeat > 1 ? 's' : ''} avant le record sur « ${habit.name} »`,
        detail: `Série en cours : ${current} jours. Record : ${best} jours. Tiens encore ${toBeat} jour${toBeat > 1 ? 's' : ''} et c'est un nouveau record personnel !`,
        habitIds: [habit.id],
        strength: Math.min(100, Math.round(((best - toBeat + 1) / best) * 100)),
        actionLabel: 'Voir stats',
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
        title: `« ${habit.name} » n'a encore jamais été coché`,
        detail: `Commence à suivre cette habitude pour créer l'élan. Une seule coche compte déjà.`,
        habitIds: [habit.id],
        strength: 60, // lower than genuinely neglected habits so they appear first
        actionLabel: 'Cocher',
      });
      continue;
    }
    const ago = daysSince(lastCheck, now);
    if (ago >= NEGLECT_DAYS) {
      // Deep: find the user's best restart weekday from their own history —
      // the day-of-week with the highest completion rate over the last 8 weeks.
      const dowK = new Array(7).fill(0);
      const dowN = new Array(7).fill(0);
      const doneSet = new Set(checkIns.filter((c) => c.completed).map((c) => `${c.habitId}|${c.date}`));
      for (let i = 1; i <= 56; i++) {
        const d = dateStrDaysAgo(i, now);
        for (const hh of habits) {
          if (hh.archived) continue;
          const tracked = checkIns.some((c) => c.habitId === hh.id && c.date === d);
          if (!tracked) continue;
          const idx = new Date(`${d}T00:00:00Z`).getUTCDay();
          dowN[idx]++;
          if (doneSet.has(`${hh.id}|${d}`)) dowK[idx]++;
        }
      }
      let bestDow = -1;
      let bestRate = -1;
      for (let i = 0; i < 7; i++) {
        if (dowN[i] >= 5 && dowK[i] / dowN[i] > bestRate) { bestRate = dowK[i] / dowN[i]; bestDow = i; }
      }
      const restartTxt = bestDow >= 0
        ? `Ta meilleure fenêtre de reprise : le ${DAY_NAMES[bestDow]} (${Math.round(bestRate * 100)}% de réussite historique ce jour-là). D'ici là, coche une version "2 minutes" pour ne pas rompre l'identité.`
        : 'Reprends avec une version réduite (2 minutes) plutôt que la version complète.';
      recs.push({
        kind: 'NEGLECTED',
        title: `"${habit.name}" — ${ago} jours sans coche`,
        detail: `Dernier check-in il y a ${ago} jours. ${restartTxt}`,
        habitIds: [habit.id],
        strength: Math.min(100, ago * 15),
        actionLabel: 'Reprendre',
      });
    }
  }
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
    const mean = completedDates.length / 7;
    // Deep gate: the "prime" day must be meaningfully above the habit's own
    // average weekday (×1.5) with enough volume — kills the old noise where
    // any 3-day cluster became a "prime time".
    if (max < 5 || max < mean * 1.5) continue;
    const bestDays = dayCounts
      .map((count, i) => ({ day: DAY_NAMES[i], count }))
      .filter((d) => d.count >= max * 0.75)
      .map((d) => d.day);

    if (bestDays.length >= 1 && bestDays.length <= 2) {
      recs.push({
        kind: 'PRIME_TIME',
        title: `⭐ "${habit.name}" : tes jours forts — ${bestDays.join(' et ')}`,
        detail: `${max} réussites le ${bestDays[0]} contre ~${mean.toFixed(1)} par jour en moyenne (×${(max / Math.max(0.1, mean)).toFixed(1)}). Ta routine est structurellement plus forte ce jour-là : mets-y les versions exigeantes, et protège-le.`,
        habitIds: [habit.id],
        strength: Math.min(100, Math.round((max / Math.max(0.1, mean)) * 30 + 40)),
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
      const anchor = rate >= 90 ? 'presque toujours' : rate >= 80 ? 'souvent' : 'régulièrement';
      recs.push({
        kind: 'CORRELATION',
        title: `« ${a.name} » → « ${b.name} » (${rate}% le même jour)`,
        detail: `Les jours où tu fais « ${a.name} », tu fais ${anchor} aussi « ${b.name} » (${bothDays} jours sur ${aDays}, ×${Math.round(lift * 10) / 10} le taux de base). Paire qui se renforce naturellement : enchaîne-les.`,
        habitIds: [a.id, b.id],
        strength: Math.min(100, Math.round(lift * 50)),
        actionLabel: 'Lier',
      });
    }
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
  if (weekRate >= 80) parts.push(`✅ ${weekRate}% de complétion`);
  else if (weekRate >= 50) parts.push(`📊 ${weekRate}% de complétion`);
  else parts.push(`⚠️ ${weekRate}% de complétion`);

  if (recordsBeaten > 0) parts.push(`🏆 ${recordsBeaten} record${recordsBeaten > 1 ? 's' : ''} battu${recordsBeaten > 1 ? 's' : ''}`);
  if (stacked.length > 0) parts.push(`🔗 stacks à ${stackRate}%`);

  return [{
    kind: 'WEEKLY_SUMMARY',
    title: `📋 Cette semaine : ${parts.join(' · ')}`,
    detail: `Sur 7 jours, ${completed} coches sur ${totalChecks} pour ${activeHabits.length} habitudes.${stacked.length > 0 ? ` Tes ${stacked.length} habitudes en stack sont à ${stackRate}%.` : ''}${recordsBeaten > 0 ? ` ${recordsBeaten} nouveau${recordsBeaten > 1 ? 'x' : ''} record${recordsBeaten > 1 ? 's' : ''} personnel${recordsBeaten > 1 ? 's' : ''} !` : ''}`,
    habitIds: activeHabits.map((h) => h.id),
    strength: Math.min(100, weekRate),
    actionLabel: "Voir l'historique",
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
          title: `🎯 « ${habit.name} » — série de ${m} jours !`,
          detail: `${m} jours d'affilée sur « ${habit.name} ». C'est comme ça qu'une habitude devient une identité.`,
          habitIds: [habit.id],
          strength: Math.min(100, m),
          actionLabel: 'Voir stats',
        });
        break; // only report the highest milestone
      }
    }
    // Also check if approaching a milestone (within 2 days)
    for (const m of MILESTONES) {
      if (current === m - 1 && current >= 6) {
        recs.push({
          kind: 'STREAK_MILESTONE',
          title: `🔜 « ${habit.name} » — plus qu'1 jour avant ${m} jours !`,
          detail: `Tu es à ${current} jours — encore 1 jour et c'est ${m} jours d'affilée sur « ${habit.name} ».`,
          habitIds: [habit.id],
          strength: 70,
          actionLabel: 'Voir stats',
        });
        break;
      }
      if (current === m - 2 && current >= 5) {
        recs.push({
          kind: 'STREAK_MILESTONE',
          title: `🔜 « ${habit.name} » — plus que 2 jours avant ${m} !`,
          detail: `${current} jours sur « ${habit.name} ». Encore 2 jours pour atteindre ${m}.`,
          habitIds: [habit.id],
          strength: 55,
          actionLabel: 'Voir stats',
        });
        break;
      }
    }
  }
  return recs;
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

    const links = chaosLinksOf(habit);
    const mantraDomain = links.length > 0
      ? dimensionToMantra[links[0].dimension] ?? 'life'
      : 'life';

    recs.push({
      kind: 'MANTRA_MATCH',
      title: `🧘 « ${habit.name} » — ${ago} jours, l'heure du reset ?`,
      detail: `Plus de coche depuis ${ago} jours sur « ${habit.name} ». Va chercher une inspiration ${mantraDomain} dans l'onglet 🧘 Mantras pour redémarrer. Un petit pas aujourd'hui vaut mieux qu'un plan parfait demain.`,
      habitIds: [habit.id],
      strength: Math.min(85, ago * 20),
      actionLabel: 'Voir mantras',
    });
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 2);
}

// --- Rule 13: Note Keyword Insights ---
// Scan recent check-in notes for keywords indicating triggers, wins, or obstacles.
// Pure local analysis — no AI needed.
function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// --- Rule 14: Mood-Habit Link ---
// Identify habits whose completion correlates with better mood days.
// Pure local analysis — uses mood data stored in AppData.
function detectMoodHabitLink(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
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

    if (withHabitMoods.length < 6 || withoutHabitMoods.length < 6) continue;

    const avgWith = withHabitMoods.reduce((a, b) => a + b, 0) / withHabitMoods.length;
    const avgWithout = withoutHabitMoods.reduce((a, b) => a + b, 0) / withoutHabitMoods.length;
    const delta = avgWith - avgWithout;

    // Deep gate: require statistical significance (z-test on means), not just
    // a raw delta — this killed the stream of false "mood link" cards.
    const pMood = twoMeanP(withHabitMoods, withoutHabitMoods);
    const sig = pMood !== null && pMood < 0.05;

    // Only flag meaningful AND significant differences
    if (delta >= 0.7 && sig) {
      recs.push({
        kind: 'CORRELATION',
        title: `😊 "${habit.name}" liée à de meilleures journées`,
        detail: `Humeur moyenne ${avgWith.toFixed(1)} les jours où tu fais "${habit.name}" vs ${avgWithout.toFixed(1)} sinon (Δ${delta > 0 ? '+' : ''}${delta.toFixed(1)}, n=${withHabitMoods.length}+${withoutHabitMoods.length}, ${pMood !== null ? (pMood < 0.001 ? 'p<0.001' : `p=${pMood.toFixed(3)}`) : '?'}). Protège-la.`,
        habitIds: [habit.id],
        strength: Math.min(90, Math.round(delta * 20 + 40 + (sig ? 10 : 0))),
        actionLabel: 'Voir stats',
      });
    } else if (delta <= -0.7 && sig) {
      recs.push({
        kind: 'CORRELATION',
        title: `🤔 "${habit.name}" — humeur plus basse les jours faits`,
        detail: `Ton humeur moyenne est ${avgWith.toFixed(1)} les jours où tu fais "${habit.name}" vs ${avgWithout.toFixed(1)} sinon (${pMood !== null ? (pMood < 0.001 ? 'p<0.001' : `p=${pMood.toFixed(3)}`) : '?'}). Habitude exigeante, ou refuge sur les jours durs — la nuance compte.`,
        habitIds: [habit.id],
        strength: Math.min(80, Math.round(Math.abs(delta) * 15 + 30)),
        actionLabel: 'Voir stats',
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
  const chaosHabits = habits.filter(h => !h.archived && chaosLinksOf(h).length > 0 && h.chaosThresholdDays);
  if (chaosHabits.length === 0) return [];

  for (const habit of chaosHabits) {
    const dates = habitCheckDates(habit.id, checkIns);
    if (dates.length === 0) continue;

    // Occurrence-based (same model as the Chaos dashboard): non-daily habits
    // count missed SESSIONS in a trailing window, not calendar days — no
    // false alarms on a 3×/week habit after 2 days off.
    const perWeekRaw = habit.chaosPerWeek;
    const perWeek = typeof perWeekRaw === 'number' && Number.isFinite(perWeekRaw)
      ? Math.min(7, Math.max(1, Math.round(perWeekRaw))) : 7;
    const threshold = habit.chaosThresholdDays ?? 3;
    const windowDays = Math.max(1, Math.ceil((threshold * 7) / perWeek));
    const today = now.toISOString().slice(0, 10);
    const done = new Set<string>();
    for (let i = 1; i <= windowDays; i++) {
      const d = dateStrDaysAgo(i, now);
      if (d < today && checkIns.some((c) => c.habitId === habit.id && c.date === d && c.completed)) done.add(d);
    }
    const expected = (perWeek * windowDays) / 7;
    const missed = Math.max(0, expected - done.size);

    if (missed >= threshold && threshold > 0) {
      const links = chaosLinksOf(habit);
      const dims = links.map((l) => `${l.dimension}+${l.impact}%`).join(', ');
      const missedTxt = perWeek < 7
        ? `${Math.round(missed * 10) / 10} séance${missed >= 2 ? 's' : ''} manquée${missed >= 2 ? 's' : ''} (${perWeek}×/sem)`
        : `${Math.floor(missed)} jour${missed >= 2 ? 's' : ''} manqué${missed >= 2 ? 's' : ''}`;
      recs.push({
        kind: 'CHAOS_CORRELATION',
        title: `🌀 « ${habit.name} » — ${missedTxt}, chaos +${links[0]?.impact ?? 50}%`,
        detail: `« ${habit.name} » chauffe ${dims}. Une coche aujourd'hui fait redescendre la pression.`,
        habitIds: [habit.id],
        strength: Math.min(95, Math.round((missed / threshold) * 60 + 30)),
        actionLabel: 'Cocher',
      });
    }
  }
  recs.sort((a, b) => b.strength - a.strength);
  return recs.slice(0, 2);
}

// --- Rule 17: Burnout / energy risk ---
// v0.3.4: Watches the energy/physical/emotional side of life. A habit linked to
// one of these dimensions that is visibly declining, combined with several
// low-mood days, is a leading signal of burnout — not a judgement, just an
// early-warning so the user can dial back instead of crashing.
const BURNOUT_DIMS = ['energy', 'physical', 'emotional', 'psychological'];

/** Canonical chaos links of a habit (multi-zone `chaosLinks` or legacy single). */
function chaosLinksOf(h: Habit): { dimension: string; impact: number }[] {
  if (Array.isArray(h.chaosLinks) && h.chaosLinks.length > 0) {
    return h.chaosLinks.filter((l) => l && l.dimension);
  }
  if (h.chaosDimension) {
    return [{ dimension: h.chaosDimension, impact: h.chaosImpact ?? 50 }];
  }
  return [];
}
const LOW_MOOD_IDS = ['sick', 'tired', 'bad', 'angry'];

function detectBurnoutRisk(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date,
  moods: Record<string, string> = {},
): Recommendation[] {
  const candidates = habits.filter((h) => !h.archived && chaosLinksOf(h).some((l) => BURNOUT_DIMS.includes(l.dimension)));
  if (candidates.length === 0) return [];

  const inWindow = (daysAgoStart: number, daysAgoEnd: number) => {
    const start = dateStrDaysAgo(daysAgoStart, now);
    const end = dateStrDaysAgo(daysAgoEnd, now);
    return (ci: CheckIn) => ci.date <= start && ci.date >= end;
  };

  // Completion rate within a rolling window (completions / tracked days).
  const rateIn = (habitId: string, daysAgoStart: number, daysAgoEnd: number) => {
    const inWin = inWindow(daysAgoStart, daysAgoEnd);
    const tracked = checkIns.filter((ci) => ci.habitId === habitId && inWin(ci));
    if (tracked.length === 0) return null;
    const completed = tracked.filter((c) => c.completed).length;
    return completed / tracked.length;
  };

  let worstHabit: { habit: Habit; decline: number; recent: number } | null = null;
  for (const habit of candidates) {
    const recent14 = rateIn(habit.id, 0, 13);
    const prior28 = rateIn(habit.id, 14, 41);
    if (recent14 === null || prior28 === null) continue;
    // A meaningful decline = drop of ≥25 points AND a genuinely low recent rate.
    if (prior28 >= 0.4 && prior28 - recent14 >= 0.25 && recent14 < 0.55) {
      const decline = Math.round((prior28 - recent14) * 100);
      if (!worstHabit || decline > worstHabit.decline) {
        worstHabit = { habit, decline, recent: recent14 };
      }
    }
  }

  // Low-mood pressure over the last 14 days.
  let lowMoodDays = 0;
  let moodDays = 0;
  for (let d = 0; d < 14; d++) {
    const ds = dateStrDaysAgo(d, now);
    const moodId = moods[ds];
    if (!moodId) continue;
    moodDays++;
    if (LOW_MOOD_IDS.includes(moodId)) lowMoodDays++;
  }
  const lowMoodRatio = moodDays > 0 ? lowMoodDays / moodDays : 0;

  const hasWorst = worstHabit !== null;
  const score = (hasWorst ? Math.min(60, 25 + worstHabit!.decline * 0.8) : 0)
    + Math.min(40, lowMoodRatio * 100 * 0.55);

  if (score < 45) return [];
  if (!hasWorst && lowMoodRatio < 0.4) return [];

  const dimName = worstHabit ? (chaosLinksOf(worstHabit.habit)[0]?.dimension ?? '') : '';
  const title = worstHabit
    ? `🫀 Risque de cramage — « ${worstHabit.habit.name} » glisse (−${worstHabit.decline}%)`
    : `🫀 Risque de cramage — énergie basse (${lowMoodDays} jours d'humeur basse en 2 semaines)`;
  // profondeur: h et p sur la baisse
  let deepNote = '';
  if (worstHabit) {
    const prior = priorRate(worstHabit.habit.id, checkIns, now);
    const h2 = cohenH(worstHabit.recent, prior);
    const nRecent = checkIns.filter((ci) => ci.habitId === worstHabit!.habit.id && ci.date >= dateStrDaysAgo(13, now)).length;
    const nPrior = checkIns.filter((ci) => ci.habitId === worstHabit!.habit.id && ci.date >= dateStrDaysAgo(41, now) && ci.date <= dateStrDaysAgo(14, now)).length;
    const p2 = diffProportionsP(worstHabit.recent, Math.max(7, nRecent), prior, Math.max(7, nPrior));
    const sig2 = p2 !== null && p2 < 0.05;
    deepNote = ` Effet h=${h2.toFixed(2)} (${Math.abs(h2) < 0.5 ? 'modeste' : Math.abs(h2) < 0.8 ? 'marqué' : 'massif'}) · ${p2 === null ? 'n faible' : p2 < 0.001 ? 'p<0.001' : `p=${p2.toFixed(3)}`}${sig2 ? ' · baisse significative' : ' · tendance à confirmer'} · n=${nRecent}+${nPrior}.`;
  }
  const detail = worstHabit
    ? `« ${worstHabit.habit.name} » est passé de ${Math.round(worstHabit.habit ? priorRate(worstHabit.habit.id, checkIns, now) : 0)}% à ${Math.round(worstHabit.recent * 100)}% de complétion en 2 semaines.${lowMoodRatio >= 0.3 ? ` Avec ${lowMoodDays} jour${lowMoodDays > 1 ? 's' : ''} d'humeur basse, ça pointe une surcharge ${dimName}.` : ''}${deepNote} Le coup le plus malin maintenant, c'est souvent de LEVER LE PIED sur une dimension, pas de pousser plus fort.`
    : `${lowMoodDays} jour${lowMoodDays > 1 ? 's' : ''} d'humeur basse en 2 semaines, sans déclencheur net côté habitudes.${deepNote} Fais le point avec toi-même — parfois l'habitude au meilleur rendement, c'est le repos.`;

  return [{
    kind: 'BURNOUT_RISK',
    title,
    detail,
    habitIds: worstHabit ? [worstHabit.habit.id] : [],
    strength: Math.min(95, Math.round(score)),
    actionLabel: "Voir l'historique",
  }];
}

function priorRate(habitId: string, checkIns: CheckIn[], now: Date): number {
  const prior = checkIns.filter((ci) => ci.habitId === habitId && ci.date >= dateStrDaysAgo(41, now) && ci.date <= dateStrDaysAgo(14, now));
  if (prior.length === 0) return 0;
  return prior.filter((c) => c.completed).length / prior.length;
}

// --- Rule 22: Urge triggers ---
// v0.4.0: The most common urge trigger, with a counter-measure suggestion.
function detectUrgeTriggers(urges: UrgeEntry[]): Recommendation[] {
  const counts = new Map<string, { total: number; gaveIn: number }>();
  for (const u of urges) {
    if (!u.trigger || !u.trigger.trim()) continue;
    const key = u.trigger.trim().toLowerCase();
    const e = counts.get(key) ?? { total: 0, gaveIn: 0 };
    e.total++;
    if (u.outcome === 'gave_in') e.gaveIn++;
    counts.set(key, e);
  }
  const recs: Recommendation[] = [];
  for (const [trigger, info] of counts) {
    if (info.total >= 2) {
      recs.push({
        kind: 'URGE_TRIGGER',
        title: `🔍 « ${trigger} » est ton déclencheur n°1`,
        detail: `« ${trigger} » apparaît dans ${info.total} journal${info.total > 1 ? 'aux' : ''} d'envies, dont ${info.gaveIn} où tu as cédé. Prévois une contre-habitude à l'avance pour ce moment précis.`,
        habitIds: [],
        strength: Math.min(85, 50 + info.total * 10),
        actionLabel: 'Voir envies',
      });
    }
  }
  return recs.slice(0, 2);
}

// --- Rule 24: Experiment result ---
// v0.4.0: Surface the outcome of a recently completed N=1 experiment.
function detectExperimentResults(experiments: Experiment[]): Recommendation[] {
  const completed = experiments
    .filter((e) => e.status === 'completed' && e.completedAt)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  if (completed.length === 0) return [];

  const exp = completed[0];
  const verdict = exp.conclusion.trim();
  return [{
    kind: 'EXPERIMENT_RESULT',
    title: `🧪 « ${exp.title} » — expérience terminée`,
    detail: verdict
      ? `Ton expérience « ${exp.title} » est bouclée. Conclusion : ${verdict}`
      : `Ton expérience « ${exp.title} » est bouclée — ajoute une conclusion pour verrouiller ce que tu as appris.`,
    habitIds: exp.linkedHabits,
    strength: 75,
    actionLabel: 'Voir expériences',
  }];
}

// --- Rule 25: Note themes ---
// v0.4.0: Recurring life themes across the user's free-form notes.
const THEME_KEYWORDS: Record<string, string> = {
  // Travail — FR+EN, avec variantes
  travail: 'Travail', work: 'Travail', job: 'Travail', bureau: 'Travail', office: 'Travail', boss: 'Travail', patron: 'Travail', meeting: 'Travail', reunion: 'Travail', projet: 'Travail', project: 'Travail', client: 'Travail', equipe: 'Travail', team: 'Travail', carriere: 'Travail', career: 'Travail',
  // Famille
  famille: 'Famille', family: 'Famille', kids: 'Famille', enfant: 'Famille', enfants: 'Famille', parents: 'Famille', mere: 'Famille', pere: 'Famille', couple: 'Famille', partenaire: 'Famille', partner: 'Famille', maison: 'Famille', home: 'Famille',
  // Sommeil
  sommeil: 'Sommeil', sleep: 'Sommeil', dormir: 'Sommeil', tired: 'Sommeil', fatigue: 'Sommeil', insomnia: 'Sommeil', insomnie: 'Sommeil', reveil: 'Sommeil', nuit: 'Sommeil', night: 'Sommeil', sieste: 'Sommeil', nap: 'Sommeil',
  // Argent
  argent: 'Argent', money: 'Argent', budget: 'Argent', debt: 'Argent', dette: 'Argent', finance: 'Argent', salaire: 'Argent', salary: 'Argent', economie: 'Argent', depenses: 'Argent', facture: 'Argent',
  // Sport
  sport: 'Sport', gym: 'Sport', exercise: 'Sport', running: 'Sport', course: 'Sport', musculation: 'Sport', yoga: 'Sport', velo: 'Sport', bike: 'Sport', entrainement: 'Sport', workout: 'Sport', seance: 'Sport',
  // Stress
  stress: 'Stress', stresse: 'Stress', pressure: 'Stress', pression: 'Stress', deadline: 'Stress', anxious: 'Stress', anxiete: 'Stress', angoisse: 'Stress', overwhelm: 'Stress', burnout: 'Stress', epuisement: 'Stress', tension: 'Stress',
  // Alimentation
  food: 'Alimentation', nourriture: 'Alimentation', repas: 'Alimentation', meal: 'Alimentation', diet: 'Alimentation', regime: 'Alimentation', nutrition: 'Alimentation', manger: 'Alimentation', cuisine: 'Alimentation', cooking: 'Alimentation',
  // Émotion / humeur
  emotion: 'Émotion', humeur: 'Émotion', mood: 'Émotion', joie: 'Émotion', tristesse: 'Émotion', colere: 'Émotion', peur: 'Émotion', gratitude: 'Émotion',
  // Social
  amis: 'Social', friends: 'Social', social: 'Social', sortie: 'Social', fete: 'Social', party: 'Social', solitude: 'Social', lonely: 'Social',
  // Santé
  sante: 'Santé', health: 'Santé', medecin: 'Santé', doctor: 'Santé', douleur: 'Santé', pain: 'Santé', maladie: 'Santé', sick: 'Santé',
};

function scoreThemesWithTfIdf(texts: string[]): Map<string, number> {
  const normTexts = texts.map((t) => normalizeForMatch(t));
  const N = normTexts.length || 1;
  // df per keyword
  const df = new Map<string, number>();
  for (const [kw] of Object.entries(THEME_KEYWORDS)) {
    const nkw = normalizeForMatch(kw);
    let c = 0;
    for (const txt of normTexts) if (txt.includes(nkw)) c++;
    if (c > 0) df.set(kw, c);
  }
  const themes = new Map<string, number>();
  for (const txt of normTexts) {
    for (const [kw, theme] of Object.entries(THEME_KEYWORDS)) {
      const nkw = normalizeForMatch(kw);
      if (!txt.includes(nkw)) continue;
      const dfi = df.get(kw) ?? 1;
      const idf = Math.log(N / dfi) + 1; // +1 smoothing, rarer = heavier
      themes.set(theme, (themes.get(theme) ?? 0) + idf);
    }
  }
  return themes;
}

function detectNoteThemes(notes: Note[]): Recommendation[] {
  if (notes.length === 0) return [];
  const themes = scoreThemesWithTfIdf(notes.map((n) => n.content));
  const sorted = [...themes.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || sorted[0][1] < 2.5) return [];
  const top = sorted.slice(0, 3);
  const totalScore = sorted.reduce((s, [, v]) => s + v, 0);
  return [{
    kind: 'NOTE_THEME',
    title: `🗂️ Tes notes tournent autour de : ${top.map(([t]) => t).join(', ')}`,
    detail: `Sur ${notes.length} notes, ${top.map(([t, c]) => `${t} (score ${c.toFixed(1)})`).join(', ')} dominent (TF-IDF, total ${totalScore.toFixed(1)}). Les thèmes rares pèsent plus — c'est là que ton attention se fixe. Creuse le top thème en journal.`,
    habitIds: [],
    strength: Math.min(85, Math.round(45 + sorted[0][1] * 8)),
    actionLabel: 'Voir notes',
  }];
}

// --- Rule 30: Journal themes ---
// v0.6.4: Recurring topics across journal entries (like detectNoteThemes, but on
// the journal where people actually express their inner world).
function detectJournalThemes(entries: JournalEntry[]): Recommendation[] {
  if (entries.length === 0) return [];
  const themes = scoreThemesWithTfIdf(entries.map((e) => e.content));
  const sorted = [...themes.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || sorted[0][1] < 2) return [];
  const top = sorted.slice(0, 3);
  const totalScore = sorted.reduce((s, [, v]) => s + v, 0);
  return [{
    kind: 'JOURNAL_THEME',
    title: `📓 Ton journal tourne autour de : ${top.map(([t]) => t).join(', ')}`,
    detail: `Sur ${entries.length} entrées, ${top.map(([t, c]) => `${t} (${c.toFixed(1)})`).join(', ')} ressortent (TF-IDF, total ${totalScore.toFixed(1)}). Le thème le plus distinctif mérite une session ciblée — écris sur ce que tu peux changer.`,
    habitIds: [],
    strength: Math.min(82, 50 + sorted[0][1] * 6),
    actionLabel: 'Ouvrir journal',
  }];
}

// --- Rule 31: Reflection due ---
// v0.6.4: The engine posed a question that is still unanswered. Surface it so
// the loop (observe → question → answer → learn) keeps moving.
function detectReflectionDue(reflections: ReflectionEntry[]): Recommendation[] {
  if (reflections.length === 0) return [];
  const open = reflections
    .filter((r) => r.status === 'open')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (open.length === 0) return [];
  const oldest = open[0];
  const answeredCount = reflections.filter((r) => r.status === 'answered').length;
  return [{
    kind: 'REFLECTION_DUE',
    title: `💭 ${open.length} question${open.length > 1 ? 's' : ''} attendent ta réponse`,
    detail: `Une est ouverte depuis le ${oldest.createdAt.slice(0, 10)} : « ${oldest.question} » — ${open.length > 1 ? `plus ${open.length - 1} autre${open.length - 1 > 1 ? 's' : ''}. ` : ''}Tu en as répondu ${answeredCount} jusqu'ici. Chaque réponse est une leçon durable dont LifeTrack se souvient.`,
    habitIds: oldest.habitIds ?? [],
    strength: Math.min(75, 45 + open.length * 10),
    actionLabel: 'Répondre',
  }];
}

// --- Rule 32: Reflection review ---
// v0.6.4: After enough answered reflections, gently invite re-reading the
// learned lessons — the stored wisdom compounds when revisited.
function detectReflectionReview(reflections: ReflectionEntry[], now: Date): Recommendation[] {
  const answered = reflections
    .filter((r) => r.status === 'answered' && r.answer)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (answered.length < 3) return [];
  const latest = answered[answered.length - 1];
  const weekCut = now.getTime() - 7 * 86400000;
  const recentCount = answered.filter((r) => new Date(r.createdAt).getTime() > weekCut).length;
  if (recentCount > 0) return []; // they're already in the loop, no nudge needed
  return [{
    kind: 'REFLECTION_REVIEW',
    title: `🔄 ${answered.length} leçons apprises — relis-les`,
    detail: `Ta dernière question répondue : « ${latest.question} ». Relire tes ${answered.length} réponses les ré-ancre. Prends-en une et agis dessus aujourd'hui.`,
    habitIds: latest.habitIds ?? [],
    strength: 62,
    actionLabel: 'Relire',
  }];
}

// --- Rule 26: Perfect day ---
// v0.4.0: A day where ALL active habits were completed (bonus: positive mood).
function detectPerfectDays(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string>,
  now: Date,
): Recommendation[] {
  const active = habits.filter((h) => !h.archived);
  if (active.length < 2) return [];

  const byDate = new Map<string, Set<string>>();
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    let set = byDate.get(ci.date);
    if (!set) { set = new Set(); byDate.set(ci.date, set); }
    set.add(ci.habitId);
  }

  for (let d = 0; d < 14; d++) {
    const ds = dateStrDaysAgo(d, now);
    const completed = byDate.get(ds);
    if (!completed || completed.size < active.length) continue;
    const mood = moods[ds];
    const goodMood = mood === 'amazing' || mood === 'great';
    return [{
      kind: 'PERFECT_DAY',
      title: `🌟 Journée parfaite le ${ds}${goodMood ? ' avec une super humeur' : ''}`,
      detail: `Tu as coché les ${active.length} habitudes le ${ds}${mood ? ` avec une humeur « ${mood} »` : ''}. Étudie ce qui a fait marcher ce jour-là — puis répète-le.`,
      habitIds: active.map((h) => h.id),
      strength: 85,
      actionLabel: "Voir l'historique",
    }];
  }
  return [];
}

// --- Rule 28: Weekly letter ---
// v0.4.0: A warm one-line summary of the week's mood + notes.
function generateWeeklyLetter(
  moods: Record<string, string>,
  notes: Note[],
  now: Date,
): Recommendation[] {
  const weekAgo = dateStrDaysAgo(7, now);
  const weekMoods = Object.entries(moods).filter(([d]) => d >= weekAgo);
  if (weekMoods.length === 0) return [];

  const dist: Record<string, number> = {};
  for (const [, m] of weekMoods) dist[m] = (dist[m] ?? 0) + 1;
  const topMood = Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'okay';
  const weekNotes = notes
    .filter((n) => n.createdAt.slice(0, 10) >= weekAgo)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastNote = weekNotes[weekNotes.length - 1];

  const parts: string[] = [`Ton humeur la plus fréquente cette semaine : « ${topMood} » (${weekMoods.length} jours notés).`];
  if (weekNotes.length > 0) {
    const excerpt = lastNote.content.length > 80 ? `${lastNote.content.slice(0, 80)}…` : lastNote.content;
    parts.push(`Tu as écrit ${weekNotes.length} note${weekNotes.length > 1 ? 's' : ''} — la dernière : « ${excerpt} ».`);
  }
  parts.push('Prends 30 secondes ce soir pour écrire une ligne sur ce que tu veux que la semaine prochaine ressemble.');

  return [{
    kind: 'WEEKLY_LETTER',
    title: '✉️ Ta semaine, en une ligne',
    detail: parts.join(' '),
    habitIds: [],
    strength: 55,
    actionLabel: 'Voir notes',
  }];
}

// --- Main entry point ---

export interface InsightsResult {
  recommendations: Recommendation[];
  generatedAt: string; // ISO date string
}

/** Extra non-habit data used by the v0.4.0 insight rules. */
export interface InsightContext {
  moods?: Record<string, string>;
  urges?: UrgeEntry[];
  capacities?: Capacity[];
  capacityRatings?: CapacityRating[];
  experiments?: Experiment[];
  notes?: Note[];
  /** v0.6.4: journal entries + reflections feed new insight rules. */
  journalEntries?: JournalEntry[];
  reflections?: ReflectionEntry[];
}

export function generateInsights(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date = new Date(),
  moods: Record<string, string> = {},
  extra: InsightContext = {},
): InsightsResult {
  const {
    urges = [],
    capacities = [],
    capacityRatings = [],
    experiments = [],
    notes = [],
    journalEntries = [],
    reflections = [],
  } = extra;
  const activeHabits = habits.filter((h) => !h.archived);
  const hasAnyData =
    activeHabits.length > 0 ||
    Object.keys(moods).length > 0 ||
    urges.length > 0 ||
    capacities.length > 0 ||
    capacityRatings.length > 0 ||
    experiments.length > 0 ||
    notes.length > 0 ||
    journalEntries.length > 0 ||
    reflections.length > 0;
  if (!hasAnyData) {
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
    ...detectPrimeTime(activeHabits, checkIns),
    ...detectCorrelations(activeHabits, checkIns),
    ...detectStreakMilestones(habits, checkIns, now),
    ...detectMantraMatches(activeHabits, checkIns, now),
    ...detectMoodHabitLink(activeHabits, checkIns, moods),
    ...detectChaosHabitLink(habits, checkIns, now),
    ...detectBurnoutRisk(activeHabits, checkIns, now, moods),
    ...detectUrgeTriggers(urges),
    ...detectExperimentResults(experiments),
    ...detectNoteThemes(notes),
    ...detectPerfectDays(activeHabits, checkIns, moods, now),
    ...generateWeeklySummary(habits, checkIns, now),
    ...generateWeeklyLetter(moods, notes, now),
    ...detectJournalThemes(journalEntries),
    ...detectReflectionDue(reflections),
    ...detectReflectionReview(reflections, now),
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
  // NEGLECTED/STACK_SUGGESTION/RECORD_APPROACH/BURNOUT > summaries > MISS_PATTERN
  const kindPriority: Record<RecKind, number> = {
    NEGLECTED: 0,
    RECORD_APPROACH: 0,
    STACK_SUGGESTION: 0,
    STREAK_MILESTONE: 0,
    CORRELATION: 0,
    WEEKLY_SUMMARY: 1,
    MANTRA_MATCH: 1,
    PRIME_TIME: 2,
    CHAOS_CORRELATION: 2,
    MISS_PATTERN: 3,
    BURNOUT_RISK: 0,
    URGE_TRIGGER: 1,
    EXPERIMENT_RESULT: 1,
    NOTE_THEME: 1,
    PERFECT_DAY: 1,
    WEEKLY_LETTER: 2,
    JOURNAL_THEME: 1,
    REFLECTION_DUE: 0,
    REFLECTION_REVIEW: 2,
    AI_PRIORITY: 0,
    AI_TREND: 1,
    AI_RISK: 0,
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
