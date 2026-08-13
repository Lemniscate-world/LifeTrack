// src/protocols.ts
// Curated behavioral / biohacking / research knowledge library.
//
// Sources: Huberman Lab, Modern Wisdom (Chris Williamson) and peer-reviewed
// literature. Evidence levels are HONEST (RULE 81): 'A' = causal /
// peer-reviewed, 'B' = expert protocol / strong mechanism, 'C' = correlational
// or anecdote. An anecdote is never presented as a fact — the UI must show the
// level so the user can weigh it.
//
// This is the *bundled* seed library; users grow it locally via ingestion
// (see ingest.ts). Everything is local, no cloud, nothing leaves the device.

import type { EvidenceLevel, Protocol, ProtocolDomain } from './types';

const P = (
  id: string,
  title: string,
  source: string,
  host: string,
  claim: string,
  evidenceLevel: EvidenceLevel,
  domain: ProtocolDomain,
  protocol: string,
  keywords: string[],
  extras: Partial<Protocol> = {},
): Protocol => ({
  id,
  title,
  source,
  host,
  claim,
  evidenceLevel,
  domain,
  protocol,
  keywords,
  ...extras,
});

/** Seed library — grounded in named, verifiable sources. */
export const SEED_PROTOCOLS: Protocol[] = [
  P('p-sunlight-morning', 'Lumière du matin (circadien)',
    'Huberman Lab #10 / #40', 'Huberman',
    'La lumière naturelle du matin ancre le chronotype et améliore le sommeil et la vigilance.',
    'B', 'sleep', '≥10 min de lumière extérieure dans les 30-60 min après le réveil.',
    ['lumière', 'soleil', 'réveil', 'matin', 'circadien', 'eye', 'light', 'outside'],
    { metric: 'qualité du sommeil 1-10', habitSuggestions: ['Lumière du matin'], mechanism: 'circadien' }),
  P('p-cold', 'Exposition au froid (dopamine)',
    'Huberman Lab #6', 'Huberman',
    'Le froid bref et intense libère de la dopamine et augmente l’éveil et la résilience.',
    'C', 'energy', '11 min de froid par semaine en 2-3 sessions (ex. douche froide).',
    ['froid', 'cold', 'dopamine', 'douche', 'shower', 'résilience', 'hiver'],
    { metric: 'énergie après 1h', habitSuggestions: ['Douche froide'], risky: true }),
  P('p-nsdr', 'NSDR / repos profond non-sommeil',
    'Huberman Lab #29', 'Huberman',
    'Le repos ne remplace pas le sommeil mais accélère la récupération et la neuroplasticité.',
    'C', 'focus', '10-20 min de NSDR par jour (medi ou respiration lente).',
    ['nsdr', 'repos', 'rest', 'yoga nidra', 'récupération', 'recovery'],
    { habitSuggestions: ['NSDR'], mechanism: 'neuroplasticité' }),
  P('p-consistent-wake', 'Heure de réveil constante',
    'Huberman Lab / PubMed', 'Huberman',
    'Se réveiller à la même heure chaque jour est le levier n°1 d’un sommeil stable.',
    'A', 'sleep', 'Heure de réveil fixe 7j/7 (±30 min).',
    ['réveil', 'wake', 'sommeil', 'sleep', 'régulier', 'consistent', 'horaire'],
    { metric: 'heure de réveil', habitSuggestions: ['Réveil à heure fixe'], mechanism: 'circadien' }),
  P('p-caffeine-window', 'Fenêtre de caféine',
    'Huberman Lab #30', 'Huberman',
    'La caféine en fin de journée dégrade la profondeur du sommeil jusqu’à 8-10h plus tard.',
    'A', 'sleep', 'Dernière caféine ≥8-10h avant le coucher.',
    ['caféine', 'cafeine', 'café', 'coffee', 'caffeine', 'sommeil'],
    { habitSuggestions: ['Dernière caféine 15h'], mechanism: 'adénosine' }),
  P('p-magnesium', 'Magnésium glycinate pour le sommeil',
    'PubMed / Huberman Lab', 'Huberman',
    'Le magnésium peut apaiser l’éveil et faciliter l’endormissement chez certaines personnes.',
    'C', 'sleep', '300-400 mg de magnésium (glycinate) le soir, avec un médecin.',
    ['magnésium', 'magnesium', 'sommeil', 'sleep', 'supplément', 'supplement', 'endormissement'],
    { metric: 'temps d’endormissement', habitSuggestions: ['Magnésium le soir'], risky: true }),
  P('p-creatine', 'Créatine pour la cognition',
    'PubMed (créatine & cognition)', 'PubMed',
    'La créatine améliore mémoire de travail et récupération sous charge cognitive.',
    'B', 'cognitive', '3-5 g de créatine monohydrate par jour (avec un médecin).',
    ['créatine', 'creatine', 'mémoire', 'memory', 'focus', 'cognition'],
    { metric: 'focus 1-10', habitSuggestions: ['Créatine quotidienne'], risky: true }),
  P('p-omega3', 'Oméga-3 EPA/DHA',
    'PubMed / Huberman Lab', 'Huberman',
    'Un bon ratio EPA/DHA soutient l’humeur et la santé cérébrale.',
    'B', 'nutrition', '~1-2 g EPA + DHA par jour (source de qualité).',
    ['oméga', 'omega', 'epa', 'dha', 'poisson', 'fish', 'humeur', 'cerveau'],
    { metric: 'humeur 1-10', habitSuggestions: ['Oméga-3'], risky: true }),
  P('p-zone2', 'Cardio Zone 2',
    'Peter Attia / Huberman Lab', 'Huberman',
    'Le cardio en zone 2 améliore la santé métabolique et l’endurance fondamentale.',
    'A', 'training', '3-4 sessions/semaine, 45-60 min, allure conversationnelle (FC ~60-70 % max).',
    ['zone 2', 'cardio', 'vélo', 'bike', 'endurance', 'métabolique', 'course'],
    { habitSuggestions: ['Cardio Zone 2'], mechanism: 'mitochondries' }),
  P('p-time-restricted', 'Alimentation en fenêtre (TRF)',
    'Huberman Lab / PubMed', 'Huberman',
    'Restreindre la fenêtre alimentaire peut améliorer l’énergie et la régulation glycémique.',
    'C', 'nutrition', 'Fenêtre de 8-10h (ex. 10h→18-20h), pas de collation nocturne.',
    ['fenêtre', 'jeûne', 'fasting', 'jeune', 'glycémie', 'glucose', 'alimentation'],
    { metric: 'énergie 1-10', habitSuggestions: ['Fenêtre alimentaire'], risky: true }),
  P('p-breathwork', 'Respiration cohérente (4-6 / 4-6)',
    'Research / biohacking', 'Chr. Williamson',
    'La respiration lente et prolongée active le parasympathique et réduit le stress perçu.',
    'A', 'stress', '5-10 min de respiration, expiration plus longue que l’inspiration.',
    ['respiration', 'breath', 'respi', 'box', 'cohérente', 'stress', 'calme', 'anxieux'],
    { habitSuggestions: ['Respiration lente'], mechanism: 'parasympathique' }),
  P('p-expressive-writing', 'Écriture expressive',
    'Pennebaker (études), Modern Wisdom', 'Chr. Williamson',
    'Écrire sur une difficulté 15-20 min améliore l’humeur et réduit le stress ruminaitif.',
    'A', 'mood', '15-20 min d’écriture libre sur un sujet qui pèse, sans relire.',
    ['écriture', 'writing', 'journal', 'pensées', 'rumination', 'cathartique'],
    { habitSuggestions: ['Écriture expressive'], mechanism: 'réévaluation' }),
  P('p-social', 'Connexion sociale régulière',
    'Littérature santé (Modern Wisdom)', 'Chr. Williamson',
    'L’isolement chronique est un facteur de santé aussi important que de nombreux comportements.',
    'A', 'social', '1 contact social « de qualité » par jour ou 3-4 par semaine.',
    ['social', 'amis', 'friends', 'famille', 'family', 'lien', 'solitude', 'connexion'],
    { habitSuggestions: ['Contact social'], mechanism: 'appartenance' }),
  P('p-sauna', 'Chaleur délibérée (sauna)',
    'Huberman Lab / études finlandaises', 'Huberman',
    'Une exposition régulière à la chaleur soutient la santé cardio-vasculaire et le stress.',
    'B', 'stress', '2-4 séances/semaine, 10-20 min, à une chaleur supportable.',
    ['sauna', 'chaleur', 'heat', 'cardio-vasculaire', 'récupération'],
    { metric: 'récupération 1-10', risky: true }),
  P('p-neat', 'Mouvement quotidien (NEAT)',
    'PubMed', 'PubMed',
    'L’activité légère de la journée compte autant que l’entraînement pour l’énergie.',
    'A', 'energy', '6000-10000 pas/jour, debout régulièrement.',
    ['pas', 'steps', 'marche', 'walk', 'neat', 'bouger', 'mouvement', 'sédentaire'],
    { habitSuggestions: ['Marche quotidienne'] }),
  P('p-digital-sunset', 'Coucher de soleil numérique (lumière bleue)',
    'Huberman Lab / optométrie', 'Huberman',
    'Limiter la lumière bleue en soirée soutient la mélatonine et l’endormissement.',
    'B', 'sleep', 'Écrans en mode nuit 1-2h avant le coucher, lumière tamisée.',
    ['lumière bleue', 'écrans', 'screens', 'bleu', 'mélatonine', 'soir', 'téléphone'],
    { habitSuggestions: ['Mode nuit le soir'] }),
  P('p-reading-before-bed', 'Lecture avant le coucher',
    'Hygiène du sommeil', 'PubMed',
    'S’éloigner des écrans avec une lecture calme améliore l’endormissement.',
    'C', 'sleep', '10-20 min de lecture (papier) dans les 30-60 min avant de dormir.',
    ['lecture', 'reading', 'livre', 'book', 'coucher', 'sommeil'],
    { habitSuggestions: ['Lecture au lit'] }),
];

