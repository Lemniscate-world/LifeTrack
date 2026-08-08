// src/journalPrompts.ts
// "I have nothing to write" is the exact moment a journal should help the most.
// This module turns the user's OWN data into a small set of penetrating,
// healing-oriented prompts — anchored on wins, streaks, low moods, urges surfed,
// habit slips and "on this day" memories — plus a couple of open present-day
// openers. Everything is local, deterministic (seeded by day) and never stored.

import type { CheckIn, Habit, Note, UrgeEntry, JournalEntry } from './types';

export interface JournalPrompt {
  id: string;
  emoji: string;
  text: string;
  context?: string;
  /** Optional source psycho pattern (for progressive work threads). */
  patternId?: string;
  /** Optional track step when originating from a pattern-track question. */
  patternStep?: number;
}

export interface PromptSet {
  prompts: JournalPrompt[];
  summary: string;
}

interface DataSlice {
  habits?: Habit[];
  checkIns?: CheckIn[];
  notes?: Note[];
  moods?: Record<string, string>;
  urges?: UrgeEntry[];
  journalEntries?: JournalEntry[];
}

function day(key: string): string {
  return typeof key === 'string' ? key.slice(0, 10) : '';
}

function dayDelta(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round(Math.abs(db - da) / 86400000);
}

/** Current streak of completed days for a habit's completion dates. */
function currentStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort();
  let streak = 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (dayDelta(sorted[i], sorted[i + 1]) === 1) streak++;
    else break;
  }
  return streak;
}

/** A few always-available openers anchored in the present moment. */
const OPENERS: JournalPrompt[] = [
  { id: 'op-1', emoji: '🌱', text: 'Qu\'est-ce que je ressens en ce moment précis, au-delà de ce que je m\'autorise à dire vite fait ?' },
  { id: 'op-2', emoji: '🧭', text: 'Si rien ne m\'empêchait de faire la prochaine petite étape, que ferais-je — et qu\'est-ce qui me retient réellement ?' },
  { id: 'op-3', emoji: '💬', text: 'Qu\'est-ce que j\'aurais voulu entendre ces derniers jours et que je n\'ai dit à personne ?' },
  { id: 'op-4', emoji: '🪨', text: 'Qu\'est-ce qui, aujourd\'hui, est déjà presque assez — et que j\'ai tendance à ne pas être capable de nommer ?' },
  { id: 'op-5', emoji: '🔦', text: 'Si je regardais honnêtement l\'émotion la plus présente là-maintenant, quel nom précis lui donnerais-je ?' },
  { id: 'op-6', emoji: '🌒', text: 'Qu\'est-ce qu\'il y a de bon qui se passe sans que je le dise, et pourquoi est-ce mal d\'y croire ?' },
];

/**
 * Builds a deterministic set of journal prompts from the user's own data.
 * NEVER returns an empty array: it always appends open-ended openers and
 * rotates them by the day-of-year so the sequence feels fresh but stable.
 */
