// src/test/emotionForecast.test.ts
import { describe, it, expect } from 'vitest';
import {
  fitDecay,
  fitDecayMood,
  detectRelapseIndex,
  priorLambdaFor,
  pooledPersonalLambda,
  forecastEmotion,
  findHelpfulNotes,
  learnedHalfLives,
  compareEmotionalEvents,
  capacityTrendByEmotion,
  fitPerEmotion,
  temporalPatterns,
  buildTherapistReport,
  checkStreak,
  buildEmotionalMemory,
  detectEmotionsFromText,
  parseActionPlan,
  suggestCoping,
  tagCoping,
  biExpValue,
  biExpCrossingDays,
  perEmotionSeries,
  EMOTION_PRIOR_HALFLIFE_DAYS,
} from '../emotionForecast';

function synthDecay(startIso: string, intensities: number[]) {
  return intensities.map((intensity, i) => {
    const d = new Date(startIso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), intensity };
  });
}

describe('fitDecay', () => {
  it('recovers λ from a clean exponential series', () => {
    // I(t) = 1 + 8*exp(-0.2t), sampled daily
    const pts = Array.from({ length: 10 }, (_, i) => ({
      t: i,
      intensity: 1 + 8 * Math.exp(-0.2 * i),
    }));
    const fit = fitDecay(pts);
    expect(fit.lambda).toBeCloseTo(0.2, 2);
    expect(fit.rSquared!).toBeGreaterThan(0.99);
    expect(fit.seLambda).not.toBeNull();
  });

  it('returns λ≈0 for a flat series', () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ t: i, intensity: 5 }));
    const fit = fitDecay(pts);
    expect(Math.abs(fit.lambda)).toBeLessThan(1e-6);
  });

  it('handles a single point without crashing', () => {
    const fit = fitDecay([{ t: 0, intensity: 7 }]);
    expect(fit.n).toBe(1);
    expect(fit.seLambda).toBeNull();
  });
});

describe('priorLambdaFor', () => {
  it('uses the slowest-decaying emotion as dominant', () => {
    const slow = priorLambdaFor(['Tristesse']);
    const fast = priorLambdaFor(['Dégoût']);
    expect(slow).toBeLessThan(fast); // smaller λ = slower decay
    expect(slow).toBeCloseTo(Math.LN2 / EMOTION_PRIOR_HALFLIFE_DAYS['Tristesse'], 6);
  });

  it('falls back to the default prior for unknown emotions', () => {
    expect(priorLambdaFor(['Xyz'])).toBeCloseTo(priorLambdaFor([]), 10);
  });
});

describe('detectRelapseIndex', () => {
  it('flags a sharp rebound after decline', () => {
    const pts = [
      { t: 0, intensity: 9 },
      { t: 1, intensity: 7 },
      { t: 2, intensity: 5 },
      { t: 3, intensity: 4 },
      { t: 4, intensity: 8 }, // relapse jump
    ];
    expect(detectRelapseIndex(pts)).toBe(4);
  });

  it('returns 0 for a monotonic decline', () => {
    const pts = [9, 7, 6, 5, 4, 3].map((intensity, t) => ({ t, intensity }));
    expect(detectRelapseIndex(pts)).toBe(0);
  });

  it('returns 0 with too few points', () => {
    expect(detectRelapseIndex([{ t: 0, intensity: 8 }, { t: 1, intensity: 6 }])).toBe(0);
  });
});

describe('pooledPersonalLambda', () => {
  it('pools λ from other events sharing an emotion', () => {
    const mk = (k: number) => ({
      emotions: ['Colère'],
      checks: [9, 7, 5, 4, 3].map((intensity, i) => ({
        date: `2026-01-${String(1 + i + k * 10).padStart(2, '0')}`,
        intensity,
      })),
    });
    const pooled = pooledPersonalLambda(['Colère'], [mk(0), mk(1)]);
    expect(pooled).not.toBeNull();
    expect(pooled!.lambda).toBeGreaterThan(0);
    expect(pooled!.weight).toBeGreaterThan(0);
  });

  it('returns null when no emotion overlaps', () => {
    const pooled = pooledPersonalLambda(['Joie' as never], [{
      emotions: ['Colère'],
      checks: synthDecay('2026-01-01', [9, 7, 5, 4]),
    }]);
    expect(pooled).toBeNull();
  });
});

