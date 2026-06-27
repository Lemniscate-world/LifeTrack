# Changelog

All notable changes to LifeTrack are documented in this file.

## [Unreleased]

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
