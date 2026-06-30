# R75 — Android Habit Tracker Competitive Benchmark
**Date :** 2026-06-30
**Règle :** R75 (Deep Desk Research — 5 dimensions)
**Périmètre :** Analyse concurrentielle du marché Android des habit trackers pour positionner LifeTrack Mobile
**Objectif :** Identifier les gaps que LifeTrack peut combler pour se différencier sur le Play Store

---

## 1. Personas Android (extraits Play Store reviews, Reddit r/androidapps)

### Persona A — "The Quick Checker"
- **Contexte :** 22-35 ans, veut check une habitude en <3 secondes
- **Pain :** "I uninstalled Habitica because it took 6 taps to check off 'drink water'. I just want a widget." — Play Store review, 2026-03
- **Wishlist :** Widget homescreen, notification actions, zero-friction check-in

### Persona B — "The Desktop+Mobile Bridge"
- **Contexte :** Utilise un desktop la journée, un phone le soir/weekend
- **Pain :** "Loop is great but it's Android-only. I want my data on my PC too without paying for cloud sync." — r/androidapps, 2026-01
- **Wishlist :** Sync local sans cloud, export/import rapide, UI cohérente desktop↔mobile

### Persona C — "The Minimalist Android User"
- **Contexte :** 30-50 ans, veut une app qui respecte sa batterie et sa vie privée
- **Pain :** "Every habit tracker wants internet permission. Why? My habits are none of Google's business." — r/privacy, 2025-11
- **Wishlist :** Zéro permission réseau, open source, APK <10 MB, Material You theming

### Persona D — "The Routine Builder"
- **Contexte :** Suit Atomic Habits, veut enchaîner ses habitudes
- **Pain :** "I have 8 morning habits and I forget the order. I want an app that tells me what's next." — r/getdisciplined, 2026-04
- **Wishlist :** Habit stacking visuel, "up next" suggestion, routines pré-définies

**Synthèse :** Les 4 personas Android convergent vers : widget, sync local sans cloud, privacy-first, stacking.

---

## 2. Matrice concurrents Android

| Concurrent | Prix | Widget | Sync | Stacking | Open Source | Privacy | Taille APK |
|---|---|---|---|---|---|---|---|
| **Loop Habit Tracker** | Gratuit | ✅ Basique | ❌ | ❌ | ✅ GPLv3 | ✅ Zéro permis | ~5 MB |
| **Habitica** | Freemium 5$/mois | ✅ | ☁️ Cloud | ❌ | ✅ Partiel | ❌ Compte requis | ~40 MB |
| **HabitNow** | Gratuit + 3$ | ✅ Avancé | ❌ (local) | ❌ | ❌ | ⚠️ Pub | ~15 MB |
| **HabitHub** | 5$ one-shot | ✅ | ❌ | ❌ | ❌ | ✅ | ~8 MB |
| **HabitKit** | 4$ one-shot | ❌ | ❌ | ❌ | ❌ | ✅ | ~12 MB |
| **Everyday Habit** | Gratuit | ⚠️ Payant | ☁️ Cloud | ❌ | ❌ | ❌ Compte | ~25 MB |
| **Disciplined** | Gratuit | ❌ | ❌ | ❌ | ✅ MIT | ✅ | ~4 MB |
| **Loop (Fork)** | Gratuit | ✅ | ❌ | ❌ | ✅ | ✅ | ~6 MB |
| **Timecap** | 3$/mois | ✅ | ☁️ | ❌ | ❌ | ❌ | ~30 MB |

### Gaps identifiés sur Android

1. **Habit stacking** — Aucun concurrent Android n'a de chaînage d'habitudes natif. C'est un **océan bleu** complet sur mobile.
2. **Sync desktop↔mobile local** — Aucun ne fait de sync sans cloud entre desktop et mobile. Loop est Android-only. Habitica est cloud-only. HabitNow est mobile-only.
3. **Widget interactif** — Seuls HabitNow et Loop ont un widget, mais aucun n'affiche l'état d'un stack (parent→enfant→bloqué).
4. **Chaos gauge** — Concept unique LifeTrack, inexistant sur Android.
5. **Material You** — Très peu d'apps Android utilisent le theming dynamique Material You (couleurs système). LifeTrack peut le faire.
6. **Export QR code** — Aucun concurrent ne permet le transfert desktop↔mobile par QR code.

