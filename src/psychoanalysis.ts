/**
 * Psychoanalysis module — local, zero-cloud.
 *
 * A curated library of well-established negative thinking / self-sabotage
 * patterns drawn from evidence-based psychology:
 *   - cognitive distortions (Aaron Beck, David Burns — "Feeling Good"),
 *   - classic psychoanalytic defenses (avoidance, rationalization),
 *   - impostor syndrome (Clance & Imes, 1978).
 *
 * The detector scans the user's OWN notes (check-in notes + standalone notes +
 * urge reflections) for keywords and surfaces the patterns at play, with a
 * concrete "counter" for each so the user can work on destroying them.
 *
 * Privacy: everything stays on-device. No user data leaves the app.
 */

import type { CheckIn, Note, UrgeEntry } from './types';
import { moodRank } from './correlations';
import { welchTwoSample } from './leverInsights';

export interface NegativePattern {
  id: string;
  name: string;
  emoji: string;
  description: string;
  source: string; // where this pattern is established in the literature
  counter: string; // how to fight / "destroy" it
  keywords: string[]; // fr + en keywords matched case-insensitively
}

/** Evidence-based negative patterns. Sources are named so the user can verify. */
export const NEGATIVE_PATTERNS: NegativePattern[] = [
  {
    id: 'catastrophizing',
    name: 'Catastrophisation',
    emoji: '🌋',
    description:
      "Prévoir le pire scénario possible et le traiter comme inévitable (« si j'échoue, tout est foutu »).",
    source: 'Aaron Beck — cognitive distortion (thérapie cognitive)',
    counter:
      "Décrivez le pire cas réel, puis le meilleur cas, puis le plus probable. Remplacez la pensée « tout est foutu » par une hypothèse testable à petit pas.",
    keywords: ['catastrophe', 'foutu', 'ruiné', 'horrible', 'insupportable', 'la fin', 'je vais échouer', 'tout est fini', 'disaster', 'catastrophic', 'ruined', 'it\'s over'],
  },
  {
    id: 'all_or_nothing',
    name: 'Tout ou rien',
    emoji: '⚫⚪',
    description:
      'Penser en noir et blanc : un échec partiel est vécu comme un échec total.',
    source: 'Aaron Beck / David Burns — « all-or-nothing thinking »',
    counter:
      'Notez le degré entre 0 et 100 % plutôt qu\'en binaire. Une journée « ratée » est souvent une journée à 60 % — c\'est un score, pas une identité.',
    keywords: ['tout ou rien', 'echec total', 'soit je', 'soit j\'', 'parfait ou rien', 'j\'ai tout raté', 'tout rater', 'all or nothing', 'perfect or nothing', 'totally failed'],
  },
  {
    id: 'should_statements',
    name: 'Surobligation (« je devrais »)',
    emoji: '⛓️',
    description:
      'Se mettre la pression avec des règles internes inflexibles (« je devrais toujours être productif »).',
    source: 'David Burns — « should statements », thérapie cognitive',
    counter:
      'Remplacez « je devrais » par « je choisis de » ou « j\'aimerais ». Une préférence laisse place à l\'erreur ; une obligation ne le permet pas.',
    keywords: ['je devrais', 'je dois', 'il faudrait que', 'j\'aurais dû', 'je suis censé', 'i should', 'i must', 'i ought'],
  },
  {
    id: 'overgeneralization',
    name: 'Sur-généralisation',
    emoji: '📉',
    description:
      'Tirer une conclusion générale et permanente d\'un seul événement (« je n\'y arriverai jamais »).',
    source: 'Aaron Beck — cognitive distortion',
    counter:
      'Cherchez un contre-exemple concret : une fois où cela a marché. Une donnée ne fait pas une loi.',
    keywords: ['jamais', 'toujours', 'personne', 'tout le monde', 'je n\'y arriverai', 'je suis nul', 'rien ne marche', 'toujours la même', 'never', 'always', 'i always fail'],
  },
  {
    id: 'personalization',
    name: 'Personnalisation',
    emoji: '🎯',
    description:
      'Attribuer à soi-même des événements qui dépendent surtout du contexte ou des autres.',
    source: 'Aaron Beck — cognitive distortion',
    counter:
      'Listez les facteurs externes probables. Posez-vous la question : « est-ce vraiment sur moi, ou est-ce la situation ? »',
    keywords: ['c\'est de ma faute', 'c\'est à cause de moi', 'je suis le problème', 'j\'ai tout gâché', 'c\'est ma faute', 'my fault', 'it\'s because of me'],
  },
  {
    id: 'mental_filter',
    name: 'Filtre mental',
    emoji: '🕶️',
    description:
      'Ne retenir que les aspects négatifs et ignorer les progrès ou les réussites.',
    source: 'Aaron Beck — cognitive distortion',
    counter:
      'Tenez un journal des preuves positives : chaque soir, notez 3 micro-victoires réelles. Le filtre s\'alimente de ce que vous décidez de regarder.',
    keywords: ['trop nul', 'c\'était nul', 'j\'ai rien fait de bien', 'que des problèmes', 'tout va mal', 'rien de positif', 'nothing good', 'everything is bad'],
  },
  {
    id: 'procrastination_avoidance',
    name: 'Évitement / procrastination',
    emoji: '⏳',
    description:
      'Reporter par peur de l\'inconfort : l\'anxiété de la tâche prend le dessus sur l\'action.',
    source: 'Psychanalyse — mécanisme d\'évitement ; thérapie comportementale',
    counter:
      'Réduisez la tâche à 2 minutes (« version minimale »). L\'anxiété baisse dès que l\'action commence. L\'évitement renforce l\'anxiété ; l\'action la réduit.',
    keywords: ['je remets', 'je procrastine', 'je verrai plus tard', 'pas envie de', 'je n\'ose pas', 'j\'évite', 'je repousse', 'demain', 'procrastin', 'avoid', 'put it off', 'can\'t start'],
  },
  {
    id: 'self_sabotage',
    name: 'Auto-sabotage',
    emoji: '💣',
    description:
      'Créer (inconsciemment) les conditions de l\'échec juste avant un succès possible : peur de réussir, peur du changement.',
    source: 'Psychanalyse — « The Psychology of Self-Sabotage », sabotage inconscient',
    counter:
      'Quand le succès approche, notez ce que vous faites pour le freiner (retards, conflits, perfectionnisme). Nommer le mécanisme suffit souvent à l\'affaiblir.',
    keywords: ['je me sabote', 'je me complique', 'je fais exprès', 'je me tire une balle', 'self-sabotage', 'sabotage', 'je gâche tout au dernier moment'],
  },
  {
    id: 'toxic_comparison',
    name: 'Comparaison toxique',
    emoji: '⚖️',
    description:
      'Se comparer aux autres (réseaux sociaux, collègues) sur des critères où l\'on perd toujours.',
    source: 'Psychologie sociale — comparaison sociale (Festinger, 1954)',
    counter:
      'Comparez-vous à vous-même d\'il y a un an, pas aux autres. Limitez les flux qui déclenchent la comparaison.',
    keywords: ['lui il', 'elle elle', 'les autres ont', 'ils réussissent', 'tout le monde avance', 'je suis en retard sur', 'compare', 'others are', 'everyone else'],
  },
  {
    id: 'excessive_guilt',
    name: 'Culpabilité excessive',
    emoji: '🥀',
    description:
      'Ressasser une erreur passée et s\'en punir de façon répétée sans apprentissage.',
    source: 'Thérapie cognitive — rumination & culpabilité',
    counter:
      'Transformez la culpabilité en leçon : « qu\'est-ce que je fais différemment la prochaine fois ? » La culpabilité est une alarme, pas une condamnation.',
    keywords: ['je me sens coupable', 'j\'aurais dû', 'je regrette', 'je n\'aurais jamais dû', 'c\'est de ma faute', 'guilt', 'guilty', 'i regret'],
  },
  {
    id: 'impostor_syndrome',
    name: 'Syndrome de l\'imposteur',
    emoji: '🎭',
    description:
      'Penser que ses réussites sont dues à la chance et craindre d\'être « démasqué ».',
    source: 'Clance & Imes (1978) — impostor phenomenon',
    counter:
      'Recueillez les preuves objectives de votre compétence (réalisations, feedbacks). L\'imposteur ignore ses preuves ; vous les avez sous les yeux.',
    keywords: ['imposteur', 'par chance', 'j\'ai eu de la chance', 'ils vont découvrir', 'je ne mérite pas', 'je fais semblant', 'impostor', 'imposter', 'by luck', 'don\'t deserve'],
  },
  {
    id: 'mind_reading',
    name: 'Lecture de pensée',
    emoji: '🔮',
    description:
      'Croire savoir ce que les autres pensent (négativement) de soi sans aucune preuve.',
    source: 'Aaron Beck — cognitive distortion',
    counter:
      'Vérifiez auprès de la personne concernée, ou restez sur des faits. La pensée n\'est pas un fait.',
    keywords: ['il pense que', 'elle doit penser', 'ils doivent me juger', 'il me juge', 'tout le monde me regarde', 'they think i', 'he thinks', 'she thinks', 'they judge me'],
  },
];

