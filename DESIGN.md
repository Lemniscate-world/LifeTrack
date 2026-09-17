# LifeTrack — DESIGN.md (source de vérité vivante)
> v2.0 — 2026-08-22. Remplace « Ledger Brutal » (retiré à la demande produit).
> Règle permanente : kuro-rules `rule_108_design_language` (gate Impeccable §R108.0 conservé).

## Identité : **Quiet Precision**
Précision calme. Interface dense mais respirante, neutre et chaleureuse — la
confiance d'un outil pro, pas l'agressivité d'un manifeste. La couleur reste
une DONNÉE (humeur, heatmap, états), jamais une décoration.

## Tokens
| Token | Valeur | Note |
|---|---|---|
| `--radius` | 6px (8px mobile) | douceur par défaut ; aucun forçage à 0 |
| `--shadow-sm` | 0 1px 3px ink@12% + 0 1px 2px ink@8% | élévation discrète |
| `--shadow-md` | 0 6px 18px ink@14% | modales, toasts |
| Bordures | 1px standard · 2px pour sépareurs structurels | |
| Accents couleur | données uniquement | pas de gradients décoratifs |

## Typo
Inter/system-ui · échelle 10/11/12/13.5/15/18 · titres 700 sans majuscules
forcées · chiffres & stats en mono (`ui-monospace`) dans des boîtes bordées.

## Composants signatures (conservés du v1, adoucis)
Cartes à rail gauche 3px · zébrure `nth-child(even)` subtile (55% bg-alt) ·
barre d'en-tête contrastée SANS uppercase forcé · cellule pleine = fait ·
mini-calendrier de plan (action plein / vigilance cerclé) · directive du jour
en bloc contrasté · chips médailles 1 ligne.

## Motion
`cubic-bezier(0.2,0,0,1)` 150–250ms · transitions thème 0.4s bg/color/border ·
pulse réservé streak ≥3.

## Interdictions (toujours)
Gradients décoratifs · glassmorphism/backdrop-blur · glow/néon · violet par
défaut · nombre affiché sans contexte (n/p/fenêtre) · texte EN quand
l'utilisateur parle FR.

## Gate qualité (R108.0)
`npx -y impeccable detect src/` avant chaque milestone visuel. Exceptions →
les documenter ici, sinon rejet.

### Exceptions documentées
- **Rail chaos 3px (`.chaos-card::before`)** : la couleur du rail EST la donnée
  (identifie la dimension : Social, Finances, Estime… — voir
  `chaosDimensions.ts`, « data-only color »). Exprimé en pseudo-élément dédié
  plutôt qu'en `border-left`/`inset box-shadow` pour un rendu net sur les
  coins arrondis. Retiré de la portée `side-tab` à dessein : ce n'est pas un
  « tell » décoratif mais l'encodage couleur de l'information.
