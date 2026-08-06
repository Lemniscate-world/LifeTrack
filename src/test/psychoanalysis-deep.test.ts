import { describe, it, expect } from 'vitest';
import { patternMoodImpact, suggestedQuestions } from '../psychoanalysis';
import type { CheckIn } from '../types';

function note(date: string, content: string): CheckIn {
  return { habitId: 'h1', date, completed: true, notes: [content] };
}

const HAPPY_TX = ['Je medite ce matin et tout est tranquille', 'La jolie balade de dimanche, je suis serein'];

describe('patternMoodImpact', () => {
  it('flags a lower impact when days with the pattern have lower mood', () => {
    const bad: CheckIn[] = [
      note('2026-01-05', 'Tout est foutu, je vais echouer'),
      note('2026-01-06', 'Horrible, c\'est la fin pour moi'),
      note('2026-01-07', 'Si je rate je suis ruine'),
    ];
    const good: CheckIn[] = HAPPY_TX.map((t, i) =>
      note(i === 0 ? '2026-01-10' : '2026-01-11', t),
    );
    const checkIns = [...bad, ...good];
    const moods: Record<string, string> = {
      '2026-01-05': 'bad', '2026-01-06': 'bad', '2026-01-07': 'bad',
      '2026-01-10': 'great', '2026-01-11': 'amazing', '2026-01-08': 'okay',
    };
    const impacts = patternMoodImpact(checkIns, [], [], moods);
    expect(impacts.length).toBeGreaterThan(0);
    const top = impacts[0];
    expect(top.delta).toBeLessThan(0); // pattern days → lower mood
    expect(top.significant).toBe(true);
    expect(top.hasDays).toBeGreaterThan(0);
  });

  it('returns an empty list when there is no mood data', () => {
    const checkIns = [note('2026-01-05', 'Je suis toujours foutu')];
    expect(patternMoodImpact(checkIns, [], [], {})).toEqual([]);
  });
});

describe('suggestedQuestions', () => {
  it('is empty when the user has written nothing', () => {
    expect(suggestedQuestions([], [], [])).toEqual([]);
  });

  it('proposes questions for the detected patterns plus a general opener', () => {
    const checkIns = [
      note('2026-01-05', 'Je suis une catastrophe, tout est fini'),
      note('2026-01-06', 'je devrais toujours reussir mais rien ne marche'),
    ];
    const qs = suggestedQuestions(checkIns, [], []);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.some((q) => q.patternId !== null)).toBe(true);
    expect(qs[0].question.length).toBeGreaterThan(0);
  });

  it('is deterministic and capped at 4', () => {
    const checkIns: CheckIn[] = [];
    for (let d = 1; d <= 20; d++) {
      checkIns.push(note(`2026-02-${String(d).padStart(2, '0')}`, 'tout est foutu, je remets encore, je suis nul'));
    }
    const a = suggestedQuestions(checkIns, [], []);
    const b = suggestedQuestions(checkIns, [], []);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(4);
  });
});