import { describe, it, expect } from 'vitest';
import { suggestJournalActions } from '../journalActions';
import { searchJournalEntries, highlightQuery } from '../journalSearch';
import type { Habit, Project, JournalEntry } from '../types';

const habits: Habit[] = [
  { id: 'h1', name: 'Méditation', color: '#000' } as Habit,
  { id: 'h2', name: 'Lecture', archived: true, color: '#000' } as Habit,
];

const projects: Project[] = [
  { id: 'p1', name: 'Livre', status: 'active', habitIds: [], tasks: [], createdAt: '2026-01-01' } as Project,
];

const entry = (content: string, response = '', personality: JournalEntry['personality'] = 'coach'): JournalEntry => ({
  id: crypto.randomUUID(),
  content,
  personality,
  response,
  createdAt: '2026-07-20T10:00:00.000Z',
});

describe('suggestJournalActions', () => {
  it('offers a challenge for a referenced non-archived habit', () => {
    const e = entry('la méditation m\'aide vraiment');
    const actions = suggestJournalActions(e, habits, [], []);
    expect(actions.some((a) => a.type === 'challenge' && a.habitId === 'h1')).toBe(true);
  });

  it('never offers a challenge for an archived habit', () => {
    const e = entry('la lecture est un plaisir');
    const actions = suggestJournalActions(e, habits, [], []);
    expect(actions.some((a) => a.habitId === 'h2')).toBe(false);
  });

  it('always offers to log the reflection as a note', () => {
    const actions = suggestJournalActions(entry('quelque chose'), [], [], []);
    expect(actions.some((a) => a.type === 'note')).toBe(true);
  });

  it('offers to link an unlinked project', () => {
    const actions = suggestJournalActions(entry('x'), [], projects, []);
    expect(actions.some((a) => a.type === 'link-project' && a.projectId === 'p1')).toBe(true);
  });

  it('skips projects that are already linked', () => {
    const e = entry('x', '', 'coach');
    const actions = suggestJournalActions(e, [], projects, [], { projectIds: ['p1'] });
    expect(actions.some((a) => a.type === 'link-project')).toBe(false);
  });

  it('caps the number of actions', () => {
    const manyProjects: Project[] = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Projet ${i}`, status: 'active', habitIds: [], tasks: [], createdAt: '2026-01-01' } as Project));
    const actions = suggestJournalActions(entry('x'), [], manyProjects, []);
    expect(actions.length).toBeLessThanOrEqual(6);
  });
});

describe('searchJournalEntries', () => {
  const entries = [
    entry('j\'ai médité ce matin, la discipline revient'),
    entry('grosse fatigue, je n\'ai rien fait', 'réponse sage', 'sage'),
    entry('le livre avance bien', 'réponse coach', 'coach'),
  ];

  it('filters by free text across content and response', () => {
    const res = searchJournalEntries(entries, { text: 'discipline' });
    expect(res).toHaveLength(1);
    expect(res[0].content).toContain('discipline');
  });

  it('filters by persona', () => {
    const res = searchJournalEntries(entries, { persona: 'sage' });
    expect(res).toHaveLength(1);
    expect(res[0].personality).toBe('sage');
  });

  it('filters by project link', () => {
    const linked = entries[2];
    const res = searchJournalEntries(entries, { projectId: 'p1' });
    expect(res).toHaveLength(0);
    const withLink = [...entries];
    withLink[2] = { ...linked, projectIds: ['p1'] };
    const res2 = searchJournalEntries(withLink, { projectId: 'p1' });
    expect(res2).toHaveLength(1);
  });

  it('ranks more hits first', () => {
    const many = entry('discipline discipline discipline');
    const res = searchJournalEntries([entry('discipline'), many], { text: 'discipline' });
    expect(res[0].id).toBe(many.id);
  });
});

describe('highlightQuery', () => {
  it('wraps matches in **', () => {
    expect(highlightQuery('la discipline revient', 'discipline')).toBe('la **discipline** revient');
  });

  it('is diacritics-insensitive', () => {
    expect(highlightQuery('méditation', 'meditation')).toBe('**méditation**');
  });

  it('returns text unchanged when query is empty', () => {
    expect(highlightQuery('abc', '')).toBe('abc');
  });
});
