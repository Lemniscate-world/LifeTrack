# Changelog

All notable changes to LifeTrack are documented in this file.

## [Unreleased] - Polish + Grid sticky + Gamification (2026-08-20)

### Added
- **Grid sticky + semaines** - colonne habitudes collante au scroll horizontal, trait fort après chaque 7e jour, zébrure ledger conservée.
- **Streak accentué** - bord gauche coloré (3px/4px), fond teinté et badge pulsant pour les séries longues, lisible en Noir & Blanc.
- **Onboarding** - état vide enrichi avec 3 habitudes suggérées (Méditation/Sport/Lecture) en un clic + astuce thème.
- **Insights profonds** - TREND et Burnout avec h de Cohen, p (approx. normale), n, magnitude et caveat puissance ; force basée sur effet + significativité, textes en français avec nuance réelle.
- **Thèmes journal/notes profonds** - lexique 80+ mots FR/EN (fatigue, stress, anxiété, victoire…), normalisation des accents, TF-IDF (les thèmes rares pèsent plus), 10 thèmes (Travail/Famille/Sommeil/Argent/Sport/Stress/Alimentation/Émotion/Social/Santé), scores et totaux affichés.
- **Insights dédoublonnés** - les cartes TREND/WEEKLY_TREND et la section "Correlations & Trends" quittent Insights (redondant avec l'onglet Corrélations) ; simple compteur + lien.
- **Rotation 6h** - les recommandations tournent par créneau de 6h au lieu de 24h : matin/soir ne montrent plus le même top.
- **Onglet Corrélations amélioré** - atterrit sur Top insights (au lieu de la matrice brute), nuage de points SVG dans l'inspecteur de paire (jours alignés, droite des moindres carrés, tooltips par jour).
- **Analyse en profondeur (deepInsights.ts)** - nouvelle section en tête d'Insights avec 11 moteurs : chaînes prédictives A(t)→B(t+1) avec lift et p, prévision de rupture de série par jour de semaine ("ta série casse samedi"), tes propres mots contrastés (vocabulaire des jours ratés vs réussis, ratio ≥2×), effet dose (0/1/2+ habitudes → humeur), interférence entre habitudes (cannibalisation), pattern de reprise après coupure, calibration d'objectif mensuel (médiane vs cible, suggestion réaliste), effet premier coche (<10h vs >12h sur le taux du jour), drift week-end par habitude, duo synergique sur humeur, charge hebdo optimale. Chaque carte porte n/p/effet — mesuré sur TES données.

### Fixed
- **Noir & Blanc polish** - radius 0 cohérent (override des hardcodés 4/6/8/12px), scrollbar carrée, hard-shadows éditoriales sur boutons/onglets, navbar sans blur, swatch et onglet actif lisibles, focus ring, transition couleur/bordure, fix mobile radius.
- **Drag & drop** - handle agrandi (24px, 20px en compact) et plus visible (opacité 0.55), sticky de la colonne habitudes désactivé pendant le drag, placeholder en pointillés visible, transition fluide, fix du remount du DragDropContext qui empêchait le drop, bouton Compact reflète l'état effectif (auto → forcé).
- **Drop au bon endroit** - tri des habitudes par `order` avant reorder (évite le décalage de 1-2 lignes), `<tr>` forcé en `display: table` pendant le drag pour que le `transform` soit fiable, log `[drag]` pour diagnostiquer.

## [0.6.2] - Reinstalled build, recovery hardening (2026-08-19)

### Added
- **File recovery audit trail** - `recovery-debug.log` under AppData records each startup recovery scan (directories, parsed backups, best/current weights, restore outcome).
- **Recovery retry at boot** - up to 3 attempts (immediate, +3s, +6s) so a not-yet-ready filesystem plugin no longer causes a silent missed restore.

### Fixed
- **File backup/restore paths** - `attemptFileRecovery` and `doFileBackup` built paths by raw concatenation (`${dir}${sub}`) but `appDataDir()/documentDir()/desktopDir()` do not end with a separator on Windows, producing `...com.lemniscate.lifetrackbackups` (forbidden path). Now uses the `join` API. **This fix makes the disk safety net actually work** - verified end-to-end: wiped WebView2 profile -> app booted -> restored 29 habits / 524 check-ins / 8 notes / 8 personas / 2 levers / 1 challenge and wrote `lifetrack-persistent.json` to AppData, Documents and Desktop.
- **Capabilities scope** - `fs:default` read scope did not cover the backup folders; added explicit read/write/mkdir/remove permissions for `$APPDATA/**`, `$DOCUMENT/**`, `$DESKTOP/**`.
- **Cargo.toml corruption (from commit e3484b1)** - `tauri` was `0.6.2` (a version string, not the crate) and `tauri-build` likewise; restored `tauri = "2.11.3"`, `tauri-build = "2.6.3"`, `rust-version = "1.77.2"`; description de-mojibaked to ASCII.
- **Window title mojibake** - `tauri.conf.json` title was a corrupted multibyte string; now `LifeTrack - Habit Tracker`.
- **bump-version.ps1 guard** - aborts if `tauri`/`tauri-build`/`rust-version` drift off their expected formats after a version bump.
- **Compact grid (25-50 habits on screen)** - `⚡ Compact` toolbar toggle (pref `compactGrid`), 22px day columns / 17px cells, thin scrollbar; settings toggle under Appearance > Grid. Restored 1px horizontal row separators so dense rows stay readable.
- **Compact grid improvements** - auto-compact kicks in automatically at N habits (threshold 20/25/30/40/50, default 30, `autoCompact` pref); density slider (Standard / Dense / Ultra, `compactLevel`) shrinks cells down to 13px in Ultra; today column is tinted so you spot it instantly; faint borders on every cell reveal the full grid structure.
- **Noir & Blanc theme** - 9th theme (`theme-bw`, "Noir & Blanc"): striking editorial monochrome - pure black/white, sharp corners (radius 0), halftone dot texture, solid ink header bar with uppercase letters, day cells filled solid black when done (white in dark mode) with gray-to-black streak intensity, ledger zebra stripes, hard offset shadows. Not the generic AI look - it reads like a printed newspaper ledger.

## [0.6.1] — Automated knowledge harvest & life intelligence

### Added
- **Permanent automated ingestion (feeds)** — LifeTrack fetches its curated RSS/Atom feeds (arXiv: neuroscience, HClab, AI) on a schedule, extracts structured, evidence-graded protocols and merges them into the local library. No pasting, no manual step: while the app runs, it self-refreshes (`autoIngestEnabled`, interval configurable).
- **Windows autostart** — optional launch at logon so the ingestion loop runs continuously (`set_autostart` → `HKCU\...\Run`, per-user, no admin).
- **AI-assisted extraction** — `extract_protocols_ai` structures protocols via DeepSeek V4 Flash (or any configured provider); offline heuristic remains the fallback.
- **DeepSeek V4 Flash by default** — new default cloud model (`deepseek/deepseek-v4-flash`), preconfigured in AI settings and on first install.
- **Projects linked to habits** — "coding" can feed one or many projects; tasks + check-in attribution make skills measured by real deliverables.
- **Behavior-based challenges + N=1 experiments** — suggestions derived from correlations, reflections and streaks, converted into challenges and testable experiments.
- **Preference engine** ("Savoir") — ranks protocols to try, challenges to take and experiments to run from your own data (anti-overwhelm, stickyMax).
- **Recommendation freshness** — set-aside (dismiss) + daily rotation stops the "same recommendations again and again" problem.
- **Auto-achievements** — milestones derived from your data (first habit, streak ≥7/30, 100 completions, first win/experiment/urge/journal/project/challenge).
- **Grid cleanup** — removed the 7-day mini-stripe under habit names.

### Fixed
- Atom namespace parsing in the RSS/Atom parser (robust to namespaced feeds, unescaped `&`, Atom `<id>`).
- Reactivity of Projects/Knowledge views (memo on the tick value, not the setter).

## [0.6.2] — Life across all levels (2026-08-18)

- **Today view enriched** — daily progress bar, one-tap mood for today, and a "Cette semaine"
  digest (7-day completion, best day, active habits).
- **"Aujourd'hui, essaie"** — a single focused protocol from the preference engine surfaced in
  Today, so there's always one concrete thing to try.
- **`weeklySummary` module** (pure, tested) — reusable trailing-7-days digest.
- **Chaos dashboard: note de cause par liaison** — you can now explain *why* a missed habit
  destabilises a life dimension (editable in the ⚡ picker per zone) and the reason is shown
  right under that habit in the Chaos dashboard, so it is never forgotten.
- **Correlations « proche de la réalité » (anti-trompeuses)** — every correlation now carries
  anti-artifact diagnostics surfaced in the cards and the inspector:
  `winsorizedCoefficient` (robust to outliers), a jackknife `stability` score, an
  `outlierDriven` flag ("⚠ fragile") and an `autocorrelatedResiduals` warning for inflated
  p-values. New "Fiables (anti-ambiguïté)" filter shows only results that survive all checks.
- **Stacks visibility** — when habits are linked as children but no stack renders (archived
  parent/child), the Stacks view now explains why instead of a generic "No stacks yet".
- **Energy tracker (% 0-100)** — a dedicated grid row under Mood gives a continuous precision
  energy reading (click +10, right-click −10, 100% → cleared). Persisted per day, sanitized on
  load, restored on import, and fed into the correlation engine as a metric series (Pearson)
  alongside habits, Mood and capacities — including the heatmap matrix.
- **Astro missions** — sky-driven mission suggestions (upcoming transits/aspects matched to
  weak life domains), natal ascendant support, auto-create on weak-domain transits.
- **Automated knowledge** — permanent feed ingestion with Windows autostart, AI-assisted
  protocol extraction, auto-adopted suggestions, "Savoir" preference engine.
- **Hygiene** — canonical `src/dates.ts` date helpers (was copy-pasted in ~20 modules),
  `testTimeout` raised for App-level tests, dead files removed, CSP hardened, version aligned.
- **Compact grid (25-50 habits on screen)** — `⚡ Compact` toggle in the grid toolbar (and a
  "Grid" setting in Appearance): smaller day cells, tighter rows/columns, thin scrollbar, so
  long habit lists stop needing vertical scrolling. Preference `compactGrid` persists via the
  normal backup chain, default off.

## [0.3.2] — 2026-07-25

### Added
- **Onboarding tutorial** — 10-step guided walkthrough for new users, accessible via "?" button in navbar. Covers check-ins, multi-click, notes, categories, urges, stacks, shortcuts, settings, and more.
- **Multi-notes per check-in** — each daily check-in now supports multiple notes instead of a single note. "Add note" opens a popup where notes can be added/removed individually (Ctrl+Enter to save).
- **Note dots always visible** — small blue dots appear on every cell that has notes, no hover required. A ring highlights the currently selected day.
- **Dedicated drag handle** — habit reordering now uses a grip icon column (≡) instead of dragging the entire row, preventing accidental drags during button clicks.

### Changed
- **Multi-click OFF by default** — new habits default to single-click mode. Users can re-enable multi-click in Settings.
- **SVG logo redesigned** — concentric circles with ascending path and final dot, symbolizing progress.
- **Habit categories** — 6 default categories (Health, Work, Learning, Creativity, Social, Other) with a selector dropdown per habit row.

### Fixed
- **mergeImportedData now preserves all 13 data types** — previously lost moods, experiments, urges, mantras, chaos dimensions, mantra settings, and preferences during import.
- **Preferences (darkMode/theme) survive reinstall** — moved into AppData.preferences with full backup chain + legacy localStorage fallback.
- **find_latest_backup now searches 7+ locations** — including Google Drive, OneDrive, and AppData/LifeTrack/.
- **SettingsView reset cleans all keys** — no longer leaves orphaned localStorage keys.
- **Count + note preserved on import** — parseImportedCheckIn now extracts count and notes; merge keeps highest count and merges notes arrays.
- **Upgrade backup date-key bug** — fixed prefix search to match date-only keys created with time-suffixed keys.
- **package.json BOM encoding** — fixed UTF-8 BOM causing PostCSS config parse failure.

## [0.2.1] — 2026-06-29

### Fixed
Nine latent bugs found during pre-release audit:

- **`store.flushSave` race** (HIGH) — pending write could be dropped if a save was already in flight. Fixed with a `pendingData` slot that runs after the current save completes.
- **Undo/redo ghost check-ins** (HIGH) — restoring an old snapshot after a habit was deleted could recreate dangling check-ins. Fixed with a `data.habits.some(...)` guard in both `undo` and `redo`.
- **Import duplicate-id collision** (HIGH) — re-importing a backup with the same `id` could attach check-ins/notes to the wrong habit. Fixed with a `seenImportIds` Set that warns and keeps the first-seen mapping.
- **Safety net missed notes** (MEDIUM) — the 100-entry autosave recovery trigger didn't fire when only notes had changed. Fixed: condition now includes `existing.notes.length > 0`.
- **Silent backup failure** (LOW) — backup write errors were swallowed. Now logs `console.warn`.
- **`autoRestoreChecked` module-level flag** (HIGH) — React StrictMode remount could permanently disable auto-restore on the second mount. Fixed: moved to `useRef` inside `App`.
- **`computeChaosReport` recomputed on every render** (MEDIUM) — wrapped in `useMemo([tick])` so it only runs when the UI forces a refresh.
- **`trackingStart` accepted malformed dates** (MEDIUM) — strings like `2026-02-30` were silently normalized to `2026-03-02`. Fixed with regex + round-trip validation.

### Tests
- 231 tests passing (was 223, +8).
- New file `src/test/audit-fixes.test.ts` — 8 regression tests for the bugs above.

## [0.2.0] — 2026-06-29

### Added
- **Habit stacking** — each habit can optionally have a `stackParent` (the triggering habit). Inspired by James Clear's "Atomic Habits" and Loop's "reminder anchoring".
- New view tab **Stacks** showing every stack's progress for today (done / pending / blocked / untracked) with status glyphs (✓ • ⊘ ?) and a per-stack progress bar.
- Per-row stack link icon (chain glyph) next to chaos and archive — opens an inline picker.
- Inline badge in the grid: `↳ <parent name>`, clickable to focus the parent row.
- "Up next" contextual suggestion banner in the Stacks view (first pending step whose parent is done).
- Cycle detection in `linkHabitToParent`: refuses A→B→A or longer cycles.

### Changed
- New `Habit.stackParent` field. Existing data loads fine — field is optional.
- `deleteHabit()` now clears `stackParent` references in remaining habits to avoid dangling pointers.

### New modules
- `src/stacks.ts` — pure graph logic: `linkHabitToParentInPlace`, `unlinkHabitInPlace`, `clearDanglingStackParentsInPlace`, `computeStacks`, `getNextStackSuggestion`. No side effects; everything takes habits+checkIns+today as args.
- `src/StacksView.tsx` — read-only view that consumes the pure helpers above.
- `docs/specs/stacks.md` — design spec (model, API, edge cases, scope).

### Tests
- 223 tests passing (was 191, +32).
- New test files: `src/test/stacks.test.ts` (25 tests — link, unlink, cycle, archive, deletion cleanup, state propagation, suggestion), `src/test/stacks-ui.test.tsx` (7 tests — StacksView rendering, badge, blocked state).

## [0.1.2] — 2026-06-29

### Added
- **Drag-and-drop habit reordering** in the grid view — pick up any habit row and drop it at a new position. Whole row is the drag handle (`cursor: grab` on hover).
- `@hello-pangea/dnd` 18.0.1 already in deps; now actually wired up.
- New component: `src/components/DraggableHabitRow.tsx` — wraps each row in a `<Draggable>` from the lib.

### Changed
- `store.ts` exports a new `reorderHabits(sourceIndex, destIndex)` function that follows the `@hello-pangea/dnd` convention (`destIndex` is the target slot AFTER the source has been removed, clamped to valid range).
- Order field is now renumbered sequentially (0, 1, 2, ...) after every reorder — archived habits get the highest orders so they sort last if ever unarchived. No more fractional gaps accumulating over time.
- Grid cursor now shows `grab` on hover for reorderable rows (and `grabbing` while dragging) for discoverability.

### Tests
- 191 tests passing (was 171, +20).
- New test files: `src/test/reorder.test.ts` (14 tests covering basic moves, guards, archived habits, order hygiene, save/reload cycle), `src/test/dnd.test.tsx` (6 UI integration smoke tests for draggable IDs, droppable, handle propagation).

### Fixed
- `store.test.ts` had a stale assertion (`longestGapAt` hard-coded to `2026-06-27`) which broke as soon as real-time advanced. Now uses runtime date.

## [0.1.1] — 2026-06-27

### Added
- **`src/stats.ts`** — new pure-functions core: `computeStreakStats()`, `computeCompletionRate()`, `computeWeightedScore()`, `trackingStart()`. 29 unit tests.
- **Persistent personal records** on `Habit`: `bestStreak`, `bestStreakAt`, `longestGap`, `longestGapAt`, `totalCompleted`. Recalculated on every mutation and on legacy data load (`recalculateHabitRecords()` in `notify()`, backfill on `resetStore()`).
- **Statistics view — Gap column** + ★ tag on all-time best streak.
- **365-day GitHub-style heatmap** per habit (pure SVG, no dependencies). Shows past 365 days, marks today, grey-pales days before tracking start.
- **30-day rolling sparkline** per habit (7-day completion window).
- **History tab** — reverse-chronological timeline of all check-ins, grouped by day, with habit filter and "show misses" toggle.
- **Enriched CSV export** — now 9 columns: `date, habit, habit_id, completed, current_streak_at_date, best_streak_at_date, completion_rate_30d, total_completed, chaos_dimension`. Backward-compatible header change (was 3 columns).

### Changed
- `App.tsx` statistics calculation refactored to use `src/stats.ts` (single source of truth for streaks and rates).
- Statistics view now reads the **persistent** `bestStreak` field instead of recomputing on every render — much faster on large datasets.
- Habit colors no longer default to "no color" if palette exhausted (fallback to modulo rotation).

### Tests
- 171 tests passing (was 113, +58).
- New test files: `src/test/stats.test.ts` (29), `src/test/Heatmap.test.tsx` (11), `src/test/HistoryView.test.tsx` (8).
- `src/test/store.test.ts`: +10 tests for record persistence, backfill, and save/reload cycle.

## [Unreleased-pre-sprint]

### Added
- Chaos dashboard with full linked-habit visibility, healthy/triggered states, and dimension pressure summaries.
- Regression coverage for Chaos missed-streak behavior, keyboard focus, import hardening, and undo/redo shortcuts.

### Changed
- Improved Chaos design and grid iconography.
- Refactored restore-from-backup to reuse the safer import merge path.
- Updated Tauri backup detection to parse backup JSON instead of relying on file length.

### Fixed
- Freshly-created habits now correctly enter Chaos when recent past days are marked missed.
- Weekday headers now use the displayed year/month instead of a hardcoded reference date.
- Keyboard focus now highlights the correct habit row.
- `Ctrl+Shift+Z` redo is handled correctly.
- Imported/stored check-ins now reject invalid dates and invalid completion values.
- Imported metadata on existing habits is persisted even when no check-ins are restored.
- Notes retrieval no longer mutates internal store order.
- Tauri import/export paths no longer use avoidable `unwrap()` calls.

### Removed
- Stale `src/App.tsx.bak` source backup.
- Tracked coverage artifacts from the repository.

## [0.1.0] — 2026-06-23

### Added
- Monthly habit grid (1-30 days) with pastel-colored check cells
- Habit CRUD (add, rename, archive, delete)
- Configurable goals per habit (click to edit)
- Dark mode with persistent preference
- 6 color themes (Default, Ocean, Forest, Sunset, Rose, Mono)
- Statistics view (current streak, best streak, completion rates 7d/30d/90d/365d, weighted score)
- Notes panel (add/delete, saved per session)
- Data export (CSV, JSON)
- Keyboard shortcuts (Space to toggle, arrows to navigate, Ctrl+Z/Y undo/redo, Ctrl+N new habit)
- Empty state UX when no habits exist
- Error boundary for crash recovery
- Brand logo (SVG) + app icon (ICO, PNG, ICNS)
- Tauri v2 desktop packaging (native Windows .exe, .msi, .nsis)

### Storage
- localStorage with checksum integrity (FNV-1a hash)
- Primary + backup key automatic recovery
- Debounced writes (300ms) with beforeunload flush
- Periodic save every 30 seconds
- Malformed entry filtering on load
- Storage health indicator in UI (green/yellow/red dot)

### Technical
- React 19 + TypeScript + Vite 8
- Tauri v2 (Rust 1.93 + Windows WebView2)
- 38 tests (Vitest + React Testing Library)
- 0 npm vulnerabilities
- MIT License
