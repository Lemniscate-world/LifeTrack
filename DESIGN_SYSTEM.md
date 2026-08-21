# LifeTrack Design System — « Ledger Brutal »
> Version 1.0 — 2026-08-20. Langage de design propriétaire de LifeTrack.
> Toute nouvelle surface UI DOIT suivre ces règles. Résumé permanent dans kuro-rules `rule_108_design_language`.

## 1. Identité
Monochrome éditorial inspiré des **livres de comptes imprimés** et du **brutalisme typographique** : encre noire sur papier blanc (ou l'inverse), traits nets, zéro dégradé décoratif, zéro violet « IA ». La couleur n'existe que comme donnée (humeur, heatmap) — jamais comme décoration.

## 2. Tokens (CSS variables)
| Token | Clair | Sombre | Règle |
|---|---|---|---|
| `--bg` | `#ffffff` | `#000000` | fond papier/encre |
| `--surface` | `#ffffff` | `#121212` | cartes |
| `--text` | `#000000` | `#ffffff` | encre |
| `--border` | `#000000` | `#ffffff` | trait d'imprimerie, 1–2px |
| `--radius` | `0px` | `0px` | coins vifs TOUJOURS en thème B&W |
| `--shadow-sm/md` | `2px/4px 2px/4px 0 ink@85%` | idem blanc | ombres DURES décalées, jamais de blur |

Autres thèmes : autorisés mais suivent la même grille d'espacement et l'échelle typo.

## 3. Typographie
- Échelle stricte : 6 / 8 / 10 / 11 / 12 / 13.5 / 15 / 18 px (grid dense → titres).
- Titres de section : `800`, `uppercase`, `letter-spacing 0.02–0.08em`, soulignés d'un trait 2px en B&W.
- Chiffres & stats : `ui-monospace` (`.deep-stat`) — une stat = une boîte à bordure pleine.

## 4. Composants signatures
1. **Barre d'encre d'en-tête** (`thead tr` noir/blanc inversé, lettres espacées).
2. **Cellule d'encre** (`day-cell.checked` remplie plein noir/blanc; streak = intensité gris→encre).
3. **Carte ledger** (`.deep-card`) : bord gauche 4px encre + hard shadow + ligne `stat` monospace.
4. **Zébrure ledger** : `tbody tr:nth-child(even)` en `--bg-alt`.
5. **Mini-calendrier de plan** (`.mini-cal`) : jours planifiés remplis encre, aujourd'hui cerclé.
6. **Cercle d'action dans la grille** (`.plan-target`) : double contour pointillé — l'app POINTE le jour, l'œil suit.
7. **Rails de stack** : parent `⤵`, enfants indentés avec `↳` sur rail vertical.

## 5. Motion
- Une seule courbe : `cubic-bezier(0.2, 0, 0, 1)` 150–250ms.
- Transitions thème : `background-color, color, border-color 0.4s`.
- Pulse réservé au badge streak ≥3 (1.6s ease-in-out). Rien d'autre ne clignote.

## 6. Interdictions (anti-« AI slop »)
- ❌ gradients décoratifs, glassmorphism/backdrop-blur, glow, néon
- ❌ violet par défaut, emojis comme icônes de navigation principale
- ❌ radius >8px hors thèmes colorés, ombres floues génériques
- ❌ texte explicatif en anglais quand l'utilisateur écrit en français
- ✅ chaque nombre affiché porte son contexte (n, p, fenêtre)

## 7. Accessibilité
Contraste encre/papier = AAA. Focus visible 2px `--accent`. Touch targets ≥20px (grip drag 24px). Aucune info portée uniquement par la couleur.