export const DOMAIN_LABEL: Record<ProtocolDomain, string> = {
  sleep: 'Sommeil',
  focus: 'Focus',
  energy: 'Énergie',
  mood: 'Humeur',
  training: 'Entraînement',
  nutrition: 'Nutrition',
  stress: 'Stress',
  social: 'Social',
  cognitive: 'Cognitif',
};

/** Number of protocol keyword hits in a set of texts (lowercased). */
export function protocolKeywordHits(protocol: Protocol, texts: string[]): number {
  const hay = texts.map((t) => t.toLowerCase());
  let hits = 0;
  for (const kw of protocol.keywords) {
    const lower = kw.toLowerCase();
    if (hay.some((h) => h.includes(lower))) hits++;
  }
  return hits;
}

/**
 * 1-Click adoption of a protocol: automatically creates missing linked habits,
 * populates target goals, and attaches the evidence claim as Simon Sinek intention ("WHY").
 */
export function adoptProtocol(
  protocolId: string,
  allProtocols: Protocol[] = SEED_PROTOCOLS,
  storeHabits: import('./types').Habit[] = [],
  onAddHabit?: (_habitData: Partial<import('./types').Habit>) => import('./types').Habit
): { created: import('./types').Habit[]; existing: import('./types').Habit[] } {
  const proto = allProtocols.find((p) => p.id === protocolId);
  if (!proto) return { created: [], existing: [] };

  const suggestions = proto.habitSuggestions && proto.habitSuggestions.length > 0
    ? proto.habitSuggestions
    : [proto.title];

  const created: import('./types').Habit[] = [];
  const existing: import('./types').Habit[] = [];

  for (const suggestion of suggestions) {
    const normalized = suggestion.toLowerCase().trim();
    const found = storeHabits.find((h) => h.name.toLowerCase().trim() === normalized);

    if (found) {
      existing.push(found);
    } else if (onAddHabit) {
      const newHabit = onAddHabit({
        name: suggestion,
        goal: 1,
        why: [proto.claim],
      });
      if (newHabit) created.push(newHabit);
    }
  }

  return { created, existing };
}


