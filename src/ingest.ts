// src/ingest.ts
// Automated knowledge ingestion — the "harvester" (RULE 69) made local.
//
// You DEPOSIT a source (podcast transcript, article, book notes, a feed) and
// this pipeline turns it into structured Protocol candidates with an honest
// evidence level. Nothing to "complete" manually: the work is automated.
//
// Two paths:
//   - deterministic (no AI): splits the text into claims and grades them with
//     a keyword heuristic (works offline, fully testable);
//   - AI-assisted: an optional local/cloud model returns strict JSON that we
//     parse (reusing the fence-tolerant parser from aiAnalysis.ts).
//
// Local-first: raw sources stay on-device, nothing is uploaded anywhere.

import type { EvidenceLevel, Protocol, ProtocolDomain } from './types';
import { parseAiAnalysis } from './aiAnalysis';

// --- Claim splitting ---

/** Split raw text into discrete claim segments (bullets, numbering, sentences). */
export function splitClaims(raw: string): string[] {
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    // De-number bullets and lists.
    const cleaned = line.replace(/^[-•*▪◦]\s*/, '').replace(/^\d+[.):]\s*/, '').trim();
    if (!cleaned) continue;
    out.push(cleaned);
  }
  return out;
}

// --- Domain classification ---

const DOMAIN_KEYWORDS: Record<ProtocolDomain, string[]> = {
  sleep: ['sommeil', 'sleep', 'réveil', 'reveil', 'wake', 'melatonine', 'melatonin', 'coucher', 'circadien'],
  focus: ['focus', 'concentration', 'attention', 'deep work', 'dopamine', 'procrastination'],
  energy: ['énergie', 'energie', 'energy', 'fatigue', 'éveil', 'eveil', 'vigilance'],
  mood: ['humeur', 'mood', 'anxiété', 'anxiete', 'anxiety', 'dépression', 'depression', 'sérénité'],
  stress: ['stress', 'anxieux', 'parasympathique', 'calme', 'respiration', 'mindfulness', 'méditation'],
  training: ['entraînement', 'entrainement', 'training', 'zone 2', 'cardio', 'force', 'hypertrophie', 'gym', 'sport'],
  nutrition: ['nutrition', 'alimentation', 'protéine', 'proteine', 'protein', 'magnésium', 'magnesium', 'supplément', 'supplement', 'omega', 'jeûne', 'jeune', 'fasting', 'glucose', 'crème', 'créatine'],
  social: ['social', 'amis', 'friends', 'famille', 'family', 'connexion', 'solitude', 'relation'],
  cognitive: ['cognition', 'mémoire', 'memoire', 'memory', 'créatine', 'creatine', 'nootropique', 'cerveau', 'apprentissage', 'focus'],
};

