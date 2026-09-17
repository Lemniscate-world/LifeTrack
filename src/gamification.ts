// src/gamification.ts
// Pure, local gamification engine: XP, levels, ranks, medals, week-over-week
// comparison and "persona to become" progress. No store access — every function
// derives from plain data so it can be unit-tested in isolation.
//
// XP is NEVER stored: it is re-derived from the user's real data (check-ins,
// notes, challenges) so a reload, import or rollback can never lose progress
// and no double-bookkeeping is possible.

import type { Capacity, CapacityRating, Challenge, CheckIn, Experiment, Habit, Lever, Note, Persona, Project, Skill, UrgeEntry } from './types';
import { isPartialCheckIn } from './types';
import { moodRank } from './correlations';
import { detectNegativePatterns } from './psychoanalysis';
import { toDateKey, fromDateKey, daysBetween } from './dates';
import { weeklyBoss } from './boss';

// Reference date for calendar-day offsets (avoids DST 23h/25h day bugs).
const DAY_ZERO = new Date(2020, 0, 1);

// --- XP rules ---
export const XP_RULES = {
  checkIn: 10,          // per completed check-in
  goalDay: 15,          // per day a habit's daily goal is met
  streakMilestone: 25,  // per full 7-day consecutive run (7, 14, 21, …)
  challenge: 50,        // per completed challenge
  achievement: 20,      // per note tagged as an achievement
} as const;

export interface XpBreakdown {
  checkIns: number;
  goalDays: number;
  streakMilestones: number;
  challenges: number;
  achievements: number;
  total: number;
}

function completedDayOffsets(habitId: string, checkIns: CheckIn[]): number[] {
  const days = new Set<number>();
  for (const ci of checkIns) {
    if (ci.habitId !== habitId || !ci.completed) continue;
    days.add(daysBetween(DAY_ZERO, fromDateKey(ci.date)));
  }
  return [...days].sort((a, b) => a - b);
}

/** Count of full 7-day consecutive runs for a habit (historical milestones). */
export function streakMilestonesForHabit(habitId: string, checkIns: CheckIn[]): number {
  const sorted = completedDayOffsets(habitId, checkIns);
  let milestones = 0;
  let run = 0;
  let prev = -Infinity;
  for (const t of sorted) {
    run = t - prev === 1 ? run + 1 : 1;
    if (run % 7 === 0) milestones++;
    prev = t;
  }
  return milestones;
}

/** Longest consecutive completed-day run across all habits (all-time record). */
export function bestStreakAllTime(habits: Habit[], checkIns: CheckIn[]): number {
  let best = 0;
  for (const h of habits) {
    const sorted = completedDayOffsets(h.id, checkIns);
    let run = 0;
    let prev = -Infinity;
    for (const t of sorted) {
      run = t - prev === 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = t;
    }
  }
  return best;
}

export function computeXp(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  challenges: Challenge[],
): XpBreakdown {
  let checkInsXp = 0;
  for (const ci of checkIns) if (ci.completed) checkInsXp += XP_RULES.checkIn;

  const goalByHabit = new Map<string, number>();
  for (const h of habits) goalByHabit.set(h.id, Math.max(1, h.goal || 1));

  // goal-day XP: one award per (habit, date) where the daily count meets goal
  const perDay = new Map<string, number>();
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    const key = ci.habitId + '|' + ci.date;
    perDay.set(key, (perDay.get(key) ?? 0) + (ci.count ?? 1));
  }
  let goalDaysXp = 0;
  for (const [key, count] of perDay) {
    const habitId = key.split('|')[0];
    if (count >= (goalByHabit.get(habitId) ?? 1)) goalDaysXp += XP_RULES.goalDay;
  }

  let streakXp = 0;
  for (const h of habits) {
    streakXp += streakMilestonesForHabit(h.id, checkIns) * XP_RULES.streakMilestone;
  }

  const challengeXp = challenges.filter((c) => c.status === 'completed').length * XP_RULES.challenge;
  const achievementXp = notes.filter((n) => n.achievementCategory).length * XP_RULES.achievement;

  return {
    checkIns: checkInsXp,
    goalDays: goalDaysXp,
    streakMilestones: streakXp,
    challenges: challengeXp,
    achievements: achievementXp,
    total: checkInsXp + goalDaysXp + streakXp + challengeXp + achievementXp,
  };
}

// --- Levels & ranks (classic cumulative XP curve) ---

/** Cumulative XP required to REACH a level (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.5));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function rankForLevel(level: number): { rankName: string; rankEmoji: string } {
  if (level >= 60) return { rankName: 'Legend', rankEmoji: '🌟' };
  if (level >= 40) return { rankName: 'Master of Self', rankEmoji: '👑' };
  if (level >= 25) return { rankName: 'Strategist', rankEmoji: '🧠' };
  if (level >= 15) return { rankName: 'Architect', rankEmoji: '🏛️' };
  if (level >= 10) return { rankName: 'Builder', rankEmoji: '🧱' };
  if (level >= 5) return { rankName: 'Observer', rankEmoji: '🔍' };
  return { rankName: 'Explorer', rankEmoji: '🧭' };
}

export interface LevelProgress {
  level: number;
  rankName: string;
  rankEmoji: string;
  xpIntoLevel: number;
  xpForNext: number;
  progressPct: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const xpIntoLevel = xp - base;
  const xpForNext = next - base;
  const progressPct = xpForNext > 0 ? Math.min(100, Math.round((xpIntoLevel / xpForNext) * 100)) : 100;
  const rank = rankForLevel(level);
  return { level, ...rank, xpIntoLevel, xpForNext, progressPct };
}

// --- Medals ---

export interface Medal {
  id: string;
  name: string;
  emoji: string;
  description: string;
  earned: boolean;
  earnedAt?: string;
  category?: string;      // UI grouping: Streak / Game / Mastery / Urge / Win / Challenge / etc.
  tier?: number;          // 0..n progression step within its category (for ordering)
  progress?: number;      // 0-100 completion toward the requirement (for near-earned display)
}

/** Extra data the medal engine can draw on. All optional — missing inputs are treated as empty. */
export interface MedalContext {
  urges?: UrgeEntry[];
  moods?: Record<string, string>;   // date -> mood id
  capacityRatings?: CapacityRating[];
  skills?: Skill[];
  capacities?: Capacity[];
  levers?: Lever[];
  personas?: Persona[];
  journalCount?: number;
  now?: Date;
  /** Emotional closure phrases written ("qu'est-ce que ça m'a appris ?"). */
  emotionalClosures?: number;
  /** Projects (deliverable-driven): done count feeds medals. */
  projects?: Project[];
  /** N=1 experiments: completed-with-conclusion feeds medals. */
  experiments?: Experiment[];
  /** Knowledge protocols adopted as habits (library put into practice). */
  protocolsAdopted?: number;
}

