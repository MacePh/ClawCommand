# ClawCommand Handoff

## Project
- Location: `F:\ClawCommand`
- Goal: cross-platform hybrid agent command center (Windows + Linux friendly), web-first.

## Stack
- Frontend: Vite web app (`src/main.ts`, `src/style.css`)
- Backend: small Node/Express API (`server.js`)
- Persistence: local JSON files in `data/`
- OpenClaw integration: shell-outs to `openclaw status` and `openclaw sessions --json`

## Current status
- Hybrid v1 shell is running with:
  - top status bar
  - live activity feed
  - quick task intake
  - kanban board with drag/drop and delete
  - OpenClaw status panel
  - sessions/workers panel with normalized cards
- Backend now normalizes OpenClaw session JSON into simpler session cards.
- Polling cadence tightened to 10s.
- Activity feed records OpenClaw session fetches and task mutations.

## Relevant files
- `package.json`
- `server.js`
- `src/main.ts`
- `src/style.css`
- `data/tasks.json`
- `data/events.json`

## Next steps
1. Add a single command to run frontend + backend together.
2. Remove leftover Vite scaffold junk (`src/counter.ts`, unused assets) and tidy branding.
3. Add richer worker state cards and model/tool telemetry summaries.
4. Add task editing and persistent ordering.
5. Optionally add live log tail / stream adapter instead of polling only.

## Notes
- Web-first was chosen to stay dual-boot / cross-platform friendly.
- This remains Option C: real OpenClaw visibility where easy, local task orchestration where backend APIs are not fully wired yet.
