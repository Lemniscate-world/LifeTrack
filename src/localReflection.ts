// src/localReflection.ts
// Offline fallback for the journal. When no AI provider is reachable (browser
// preview, Ollama stopped, no API key), LifeTrack still needs to reflect back —
// and crucially STILL RECORD the entry so the journal never loses a word.
// Deterministic, templated, persona-aware. No network, no AI.

import type { JournalPersonality } from './types';

function excerpt(content: string, max = 140): string {
  const t = content.trim();
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

/** Count words to adapt the response length honestly. */
function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const OPENERS: Record<JournalPersonality, string> = {
  coach: 'Je t\'ai entendu·e. Voici ce que je note, simplement.',
  sage: 'Prenons un peu de hauteur sur ce que tu viens d\'écrire.',
  psychologist: 'Ce que tu écris mérite d\'être accueilli sans jugement.',
  strategist: 'Il y a une structure dans ce que tu racontes. La regardons-nous ?',
  'robert-greene': 'Observe ce qui se joue ici, sans complaisance.',
  huberman: 'Traduisons ce que tu décris en mécanique et en protocole.',
};

const REFRAMES: Record<JournalPersonality, string> = {
  coach: 'Qu\'est-ce que cette situation t\'apprend sur ce que tu veux vraiment — et quelle est la plus petite action que tu peux faire aujourd\'hui pour avancer ?',
  sage: 'Si tu regardais ce moment depuis dix ans dans le futur, qu\'est-ce qui compterait vraiment ici ?',
  psychologist: 'Quelle émotion précise est présente sous ce que tu décris, et que dirais-tu à un ami qui vit la même chose ?',
  strategist: 'Quelle est l\'obstacle réel (pas le symptôme), et quelles sont tes trois options classées par effort décroissant ?',
  'robert-greene': 'Quelle vérité inconfortable sur toi-même se cache dans cette page — et que gagnes-tu à la regarder en face ?',
  huberman: 'Quel système est impliqué ici (stress, dopamine, sommeil) — et quel est le protocole de base que tu peux appliquer dès aujourd\'hui ?',
};

const CLOSERS: Record<JournalPersonality, string> = {
  coach: 'Ta prochaine action, même minuscule, est ta boussole.',
  sage: 'La réponse est déjà en toi. Donne-toi le temps de la voir.',
  psychologist: 'Tu n\'es pas seul·e là-dedans. Ce que tu écris, beaucoup l\'ont vécu.',
  strategist: 'Le plan le plus simple est celui que tu tiendras.',
  'robert-greene': 'La maîtrise commence par se voir tel que l\'on est.',
  huberman: 'Un geste régulier bat un grand geste unique. Commence petit.',
};

/** Local, deterministic reflection — used when no AI provider is available. */
export function localReflection(content: string, personality: JournalPersonality): string {
  const words = wordCount(content);
  const excerpted = excerpt(content);
  const intro = OPENERS[personality];
  const reframe = REFRAMES[personality];
  const closer = CLOSERS[personality];

  let acknowledgement: string;
  if (words <= 4) {
    acknowledgement = `Tu écris : « ${excerpted} ». Même en peu de mots, il y a quelque chose à saisir.`;
  } else {
    acknowledgement = `Tu écris : « ${excerpted} ».`;
  }

  return `${intro}\n\n${acknowledgement}\n\n${reframe}\n\n${closer}\n\n_(Réflexion hors-ligne — configure un fournisseur IA dans Réglages pour une réponse plus profonde.)_`;
}

/** The local reflection is always usable, but we say so in the UI. */
export const LOCAL_REFLECTION_NOTE = 'Réflexion hors-ligne';
