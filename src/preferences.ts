// src/preferences.ts
// The PREFERENCE ENGINE — LifeTrack reads YOUR data (notes, habits, projects,
// experiments, challenges, correlations) and ranks what it proposes: protocols
// to try, challenges to take, experiments to run. Everything is derived, local,
// and anti-overwhelm by design (only `stickyMax` items at once — no endless
// to-do list, which is exactly what you're tired of).
//
// Pure module: (AppData slice + protocol library) → ranked report. No store.

import type {
  Habit, CheckIn, Note, CapacityRating, Project,
  Protocol, ProtocolDomain, CorrelationResult,
} from './types';
import { protocolKeywordHits } from './protocols';
import { suggestChallenges, type ChallengeSuggestion } from './challengeSuggestions';
import { correlationToExperiment, weaknessToExperiment, type ExperimentDraft } from './experimentFactory';
import { computeCorrelations } from './correlations';
import { detectReflections } from './reflection';

export interface RankedProtocol {
  protocol: Protocol;
  score: number;
  hits: number;
  reasons: string[];
  alreadyPursued: boolean;
}

export interface PreferenceReport {
  protocols: RankedProtocol[];
  challenges: ChallengeSuggestion[];
  experiments: ExperimentDraft[];
  weakDomains: ProtocolDomain[];
}

export interface PreferenceInput {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
  moods: Record<string, string>;
  capacities: { id: string; name: string }[];
  capacityRatings: CapacityRating[];
  projects: Project[];
  protocols: Protocol[];
  experiments: { id: string; title: string }[];
  challenges: { id: string; name: string }[];
  stickyMax?: number;      // default 3
  now?: Date;
}

// Habit category → life domain (used to detect weak domains).
const CATEGORY_DOMAINS: Record<string, ProtocolDomain[]> = {
  health: ['sleep', 'training', 'nutrition', 'energy'],
  work: ['focus', 'cognitive'],
  personal: ['mood', 'social', 'stress'],
  learning: ['cognitive', 'focus'],
};

const DOMAIN_RANK: Record<ProtocolDomain, number> = {
  sleep: 0, focus: 1, energy: 2, mood: 3, training: 4,
  nutrition: 5, stress: 6, social: 7, cognitive: 8,
};

function recentRate(habitId: string, checkIns: CheckIn[], days: number, now: Date): number {
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  const prefix = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const set = new Set<string>();
  for (const c of checkIns) {
    if (c.habitId === habitId && c.completed && c.date >= prefix) set.add(c.date);
  }
  return set.size;
}

/**
 * The preference engine. Deterministic, derived entirely from the caller's data.
 */
export function buildPreferenceReport(input: PreferenceInput): PreferenceReport {
  const now = input.now ?? new Date();
  const stickyMax = Math.max(1, Math.min(8, input.stickyMax ?? 3));

  // --- Collect the user's own language (the signal the engine listens to) ---
  const texts: string[] = [];
  for (const n of input.notes) texts.push(n.content);
  for (const ci of input.checkIns) texts.push(...(ci.notes ?? []));
  for (const h of input.habits) texts.push(h.name);
  for (const p of input.projects) texts.push(p.name, ...p.tasks.map((t) => t.title));
  for (const e of input.experiments) texts.push(e.title);
  for (const c of input.challenges) texts.push(c.name);

  // Already doing? A habit whose name shares a token with a protocol signature.
  const habitNames = input.habits.filter((h) => !h.archived).map((h) => h.name.toLowerCase());

  // --- Detect weak life domains from real behaviour ---
  const weakDomains = new Set<ProtocolDomain>();
  const active = input.habits.filter((h) => !h.archived);
  for (const h of active) {
    const domains = CATEGORY_DOMAINS[h.category ?? 'personal'] ?? [];
    const recent = recentRate(h.id, input.checkIns, 14, now);
    const tracked = input.checkIns.some((c) => c.habitId === h.id);
    if (tracked && recent / 14 < 0.5) {
      for (const d of domains) weakDomains.add(d);
    }
  }

  // --- Rank protocols ---
  const reflections = detectReflections({
    habits: input.habits,
    checkIns: input.checkIns,
    notes: input.notes,
    urges: [],
    challenges: input.challenges as never,
    journalEntries: [],
  }, now);

  const protocols: RankedProtocol[] = input.protocols
    .map((protocol) => {
      const hits = protocolKeywordHits(protocol, texts);
      const alreadyPursued = (protocol.habitSuggestions ?? []).some((s) =>
        habitNames.some((name) => name.includes(s.toLowerCase())),
      );
      const weakBoost = weakDomains.has(protocol.domain) ? 2 : 0;
      const reasons: string[] = [];
      if (weakBoost > 0) reasons.push(`${protocol.domain} est un de tes points faibles récents.`);
      if (hits > 0) reasons.push(`${hits} mot(s)-clé présent(s) dans tes notes/habitudes.`);
      if (!alreadyPursued && reasons.length === 0) reasons.push('Domaine clé de ta vie (équilibre).');
      const score = hits * 10 + weakBoost * 15 - (alreadyPursued ? 30 : 0);
      return { protocol, score, hits, reasons, alreadyPursued };
    })
    .sort((a, b) =>
      b.score - a.score
      || DOMAIN_RANK[a.protocol.domain] - DOMAIN_RANK[b.protocol.domain],
    );

  // Only surface a handful, and skip what you're already doing.
  const surfaced = protocols
    .filter((p) => p.score > 0)
    .slice(0, stickyMax);

  // --- Challenges from real behavior + reflections ---
  const correlations: CorrelationResult[] = (() => {
    try {
      return computeCorrelations(input.habits, input.checkIns, input.moods, input.capacities, input.capacityRatings);
    } catch {
      return [];
    }
  })();

  const challenges = suggestChallenges(input.habits, input.checkIns, reflections, correlations, now, 4);

  // --- Experiments: correlations & weaknesses -> testable hypotheses ---
  const experiments: ExperimentDraft[] = [];
  for (const corr of correlations) {
    if (experiments.length >= 2) break;
    if (!corr.significant) continue;
    const draft = correlationToExperiment(corr, input.habits, now);
    if (draft) experiments.push(draft);
  }
  if (experiments.length < 2) {
    for (const h of active) {
      if (experiments.length >= 2) break;
      const recent = recentRate(h.id, input.checkIns, 7, now);
      const tracked = input.checkIns.some((c) => c.habitId === h.id);
      if (tracked && recent / 7 < 0.4) {
        experiments.push(weaknessToExperiment(h, (recent / 7) * 100, now));
      }
    }
  }

  return {
    protocols: surfaced,
    challenges,
    experiments: experiments.slice(0, 2),
    weakDomains: [...weakDomains],
  };
}
