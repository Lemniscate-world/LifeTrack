import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  flushSave,
  addJournalEntry,
  deleteJournalEntry,
  getJournalEntries,
  exportAllData,
} from '../store';

beforeEach(() => {
  resetStore();
  flushSave();
});

describe('Journal — store CRUD', () => {
  it('adds a journal entry and returns it sorted newest-first', async () => {
    addJournalEntry('première entrée', 'coach', 'Réflexion du coach');
    // Ensure distinct timestamps so ordering is deterministic.
    await new Promise((r) => setTimeout(r, 10));
    addJournalEntry('deuxième entrée', 'sage', 'Réflexion du sage');
    const entries = getJournalEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe('deuxième entrée');
    expect(entries[0].personality).toBe('sage');
    expect(entries[1].personality).toBe('coach');
    expect(entries[0].response).toBe('Réflexion du sage');
  });

  it('persists journal entries through exportAllData', () => {
    const entry = addJournalEntry('entrée test', 'strategist', 'Plan');
    const exported = exportAllData();
    expect(exported.journalEntries).toHaveLength(1);
    expect(exported.journalEntries[0].id).toBe(entry.id);
  });

  it('deletes a journal entry', () => {
    const a = addJournalEntry('a', 'coach', 'r');
    const b = addJournalEntry('b', 'psychologist', 'r');
    deleteJournalEntry(a.id);
    const entries = getJournalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(b.id);
  });
});