/** Normalized text for keyword matching (lowercase, accents stripped). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[œ]/g, 'oe')
    .replace(/[æ]/g, 'ae');
}

export interface PatternHit {
  pattern: NegativePattern;
  count: number;
  sample: string; // first matching evidence snippet
}

/** Collect every raw text snippet the user has written about their life. */
export function collectUserTexts(checkIns: CheckIn[], notes: Note[], urges: UrgeEntry[]): string[] {
  const texts: string[] = [];
  for (const ci of checkIns) {
    for (const n of ci.notes ?? []) if (n && n.trim()) texts.push(n.trim());
    const legacy = (ci as unknown as Record<string, unknown>).note;
    if (typeof legacy === 'string' && legacy.trim()) texts.push(legacy.trim());
  }
  for (const n of notes) if (n && n.content && n.content.trim()) texts.push(n.content.trim());
  for (const u of urges) {
    if (u.note && u.note.trim()) texts.push(u.note.trim());
    if (u.trigger && u.trigger.trim()) texts.push(u.trigger.trim());
  }
  return texts;
}

/**
 * Detect which negative patterns appear in the user's own writing.
 * Returns hits sorted by number of matches (most present first).
 */
export function detectNegativePatterns(checkIns: CheckIn[], notes: Note[], urges: UrgeEntry[]): PatternHit[] {
  const texts = collectUserTexts(checkIns, notes, urges);
  if (texts.length === 0) return [];
  const normalized = texts.map((t) => normalize(t));

  const hits: PatternHit[] = [];
  for (const pattern of NEGATIVE_PATTERNS) {
    let count = 0;
    let sample = '';
    for (let i = 0; i < normalized.length; i++) {
      let occurrences = 0;
      for (const kw of pattern.keywords) {
        const nk = normalize(kw);
        // Count each occurrence of the keyword in this text
        let idx = normalized[i].indexOf(nk);
        while (idx !== -1) {
          occurrences++;
          idx = normalized[i].indexOf(nk, idx + nk.length);
        }
      }
      if (occurrences > 0) {
        count += occurrences;
        if (!sample) sample = texts[i];
      }
    }
    if (count > 0) {
      hits.push({ pattern, count, sample });
    }
  }
  // Ignore sub-string overlap noise: all_or_nothing vs overgeneralization both
  // match "je n'y arriverai jamais" — we keep both but sort by count.
  hits.sort((a, b) => b.count - a.count);
  return hits;
}