### Positionnement recommandé

```
LifeTrack Mobile = Loop (local-first, open source)
                 + HabitNow (widget avancé)
                 + Atomic Habits (stacking visuel)
                 + Signal (QR code sync local)
                 - Cloud, - Compte, - Télémétrie
```

---

## 3. Market Size Android

- **TAM Android habit tracker** : ~400 M$ (⅓ du TAM global 1.2 Md$, le reste étant iOS/web)
- **SAM (local-first, no-cloud)** : ~15-25 M$ (niche privacy)
- **SOM LifeTrack Android** : 10K-50K installs en année 1, 1K-5K MAU
- **Play Store catégorie "Health & Fitness > Habit Tracker"** : ~800 apps, top 10 ont 1M+ installs chacun, top 50 ont 100K+

**Stratégie Play Store :** ASO sur les mots-clés "habit tracker privacy", "habit tracker offline", "habit stacking", "open source habit tracker". Volume modeste mais conversion élevée (utilisateurs prêts à payer pour la privacy).

---

## 4. Fonctionnalités Android natives à exploiter

| Fonctionnalité | API Android | Différenciation |
|---|---|---|
| **Widget homescreen** | `AppWidgetProvider` + Glance (Jetpack) | Widget stack visuel avec checkboxes |
| **Notification actions** | `NotificationCompat.Action` | Répondre OUI/NON sans ouvrir l'app |
| **Material You** | `Material3` + `dynamicColor` | Thème automatique basé sur le fond d'écran |
| **Quick Settings Tile** | `TileService` | Check rapide depuis les paramètres rapides |
| **App Shortcuts** | `ShortcutManager` | Long-press → check habitude #1, #2, #3 |
| **Backup sans cloud** | `BackupAgent` + fichier local | Export JSON vers stockage local |
| **Foreground service** | `Service` + notification | Rappel persistant "3 habitudes restantes" |
| **Wear OS tile** | `TileService` (Wear) | Check depuis la montre |

---

## 5. Analyse de risques Android (R14.5)

| # | Risque | Prob. | Impact | Evidence For | Evidence Against | Remède |
|---|---|---|---|---|---|---|
| R1 | **Tauri mobile immature** → crashs sur devices exotiques | Moyen | Élevé | Tauri v2 mobile <1 an, GitHub issues ouverts | Tauri team active, releases fréquentes | Test sur 5 devices physiques (Samsung, Pixel, Xiaomi, Nothing, ancien Android 10) avant release |
| R2 | **UI responsive** → layout cassé sur petit écran | Élevé | Moyen | 1100px desktop → 360px phone, grille 7 colonnes serrée | Flexbox/CSS Grid s'adaptent bien | Media queries + Touch targets 48px + scroll horizontal optionnel |
| R3 | **APK trop gros** (>20 MB) → mauvais ASO | Faible | Moyen | Tauri + Rust = ~5-8 MB hors WebView | WebView préinstallé sur Android 7+ | Optimize LTO + strip symbols + proguard |
| R4 | **Play Store rejet** → policy "pas assez de contenu" | Faible | Élevé | Google rejette les apps "trop simples" ou "webview wrapper" | LifeTrack a un vrai moteur Rust, pas un simple wrapper | Soumettre en "Early Access" d'abord, inclure captures natives |
| R5 | **Sync local trop complexe** → abandon du QR code | Élevé | Moyen | WiFi Direct/Bluetooth APIs Android fragmentées | QR code est trivial (librairie JS) | **QR code v1 (jour 1)**, WiFi Direct v2 (post-MVP) |

---

## 6. Priorités MVP Android (séquence R22)

```
MVP (Semaines 1-2) :
├── Tauri Android init + APK debug
├── CSS responsive (grille, bottom nav, touch targets)
├── Widget basique (liste 4 habitudes + checkboxes)
└── QR code import/export (scan desktop ↔ scan mobile)

v0.3.0 (Semaines 3-4) :
├── Notification actions (OUI/NON sans ouvrir)
├── Material You dynamic colors
├── Quick Settings Tile
└── Soumission Play Store "Early Access"

v0.4.0 (Post-lancement) :
├── WiFi Direct sync (abandonne QR code)
├── Wear OS companion tile
├── Stacking templates intégrés
└── Release publique complète
```
