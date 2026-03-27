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
- Added single-command dev startup:
  - `npm run dev:all`
- Added task editing (inline edit/save/cancel).
- Improved status parsing so pills now expose:
  - gateway state
  - telegram state
- Telemetry collector still emits feed events for session/gateway changes.

## Relevant files
- `package.json`
- `scripts/dev-all.js`
- `server.js`
- `src/main.ts`
- `src/style.css`
- `data/tasks.json`
- `data/events.json`

## Next steps
1. Improve task ordering persistence and drag precision.
2. Add richer worker cards and state badges.
3. Improve telemetry quality further (more structured parsing / better summaries).
4. Optionally add log-tail or SSE/WebSocket streaming instead of polling.
5. Clean remaining template assets/public leftovers if they are no longer useful.

## Notes
- Web-first was chosen to stay dual-boot / cross-platform friendly.
- This remains Option C: real OpenClaw visibility where easy, local task orchestration where backend APIs are not fully wired yet.
