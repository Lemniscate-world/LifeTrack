// src/reflection.ts
// The self-improvement loop: LifeTrack looks at the user's OWN data and poses
// penetrating questions it can act on. Answers are persisted as data
// (ReflectionEntry) and feed back into analysis — so LifeTrack genuinely
// reasons and improves instead of just re-displaying numbers.
//
// Pure module: (data) → open questions. No UI, no store.

import type {
  Habit,
  CheckIn,
  Note,
  UrgeEntry,
  Challenge,
  JournalEntry,
  PatternTrack,
  ReflectionKind,
  DetectedReflection,
  ReflectionEntry,
} from './types';
import { daysAgoKey } from './dates';

export type { ReflectionKind, DetectedReflection, ReflectionEntry } from './types';

export const REFLECTION_EMOJI: Record<ReflectionKind, string> = {
  'stale-win': '🏆',
  'recurring-leak': '🕳️',
  'neglect': '🪟',
  'pattern-progress': '🧬',
  'repetition': '🔁',
  'recovery': '💊',
  'momentum': '🚀',
  'confidence': '📈',
};

export const reflectionEmoji = (kind: ReflectionKind): string =>
  REFLECTION_EMOJI[kind] ?? '💡';

/** The data LifeTrack reasons over (a slice of AppData). */
export interface DataSlice {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
  urges: UrgeEntry[];
  challenges: Challenge[];
  journalEntries: JournalEntry[];
  /** Progressive pattern tracks (see patternProgress.ts) — optional. */
  tracks?: PatternTrack[];
}

const pct = (n: number, total: number): string =>
  `${Math.round((n / total) * 100)}%`;

/**
 * Look at the real data and produce high-value open questions. Deterministic
 * (no AI call) so it works offline and is fully testable; the answers are
 * what teach LifeTrack over time.
 *
 * Every observation is grounded in explicit windows and counts, and carries a
 * stable dedupeKey so the same question isn't re-asked day after day.
 */
