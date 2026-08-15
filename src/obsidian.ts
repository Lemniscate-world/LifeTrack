// src/obsidian.ts
// Pure, tested module that turns free-form Obsidian notes (unstructured
// markdown) into structured qualitative signals LifeTrack can use:
//   1. THEMES — lexicon-based detection of recurring life topics
//      (fatigue, stress, victory, focus, sleep...) with positive/negative valence.
//   2. LINKS — Obsidian wikilinks [[Habit Name]] matched against the user's
//      actual habits by name, so a note like "[[Gym]] était dur" adds context
//      to that habit.
// Everything here is pure (strings in → structured data out) for easy testing.

import type { Habit } from './types';

export type ThemeValence = 'positive' | 'negative' | 'neutral';

export interface ObsidianTheme {
  id: string;
  label: string;
  valence: ThemeValence;
  /** Regex fragments matched case-insensitively against the note text. */
  keywords: string[];
  /** Emoji for UI display. */
  emoji: string;
}

export interface ThemeHit {
  themeId: string;
  label: string;
  valence: ThemeValence;
  emoji: string;
  /** Number of keyword occurrences found in the note. */
  count: number;
  /** The matched keyword snippets (up to 3) for display. */
  examples: string[];
}

export interface HabitMention {
  habitId: string;
  habitName: string;
  /** Exact wikilink name as written in the note. */
  linkName: string;
  /** Number of occurrences of this link in the note. */
  count: number;
}

export interface ObsidianNoteAnalysis {
  fileName: string;
  themes: ThemeHit[];
  mentions: HabitMention[];
  /** Rough sentiment score: positive hits − negative hits. */
  sentiment: number;
}

export interface ObsidianAnalysis {
  notes: ObsidianNoteAnalysis[];
  /** All themes across notes, aggregated by id with total counts. */
  themeTotals: { themeId: string; label: string; valence: ThemeValence; emoji: string; count: number }[];
  /** All habit mentions across notes, aggregated. */
  mentionTotals: { habitId: string; habitName: string; count: number }[];
  /** Overall sentiment across all notes. */
  sentiment: number;
  /** Notes containing the most negative themes (fatigue/stress/anxiety...). */
  hardestNotes: string[];
}

export const OBSIDIAN_THEMES: ObsidianTheme[] = [
  {
    id: 'fatigue', label: 'Fatigue', valence: 'negative', emoji: '😴',
    keywords: ['fatigue', 'épuisé', 'epuise', 'crevé', 'ereve', 'épuisement', 'tiré', 'tire', 'pompe', 'éteint', 'eteint', 'sommeil'],
  },
  {
    id: 'stress', label: 'Stress', valence: 'negative', emoji: '😰',
    keywords: ['stress', 'anxiété', 'anxiete', 'angoisse', 'pression', 'deborde', 'débordé', 'surcharge', 'panique', 'inquiet', 'inquiétude'],
  },
  {
    id: 'victory', label: 'Victoire', valence: 'positive', emoji: '🏆',
    keywords: ['réussi', 'reussi', 'victoire', 'succès', 'succes', 'fier', 'fière', 'fierté', 'fierte', 'gagné', 'gagne', 'accompli', 'dépassé', 'depasse', 'progressé', 'progresse'],
  },
  {
    id: 'focus', label: 'Focus', valence: 'positive', emoji: '🎯',
    keywords: ['focus', 'concentré', 'concentre', 'concentration', 'productif', 'productivité', 'productivite', 'flow', 'dans le zone', 'efficace', 'impliqué', 'implique'],
  },
  {
    id: 'procastination', label: 'Procrastination', valence: 'negative', emoji: '⏳',
    keywords: ['procrastin', 'remis à demain', 'remise à demain', 'difficulté à commencer', 'difficulte a commencer', 'je repousse', 'je n\'arrive pas à commencer'],
  },
  {
    id: 'social', label: 'Social', valence: 'neutral', emoji: '👥',
    keywords: ['amis', 'ami', 'famille', 'soirée', 'soiree', 'sortie', 'rencontré', 'rencontre', 'rendez-vous', 'repas de famille', 'appel', 'discussion', 'partagé', 'partage'],
  },
  {
    id: 'money', label: 'Argent', valence: 'neutral', emoji: '💰',
    keywords: ['argent', 'budget', 'dépense', 'depense', 'économie', 'economie', 'épargne', 'epargne', 'achat', 'facture', 'salaire', 'revenue', 'investissement'],
  },
  {
    id: 'pain', label: 'Douleur', valence: 'negative', emoji: '🤕',
    keywords: ['douleur', 'mal de tête', 'mal de tete', 'migraine', 'mal au dos', 'maladie', 'malade', 'blessure', 'douleurs', 'courbatures', 'tension musculaire'],
  },
  {
    id: 'gratitude', label: 'Gratitude', valence: 'positive', emoji: '🙏',
    keywords: ['gratitude', 'reconnaissant', 'reconnaissante', 'merci', 'chanceux', 'chanceuse', 'je suis content', 'content de', 'heureux', 'heureuse', 'apprécié', 'apprecie'],
  },
  {
    id: 'frustration', label: 'Frustration', valence: 'negative', emoji: '😤',
    keywords: ['frustr', 'énervé', 'enerve', 'agacé', 'agace', 'énervant', 'enerve par', 'rage', 'exaspér', 'exasper', 'irrité', 'irrite'],
  },
  {
    id: 'energy', label: 'Énergie', valence: 'positive', emoji: '⚡',
    keywords: ['énergie', 'energie', 'plein d\'énergie', 'plein de vie', 'dynamique', 'tonique', 'revigoré', 'revigore', 'boost', 'ressourcé', 'ressource'],
  },
  {
    id: 'sleep', label: 'Sommeil', valence: 'neutral', emoji: '🛌',
    keywords: ['sommeil', 'nuit', 'réveillé', 'reveille', 'insomnie', 'dormi', 'dors', 'cauchemar', 'rêvé', 'reve', 'sieste', 'réveil', 'reveil'],
  },
];