// --- Combos & resilience (the fun layer on top of XP) ---

/**
 * Combo days: consecutive days with ≥1 completed check-in, ending today —
 * or yesterday if today is not checked yet (the combo is still alive).
 * This is the number the 🔥 badge shows. Pure.
 */
export function comboDays(habits: Habit[], checkIns: CheckIn[], now: Date = new Date()): number {
  const activeIds = new Set(habits.filter((h) => !h.archived).map((h) => h.id));
  if (activeIds.size === 0) return 0;
  const doneDays = new Set<string>();
  for (const c of checkIns) {
    if (c.completed && activeIds.has(c.habitId)) doneDays.add(c.date);
  }
  let combo = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!doneDays.has(toDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (doneDays.has(toDateKey(cursor))) {
    combo++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return combo;
}

/** Score multiplier from the combo (goal-gradient fuel: streaks pay more). */
export function comboMultiplier(combo: number): 1 | 2 | 3 {
  if (combo >= 7) return 3;
  if (combo >= 3) return 2;
  return 1;
}

/** Today's XP (check-ins + goal days) with the combo multiplier applied. */
export function xpTodayWithCombo(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date = new Date(),
): { base: number; mult: 1 | 2 | 3; combo: number; total: number } {
  const key = toDateKey(now);
  const base = xpInRange(habits, checkIns, key, key);
  const combo = comboDays(habits, checkIns, now);
  const mult = comboMultiplier(combo);
  return { base, mult, combo, total: base * mult };
}

/**
 * Resilience shields: distinct days with a PARTIAL ("doux") validation in
 * the window. Bad days survived on purpose — the anti-what-the-hell score.
 */
export function resilienceShields(checkIns: CheckIn[], windowDays = 30, now: Date = new Date()): number {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (windowDays - 1));
  const fromKey = toDateKey(from);
  const toKey = toDateKey(now);
  const days = new Set<string>();
  for (const c of checkIns) {
    if (c.date < fromKey || c.date > toKey) continue;
    if (isPartialCheckIn(c)) days.add(c.date);
  }
  return days.size;
}

/** Number of days (0..365) that had at least one completed check-in. */
export function activeDaysWithData(checkIns: CheckIn[]): number {
  const days = new Set<string>();
  for (const ci of checkIns) if (ci.completed) days.add(ci.date);
  return days.size;
}

/** How many days have a recorded mood. */
export function moodDays(moods: Record<string, string>): number {
  return Object.keys(moods ?? {}).length;
}

/** Count of "surfed" urges (urge surfing wins). */
export function urgesSurfedCount(urges: UrgeEntry[]): number {
  return (urges ?? []).filter((u) => u.outcome === 'surfed').length;
}

/** Number of urges logged at all. */
export function urgesLoggedCount(urges: UrgeEntry[]): number {
  return (urges ?? []).length;
}

/** Count of days with a recorded mood of category `set` (or any if undefined). */
export function moodDaysInSet(moods: Record<string, string>, set: Set<string>): number {
  let n = 0;
  for (const mood of Object.values(moods ?? {})) if (set.has(mood)) n++;
  return n;
}

/** Number of skills that have at least one linked habit (actively levelled). */
export function skillsActiveCount(skills: Skill[]): number {
  return (skills ?? []).filter((s) => (s.links ?? []).length > 0).length;
}

/** Number of capacities rated at least once. */
export function hasPerfectDay(habits: Habit[], checkIns: CheckIn[]): boolean {
  const active = habits.filter((h) => !h.archived);
  if (active.length === 0) return false;
  const activeIds = new Set(active.map((h) => h.id));
  const byDay = new Map<string, Set<string>>();
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    if (!byDay.has(ci.date)) byDay.set(ci.date, new Set());
    byDay.get(ci.date)!.add(ci.habitId);
  }
  for (const set of byDay.values()) {
    let all = true;
    for (const id of activeIds) {
      if (!set.has(id)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Count of active habits with ≥70% completion over the last `windowDays`. */
export function habitMastersCount(
  habits: Habit[],
  checkIns: CheckIn[],
  windowDays = 30,
  now: Date = new Date(),
): number {
  const window = new Set<string>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    window.add(toDateKey(d));
  }
  let masters = 0;
  for (const h of habits) {
    if (h.archived) continue;
    let done = 0;
    for (const ci of checkIns) {
      if (ci.habitId === h.id && ci.completed && window.has(ci.date)) done++;
    }
    if (windowDays > 0 && done / windowDays >= 0.7) masters++;
  }
  return masters;
}

export function capacitiesProgressCount(capacities: Capacity[], ratings: CapacityRating[]): number {
  const rated = new Set((ratings ?? []).map((r) => r.capacityId));
  return (capacities ?? []).filter((c) => rated.has(c.id)).length;
}

export function computeMedals(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  challenges: Challenge[],
  xp: number,
  level: number,
  ctx: MedalContext = {},
): Medal[] {
  const now = ctx.now ?? new Date();
  void now;
  const totalCheckIns = checkIns.filter((c) => c.completed).length;
  const achievementNotes = notes.filter((n) => n.achievementCategory).length;
  const completedChallenges = challenges.filter((c) => c.status === 'completed').length;
  const activeDays = activeDaysWithData(checkIns);
  const moodsLogged = moodDays(ctx.moods ?? {});
  const surfed = urgesSurfedCount(ctx.urges ?? []);
  const urgesLogged = urgesLoggedCount(ctx.urges ?? []);
  const activeSkills = skillsActiveCount(ctx.skills ?? []);
  const trainingCapacities = capacitiesProgressCount(ctx.capacities ?? [], ctx.capacityRatings ?? []);
  const leverCount = (ctx.levers ?? []).length;
  const personaCount = (ctx.personas ?? []).length;
  const journalCount = ctx.journalCount ?? 0;
  // --- Life-intelligence metrics (v0.6.3): projects, experiments, knowledge ---
  const projectsDone = (ctx.projects ?? []).filter((p) => p.status === 'done').length;
  const projectsActive = (ctx.projects ?? []).filter((p) => p.status === 'active').length;
  const projectTasksDone = (ctx.projects ?? []).reduce(
    (s, p) => s + p.tasks.filter((t) => t.done).length, 0,
  );
  const experimentsConcluded = (ctx.experiments ?? []).filter(
    (e) => e.status === 'completed' && e.conclusion.trim().length > 0,
  ).length;
  const experimentsActive = (ctx.experiments ?? []).filter((e) => e.status === 'active').length;
  const protocolsAdopted = ctx.protocolsAdopted ?? 0;

  // --- Deep metrics (v0.5.2): patterns, surf rate, mood trajectory, lever effect ---
  const patternCount = detectNegativePatterns(checkIns, notes, ctx.urges ?? []).length;
  const surfRate = urgesLogged > 0 ? surfed / urgesLogged : 0;
  const leverWithEffect = (ctx.levers ?? []).some((l) => Boolean(l.effect));
  // Mood trajectory: average mood rank of the most recent ≤14 logged days vs the
  // ≤14 days before that window (both need ≥4 samples).
  const moodDates = Object.keys(ctx.moods ?? {})
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  let moodRising = false;
  if (moodDates.length >= 8) {
    const recent = moodDates.slice(-14);
    const earlier = moodDates.slice(-28, -14);
    const avg = (arr: string[]) => arr.reduce((s, d) => s + moodRank((ctx.moods ?? {})[d]), 0) / arr.length;
    if (recent.length >= 4 && earlier.length >= 4 && avg(recent) >= avg(earlier) + 0.5) moodRising = true;
  }

  let earliestCheckIn: string | undefined;
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    if (!earliestCheckIn || ci.date < earliestCheckIn) earliestCheckIn = ci.date;
  }
  let earliestAchievement: string | undefined;
  for (const n of notes) {
    if (!n.achievementCategory) continue;
    const d = n.createdAt.slice(0, 10);
    if (!earliestAchievement || d < earliestAchievement) earliestAchievement = d;
  }
  // Earliest completed challenge + earliest surfed urge dates.
  let earliestChallenge: string | undefined;
  for (const c of challenges) {
    if (c.status !== 'completed') continue;
    const d = (c.completedAt ?? c.startDate).slice(0, 10);
    if (!earliestChallenge || d < earliestChallenge) earliestChallenge = d;
  }
  let earliestSurf: string | undefined;
  for (const u of ctx.urges ?? []) {
    if (u.outcome !== 'surfed') continue;
    const d = u.startTime.slice(0, 10);
    if (!earliestSurf || d < earliestSurf) earliestSurf = d;
  }

  const bestStreak = bestStreakAllTime(habits, checkIns);
  const masters = habitMastersCount(habits, checkIns);
  const perfectDay = hasPerfectDay(habits, checkIns);

  // --- Resilience & boss metrics (new fun layer) ---
  const shields30 = resilienceShields(checkIns, 30, now);
  const ifThenCount = habits.filter((h) => !h.archived).reduce((s, h) => s + (h.ifThen?.length ?? 0), 0);
  const closureCount = ctx.emotionalClosures ?? 0;
  // Phoenix: came back (≥1 check in the last 7d) after a ≥7d hole.
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const weekAgoKey = toDateKey(weekAgo);
  const todayKey = toDateKey(now);
  const phoenix = habits.some((h) => {
    if (h.archived || (h.longestGap ?? 0) < 7) return false;
    return checkIns.some((c) => c.habitId === h.id && c.completed && c.date >= weekAgoKey && c.date <= todayKey);
  });
  // Last week's boss, judged final (as of last Sunday).
  const daysSinceMonday = (now.getDay() + 6) % 7;
  const lastSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (daysSinceMonday + 1));
  const lastBossSlain = weeklyBoss(habits, checkIns, lastSunday).slain;

  // Helper to build a tiered "ladder" of medals from a set of thresholds.
  const pct = (got: number, need: number, inverted = false): number => {
    if (need <= 0) return 0;
    const raw = (got / need) * 100;
    return inverted ? Math.min(100, Math.max(0, ((need - got) / need) * 100)) : Math.max(0, Math.min(100, raw));
  };

  const defs: Medal[] = [
    // ---- Grundlagen: Streaks & consistency ----
    { id: 'streak-1', name: 'Moving', emoji: '🎬', description: '1-day streak on any habit', tier: 0, earned: bestStreak >= 1, progress: pct(bestStreak, 1), category: 'Streak' },
    { id: 'streak-3', name: 'Spark', emoji: '✨', description: '3-day streak on any habit', tier: 1, earned: bestStreak >= 3, progress: pct(bestStreak, 3), category: 'Streak' },
    { id: 'streak-7', name: 'Week on Fire', emoji: '🔥', description: '7-day streak on any habit', tier: 2, earned: bestStreak >= 7, progress: pct(bestStreak, 7), category: 'Streak' },
    { id: 'streak-14', name: 'Two Weeks Down', emoji: '🔖', description: '14-day streak on any habit', tier: 3, earned: bestStreak >= 14, progress: pct(bestStreak, 14), category: 'Streak' },
    { id: 'streak-30', name: 'Month of Steel', emoji: '🧨', description: '30-day streak on any habit', tier: 4, earned: bestStreak >= 30, progress: pct(bestStreak, 30), category: 'Streak' },
    { id: 'streak-60', name: 'Seasoned', emoji: '🥁', description: '60-day streak on any habit', tier: 5, earned: bestStreak >= 60, progress: pct(bestStreak, 60), category: 'Streak' },
    { id: 'streak-100', name: 'Centurion', emoji: '💯', description: '100-day streak on any habit', tier: 6, earned: bestStreak >= 100, progress: pct(bestStreak, 100), category: 'Streak' },
    { id: 'streak-365', name: 'Master of Years', emoji: '👑', description: 'A full 365-day streak on any habit', tier: 7, earned: bestStreak >= 365, progress: pct(bestStreak, 365), category: 'Streak' },

    // ---- Game: XP and level ----
    { id: 'xp-100', name: '100 XP', emoji: '🔹', description: 'Earn 100 lifetime XP', tier: 0, earned: xp >= 100, progress: pct(xp, 100), category: 'Game' },
    { id: 'xp-500', name: '500 XP', emoji: '⚡', description: 'Earn 500 lifetime XP', tier: 1, earned: xp >= 500, progress: pct(xp, 500), category: 'Game' },
    { id: 'xp-1000', name: '1000 XP', emoji: '🌠', description: 'Earn 1000 lifetime XP', tier: 2, earned: xp >= 1000, progress: pct(xp, 1000), category: 'Game' },
    { id: 'xp-2000', name: '2000 XP', emoji: '🌋', description: 'Earn 2000 lifetime XP', tier: 3, earned: xp >= 2000, progress: pct(xp, 2000), category: 'Game' },
    { id: 'xp-5000', name: '5000 XP', emoji: '🚀', description: 'Earn 5000 lifetime XP', tier: 4, earned: xp >= 5000, progress: pct(xp, 5000), category: 'Game' },
    { id: 'xp-10000', name: '10000 XP', emoji: '🌕', description: 'Earn 10000 lifetime XP', tier: 5, earned: xp >= 10000, progress: pct(xp, 10000), category: 'Game' },
    { id: 'xp-25000', name: '25000 XP', emoji: '☄️', description: 'Earn 25000 lifetime XP', tier: 6, earned: xp >= 25000, progress: pct(xp, 25000), category: 'Game' },
    { id: 'level-5', name: 'Explorer', emoji: '🧭', description: 'Reach level 5', tier: 0, earned: level >= 5, progress: pct(level, 5), category: 'Game' },
    { id: 'level-10', name: 'Learner', emoji: '🛠️', description: 'Reach level 10', tier: 1, earned: level >= 10, progress: pct(level, 10), category: 'Game' },
    { id: 'level-15', name: 'Architect', emoji: '🏛️', description: 'Reach level 15', tier: 2, earned: level >= 15, progress: pct(level, 15), category: 'Game' },
    { id: 'level-25', name: 'Strategist', emoji: '🧠', description: 'Reach level 25', tier: 3, earned: level >= 25, progress: pct(level, 25), category: 'Game' },
    { id: 'level-40', name: 'Master of Self', emoji: '👑', description: 'Reach level 40', tier: 4, earned: level >= 40, progress: pct(level, 40), category: 'Game' },
    { id: 'level-60', name: 'Legend', emoji: '🌟', description: 'Reach level 60', tier: 5, earned: level >= 60, progress: pct(level, 60), category: 'Game' },

    // ---- Consistency: total check-ins & active days ----
    { id: 'ci-10', name: '10 Check-ins', emoji: '🟦', description: 'Log 10 completed check-ins', tier: 0, earned: totalCheckIns >= 10, progress: pct(totalCheckIns, 10), category: 'Consistency' },
    { id: 'ci-50', name: '50 Check-ins', emoji: '📈', description: 'Log 50 completed check-ins', tier: 1, earned: totalCheckIns >= 50, progress: pct(totalCheckIns, 50), category: 'Consistency' },
    { id: 'ci-100', name: '100 Check-ins', emoji: '🔟', description: 'Log 100 completed check-ins', tier: 2, earned: totalCheckIns >= 100, progress: pct(totalCheckIns, 100), category: 'Consistency' },
    { id: 'ci-250', name: '250 Check-ins', emoji: '🏅', description: 'Log 250 completed check-ins', tier: 3, earned: totalCheckIns >= 250, progress: pct(totalCheckIns, 250), category: 'Consistency' },
    { id: 'ci-500', name: '500 Check-ins', emoji: '🎖️', description: 'Log 500 completed check-ins', tier: 4, earned: totalCheckIns >= 500, progress: pct(totalCheckIns, 500), category: 'Consistency' },
    { id: 'ci-1000', name: '1000 Check-ins', emoji: '🎆', description: 'Log 1000 completed check-ins', tier: 5, earned: totalCheckIns >= 1000, progress: pct(totalCheckIns, 1000), category: 'Consistency' },
    { id: 'day-30', name: '30 Active Days', emoji: '🗓️', description: 'Complete check-ins across 30 distinct days', tier: 0, earned: activeDays >= 30, progress: pct(activeDays, 30), category: 'Consistency' },
    { id: 'day-90', name: '90 Active Days', emoji: '📅', description: 'Log a completed day on 90 distinct days', tier: 1, earned: activeDays >= 90, progress: pct(activeDays, 90), category: 'Consistency' },
    { id: 'day-200', name: 'Half-Year Active', emoji: '🌗', description: 'Log a completed day on 200 distinct days', tier: 2, earned: activeDays >= 200, progress: pct(activeDays, 200), category: 'Consistency' },

    // ---- Mastery: perfect day & habit masters ----
    { id: 'master-1', name: 'Solid Builder', emoji: '🧱', description: 'Have 1 habit at 70%+ completion over 30 days', tier: 0, earned: masters >= 1, progress: pct(masters, 1), category: 'Mastery' },
    { id: 'master-3', name: 'Stable 3', emoji: '🧲', description: '3 habits at 70%+ over 30 days', tier: 1, earned: masters >= 3, progress: pct(masters, 3), category: 'Mastery' },
    { id: 'master-5', name: 'Golden Rhythm', emoji: '🏆', description: '5+ habits at 70%+ over 30 days', tier: 2, earned: masters >= 5, progress: pct(masters, 5), category: 'Mastery' },
    { id: 'master-8', name: 'Wheel', emoji: '🎡', description: '8+ habits at 70%+ over 30 days', tier: 3, earned: masters >= 8, progress: pct(masters, 8), category: 'Mastery' },
    { id: 'perfect-first', name: 'Perfect Day', emoji: '💯', description: 'Every active habit done in a single day', earned: perfectDay, progress: perfectDay ? 100 : 0, category: 'Mastery' },

    // ---- Urges: the mind chitchen ----
    { id: 'urge-1', name: 'First Wave', emoji: '🌊', description: 'Surf your first urge', tier: 0, earned: surfed >= 1, progress: pct(surfed, 1), category: 'Urge' },
    { id: 'urge-10', name: 'Wave Rider', emoji: '🏄', description: 'Surf 10 urges', tier: 1, earned: surfed >= 10, progress: pct(surfed, 10), category: 'Urge' },
    { id: 'urge-25', name: 'Surfing the Storm', emoji: '🌩️', description: 'Surf 25 urges', tier: 2, earned: surfed >= 25, progress: pct(surfed, 25), category: 'Urge' },
    { id: 'urge-50', name: '50 Waves Surfed', emoji: '🌊', description: 'Surf 50 urges', tier: 3, earned: surfed >= 50, progress: pct(surfed, 50), category: 'Urge' },
    { id: 'urge-100', name: 'Oceantic', emoji: '🌊', description: '100 urges surfed', tier: 4, earned: surfed >= 100, progress: pct(surfed, 100), category: 'Urge' },
    { id: 'aware-25', name: 'Self-Aware', emoji: '👁️', description: 'Log 25 urges of any outcome', tier: 0, earned: urgesLogged >= 25, progress: pct(urgesLogged, 25), category: 'Urge' },

    // ---- Mood & Reflection ----
    { id: 'mood-7', name: '7 Mood Logs', emoji: '🎭', description: 'Record your mood on 7 days', tier: 0, earned: moodsLogged >= 7, progress: pct(moodsLogged, 7), category: 'Reflection' },
    { id: 'mood-30', name: '30 Mood Logs', emoji: '🌈', description: 'Record your mood on 30 days', tier: 1, earned: moodsLogged >= 30, progress: pct(moodsLogged, 30), category: 'Reflection' },
    { id: 'mood-90', name: '90 Mood Logs', emoji: '🔮', description: 'Record your mood on 90 days', tier: 2, earned: moodsLogged >= 90, progress: pct(moodsLogged, 90), category: 'Reflection' },
    { id: 'journal-10', name: 'Journaling Habit', emoji: '📓', description: 'Write 10 journal entries', tier: 0, earned: journalCount >= 10, progress: pct(journalCount, 10), category: 'Reflection' },
    { id: 'journal-50', name: 'Deep Journaler', emoji: '🖋️', description: 'Write 50 journal entries', tier: 1, earned: journalCount >= 50, progress: pct(journalCount, 50), category: 'Reflection' },

    // ---- Deep analytics (v0.5.2): patterns, mood trajectory, surf balance ----
    { id: 'pattern-1', name: 'Détective de soi', emoji: '🕵️', description: 'Repérer 1 schéma négatif dans ses écrits', tier: 0, earned: patternCount >= 1, progress: pct(patternCount, 1), category: 'Reflection' },
    { id: 'pattern-3', name: 'Cartographe mental', emoji: '🗺️', description: 'Repérer 3 schémas négatifs distincts', tier: 1, earned: patternCount >= 3, progress: pct(patternCount, 3), category: 'Reflection' },
    { id: 'pattern-6', name: 'Voyageur·se de l\'esprit', emoji: '🧭', description: 'Repérer 6 schémas négatifs distincts', tier: 2, earned: patternCount >= 6, progress: pct(patternCount, 6), category: 'Reflection' },
    { id: 'surf-balance', name: 'Maître des vagues', emoji: '🏄', description: 'Surfer ≥50% des urges (10 ou plus)', tier: 0, earned: urgesLogged >= 10 && surfRate >= 0.5, progress: pct(surfRate, 0.5), category: 'Urge' },
    { id: 'mood-rising', name: 'Humeur en hausse', emoji: '🌅', description: 'Humeur moyenne récente meilleure que la précédente', tier: 0, earned: moodRising, progress: moodRising ? 100 : 50, category: 'Reflection' },
    { id: 'lever-effect', name: 'Scientifique personnel', emoji: '🔬', description: 'Documenter l\'effet d\'au moins un levier', tier: 0, earned: leverWithEffect, progress: leverWithEffect ? 100 : 50, category: 'Self' },

    // ---- Skills & Capacities ----
    { id: 'skill-1', name: 'Skill Builder', emoji: '🧩', description: 'Link a habit to a skill', tier: 0, earned: activeSkills >= 1, progress: pct(activeSkills, 1), category: 'Skills' },
    { id: 'skill-3', name: 'Tri-Skill', emoji: '🎲', description: 'Level 3 skills', tier: 1, earned: activeSkills >= 3, progress: pct(activeSkills, 3), category: 'Skills' },
    { id: 'skill-5', name: 'Pentagon', emoji: '🔺', description: 'Level 5 skills', tier: 2, earned: activeSkills >= 5, progress: pct(activeSkills, 5), category: 'Skills' },
    { id: 'cap-1', name: 'First Capacity', emoji: '📊', description: 'Train a capacity', tier: 0, earned: trainingCapacities >= 1, progress: pct(trainingCapacities, 1), category: 'Skills' },
    { id: 'cap-3', name: '3 Capacities', emoji: '📈', description: 'Train 3 capacities', tier: 1, earned: trainingCapacities >= 3, progress: pct(trainingCapacities, 3), category: 'Skills' },
    { id: 'cap-5', name: '5 Capacities', emoji: '🧪', description: 'Train 5 capacities', tier: 2, earned: trainingCapacities >= 5, progress: pct(trainingCapacities, 5), category: 'Skills' },

    // ---- Levers & Personas: the reflective self ----
    { id: 'lever-1', name: 'First Lever', emoji: '⚙️', description: 'Save your first lever', tier: 0, earned: leverCount >= 1, progress: pct(leverCount, 1), category: 'Self' },
    { id: 'lever-5', name: '5 Levers', emoji: '🪄', description: 'Save 5 levers', tier: 1, earned: leverCount >= 5, progress: pct(leverCount, 5), category: 'Self' },
    { id: 'lever-15', name: '15 Levers', emoji: '🗝️', description: 'Save 15 levers', tier: 2, earned: leverCount >= 15, progress: pct(leverCount, 15), category: 'Self' },
    { id: 'persona-1', name: 'First Persona', emoji: '🧭', description: 'Define your first persona', tier: 0, earned: personaCount >= 1, progress: pct(personaCount, 1), category: 'Self' },
    { id: 'persona-3', name: '3 Personas', emoji: '👥', description: 'Define 3 personas', tier: 1, earned: personaCount >= 3, progress: pct(personaCount, 3), category: 'Self' },
    { id: 'persona-5', name: 'Many Selves', emoji: '🪞', description: 'Define 5 personas', tier: 2, earned: personaCount >= 5, progress: pct(personaCount, 5), category: 'Self' },

    // ---- Milestones from real events (earnedAt) ----
    { id: 'first-steps', name: 'First Steps', emoji: '🚀', description: 'Complete your first check-in', earned: totalCheckIns >= 1, earnedAt: earliestCheckIn, category: 'Milestones' },
    { id: 'first-win', name: 'First Win', emoji: '🏅', description: 'Tag your first achievement', earned: achievementNotes >= 1, earnedAt: earliestAchievement, category: 'Milestones' },
    { id: 'first-challenge', name: 'First Challenge', emoji: '🎯', description: 'Complete your first challenge', earned: completedChallenges >= 1, progress: pct(completedChallenges, 1), category: 'Mastery' },
    { id: 'first-surf', name: 'First Surf', emoji: '🏄', description: 'Surf your first urge', earned: surfed >= 1, earnedAt: earliestSurf, category: 'Milestones' },
    { id: 'challenge-5', name: '5 Challenges', emoji: '🎖️', description: 'Complete 5 challenges', tier: 0, earned: completedChallenges >= 5, progress: pct(completedChallenges, 5), category: 'Mastery' },

    // ---- Resilience: surviving bad days on purpose ----
    { id: 'phoenix', name: 'Phénix', emoji: '🔥🐦', description: 'Reprendre après un trou de 7+ jours', tier: 0, earned: phoenix, progress: phoenix ? 100 : 50, category: 'Résilience' },
    { id: 'doux-3', name: '3 jours doux', emoji: '🌗', description: '3 validations douces sur 30 jours — le streak survit', tier: 0, earned: shields30 >= 3, progress: pct(shields30, 3), category: 'Résilience' },
    { id: 'doux-10', name: '10 jours doux', emoji: '🌗🌗', description: '10 validations douces sur 30 jours', tier: 1, earned: shields30 >= 10, progress: pct(shields30, 10), category: 'Résilience' },
    { id: 'boss-slay', name: 'Tueur de boss', emoji: '⚔️', description: 'Blesser à mort le boss de la semaine dernière', tier: 0, earned: lastBossSlain, progress: lastBossSlain ? 100 : 50, category: 'Résilience' },
    { id: 'ifthen-3', name: 'Stratège si-alors', emoji: '🧭', description: 'Écrire 3 plans si-alors (ils tirent 2× plus)', tier: 0, earned: ifThenCount >= 3, progress: pct(ifThenCount, 3), category: 'Résilience' },
    { id: 'closure-1', name: 'Faiseur de sens', emoji: '🕊️', description: 'Clore un épisode avec une phrase de sens', tier: 0, earned: closureCount >= 1, progress: pct(closureCount, 1), category: 'Résilience' },

    // ---- Life intelligence (v0.6.3): projects, experiments, knowledge ----
    { id: 'project-1', name: 'Bâtisseur', emoji: '🏗️', description: 'Conclure 1 projet (statut done)', tier: 0, earned: projectsDone >= 1, progress: pct(projectsDone, 1), category: 'Projets' },
    { id: 'project-3', name: 'Sériel', emoji: '📚', description: 'Conclure 3 projets', tier: 1, earned: projectsDone >= 3, progress: pct(projectsDone, 3), category: 'Projets' },
    { id: 'project-5', name: 'Empire building', emoji: '🌆', description: 'Conclure 5 projets', tier: 2, earned: projectsDone >= 5, progress: pct(projectsDone, 5), category: 'Projets' },
    { id: 'project-tasks-25', name: 'Exécutant', emoji: '✅', description: '25 tâches de projet terminées', tier: 0, earned: projectTasksDone >= 25, progress: pct(projectTasksDone, 25), category: 'Projets' },
    { id: 'project-ship', name: 'Livreur', emoji: '🚢', description: 'Avoir un projet actif avec échéance — ship it', tier: 0, earned: projectsActive >= 1 && (ctx.projects ?? []).some((p) => p.status === 'active' && !!p.deadline), progress: projectsActive >= 1 ? 60 : 0, category: 'Projets' },
    { id: 'exp-1', name: 'Chercheur de soi', emoji: '🧪', description: 'Conclure 1 expérience N=1 avec conclusion écrite', tier: 0, earned: experimentsConcluded >= 1, progress: pct(experimentsConcluded, 1), category: 'N=1' },
    { id: 'exp-3', name: 'Labo personnel', emoji: '🔬', description: 'Conclure 3 expériences N=1', tier: 1, earned: experimentsConcluded >= 3, progress: pct(experimentsConcluded, 3), category: 'N=1' },
    { id: 'exp-5', name: 'Méthode scientifique', emoji: '⚗️', description: 'Conclure 5 expériences N=1', tier: 2, earned: experimentsConcluded >= 5, progress: pct(experimentsConcluded, 5), category: 'N=1' },
    { id: 'exp-running', name: 'En expérimentation', emoji: '🫗', description: 'Garder 1 expérience active en cours', tier: 0, earned: experimentsActive >= 1, progress: experimentsActive >= 1 ? 100 : 0, category: 'N=1' },
    { id: 'knowledge-1', name: 'Passage à l\'acte', emoji: '📖', description: 'Adopter 1 protocole de la bibliothèque en habitude', tier: 0, earned: protocolsAdopted >= 1, progress: pct(protocolsAdopted, 1), category: 'Savoir' },
    { id: 'knowledge-5', name: 'Étudiant du corps', emoji: '🧬', description: 'Adopter 5 protocoles', tier: 1, earned: protocolsAdopted >= 5, progress: pct(protocolsAdopted, 5), category: 'Savoir' },
    { id: 'knowledge-10', name: 'Bibliothèque vivante', emoji: '🏛️', description: 'Adopter 10 protocoles', tier: 2, earned: protocolsAdopted >= 10, progress: pct(protocolsAdopted, 10), category: 'Savoir' },
  ];

  return defs;
}

// --- Week-over-week comparison ("vs who you were before") ---

export interface WeekComparison {
  currentXp: number;
  previousXp: number;
  deltaXp: number;
  deltaPct: number;         // relative change vs the previous week
  improved: boolean;
  currentCompleted: number;
  previousCompleted: number;
}

/** XP earned strictly inside [fromKey, toKey] (inclusive, YYYY-MM-DD keys). */
export function xpInRange(habits: Habit[], checkIns: CheckIn[], fromKey: string, toKey: string): number {
  const goalByHabit = new Map<string, number>();
  for (const h of habits) goalByHabit.set(h.id, Math.max(1, h.goal || 1));
  const perDay = new Map<string, number>();
  let xp = 0;
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    if (ci.date < fromKey || ci.date > toKey) continue;
    xp += XP_RULES.checkIn;
    const key = ci.habitId + '|' + ci.date;
    perDay.set(key, (perDay.get(key) ?? 0) + (ci.count ?? 1));
  }
  for (const [key, count] of perDay) {
    const habitId = key.split('|')[0];
    if (count >= (goalByHabit.get(habitId) ?? 1)) xp += XP_RULES.goalDay;
  }
  return xp;
}

