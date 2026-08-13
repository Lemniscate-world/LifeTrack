// src/test/ingest.test.ts
import { describe, it, expect } from 'vitest';
import type { Protocol } from '../types';
import {
  splitClaims,
  classifyDomain,
  classifyEvidence,
  extractProtocolsFromText,
  mergeProtocols,
  parseIngestAi,
  buildProtocolsFromAiPayload,
} from '../ingest';

describe('ingest pipeline', () => {
  it('splits bullet and numbered claims', () => {
    const raw = 'Première idée importante.\n- Deuxième point clé.\n3. Troisième élément.';
    const claims = splitClaims(raw);
    expect(claims).toEqual(['Première idée importante.', 'Deuxième point clé.', 'Troisième élément.']);
  });

  it('classifies domain from keywords', () => {
    expect(classifyDomain('améliore mon sommeil et mon réveil')).toBe('sleep');
    expect(classifyDomain('plus de concentration et de focus')).toBe('focus');
  });

  it('grades evidence honestly: strong language → A, hedged → C, else B', () => {
    expect(classifyEvidence('a randomized controlled trial proved that...')).toBe('A');
    expect(classifyEvidence('je pense que ça marche peut-être')).toBe('C');
    expect(classifyEvidence('many experts recommend a protocol')).toBe('B');
  });

  it('extracts protocols from text deterministically without AI', () => {
    const raw = 'Une étude randomisée montre que la lumière du matin améliore le sommeil.\n- La caféine le soir nuit au repos.';
    const out = extractProtocolsFromText(raw, 'Source Test');
    expect(out.length).toBe(2);
    expect(out[0].domain).toBe('sleep');
    expect(out[0].evidenceLevel).toBe('A');
    expect(out[0].source).toBe('Source Test');
  });

  it('dedupes merged protocols by title', () => {
    const existing: Protocol[] = [{ id: 'a', title: 'Douche froide', claim: 'x', source: 's', domain: 'energy', evidenceLevel: 'C', protocol: 'p', keywords: [] }];
    const added: Protocol[] = [
      { id: 'b', title: 'Douche froide', claim: 'x', source: 's', domain: 'energy', evidenceLevel: 'C', protocol: 'p', keywords: [] },
      { id: 'c', title: 'Lumière matin', claim: 'y', source: 's', domain: 'sleep', evidenceLevel: 'B', protocol: 'p', keywords: [] },
    ];
    const merged = mergeProtocols(existing, added);
    expect(merged).toHaveLength(2);
  });

  it('parses AI-assisted structured output (fence-tolerant)', () => {
    const raw = '```json\n{"summary":"Respiration lente","top_priorities":[{"detail":"5 min de respiration cohérente","why":"études montrent que c\'est efficace","action":"faire chaque matin"}]}\n```';
    const parsed = parseIngestAi(raw);
    expect(parsed).not.toBeNull();
    const claims = parsed!.claims ?? [];
    expect(claims).toHaveLength(1);
    expect(claims[0]!.domain).toBe('stress');
    expect(claims[0]!.evidence).toBe('A');
  });

  it('returns null for unusable AI output', () => {
    expect(parseIngestAi('not json at all')).toBeNull();
  });

  it('builds protocols from an AI payload and skips too-short claims', () => {
    const protocols = buildProtocolsFromAiPayload({
      title: 'Respiration',
      claims: [
        { claim: '5 minutes de respiration cohérente le matin réduisent le stress perçu.', evidence: 'A', domain: 'stress', protocol: '5 min/jour d\'expiration longue' },
        { claim: 'ok', evidence: 'A', domain: 'stress', protocol: 'x' }, // too short → skipped
      ],
    }, 'Source IA');
    expect(protocols).toHaveLength(1);
    expect(protocols[0].evidenceLevel).toBe('A');
    expect(protocols[0].domain).toBe('stress');
    expect(protocols[0].protocol).toContain('5 min/jour');
  });

  it('builds an empty array from a null payload', () => {
    expect(buildProtocolsFromAiPayload(null, 'x')).toEqual([]);
  });
});