const THEME_BY_ID = new Map(OBSIDIAN_THEMES.map((t) => [t.id, t]));

/** Escape regex metacharacters in a keyword fragment. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Detect theme hits in a free-form note. */
export function extractObsidianThemes(content: string): ThemeHit[] {
  const lower = content.toLowerCase();
  const hits: ThemeHit[] = [];
  for (const theme of OBSIDIAN_THEMES) {
    const examples: string[] = [];
    let count = 0;
    for (const kw of theme.keywords) {
      const re = new RegExp(esc(kw), 'gi');
      const matches = lower.match(re);
      if (matches) {
        count += matches.length;
        if (examples.length < 3) {
          // Recover the original text of the first match for display.
          const idx = lower.indexOf(kw.toLowerCase());
          if (idx >= 0) {
            const start = Math.max(0, idx - 12);
            const end = Math.min(content.length, idx + kw.length + 24);
            examples.push(content.slice(start, end).trim().replace(/\s+/g, ' '));
          }
        }
      }
    }
    if (count > 0) {
      hits.push({ themeId: theme.id, label: theme.label, valence: theme.valence, emoji: theme.emoji, count, examples });
    }
  }
  return hits.sort((a, b) => b.count - a.count);
}

/** Extract Obsidian wikilinks [[Name]] or [[Name|alias]] from a note. */
export function extractObsidianLinks(content: string): string[] {
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    if (name) out.push(name);
  }
  return out;
}

/** Match wikilinks against the user's habits by name (case/accent-insensitive). */
export function matchMentions(links: string[], habits: Habit[]): HabitMention[] {
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const byName = new Map<string, Habit>();
  for (const h of habits) byName.set(normalize(h.name), h);
  const counts = new Map<string, number>();
  for (const link of links) {
    const key = normalize(link);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: HabitMention[] = [];
  for (const [normalized, count] of counts) {
    const habit = byName.get(normalized);
    if (habit) {
      out.push({ habitId: habit.id, habitName: habit.name, linkName: normalized, count });
    }
  }
  return out;
}

/** Analyze one note. */
export function analyzeNote(fileName: string, content: string, habits: Habit[]): ObsidianNoteAnalysis {
  const themes = extractObsidianThemes(content);
  const mentions = matchMentions(extractObsidianLinks(content), habits);
  const sentiment = themes.reduce((s, t) => s + (t.valence === 'positive' ? t.count : t.valence === 'negative' ? -t.count : 0), 0);
  return { fileName, themes, mentions, sentiment };
}

/** Analyze a set of notes (fileName → content) and aggregate across all of them. */
export function analyzeNotes(notes: { fileName: string; content: string }[], habits: Habit[]): ObsidianAnalysis {
  const analyzed = notes.map((n) => analyzeNote(n.fileName, n.content, habits));

  const themeTotals = new Map<string, { themeId: string; label: string; valence: ThemeValence; emoji: string; count: number }>();
  for (const n of analyzed) {
    for (const t of n.themes) {
      const cur = themeTotals.get(t.themeId);
      if (cur) cur.count += t.count;
      else themeTotals.set(t.themeId, { themeId: t.themeId, label: t.label, valence: t.valence, emoji: t.emoji, count: t.count });
    }
  }

  const mentionTotals = new Map<string, { habitId: string; habitName: string; count: number }>();
  for (const n of analyzed) {
    for (const m of n.mentions) {
      const cur = mentionTotals.get(m.habitId);
      if (cur) cur.count += m.count;
      else mentionTotals.set(m.habitId, { habitId: m.habitId, habitName: m.habitName, count: m.count });
    }
  }

  const sentiment = analyzed.reduce((s, n) => s + n.sentiment, 0);

  const hardest = analyzed
    .filter((n) => n.sentiment < 0)
    .sort((a, b) => a.sentiment - b.sentiment)
    .slice(0, 3)
    .map((n) => n.fileName);

  return {
    notes: analyzed,
    themeTotals: [...themeTotals.values()].sort((a, b) => b.count - a.count),
    mentionTotals: [...mentionTotals.values()].sort((a, b) => b.count - a.count),
    sentiment,
    hardestNotes: hardest,
  };
}

export function getThemeById(id: string): ObsidianTheme | undefined {
  return THEME_BY_ID.get(id);
}