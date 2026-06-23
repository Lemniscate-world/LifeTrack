# LifeTrack — Desktop Habit Tracker

A native Windows desktop habit tracker. Minimal, fast, offline-first.
Built with React + TypeScript + Vite, packaged via Tauri v2 (Rust + WebView2).

## Features
- Monthly grid view with 30-day columns
- Track 3 to 40+ habits with vertical scroll
- Pastel-colored check cells with checkmark icons
- Configurable goals per habit (click to edit)
- Dark mode with persistent preference
- Grid & Statistics views (streaks, completion rates, weighted scores)
- Notes panel per session
- Export data to CSV / JSON
- Offline-first: all data stored locally (localStorage with checksum + backup)
- Storage health indicator in the UI

## Install
Download the latest installer from [Releases](https://github.com/Lemniscate-world/LifeTrack/releases) or build from source:

\\\sh
npm install
npm run desktop    # dev mode with hot reload
npm run package    # build .exe + .msi installer
\\\

Requirements: Node.js 22+, Rust 1.77+

## Dev
\\\sh
npm test           # 31 tests (Vitest + React Testing Library)
npm run lint       # ESLint
\\\

## Tech Stack
| Layer | Technology |
|-------|-----------|
| UI | React 19 + TypeScript + Pure CSS |
| Build | Vite 8 |
| Desktop | Tauri v2 (Rust + Windows WebView2) |
| Storage | localStorage + checksum integrity + backup key |
| Tests | Vitest + @testing-library/react + jsdom |

## Storage Architecture
Data is stored in localStorage with a versioned envelope:
- Primary key + backup key
- FNV-1a checksum integrity verification on every load
- Debounced writes (300ms) with beforeunload flush
- Automatic corruption recovery from backup
- Malformed entry filtering (sanitizeData)

## License
MIT — see [LICENSE](LICENSE)
