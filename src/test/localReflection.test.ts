import { describe, it, expect } from 'vitest';
import { localReflection, LOCAL_REFLECTION_NOTE } from '../localReflection';

describe('localReflection', () => {
  it('returns a structured reflection for any persona', () => {
    for (const p of ['coach', 'sage', 'psychologist', 'strategist', 'robert-greene', 'huberman'] as const) {
      const out = localReflection('J\'ai peur de ne pas être à la hauteur', p);
      expect(out).toContain('J\'ai peur de ne pas être à la hauteur');
      expect(out).toContain('?'); // reframe ends with a question
    }
  });

  it('quotes very short entries honestly', () => {
    const out = localReflection('fatigue', 'coach');
    expect(out).toContain('fatigue');
    expect(out).toContain('Même en peu de mots');
  });

  it('truncates long entries to an excerpt', () => {
    const long = 'a '.repeat(200);
    const out = localReflection(long, 'sage');
    expect(out.length).toBeLessThan(long.length + 200);
    expect(out).toContain('…');
  });

  it('is deterministic for the same input', () => {
    expect(localReflection('x y z', 'coach')).toBe(localReflection('x y z', 'coach'));
  });

  it('mentions the offline nature', () => {
    expect(localReflection('test', 'huberman')).toContain('hors-ligne');
    expect(LOCAL_REFLECTION_NOTE.length).toBeGreaterThan(0);
  });
});