export function compareLastWeeks(habits: Habit[], checkIns: CheckIn[], now: Date = new Date()): WeekComparison {
  const today = toDateKey(now);
  const fromCur = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const toPrev = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
  const fromPrev = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13));

  const currentXp = xpInRange(habits, checkIns, fromCur, today);
  const previousXp = xpInRange(habits, checkIns, fromPrev, toPrev);
  const deltaXp = currentXp - previousXp;
  const deltaPct = previousXp > 0
    ? Math.round((deltaXp / previousXp) * 100)
    : currentXp > 0 ? 100 : 0;

  let currentCompleted = 0;
  let previousCompleted = 0;
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    if (ci.date >= fromCur && ci.date <= today) currentCompleted++;
    else if (ci.date >= fromPrev && ci.date <= toPrev) previousCompleted++;
  }

  return {
    currentXp,
    previousXp,
    deltaXp,
    deltaPct,
    improved: currentXp >= previousXp,
    currentCompleted,
    previousCompleted,
  };
}

// --- Personas ("who you are becoming") ---

export interface PersonaProgress {
  persona: Persona;
  pct: number;              // average completion rate across linked habits
  windowDays: number;
  completedDays: number;    // sum of completed days across linked habits
  habits: { habitId: string; habitName: string; pct: number }[];
}

