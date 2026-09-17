// src/selfCompassion.ts
// Self-compassion break after missed days (Kristin Neff 2003).
//
// Why this exists: after 2+ missed days the default inner voice is
// self-criticism ("je suis nul, tout est fichu"), which predicts giving up.
// Self-compassion — mindfulness + common humanity + kindness — predicts
// re-engagement. So when the grid would show a punishing red ring, LifeTrack
// shows this instead: acknowledge, normalize, invite one tiny kind step.
//
// Pure + deterministic: same inputs → same output, unit-tested.

/** Two regimes: a LAPSE (2–14 missed days, re-engage gently) vs a DORMANT
 * habit (15+, the habit is effectively abandoned — redefining or archiving
 * without guilt IS the self-compassionate move, not another pep talk). */
export const DORMANT_THRESHOLD_DAYS = 15;

export interface SelfCompassionBreak {
  /** 'lapse' = recent slip · 'dormant' = abandoned, needs redefinition. */
  mode: 'lapse' | 'dormant';
  /** Short header, e.g. '💚 2 jours sans Gym — c'est humain'. */
  title: string;
  /** The three Neff components, personalized with the habit name. */
  phrases: [string, string, string];
  /** The kind re-entry question (tiny step, doux-compatible). */
  cta: string;
}

/**
 * Build the break for a habit missed `missedDays` consecutive days (≥2).
 * Returns null below the threshold — no break, no noise.
 */
export function selfCompassionFor(habitName: string, missedDays: number): SelfCompassionBreak | null {
  if (!Number.isFinite(missedDays) || missedDays < 2) return null;
  const name = habitName.trim() || 'cette habitude';
  const days = Math.floor(missedDays);
  if (days >= DORMANT_THRESHOLD_DAYS) {
    return {
      mode: 'dormant',
      title: `💤 ${name} dort depuis ${days} jours — ce n'est pas un échec, c'est une information`,
      phrases: [
        `Pleine conscience : « ${name} ne fait plus partie de mes journées depuis ${days} jours » — constat, pas verdict.`,
        `Humanité commune : les habitudes ont des saisons. En garder une par culpabilité, c'est comme garder un pull qui gratte.`,
        `Bienveillance : tu as le droit de redéfinir minuscule (2 minutes, pas 30) ou d'archiver sans te juger. Les deux sont des victoires.`,
      ],
      cta: `Que vaut ${name} aujourd'hui : version 2-minutes, ou archive libératrice ?`,
    };
  }
  return {
    mode: 'lapse',
    title: `💚 ${days} jours sans ${name} — c'est humain, pas un échec`,
    phrases: [
      // 1. Mindfulness: name the pain without amplifying or denying it.
      `Pleine conscience : « ${days} jours sans ${name}, et ça me pèse un peu » — ni minimiser, ni dramatiser.`,
      // 2. Common humanity: you are not uniquely broken.
      `Humanité commune : des millions de gens ratent aussi leur habitude aujourd'hui. Tu n'es pas seul, tu es normal.`,
      // 3. Self-kindness: speak like to a friend.
      `Bienveillance : si un ami te disait ça, tu ne l'insulterais pas — tu lui proposerais un tout petit pas. Fais pareil pour toi.`,
    ],
    cta: `Quel est le plus petit pas doux possible pour ${name} aujourd'hui ? (une sous-coche suffit — le streak te remerciera)`,
  };
}
