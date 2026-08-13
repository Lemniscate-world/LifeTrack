// src/journalActions.ts
// Interactivity: turns a journal entry + its AI response into concrete,
// clickable next actions (create a challenge, log a note, link a project).
// Pure and testable; the UI just renders the returned buttons.

import type { JournalEntry, Habit, Project, Protocol } from './types';

export type JournalActionType = 'challenge' | 'note' | 'link-project' | 'link-protocol';

export interface JournalAction {
  type: JournalActionType;
  label: string;
  emoji: string;
  /** Target habit id for 'challenge', note content for 'note', link ids. */
  habitId?: string;
  noteText?: string;
  projectId?: string;
  protocolId?: string;
}

const STOP = /(?:^|\W)(la|le|les|un|une|des|de|du|je|tu|il|elle|on|nous|vous|ça|donc|mais|et|ou|si|alors|puis|après|avant|mais|que|qui|quoi)(?:\W|$)/gi;

function cleanHabitName(name: string): string {
  return name.trim().replace(STOP, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Suggest actions from a journal entry.
 * - If the entry references an existing habit → offer to launch a challenge.
 * - The entry content itself → offer to log it as a standalone note.
 * - Detected project/protocol links → offer to pin them to the entry.
 */
export function suggestJournalActions(
  entry: JournalEntry,
  habits: Habit[],
  projects: Project[],
  protocols: Protocol[],
  existingLinks: { projectIds?: string[]; protocolIds?: string[] } = {},
): JournalAction[] {
  const actions: JournalAction[] = [];
  const haystack = `${entry.content}\n${entry.response ?? ''}`.toLowerCase();

  // 1. Challenge for a referenced habit.
  for (const h of habits) {
    if (h.archived) continue;
    const name = h.name.toLowerCase();
    if (haystack.includes(name)) {
      actions.push({
        type: 'challenge',
        label: `Défi « ${cleanHabitName(h.name) || h.name} »`,
        emoji: '🔥',
        habitId: h.id,
      });
    }
  }

  // 2. Log this entry as a standalone note (the reflection becomes data).
  actions.push({
    type: 'note',
    label: 'Noter cette réflexion',
    emoji: '📝',
    noteText: entry.content.slice(0, 280),
  });

  // 3. Link a project that is not linked yet.
  const linkedProjects = new Set(existingLinks.projectIds ?? []);
  for (const p of projects) {
    if (linkedProjects.has(p.id)) continue;
    actions.push({
      type: 'link-project',
      label: `Lier à « ${p.name} »`,
      emoji: p.emoji ?? '🗂️',
      projectId: p.id,
    });
  }

  // 4. Link a protocol that is not linked yet.
  const linkedProtocols = new Set(existingLinks.protocolIds ?? []);
  for (const p of protocols.slice(0, 5)) {
    if (linkedProtocols.has(p.id)) continue;
    actions.push({
      type: 'link-protocol',
      label: `Protocole « ${p.title} »`,
      emoji: '📚',
      protocolId: p.id,
    });
  }

  return actions.slice(0, 6);
}