export function buildJournalPrompts(data: DataSlice, now: Date = new Date(), seedOffset: number = 0): PromptSet {
  const habits = data.habits ?? [];
  const checkIns = data.checkIns ?? [];
  const notes = data.notes ?? [];
  const moods = data.moods ?? {};
  const urges = data.urges ?? [];
  const journalEntries = data.journalEntries ?? [];

  const today = day(now.toISOString());
  const seed = dayOfYear(now) + seedOffset;

  const from: JournalPrompt[] = [];

  // 1. Recent tagged achievement — anchor the effort that got you here.
  const wins = notes
    .filter((n) => n.achievementCategory && n.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recentWin = wins[0];
  if (recentWin) {
    from.push({
      id: 'win-effort',
      emoji: '🏅',
      text: `Quand tu as écrit « ${recentWin.content.slice(0, 80)} », qu'est-ce que tu as dû dépasser pour y arriver — et qu'est-ce que cette étape dit de toi que tu n'habites pas encore assez ?`,
      context: `Une victoire (${recentWin.createdAt.slice(0, 10)})`,
    });
  }

  // 2. A habit near a streak milestone — probe what could "just before" break it.
  const active = habits.filter((h) => !h.archived);
  const withStreak = active
    .map((h) => ({
      habit: h,
      dates: checkIns.filter((c) => c.habitId === h.id && c.completed).map((c) => c.date).sort(),
    }))
    .filter((x) => x.dates.length > 0);
  const nearMilestone = withStreak
    .map((x) => ({ ...x, streak: currentStreak(x.dates) }))
    .find((x) => x.streak >= 1 && [3, 7, 14, 30, 60].some((m) => x.streak <= m && x.streak >= Math.max(1, m - 2)));
  if (nearMilestone) {
    const next = [3, 7, 14, 30, 60].find((m) => nearMilestone.streak <= m) ?? 7;
    from.push({
      id: 'streak-probe',
      emoji: '🔥',
      text: `Tu es sur ${nearMilestone.streak} jour(s) sur « ${nearMilestone.habit.name} » — à ${next - nearMilestone.streak} du jalon ${next}. Qu'est-ce qui, en toi, est prêt à laisser retomber ce rythme juste avant de l'atteindre ? Et quelle petite chose peux-tu prévoir pour passer le cap ?`,
      context: `Série « ${nearMilestone.habit.name} » : ${nearMilestone.streak}j`,
    });
  }

  // 3. A recently low mood — probe the underside and give it an anchor.
  const lowDays = Object.entries(moods)
    .filter(([, v]) => ['bas', 'bad', 'low'].includes(String(v).toLowerCase()))
    .sort((a, b) => b[0].localeCompare(a[0]));
  if (lowDays.length > 0) {
    const [d] = lowDays[0];
    from.push({
      id: 'low-probe',
      emoji: '🌧️',
      text: `Autour du ${d}, tu as noté une humeur basse. Sans tout relire, qu'est-ce qui, à ce moment-là, pèse encore au fond de l'être ? Et si elle revenait, quel geste-ancrage lui répondrais-tu ?`,
      context: `Humeur basse le ${d}`,
    });
  }

  // 4. An urge surfed — the skill you're building, made teachable.
  const surfed = urges.filter((u) => u.outcome === 'surfed').sort((a, b) => b.startTime.localeCompare(a.startTime));
  if (surfed.length > 0) {
    from.push({
      id: 'urge-surf',
      emoji: '🌊',
      text: `Tu as traversé une envie récente sans y céder. Qu'est-ce qui, à ce moment-là, a rendu la résistance possible — et qu'est-ce que cette force t'apprend sur tes autres défis ?`,
      context: 'Une tentation « surfée »',
    });
  }

  // 5. A habit that may have silently slid — honest re-check.
  const sliding = withStreak
    .map((x) => ({ ...x, gap: x.dates.length >= 4 ? dayDelta(x.dates[x.dates.length - 4], x.dates[x.dates.length - 1]) : 0 }))
    .find((x) => x.gap > 10 && x.dates.length >= 6);
  if (sliding) {
    from.push({
      id: 'slide-check',
      emoji: '🪜',
      text: `« ${sliding.habit.name} » semble s'être espacé(e). Est-ce un abandon voulu, un raté passager, ou un vrai renoncement ? — et quelle est l'honnête réponse ?`,
      context: `Rythme affaibli : ${sliding.habit.name}`,
    });
  }

  // 6. On-this-day memory — reconnect to past accomplishments.
  const onThisDayJournal = journalEntries.filter((j) => day(j.createdAt).slice(5) === today.slice(5)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (onThisDayJournal.length > 0) {
    const past = onThisDayJournal[0];
    from.push({
      id: 'onthisday-journal',
      emoji: '📅',
      text: `Un an de cela (à cette date) tu écrivais : « ${past.content.slice(0, 90)} ». Que dirais-tu à cette version de toi ? Qu'a-t-elle accompli que tu n'avais pas encore vu alors ?`,
      context: 'ton journal un an plus tôt',
    });
  }

  // Always: open-ended, present-focused openers so we never run dry.
  const pick = OPENERS.sort((a, b) => (hashOf(a.id) + seed) % OPENERS.length - (hashOf(b.id) + seed) % OPENERS.length);
  from.push(...pick.slice(0, 3));

  // De-duplicate it-first occurrence, cap readable count.
  const seen = new Set<string>();
  const uniq = from.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return {
    prompts: uniq.slice(0, 6),
    summary: 'Ces questions partent de tes propres données (wins, séries, humeurs, urges, passé — pas du générique).',
  };
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.round((d.getTime() - start.getTime()) / 86400000);
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}