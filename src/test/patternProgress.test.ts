import { describe, it, expect } from 'vitest';
import {
  STEPS,
  MAX_STEP,
  dayKey,
  questionForStep,
  advanceTracks,
  hasTrackablePatterns,
  averageProgress,
  bucketTracks,
  type PatternTrack,
} from '../patternProgress';
import type { NegativePattern, PatternHit } from '../psychoanalysis';

const PATTERN: NegativePattern = {
  id: 'test-pattern',
  name: 'Test Pattern',
  emoji: '🧪',
  description: 'desc',
  source: 'src',
  counter: 'contre-x',
  keywords: ['test'],
};

function make(id: string = PATTERN.id): PatternHit[] {
  return [{ pattern: { ...PATTERN, id }, count: 1, sample: 'x' }];
}

describe('dayKey', () => {
  it('formats YYYY-MM-DD padded', () => {
    expect(dayKey(new Date(2026, 6, 5))).toBe('2026-07-05');
  });
});

describe('STEPS / MAX_STEP', () => {
  it('has five stations drifting from identify to transcend', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['identify', 'understand', 'counter', 'integrate', 'transcend']);
    expect(MAX_STEP).toBe(STEPS.length - 1);
  });
});

describe('questionForStep', () => {
  it('uses the default (step 0) question for a brand-new pattern', () => {
    expect(questionForStep(PATTERN, 0)).toContain(PATTERN.name);
    expect(questionForStep(PATTERN, 0)).not.toContain(PATTERN.counter);
  });

  it('footprints the counter at the counter step', () => {
    const q = questionForStep(PATTERN, 2);
    expect(q).toContain(PATTERN.counter);
    expect(q).toContain(PATTERN.emoji);
  });

  it('clamps out-of-range steps', () => {
    expect(() => questionForStep(PATTERN, -5)).not.toThrow();
    expect(() => questionForStep(PATTERN, 99)).not.toThrow();
    expect(questionForStep(PATTERN, -5)).toBe(questionForStep(PATTERN, 0));
  });
});

describe('advanceTracks', () => {
  it('creates a track at step 0 for a brand-new pattern', () => {
    const result = advanceTracks([], make(), new Date(2026, 6, 5, 10));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ patternId: 'test-pattern', step: 0, seenCount: 1, lastSeen: '2026-07-05' });
  });

  it('is pure: does not mutate the input array', () => {
    const input: PatternTrack[] = [];
    advanceTracks(input, make(), new Date(2026, 6, 5, 10));
    expect(input).toHaveLength(0);
  });

  it('advances one step on a brand-new day, capped at MAX_STEP', () => {
    const track: PatternTrack = { patternId: 'test-pattern', step: 1, seenCount: 1, lastSeen: '2026-07-04', createdAt: 'c' };
    const next = advanceTracks([track], make(), new Date(2026, 6, 5, 10));
    expect(next[0].step).toBe(2);
    expect(next[0].seenCount).toBe(2);
    expect(next[0].lastSeen).toBe('2026-07-05');

    const maxed: PatternTrack = { ...track, step: MAX_STEP, lastSeen: '2026-07-04' };
    const capped = advanceTracks([maxed], make(), new Date(2026, 6, 5, 10));
    expect(capped[0].step).toBe(MAX_STEP);
    expect(capped[0].seenCount).toBe(2);
  });

  it('does NOT advance when seen again the same day, but counts the mention', () => {
    const track: PatternTrack = { patternId: 'test-pattern', step: 1, seenCount: 1, lastSeen: '2026-07-05', createdAt: 'c' };
    const next = advanceTracks([track], make(), new Date(2026, 6, 5, 10));
    expect(next[0].step).toBe(1);
    expect(next[0].seenCount).toBe(2);
  });

  it('touches only the patterns present in hits', () => {
    const a: PatternTrack = { patternId: 'a', step: 0, seenCount: 1, lastSeen: '2026-07-04', createdAt: 'c' };
    const b: PatternTrack = { patternId: 'b', step: 0, seenCount: 1, lastSeen: '2026-07-04', createdAt: 'c' };
    const next = advanceTracks([a, b], make('a'), new Date(2026, 6, 5, 10));
    expect(next.find((t) => t.patternId === 'a')?.step).toBe(1);
    expect(next.find((t) => t.patternId === 'b')?.step).toBe(0);
  });
});

describe('hasTrackablePatterns / averageProgress / bucketTracks', () => {
  it('reports whether any pattern is tracked', () => {
    expect(hasTrackablePatterns([])).toBe(false);
    expect(hasTrackablePatterns([{ patternId: 'x', step: 0, seenCount: 1, lastSeen: 'd', createdAt: 'c' }])).toBe(true);
  });

  it('computes average progress 0..1', () => {
    expect(averageProgress([])).toBe(0);
    expect(averageProgress([{ patternId: 'x', step: MAX_STEP, seenCount: 1, lastSeen: 'd', createdAt: 'c' }])).toBe(1);
  });

  it('buckets fresh / working / mastered', () => {
    const tracks: PatternTrack[] = [
      { patternId: 'a', step: 1, seenCount: 1, lastSeen: 'd', createdAt: 'c' },
      { patternId: 'b', step: 3, seenCount: 1, lastSeen: 'd', createdAt: 'c' },
      { patternId: 'c', step: MAX_STEP, seenCount: 1, lastSeen: 'd', createdAt: 'c' },
    ];
    const b = bucketTracks(tracks);
    expect(b.fresh).toBe(1);
    expect(b.working).toBe(1);
    expect(b.mastered).toBe(1);
    expect(b.total).toBe(3);
  });
});