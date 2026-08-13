// src/journalSearch.ts
// Full-text search over the journal history. Searches content, response,
// persona, date and any linked ids. Returns the entries that match, ranked by
// number of hits. Deterministic and testable.

import type { JournalEntry } from './types';

export interface JournalSearchQuery {
  text?: string;
  persona?: string;
  projectId?: string;
  protocolId?: string;
  fromDay?: string;   // YYYY-MM-DD inclusive
  toDay?: string;     // YYYY-MM-DD inclusive
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dayKey(iso: string): string {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

function hitCount(entry: JournalEntry, text: string): number {
  const q = norm(text);
  if (!q) return 0;
  const corpus = norm(`${entry.content}\n${entry.response ?? ''}\n${entry.personality}`);
  let count = 0;
  let idx = corpus.indexOf(q);
  while (idx !== -1) {
    count++;
    idx = corpus.indexOf(q, idx + q.length);
  }
  return count;
}

/** Search the journal, returning entries ranked by relevance (newest first). */
export function searchJournalEntries(
  entries: JournalEntry[],
  query: JournalSearchQuery,
): JournalEntry[] {
  const text = (query.text ?? '').trim();
  const persona = query.persona?.trim().toLowerCase();

  const scored = entries
    .filter((e) => {
      if (!e || typeof e.createdAt !== 'string') return false;
      if (persona && e.personality.toLowerCase() !== persona) return false;
      if (query.projectId && !(e.projectIds ?? []).includes(query.projectId)) return false;
      if (query.protocolId && !(e.protocolIds ?? []).includes(query.protocolId)) return false;
      const day = dayKey(e.createdAt);
      if (query.fromDay && day < query.fromDay) return false;
      if (query.toDay && day > query.toDay) return false;
      if (text && hitCount(e, text) === 0) return false;
      return true;
    })
    .map((e) => ({ e, hits: text ? hitCount(e, text) : 1 }));

  scored.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return b.e.createdAt.localeCompare(a.e.createdAt);
  });

  return scored.map((s) => s.e);
}

/** Highlight a search query inside a text with a markdown-ish marker. */
export function highlightQuery(text: string, q: string): string {
  const needle = norm(q);
  if (!needle) return text;
  // Rebuild index map: find normalized position → original position is complex;
  // simple approach: operate on the original string using a case/diacritic
  // insensitive search by walking characters.
  const normChars = [...norm(text)];
  const origChars = [...text];
  if (normChars.length !== origChars.length) return text;
  const out: string[] = [];
  let i = 0;
  while (i < origChars.length) {
    const slice = normChars.slice(i, i + needle.length).join('');
    if (slice === needle) {
      out.push(`**${origChars.slice(i, i + needle.length).join('')}**`);
      i += needle.length;
    } else {
      out.push(origChars[i]);
      i++;
    }
  }
  return out.join('');
}