/** Count how many distinct patterns were detected (for the UI badge). */
export function detectPatternCount(checkIns: CheckIn[], notes: Note[], urges: UrgeEntry[]): number {
  return detectNegativePatterns(checkIns, notes, urges).length;
}

/** A per-period breakdown of negative-pattern occurrences. */
export interface TrendPeriod {
  /** Monday of the week, as YYYY-MM-DD. */
  weekStart: string;
  /** Short human label, e.g. "05 août". */
  label: string;
  /** Total negative-pattern hits logged that week. */
  total: number;
  /** Per-pattern occurrence counts (only patterns present that week). */
  counts: { patternId: string; count: number }[];
}

/** ZIP-coded date of a text snippet so we can bucket it by week. */
interface DatedText {
  date: string; // YYYY-MM-DD
  text: string;
}

/** Gather every snippet with the date it was written (best-effort). */
function collectDatedTexts(checkIns: CheckIn[], notes: Note[], urges: UrgeEntry[]): DatedText[] {
  const out: DatedText[] = [];
  for (const ci of checkIns) {
    for (const n of ci.notes ?? []) if (n && n.trim()) out.push({ date: ci.date, text: n.trim() });
    const legacy = (ci as unknown as Record<string, unknown>).note;
    if (typeof legacy === 'string' && legacy.trim()) out.push({ date: ci.date, text: legacy.trim() });
  }
  const slice = (iso: unknown): string =>
    typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
  for (const n of notes) {
    const d = slice(n.createdAt);
    if (d && n.content && n.content.trim()) out.push({ date: d, text: n.content.trim() });
  }
  for (const u of urges) {
    const d = slice(u.startTime);
    if (!d) continue;
    if (u.note && u.note.trim()) out.push({ date: d, text: u.note.trim() });
    if (u.trigger && u.trigger.trim()) out.push({ date: d, text: u.trigger.trim() });
  }
  return out;
}

