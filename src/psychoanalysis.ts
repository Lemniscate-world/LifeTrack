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