export function classifyDomain(text: string): ProtocolDomain {
  const t = text.toLowerCase();
  const scores = new Map<ProtocolDomain, number>();
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    let s = 0;
    for (const kw of kws) if (t.includes(kw)) s++;
    scores.set(domain as ProtocolDomain, s);
  }
  let best: ProtocolDomain = 'cognitive';
  let bestScore = 0;
  for (const [d, s] of scores) {
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

// --- Evidence classification (heuristic, honest) ---

const A_WORDS = ['randomized', 'randomisé', 'randomise', 'meta-analysis', 'meta analysis', 'études montrent', 'studies show', 'proven', 'prouvé', 'peer-reviewed', 'controlled trial', 'essai contrôlé', 'causale'];
const C_WORDS = ['je pense', 'i think', 'j’ai remarqué', 'j\'ai remarqué', 'peut', 'paraît', 'corrélation', 'correlation', 'anecdote', 'anecdotique', 'feel like', 'perhaps', 'à mon avis', 'a priori'];

export function classifyEvidence(text: string): EvidenceLevel {
  const t = text.toLowerCase();
  let a = 0;
  let c = 0;
  for (const w of A_WORDS) if (t.includes(w)) a++;
  for (const w of C_WORDS) if (t.includes(w)) c++;
  if (a > 0 && a > c) return 'A';
  if (c > 0) return 'C';
  return 'B';
}

/** Deterministic extraction: raw text → Protocol candidates. No AI required. */
export function extractProtocolsFromText(raw: string, sourceTitle: string): Protocol[] {
  const claims = splitClaims(raw);
  const out: Protocol[] = [];
  const seen = new Set<string>();
  claims.forEach((claim, i) => {
    if (claim.length < 20) return;
    const title = claim.slice(0, 70).replace(/:$/, '');
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const st = claim.length;
    out.push({
      id: `ing-${i}-${st}`,
      title,
      source: sourceTitle || 'Source importée',
      host: undefined,
      claim,
      evidenceLevel: classifyEvidence(claim),
      domain: classifyDomain(claim),
      protocol: claim,
      keywords: [],
    });
  });
  return out;
}

// --- AI-assisted structured extraction ---

export interface IngestAiPayload {
  title?: string;
  claims?: { claim?: string; evidence?: EvidenceLevel; domain?: string; protocol?: string }[];
}

/** Parse an AI reply into structured protocols (reuses fence-tolerant parser). */
export function parseIngestAi(raw: string): IngestAiPayload | null {
  const parsed = parseAiAnalysis(raw);
  if (!parsed) return null;
  const claims = (parsed.top_priorities ?? []).map((it) => {
    const claim = it.detail || it.title || '';
    return {
      claim,
      evidence: (it.why ? classifyEvidence(it.why) : 'B') as EvidenceLevel,
      domain: classifyDomain(claim) as ProtocolDomain,
      protocol: it.action,
    };
  });
  return { title: parsed.summary, claims };
}

// --- Merge / dedupe ---

function normTitle(t: string): string {
  return (t || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

/** Merge newly ingested protocols into an existing list, deduped by title. */
export function mergeProtocols(existing: Protocol[], added: Protocol[]): Protocol[] {
  const seen = new Set(existing.map((p) => normTitle(p.title)));
  const merged = [...existing];
  for (const p of added) {
    const k = normTitle(p.title);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(p);
  }
  return merged;
}

// --- AI-assisted structured protocols (v0.6.1) ---

const VALID_DOMAINS: ProtocolDomain[] = [
  'sleep', 'focus', 'energy', 'mood', 'training',
  'nutrition', 'stress', 'social', 'cognitive',
];

/** Map a parsed AI payload into real Protocol entries (skips short/empty claims). */
export function buildProtocolsFromAiPayload(payload: IngestAiPayload | null, source: string): Protocol[] {
  if (!payload || !Array.isArray(payload.claims) || payload.claims.length === 0) return [];
  const out: Protocol[] = [];
  payload.claims.forEach((c, i) => {
    const claim = (c.claim ?? '').trim();
    if (claim.length < 20) return;
    const title = claim.slice(0, 70).replace(/:$/, '');
    out.push({
      id: `ai-${i}-${title.length}`,
      title,
      source: source || 'Source IA',
      host: undefined,
      claim,
      evidenceLevel: c.evidence && (c.evidence === 'A' || c.evidence === 'B' || c.evidence === 'C')
        ? c.evidence
        : 'B',
      domain: c.domain && (VALID_DOMAINS as string[]).includes(c.domain) ? c.domain as ProtocolDomain : 'cognitive',
      protocol: c.protocol || claim,
      keywords: [],
    });
  });
  return out;
}

export interface AiExtractOptions {
  model?: string;
  provider?: string;
  apiKey?: string;
}

/**
 * Run the local/cloud AI (DeepSeek V4 Flash by default) on a raw source to build
 * structured protocols. Only works in the Tauri desktop app (needs the Rust
 * command); returns [] anywhere else.
 */
export async function aiExtractProtocols(raw: string, source: string, opts: AiExtractOptions = {}): Promise<Protocol[]> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauri) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const text = await invoke<string>('extract_protocols_ai', {
    raw,
    model: opts.model || null,
    provider: opts.provider || 'auto',
    apiKey: opts.apiKey || '',
  });
  return buildProtocolsFromAiPayload(parseIngestAi(text), source);
}
