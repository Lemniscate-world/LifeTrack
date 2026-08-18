// src/journalDigest.ts
// Periodic journal synthesis. Turns the raw history of journal entries into a
// compact digest: volume, rhythm, persona usage, recurring words and streaks.
// Deterministic, local, testable. Feeds both the on-device summary panel and
// the AI synthesis command (journal_summary).

import type { JournalEntry, JournalPersonality } from './types';
import { toDateKey } from './dates';

export type DigestPeriod = 'week' | 'month';

export interface JournalDigest {
  period: DigestPeriod;
  days: number;
  windowStart: string;      // YYYY-MM-DD (local), inclusive
  windowEnd: string;        // YYYY-MM-DD (local), inclusive
  totalEntries: number;     // within the window
  activeDays: number;       // distinct days with ≥1 entry
  entriesPerDay: number;    // total / active days (0 when none)
  streak: number;           // current consecutive days with an entry
  bestStreak: number;       // longest run within the window
  lastEntryAt?: string;     // ISO of the newest entry
  oldestEntryAt?: string;   // ISO of the oldest entry in the window
  byPersona: { personality: JournalPersonality; count: number }[];
  topWords: { word: string; count: number }[];
  longFormCount: number;    // entries longer than 40 chars
  daysWithTwoPlus: number;  // days with 2+ entries
}

const STOPWORDS = new Set([
  'the', 'and', 'que', 'qui', 'est', 'une', 'dans', 'pour', 'avec', 'pas', 'plus',
  'mais', 'cette', 'vous', 'nous', 'être', 'avoir', 'ceci', 'cela', 'tout', 'dans',
  'sur', 'comme', 'quand', 'quoi', 'comment', 'pourquoi', 'je', 'tu', 'il', 'elle',
  'on', 'nous', 'vous', 'ils', 'elles', 'me', 'moi', 'te', 'toi', 'se', 'son',
  'sa', 'ses', 'mon', 'ma', 'mes', 'notre', 'vos', 'leurs', 'à', 'au', 'aux', 'de',
  'des', 'du', 'en', 'et', 'ou', 'was', 'the', 'a', 'an', 'my', 'your', 'our',
  'then', 'than', 'them', 'they', 'there', 'here', 'this', 'that', 'these',
]);

function dayKey(iso: string): string {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

function parseDay(k: string): Date {
  return new Date(k + 'T00:00:00');
}

/** Longest run of consecutive days present in the given day set. */
export function longestRun(days: string[]): number {
  if (days.length === 0) return 0;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (parseDay(sorted[i]).getTime() - parseDay(sorted[i - 1]).getTime()) / 86400000;
    if (gap === 1) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

/** Current run: consecutive days ending today (or the last present day). */
export function currentRun(days: string[], today: Date): number {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 0) return 0;
  let cursor = parseDay(toDateKey(today));
  const present = new Set(sorted);
  let run = 0;
  while (present.has(toDateKey(cursor))) {
    run++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return run;
}

function wordFreq(text: string, limit: number): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const raw of words) {
    const w = raw.trim();
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/**
 * Build a digest over the last `period` days (inclusive of today).
 * Entries are filtered by their local calendar day inside the window.
 */
export function buildJournalDigest(
  entries: JournalEntry[],
  now: Date = new Date(),
  period: DigestPeriod = 'week',
): JournalDigest {
  const days = period === 'month' ? 30 : 7;
  const windowStart = toDateKey(new Date(now.getTime() - (days - 1) * 86400000));
  const windowEnd = toDateKey(now);

  const inWindow = entries
    .filter((e) => e && typeof e.createdAt === 'string')
    .map((e) => ({ entry: e, day: dayKey(e.createdAt) }))
    .filter((x) => x.day >= windowStart && x.day <= windowEnd)
    .sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt));

  const allDays = [...new Set(inWindow.map((x) => x.day))].sort();
  const byDay = new Map<string, number>();
  for (const x of inWindow) byDay.set(x.day, (byDay.get(x.day) ?? 0) + 1);

  const personaCounts = new Map<JournalPersonality, number>();
  for (const x of inWindow) {
    personaCounts.set(x.entry.personality, (personaCounts.get(x.entry.personality) ?? 0) + 1);
  }

  const joinedText = inWindow.map((x) => x.entry.content).join(' ');

  return {
    period,
    days,
    windowStart,
    windowEnd,
    totalEntries: inWindow.length,
    activeDays: allDays.length,
    entriesPerDay: allDays.length > 0 ? Math.round((inWindow.length / allDays.length) * 10) / 10 : 0,
    streak: currentRun(allDays, now),
    bestStreak: longestRun(allDays),
    lastEntryAt: inWindow[inWindow.length - 1]?.entry.createdAt,
    oldestEntryAt: inWindow[0]?.entry.createdAt,
    byPersona: [...personaCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([personality, count]) => ({ personality, count })),
    topWords: wordFreq(joinedText, 8),
    longFormCount: inWindow.filter((x) => x.entry.content.trim().length > 40).length,
    daysWithTwoPlus: [...byDay.values()].filter((c) => c >= 2).length,
  };
}

const PERSONA_LABELS: Record<JournalPersonality, string> = {
  coach: 'Coach',
  sage: 'Sage',
  psychologist: 'Psychologue',
  strategist: 'Stratège',
  'robert-greene': 'R. Greene',
  huberman: 'Huberman',
};

/** Human-readable one-line summary of the digest. */
export function digestSummary(d: JournalDigest): string {
  const personaLine =
    d.byPersona.length > 0
      ? ` · ${d.byPersona.map((p) => `${PERSONA_LABELS[p.personality] ?? p.personality} ${p.count}`).join(', ')}`
      : '';
  return (
    `${d.totalEntries} entrée${d.totalEntries > 1 ? 's' : ''} sur ${d.activeDays} jour${d.activeDays > 1 ? 's' : ''} ` +
    `(${d.entriesPerDay}/jour) · série ${d.streak}j (max ${d.bestStreak}j)` +
    personaLine
  );
}
