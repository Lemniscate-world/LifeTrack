// src/memories.ts
// "Remember what you accomplished." A pure, local module that re-surfaces past
// wins, records and reflections on the anniversary date, plus the pieces for a
// daily system reminder so the user anchors in the present while honoring what
// they already did. Computed, never stored.

import type { CheckIn, Habit, Note, JournalEntry } from './types';
import { bestStreakAllTime } from './gamification';

export interface Recollection {
  id: string;
  emoji: string;
  kind: 'win' | 'streak' | 'journal' | 'day';
  title: string;
  body: string;
  /** YYYY-MM-DD of the recalled event. */
  date: string;
  /** Years ago this happened (0 = this year). */
  yearsAgo: number;
}

function day(key: string): string {
  return typeof key === 'string' ? key.slice(0, 10) : '';
}

/**
 * Today's recollections: what happened on this same date in prior years —
 * tagged wins, journal entries, one breaking-streak and the best-ever day.
 * Sorted by most-recent year first. Returns [] when nothing predates today.
 */
export function buildOnThisDay(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  journalEntries: JournalEntry[],
  now: Date = new Date(),
): Recollection[] {
  const out: Recollection[] = [];

  // Wins from previous years on this date (exclude today itself).
  const wins = notes
    .filter((n) => n.achievementCategory && n.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const w of wins) {
    const d = day(w.createdAt);
    if (!d) continue;
    const [y, m, dd] = d.split('-').map(Number);
    if (now.getMonth() + 1 === m && now.getDate() === dd && now.getFullYear() > y) {
      out.push({
        id: 'oty-win-' + w.id,
        emoji: '🏅',
        kind: 'win',
        title: `Il y a ${now.getFullYear() - y} an(s), une victoire`,
        body: w.content.slice(0, 140),
        date: d,
        yearsAgo: now.getFullYear() - y,
      });
    }
  }

  // Journal entries from previous years on this date.
  for (const j of journalEntries) {
    const d = day(j.createdAt);
    if (!d) continue;
    const [A, m, dd] = d.split('-').map(Number);
    if (now.getMonth() + 1 === m && now.getDate() === dd && now.getFullYear() > A) {
      out.push({
        id: 'oty-journal-' + j.id,
        emoji: '📔',
        kind: 'journal',
        title: `Il y a ${now.getFullYear() - A} an(s), tu écrivais`,
        body: j.content.slice(0, 140),
        date: d,
        yearsAgo: now.getFullYear() - A,
      });
    }
  }

  const best = bestStreakAllTime(habits, checkIns);
  if (best >= 7) {
    out.push({
      id: 'oty-streak',
      emoji: '🔥',
      kind: 'streak',
title: 'Série record',
      body: `Ton meilleur enchaînement de ${best} jours. Tu en es capable.`,
      date: '',
      yearsAgo: 0,
    });
  }

  return out.sort((a, b) => b.yearsAgo - a.yearsAgo);
}

/**
 * Deterministic body for the daily "remember" system reminder. Combines the
 * best on-this-day recollection with a present-day anchoring line. Falls back
 * to a generic grounding reminder when there are no past recollections.
 */
export function buildMemoryReminder(
  recollections: Recollection[],
  now: Date = new Date(),
): { title: string; body: string } {
  if (recollections.length > 0) {
    const r = recollections[0];
    return {
      title: `💭 Mémoire du ${now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`,
      body: `${r.emoji} ${r.body}`,
    };
  }
  return {
    title: `💭 Ancre-toi dans le présent`,
    body: 'Note aujourd\'hui un petit fait accompli. Dans un an, tu seras content de le retrouver.',
  };
}