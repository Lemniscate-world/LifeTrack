import { describe, it, expect } from 'vitest';
import { buildJournalDigest, digestSummary, longestRun, currentRun } from '../journalDigest';
import type { JournalEntry } from '../types';

function entry(day: string, content: string, personality: JournalEntry['personality'] = 'coach'): JournalEntry {
  return {
    id: crypto.randomUUID(),
    content,
    personality,
    response: 'réponse',
    createdAt: `${day}T10:00:00.000Z`,
  };
}

describe('longestRun / currentRun', () => {
  it('longestRun counts consecutive calendar days', () => {
    expect(longestRun(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-05'])).toBe(3);
    expect(longestRun([])).toBe(0);
  });

  it('currentRun counts consecutive days ending today', () => {
    const today = new Date('2026-07-20T12:00:00');
    expect(currentRun(['2026-07-18', '2026-07-19', '2026-07-20'], today)).toBe(3);
    expect(currentRun(['2026-07-19', '2026-07-20'], today)).toBe(2);
    expect(currentRun(['2026-07-10'], today)).toBe(0);
  });
});

describe('buildJournalDigest', () => {
  it('computes volume, active days and streaks for a week', () => {
    const entries = [
      entry('2026-07-19', 'a', 'coach'),
      entry('2026-07-20', 'b', 'sage'),
      entry('2026-07-20', 'c', 'coach'),
    ];
    const d = buildJournalDigest(entries, new Date('2026-07-20T12:00:00'), 'week');
    expect(d.windowStart).toBe('2026-07-14');
    expect(d.windowEnd).toBe('2026-07-20');
    expect(d.totalEntries).toBe(3);
    expect(d.activeDays).toBe(2);
    expect(d.entriesPerDay).toBe(1.5);
    expect(d.streak).toBe(2);
    expect(d.bestStreak).toBe(2);
    expect(d.daysWithTwoPlus).toBe(1);
  });

  it('excludes entries outside the window', () => {
    const entries = [entry('2026-07-01', 'old')];
    const d = buildJournalDigest(entries, new Date('2026-07-20T12:00:00'), 'week');
    expect(d.totalEntries).toBe(0);
    expect(d.activeDays).toBe(0);
  });

  it('aggregates personas sorted by count desc', () => {
    const entries = [
      entry('2026-07-20', 'a', 'coach'),
      entry('2026-07-20', 'b', 'coach'),
      entry('2026-07-19', 'c', 'sage'),
    ];
    const d = buildJournalDigest(entries, new Date('2026-07-20T12:00:00'), 'week');
    expect(d.byPersona[0]).toEqual({ personality: 'coach', count: 2 });
    expect(d.byPersona[1]).toEqual({ personality: 'sage', count: 1 });
  });

  it('extracts recurring words (stopwords filtered)', () => {
    const entries = [entry('2026-07-20', 'la discipline discipline chaque matin, le matin c\'est discipliné')];
    const d = buildJournalDigest(entries, new Date('2026-07-20T12:00:00'), 'week');
    const discipline = d.topWords.find((w) => w.word === 'discipline');
    const matin = d.topWords.find((w) => w.word === 'matin');
    expect(discipline).toBeDefined();
    expect(discipline!.count).toBeGreaterThanOrEqual(2);
    expect(matin).toBeDefined();
  });

  it('digestSummary is a readable line', () => {
    const d = buildJournalDigest([entry('2026-07-20', 'x')], new Date('2026-07-20T12:00:00'), 'week');
    expect(digestSummary(d)).toContain('1 entrée');
    expect(digestSummary(d)).toContain('Coach 1');
  });
});