describe('forecastEmotion', () => {
  it('cold start: prior-only forecast with low confidence', () => {
    const f = forecastEmotion([{ date: '2026-09-01', intensity: 8 }], ['Tristesse']);
    expect(f.method).toBe('prior');
    expect(f.confidence).toBe('low');
    expect(f.daysRemaining).not.toBeNull();
    expect(f.daysRemaining!).toBeGreaterThan(0);
    expect(f.loDays).not.toBeNull();
    expect(f.hiDays).not.toBeNull();
    expect(f.loDays!).toBeLessThanOrEqual(f.hiDays!);
  });

  it('estimates remaining days from a decaying series', () => {
    const checks = synthDecay('2026-08-20', [9, 8, 7, 6, 5, 5, 4, 4]);
    const f = forecastEmotion(checks, ['Colère']);
    expect(f.daysRemaining).not.toBeNull();
    expect(f.method).toBe('blended');
    expect(f.confidence).not.toBe('low');
    expect(f.loDays!).toBeLessThanOrEqual(f.daysRemaining!);
    expect(f.daysRemaining!).toBeLessThanOrEqual(f.hiDays!);
  });

  it('returns 0 days when already below threshold', () => {
    const checks = synthDecay('2026-08-20', [8, 5, 3, 2, 2, 1, 1]);
    const f = forecastEmotion(checks, ['Honte']);
    expect(f.daysRemaining).toBe(0);
  });

  it('flags relapse and refits from the break', () => {
    const checks = synthDecay('2026-08-20', [9, 7, 5, 4, 8, 7]);
    const f = forecastEmotion(checks, ['Anxiété']);
    expect(f.relapsed).toBe(true);
    expect(f.confidence).toBe('low');
  });

  it('blends personal history into the posterior', () => {
    const history = [{
      emotions: ['Tristesse'],
      checks: synthDecay('2026-06-01', [9, 7, 6, 5, 4, 3]),
    }];
    const checks = synthDecay('2026-08-20', [8, 7, 6]);
    const without = forecastEmotion(checks, ['Tristesse']);
    const withHist = forecastEmotion(checks, ['Tristesse'], { personalHistory: history });
    // History of clean decay should pull the estimate toward faster resolution
    expect(withHist.daysRemaining).not.toBeNull();
    expect(without.daysRemaining).not.toBeNull();
    expect(withHist.lambdaPerDay).not.toBe(without.lambdaPerDay);
  });

  it('handles empty checks gracefully', () => {
    const f = forecastEmotion([], ['Peur']);
    expect(f.method).toBe('prior');
    expect(f.confidence).toBe('low');
  });

  it('uses same-day mood as a covariate when available', () => {
    const checks = synthDecay('2026-08-20', [9, 8, 7, 6, 5, 5, 4, 4]);
    const moods: Record<string, string> = {};
    checks.forEach((c, i) => { moods[c.date] = i % 2 === 0 ? 'bad' : 'okay'; });
    const f = forecastEmotion(checks, ['Colère'], { moods });
    expect(f.moodAdjusted).toBe(true);
    expect(f.moodCoef).not.toBeNull();
    expect(f.daysRemaining).not.toBeNull();
  });

  it('ignores mood adjustment when mood never varies', () => {
    const checks = synthDecay('2026-08-20', [9, 8, 7, 6, 5, 5, 4, 4]);
    const moods: Record<string, string> = {};
    checks.forEach((c) => { moods[c.date] = 'okay'; });
    const f = forecastEmotion(checks, ['Colère'], { moods });
    expect(f.moodAdjusted).toBe(false);
    expect(f.daysRemaining).not.toBeNull();
  });
});

