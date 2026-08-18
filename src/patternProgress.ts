// src/patternProgress.ts
// Persistent, progressive work on the flaws/patterns the journal detects.
// Every recognized pattern gets a small "track" that advances step by step
// (identify → understand → counter → integrate → transcend) every time the user
// keeps writing about it on a NEW day. The journal therefore "continues where it
// left off" instead of asking the same starter questions forever.
//
// Pure helpers over explicit state. The state lives in the store
// (see PatternTrack in types.ts / patternTracks in AppData).

import type { NegativePattern, PatternHit } from './psychoanalysis';

/** Persisted state of a single tracked pattern (stored in AppData.patternTracks). */
export interface PatternTrack {
  patternId: string;
  /** Current station of healing, 0..MAX_STEP. */
  step: number;
  /** Total number of distinct days this pattern was re-written about. */
  seenCount: number;
  /** Local day (YYYY-MM-DD) it was last written about. */
  lastSeen: string;
  createdAt: string;
}

/** The stations of healing a single pattern. */
export const STEPS: { id: string; label: string; emoji: string }[] = [
  { id: 'identify', label: 'Identifier', emoji: '🔍' },
  { id: 'understand', label: 'Comprendre', emoji: '🔁' },
  { id: 'counter', label: 'Contre-action', emoji: '⚔️' },
  { id: 'integrate', label: 'Intégrer', emoji: '🧩' },
  { id: 'transcend', label: 'Transcender', emoji: '🎓' },
];

export const MAX_STEP = STEPS.length - 1;

import { toDateKey } from './dates';

/** Local civil day key YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return toDateKey(d);
}

/**
 * The growth question a pattern asks at each step, built from the pattern's own
 * "counter" so it is never generic. step is clamped 0..MAX_STEP.
 */
export function questionForStep(pattern: NegativePattern, step: number): string {
  const name = `${pattern.emoji} ${pattern.name}`;
  const safe = Math.max(0, Math.min(step, MAX_STEP));
  switch (safe) {
    case 1:
      return `Tu as noté « ${name} » à plusieurs reprises. Sans tout relire, qu'est-ce qui, juste avant, déclenche le plus souvent cette pensée ?`;
    case 2:
      return `Reprenons « ${name} ». Le mot d'ordre pour le combattre : ${pattern.counter}. Qu'est-ce qui, dans l'élan des trois derniers jours, rendrait ce contre-mot réellement applicable — et qu'est-ce qui va chercher à l'en empêcher ?`;
    case 3:
      return `« ${name} » semble perdre de sa fréquence. Quelle preuve concrète (jour, fait) attends-tu pour dire que tu l'as contré plutôt que subi ?`;
    case 4:
      return `Il est temps de célébrer : « ${name} » perd sa prise. En un mot, de quoi veux-tu te souvenir du passé — et quel inattendu verrais-tu surgir si tu le lâchais ?`;
    default:
      return `Tu as noté « ${name} ». À quoi s'incarne ce pattern dans ta vie d'aujourd'hui — un exemple précis, concret, sans jugement ?`;
  }
}

/**
 * Merge a set of freshly detected patterns (hits) into an existing track list,
 * advancing each track by one step when it is seen again on a brand-new day.
 * New patterns get a track at step 0. Pure: returns a fresh array.
 */
export function advanceTracks(tracks: PatternTrack[], hits: PatternHit[], now: Date = new Date()): PatternTrack[] {
  const today = dayKey(now);
  const byId = new Map<string, PatternTrack>(tracks.map((t) => [t.patternId, t]));
  const result: PatternTrack[] = [...tracks];

  for (const hit of hits) {
    const existing = byId.get(hit.pattern.id);
    if (!existing) {
      const created: PatternTrack = {
        patternId: hit.pattern.id,
        step: 0,
        seenCount: 1,
        lastSeen: today,
        createdAt: now.toISOString(),
      };
      result.push(created);
      byId.set(hit.pattern.id, created);
      continue;
    }
    if (existing.lastSeen === today) {
      // Same day: no step advance, but count the total mentions.
      existing.seenCount = existing.seenCount + 1;
      continue;
    }
    // New day: advance one step (cap at MAX).
    const next = { ...existing, step: Math.min(existing.step + 1, MAX_STEP), seenCount: existing.seenCount + 1, lastSeen: today };
    result[result.indexOf(existing)] = next;
    byId.set(hit.pattern.id, next);
  }
  return result;
}

/** Whether at least one pattern is being tracked. */
export function hasTrackablePatterns(tracks: PatternTrack[]): boolean {
  return tracks.length > 0;
}

/** Average progression across tracks, 0..1. */
export function averageProgress(tracks: PatternTrack[]): number {
  if (tracks.length === 0) return 0;
  const sum = tracks.reduce((acc, t) => acc + t.step, 0);
  return sum / tracks.length / MAX_STEP;
}

/** Bucket tracks for the evolution panel. */
export function bucketTracks(tracks: PatternTrack[]) {
  return {
    fresh: tracks.filter((t) => t.step < 2).length,
    working: tracks.filter((t) => t.step >= 2 && t.step < MAX_STEP).length,
    mastered: tracks.filter((t) => t.step === MAX_STEP).length,
    total: tracks.length,
  };
}