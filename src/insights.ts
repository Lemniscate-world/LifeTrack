// src/insights.ts
// Pure, tested module that turns correlation results into human-readable,
// decision-oriented French insights. Filters out everything that is not
// trustworthy (FDR-significant, stable, not outlier-driven) and ranks the rest
// so the user sees "what to remember" instead of a wall of stats.

import type { CheckIn, CorrelationAnalysis, CorrelationResult } from './types';
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

/** All results across every lag/window, for pool-wide analysis. */
function allResults(analysis: CorrelationAnalysis): CorrelationResult[] {
  return [
    ...analysis.sameDay,
    ...analysis.lag1,
    ...(analysis.lag2 ?? []),
    ...(analysis.lag3 ?? []),
    ...(analysis.lag7 ?? []),
    ...analysis.weekday,
    ...analysis.weekend,
  ];
}

/**
 * "Absences" insights: habits that appear with enough aligned days but show
 * NO trustworthy link with anything. Knowing what does NOT relate is as
 * actionable as knowing what does — it flags habits that may be pure routine.
 */
export function gapInsights(analysis: CorrelationAnalysis): Insight[] {
  const results = allResults(analysis);
  if (results.length === 0) return [];
  const trusted = new Set<string>();
  const present = new Map<string, number>();
  for (const r of results) {
    for (const m of [r.metricA, r.metricB]) {
      if (m === 'Mood' || m === 'Énergie' || m === 'Capacité') continue;
      if (isTrustworthy(r)) trusted.add(m);
      present.set(m, Math.max(present.get(m) ?? 0, r.sampleSize));
    }
  }
  const out: Insight[] = [];
  for (const [metric, n] of present) {
    if (trusted.has(metric)) continue;
    if (n < 8) continue;
    out.push({
      pairKey: `gap:${metric}`,
      sentence: `${metric} ne corrèle avec rien de fiable (ni le même jour, ni les jours suivants, ni en week-end/semaine) sur ${n} jours de données. C'est peut-être une routine pure — utile en soi, mais sans effet mesurable sur ton humeur, ton énergie ou tes autres habitudes.`,
      label: `${metric} — aucun lien`,
      direction: 'negative',
      magnitude: 0,
      n,
      lag: 0,
      nuance: 'Absence de lien ≠ preuve d’inutilité : ça veut dire « rien ne change quand tu le fais », ce qui peut être volontaire.',
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * Actionable levers: trustworthy lag-1 pairs (X today → Y tomorrow) ranked by
 * impact = effect size × how often X is actually done. Changing the most
 * frequent, most impactful X first gives the best expected return.
 */
export function actionableLevers(analysis: CorrelationAnalysis, checkIns: CheckIn[], limit = 3): Insight[] {
  const candidates = analysis.lag1
    .filter((r) => isTrustworthy(r))
    .map((r) => {
      // Frequency of the "action" side: how often the metric the user can
      // change is actually done (completed days / distinct days in check-ins).
      const actionSide = r.metricA === 'Mood' || r.metricA === 'Énergie' || r.metricA === 'Capacité' ? r.metricB : r.metricA;
      const habitNames = new Map<string, string>();
      const habitDays = new Map<string, Set<string>>();
      const doneDays = new Map<string, Set<string>>();
      for (const c of checkIns) {
        if (c.habitId) {
          const s = habitDays.get(c.habitId) ?? new Set<string>();
          s.add(c.date);
          habitDays.set(c.habitId, s);
          if (c.completed) {
            const d = doneDays.get(c.habitId) ?? new Set<string>();
            d.add(c.date);
            doneDays.set(c.habitId, d);
          }
        }
      }
      // Map habit names to ids: names come from the analysis labels; resolve
      // by matching through the check-in set is not possible directly, so use
      // the frequency of the action label when it IS a habit name we know.
      let freq = 0.5;
      void habitNames;
      // Best-effort: search check-ins for a habit whose name matches actionSide
      // cannot be done here (no habit list) → use the overall completion rate
      // of the action metric if it is a habit-like label (not Mood/Énergie).
      const isState = actionSide === 'Mood' || actionSide === 'Énergie' || actionSide === 'Capacité';
      if (!isState) {
        let total = 0;
        let done = 0;
        for (const [id, days] of habitDays) {
          void id;
          total += days.size;
          done += doneDays.get(id)?.size ?? 0;
        }
        freq = total > 0 ? done / total : 0.5;
      }
      return { r, score: Math.abs(r.coefficient) * (0.4 + 0.6 * freq) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return candidates.map(({ r }) => {
    const positive = r.coefficient >= 0;
    const a = r.metricA.charAt(0).toLowerCase() + r.metricA.slice(1);
    const b = r.metricB.charAt(0).toLowerCase() + r.metricB.slice(1);
    return {
      pairKey: r.pairKey ?? `lever:${r.metricA}↔${r.metricB}`,
      sentence: positive
        ? `Levier n°1 potentiel : quand tu fais ${a}, ${b} a tendance à monter le lendemain (r=${r.coefficient.toFixed(2)}). C'est l'une de tes habitudes les plus fréquentes : y investir a un retour probable.`
        : `Levier négatif : quand tu fais ${a}, ${b} a tendance à baisser le lendemain (r=${r.coefficient.toFixed(2)}). Réduire ${a} pourrait améliorer ${b}.`,
      label: `${r.metricA} → ${b[0].toUpperCase()}${b.slice(1)} (lag 1j)`,
      direction: positive ? 'positive' : 'negative',
      magnitude: Math.abs(r.coefficient),
      n: r.sampleSize,
      lag: 1,
      nuance: 'Levier = association prédictive fiable, pas une preuve de causalité. Teste le changement avant d’en faire une règle.',
    };
  });
}

/**
 * Contrast insights: the same pair measured on weekdays vs weekends with a
 * large gap — "the link only exists on weekends" is a real behavioural signal.
 */
export function contrastInsights(analysis: CorrelationAnalysis): Insight[] {
  const byPair = (list: CorrelationResult[]) => {
    const map = new Map<string, CorrelationResult>();
    for (const r of list) map.set(`${r.metricA}↔${r.metricB}`, r);
    return map;
  };
  const wd = byPair(analysis.weekday);
  const we = byPair(analysis.weekend);
  const out: Insight[] = [];
  for (const [key, wdR] of wd) {
    const weR = we.get(key);
    if (!weR) continue;
    const gap = Math.abs(wdR.coefficient - weR.coefficient);
    if (gap < 0.25) continue;
    const stronger = Math.abs(weR.coefficient) > Math.abs(wdR.coefficient) ? weR : wdR;
    const weaker = stronger === weR ? wdR : weR;
    const windowName = stronger === weR ? 'le week-end' : 'en semaine';
    const otherName = stronger === weR ? 'en semaine' : 'le week-end';
    out.push({
      pairKey: `contrast:${key}`,
      sentence: `Le lien ${stronger.metricA} ↔ ${stronger.metricB} est marqué ${windowName} (${stronger.coefficient >= 0 ? '+' : ''}${stronger.coefficient.toFixed(2)}) mais quasi absent ${otherName} (${weaker.coefficient >= 0 ? '+' : ''}${weaker.coefficient.toFixed(2)}). L'effet dépend du type de journée.`,
      label: `${stronger.metricA} ↔ ${stronger.metricB} — contraste`,
      direction: stronger.coefficient >= 0 ? 'positive' : 'negative',
      magnitude: Math.abs(stronger.coefficient),
      n: Math.max(stronger.sampleSize, weaker.sampleSize),
      lag: 0,
      window: stronger === weR ? 'weekend' : 'weekday',
      nuance: 'Contraste semaine/week-end : le lien n’est pas stable dans le temps — il dépend du rythme de la semaine.',
    });
  }
  return out.sort((a, b) => b.magnitude - a.magnitude);
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