describe('fitDecayMood', () => {
  it('recovers λ and mood coefficient from synthetic data', () => {
    // y = 2 - 0.25t - 0.3m on the log scale
    const pts = Array.from({ length: 12 }, (_, i) => ({
      t: i,
      intensity: 1 + Math.exp(2 - 0.25 * i - 0.3 * (i % 2 === 0 ? -1 : 1)),
      mood: i % 2 === 0 ? -1 : 1,
    }));
    const f = fitDecayMood(pts);
    expect(f).not.toBeNull();
    expect(f!.lambda).toBeCloseTo(0.25, 1);
    expect(f!.moodCoef).toBeCloseTo(-0.3, 1);
    expect(f!.rSquared!).toBeGreaterThan(0.95);
  });

  it('returns null when mood never varies', () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ t: i, intensity: 8 - i, mood: 0 }));
    expect(fitDecayMood(pts)).toBeNull();
  });

  it('returns null with too few points', () => {
    const pts = [{ t: 0, intensity: 8, mood: 1 }, { t: 1, intensity: 6, mood: -1 }];
    expect(fitDecayMood(pts)).toBeNull();
  });
});

describe('findHelpfulNotes', () => {
  it('surfaces notes that precede a drop ≥ 2', () => {
    const checks = [
      { date: '2026-08-20', intensity: 9, note: 'marche 20 min' },
      { date: '2026-08-21', intensity: 6 },
      { date: '2026-08-22', intensity: 6, note: 'rien de spécial' },
      { date: '2026-08-23', intensity: 5 },
    ];
    const out = findHelpfulNotes(checks);
    expect(out).toHaveLength(1);
    expect(out[0]!.note).toBe('marche 20 min');
    expect(out[0]!.drop).toBe(3);
  });

  it('ignores notes without a following drop', () => {
    const checks = [
      { date: '2026-08-20', intensity: 6, note: 'café' },
      { date: '2026-08-21', intensity: 6 },
    ];
    expect(findHelpfulNotes(checks)).toHaveLength(0);
  });
});

