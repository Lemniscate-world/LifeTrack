import { describe, it, expect } from 'vitest';
import { NEGATIVE_PATTERNS, detectNegativePatterns, detectPatternCount, patternTrend } from '../psychoanalysis';
import type { CheckIn, Note, UrgeEntry } from '../types';

describe('psychoanalysis — pattern library', () => {
  it('contains evidence-based patterns with sources and counters', () => {
    expect(NEGATIVE_PATTERNS.length).toBeGreaterThanOrEqual(10);
    for (const p of NEGATIVE_PATTERNS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.source).toBeTruthy();
      expect(p.counter).toBeTruthy();
      expect(p.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('psychoanalysis — local detection (zero-cloud)', () => {
  it('detects catastrophizing from a check-in note', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-08-01', completed: true, notes: ['si j\'échoue tout est foutu'] },
    ];
    const hits = detectNegativePatterns(checkIns, [], []);
    const cat = hits.find((h) => h.pattern.id === 'catastrophizing');
    expect(cat).toBeDefined();
    expect(cat?.sample).toContain('foutu');
  });

  it('detects self-sabotage from a standalone note', () => {
    const notes: Note[] = [
      { id: 'n1', habitId: '', content: 'Je me sabote toujours avant les deadlines', createdAt: '2026-08-01T00:00:00Z' },
    ];
    const hits = detectNegativePatterns([], notes, []);
    expect(hits.some((h) => h.pattern.id === 'self_sabotage')).toBe(true);
  });

  it('detects impostor syndrome from an urge reflection', () => {
    const urges: UrgeEntry[] = [
      { id: 'u1', type: 'procrastination', intensity: 7, startTime: '2026-08-01T09:00:00Z', outcome: 'surfed', note: 'Je ne mérite pas ce poste' },
    ];
    const hits = detectNegativePatterns([], [], urges);
    expect(hits.some((h) => h.pattern.id === 'impostor_syndrome')).toBe(true);
  });

  it('returns nothing when the user writes nothing negative', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-08-01', completed: true, notes: ['méditation faite, super session'] },
    ];
    const hits = detectNegativePatterns(checkIns, [], []);
    expect(hits).toHaveLength(0);
    expect(detectPatternCount(checkIns, [], [])).toBe(0);
  });

  it('normalizes accents so French keywords match', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-08-01', completed: true, notes: ['Je devrais être parfait, c\'est de ma faute'] },
    ];
    const hits = detectNegativePatterns(checkIns, [], []);
    // "je devrais" and "c'est de ma faute" both normalize correctly
    expect(hits.some((h) => h.pattern.id === 'should_statements')).toBe(true);
    expect(hits.some((h) => h.pattern.id === 'excessive_guilt')).toBe(true);
  });

  it('counts occurrences across multiple snippets', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-08-01', completed: true, notes: ['jamais je n\'y arrive', 'tout est foutu'] },
    ];
    const hits = detectNegativePatterns(checkIns, [], []);
    const over = hits.find((h) => h.pattern.id === 'overgeneralization');
    expect(over).toBeDefined();
    expect(over!.count).toBeGreaterThanOrEqual(1);
  });
});

describe('psychoanalysis — patternTrend (psychological evolution)', () => {
  it('returns one bucket per week, oldest first, with totals', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-07-01', completed: true, notes: ['si j\'échoue tout est foutu'] },
      { habitId: 'h1', date: '2026-07-08', completed: true, notes: ['tout est foutu, je n\'y arriverai jamais'] },
    ];
    const trend = patternTrend(checkIns, [], []);
    expect(trend.length).toBeGreaterThanOrEqual(2);
    expect(trend[0].weekStart <= trend[1].weekStart).toBe(true);
    expect(trend.every((t) => t.total >= 0)).toBe(true);
    // Both weeks include "foutu" → catastrophizing should be present.
    expect(trend.some((t) => t.counts.some((c) => c.patternId === 'catastrophizing'))).toBe(true);
  });

  it('returns empty array when there is no written data', () => {
    expect(patternTrend([], [], [])).toEqual([]);
  });

  it('counts a declining-ish series (recent week lower or equal is allowed)', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-07-01', completed: true, notes: ['tout est foutu', 'je le savais cela finirait mal'] },
      { habitId: 'h1', date: '2026-07-08', completed: true, notes: ['belle session, rien à redire'] },
    ];
    const trend = patternTrend(checkIns, [], []);
    expect(trend.length).toBeGreaterThanOrEqual(2);
    const last = trend[trend.length - 1];
    // The recent, positive week should carry few or no pattern hits.
    expect(last.total).toBeLessThanOrEqual(trend[0].total);
  });

  it('labels weeks with a short French month label', () => {
    const checkIns: CheckIn[] = [
      { habitId: 'h1', date: '2026-07-01', completed: true, notes: ['mauvaise passe, tout est foutu'] },
    ];
    const trend = patternTrend(checkIns, [], []);
    expect(trend[0].label).toMatch(/^\d{2} /);
  });
});
