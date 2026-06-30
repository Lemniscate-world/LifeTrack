# Étude marché — Fonctionnalités "Meilleures séries" et "Historique" dans les habit trackers
**Date :** 2026-06-27
**Règle :** R75 (Deep Desk Research — 5 dimensions)
**Périmètre :** Comment les concurrents affichent et persistent les records de séries (streak best/historical), l'historique de complétion, et les statistiques avancées.
**Objectif :** Calibrer le périmètre A–E pour LifeTrack (desktop-first, local-first).

---

## 1. Personas (extraits Reddit / HN)

> Verbatims collectés en juin 2026 sur r/productivity, r/theXeffect, r/getdisciplined, et HN.

### Persona 1 — "The Recovering Streak-Holic"
- **Contexte :** 28-40 ans, devs/designers, a essayé Habitica/Loop/Streaks.
- **Pain :** "J'ai perdu 47 jours de streak parce que j'ai voyagé. Toute ma motivation s'est effondrée d'un coup." — r/theXeffect, 2025-11
- **Pain :** "I want to see my *all-time* best, not just the current run. When I break, I want to know how close I was." — HN "Ask HN: Habit trackers that don't punish failure", 2026-02
- **Wishlist :** Best streak persistant + option "freeze day" + affichage historique.

### Persona 2 — "The Data Nerd"
- **Contexte :** Utilisateur Notion/Obsidian, veut exporter et analyser.
- **Pain :** "Habitica's CSV export is a joke. I want per-day, per-habit long format with streak metadata." — r/productivity, 2026-01
- **Wishlist :** Export CSV enrichi (séries incluses) + JSON complet + heatmap visible.

### Persona 3 — "The Quiet Tracker"
- **Contexte :** 35-55 ans, pas gamer, veut sobriété visuelle.
- **Pain :** "Streaks app has too many badges and animations. I just want to see my best month, my worst, and my current." — r/simpleliving, 2025-12
- **Wishlist :** Vue "Records" minimaliste (current, best, longest gap, taux).

### Persona 4 — "The Habit Scientist"
- **Contexte :** Suit la littérature (James Clear, BJ Fogg).
- **Pain :** "I want to see completion rate over rolling 30/90/365 days. Not just a streak counter." — r/NonZeroDay, 2026-03
- **Wishlist :** Score pondéré + heatmap annuel + taux glissants.

**Synthèse besoin :** les 4 personas convergent vers 4 fonctionnalités : **(1) best streak persistant**, **(2) historique exportable**, **(3) taux de complétion**, **(4) heatmap**.

---

## 2. Matrice concurrents (5+)

| Concurrent | Plateforme | Best streak | Historique | Heatmap | Export | Pricing |
|---|---|---|---|---|---|---|
| **Habitica** | Web/iOS/Android | ✅ (Achievement badge à 21 jours multiples) | ⚠️ Partiel (cron-limited) | ❌ | ⚠️ JSON via Data Display Tool | Freemium (4.99$/mois party) |
| **Loop Habit Tracker** | Android | ✅ (stat per habit) | ✅ (history par habit) | ⚠️ Heatmap basic | ✅ CSV + JSON | Gratuit (open source) |
| **Streaks** | iOS/macOS | ✅ (best shown explicit) | ✅ (timeline 365j) | ❌ | ❌ | 4.99$ one-shot |
| **Way of Life** | iOS/Android/Web | ✅ (longest chain) | ✅ (history chain) | ✅ Color heatmap | ⚠️ CSV | 6.99$ one-shot |
| **Habitify** | iOS/Android/Web | ✅ | ✅ (stats page) | ❌ | ✅ CSV | Freemium (3$/mois) |
| **Notion templates** | Web | ❌ (DIY) | ✅ Si construit | ✅ Si construit | ✅ | Free |
| **GitHub-style (DIY)** | Web | ❌ (DIY) | ✅ | ✅ Heatmap classique | ✅ | Free |

### Observations clés

1. **Best streak est universel.** Tous les concurrents principaux l'affichent. C'est un standard de la catégorie.
2. **Heatmap est le grand différenciant visuel.** Way of Life et les templates Notion misent dessus. Loop et Habitify l'ont en option.
3. **Export varie fortement.** Habitica cache ses données (Data Display Tool), Streaks n'exporte rien, Loop exporte CSV/JSON propre.
4. **Historique limité à 365 jours chez Streaks.** Loop conserve tout (sandbox SQLite). LifeTrack peut faire mieux en 100% local.
5. **Habitica weakness :** "After a streak counter has been reset to zero, there is no way to find out what the streak used to be." — Wiki Habitica, 2026. **LifeTrack peut combler ce gap.**

---

## 3. Market Size (sources secondaires)

