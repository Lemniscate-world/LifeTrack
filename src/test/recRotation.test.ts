// src/test/recRotation.test.ts
import { describe, it, expect } from 'vitest';
import type { Recommendation } from '../recommendations';
import { rotateRecommendations, recKey } from '../recRotation';

const rec = (kind: string, title: string, habitIds: string[] = []): Recommendation => ({
  kind: kind as Recommendation['kind'],
  title,
  detail: 'd',
  habitIds,
  strength: 50,
});

describe('rotateRecommendations', () => {
  const recs = [rec('MISS_PATTERN', 'A'), rec('NEGLECTED', 'B'), rec('TREND', 'C')];

  it('drops set-aside recommendations', () => {
    const key = recKey(recs[0]);
    const visible = rotateRecommendations(recs, [key], new Date(2026, 0, 1));
    expect(visible.map((r) => r.title)).not.toContain('A');
    expect(visible.length).toBe(2);
  });

  it('rotates the order deterministically by day', () => {
    const day1 = rotateRecommendations(recs, [], new Date(2026, 0, 1));
    const day2 = rotateRecommendations(recs, [], new Date(2026, 0, 2));
    // Same multiset, but the headline differs day-to-day.
    expect([...day1].sort((a, b) => a.title.localeCompare(b.title)).map((r) => r.title))
      .toEqual([...day2].sort((a, b) => a.title.localeCompare(b.title)).map((r) => r.title));
    expect(day1[0].title).not.toBe(day2[0].title);
  });

  it('caps the burst', () => {
    expect(rotateRecommendations(recs, [], new Date(2026, 0, 1), 2).length).toBe(2);
  });

  it('returns an empty list when everything is set aside', () => {
    const all = recs.map(recKey);
    expect(rotateRecommendations(recs, all, new Date(2026, 0, 1))).toEqual([]);
  });

  it('keeps a single rec stable', () => {
    const one = rotateRecommendations([recs[0]], [], new Date(2026, 0, 1));
    expect(one[0].title).toBe('A');
  });
});
