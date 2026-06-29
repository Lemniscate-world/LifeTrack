# Changelog

All notable changes to LifeTrack are documented in this file.

## [Unreleased]

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
