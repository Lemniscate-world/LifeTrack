// src/test/protocols.test.ts
import { describe, it, expect } from 'vitest';
import { SEED_PROTOCOLS, DOMAIN_LABEL, protocolKeywordHits } from '../protocols';

describe('protocols knowledge library', () => {
  it('has a substantial curated seed library', () => {
    expect(SEED_PROTOCOLS.length).toBeGreaterThanOrEqual(15);
  });

  it('every protocol is structurally complete and evidence-graded', () => {
    for (const p of SEED_PROTOCOLS) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.claim).toBeTruthy();
      expect(p.protocol).toBeTruthy();
      expect(['A', 'B', 'C']).toContain(p.evidenceLevel);
      expect(p.domain in DOMAIN_LABEL).toBe(true);
      expect(p.source).toBeTruthy();
      expect(Array.isArray(p.keywords)).toBe(true);
    }
  });

  it('has no duplicate ids', () => {
    const ids = SEED_PROTOCOLS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the key behavioral domains', () => {
    const domains = new Set(SEED_PROTOCOLS.map((p) => p.domain));
    for (const d of ['sleep', 'focus', 'energy', 'mood', 'training', 'nutrition', 'stress', 'social', 'cognitive'] as const) {
      expect(domains.has(d)).toBe(true);
    }
  });

  it('counts keyword hits in free text', () => {
    const sunlight = SEED_PROTOCOLS.find((p) => p.id === 'p-sunlight-morning')!;
    const hits = protocolKeywordHits(sunlight, ['Je dois sortir au soleil le matin']);
    expect(hits).toBeGreaterThan(0);
    expect(protocolKeywordHits(sunlight, ['rien à voir ici'])).toBe(0);
  });
});
