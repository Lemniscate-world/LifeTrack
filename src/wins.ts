// src/wins.ts
// Pure, local "Wins feed" — the anti-forgetting panel. It derives, from the
// user's real data only, the wins/records they most recently accomplished and
// the medals they are closest to, so they don't miss their present progress.
// Everything is computed, never stored. Includes a small French "phrase of the
// day" generator.

import type { CheckIn, Habit, Note, UrgeEntry } from './types';
import { bestStreakAllTime, type Medal } from './gamification';
import { scoredDays } from './evolution';
import { toDateKey } from './dates';

/** Day-of-the-year (1-366) for the seed phrase rotation. */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.round((d.getTime() - start.getTime()) / 86400000);
}

// --- Recent wins (achievements + records) ---

export interface WinItem {
  id: string;
  kind: 'achievement' | 'record' | 'urge';
  emoji: string;
  title: string;
  subtitle: string;
  date: string | null;
}

/**
 * Build the recent-wins feed: the latest tagged achievements, a freshly broken
 * streak record, the best-ever single day, and recent urge-surfing wins.
 * Returns newest-first, capped at `limit` (default 6).
 */
export function buildWinsFeed(
  habits: Habit[],
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  limit: number = 6,
  now: Date = new Date(),
): WinItem[] {
  const today = toDateKey(now);
  const items: WinItem[] = [];

  // 1. Most recent tagged achievements.
  const achievements = notes
    .filter((n) => n.achievementCategory)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const n of achievements.slice(0, 3)) {
    const isToday = n.createdAt.slice(0, 10) === today;
    items.push({
      id: 'ach-' + n.id,
      kind: 'achievement',
      emoji: '🏅',
      title: isToday ? 'Victoire aujourd’hui' : 'Nouvelle victoire',
      subtitle: n.content,
      date: n.createdAt.slice(0, 10),
    });
  }

  // 2. Freshly broken best-streak record (milestones at 7 / 14 / 30 / ... / 100).
  const best = bestStreakAllTime(habits, checkIns);
  if (best > 0) {
    for (const m of [1, 3, 7, 14, 30, 60, 100, 365]) {
      if (best === m) {
        items.push({
          id: 'streak-' + m,
          kind: 'record',
          emoji: '🔥',
          title: `Série record de ${m} jour${m > 1 ? 's' : ''}`,
          subtitle: 'Votre meilleure série de tous les temps.',
          date: null,
        });
      }
    }
    if (best > 0 && ![1, 3, 7, 14, 30, 60, 100, 365].includes(best)) {
      items.push({
        id: 'streak-' + best,
        kind: 'record',
        emoji: '🔥',
        title: `Série record de ${best} jours`,
        subtitle: 'Vous n’avez jamais fait mieux.',
        date: null,
      });
    }
  }

  // 3. Best-ever single day (from the evolution series).
  const series = scoredDays(habits, checkIns, notes, urges, []);
  if (series.length > 0) {
    let bestDay = series[0];
    for (const s of series) if (s.score > bestDay.score) bestDay = s;
    if (bestDay.score > 0) {
      items.push({
        id: 'best-day-' + bestDay.date,
        kind: 'record',
        emoji: '🌟',
        title: `Record personnel : ${bestDay.score} pts`,
        subtitle: `Votre meilleure journée de croissance (${bestDay.date}).`,
        date: bestDay.date,
      });
    }
  }

  // 4. Recent urge-surfing win (last surfed urge today or the last one).
  const surfed = urges
    .filter((u) => u.outcome === 'surfed')
    .sort((a, b) => b.startTime.localeCompare(a.startTime));
  if (surfed.length > 0) {
    const last = surfed[0];
    items.push({
      id: 'urge-' + last.id,
      kind: 'urge',
      emoji: '🌊',
      title: 'Urge surfée',
      subtitle: 'Vous avez traversé une envie sans y céder.',
      date: last.startTime.slice(0, 10),
    });
  }

  return items.slice(0, limit);
}

// --- Near-earned medals ("up next") ---

export interface NextMedal {
  medal: Medal;
}

/**
 * The medals the user is closest to earning (progress < 100, sorted by progress
 * desc). Returns at most `limit` (default 3). Skip medals with unknown progress.
 */
export function nextMedals(medals: Medal[], limit = 3): NextMedal[] {
  return medals
    .filter((m) => !m.earned && m.progress !== undefined && m.progress >= 30)
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    .slice(0, limit)
    .map((medal) => ({ medal }));
}

// --- French phrase of the day ------------------------------------------

/**
 * Deterministic French "phrase of the day", rotated by the day-of-year so it
 * feels fresh but is stable within a day. No AI, no network.
 */
export function phraseOfDay(d: Date = new Date()): { emoji: string; text: string } {
  const pool: { emoji: string; text: string }[] = [
    { emoji: '🌱', text: 'Chaque petit geste d’aujourd’hui est une graine pour demain.' },
    { emoji: '🔥', text: 'La régularité bat la perfection, encore et encore.' },
    { emoji: '🌊', text: 'Vous n’avez pas à tout contrôler : juste à rester dans la vague.' },
    { emoji: '🪨', text: 'Ce qui est fait est fait. Ce qui reste à faire peut attendre. Continuez.' },
    { emoji: '☀️', text: 'Un jour à la fois, une habitude à la fois.' },
    { emoji: '🧭', text: 'Vous ne cherchez pas à être parfait, vous cherchez à être cohérent.' },
    { emoji: '💧', text: 'Les gouttes accumulées deviennent un océan.' },
  ];
  return pool[dayOfYear(d) % pool.length];
}