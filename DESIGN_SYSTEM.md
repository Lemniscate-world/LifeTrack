# LifeTrack Design System — « Quiet Precision »
> **v2.0 — 2026-08-22.** Remplace « Ledger Brutal » (v1, retiré à la demande produit).
> Source de vérité vivante : `DESIGN.md` (racine). Règle permanente : kuro-rules `rule_108_design_language`.

## Identité
Précision calme. Interface dense mais respirante, neutre et chaleureuse. La
couleur est une DONNÉE (humeur, heatmap, états), jamais une décoration.

## Tokens clés
- `--radius: 6px` (8px mobile) — aucun forçage à 0.
- Ombres douces : `--shadow-sm/md` en blur léger (pas d'offsets durs).
- Bordures 1px standard · 2px structurel.

## Composants signatures (adoucis)
Cartes à barre interne (`box-shadow inset`, plus de border-left épais) ·
zébrure subtile · cellule pleine = fait · mini-calendrier bimodal
(action/vigilance) · directive du jour contrastée · chips médailles.

## Gate qualité (R108.0 — obligatoire)
```
npx -y impeccable detect src/   # exit 0 requis avant tout milestone visuel
```
Dernier passage : ✅ 0 anti-pattern (2026-08-22).

## Historique
- v1 « Ledger Brutal » (2026-08-20) : retiré — radius 0, ombres dures,
  uppercase forcé et texture halftone perçus comme agressifs.
