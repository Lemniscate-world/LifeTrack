/**
 * AI Coach structured output (v0.3.4).
 * The local Ollama model replies as strict JSON; these types describe that
 * schema and the parser turns the raw model reply into typed cards.
 */

import type { Recommendation } from './recommendations';

export interface AiAnalysisItem {
  title?: string;
  why?: string;
  detail?: string;
  action?: string;
}

export interface AiAnalysis {
  summary?: string;
  top_priorities?: AiAnalysisItem[];
  trends?: AiAnalysisItem[];
  risks?: AiAnalysisItem[];
  next_step?: string;
}

export interface AiChatMessage {
  role: 'user' | 'coach';
  content: string;
}

/** Robustly parse the model's JSON reply. Returns null if it's not usable. */
export function parseAiAnalysis(raw: string): AiAnalysis | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in ```json fences even when told not to.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      value = JSON.parse(fenced ? fenced[1] : raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const asItems = (v: unknown): AiAnalysisItem[] =>
    Array.isArray(v)
      ? v.filter((x): x is AiAnalysisItem => typeof x === 'object' && x !== null && !Array.isArray(x))
      : [];
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const summary = str(obj.summary);
  const nextStep = str(obj.next_step);
  const top_priorities = asItems(obj.top_priorities);
  const trends = asItems(obj.trends);
  const risks = asItems(obj.risks);
  if (!summary && top_priorities.length === 0 && trends.length === 0 && risks.length === 0 && !nextStep) {
    return null;
  }
  return { summary, top_priorities, trends, risks, next_step: nextStep };
}

/**
 * v0.6.4: Turn the AI's structured analysis into insight cards so the local
 * Insights list is "based on the AI engine" too — the AI's priorities, trends
 * and risks appear alongside the heuristic recommendations.
 */
export function aiAnalysisToInsights(analysis: AiAnalysis): Recommendation[] {
  if (!analysis) return [];
  const recs: Recommendation[] = [];
  for (const [i, p] of (analysis.top_priorities ?? []).entries()) {
    if (!p.title) continue;
    recs.push({
      kind: 'AI_PRIORITY',
      title: `🤖 ${p.title}`,
      detail: [p.why, p.action].filter(Boolean).join(' → '),
      habitIds: [],
      strength: Math.max(70, 90 - i * 5),
    });
  }
  for (const t of analysis.trends ?? []) {
    if (!t.title) continue;
    recs.push({
      kind: 'AI_TREND',
      title: `📈 ${t.title}`,
      detail: t.detail ?? '',
      habitIds: [],
      strength: 68,
    });
  }
  for (const r of analysis.risks ?? []) {
    if (!r.title) continue;
    recs.push({
      kind: 'AI_RISK',
      title: `⚠️ ${r.title}`,
      detail: [r.detail, r.action].filter(Boolean).join(' → '),
      habitIds: [],
      strength: 75,
    });
  }
  return recs;
}
