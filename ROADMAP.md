# ROADMAP.md — LifeTrack Habit Tracker

LifeTrack is a premium Windows desktop habit tracker (a Loop Habit Tracker clone) built with Tauri v2, React 19, TypeScript, and pure CSS. It offers high performance, local data privacy, rich aesthetics, statistics, and habit scoring.

---

## Vision
To provide a fast, local-first, distraction-free desktop application for tracking daily habits, streaks, and progress with advanced habit scoring (exponential moving average frequency decay) and custom life-quality indicators (Chaos levels).

---

## High-Level Status & Roadmap

### Phase 1: Core Grid (Completed)
- [x] 30-day monthly grid view for habit checks.
- [x] Habit CRUD (Add, Rename, Archive, Delete).
- [x] Proportional progress bar showing daily completion goals.
- [x] Pastel-color rotation for visual habit separation.
- [x] Month navigation (previous/next month/year).
- [x] Dark mode support with persistent preference.
- [x] local-first storage using HTML5 localStorage.

### Phase 2: Polish & Rich UX (Completed)
- [x] Click habit goal column -> inline numeric goal editing.
- [x] Functional Notes section per habit (add notes, view, delete, sort).
- [x] Smooth CSS hover states and interactive micro-animations.
- [x] Multi-file data storage integrity check (primary envelope + checksum + backup).
- [x] Hardened test suite (61 tests covering store CRUD, check-ins, statistics, and UI).

### Phase 3: Insights & Scoring (Completed)
- [x] Navbar export/import dropdown supporting JSON and CSV formats.
- [x] Statistics view with Grid and Stats tabs.
- [x] Detailed habit statistics (current streak, best streak, 7d/30d/90d/365d completion rates).
- [x] Loop-style habit scoring using an Exponential Moving Average (90-day window, 0.95 decay factor).

### Phase 4: Desktop Packaging & Desktop Features (Completed)
- [x] Tauri integration (src-tauri initialize, Cargo setups).
- [x] Automatic local file backup in AppData directory.
- [x] Bidirectional backup restore system with name-deduplication.
- [x] Native Windows package generation (`.exe` / `.msi` packaging).
- [x] Keyboard shortcut navigation (arrow keys to move focus, Space to check/uncheck).
- [x] Undo/Redo support for accidental checks (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z).

### Phase 5: Polish & Edge Cases (Completed)
- [x] Custom Chaos pressure gauge tracking routines and physical/financial indicators linked to habits.
- [x] Empty state UI polish.
- [x] Import/storage hardening for invalid dates and corrupted entries.
- [x] **Persistent personal records** (best streak, longest gap) — survives streak breaks.
- [x] **365-day heatmap + sparkline** per habit in Statistics view.
- [x] **History tab** with reverse-chronological timeline.
- [x] **Enriched CSV export** (9 columns incl. lifetime streak stats).
- [ ] Accessibility audit (focus rings, ARIA roles, and screen-reader friendliness).
- [ ] Performance audit (Lighthouse performance target > 95).

### Phase 5.5: Insight Saturation (Completed 2026-06-27)
- [x] `src/stats.ts` — pure functions module for streak / rate / score calculations.
- [x] Refactor: Statistics view uses `computeStreakStats` instead of bespoke helpers.
- [x] Backward-compatible data migration (new Habit fields auto-backfilled on load).

### Phase 6: Habit Stacking (Planned)
- [ ] Add optional "after habit" links to build routines from existing habits.
- [ ] Show stack progress: completed, blocked, skipped, and next suggested habit.
- [ ] Add stack templates for common morning/evening workflows.
- [ ] Consider Chaos amplification when multiple linked habits in a stack are missed.

---

## Local Development Setup

### Prerequisites
- Node.js (v22+)
- Rust (Cargo) for Tauri desktop builds

### Installation
1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Execution Scripts
- **Web development server** (runs in browser):
  ```bash
  npm run dev
  ```
- **Desktop development server** (runs in native Tauri window):
  ```bash
  npm run desktop
  ```
- **Run test suite**:
  ```bash
  npm test
  ```
- **Package Tauri Desktop App** (compiles Cargo crates and produces `.exe` / `.msi` installer):
  ```bash
  npm run package
  ```

---

## Anti-Goals
- Cloud synchronization or remote database storage.
- Authentication, logins, or social features.
- Cross-device syncing (LifeTrack is strictly local-first).

---

## License
MIT License. Feel free to copy, modify, and distribute.
