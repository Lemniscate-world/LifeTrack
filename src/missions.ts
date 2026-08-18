// src/missions.ts
// Pure, tested helpers that turn a Mission into actionable progress numbers
// using the user's real check-ins. The window (fixed or transit) is resolved
// to [start, end] dates by the view; here we only compute over date strings.
//
// v0.6.2: the sky-driven mission suggestion engine — upcoming transits and
// planetary aspects are matched to the user's weak life domains and existing
// missions, and turned into ready-to-create Mission drafts (auto or 1-click).

import type { CheckIn, Mission, MissionTransitWindow } from './types';
import { toDateKey } from './dates';
import {
  TRANSIT_BODIES, getTransitBody, upcomingTransits, upcomingAspects,
  ASC_ASPECT_PAIRS, ASPECT_DEFS, ASPECT_PAIRS,
  type TransitBodyId, type AspectPoint,
} from './astrology';

/** Display info for either a planet or the natal Ascendant point. */
function aspectPointInfo(point: AspectPoint): { emoji: string; label: string } {
  return point === 'asc'
    ? { emoji: '⬆️', label: 'Ascendant' }
    : getTransitBody(point);
}

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

// ============================================================================
// Sky-driven mission suggestions (transits + aspects × weak domains)
// ============================================================================

/** Life domains each body is classically linked to (matching preferences). */
export const BODY_DOMAINS: Record<string, string[]> = {
  sun: ['energy'], moon: ['mood'], mercury: ['cognitive'], venus: ['social'],
  mars: ['training', 'energy'], jupiter: ['mood', 'social'], saturn: ['stress', 'focus'],
  uranus: ['focus', 'cognitive'], neptune: ['mood'], pluto: ['stress'], node: ['training'],
};

const DOMAIN_CATEGORIES: Record<string, string[]> = {
  sleep: ['health'], training: ['health'], nutrition: ['health'], energy: ['health'],
  focus: ['work', 'learning'], cognitive: ['work', 'learning'],
  mood: ['personal'], social: ['personal'], stress: ['personal'],
};

const DOMAIN_LABELS: Record<string, string> = {
  sleep: 'sommeil', training: 'entraînement', nutrition: 'nutrition', energy: 'énergie',
  focus: 'focus', cognitive: 'cognitif', mood: 'humeur', social: 'social', stress: 'stress',
};

export interface AutoMissionSuggestion {
  /** Stable dedupe key, e.g. "transit:mars:0" or "aspect:jupiter:pluto:trine". */
  key: string;
  name: string;
  objective?: string;
  window: Mission['window'];
  habitIds: string[];
  quota?: number;
  /** 'transit' (sign ingress) or 'aspect' (planetary aspect). */
  source: 'transit' | 'aspect';
  /** Human rationale shown on the card. */
  rationale: string;
  /** True when the engine creates it automatically (weak domain + transit). */
  autoCreate: boolean;
}

/** Weekly completion pace of the given habits over the last 28 days. */
function weeklyPace(habitIds: string[], checkIns: CheckIn[], today: string): number {
  if (habitIds.length === 0) return 0;
  const set = new Set(habitIds);
  const startI = dayIndex(toDateKey(new Date(Date.now() - 27 * 86400000)));
  const endI = dayIndex(today);
  let total = 0;
  for (const c of checkIns) {
    if (!c.completed || !set.has(c.habitId)) continue;
    const i = dayIndex(c.date);
    if (i >= startI && i <= endI) total += c.count && c.count > 0 ? c.count : 1;
  }
  return total / 4;
}

/** Pick the habits best matching a domain (by category), else any active one. */
function pickHabits(domain: string, habits: { id: string; category?: string; archived?: boolean }[], limit = 3): string[] {
  const cats = DOMAIN_CATEGORIES[domain] ?? [];
  const active = habits.filter((h) => !h.archived);
  const byCat = active.filter((h) => cats.includes(h.category ?? ''));
  const pool = byCat.length > 0 ? byCat : active;
  return pool.slice(0, limit).map((h) => h.id);
}

/** How many days of mission window an aspect deserves (exact date ± pad). */
const ASPECT_WINDOW_PAD_DAYS = 5;

export interface SkySuggestionInput {
  habits: { id: string; category?: string; archived?: boolean }[];
  checkIns: CheckIn[];
  /** Weak life domains detected by the preference engine ("" = none). */
  weakDomains: string[];
  existingMissions: Mission[];
  now?: Date;
  /** Calendar horizon for transits (days). */
  transitHorizonDays?: number;
  /** Calendar horizon for aspects (days). */
  aspectHorizonDays?: number;
  /** Natal Ascendant ecliptic longitude (adds 'asc' aspect pairs when given). */
  ascendantLon?: number;
  /** Max number of 1-click suggestions returned. */
  maxSuggestions?: number;
}

/**
 * Turn the upcoming sky into mission drafts:
 *  - transit windows (planet entering a sign, Moon excluded — too short),
 *  - exact planetary aspects (Jupiter △ Pluton, Mars □ Saturne, …) resolved
 *    to a fixed window around the exact date.
 * Weak-domain matches are flagged `autoCreate` (the zero-touch engine creates
 * them); everything else is a 1-click suggestion. Idempotent against the
 * missions already present.
 */