/** Returns the Monday (YYYY-MM-DD) of the week containing a YYYY-MM-DD date. */
function weekStartOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map((n) => Number(n));
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 (Sun) .. 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** French short label for a week start, e.g. "05 août". */
function shortLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map((n) => Number(n));
  return `${String(d).padStart(2, '0')} ${['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'][m - 1] ?? ''}`;
}

const OVERLAP_SKIP = new Set(['overgeneralization', 'excessive_guilt']);

/**
 * Weekly evolution of negative patterns over time.
 *
 * Splits the user's writing into ISO weeks (oldest → newest) and counts key
 * pattern occurrences per week, returning a trend the user can read: are the
 * patterns that once dominated still present, or are they declining?
 *
 * Deterministic and local. Only includes weeks that actually contain writing.
 */
export function patternTrend(checkIns: CheckIn[], notes: Note[], urges: UrgeEntry[]): TrendPeriod[] {
  const items = collectDatedTexts(checkIns, notes, urges)
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && !Number.isNaN(new Date(t.date).getTime()));
  if (items.length === 0) return [];

  const buckets = new Map<string, string[]>();
  for (const item of items) {
    const wk = weekStartOf(item.date);
    const arr = buckets.get(wk) ?? [];
    arr.push(item.text);
    buckets.set(wk, arr);
  }

  const weeks = [...buckets.keys()].sort();
  const trend: TrendPeriod[] = [];
  for (const wk of weeks) {
    const texts = buckets.get(wk) ?? [];
    let total = 0;
    const counts = new Map<string, number>();
    for (const pattern of NEGATIVE_PATTERNS) {
      if (OVERLAP_SKIP.has(pattern.id)) continue;
      let count = 0;
      for (const t of texts) {
        const nt = normalize(t);
        for (const kw of pattern.keywords) {
          const nk = normalize(kw);
          let idx = nt.indexOf(nk);
          while (idx !== -1) {
            count++;
            idx = nt.indexOf(nk, idx + nk.length);
          }
        }
      }
      if (count > 0) {
        counts.set(pattern.id, count);
        total += count;
      }
    }
    trend.push({
      weekStart: wk,
      label: shortLabel(wk),
      total,
      counts: [...counts.entries()]
        .map(([patternId, count]) => ({ patternId, count }))
        .sort((a, b) => b.count - a.count),
    });
  }
  return trend;
}

