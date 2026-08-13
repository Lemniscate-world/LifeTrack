// src/journalLinks.ts
// Cross-linking between the journal and the rest of LifeTrack. When a journal
// entry mentions a project, a protocol (Knowledge base) or a habit, LifeTrack
// can surface the link so the reflection feeds back into those domains.
// Deterministic, local, testable. No AI involved in the detection itself.

import type { Habit, Project, Protocol, JournalEntry } from './types';

export interface JournalLink {
  kind: 'project' | 'protocol' | 'habit';
  id: string;
  label: string;
  emoji?: string;
  /** How the mention was found (title, keyword, or habit name). */
  via: string;
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function mentions(text: string, needle: string): boolean {
  if (!needle || needle.length < 2) return false;
  return norm(text).includes(norm(needle));
}

/** Detect links from a free text against the user's projects/protocols/habits. */
export function detectJournalLinks(
  text: string,
  projects: Project[],
  protocols: Protocol[],
  habits: Habit[],
): JournalLink[] {
  const links: JournalLink[] = [];
  const seen = new Set<string>();

  const push = (kind: 'project' | 'protocol' | 'habit', id: string, label: string, emoji: string | undefined, via: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ kind, id, label, emoji, via });
  };

  for (const p of projects) {
    if (mentions(text, p.name)) push('project', p.id, p.name, p.emoji, 'nom du projet');
    else if (p.tasks.some((t) => t.title && mentions(text, t.title)))
      push('project', p.id, p.name, p.emoji, 'tâche du projet');
  }

  for (const p of protocols) {
    if (mentions(text, p.title)) push('protocol', p.id, p.title, '📚', 'titre du protocole');
    else if (p.keywords.some((k) => k && mentions(text, k)))
      push('protocol', p.id, p.title, '📚', `mot-clé "${p.keywords.find((k) => k && mentions(text, k))}"`);
  }

  for (const h of habits) {
    if (mentions(text, h.name)) push('habit', h.id, h.name, '🎯', 'habitude');
  }

  return links;
}

/**
 * Auto-link the stored projects/protocols/habits for a journal entry.
 * Returns the entry's stored ids refreshed with anything newly detected.
 */
export function resolveEntryLinks(entry: JournalEntry, links: JournalLink[]): {
  projectIds: string[];
  protocolIds: string[];
  habitIds: string[];
} {
  const projectIds = new Set(entry.projectIds ?? []);
  const protocolIds = new Set(entry.protocolIds ?? []);
  const habitIds = new Set(entry.habitIds ?? []);
  for (const l of links) {
    if (l.kind === 'project') projectIds.add(l.id);
    if (l.kind === 'protocol') protocolIds.add(l.id);
    if (l.kind === 'habit') habitIds.add(l.id);
  }
  return {
    projectIds: [...projectIds],
    protocolIds: [...protocolIds],
    habitIds: [...habitIds],
  };
}