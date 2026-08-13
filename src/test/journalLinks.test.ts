import { describe, it, expect } from 'vitest';
import { detectJournalLinks, resolveEntryLinks } from '../journalLinks';
import type { Habit, Project, Protocol, JournalEntry } from '../types';

const projects: Project[] = [
  { id: 'p1', name: 'Livre 48 lois', status: 'active', habitIds: [], tasks: [], createdAt: '2026-01-01' } as Project,
  { id: 'p2', name: 'Side project app', status: 'active', habitIds: [], tasks: [{ id: 't1', title: 'shipping la v1', done: false, createdAt: '2026-01-01' }] as Project['tasks'], createdAt: '2026-01-01' } as Project,
];

const protocols: Protocol[] = [
  { id: 'pr1', title: 'Exposition soleil matin', source: 'x', claim: '', evidenceLevel: 'B', domain: 'sleep', protocol: '', keywords: ['soleil', 'lumière'], habitSuggestions: [] } as Protocol,
  { id: 'pr2', title: 'NSDR', source: 'x', claim: '', evidenceLevel: 'B', domain: 'focus', protocol: '', keywords: ['nsdr', 'reset'], habitSuggestions: [] } as Protocol,
];

const habits: Habit[] = [
  { id: 'h1', name: 'Méditation', color: '#000' } as Habit,
];

describe('detectJournalLinks', () => {
  it('detects a project by name', () => {
    const links = detectJournalLinks('je veux finir le livre 48 lois', projects, protocols, habits);
    expect(links.some((l) => l.kind === 'project' && l.id === 'p1')).toBe(true);
  });

  it('detects a project by task title', () => {
    const links = detectJournalLinks('toujours pas shipping la v1', projects, protocols, habits);
    expect(links.some((l) => l.kind === 'project' && l.id === 'p2')).toBe(true);
  });

  it('detects a protocol by keyword (diacritics-insensitive)', () => {
    const links = detectJournalLinks('j\'ai essayé l\'exposition au soleil', projects, protocols, habits);
    expect(links.some((l) => l.kind === 'protocol' && l.id === 'pr1')).toBe(true);
  });

  it('detects a habit by name', () => {
    const links = detectJournalLinks('méditation', projects, protocols, habits);
    expect(links.some((l) => l.kind === 'habit' && l.id === 'h1')).toBe(true);
  });

  it('does not duplicate a link', () => {
    const links = detectJournalLinks('méditation méditation méditation', projects, protocols, habits);
    expect(links.filter((l) => l.kind === 'habit').length).toBe(1);
  });
});

describe('resolveEntryLinks', () => {
  it('merges detected links with stored ones without duplicates', () => {
    const entry: JournalEntry = { id: 'e1', content: 'x', personality: 'coach', response: '', createdAt: '2026-01-01', projectIds: ['p1'] };
    const links = detectJournalLinks('méditation', projects, protocols, habits);
    const resolved = resolveEntryLinks(entry, links);
    expect(resolved.projectIds).toEqual(['p1']);
    expect(resolved.habitIds).toEqual(['h1']);
  });
});
