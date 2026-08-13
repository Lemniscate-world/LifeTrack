// src/recRotation.ts
// Stops the "same recommendations, again and again" problem.
//
// generateInsights() is deterministic, so on unchanged data it returns the same
// list in the same order day after day. This module:
//   1. drops any recommendation the user "set aside" (persisted in the store),
//   2. rotates the survivors by day-of-year so the ordering (and therefore the
//      ones you see at top) changes daily,
//   3. caps the burst so Insights stays scannable instead of an endless wall.
//
// Pure module: fully unit-testable.

import type { Recommendation } from './recommendations';

/** Stable key identifying one recommendation (used for dismissal). */
export function recKey(rec: Recommendation): string {
  return `${rec.kind}|${(rec.habitIds ?? []).join(',')}|${rec.title}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Filter out dismissed recs, rotate the survivors deterministically by day and
 * return at most `take` of them — so a user who checks Insights daily sees a
 * fresh top of the list instead of the identical headline every time.
 */
export function rotateRecommendations(
  recs: Recommendation[],
  dismissed: string[],
  now: Date = new Date(),
  take = 8,
): Recommendation[] {
  const remaining = recs.filter((r) => !dismissed.includes(recKey(r)));
  if (remaining.length === 0) return [];

  const day = Math.floor(now.getTime() / DAY_MS);
  const start = day % remaining.length;
  const rotated = [...remaining.slice(start), ...remaining.slice(0, start)];
  return rotated.slice(0, Math.max(1, Math.min(take, remaining.length)));
}
