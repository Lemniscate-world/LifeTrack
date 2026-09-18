// Anti-doublons chaos : migration idempotente + dedupe par label (Vitest).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore, getChaosDimensions, addChaosTrigger,
  normalizeTriggerLabel, dedupeChaosTriggers,
} from '../store';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('normalizeTriggerLabel', () => {
  it('ignore casse et espaces', () => {
    expect(normalizeTriggerLabel('  No   LLM ')).toBe('no llm');
  });
});

describe('migration Startup idempotente', () => {
  it('seed une fois avec un id fixe, jamais de doublon', () => {
    const first = getChaosDimensions().find((d) => d.id === 'startup')!;
    expect(first.triggers.filter((t) => normalizeTriggerLabel(t.label).includes('no llm'))).toHaveLength(1);
    expect(first.triggers[0].id).toBe('startup-no-llm-55');
    const second = getChaosDimensions().find((d) => d.id === 'startup')!;
    expect(second.triggers.filter((t) => normalizeTriggerLabel(t.label).includes('no llm'))).toHaveLength(1);
  });

  it('nettoie un doublon legacy (meme label, id different)', () => {
    const dims = getChaosDimensions();
    const startup = dims.find((d) => d.id === 'startup')!;
    startup.triggers.push({ id: 'vieux-id-aleatoire', label: 'no llm OR MODELS with 55+ intelligence', weight: 75, active: true });
    const cleaned = getChaosDimensions().find((d) => d.id === 'startup')!;
    expect(cleaned.triggers.filter((t) => normalizeTriggerLabel(t.label).includes('no llm'))).toHaveLength(1);
  });
});

describe('addChaosTrigger', () => {
  it('refuse un doublon de label et retourne existant', () => {
    getChaosDimensions(); // amorce les dimensions par defaut comme l'UI
    const a = addChaosTrigger('social', 'Ne pas scroller', 20)!;
    const b = addChaosTrigger('social', '  NE PAS   scroller ', 50)!;
    expect(b.id).toBe(a.id);
    const dims = getChaosDimensions().find((d) => d.id === 'social')!;
    expect(dims.triggers.filter((t) => normalizeTriggerLabel(t.label) === 'ne pas scroller')).toHaveLength(1);
  });

  it('accepte un label different', () => {
    getChaosDimensions(); // amorce les dimensions par defaut comme l'UI
    addChaosTrigger('social', 'Ne pas scroller', 20);
    addChaosTrigger('social', 'Appeler maman', 10);
    expect(getChaosDimensions().find((d) => d.id === 'social')!.triggers).toHaveLength(2);
  });
});

describe('dedupeChaosTriggers', () => {
  it('garde le premier et preserve le reste', () => {
    const out = dedupeChaosTriggers([
      { id: 'a', label: 'X' },
      { id: 'b', label: 'x ' },
      { id: 'c', label: 'Y' },
    ]);
    expect(out.map((t) => t.id)).toEqual(['a', 'c']);
  });
});