export function personaProgress(
  persona: Persona,
  habits: Habit[],
  checkIns: CheckIn[],
  windowDays = 14,
  now: Date = new Date(),
): PersonaProgress | null {
  const habitById = new Map(habits.map((h) => [h.id, h]));
  const linked = persona.habitIds
    .map((id) => habitById.get(id))
    .filter((h): h is Habit => !!h && !h.archived);
  if (linked.length === 0) return null;

  const window = new Set<string>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    window.add(toDateKey(d));
  }

  const perHabit = linked.map((h) => {
    const days = new Set<string>();
    for (const ci of checkIns) {
      if (ci.habitId === h.id && ci.completed && window.has(ci.date)) days.add(ci.date);
    }
    const pct = windowDays > 0 ? Math.round((days.size / windowDays) * 100) : 0;
    return { habitId: h.id, habitName: h.name, pct };
  });

  const pct = Math.round(perHabit.reduce((s, x) => s + x.pct, 0) / perHabit.length);
  const completedDays = perHabit.reduce((s, x) => s + Math.round((x.pct * windowDays) / 100), 0);

  return { persona, pct, windowDays, completedDays, habits: perHabit };
}

// --- Automatic persona suggestions ("detected personas") ---
// The app looks at the user's real behaviour and proposes "versions of you"
// that are emerging, without the user having to design them. These are
// suggestions only — the user validates them (one click) to make them real.

