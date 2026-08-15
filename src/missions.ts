// src/missions.ts
// Pure, tested helpers that turn a Mission into actionable progress numbers
// using the user's real check-ins. The window (fixed or transit) is resolved
// to [start, end] dates by the view; here we only compute over date strings.

import type { CheckIn, Mission } from './types';

export type MissionStatus = 'upcoming' | 'active' | 'done' | 'failed' | 'archived';

export interface MissionProgress {
  /** Check-in days (unique dates) inside the window for the mission's habits. */
  completedDays: number;
  /** Sum of counts (multi-completions) inside the window. */
  completedCount: number;
  /** Total days in the window (inclusive). */
  windowDays: number;
  /** Days elapsed so far (0 if upcoming, windowDays if past end). */
  elapsedDays: number;
  status: MissionStatus;
  /** Fraction 0-1 of the window elapsed. */
  elapsedRatio: number;
  /** Progress toward quota (0-1; 1 when reached or window done). */
  quotaRatio: number;
  /** Sessions per week implied by the quota over the window. */
  quotaPerWeek: number;
  /** Current observed sessions per week. */
  actualPerWeek: number;
  /** Days remaining until the window ends (0 when past). */
  daysLeft: number;
  /** Needed per remaining week to reach the quota. */
  neededPerWeek: number;
  /** Predicted total at current pace (per week) — null when no elapsed days. */
  projectedTotal: number | null;
  /** True when the mission has already reached its quota. */
  quotaReached: boolean;
}

export function windowStart(m: Mission): string {
  return m.window.startDate;
}

export function windowEnd(m: Mission): string {
  return m.window.endDate;
}

function dayIndex(date: string): number {
  return Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
}

/**
 * Compute the progress of a mission from real check-ins.
 * `today` is 'YYYY-MM-DD' (local day of the user).
 */
export function computeMissionProgress(m: Mission, checkIns: CheckIn[], today: string): MissionProgress {
  const start = windowStart(m);
  const end = windowEnd(m);
  const startI = dayIndex(start);
  const endI = dayIndex(end);
  const todayI = dayIndex(today);
  const habitSet = new Set(m.habitIds);

  const doneDays = new Set<string>();
  let completedCount = 0;
  for (const c of checkIns) {
    if (!c.completed) continue;
    if (!habitSet.has(c.habitId)) continue;
    const i = dayIndex(c.date);
    if (i < startI || i > endI) continue;
    doneDays.add(c.date);
    completedCount += c.count && c.count > 0 ? c.count : 1;
  }

  const windowDays = endI - startI + 1;
  const elapsedDays = Math.min(Math.max(todayI - startI + 1, 0), windowDays);
  const daysLeft = Math.max(endI - todayI, 0);
  const elapsedRatio = windowDays > 0 ? elapsedDays / windowDays : 0;

  const quota = m.quota && m.quota > 0 ? m.quota : null;
  const quotaRatio = quota ? Math.min(completedCount / quota, 1) : 0;
  const quotaReached = quota ? completedCount >= quota : false;

  // Weeks = 7-day blocks of the window.
  const windowWeeks = Math.max(windowDays / 7, 0.5);
  const quotaPerWeek = quota ? quota / windowWeeks : 0;
  const actualPerWeek = completedCount / windowWeeks;

  const remainingWeeks = Math.max((windowDays - elapsedDays) / 7, 0.25);
  const neededPerWeek = quota && !quotaReached
    ? Math.max((quota - completedCount) / remainingWeeks, 0)
    : 0;

  const projectedTotal = elapsedDays > 0 && !quotaReached
    ? Math.round(actualPerWeek * windowWeeks)
    : quotaReached ? (quota ?? completedCount) : null;

  let status: MissionStatus;
  if (m.archived) status = 'archived';
  else if (todayI < startI) status = 'upcoming';
  else if (todayI > endI) status = quotaReached ? 'done' : 'failed';
  else status = 'active';

  return {
    completedDays: doneDays.size,
    completedCount,
    windowDays,
    elapsedDays,
    status,
    elapsedRatio,
    quotaRatio,
    quotaPerWeek,
    actualPerWeek,
    daysLeft,
    neededPerWeek,
    projectedTotal,
    quotaReached,
  };
}

/** Suggestions for a mission window duration in days. */
export function suggestQuota(perWeek: number, windowDays: number): number {
  return Math.max(Math.round((perWeek * windowDays) / 7), 1);
}

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  upcoming: 'À venir',
  active: 'En cours',
  done: 'Réussi',
  failed: 'Échoué',
  archived: 'Archivé',
};
