# LifeTrack — Experimental Habit Tracking

LifeTrack is a native Windows desktop app for experimental habit tracking: track habits, mood, correlations, and run N=1 self-experiments. Local-first, AI-powered insights, built with React + TypeScript + Tauri v2.

## Features

- **Multi-click counter**: Click +1, Shift -1, Ctrl reset per habit per day
- **Per-day notes**: Right-click any cell to log observations
- **Mood tracker**: 8 moods integrated in the daily grid
- **Monthly Focus**: Pin a habit as focus of the month with Today widget
- **Streak colors**: Cells intensify with streak length (glow at 30+)
- **SVG icon system**: Clean, consistent iconography throughout
- **Monthly goals**: Intelligent targets with progress bars
- **Statistics view**: streaks, rates (7/30/90/365d), weighted score, heatmap, sparklines
- **Habit stacking**: Chain habits, cycle detection, Up Next suggestions
- **Skills & Capacities**: XP system, self-ratings, linked habits
- **Chaos dashboard**: 5 life dimensions, missed-streak impact
- **AI Insights**: 9 heuristic rules + Ollama/DeepSeek via Rust backend
- **Rolling backups**: 7-day automatic snapshots, FNV-1a checksums
- **JSON/CSV export & import**, keyboard nav, undo/redo, drag-and-drop
- **Dark mode + 7 themes**, offline-first, no telemetry, no cloud

## Install

Download from [Releases](https://github.com/Lemniscate-world/LifeTrack/releases).

``sh
npm install
npm run desktop    # dev mode
npm run package    # build .exe + .msi
``

Requirements: Node.js 22+, Rust 1.77+, Windows WebView2.

## Development

``sh
npm test           # 547 tests (Vitest + React Testing Library)
npm run build      # TypeScript + Vite
``

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 19 + TypeScript + Pure CSS |
| Build | Vite 8 |
| Desktop | Tauri v2 (Rust + Windows WebView2) |
| Storage | localStorage x2 + checksum + file backup |
| Tests | Vitest + @testing-library/react + jsdom |

## Roadmap
- **v0.4.0**: N=1 experiments, correlation analysis, AI recommendations
- **v0.5.0**: Biohacking protocols (sleep, fasting, supplements), protocol library

## License
MIT