export function detectReflections(data: DataSlice, now: Date = new Date()): DetectedReflection[] {
  const out: DetectedReflection[] = [];
  const active = data.habits.filter((h) => !h.archived);
  const byHabit = new Map<string, { completed: string[]; any: string[] }>();
  for (const c of data.checkIns) {
    const slot = byHabit.get(c.habitId) ?? { completed: [], any: [] };
    slot.any.push(c.date);
    if (c.completed) slot.completed.push(c.date);
    byHabit.set(c.habitId, slot);
  }
  const doneSince = (habitId: string, since: string): string[] =>
    (byHabit.get(habitId)?.completed ?? []).filter((d) => d >= since);
  const anySince = (habitId: string, since: string): string[] =>
    (byHabit.get(habitId)?.any ?? []).filter((d) => d >= since);

  const pastStart = daysAgoKey(45, now);
  const weekStart = daysAgoKey(7, now);
  const twoWeeksStart = daysAgoKey(14, now);

  // 1. stale-win: strong in the past window, silent this week.
  for (const habit of active) {
    const past = (byHabit.get(habit.id)?.completed ?? []).filter(
      (d) => d >= pastStart && d < weekStart,
    ).length;
    const week = doneSince(habit.id, weekStart).length;
    if (past >= 3 && week === 0) {
      out.push({
        dedupeKey: `stale-win:${habit.id}`,
        kind: 'stale-win',
        title: `« ${habit.name} » était fort puis s'est éteint.`,
        question: `Tu l'as tenu ${past}× sur la fenêtre précédente, puis plus rien cette semaine. Qu'est-ce qui a changé — et quelle version plus petite le ramènerait dès demain sans forcer ?`,
        context: `${past}× sur les 45 derniers jours, 0 cette semaine.`,
        habitIds: [habit.id],
      });
    }
  }

  // 2. recurring-leak: habit opened but constantly missed recently.
  for (const habit of active) {
    const any7 = anySince(habit.id, weekStart);
    const done7 = doneSince(habit.id, weekStart);
    if (any7.length >= 2 && done7.length > 0 && done7.length / any7.length < 0.5) {
      out.push({
        dedupeKey: `recurring-leak:${habit.id}`,
        kind: 'recurring-leak',
        title: `« ${habit.name} » perd de l'eau : ${any7.length - done7.length} occasions manquées cette semaine.`,
        question: `Tu t'en es occupé ${any7.length}× cette semaine mais tu n'as tenu que ${done7.length}. Quel est le frottement exact les jours où ça échoue — et à quoi ressemblerait une version-bébé qui passerait même quand tout est serré ?`,
        context: `${done7.length}/${any7.length} cette semaine.`,
        habitIds: [habit.id],
      });
    }
  }

  // 3. quiet abandonment this year: had history, nothing in 14 days.
  for (const habit of active) {
    const all = byHabit.get(habit.id)?.any ?? [];
    if (all.length === 0) continue;
    const recent = all.filter((d) => d >= twoWeeksStart).length;
    if (recent === 0) {
      out.push({
        dedupeKey: `neglect:${habit.id}`,
        kind: 'neglect',
        title: `« ${habit.name} » est silencieux depuis 14 jours.`,
        question: `Ce champ a des réponses anciennes mais plus aucune trace depuis 14 jours. Est-ce un abandon assumé, ou un oubli dans le pli de la routine ? Et si tu le gardes, quelle est la plus petite case viable à lui donner ?`,
        context: `${all.length} traces au total, 0 depuis 14 jours.`,
        habitIds: [habit.id],
      });
    }
  }

  // 4. pattern-progress: a flaw being worked has moved recently ⇒ keep going.
  for (const t of data.tracks ?? []) {
    if (t.step <= 0) continue;
    if (!t.lastSeen || t.lastSeen < weekStart) continue;
    out.push({
      dedupeKey: `pattern-progress:${t.patternId}`,
      kind: 'pattern-progress',
      title: 'Une faille avance — tu y as retravaillé récemment.',
      question: `Tu es à l'étape ${t.step + 1} de cette faille. Qu'est-ce qui a réellement changé la dernière fois que tu en as reparlé — et quelle est la toute prochaine marche la plus petite ?`,
      context: `Étape ${t.step + 1}, revisitée cette semaine.`,
      habitIds: [],
    });
  }

  // 5. repetition: giving in again and again on the same urge type.
  const since14 = daysAgoKey(14, now);
  const gaveIn = new Map<string, number>();
  for (const u of data.urges) {
    if (u.outcome === 'gave_in' && u.startTime.slice(0, 10) >= since14) {
      gaveIn.set(u.type, (gaveIn.get(u.type) ?? 0) + 1);
    }
  }
  for (const [type, count] of gaveIn) {
    if (count >= 3) {
      out.push({
        dedupeKey: `repetition:${type}`,
        kind: 'repetition',
        title: `Tu as cédé à « ${type} » ${count} fois en 14 jours.`,
        question: `Ce déclencheur revient régulièrement. Qu'est-ce qui est exactement là juste avant de céder — et quelle contre-mesure minuscule pourrais-tu placer à cet endroit précis ?`,
        context: `${count} cédages sur 14 jours (type « ${type} »).`,
        habitIds: [],
      });
    }
  }

  // 7. momentum: several habits completed this week — find the keystone.
  const moving = active.filter((h) => doneSince(h.id, weekStart).length > 0);
  if (moving.length >= 3) {
    out.push({
      dedupeKey: `momentum:${weekStart}`,
      kind: 'momentum',
      title: `${moving.length} habitudes sont complétées cette semaine.`,
      question: `Pas mal en ce moment — ${moving.length} champs bougent. Lequel est la clé de voûte, celui qui tire réellement les autres ? Si tu ne gardais que celui-là en évidence, que verrais-tu ?`,
      context: `${moving.map((h) => h.name).slice(0, 4).join(', ')}…`,
      habitIds: moving.slice(0, 5).map((h) => h.id),
    });
  }

  // 8. confidence: a habit is 5+/7 this week and has a beatable best.
  for (const habit of active) {
    const done7 = doneSince(habit.id, weekStart).length;
    if (done7 >= 5) {
      out.push({
        dedupeKey: `confidence:${habit.id}`,
        kind: 'confidence',
        title: `« ${habit.name} » est porté à ${pct(done7, 7)} cette semaine.`,
        question: `Ce champ est devenu une vraie victoire d'identité. Comment l'approfondir d'un cran sans sur-régime — plus de qualité, une extension du stack, ou l'utiliser comme levier pour relancer un ancien champ ?`,
        context: `${done7}/7 jours cette semaine.`,
        habitIds: [habit.id],
      });
    }
  }

  return out;
}

/**
 * Remove reflections that are already being asked or have been answered under
 * the same dedupeKey within `windowDays` — so the engine doesn't nag.
 */
export function filterNewReflections(
  detected: DetectedReflection[],
  persisted: ReflectionEntry[],
  windowDays = 7,
): DetectedReflection[] {
  const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
  const seen = new Set<string>();
  for (const r of persisted) {
    if (r.createdAt >= cutoff) seen.add(r.dedupeKey);
  }
  return detected.filter((d) => !seen.has(d.dedupeKey));
}