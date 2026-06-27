# LifeTrack — Desktop Habit Tracker

LifeTrack is a native Windows habit tracker: fast, local-first, and built for daily review loops.
It uses React + TypeScript + Vite for the UI and Tauri v2 (Rust + WebView2) for desktop packaging.

## Features

- Monthly habit grid with keyboard navigation and undo/redo shortcuts
- Habit CRUD: add, rename, archive, delete, edit monthly goals
- Optional Chaos links per habit: missed streaks heat up life dimensions
- Chaos dashboard showing healthy vs triggered habits per dimension
- Statistics view: current/best streaks, completion rates, weighted score
- Notes panel with persistent local notes
- Theme cycling + dark mode with persisted preferences
- JSON import/export and CSV export
- Desktop auto-backups in the app data directory
- Offline-first storage with checksum envelope, backup recovery, and malformed-data filtering

## Install

Download the latest installer from [Releases](https://github.com/Lemniscate-world/LifeTrack/releases), or build locally:

```sh
npm install
npm run desktop    # dev mode with hot reload
npm run package    # build .exe + .msi installers
```

Requirements: Node.js 22+, Rust 1.77+, Windows WebView2.

## Development

```sh
npm run lint       # ESLint
npm test           # 113 tests (Vitest + React Testing Library)
npm run build      # TypeScript + Vite production build
```

For the Rust/Tauri side:

```sh
cd src-tauri
cargo fmt --check
cargo check --quiet
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 19 + TypeScript + Pure CSS |
| Build | Vite 8 |
| Desktop | Tauri v2 (Rust + Windows WebView2) |
| Storage | localStorage + checksum integrity + backup key |
| Tests | Vitest + @testing-library/react + jsdom |

## Storage Architecture

Data is stored locally with a versioned envelope:

- Primary key + backup key
- FNV-1a checksum integrity verification on every load
- Debounced writes with unload/periodic safety flushes
- Automatic recovery from backup when primary storage is corrupted
- Sanitization of malformed habits, check-ins, notes, and imported dates
- Desktop JSON backups kept under the Tauri app data directory

## Roadmap

Next product direction: habit stacking — define routines such as “after coffee, meditate,” show stack progress, and surface skipped downstream habits.

## License

MIT — see [LICENSE](LICENSE).
