// src/insights.ts
// Pure, tested module that turns correlation results into human-readable,
// decision-oriented French insights. Filters out everything that is not
// trustworthy (FDR-significant, stable, not outlier-driven) and ranks the rest
// so the user sees "what to remember" instead of a wall of stats.

import type { CorrelationAnalysis, CorrelationResult } from './types';
import { isTrustworthy } from './correlations';

export interface Insight {
  /** Machine-readable summary of the relationship. */
  pairKey: string;
  /** Human sentence, e.g. « Quand tu fais Sport, ton Énergie le lendemain monte en moyenne. » */
  sentence: string;
  /** Short label for badges, e.g. « Sport → Énergie (lag 1j) » */
  label: string;
  /** 'positive' | 'negative' */
  direction: 'positive' | 'negative';
  /** |coefficient| rounded to 2 decimals. */
  magnitude: number;
  /** Sample size in days. */
  n: number;
  /** Lag in days (0 = same day). */
  lag: number;
  /** Window: undefined | 'weekday' | 'weekend' */
  window?: 'weekday' | 'weekend';
  /** Interpretive nuance appended to the sentence. */
  nuance?: string;
}

const LAG_LABEL: Record<number, string> = {
  0: 'le même jour',
  1: 'le lendemain',
  2: '2 jours plus tard',
  3: '3 jours plus tard',
  7: 'une semaine plus tard',
};

const WINDOW_LABEL: Record<string, string> = {
  weekday: ' (jours ouvrés)',
  weekend: ' (week-ends)',
};

/** Verb for the metric side: energy/mood are states, habits are actions. */
function verbFor(metric: string): string {
  const lower = metric.toLowerCase();
  if (lower === 'énergie' || lower === 'mood' || lower === 'humeur') return 'est';
  return 'fais';
}

function nounFor(metric: string, lower: boolean): string {
  const m = metric.trim();
  const lowered = m.charAt(0).toLowerCase() + m.slice(1);
  return lower ? lowered : m;
}

function buildInsight(r: CorrelationResult, lag: number): Insight {
  const positive = r.coefficient >= 0;
  const A = nounFor(r.metricA, false);
  const a = nounFor(r.metricA, true);
  const b = nounFor(r.metricB, true);
  const window = WINDOW_LABEL[r.window ?? ''] ?? '';
  const lagText = LAG_LABEL[lag] ?? `J+${lag}`;

  let sentence: string;
  if (lag === 0) {
    sentence = positive
      ? `Quand tu ${verbFor(r.metricA)} ${a}, ${b} est plus haut le même jour${window}.`
      : `Quand tu ${verbFor(r.metricA)} ${a}, ${b} est plus bas le même jour${window}.`;
  } else {
    sentence = positive
      ? `Quand tu ${verbFor(r.metricA)} ${a}, ${b} a tendance à monter ${lagText}${window}.`
      : `Quand tu ${verbFor(r.metricA)} ${a}, ${b} a tendance à baisser ${lagText}${window}.`;
  }

  let nuance: string | undefined;
  if (r.trendDriven) {
    nuance = '⚠ Ce lien est surtout une tendance partagée (tout évolue dans le même sens au fil du temps) : une fois les tendances retirées, l’association s’évapore. Ne pas traiter comme un vrai lien quotidien.';
  } else if (r.weekdayConfounded) {
    nuance = '⚠ Ce lien vient surtout du contraste semaine/week-end : quand on compare des jours du même type, l’association disparaît.';
  } else if (r.winsorizedCoefficient !== null && r.winsorizedCoefficient !== undefined) {
    const robust = Math.abs(r.winsorizedCoefficient);
    if (robust < Math.abs(r.coefficient) * 0.7) {
      nuance = 'Le lien s’affaiblit sans les valeurs extrêmes — solide mais à surveiller.';
    }
  }
  if (r.autocorrelatedResiduals) {
    nuance = 'Attention : les jours se ressemblent (autocorrélation) — le lien peut être gonflé.';
  }

  return {
    pairKey: r.pairKey ?? `${r.metricA}↔${r.metricB}@lag${lag}`,
    sentence,
    label: `${A} → ${b[0].toUpperCase()}${b.slice(1)}${lag > 0 ? ` (lag ${lag}j)` : ''}`,
    direction: positive ? 'positive' : 'negative',
    magnitude: Math.abs(r.coefficient),
    n: r.sampleSize,
    lag,
    window: r.window,
    nuance,
  };
}

/** Build the "Top insights" list from a full analysis, most relevant first.
 * Only trustworthy results (FDR-significant, stable sign, not outlier-driven)
 * are considered. Longer lags are de-prioritised vs same-day unless stronger. */
export function topInsights(analysis: CorrelationAnalysis, limit = 5): Insight[] {
  const candidates: { r: CorrelationResult; lag: number }[] = [];
  candidates.push(...analysis.sameDay.map((r) => ({ r, lag: 0 })));
  candidates.push(...analysis.lag1.map((r) => ({ r, lag: 1 })));
  if (analysis.lag2) candidates.push(...analysis.lag2.map((r) => ({ r, lag: 2 })));
  if (analysis.lag3) candidates.push(...analysis.lag3.map((r) => ({ r, lag: 3 })));
  if (analysis.lag7) candidates.push(...analysis.lag7.map((r) => ({ r, lag: 7 })));

  const trustworthy = candidates.filter(({ r }) => isTrustworthy(r) && r.sampleSize >= 8);

  // Score: magnitude, then prefer same-day/lag-1 (more actionable), boost
  // weekdays/weekends only when strong, penalise small n.
  const scored = trustworthy.map(({ r, lag }) => {
    const magnitude = Math.abs(r.coefficient);
    let score = magnitude * 100;
    if (lag === 0) score += 8;
    if (lag === 1) score += 4;
    if (lag === 2 || lag === 3) score += 1;
    if (lag === 7) score -= 5;
    if (r.window) score += 2;
    score += Math.min(4, r.sampleSize / 20);
    return { r, lag, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Dedupe by metric pair (keep the strongest lag of the same pair).
  const seen = new Set<string>();
  const out: Insight[] = [];
  for (const { r, lag } of scored) {
    const pairKey = r.metricA + '↔' + r.metricB;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    out.push(buildInsight(r, lag));
    if (out.length >= limit) break;
  }
  return out;
}
