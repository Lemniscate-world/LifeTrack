import { describe, it, expect } from 'vitest';
import { buildJournalPrompts } from '../journalPrompts';
import { buildOnThisDay, buildMemoryReminder } from '../memories';
import type { Habit, Note, JournalEntry } from '../types';

function hab(id: string, name: string): Habit {
  return { id, name, color: '#000' } as Habit;
}

function note(id: string, content: string, createdAt: string, achievementCategory = 'growth'): Note {
  return { id, habitId: 'h1', content, createdAt, achievementCategory };
}

describe('buildJournalPrompts', () => {
  it('never returns an empty set (always has openers)', () => {
    const set = buildJournalPrompts({}, new Date('2026-07-20T12:00:00'));
    expect(set.prompts.length).toBeGreaterThan(0);
  });

  it('anchors a prompt on a recent tagged win', () => {
    const data = { notes: [note('n1', 'j\'ai tenu 30 jours', '2026-07-10T00:00:00')] };
    const set = buildJournalPrompts(data, new Date('2026-07-20T12:00:00'));
    expect(set.prompts.some((p) => p.id === 'win-effort')).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const now = new Date('2026-07-20T12:00:00');
    const a = buildJournalPrompts({ journalEntries: [{ id: 'j', content: 'test', personality: 'coach', response: '', createdAt: '2025-07-20T00:00:00' }] as unknown as JournalEntry[] }, now);
    const b = buildJournalPrompts({ journalEntries: [{ id: 'j', content: 'test', personality: 'coach', response: '', createdAt: '2025-07-20T00:00:00' }] as unknown as JournalEntry[] }, now);
    expect(a.prompts.map((p) => p.id)).toEqual(b.prompts.map((p) => p.id));
  });
});

describe('builderOnThisDay + reminder', () => {
  it('recalls a win from a prior year on the same date', () => {
    const now = new Date('2026-07-20T12:00:00');
    const recs = buildOnThisDay([hab('h1', 'Méditation')], [], [note('n1', 'grande victoire', '2025-07-20T00:00:00')], [], now);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.kind === 'win' && r.yearsAgo === 1)).toBe(true);
  });

  it('buildMemoryReminder falls back to a grounding line without data', () => {
    const msg = buildMemoryReminder([], new Date('2026-07-20T12:00:00'));
    expect(msg.title).toContain('Ancre-toi');
    expect(msg.body.length).toBeGreaterThan(0);
  });
});