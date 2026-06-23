# Contributing to LifeTrack

Thanks for your interest in contributing!

## Setup

```sh
git clone https://github.com/Lemniscate-world/LifeTrack.git
cd LifeTrack
npm install
npm run desktop    # dev mode with hot reload
```

Requirements: Node.js 22+, Rust 1.77+

## Development

```sh
npm test           # 38 tests (Vitest + React Testing Library)
npm run lint       # ESLint
npm run package    # build .exe + .msi installer
```

## Commit Convention

- `feat:` new feature
- `fix:` bug fix
- `refactor:` code restructuring
- `test:` test changes
- `docs:` documentation
- `ci:` CI/CD changes
- `style:` CSS/themes/design

## Pre-commit Hooks

```sh
git config core.hooksPath .githooks
```

Protected files (never commit): `PLAN.md`, `SESSION_SUMMARY.md`, `.env`, `*.key`, `*.pem`

## Pull Requests

1. Run `npm test` and ensure all tests pass
2. Run `npm run lint` with no errors
3. Update `CHANGELOG.md` under `[Unreleased]`
4. Request review from @Lemniscate

## Architecture

| Layer | Path |
|-------|------|
| UI | `src/App.tsx`, `src/App.css` |
| Store | `src/store.ts` |
| Types | `src/types.ts` |
| Desktop | `src-tauri/` (Rust + Tauri config) |
| Tests | `src/test/` |

Storage uses localStorage with checksum integrity, automatic backup recovery, and debounced writes. See `src/store.ts` for details.