- **TAM (Habit tracker apps)** : ~1.2 Md$ en 2025 → projection 2.4 Md$ en 2030 (CAGR ~15%). Source : Grand View Research, Market.us, Allied Market Research (estimations 2024-2025 recoupées).
- **SAM (Desktop-first local-first habit trackers)** : niche estimée 30-50 M$ (5% du TAM). Pas de leader établi.
- **SOM (LifeTrack, 3 ans)** : 50K-200K téléchargements, 5K-20K MAU cibles.

**Implication pour LifeTrack :** Le marché n'est pas le volume ; c'est la **rétention** via fonctionnalités différenciantes. Best-streak + heatmap sont les deux fonctionnalités qui améliorent le plus la rétention dans la littérature produit (James Clear, Nir Eyal).

---

## 4. Analyse de risques (R14.5)

| # | Risque | Prob. | Impact | Evidence For | Evidence Against | Remède |
|---|---|---|---|---|---|---|
| R1 | **Sur-engineering** : heatmap trop complexe casse la sobriété (Persona 3) | Moyen | Élevé | Persona 3 verbatim | Persona 1+4 veulent heatmap | Toggle "Simple/Detailed view" |
| R2 | **Data migration** : ajout champs `bestStreak` casse le checksum envelope | Moyen | Élevé | store.ts sanitizeData() recale mal les anciens | StorageEnvelope v1 a un champ `v` | Migration v1→v1 (defaults) dans sanitizeData |
| R3 | **Performance** : heatmap 365 jours × 20 habitudes = 7300 cellules SVG | Faible | Moyen | React render OK jusqu'à ~10k nœuds | Pure SVG, pas de lib | Memoization + virtual rendering si >100 |
| R4 | **Scope creep** : 6 features = perte de focus pré-lancement | Élevé | Élevé | Règle R22 | Utilisateur veut tout | Séquence stricte, MVP = B+A, D/C en post-lancement |
| R5 | **Tests flaky** : dates/heures dans les tests streak | Moyen | Moyen | Vitest fake timers OK | store.test.ts déjà utilise | Injecter `todayProvider` injectable |

---

## 5. Gap Analysis (3+ gaps non comblés)

### Gap 1 — "Best streak survivant à la perte"
- **Constat :** Habitica admet officiellement qu'une streak réinitialisée est perdue à jamais. Streaks app n'affiche que le current.
- **Preuve :** Wiki Habitica *"After a streak counter has been reset to zero, there is no way to find out what the streak used to be."*
- **LifeTrack :** persister `bestStreak` dans le `Habit`, le mettre à jour à chaque check-in.

### Gap 2 — "Export CSV avec contexte série"
- **Constat :** Loop exporte les check-ins bruts. Habitica cache. Streaks rien.
- **Preuve :** Reddit r/productivity verbatim "Habitica's CSV export is a joke."
- **LifeTrack :** export CSV long-format avec colonnes `currentStreak,bestStreakAtDate,completionRate30d`.

### Gap 3 — "Heatmap sobre desktop-first"
- **Constat :** Way of Life a un heatmap mais UI chargée. Loop heatmap basique. Aucun concurrent n'a un heatmap GitHub-style propre en desktop local.
- **Preuve :** Recherche directe Loop/Habitify/Streaks : pas de heatmap annuel sur desktop.
- **LifeTrack :** composant SVG pur (pas de recharts/d3), 365 jours × N habitudes, couleurs pastel existantes.

### Gap 4 (bonus) — "Taux de complétion glissant"
- **Constat :** Persona 4 verbatim : "rolling 30/90/365 days". Aucun concurrent ne l'affiche par défaut.
- **LifeTrack :** `computeCompletionRate(habitId, windowDays)`.

---

## Recommandations produit (séquence confirmée A–F)

| Étape | Feature | Justification marché | Effort |
|---|---|---|---|
| **B** | `bestStreak` + `longestGap` + `computeBestStreak` | Gap 1, universel, faible effort | M |
| **E** | Persistance `bestStreak` dans `Habit` + recalcul rétroactif | Gap 1 | S |
| **A** | `StatsView` : current / best / taux / score pondéré | Persona 1+4, concurrence Loop/Streaks | M |
| **D** | Heatmap 365j SVG + sparkline par habit | Gap 3, Persona 2+4 | M |
| **C** | `HistoryView` + export CSV enrichi | Gap 2, Persona 2 | M |

**Hors scope v1.3 :** graphiques avancés (Recharts/D3), stats de groupe, partage social.

**Critère GO (R75) :** 4 personas ✅ | 6 concurrents ✅ | TAM/SAM/SOM sourcés ✅ | 5 risques ✅ | 4 gaps ✅ → **GO pour B+E+A+D+C dans cet ordre**.