// --- Deeper analysis: does a pattern co-occur with lower mood? ------------
// Deterministic, local, grounded in the user's own writing + mood logs.
// For every detected pattern we split the days where the user wrote something
// into "days where this pattern appears" vs "days where it does not", then
// Welch-test the mood rank of both groups. A significant NEGATIVE delta means
// the pattern is associated with lower-than-usual mood.

export interface PatternMoodImpact {
  patternId: string;
  name: string;
  emoji: string;
  hasDays: number;    // days with the pattern AND a mood logged
  noDays: number;     // days with writing + mood but without this pattern
  meanWith: number;   // mean mood rank on pattern days
  meanWithout: number;// mean mood rank on non-pattern days
  delta: number;      // meanWith − meanWithout (negative = lower mood)
  p: number;
  significant: boolean;
}

/** Date-keyed pattern hits (only dates that produced at least one match). */
function patternDatesByPattern(
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
): Map<string, Set<string>> {
  const byPattern = new Map<string, Set<string>>();
  const items = collectDatedTexts(checkIns, notes, urges);
  for (const pattern of NEGATIVE_PATTERNS) {
    const dates = new Set<string>();
    for (const item of items) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
      const nt = normalize(item.text);
      for (const kw of pattern.keywords) {
        if (nt.includes(normalize(kw))) {
          dates.add(item.date);
          break;
        }
      }
    }
    if (dates.size > 0) byPattern.set(pattern.id, dates);
  }
  return byPattern;
}

/**
 * For each detected pattern, compare the mood on days where the pattern appears
 * against days where the user wrote but the pattern does not. Returns impacts
 * sorted by most negative delta (pattern most associated with bad mood first).
 * Empty mood data → [].
 */
