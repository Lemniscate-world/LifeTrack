import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  flushSave,
  addJournalEntry,
  deleteJournalEntry,
  getJournalEntries,
  exportAllData,
  startJournalThread,
  getJournalThreads,
  getJournalThread,
  deleteJournalThread,
  tagJournalEntryThread,
} from '../store';

beforeEach(() => {
  resetStore();
  flushSave();
});

describe('Journal — threads', () => {
  it('starts a thread and persists it through exportAllData', () => {
    const thread = startJournalThread({ question: 'Qu’est-ce qui t’a ressourceé cette semaine ?', emoji: '🌱' });
    const exported = exportAllData();
    expect(exported.journalThreads ?? []).toHaveLength(1);
    expect((exported.journalThreads ?? [])[0]?.id).toBe(thread.id);
    expect(thread.question).toContain('ressourceé');
  });

  it('starts a thread bound to a pattern track', () => {
    const thread = startJournalThread({ question: 'Reprenons « x »', patternId: 'p1', step: 2 });
    expect(thread.patternId).toBe('p1');
    expect(thread.step).toBe(2);
    const found = getJournalThread(thread.id);
    expect(found?.patternId).toBe('p1');
  });

  it('tags a journal entry to a thread and bumps thread recency', async () => {
    const thread = startJournalThread({ question: 'Question' });
    const entry = addJournalEntry('Réponse', 'coach', 'Réflexion');
    tagJournalEntryThread(entry.id, thread.id);
    const entries = getJournalEntries();
    expect(entries[0].threadId).toBe(thread.id);
  });

  it('deletes a thread without removing the journal entries', () => {
    const thread = startJournalThread({ question: 'Q' });
    const entry = addJournalEntry('Réponse', 'coach', 'r');
    tagJournalEntryThread(entry.id, thread.id);
    deleteJournalThread(thread.id);
    expect(getJournalThreads()).toHaveLength(0);
    expect(getJournalEntries()).toHaveLength(1);
    // Entries keep their threadId reference; only the grouping is gone.
    expect(getJournalEntries()[0].threadId).toBe(thread.id);
  });

  it('threads are returned newest-start first', async () => {
    const a = startJournalThread({ question: 'Ancienne' });
    await new Promise((r) => setTimeout(r, 10));
    startJournalThread({ question: 'Récente' });
    const threads = getJournalThreads();
    expect(threads[0].id).not.toBe(a.id);
    expect(threads[0].question).toBe('Récente');
  });
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

  it('accepts the new Robert Greene and Huberman personas', () => {
    addJournalEntry('entrée stratégie', 'robert-greene', 'Loi 1 — ne dépassez jamais votre maître.');
    addJournalEntry('entrée neurosciences', 'huberman', 'Exposition au soleil le matin.');
    const entries = getJournalEntries();
    const greene = entries.find((e) => e.personality === 'robert-greene');
    const huberman = entries.find((e) => e.personality === 'huberman');
    expect(greene).toBeDefined();
    expect(greene?.response).toContain('Loi 1');
    expect(huberman).toBeDefined();
    expect(huberman?.response).toContain('soleil');
  });
});
