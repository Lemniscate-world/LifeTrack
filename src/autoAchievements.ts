// src/autoAchievements.ts
// Automatic, data-derived achievements — so the Achievements timeline is rich
// even before the user tags any note. Every milestone is COMPUTED from REAL
// data (never store-duplicated), so it's always correct and testable.

import type { CheckIn, Habit, Note, Challenge, Experiment, UrgeEntry, JournalEntry, Project } from './types';

export interface AutoAchievement {
  id: string;
  emoji: string;
  title: string;
  detail: string;
  date: string; // ISO-ish date of the milestone (approximate where needed)
}

export interface AutoAchievementInput {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
  challenges: Challenge[];
  experiments: Experiment[];
  urges: UrgeEntry[];
  journalEntries: JournalEntry[];
  projects: Project[];
}

function iso(d: string | undefined): string {
  return typeof d === 'string' ? d.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/** Total completed check-ins (counts each completion). */
export function totalCompleted(checkIns: CheckIn[]): number {
  return checkIns.reduce((s, c) => s + (c.completed ? (c.count ?? 1) : 0), 0);
}

/** Longest consecutive completed-day run across all habits. */
export function bestStreak(habits: Habit[], checkIns: CheckIn[]): number {
  const daySet = (habitId: string): number[] => {
    const days = new Set<number>();
    for (const c of checkIns) {
      if (c.habitId === habitId && c.completed) {
        days.add(new Date(c.date + 'T00:00:00').getTime());
      }
    }
    return [...days].sort((a, b) => a - b);
  };
  let best = 0;
  for (const h of habits) {
    const sorted = daySet(h.id);
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

/** Run the milestone detector over real data. */
export function computeAutoAchievements(input: AutoAchievementInput): AutoAchievement[] {
  const out: AutoAchievement[] = [];
  const { habits, checkIns, notes, challenges, experiments, urges, journalEntries, projects } = input;

  const firstHabit = [...habits].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (firstHabit) {
    out.push({
      id: 'auto-first-habit',
      emoji: '🌱',
      title: 'Premier pas',
      detail: `Tu as créé ta première habitude : « ${firstHabit.name} ».`,
      date: iso(firstHabit.createdAt),
    });
  }

  const streak = bestStreak(habits.filter((h) => !h.archived), checkIns);
  if (streak >= 7) {
    out.push({
      id: 'auto-streak-7',
      emoji: '🔥',
      title: 'Semaine tenue',
      detail: `Série de ${streak} jours consécutifs sur une habitude.`,
      date: new Date().toISOString().slice(0, 10),
    });
  }
  if (streak >= 30) {
    out.push({
      id: 'auto-streak-30',
      emoji: '🏔️',
      title: 'Marathon',
      detail: `Série de ${streak} jours — une habitude devenue identité.`,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  const completed = totalCompleted(checkIns);
  if (completed >= 100) {
    out.push({ id: 'auto-100', emoji: '💯', title: 'Cent clics', detail: `${completed} réalisations cumulées.`, date: new Date().toISOString().slice(0, 10) });
  } else if (completed >= 10) {
    out.push({ id: 'auto-10', emoji: '✨', title: 'Dix réalisations', detail: `${completed} réalisations cumulées — la machine tourne.`, date: new Date().toISOString().slice(0, 10) });
  }

  if (notes.some((n) => n.achievementCategory)) {
    out.push({ id: 'auto-first-win', emoji: '🏅', title: 'Première victoire', detail: 'Tu as marqué ta première réussite dans ta timeline.', date: new Date().toISOString().slice(0, 10) });
  }

  if (experiments.some((e) => e.status === 'completed')) {
    out.push({ id: 'auto-exp-done', emoji: '🧪', title: 'Chercheur de soi', detail: 'Tu as conclu une expérience N=1.', date: new Date().toISOString().slice(0, 10) });
  }

  if (urges.some((u) => u.outcome === 'surfed')) {
    out.push({ id: 'auto-urge-surfed', emoji: '🌊', title: 'Première vague surfée', detail: 'Tu as traversé une envie sans y céder.', date: new Date().toISOString().slice(0, 10) });
  }

  if (journalEntries.length > 0) {
    out.push({ id: 'auto-journal', emoji: '📓', title: 'Voix écrite', detail: 'Tu as ouvert ton journal.', date: iso(journalEntries[0]?.createdAt) });
  }

  if (projects.length > 0) {
    const done = projects.find((p) => p.status === 'done');
    out.push({
      id: 'auto-project',
      emoji: '📦',
      title: done ? 'Livraison' : 'Chantier ouvert',
      detail: done ? `Projet « ${done.name} » terminé.` : `${projects.length} projet(s) structuré(s) — l'effort devient livrable.`,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  const challengesDone = challenges.filter((c) => c.status === 'completed').length;
  if (challengesDone >= 1) {
    out.push({ id: 'auto-challenge', emoji: '🏆', title: `Défi relevé${challengesDone > 1 ? ` ×${challengesDone}` : ''}`, detail: 'Un challenge est allé au bout.', date: new Date().toISOString().slice(0, 10) });
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}