describe('learnedHalfLives', () => {
  it('learns per-emotion median half-lives from past events', () => {
    const mk = (emotions: string[], start: string, intensities: number[]) => ({
      emotions,
      checks: intensities.map((intensity, i) => {
        const d = new Date(start + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        return { date: d.toISOString().slice(0, 10), intensity };
      }),
    });
    const out = learnedHalfLives([
      mk(['Colère'], '2026-05-01', [9, 7, 5, 4, 3, 2]),
      mk(['Colère'], '2026-06-01', [8, 6, 5, 4, 3, 2]),
      mk(['Tristesse'], '2026-05-01', [9, 8, 8, 7]),
    ]);
    const anger = out.find((l) => l.emotion === 'Colère');
    expect(anger).toBeDefined();
    expect(anger!.events).toBe(2);
    expect(anger!.halfLifeDays).toBeGreaterThan(0);
    expect(anger!.halfLifeDays).toBeLessThan(30);
  });

  it('returns empty when nothing is learnable', () => {
    expect(learnedHalfLives([])).toEqual([]);
    expect(learnedHalfLives([{ emotions: ['Peur'], checks: [{ date: '2026-08-20', intensity: 8 }] }])).toEqual([]);
  });
});

describe('compareEmotionalEvents', () => {
  it('compares a fast-resolving event against a slow past one', () => {
    const current = {
      emotions: ['Colère'],
      checks: synthDecay('2026-08-20', [8, 6, 4, 3, 2, 2]),
    };
    const past = {
      emotions: ['Colère', 'Frustration'],
      checks: synthDecay('2026-06-01', [9, 8, 8, 7, 7, 6]),
    };
    const c = compareEmotionalEvents(current, past);
    expect(c).not.toBeNull();
    expect(c!.sharedEmotions).toEqual(['Colère']);
    expect(c!.currentPeak).toBe(8);
    expect(c!.pastPeak).toBe(9);
    expect(c!.verdict).toBe('faster');
    expect(c!.halfLifeDeltaPct!).toBeGreaterThan(0);
  });

  it('returns null without a shared emotion', () => {
    const c = compareEmotionalEvents(
      { emotions: ['Joie' as never], checks: synthDecay('2026-08-20', [8, 6, 4]) },
      { emotions: ['Colère'], checks: synthDecay('2026-06-01', [8, 6, 4]) },
    );
    expect(c).toBeNull();
  });

  it('reports unknown when neither side has a fittable decay', () => {
    const c = compareEmotionalEvents(
      { emotions: ['Peur'], checks: [{ date: '2026-08-20', intensity: 5 }] },
      { emotions: ['Peur'], checks: [{ date: '2026-06-01', intensity: 6 }] },
    );
    expect(c).not.toBeNull();
    expect(c!.verdict).toBe('unknown');
  });
});

describe('capacityTrendByEmotion', () => {
  it('detects growing capacity when half-lives shrink', () => {
    const mk = (start: string, intensities: number[]) => ({
      emotions: ['Tristesse'],
      checks: intensities.map((intensity, i) => {
        const d = new Date(start + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        return { date: d.toISOString().slice(0, 10), intensity };
      }),
    });
    const out = capacityTrendByEmotion([
      mk('2026-05-01', [9, 8, 8, 7, 7, 6, 6]),
      mk('2026-07-01', [9, 6, 4, 3, 2, 2]),
    ]);
    const t = out.find((x) => x.emotion === 'Tristesse');
    expect(t).toBeDefined();
    expect(t!.direction).toBe('growing');
    expect(t!.changePct!).toBeLessThan(0);
    expect(t!.events).toBe(2);
  });

  it('marks single-event emotions as unknown', () => {
    const out = capacityTrendByEmotion([{
      emotions: ['Peur'],
      checks: [{ date: '2026-08-20', intensity: 8 }, { date: '2026-08-21', intensity: 7 }, { date: '2026-08-22', intensity: 6 }, { date: '2026-08-23', intensity: 5 }],
    }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.direction).toBe('unknown');
  });
});

describe('robust fit (Theil-Sen)', () => {
  it('resists a single mislogged spike', () => {
    // Clean decay 9,8,7,6,5,4 with one bogus 10/10 spike in the middle.
    const pts = [9, 8, 7, 10, 5, 4, 3].map((intensity, t) => ({ t, intensity }));
    const fit = fitDecay(pts);
    // True λ ≈ 0.17; OLS would be dragged toward ~0.05 by the spike.
    expect(fit.lambda).toBeGreaterThan(0.1);
    expect(fit.lambda).toBeLessThan(0.3);
  });
});

describe('gap segmentation', () => {
  it('restarts the fit after a >10-day hole', () => {
    const early = synthDecay('2026-06-01', [9, 8, 7]);
    const late = synthDecay('2026-08-20', [8, 6, 4]);
    const f = forecastEmotion([...early, ...late], ['Tristesse']);
    expect(f.fitStartDate).toBe('2026-08-20');
    expect(f.daysRemaining).not.toBeNull();
  });
});

describe('projection cap', () => {
  it('never predicts beyond 365 days', () => {
    // Flat-ish series → near-zero λ → would project to absurd horizons.
    const checks = synthDecay('2026-08-20', [9, 9, 9, 9, 9, 8.9, 8.9]);
    const f = forecastEmotion(checks, ['Méfiance']);
    expect(f.daysRemaining === null || f.daysRemaining <= 365).toBe(true);
    expect(f.loDays === null || f.loDays <= 365).toBe(true);
    expect(f.hiDays === null || f.hiDays <= 365).toBe(true);
  });
});

describe('fitPerEmotion', () => {
  it('fits each emotion separately from per-emotion intensities', () => {
    const checks = synthDecay('2026-08-20', [8, 7, 6, 5, 4]).map((c, i) => ({
      ...c,
      intensities: { Honte: 9 - i, Joie: 3 } as Record<string, number>,
    }));
    const out = fitPerEmotion(checks, ['Honte', 'Joie', 'Peur']);
    const honte = out.find((p) => p.emotion === 'Honte')!;
    expect(honte.n).toBe(5);
    expect(honte.halfLifeDays).not.toBeNull();
    expect(honte.daysRemaining).not.toBeNull();
    // 'Joie' is flat → no decay → null half-life.
    expect(out.find((p) => p.emotion === 'Joie')!.halfLifeDays).toBeNull();
    // 'Peur' has no values → n=0.
    expect(out.find((p) => p.emotion === 'Peur')!.n).toBe(0);
  });
});

describe('perEmotionSeries', () => {
  const checks: { date: string; intensity: number; intensities?: Record<string, number> }[] = [
    { date: '2026-09-04', intensity: 9, intensities: { Honte: 9, Colère: 7 } },
    { date: '2026-09-05', intensity: 9 }, // no per-emotion values
    { date: '2026-09-06', intensity: 7, intensities: { Honte: 6 } },
  ];

  it('extracts one trajectory per emotion, sorted by date', () => {
    const s = perEmotionSeries(checks, 'Honte');
    expect(s.map((p) => p.date)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06']);
    expect(s.map((p) => p.value)).toEqual([9, null, 6]);
  });

  it('returns all-null for an emotion never logged per-emotion', () => {
    const s = perEmotionSeries(checks, 'Culpabilité');
    expect(s.every((p) => p.value === null)).toBe(true);
  });

  it('clamps values to 1-10 and ignores non-numbers', () => {
    const s = perEmotionSeries(
      [{ date: '2026-09-04', intensities: { Honte: 99 } }, { date: '2026-09-05', intensities: { Honte: 'x' as unknown as number } }],
      'Honte',
    );
    expect(s.map((p) => p.value)).toEqual([10, null]);
  });

  it('returns empty for no checks', () => {
    expect(perEmotionSeries([], 'Honte')).toEqual([]);
  });
});

describe('temporalPatterns', () => {
  it('finds the peak weekday and hour', () => {
    const checks = [
      // Three Saturday spikes.
      { date: '2026-08-22', intensity: 8, createdAt: '2026-08-22T22:15:00' },
      { date: '2026-08-29', intensity: 9, createdAt: '2026-08-29T23:00:00' },
      { date: '2026-09-05', intensity: 8, createdAt: '2026-09-05T21:30:00' },
      { date: '2026-08-24', intensity: 3, createdAt: '2026-08-24T09:00:00' },
      { date: '2026-08-25', intensity: 2, createdAt: '2026-08-25T10:00:00' },
    ];
    const p = temporalPatterns(checks);
    expect(p.peakDow).toBe(6); // Saturday
    expect(p.peakDowCount).toBe(3);
    expect(p.totalChecks).toBe(5);
  });

  it('stays silent with too few points', () => {
    const p = temporalPatterns([{ date: '2026-08-20', intensity: 8 }]);
    expect(p.peakDow).toBeNull();
    expect(p.peakHour).toBeNull();
  });
});

describe('buildTherapistReport', () => {
  it('produces a readable markdown report', () => {
    const md = buildTherapistReport(
      { title: 'Rejet', situation: 'x', emotions: ['Honte'], createdAt: '2026-09-01T00:00:00Z' },
      [
        { date: '2026-09-01', intensity: 9 },
        { date: '2026-09-02', intensity: 6, note: 'marche' },
        { date: '2026-09-03', intensity: 4 },
      ],
      { daysRemaining: 5, loDays: 3, hiDays: 9, halfLifeDays: 2.5, confidence: 'medium', method: 'blended', relapsed: false },
      [{ date: '2026-09-01', note: 'marche', drop: 3, copingTags: [] }],
      [{ emotion: 'Honte', n: 3, halfLifeDays: 2.2, daysRemaining: 5, rSquared: 0.9 }],
    );
    expect(md).toContain('# Suivi émotionnel — Rejet');
    expect(md).toContain('2026-09-02 : 6/10 — marche');
    expect(md).toContain('≈5 j');
    expect(md).toContain('Honte');
    // Differentiated coping: Honte → auto-compassion + réévaluation interne.
    expect(md).toContain('## Pistes de coping adaptées');
    expect(md).toContain('Auto-compassion');
    expect(md).toContain('Réévaluation interne');
    expect(md).not.toContain('undefined');
  });

  it('suggests outward coping for Humiliation, not inward shame tracks', () => {
    const md = buildTherapistReport(
      { title: 'Moquerie', situation: 'x', emotions: ['Humiliation'], createdAt: '2026-09-01T00:00:00Z' },
      [
        { date: '2026-09-01', intensity: 9 },
        { date: '2026-09-02', intensity: 7, note: 'j\u2019ai appelé un ami pour en parler' },
      ],
      null,
      [{ date: '2026-09-01', note: 'j\u2019ai appelé un ami pour en parler', drop: 2, copingTags: tagCoping('j\u2019ai appelé un ami pour en parler') }],
      [],
    );
    expect(md).toContain('Recadrage injustice');
    expect(md).toContain('Pose de limites');
    expect(md).toContain('Reconnexion choisie');
    expect(md).not.toContain('Auto-compassion');
    // The helpful note is tagged with its coping track.
    expect(md).toContain('[Reconnexion choisie]');
  });

  it('groups tagged notes per emotion', () => {
    const md = buildTherapistReport(
      { title: 'Rejet', situation: 'x', emotions: ['Honte', 'Colère'], createdAt: '2026-09-01T00:00:00Z' },
      [
        { date: '2026-09-01', intensity: 9, note: 'je me sens nul', noteEmotions: ['Honte'] },
        { date: '2026-09-02', intensity: 7, note: 'global' },
      ],
      null,
      [],
      [],
    );
    expect(md).toContain('[→ Honte]');
    expect(md).toContain('## Notes par émotion');
    expect(md).toContain('### Honte');
    expect(md).toContain('« je me sens nul »');
    // Untagged + untargeted emotions stay out of the per-emotion section.
    expect(md).not.toContain('### Colère');
  });
});

describe('buildEmotionalMemory', () => {
  const ep = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    title: 'Conflit',
    emotions: ['Colère'],
    createdAt: '2026-08-01T00:00:00Z',
    checks: [
      { date: '2026-08-01', intensity: 9 },
      { date: '2026-08-02', intensity: 7 },
      { date: '2026-08-03', intensity: 5 },
      { date: '2026-08-04', intensity: 4 },
    ],
    ...over,
  });

  it('is empty with no usable past', () => {
    expect(buildEmotionalMemory([])).toBe('');
    expect(buildEmotionalMemory([ep({ checks: [] })])).toBe('');
  });

  it('summarizes past episodes, learned half-lives and what helped', () => {
    const mem = buildEmotionalMemory([
      ep({}),
      ep({
        id: 'e2', title: 'Rejet', emotions: ['Honte'],
        checks: [
          { date: '2026-08-10', intensity: 8, note: 'marche 20 min' },
          { date: '2026-08-11', intensity: 5 },
          { date: '2026-08-12', intensity: 4 },
          { date: '2026-08-13', intensity: 3 },
        ],
      }),
    ]);
    expect(mem).toContain('MÉMOIRE ÉMOTIONNELLE');
    expect(mem).toContain('Conflit');
    expect(mem).toContain('Rejet');
    expect(mem).toContain('marche 20 min');
  });

  it('excludes the current event', () => {
    const mem = buildEmotionalMemory([ep({})], 'e1');
    expect(mem).toBe('');
  });
});

describe('detectEmotionsFromText', () => {
  it('detects French emotions incl. anger and distinguishes honte vs humiliation', () => {
    const out = detectEmotionsFromText("J'étais furieux et plein de rage après cette humiliation, tellement honteux.");
    expect(out).toContain('Colère');
    expect(out).toContain('Humiliation');
    expect(out).toContain('Honte');
  });
  it('separates Humiliation from Honte', () => {
    expect(detectEmotionsFromText('humilié devant tout le monde')).toContain('Humiliation');
    expect(detectEmotionsFromText('humilié devant tout le monde')).not.toContain('Honte');
    expect(detectEmotionsFromText("j'ai honte de moi")).toContain('Honte');
    // Prior reflects literature: humiliation lingers longer than honte (social-evaluative threat)
    expect(EMOTION_PRIOR_HALFLIFE_DAYS['Humiliation']).toBeGreaterThan(EMOTION_PRIOR_HALFLIFE_DAYS['Honte']);
  });

  it('is accent-insensitive and capped', () => {
    const out = detectEmotionsFromText('angoisse stress deadline inquiet fatigue epuisement tristesse solitude');
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out).toContain('Anxiété');
  });

  it('returns empty on neutral text', () => {
    expect(detectEmotionsFromText('il fait beau et le ciel est bleu')).toEqual([]);
  });
});

describe('checkStreak', () => {
  it('counts consecutive days ending today, tolerating unchecked today', () => {
    expect(checkStreak([{ date: '2026-09-03' }, { date: '2026-09-04' }, { date: '2026-09-05' }], '2026-09-05')).toBe(3);
    expect(checkStreak([{ date: '2026-09-03' }, { date: '2026-09-04' }], '2026-09-05')).toBe(2);
    expect(checkStreak([{ date: '2026-09-01' }, { date: '2026-09-05' }], '2026-09-05')).toBe(1);
    expect(checkStreak([], '2026-09-05')).toBe(0);
  });
});

describe('projection', () => {
  it('emits 7 forward points on a decaying series', () => {
    const checks = [9, 8, 7, 6, 5, 4].map((intensity, i) => ({
      date: `2026-08-${String(20 + i).padStart(2, '0')}`,
      intensity,
    }));
    const f = forecastEmotion(checks, ['Colère']);
    expect(f.projection).toHaveLength(7);
    expect(f.projection[0]!.date).toBe('2026-08-26');
    for (const p of f.projection) {
      expect(p.intensity).toBeGreaterThanOrEqual(1);
      expect(p.intensity).toBeLessThanOrEqual(10);
    }
    for (let i = 1; i < f.projection.length; i++) {
      expect(f.projection[i]!.intensity).toBeLessThanOrEqual(f.projection[i - 1]!.intensity);
    }
  });

  it('is empty on cold start', () => {
    const f = forecastEmotion([{ date: '2026-09-01', intensity: 8 }], ['Tristesse']);
    expect(f.projection).toEqual([]);
  });

  it('applies the rumination tail + micro-spikes for Humiliation only', () => {
    const checks = [9, 8, 7, 6, 5, 4].map((intensity, i) => ({
      date: `2026-08-${String(20 + i).padStart(2, '0')}`,
      intensity,
    }));
    const hum = forecastEmotion(checks, ['Humiliation']);
    const col = forecastEmotion(checks, ['Colère']);
    expect(hum.rumination).toBe(true);
    expect(col.rumination).toBe(false);
    // Tail-aware estimate is longer-or-equal (never shorter) than mono.
    expect(hum.daysRemaining).not.toBeNull();
    expect(col.daysRemaining).not.toBeNull();
    expect(hum.daysRemaining!).toBeGreaterThanOrEqual(col.daysRemaining!);
    // Micro-spikes at days 2 and 5 dent the slope honestly: the day-2 drop
    // is visibly smaller than the day-3 drop (spike ≈ +0.38 cushions j2).
    const d12 = hum.projection[0]!.intensity - hum.projection[1]!.intensity;
    const d23 = hum.projection[1]!.intensity - hum.projection[2]!.intensity;
    expect(d23 - d12).toBeGreaterThan(0.2);
  });
});

describe('biExpValue / biExpCrossingDays', () => {
  it('starts at fittedLast and decays through both components', () => {
    const v0 = biExpValue(0, 8, 0.3);
    expect(v0).toBeCloseTo(9, 10); // floor 1 + amp 8
    expect(biExpValue(30, 8, 0.3)).toBeLessThan(3);
    expect(biExpValue(30, 8, 0.3)).toBeGreaterThan(1);
  });

  it('crosses later than the mono-exponential on the same fast rate', () => {
    const monoDays = Math.log(8 / 1) / 0.3;
    const bi = biExpCrossingDays(9, 0.3, 2);
    expect(bi).not.toBeNull();
    expect(bi!).toBeGreaterThan(monoDays);
  });
});

describe('suggestCoping / tagCoping', () => {
  it('differentiates Honte (inward) from Humiliation (outward)', () => {
    const honte = suggestCoping(['Honte']).map((c) => c.track);
    expect(honte).toContain('Auto-compassion');
    expect(honte).toContain('Réévaluation interne');
    expect(honte).not.toContain('Pose de limites');
    const hum = suggestCoping(['Humiliation']).map((c) => c.track);
    expect(hum).toContain('Recadrage injustice');
    expect(hum).toContain('Pose de limites');
    expect(hum).toContain('Reconnexion choisie');
    expect(hum).not.toContain('Auto-compassion');
  });

  it('returns empty for unknown emotions and dedupes', () => {
    expect(suggestCoping(['Xyz'])).toEqual([]);
    expect(suggestCoping(['Honte', 'Honte'])).toHaveLength(2);
  });

  it('tags notes accent-insensitively', () => {
    expect(tagCoping('J\u2019ai appelé un ami pour en parler')).toContain('Reconnexion choisie');
    expect(tagCoping('je me suis parle avec bienveillance')).toContain('Auto-compassion');
    expect(tagCoping('il fait beau')).toEqual([]);
  });

  it('findHelpfulNotes carries copingTags', () => {
    const out = findHelpfulNotes([
      { date: '2026-09-01', intensity: 9, note: 'j\u2019ai posé mes limites clairement' },
      { date: '2026-09-02', intensity: 6 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.copingTags).toContain('Pose de limites');
  });
});

describe('parseActionPlan', () => {
  it('parses a valid plan and caps length', () => {
    const p = parseActionPlan(JSON.stringify({
      title: 'Trouver un hobby qui accroche vraiment cette fois',
      steps: ['Lister 3 activités essayées ado', 'Tester la première 20 minutes samedi', 'Noter le ressenti 1-10 juste après'],
    }));
    expect(p).not.toBeNull();
    expect(p!.steps).toHaveLength(3);
  });

  it('accepts fenced JSON', () => {
    const p = parseActionPlan('```json\n{"title": "Plan", "steps": ["a", "b"]}\n```');
    expect(p).not.toBeNull();
    expect(p!.title).toBe('Plan');
  });

  it('rejects garbage, empty titles and empty steps', () => {
    expect(parseActionPlan('not json at all {{{')).toBeNull();
    expect(parseActionPlan(JSON.stringify({ title: '', steps: ['a'] }))).toBeNull();
    expect(parseActionPlan(JSON.stringify({ title: 'T', steps: [] }))).toBeNull();
    expect(parseActionPlan(JSON.stringify({ title: 'T' }))).toBeNull();
    // Non-string steps are dropped, not fatal.
    const p = parseActionPlan(JSON.stringify({ title: 'T', steps: ['ok', 42, null, '  '] }));
    expect(p).not.toBeNull();
    expect(p!.steps).toEqual(['ok']);
  });
});