export interface PersonaSuggestion {
  name: string;
  emoji: string;
  description: string;
  habitIds: string[];
  avgPct: number;   // average completion rate across the suggested habits (14d)
  reason: string;   // why the app thinks this is emerging
  /** 'habit' personas need their habits; 'reflective' personas survive with zero habits. */
  kind: 'habit' | 'reflective';
}

const CATEGORY_META: Record<string, { label: string; emoji: string }> = {
  health: { label: 'Santé', emoji: '💪' },
  work: { label: 'Travail', emoji: '💼' },
  personal: { label: 'Personnel', emoji: '🌿' },
  learning: { label: 'Apprentissage', emoji: '📚' },
  finance: { label: 'Finances', emoji: '💰' },
};

/** Extra signals `suggestPersonas` can draw on to detect more self-versions. */
export interface PersonaSuggestionContext {
  moods?: Record<string, string>;   // date -> mood id
  urges?: UrgeEntry[];
  levers?: Lever[];
  noteCount?: number;               // achieved/standalone note count
}

/** Strong habits: ≥ 70% completion over the last 14 days, grouped by category. */
export function suggestPersonas(
  habits: Habit[],
  checkIns: CheckIn[],
  now: Date = new Date(),
  ctx: PersonaSuggestionContext = {},
): PersonaSuggestion[] {
  const active = habits.filter((h) => !h.archived);
  const suggestions: PersonaSuggestion[] = [];

  // 3. Reflective / self-observation personas. These run even with no habits,
  //    so users who only log moods/urges still get detected selves.
  const moodEntries = Object.keys(ctx.moods ?? {}).length;
  const surfed = (ctx.urges ?? []).filter((u) => u.outcome === 'surfed').length;
  const urgesLogged = (ctx.urges ?? []).length;
  const leverCount = (ctx.levers ?? []).length;
  const noteCount = ctx.noteCount ?? 0;

  if (moodEntries > 0) {
    suggestions.push({
      name: 'Observateur·rice de soi',
      emoji: '🔍',
      description: 'Vous écrivez ce que vous ressentez jour après jour.',
      habitIds: [],
      kind: 'reflective',
      avgPct: Math.min(100, moodEntries),
      reason: `${moodEntries} humeurs consignées.`,
    });
  }
  if (urgesLogged > 0) {
    const rate = urgesLogged > 0 ? Math.round((surfed / urgesLogged) * 100) : 0;
    suggestions.push({
      name: rate >= 50 ? 'Surfeur·euse d’urgences' : 'Curieux·se de vos pulsions',
      emoji: '🌊',
      description:
        rate >= 50
          ? 'Vous surfez plus de la moitié de vos envies au lieu d’y céder.'
          : 'Vous observez vos envies avant qu’elles ne vous contrôlent.',
      habitIds: [],
      kind: 'reflective',
      avgPct: Math.min(100, rate),
      reason: `${surfed}/${urgesLogged} urges surfées.`,
    });
  }
  if (leverCount > 0) {
    suggestions.push({
      name: 'Ingénieur·e du quotidien',
      emoji: '⚙️',
      description: `Vous savez ce qui agit sur vous (${leverCount} levier${leverCount > 1 ? 's' : ''}).`,
      habitIds: [],
      kind: 'reflective',
      avgPct: Math.min(100, leverCount * 10),
      reason: `${leverCount} leviers documentés.`,
    });
  }
  if (noteCount > 0) {
    suggestions.push({
      name: 'Narrateur·rice de sa vie',
      emoji: '📓',
      description: 'Vous mettez votre progression en récit.',
      habitIds: [],
      kind: 'reflective',
      avgPct: Math.min(100, noteCount),
      reason: `${noteCount} notes/écrits notés.`,
    });
  }

  if (active.length === 0) return suggestions.slice(0, 15);

  const windowDays = 14;
  const window = new Set<string>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    window.add(toDateKey(d));
  }

  const perHabit = active.map((h) => {
    const days = new Set<string>();
    for (const ci of checkIns) {
      if (ci.habitId === h.id && ci.completed && window.has(ci.date)) days.add(ci.date);
    }
    return { habit: h, days, pct: Math.round((days.size / windowDays) * 100) };
  });

  const byCategory = new Map<string, { label: string; emoji: string; items: { habit: Habit; pct: number }[] }>();
  for (const ph of perHabit) {
    const h = ph.habit;
    const cat = h.category || 'personal';
    const meta = CATEGORY_META[cat] ?? { label: cat, emoji: '🌟' };
    if (!byCategory.has(cat)) byCategory.set(cat, { ...meta, items: [] });
    byCategory.get(cat)!.items.push({ habit: h, pct: ph.pct });
  }
  for (const [, group] of byCategory) {
    const strong = group.items.filter((x) => x.pct >= 70);
    if (strong.length >= 2) {
      const avg = Math.round(strong.reduce((s, x) => s + x.pct, 0) / strong.length);
      suggestions.push({
        name: `Maître·sse ${group.label.toLowerCase()}`,
        emoji: group.emoji,
        description: `Une identité qui émerge : ${strong.map((x) => x.habit.name).join(', ')}.`,
        habitIds: strong.map((x) => x.habit.id),
        kind: 'habit',
        avgPct: avg,
        reason: `${strong.length} habitudes ${group.label.toLowerCase()} à ≥70% sur 14 jours.`,
      });
    }
  }

  // 2. Best single habit: the single strongest habit not already suggested.
  const suggestedIds = new Set(suggestions.flatMap((s) => s.habitIds));
  const best = [...perHabit]
    .filter((x) => x.pct >= 70 && !suggestedIds.has(x.habit.id))
    .sort((a, b) => b.pct - a.pct)[0];
  if (best) {
    suggestions.push({
      name: `Habitué·e de « ${best.habit.name} »`,
      emoji: '🔥',
      description: `Vous incarnez déjà ${best.habit.name} au quotidien.`,
      habitIds: [best.habit.id],
      kind: 'habit',
      avgPct: best.pct,
      reason: `${best.habit.name} tenu à ${best.pct}% sur 14 jours.`,
    });
  }

  return suggestions.slice(0, 15);
}
