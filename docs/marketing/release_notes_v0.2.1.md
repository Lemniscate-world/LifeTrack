# LifeTrack v0.2.1

A pre-release audit found 9 latent bugs in the persistence and rendering layers. All fixed.

## Fixed

### HIGH severity

- **`store.flushSave` race condition** — A pending write could be silently dropped if a save was already in flight. Replaced with a `pendingData` slot that runs after the current save completes.
- **Undo/redo could recreate check-ins for deleted habits** — Restoring an old snapshot after a habit was deleted could resurrect dangling check-ins. Now guarded by `data.habits.some(...)` in both `undo` and `redo`.
- **Import with duplicate IDs could attach data to the wrong habit** — Re-importing a backup containing duplicate habit IDs silently routed check-ins/notes to a random habit. Fixed with a `seenImportIds` Set that warns and keeps the first-seen mapping.
- **`autoRestoreChecked` could permanently disable auto-restore** — The flag was a module-level `let`; React StrictMode's double-mount in dev would set it to `true` on the first mount, then the second mount would see "already checked" and skip restore. Moved to `useRef` inside the `App` component.

### MEDIUM severity

- **Safety net missed note-only changes** — The 100-entry autosave recovery trigger only counted check-ins. Saving a habit note alone would not trigger a safety net. Now includes `notes.length > 0` in the condition.
- **`computeChaosReport` recomputed on every render** — The chaos view scans every habit's check-ins, which gets expensive past a few hundred. Wrapped in `useMemo([tick])` so it only runs when the UI forces a refresh.
- **`trackingStart` accepted malformed dates** — A string like `2026-02-30` was silently normalized to `2026-03-02` by the JS Date constructor. Now validated with regex + round-trip check.

### LOW severity

- **Silent backup failure** — Backup write errors were swallowed. Now logged via `console.warn`.

## Verified

- 231 tests passing (was 223, +8 regression tests in `audit-fixes.test.ts`)
- TypeScript: 0 errors
- ESLint: 0 errors, 0 warnings
- `npm run package` produces 2.91 MB MSI and 1.94 MB NSIS installer

## Installers

- `LifeTrack_0.2.1_x64_en-US.msi` (Windows Installer, 2.91 MB)
- `LifeTrack_0.2.1_x64-setup.exe` (NSIS, 1.94 MB)

Both signed locally; SHA-256 published in the GitHub Release.

## What's still in v0.2.0 (unchanged in this patch)

- Habit stacking with cycle detection (Phase 6)
- New Stacks view with progress bars and "Up next" suggestion
- Inline `stackParent` picker per habit

Full diff: https://github.com/Lemniscate-world/LifeTrack/compare/v0.2.0...v0.2.1