export function suggestMissionsFromSky(input: SkySuggestionInput): AutoMissionSuggestion[] {
  const now = input.now ?? new Date();
  const today = toDateKey(now);
  const suggestions: AutoMissionSuggestion[] = [];
  const weak = new Set(input.weakDomains);

  // Dedupe against existing missions: transit missions by (body, sign);
  // fixed missions by window overlap (± pad around the aspect window).
  const seenTransit = new Set(
    input.existingMissions
      .filter((m): m is Mission & { window: MissionTransitWindow } => m.window.kind === 'transit')
      .map((m) => `transit:${m.window.body}:${m.window.signIndex}`),
  );
  const fixed = input.existingMissions.filter((m) => m.window.kind === 'fixed');

  const bodies = TRANSIT_BODIES
    .filter((b) => b.id !== 'moon')
    .map((b) => b.id as TransitBodyId);
  const transits = upcomingTransits(bodies, input.transitHorizonDays ?? 90, now);

  for (const item of transits) {
    const key = `transit:${item.bodyId}:${item.signIndex}`;
    if (seenTransit.has(key)) continue;
    const domains = BODY_DOMAINS[item.bodyId] ?? [];
    const domain = domains.find((d) => weak.has(d)) ?? domains[0];
    const days = Math.round((item.window.end.getTime() - item.window.start.getTime()) / 86400000) + 1;
    const habitIds = pickHabits(domain, input.habits);
    const bodyInfo = getTransitBody(item.bodyId);
    const name = `${bodyInfo.emoji} ${bodyInfo.label} en ${item.sign.emoji} ${item.sign.name}`;
    const weakHit = domains.some((d) => weak.has(d));
    suggestions.push({
      key,
      name,
      objective: weakHit
        ? `Domaine faible détecté : ${DOMAIN_LABELS[domain] ?? domain}. Profite du passage de ${bodyInfo.label} en ${item.sign.name}.`
        : `Objectif lié au ${DOMAIN_LABELS[domain] ?? domain} pendant le transit de ${bodyInfo.label} en ${item.sign.name}.`,
      window: {
        kind: 'transit',
        body: item.bodyId,
        signIndex: item.signIndex,
        startDate: toDateKey(item.window.start),
        endDate: toDateKey(item.window.end),
      },
      habitIds,
      quota: habitIds.length > 0 ? suggestQuota(weeklyPace(habitIds, input.checkIns, today), days) : undefined,
      source: 'transit',
      rationale: `${bodyInfo.label} entre en ${item.sign.name} — ${days} jours`,
      autoCreate: weakHit,
    });
  }

  const ascLon = input.ascendantLon;
  const pairList: [AspectPoint, AspectPoint][] = ascLon !== undefined
    ? [...ASPECT_PAIRS, ...ASC_ASPECT_PAIRS]
    : ASPECT_PAIRS;
  const aspects = upcomingAspects(pairList, input.aspectHorizonDays ?? 150, now, ascLon);
  for (const ev of aspects) {
    const key = `aspect:${ev.bodyA}:${ev.bodyB}:${ev.kind}`;
    const start = new Date(ev.exactAt.getTime() - ASPECT_WINDOW_PAD_DAYS * 86400000);
    const end = new Date(ev.exactAt.getTime() + ASPECT_WINDOW_PAD_DAYS * 86400000);
    const startKey = toDateKey(start);
    const endKey = toDateKey(end);
    const overlaps = fixed.some((m) => dayIndex(m.window.startDate) <= dayIndex(endKey) && dayIndex(m.window.endDate) >= dayIndex(startKey));
    if (overlaps) continue;
    const domains = [...new Set([
      ...(BODY_DOMAINS[ev.bodyA as TransitBodyId] ?? []),
      ...(BODY_DOMAINS[ev.bodyB as TransitBodyId] ?? []),
    ])];
    const domain = domains.find((d) => weak.has(d)) ?? domains[0];
    const def = ASPECT_DEFS[ev.kind];
    const habitIds = pickHabits(domain, input.habits);
    const a = aspectPointInfo(ev.bodyA);
    const b = aspectPointInfo(ev.bodyB);
    const name = `${a.emoji} ${a.label} ${def.emoji} ${b.emoji} ${b.label}`;
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    suggestions.push({
      key,
      name,
      objective: def.tone === 'tension'
        ? `Période de tension (${def.label}) sur le ${DOMAIN_LABELS[domain] ?? domain} : stabilité et récupération.`
        : `Fenêtre favorable (${def.label}) sur le ${DOMAIN_LABELS[domain] ?? domain} : amplifie les efforts.`,
      window: { kind: 'fixed', startDate: startKey, endDate: endKey },
      habitIds,
      quota: habitIds.length > 0 ? suggestQuota(weeklyPace(habitIds, input.checkIns, today), days) : undefined,
      source: 'aspect',
      rationale: `${a.label} ${def.label} ${b.label} — exact le ${toDateKey(ev.exactAt)}`,
      autoCreate: false, // aspects are 1-click; transits on weak domains auto-create
    });
  }

  const max = input.maxSuggestions ?? 10;
  const ranked = suggestions.sort((x, y) => {
    if (x.autoCreate !== y.autoCreate) return x.autoCreate ? -1 : 1;
    return x.window.startDate.localeCompare(y.window.startDate);
  });
  return ranked.slice(0, max);
}
