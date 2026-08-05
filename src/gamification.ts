// src/gamification.ts
// Pure, local gamification engine: XP, levels, ranks, medals, week-over-week
// comparison and "persona to become" progress. No store access — every function
// derives from plain data so it can be unit-tested in isolation.
//
// XP is NEVER stored: it is re-derived from the user's real data (check-ins,
// notes, challenges) so a reload, import or rollback can never lose progress
// and no double-bookkeeping is possible.

import type { Challenge, CheckIn, Habit, Note, Persona } from './types';

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

function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function completedDaySet(habitId: string, checkIns: CheckIn[]): number[] {
  const days = new Set<number>();
  for (const ci of checkIns) {
    if (ci.habitId !== habitId || !ci.completed) continue;
    days.add(parseLocalDate(ci.date).getTime());
  }
  return [...days].sort((a, b) => a - b);
}

/** Count of full 7-day consecutive runs for a habit (historical milestones). */
export function streakMilestonesForHabit(habitId: string, checkIns: CheckIn[]): number {
  const sorted = completedDaySet(habitId, checkIns);
  let milestones = 0;
  let run = 0;
  let prev = -Infinity;
  for (const t of sorted) {
    run = t - prev === 86400000 ? run + 1 : 1;
    if (run % 7 === 0) milestones++;
    prev = t;
  }
  return milestones;
}

/** Longest consecutive completed-day run across all habits (all-time record). */
export function bestStreakAllTime(habits: Habit[], checkIns: CheckIn[]): number {
  let best = 0;
  for (const h of habits) {
    const sorted = completedDaySet(h.id, checkIns);
    let run = 0;
    let prev = -Infinity;
    for (const t of sorted) {
      run = t - prev === 86400000 ? run + 1 : 1;
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
}

/** True if every active habit was completed on a single day. */
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
    window.add(localKey(d));
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

export function computeMedals(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  challenges: Challenge[],
  xp: number,
  level: number,
): Medal[] {
  const totalCheckIns = checkIns.filter((c) => c.completed).length;
  const achievementNotes = notes.filter((n) => n.achievementCategory).length;
  const completedChallenges = challenges.filter((c) => c.status === 'completed').length;

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

  const stats = {
    totalCheckIns,
    achievementNotes,
    completedChallenges,
    bestStreak: bestStreakAllTime(habits, checkIns),
    perfectDay: hasPerfectDay(habits, checkIns),
    habitMasters: habitMastersCount(habits, checkIns),
    xp,
    level,
  };

  const defs: { id: string; name: string; emoji: string; description: string; earned: boolean; earnedAt?: string }[] = [
    { id: 'first-steps', name: 'First Steps', emoji: '🚀', description: 'Complete your first check-in', earned: stats.totalCheckIns >= 1, earnedAt: earliestCheckIn },
    { id: 'first-win', name: 'First Win', emoji: '🏅', description: 'Tag your first achievement', earned: stats.achievementNotes >= 1, earnedAt: earliestAchievement },
    { id: 'seven-day', name: 'Week on Fire', emoji: '🔥', description: 'A 7-day streak on any habit', earned: stats.bestStreak >= 7 },
    { id: 'thirty-day', name: 'Month of Steel', emoji: '🧨', description: 'A 30-day streak on any habit', earned: stats.bestStreak >= 30 },
    { id: 'xp-500', name: '500 XP', emoji: '⚡', description: 'Earn 500 lifetime XP', earned: stats.xp >= 500 },
    { id: 'xp-2000', name: '2000 XP', emoji: '🌋', description: 'Earn 2000 lifetime XP', earned: stats.xp >= 2000 },
    { id: 'challenge-master', name: 'Challenge Met', emoji: '🎯', description: 'Complete a challenge', earned: stats.completedChallenges >= 1 },
    { id: 'perfect-day', name: 'Perfect Day', emoji: '💯', description: 'Every active habit done in a single day', earned: stats.perfectDay },
    { id: 'habit-master', name: 'Golden Rhythm', emoji: '🏆', description: '5+ habits at 70%+ over 30 days', earned: stats.habitMasters >= 5 },
    { id: 'level-5', name: 'Explorer', emoji: '🧭', description: 'Reach level 5', earned: stats.level >= 5 },
    { id: 'level-15', name: 'Architect', emoji: '🏛️', description: 'Reach level 15', earned: stats.level >= 15 },
    { id: 'level-40', name: 'Master of Self', emoji: '👑', description: 'Reach level 40', earned: stats.level >= 40 },
  ];

  return defs.map((d) => ({ ...d }));
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
  const today = localKey(now);
  const fromCur = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const toPrev = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
  const fromPrev = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13));

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
    window.add(localKey(d));
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