export function patternMoodImpact(
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
  moods: Record<string, string>,
): PatternMoodImpact[] {
  const byPattern = patternDatesByPattern(checkIns, notes, urges);
  // Every date in the writing pool that also has a mood → comparison baseline.
  const moodDays = new Set(Object.keys(moods).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  const impacts: PatternMoodImpact[] = [];

  for (const pattern of NEGATIVE_PATTERNS) {
    const dates = byPattern.get(pattern.id);
    if (!dates) continue;
    const withMood: number[] = [];
    const withoutMood: number[] = [];
    for (const date of moodDays) {
      const r = moodRank(moods[date]);
      if (dates.has(date)) withMood.push(r);
      else withoutMood.push(r);
    }
    const w = welchTwoSample(withMood, withoutMood);
    if (!w) continue;
    impacts.push({
      patternId: pattern.id,
      name: pattern.name,
      emoji: pattern.emoji,
      hasDays: withMood.length,
      noDays: withoutMood.length,
      meanWith: w.meanA,
      meanWithout: w.meanB,
      delta: w.meanA - w.meanB, // negative → pattern days have lower mood
      p: w.p,
      significant: w.significant,
    });
  }

  return impacts.sort((a, b) => a.delta - b.delta);
}

// --- Automatic questions --------------------------------------------------
// A curated, deterministic question bank so the user never faces an empty chat:
// the app proposes the most relevant questions for the patterns it detected.

export interface SuggestedQuestion {
  id: string;
  patternId: string | null; // null → general opening question
  question: string;
}

/** Per-pattern questions, in French, phrased to start a working dialogue. */
const QUESTION_BANK: Record<string, string[]> = {
  catastrophizing: [
    'Ce week-end, j\'ai prédit le pire : qu\'est-ce qui est arrivé en vrai ?',
    'Quelle preuve concrète contredit mon scénario catastrophe ?',
    'Décris le pire cas réel, le meilleur cas, puis le plus probable.',
  ],
  all_or_nothing: [
    'Où suis-je entre 0 et 100 % aujourd\'hui, plutôt que tout-ou-rien ?',
    'Quel est le « 60 % » de cette journée que je traite comme un échec total ?',
  ],
  should_statements: [
    'Quel « je devrais » me mets la pression en ce moment ?',
    'Transforme ce « je devrais » en choix libre : « je choisis de… ».',
  ],
  overgeneralization: [
    'Donne-moi un contre-exemple récent où ça a marché.',
    'Sur quoi exactement je généralise à partir d\'un seul événement ?',
  ],
  personalization: [
    'Est-ce vraiment sur moi, ou est-ce surtout la situation ?',
    'Quels facteurs externes expliquent aussi ce qui s\'est passé ?',
  ],
  mental_filter: [
    'Nomme 3 micro-victoires réelles d\'aujourd\'hui que j\'ai ignorées.',
    'Qu\'est-ce qui a bien marché malgré ce que je retiens ?',
  ],
  procrastination_avoidance: [
    'Quelle est la version « 2 minutes » de la tâche que j\'évite ?',
    'De quoi ai-je peur derrière ce report ?',
  ],
  self_sabotage: [
    'Que suis-je en train de faire qui freine mon succès imminent ?',
    'Quel inconfort ma réussite m\'apporterait-elle ?',
  ],
  toxic_comparison: [
    'À qui est-ce que je me compare, et sur quel critère où je perds toujours ?',
    'Compare-moi à moi-même d\'il y a un an : qu\'est-ce qui a changé ?',
  ],
  excessive_guilt: [
    'Qu\'est-ce que je fais différemment la prochaine fois, plutôt que de me punir ?',
    'Quelle est la leçon récupérable derrière cette culpabilité ?',
  ],
  impostor_syndrome: [
    'Quelles preuves objectives de ma compétence est-ce que j\'ignore ?',
    'Et si mes résultats n\'étaient pas dus à la chance — à quoi ?',
  ],
  mind_reading: [
    'Quelle preuve ai-je que les autres pensent ça de moi ?',
    'Comment vérifier cette supposition sans supposer ?',
  ],
};

const GENERAL_QUESTIONS: { id: string; question: string }[] = [
  { id: 'general-1', question: 'Quel est le schéma récurrent qui me coûte le plus en ce moment ?' },
  { id: 'general-2', question: 'Comment mes notes évoluent-elles : vais-je mieux ou moins bien ?' },
  { id: 'general-3', question: 'Quel serait le premier petit changement que je peux faire cette semaine ?' },
];

/**
 * Deterministic automatic questions. Always surfaces 2 questions for the top
 * detected patterns (by count) and 1 general opener when the user has written
 * at least one note, so the chat is never empty. No AI call needed.
 */
export function suggestedQuestions(
  checkIns: CheckIn[],
  notes: Note[],
  urges: UrgeEntry[],
): SuggestedQuestion[] {
  const hits = detectNegativePatterns(checkIns, notes, urges).slice(0, 2);
  const out: SuggestedQuestion[] = [];
  for (const hit of hits) {
    const bank = QUESTION_BANK[hit.pattern.id] ?? [];
    if (bank.length === 0) continue;
    out.push({ id: `${hit.pattern.id}-q1`, patternId: hit.pattern.id, question: bank[0] });
    if (bank.length > 1) {
      out.push({ id: `${hit.pattern.id}-q2`, patternId: hit.pattern.id, question: bank[1] });
    }
  }
  if (collectUserTexts(checkIns, notes, urges).length > 0) {
    const general = GENERAL_QUESTIONS[0];
    out.push({ id: general.id, patternId: null, question: general.question });
  }
  return out.slice(0, 4);
}
